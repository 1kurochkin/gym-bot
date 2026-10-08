import { z } from 'zod';
import type { LastResult } from '../history/schema.ts';
import { type Exercise, LoadTypeSchema, type Program } from '../program/schema.ts';
import { weightGrid } from '../program/weight-step.ts';
import type { Settings } from '../settings/settings.ts';
import { type Lb, LbSchema } from '../units/lb.ts';
import { nearbyWeights, nextAbove, type WeightGrid } from '../units/weight-grid.ts';
import { addedWeightWarmup, fixedWarmup, tieredWarmup } from '../warmup/warmup.ts';

export function suggestedWeight(
  exercise: Exercise,
  settings: Settings,
  last: LastResult | null,
): Lb | null {
  if (weightGrid(exercise, settings) === null) return null;
  return last?.weightLb ?? null;
}

export function weightOptions(grid: WeightGrid, base: Lb): readonly Lb[] {
  const up = nextAbove(grid, base);
  const below = nearbyWeights(grid, base - 1e-6).lower;
  const options = [base, up];
  if (below !== null && below < base && below >= 0) options.push(below);
  return options;
}

const REP_BUTTONS = 8;

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

export function warmupFor(
  exercise: Exercise,
  program: Program,
  settings: Settings,
  workLb: Lb,
): WarmupForExercise | null {
  const grid = weightGrid(exercise, settings);
  if (grid === null || exercise.warmup === null) return null;
  const input = { workLb, isBase: exercise.isBase };

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
