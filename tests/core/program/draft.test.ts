import { assert, assertEquals } from '@std/assert';
import { dirname, join, resolve } from '@std/path';
import { z } from 'zod';
import { ProgramDraftSchema, programFromDraft } from '../../../src/core/program/draft.ts';
import { dayExercises } from '../../../src/core/program/program.ts';
import type { Exercise, Program } from '../../../src/core/program/schema.ts';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../../..');
const FixtureSchema = z.object({
  draft: ProgramDraftSchema,
  expected: z.object({
    name: z.string(),
    rotation: z.array(z.string()),
    days: z.array(z.string()),
  }),
});
const fixture = FixtureSchema.parse(
  JSON.parse(await Deno.readTextFile(join(ROOT, 'tests/fixtures/program-draft.json'))),
);

const range = (r: { min: number; max: number }): string =>
  r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`;
const goal = (e: Exercise): string =>
  'repRange' in e ? `${range(e.workSets)}×${range(e.repRange)}` : `${range(e.workSets)} подхода`;
const describe = (p: Program): string[] =>
  p.rotation.map((id) => {
    const day = p.days.find((d) => d.id === id);
    const items = dayExercises(p, id).map((e) =>
      `${e.name} ${goal(e)}${e.notes ? ` (${e.notes})` : ''}`
    );
    return `${day?.name}: ${items.join('; ')}`;
  });

Deno.test('черновик → программа: контрольный пример из спеки', () => {
  const r = programFromDraft(fixture.draft);
  assert(r.ok);
  assertEquals(r.value.name, fixture.expected.name);
  assertEquals(r.value.rotation, fixture.expected.rotation);
  assertEquals(describe(r.value), fixture.expected.days);
});

Deno.test('черновик → программа: повтор упражнения — ссылка, id и разминка как у редактора', () => {
  const r = programFromDraft(fixture.draft);
  assert(r.ok);
  const p = r.value;
  assertEquals(p.id, 'custom');
  assertEquals(p.days[2]?.exercises[0], { id: 'ex_1', ref: true });
  const squat = p.days[0]?.exercises[0];
  assert(squat && !('ref' in squat));
  assertEquals([squat.id, squat.warmup, squat.isBase], ['ex_1', 'tiers', false]);
  assert(p.addedWeightTiers, 'для упражнений с допвесом');
});

Deno.test('черновик без упражнений — empty', () => {
  const empty = { name: 'x', days: [{ name: 'Пн', exercises: [] }], unparsed: [] };
  assertEquals(programFromDraft(empty), { ok: false, error: 'empty' });
});
