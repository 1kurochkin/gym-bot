import { z } from 'zod';
import { type Lb, lb, LbSchema } from '../units/lb.ts';
import {
  lowestWeight,
  nextAbove,
  perSide,
  roundToGrid,
  type WeightGrid,
} from '../units/weight-grid.ts';
import {
  type AddedWeightTiers,
  AfterWorkSchema,
  type OverloadSingle,
  type WarmupStep,
  type WarmupTiers,
} from '../program/schema.ts';

export const WarmupLabelSchema = z.enum(['regular', 'empty_bar', 'overload']);
export type WarmupLabel = z.infer<typeof WarmupLabelSchema>;

export const WarmupSetSchema = z.object({
  weightLb: LbSchema,
  reps: z.number().int().positive(),
  label: WarmupLabelSchema,
  perSideLb: LbSchema.nullable(),
}).readonly();
export type WarmupSet = z.infer<typeof WarmupSetSchema>;

export const WarmupPlanSchema = z.object({
  tier: z.number().int().positive().nullable(),
  sets: z.array(WarmupSetSchema).readonly(),
}).readonly();
export type WarmupPlan = z.infer<typeof WarmupPlanSchema>;

const { regular, empty_bar, overload } = WarmupLabelSchema.enum;

export function selectTier(
  tiers: WarmupTiers,
  workLb: Lb,
): { tier: number; steps: readonly WarmupStep[] } {
  let index = 0;
  tiers.byWorkWeight.forEach((t, i) => {
    if (t.minLb <= workLb) index = i;
  });
  return { tier: index + 1, steps: tiers.byWorkWeight[index]?.steps ?? [] };
}

export function singleApplies(single: OverloadSingle | undefined, isBase: boolean): boolean {
  if (!single) return false;
  return !(single.onlyBase && !isBase);
}

export function buildLadder(
  workLb: Lb,
  steps: readonly WarmupStep[],
  single: OverloadSingle | null,
  grid: WeightGrid,
): readonly WarmupSet[] {
  const all = single ? [...steps, { pct: single.pct, reps: single.reps }] : steps;
  const sets: WarmupSet[] = [];
  for (const s of all) {
    let weight = roundToGrid(grid, workLb * s.pct);
    if (s.pct < 1 && weight >= workLb) continue;
    if (s.pct > 1 && weight <= workLb) weight = nextAbove(grid, workLb);
    if (sets.some((prev) => prev.weightLb === weight)) continue;
    const label = s.pct > 1
      ? overload
      : grid.kind === 'plates' && weight === lowestWeight(grid)
      ? empty_bar
      : regular;
    sets.push({ weightLb: weight, reps: s.reps, label, perSideLb: perSide(grid, weight) });
  }
  return sets.sort((a, b) => a.weightLb - b.weightLb);
}

export const WorkWeightWarmupInputSchema = z.object({
  workLb: LbSchema,
  isBase: z.boolean(),
}).readonly();
export type WorkWeightWarmupInput = z.infer<typeof WorkWeightWarmupInputSchema>;

export function tieredWarmup(
  input: WorkWeightWarmupInput,
  tiers: WarmupTiers,
  grid: WeightGrid,
): WarmupPlan {
  const { tier, steps } = selectTier(tiers, input.workLb);
  const single = singleApplies(tiers.overloadSingle, input.isBase)
    ? tiers.overloadSingle ?? null
    : null;
  return { tier, sets: buildLadder(input.workLb, steps, single, grid) };
}

export function fixedWarmup(
  input: WorkWeightWarmupInput,
  steps: readonly WarmupStep[],
  single: OverloadSingle | undefined,
  grid: WeightGrid,
): WarmupPlan {
  const applied = singleApplies(single, input.isBase) ? single ?? null : null;
  return { tier: null, sets: buildLadder(input.workLb, steps, applied, grid) };
}

export const AddedWarmupLabelSchema = z.enum(['assisted', 'bodyweight', 'regular', 'overload']);
export type AddedWarmupLabel = z.infer<typeof AddedWarmupLabelSchema>;

export const AddedWarmupSetSchema = z.object({
  addedLb: LbSchema,
  reps: z.number().int().positive(),
  label: AddedWarmupLabelSchema,
}).readonly();
export type AddedWarmupSet = z.infer<typeof AddedWarmupSetSchema>;

export const AddedWarmupPlanSchema = z.object({
  tier: z.number().int().nonnegative(),
  sets: z.array(AddedWarmupSetSchema).readonly(),
  afterWork: AfterWorkSchema.nullable(),
}).readonly();
export type AddedWarmupPlan = z.infer<typeof AddedWarmupPlanSchema>;

const added = AddedWarmupLabelSchema.enum;

export function addedWeightWarmup(
  addedLb: Lb,
  tiers: AddedWeightTiers,
  stepLb: Lb,
  isBase: boolean,
): AddedWarmupPlan {
  if (addedLb === 0) {
    return {
      tier: 0,
      sets: tiers.zero.steps.map((s) => ({ addedLb: lb(0), reps: s.reps, label: added.assisted })),
      afterWork: tiers.zero.afterWork ?? null,
    };
  }
  let index = 0;
  tiers.byAddedWeight.forEach((t, i) => {
    if (t.minLb <= addedLb) index = i;
  });
  const tier = tiers.byAddedWeight[index];
  const grid: WeightGrid = { kind: 'step', stepLb };
  const sets: AddedWarmupSet[] = [];
  const push = (weight: Lb, reps: number, label: AddedWarmupLabel): void => {
    if (!sets.some((s) => s.addedLb === weight)) sets.push({ addedLb: weight, reps, label });
  };
  for (const s of tier?.steps ?? []) {
    if (s.pct === 0) {
      push(lb(0), s.reps, added.bodyweight);
      continue;
    }
    const weight = roundToGrid(grid, addedLb * s.pct);
    if (weight < addedLb) push(weight, s.reps, added.regular);
  }
  const single = tiers.overloadSingle;
  if (isBase && addedLb >= single.minAddedLb) {
    const rounded = roundToGrid(grid, addedLb * single.pct);
    push(rounded > addedLb ? rounded : nextAbove(grid, addedLb), single.reps, added.overload);
  }
  return { tier: index + 1, sets, afterWork: tier?.afterWork ?? null };
}
