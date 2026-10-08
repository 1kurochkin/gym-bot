import { dirname, join, resolve } from '@std/path';
import { parseProgram } from '../../src/core/program/program.ts';
import type { Program } from '../../src/core/program/schema.ts';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');

export async function specProgramJson(): Promise<unknown> {
  const md = await Deno.readTextFile(join(ROOT, '.specs/program-format.md'));
  const block = /```json\n([\s\S]*?)```/.exec(md)?.[1];
  if (!block) throw new Error('в .specs/program-format.md нет блока ```json');
  return JSON.parse(block);
}

export async function specProgram(): Promise<Program> {
  const r = parseProgram(await specProgramJson());
  if (!r.ok) throw new Error(`программа из спеки невалидна: ${JSON.stringify(r.error)}`);
  return r.value;
}
