import { assert, assertEquals } from '@std/assert';
import { dirname, join, resolve } from '@std/path';
import { convertProgram } from '../../src/features/program/convert.ts';
import { answer, down, scriptedLlm } from '../support/llm.ts';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const { draft } = JSON.parse(
  await Deno.readTextFile(join(ROOT, 'tests/fixtures/program-draft.json')),
);

Deno.test('конвертация: черновик → программа; в запросе строгая схема без служебных полей', async () => {
  const llm = scriptedLlm(answer(draft));
  const { outcome, replies } = await convertProgram(llm, 'Понедельник: присед 3х5');
  assert(outcome.ok);
  assertEquals(outcome.program.rotation.length, 3);
  assertEquals(outcome.unparsed, ['Отдых между подходами 2-3 минуты.']);
  assertEquals(replies.length, 1);
  const schema = JSON.stringify(llm.requests[0]?.schema);
  assert(!schema.includes('readOnly') && !schema.includes('$schema'), schema);
  assert(schema.includes('"additionalProperties":false'));
  assertEquals(llm.requests[0]?.user, 'Понедельник: присед 3х5');
});

Deno.test('конвертация: мусор или пустой черновик — один повтор', async () => {
  const empty = { name: '', days: [], unparsed: [] };
  const ok = await convertProgram(scriptedLlm(answer('не json'), answer(draft)), 'текст');
  assert(ok.outcome.ok);
  assertEquals(ok.replies.length, 2);
  const failed = await convertProgram(scriptedLlm(answer(empty), answer(empty)), 'текст');
  assertEquals(failed.outcome, { ok: false, reason: 'not_understood' });
  assertEquals(failed.replies.length, 2);
});

Deno.test('конвертация: LLM недоступна — без повтора', async () => {
  const r = await convertProgram(scriptedLlm(down), 'текст');
  assertEquals(r.outcome, { ok: false, reason: 'unavailable' });
  assertEquals(r.replies.length, 1);
});
