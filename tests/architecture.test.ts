import { assertEquals } from '@std/assert';
import { walk } from '@std/fs';
import { dirname, join, relative, resolve } from '@std/path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const SRC = join(ROOT, 'src');

type Layer = 'shared' | 'core' | 'ports' | 'features' | 'adapters' | 'app';

const ALLOWED: Record<Layer, readonly Layer[]> = {
  shared: ['shared'],
  core: ['shared', 'core'],
  ports: ['shared', 'core', 'ports'],
  features: ['shared', 'core', 'ports', 'features'],
  adapters: ['shared', 'core', 'ports', 'adapters'],
  app: ['shared', 'core', 'ports', 'features', 'adapters', 'app'],
};

const CORE_PACKAGES = ['zod'];

const layerOf = (file: string): Layer | null => {
  const top = relative(SRC, file).split('/')[0];
  return top && top in ALLOWED ? (top as Layer) : null;
};

const IMPORT_RE =
  /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

async function sourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const e of walk(dir, { exts: ['.ts'], includeDirs: false })) files.push(e.path);
  return files;
}

Deno.test('architecture: импорты между слоями соблюдают правило зависимостей', async () => {
  const violations: string[] = [];
  for (const file of await sourceFiles(SRC)) {
    const from = layerOf(file);
    if (!from) {
      violations.push(`${relative(ROOT, file)}: файл вне известных слоёв`);
      continue;
    }
    const code = await Deno.readTextFile(file);
    for (const m of code.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? '';
      if (spec.startsWith('.')) {
        const to = layerOf(resolve(dirname(file), spec));
        if (!to || !ALLOWED[from].includes(to)) {
          violations.push(`${relative(ROOT, file)} → ${spec} (${from} не может зависеть от ${to})`);
        }
      } else if ((from === 'core' || from === 'shared') && !CORE_PACKAGES.includes(spec)) {
        violations.push(
          `${relative(ROOT, file)} → ${spec} (в ${from} разрешены только ${CORE_PACKAGES})`,
        );
      }
    }
  }
  assertEquals(violations, []);
});

Deno.test('architecture: ядро чистое — без I/O, Date.now(), any и as', async () => {
  const banned: [RegExp, string][] = [
    [/\bDate\.now\(|new Date\(\s*\)/, 'время только через Clock'],
    [/\bDeno\.|\bfetch\(/, 'I/O запрещён в core'],
    [/:\s*any\b|<any>|\bas\s+any\b/, 'any запрещён'],
    [/\bas\s+(?!const\b)[A-Za-z{[(]/, 'приведение типов (as) запрещено в core'],
  ];
  const violations: string[] = [];
  for (const file of await sourceFiles(join(SRC, 'core'))) {
    const lines = (await Deno.readTextFile(file)).split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const [re, why] of banned) {
        if (re.test(line)) {
          violations.push(`${relative(ROOT, file)}:${i + 1} ${why}: ${line.trim()}`);
        }
      }
    });
  }
  assertEquals(violations, []);
});

Deno.test('architecture: точка входа функции импортирует только app/', async () => {
  const entry = join(ROOT, 'supabase/functions/bot/index.ts');
  const code = await Deno.readTextFile(entry);
  const bad = [...code.matchAll(IMPORT_RE)]
    .map((m) => m[1] ?? m[2] ?? '')
    .filter((s) => s.startsWith('.') && layerOf(resolve(dirname(entry), s)) !== 'app');
  assertEquals(bad, []);
});
