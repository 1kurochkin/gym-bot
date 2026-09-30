import { z } from 'zod';
import { err, ok, type Result } from '../../shared/result.ts';
import { LoadTypeSchema } from '../program/schema.ts';
import { lb, LbSchema } from '../units/lb.ts';

/**
 * Разбор ввода подхода с учётом контекста (.specs/product.md → «Ввод свободным текстом»):
 * бот уже предложил вес, поэтому «7» — это 7 повторений с ним, а «185x6» — свой вес.
 */

export const SetInputContextSchema = z.object({
  loadType: LoadTypeSchema,
  /** Вес, который бот предложил для подхода; null — пока не знает (нет истории). */
  suggestedLb: LbSchema.nullable(),
}).readonly();
export type SetInputContext = z.infer<typeof SetInputContextSchema>;

export const WeightSourceSchema = z.enum(['suggested', 'entered', 'none']);

export const ParsedSetSchema = z.object({
  /** Вес подхода; для weighted_bodyweight — допвес; для reps_only — null. */
  weightLb: LbSchema.nullable(),
  reps: z.number().int().min(1).max(100),
  weightSource: WeightSourceSchema,
  /** Текст после чисел — комментарий к упражнению. */
  comment: z.string().nullable(),
}).readonly();
export type ParsedSet = z.infer<typeof ParsedSetSchema>;

export const SetInputErrorSchema = z.enum([
  'empty',
  'not_recognized',
  'reps_required',
  'reps_out_of_range',
  'weight_out_of_range',
  'weight_required',
  'weight_not_allowed',
]);
export type SetInputError = z.infer<typeof SetInputErrorSchema>;

const E = SetInputErrorSchema.enum;
const W = WeightSourceSchema.enum;

const MAX_REPS = 100;
const MAX_WEIGHT_LB = 1500;

const SEP = '[xXхХ×*/]';
const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
/** Вес и повторения: «185x6», «185/6», «185 х 6», «+25x8», «185 6». */
const WEIGHT_REPS = new RegExp(String.raw`^(\+)?${NUM}\s*(?:${SEP}\s*|\s+)(\d+)(?=\s|$)`);
/** Только повторения, явно: «x7». */
const X_REPS = new RegExp(String.raw`^${SEP}\s*(\d+)(?=\s|$)`);
/** Одно число: «7» — повторения; «+25», «182,5» — вес без повторений. */
const SINGLE = new RegExp(String.raw`^(\+)?${NUM}(?=\s|$)`);

type Raw = { readonly weight: string | null; readonly reps: string; readonly rest: string };

function match(text: string): Raw | 'reps_required' | null {
  const wr = WEIGHT_REPS.exec(text);
  if (wr) return { weight: wr[2] ?? '', reps: wr[3] ?? '', rest: text.slice(wr[0].length) };
  const xr = X_REPS.exec(text);
  if (xr) return { weight: null, reps: xr[1] ?? '', rest: text.slice(xr[0].length) };
  const single = SINGLE.exec(text);
  if (!single) return null;
  const value = single[2] ?? '';
  const looksLikeWeight = single[1] === '+' || /[.,]/.test(value) || Number(value) > MAX_REPS;
  return looksLikeWeight
    ? 'reps_required'
    : { weight: null, reps: value, rest: text.slice(single[0].length) };
}

export function parseSetInput(
  input: string,
  ctx: SetInputContext,
): Result<ParsedSet, SetInputError> {
  const text = input.trim();
  if (!text) return err(E.empty);
  const raw = match(text);
  if (raw === null) return err(E.not_recognized);
  if (raw === 'reps_required') return err(E.reps_required);

  const reps = Number(raw.reps);
  if (!Number.isInteger(reps) || reps < 1 || reps > MAX_REPS) return err(E.reps_out_of_range);
  const comment = raw.rest.trim() || null;

  if (ctx.loadType === LoadTypeSchema.enum.reps_only) {
    return raw.weight === null
      ? ok({ weightLb: null, reps, weightSource: W.none, comment })
      : err(E.weight_not_allowed);
  }
  if (raw.weight !== null) {
    const weight = Number(raw.weight.replace(',', '.'));
    if (!(weight >= 0 && weight <= MAX_WEIGHT_LB)) return err(E.weight_out_of_range);
    return ok({ weightLb: lb(weight), reps, weightSource: W.entered, comment });
  }
  if (ctx.suggestedLb === null) return err(E.weight_required);
  return ok({ weightLb: ctx.suggestedLb, reps, weightSource: W.suggested, comment });
}
