import { z } from 'zod';
import type { LastResult } from '../history/schema.ts';
import {
  type Exercise,
  type Intensity,
  IntensitySchema,
  LoadTypeSchema,
  type Program,
} from '../program/schema.ts';
import { weightGrid } from '../program/weight-step.ts';
import type { Settings } from '../settings/settings.ts';
import { type Lb, LbSchema } from '../units/lb.ts';
import { nearbyWeights, nextAbove, type WeightGrid } from '../units/weight-grid.ts';
import {
  addedWeightWarmup,
  fixedWarmup,
  lowIntensityWorkLb,
  tieredWarmup,
} from '../warmup/warmup.ts';

/** Как упражнение подаётся на тренировке: вес, кнопки, разминка (.specs/product.md → US-3). */

/** Пара 100/70, в которую входит упражнение. */
export const pairOf = (
  program: Program,
  exerciseId: string,
): Program['intensityPairs'][number] | undefined =>
  program.intensityPairs.find((p) => p.exercises.includes(exerciseId));

/**
 * Предложенный рабочий вес. Для пары 100/70: на 100% — последний вес на 100%, на 70% —
 * 70% от него с округлением (§6.4, правило 5). Иначе — прошлый раз. Истории нет — null.
 */
export function suggestedWeight(
  exercise: Exercise,
  program: Program,
  settings: Settings,
  last: LastResult | null,
  lastHighLb: Lb | null,
  intensity: Intensity | null,
): Lb | null {
  const grid = weightGrid(exercise, settings);
  if (grid === null) return null;
  const pair = pairOf(program, exercise.id);
  if (pair && intensity !== null && lastHighLb !== null) {
    return intensity === IntensitySchema.enum.low
      ? lowIntensityWorkLb(lastHighLb, pair.lowPct, grid)
      : lastHighLb;
  }
  return last?.weightLb ?? null;
}

/** Кнопки веса: предложенный, +шаг, −шаг (US-3, шаг 1). */
export function weightOptions(grid: WeightGrid, base: Lb): readonly Lb[] {
  const up = nextAbove(grid, base);
  const below = nearbyWeights(grid, base - 1e-6).lower;
  const options = [base, up];
  if (below !== null && below < base && below >= 0) options.push(below);
  return options;
}

/** Сколько кнопок повторений показывать (US-3, шаг 3). */
const REP_BUTTONS = 8;

/**
 * Кнопки повторений — 8 чисел подряд, без пропусков: от ориентира −3. Ориентир — прошлый подход
 * в этой тренировке, для первого — прошлый результат, без истории — начало диапазона.
 */
export function repOptions(
  range: { readonly min: number; readonly max: number } | null,
  anchor: number | null,
): readonly number[] {
  const around = anchor ?? range?.min ?? 10;
  const from = Math.max(1, around - 3);
  return Array.from({ length: REP_BUTTONS }, (_, i) => from + i);
}

export const WarmupLineLabelSchema = z.enum([
  'regular',
  'empty_bar',
  'overload',
  'bodyweight',
  'assisted',
]);

/** Строка разминки для экрана и записи: вес (для допвеса — допвес), повторения, вес на сторону. */
export const WarmupLineSchema = z.object({
  weightLb: LbSchema,
  reps: z.number().int().positive(),
  perSideLb: LbSchema.nullable(),
  label: WarmupLineLabelSchema,
}).readonly();
export type WarmupLine = z.infer<typeof WarmupLineSchema>;

export const WarmupForExerciseSchema = z.object({
  tier: z.number().int().nonnegative().nullable(),
  lines: z.array(WarmupLineSchema).readonly(),
}).readonly();
export type WarmupForExercise = z.infer<typeof WarmupForExerciseSchema>;

/** Разминка к рабочему весу; null — у упражнения разминки нет (пресс, шея, warmup: null). */
export function warmupFor(
  exercise: Exercise,
  program: Program,
  settings: Settings,
  workLb: Lb,
  intensity: Intensity | null,
): WarmupForExercise | null {
  const grid = weightGrid(exercise, settings);
  if (grid === null || exercise.warmup === null) return null;
  const input = {
    workLb,
    isBase: exercise.isBase,
    intensity: intensity ?? IntensitySchema.enum.high,
  };

  if (exercise.loadType === LoadTypeSchema.enum.weighted_bodyweight) {
    if (!program.addedWeightTiers || grid.kind !== 'step') return null;
    const plan = addedWeightWarmup(workLb, program.addedWeightTiers, grid.stepLb, exercise.isBase);
    return {
      tier: plan.tier,
      lines: plan.sets.map((s) => ({
        weightLb: s.addedLb,
        reps: s.reps,
        perSideLb: null,
        label: s.label,
      })),
    };
  }
  const plan = exercise.warmup === 'tiers'
    ? tieredWarmup(input, program.warmupTiers, grid)
    : fixedWarmup(
      input,
      program.fixedSchemes[exercise.warmup]?.steps ?? [],
      program.warmupTiers.overloadSingle,
      grid,
    );
  return { tier: plan.tier, lines: plan.sets.map((s) => ({ ...s })) };
}
