import { z } from 'zod';
import { type Lb, lb, LbSchema } from './lb.ts';

export const WeightGridSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('plates'),
    barLb: LbSchema,
    platesLb: z.array(LbSchema.refine((v) => v > 0)).min(1).readonly(),
  }).readonly(),
  z.object({ kind: z.literal('step'), stepLb: LbSchema.refine((v) => v > 0) }).readonly(),
]);
export type WeightGrid = z.infer<typeof WeightGridSchema>;

export const NearbyWeightsSchema = z.object({
  lower: LbSchema.nullable(),
  upper: LbSchema.nullable(),
})
  .readonly();
export type NearbyWeights = z.infer<typeof NearbyWeightsSchema>;

const MAX_PER_SIDE_LB = 400;
const UNITS_PER_LB = 4;
const EPS = 1e-9;

const toUnits = (w: number): number => Math.round(w * UNITS_PER_LB);
const fromUnits = (u: number): Lb => lb(u / UNITS_PER_LB);

export function barbellWeights(barLb: Lb, platesLb: readonly Lb[]): readonly Lb[] {
  const limit = toUnits(MAX_PER_SIDE_LB);
  const plates = platesLb.map(toUnits);
  const reachable = new Array<boolean>(limit + 1).fill(false);
  reachable[0] = true;
  for (let sum = 1; sum <= limit; sum++) {
    reachable[sum] = plates.some((p) => p <= sum && reachable[sum - p] === true);
  }
  const bar = toUnits(barLb);
  const weights: Lb[] = [];
  reachable.forEach((ok, side) => {
    if (ok) weights.push(fromUnits(bar + 2 * side));
  });
  return weights;
}

export const lowestWeight = (grid: WeightGrid): Lb =>
  grid.kind === 'plates' ? grid.barLb : grid.stepLb;

export function nearbyWeights(grid: WeightGrid, target: number): NearbyWeights {
  if (grid.kind === 'step') {
    const q = target / grid.stepLb;
    const lower = Math.floor(q + EPS) * grid.stepLb;
    const upper = Math.abs(lower - target) < EPS ? lower : lower + grid.stepLb;
    return { lower: lower >= 0 ? lb(lower) : null, upper: lb(upper) };
  }
  const weights = barbellWeights(grid.barLb, grid.platesLb);
  let lower: Lb | null = null;
  let upper: Lb | null = null;
  for (const w of weights) {
    if (w <= target + EPS) lower = w;
    if (w >= target - EPS) {
      upper = w;
      break;
    }
  }
  return { lower, upper };
}

export function roundToGrid(grid: WeightGrid, target: number): Lb {
  const { lower, upper } = nearbyWeights(grid, target);
  const floor = lowestWeight(grid);
  if (lower === null) return upper ?? floor;
  if (upper === null) return lower;
  const nearest = target - lower <= upper - target + EPS ? lower : upper;
  return nearest < floor ? floor : nearest;
}

export function nextAbove(grid: WeightGrid, weight: number): Lb {
  const { upper } = nearbyWeights(grid, weight + EPS * 10);
  return upper ?? lb(weight);
}

export const perSide = (grid: WeightGrid, weight: Lb): Lb | null =>
  grid.kind === 'plates' && weight >= grid.barLb ? lb((weight - grid.barLb) / 2) : null;

export function unachievable(grid: WeightGrid, weight: number): NearbyWeights | null {
  const near = nearbyWeights(grid, weight);
  const exact = near.lower !== null && Math.abs(near.lower - weight) < EPS;
  return exact ? null : near;
}
