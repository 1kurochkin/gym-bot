import { assert, assertEquals } from '@std/assert';
import { walk } from '@std/fs';
import { dirname, relative, resolve } from '@std/path';
import { parse } from '@std/yaml';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const WORKFLOWS = resolve(ROOT, '.github/workflows');

type Workflow = { on?: unknown; jobs?: Record<string, unknown> };

async function workflows(): Promise<[string, Workflow][]> {
  const result: [string, Workflow][] = [];
  for await (const e of walk(WORKFLOWS, { exts: ['.yml', '.yaml'], includeDirs: false })) {
    const where = relative(ROOT, e.path);
    let doc: unknown;
    try {
      doc = parse(await Deno.readTextFile(e.path));
    } catch (err) {
      throw new Error(`${where}: невалидный YAML — ${(err as Error).message.split('\n')[0]}`);
    }
    result.push([where, doc as Workflow]);
  }
  return result;
}

Deno.test('workflows: YAML разбирается, есть триггеры и jobs', async () => {
  const all = await workflows();
  assert(all.length > 0, 'нет ни одного workflow');
  for (const [where, wf] of all) {
    assert(wf.on, `${where}: нет триггеров (on)`);
    assert(wf.jobs && Object.keys(wf.jobs).length > 0, `${where}: нет jobs`);
  }
});

Deno.test('workflows: бэкап можно запустить вручную и по расписанию', async () => {
  const backup = (await workflows()).find(([where]) => where.endsWith('backup.yml'))?.[1];
  const triggers = Object.keys((backup?.on ?? {}) as Record<string, unknown>).sort();
  assertEquals(triggers, ['schedule', 'workflow_dispatch']);
});
