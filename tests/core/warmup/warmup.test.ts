import { assertEquals } from '@std/assert';
import { dirname, join, resolve } from '@std/path';
import { z } from 'zod';
import { lb, LbSchema } from '../../../src/core/units/lb.ts';
import type { WeightGrid } from '../../../src/core/units/weight-grid.ts';
import { IntensitySchema } from '../../../src/core/program/schema.ts';
import {
  addedWeightWarmup,
  fixedWarmup,
  lowIntensityWorkLb,
  tieredWarmup,
} from '../../../src/core/warmup/warmup.ts';
import { specProgram } from '../../support/spec.ts';

/** Контрольные примеры .specs/warmup.md §6.2–6.3 — данные в tests/fixtures/. */
const FixtureSchema = z.object({
  barbell: z.array(z.object({
    name: z.string(),
    barLb: LbSchema,
    platesLb: z.array(LbSchema),
    workLb: LbSchema,
    lastHighLb: LbSchema.optional(),
    isBase: z.boolean(),
    intensity: IntensitySchema,
    expected: z.array(z.object({ weightLb: LbSchema, reps: z.number(), perSideLb: LbSchema })),
  })),
  addedWeight: z.array(z.object({
    name: z.string(),
    stepLb: LbSchema,
    addedLb: LbSchema,
    expected: z.array(z.object({ addedLb: LbSchema, reps: z.number() })),
    afterWork: z.object({ addedLb: z.literal(0), reps: z.union([z.literal('max'), z.number()]) })
      .nullable(),
  })),
});

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../../..');
const fixtures = FixtureSchema.parse(
  JSON.parse(await Deno.readTextFile(join(ROOT, 'tests/fixtures/warmup-cases.json'))),
);
const program = await specProgram();

for (const c of fixtures.barbell) {
  Deno.test(`разминка штанги: ${c.name}`, () => {
    const grid: WeightGrid = { kind: 'plates', barLb: c.barLb, platesLb: c.platesLb };
    if (c.lastHighLb !== undefined) {
      const pair = program.intensityPairs[0];
      assertEquals(
        lowIntensityWorkLb(c.lastHighLb, pair?.lowPct ?? 0, grid),
        c.workLb,
        'вес на 70%',
      );
    }
    const plan = tieredWarmup(c, program.warmupTiers, grid);
    assertEquals(
      plan.sets.map((s) => ({ weightLb: s.weightLb, reps: s.reps, perSideLb: s.perSideLb })),
      c.expected,
    );
  });
}

for (const c of fixtures.addedWeight) {
  Deno.test(`разминка с допвесом: ${c.name}`, () => {
    const tiers = program.addedWeightTiers;
    if (!tiers) throw new Error('в программе нет addedWeightTiers');
    const plan = addedWeightWarmup(c.addedLb, tiers, c.stepLb, true);
    assertEquals(plan.sets.map((s) => ({ addedLb: s.addedLb, reps: s.reps })), c.expected);
    assertEquals(
      plan.afterWork && { addedLb: 0, reps: plan.afterWork.reps },
      c.afterWork,
    );
  });
}

const standard: WeightGrid = {
  kind: 'plates',
  barLb: lb(45),
  platesLb: [5, 10, 25, 35, 45].map(lb),
};
const high = IntensitySchema.enum.high;

Deno.test('метки: пустой гриф и перегрузочный сингл; номер ступени', () => {
  const plan = tieredWarmup(
    { workLb: lb(95), isBase: true, intensity: high },
    program.warmupTiers,
    standard,
  );
  assertEquals(plan.tier, 1);
  assertEquals(plan.sets.map((s) => s.label), ['empty_bar', 'regular', 'overload']);
  assertEquals(
    tieredWarmup({ workLb: lb(315), isBase: true, intensity: high }, program.warmupTiers, standard)
      .tier,
    3,
  );
});

Deno.test('сингл только в базовых упражнениях', () => {
  const plan = tieredWarmup(
    { workLb: lb(195), isBase: false, intensity: high },
    program.warmupTiers,
    standard,
  );
  assertEquals(plan.sets.map((s) => s.weightLb), [85, 135, 165]);
});

Deno.test('фиксированная схема тренажёра: икры 50%×10 · 80%×10, шаг 5', () => {
  const scheme = program.fixedSchemes['calves'];
  const plan = fixedWarmup(
    { workLb: lb(180), isBase: false, intensity: high },
    scheme?.steps ?? [],
    program.warmupTiers.overloadSingle,
    { kind: 'step', stepLb: lb(5) },
  );
  assertEquals(plan, {
    tier: null,
    sets: [
      { weightLb: lb(90), reps: 10, label: 'regular', perSideLb: null },
      { weightLb: lb(145), reps: 10, label: 'regular', perSideLb: null },
    ],
  });
});

Deno.test('тренажёр с малым весом: ступени не ниже шага, дубли схлопываются', () => {
  const plan = tieredWarmup(
    { workLb: lb(10), isBase: false, intensity: high },
    program.warmupTiers,
    { kind: 'step', stepLb: lb(5) },
  );
  assertEquals(plan.sets.map((s) => [s.weightLb, s.reps]), [[5, 8]]);
});

Deno.test('допвес 0: подход с помощью и второй рабочий своим весом', () => {
  const tiers = program.addedWeightTiers;
  if (!tiers) throw new Error('нет addedWeightTiers');
  const plan = addedWeightWarmup(lb(0), tiers, lb(5), true);
  assertEquals(plan, {
    tier: 0,
    sets: [{ addedLb: lb(0), reps: 12, label: 'assisted' }],
    afterWork: { bodyweight: true, reps: 'max' },
  });
});
