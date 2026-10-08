import { assertEquals } from '@std/assert';
import { walk } from '@std/fs';
import { dirname, join, relative, resolve } from '@std/path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const SKIP_DIRS = [/node_modules/, /\.git\//, /supabase\/\.temp/];

const ROOT_PATH_RE =
  /(?<![\w./-])((?:src|tests|supabase|docs|\.specs|\.claude|\.github)\/[A-Za-z0-9_./-]*)/g;
const LINK_RE = /\]\(([^)#\s]+)(?:#[^)]*)?\)/g;

async function markdownFiles(): Promise<string[]> {
  const files: string[] = [];
  for await (const e of walk(ROOT, { exts: ['.md'], includeDirs: false, skip: SKIP_DIRS })) {
    files.push(e.path);
  }
  return files;
}

async function prose(file: string): Promise<string> {
  return (await Deno.readTextFile(file)).replace(/```[\s\S]*?```/g, '');
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
};

Deno.test('docs: пути к файлам в документах существуют', async () => {
  const broken: string[] = [];
  for (const file of await markdownFiles()) {
    const text = await prose(file);
    const where = relative(ROOT, file);
    for (const m of text.matchAll(ROOT_PATH_RE)) {
      const path = (m[1] ?? '').replace(/[.,:;]+$/, '');
      if (!(await exists(join(ROOT, path)))) broken.push(`${where}: ${path}`);
    }
    for (const m of text.matchAll(LINK_RE)) {
      const link = m[1] ?? '';
      if (/^[a-z]+:/i.test(link)) continue;
      if (!(await exists(resolve(dirname(file), link)))) broken.push(`${where}: (${link})`);
    }
  }
  assertEquals(broken, []);
});

Deno.test('docs: ADR и спецификации не ссылаются на код', async () => {
  const offenders: string[] = [];
  for (const file of await markdownFiles()) {
    const where = relative(ROOT, file);
    if (!/^(docs\/adr|\.specs)\//.test(where)) continue;
    const text = await prose(file);
    for (const m of text.matchAll(/(?<![\w./-])((?:src|supabase\/functions)\/[A-Za-z0-9_./-]*)/g)) {
      offenders.push(`${where}: ${m[1]}`);
    }
  }
  assertEquals(offenders, []);
});
