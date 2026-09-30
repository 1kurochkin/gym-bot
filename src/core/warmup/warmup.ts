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
  type Intensity,
  IntensitySchema,
  type OverloadSingle,
  type WarmupStep,
  type WarmupTiers,
} from '../program/schema.ts';

/** Разминка от рабочего веса — штанга и тренажёры (.specs/warmup.md §6.2). */

export const WarmupLabelSchema = z.enum(['regular', 'empty_bar', 'overload']);
export type WarmupLabel = z.infer<typeof WarmupLabelSchema>;

export const WarmupSetSchema = z.object({
  weightLb: LbSchema,
  reps: z.number().int().positive(),
  label: WarmupLabelSchema,
  /** Вес на сторону грифа; для тренажёра — null. */
  perSideLb: LbSchema.nullable(),
}).readonly();
export type WarmupSet = z.infer<typeof WarmupSetSchema>;

export const WarmupPlanSchema = z.object({
  /** Номер ступени с 1 (пишется в лог как warmupTier); null — фиксированная схема. */
  tier: z.number().int().positive().nullable(),
  sets: z.array(WarmupSetSchema).readonly(),
}).readonly();
export type WarmupPlan = z.infer<typeof WarmupPlanSchema>;

const { low } = IntensitySchema.enum;
const { regular, empty_bar, overload } = WarmupLabelSchema.enum;

/** Ступень по рабочему весу: последняя, чей порог ≤ W. Номер — с 1. */
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

/** Применяется ли перегрузочный сингл (ADR-0003): только базовые, не в день на 70%. */
export function singleApplies(
  single: OverloadSingle | undefined,
  isBase: boolean,
  intensity: Intensity,
): boolean {
  if (!single) return false;
  if (single.onlyBase && !isBase) return false;
  return !(intensity === low && single.skipOnLowIntensity);
}

/**
 * Разминочная лесенка к рабочему весу W по шагам в процентах (§6.2, правила 2–7):
 * округление к сетке весов, пустой гриф снизу, шаги ≥ W выбрасываются, сингл — выше W,
 * дубли схлопываются, в день на 70% шаги выше 100% пропускаются.
 */
export function buildLadder(
  workLb: Lb,
  steps: readonly WarmupStep[],
  single: OverloadSingle | null,
  intensity: Intensity,
  grid: WeightGrid,
): readonly WarmupSet[] {
  const all = single ? [...steps, { pct: single.pct, reps: single.reps }] : steps;
  const sets: WarmupSet[] = [];
  for (const s of all) {
    if (s.pct > 1 && intensity === low) continue;
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
  intensity: IntensitySchema,
}).readonly();
export type WorkWeightWarmupInput = z.infer<typeof WorkWeightWarmupInputSchema>;

/** Разминка по ступеням программы. */
export function tieredWarmup(
  input: WorkWeightWarmupInput,
  tiers: WarmupTiers,
  grid: WeightGrid,
): WarmupPlan {
  const { tier, steps } = selectTier(tiers, input.workLb);
  const single = singleApplies(tiers.overloadSingle, input.isBase, input.intensity)
    ? tiers.overloadSingle ?? null
    : null;
  return { tier, sets: buildLadder(input.workLb, steps, single, input.intensity, grid) };
}

/** Разминка по фиксированной схеме упражнения (икры: 50%×10 · 80%×10) — вместо ступеней. */
export function fixedWarmup(
  input: WorkWeightWarmupInput,
  steps: readonly WarmupStep[],
  single: OverloadSingle | undefined,
  grid: WeightGrid,
): WarmupPlan {
  const applied = singleApplies(single, input.isBase, input.intensity) ? single ?? null : null;
  return { tier: null, sets: buildLadder(input.workLb, steps, applied, input.intensity, grid) };
}

/**
 * Рабочий вес по умолчанию для дня на 70% (§6.4, правило 5):
 * доля от последнего веса с intensity = high, округлённая к сетке.
 */
export const lowIntensityWorkLb = (lastHighLb: Lb, lowPct: number, grid: WeightGrid): Lb =>
  roundToGrid(grid, lastHighLb * lowPct);

// ---------------------------------------------------------------- допвес (§6.3)

export const AddedWarmupLabelSchema = z.enum(['assisted', 'bodyweight', 'regular', 'overload']);
export type AddedWarmupLabel = z.infer<typeof AddedWarmupLabelSchema>;

export const AddedWarmupSetSchema = z.object({
  /** Допвес на поясе; 0 — свой вес. */
  addedLb: LbSchema,
  reps: z.number().int().positive(),
  label: AddedWarmupLabelSchema,
}).readonly();
export type AddedWarmupSet = z.infer<typeof AddedWarmupSetSchema>;

export const AddedWarmupPlanSchema = z.object({
  /** 0 — ступень «без допвеса», дальше номера с 1. */
  tier: z.number().int().nonnegative(),
  sets: z.array(AddedWarmupSetSchema).readonly(),
  /** Подход со своим весом после рабочего; null — не нужен. */
  afterWork: AfterWorkSchema.nullable(),
}).readonly();
export type AddedWarmupPlan = z.infer<typeof AddedWarmupPlanSchema>;

const added = AddedWarmupLabelSchema.enum;

/**
 * Разминка для брусьев и подтягиваний: первая ступень — свой вес, проценты — от допвеса A,
 * округление до шага. Сингл — от minAddedLb и только в базовых.
 */
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
