import { z } from 'zod';
import { LbSchema } from '../units/lb.ts';

export const IdSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

export const LoadTypeSchema = z.enum([
  'barbell',
  'weighted_bodyweight',
  'machine',
  'reps_only',
  'light_load',
]);
export type LoadType = z.infer<typeof LoadTypeSchema>;

export const IntensitySchema = z.enum(['high', 'low']);
export type Intensity = z.infer<typeof IntensitySchema>;

const PositiveLbSchema = LbSchema.refine((v) => v > 0, { params: { problem: 'not_positive' } });
const RepsSchema = z.number().int().min(1);

export const RangeSchema = z.strictObject({ min: RepsSchema, max: RepsSchema })
  .refine((r) => r.min <= r.max, { params: { problem: 'min_gt_max' }, path: ['min'] })
  .readonly();

export const WarmupStepSchema = z.strictObject({ pct: z.number().gt(0).max(2), reps: RepsSchema })
  .readonly();
export type WarmupStep = z.infer<typeof WarmupStepSchema>;

export const WarmupTierSchema = z.strictObject({
  minLb: LbSchema,
  steps: z.array(WarmupStepSchema).min(1).readonly(),
}).readonly();
export type WarmupTier = z.infer<typeof WarmupTierSchema>;

export const OverloadSingleSchema = z.strictObject({
  pct: z.number().gt(1).max(2),
  reps: RepsSchema,
  onlyBase: z.boolean(),
  skipOnLowIntensity: z.boolean(),
}).readonly();
export type OverloadSingle = z.infer<typeof OverloadSingleSchema>;

export const WarmupTiersSchema = z.strictObject({
  byWorkWeight: z.array(WarmupTierSchema).min(1).readonly(),
  overloadSingle: OverloadSingleSchema.optional(),
}).readonly();
export type WarmupTiers = z.infer<typeof WarmupTiersSchema>;

export const AfterWorkSchema = z.strictObject({
  bodyweight: z.literal(true),
  reps: z.union([z.literal('max'), RepsSchema]),
}).readonly();
export type AfterWork = z.infer<typeof AfterWorkSchema>;

export const AddedStepSchema = z.strictObject({ pct: z.number().min(0).lt(1), reps: RepsSchema })
  .readonly();
export type AddedStep = z.infer<typeof AddedStepSchema>;

export const AddedWeightTiersSchema = z.strictObject({
  zero: z.strictObject({
    steps: z.array(z.strictObject({ assist: z.literal(true), reps: RepsSchema }).readonly()).min(1)
      .readonly(),
    afterWork: AfterWorkSchema.optional(),
  }).readonly(),
  byAddedWeight: z.array(
    z.strictObject({
      minLb: PositiveLbSchema,
      steps: z.array(AddedStepSchema).min(1).readonly(),
      afterWork: AfterWorkSchema.optional(),
    }).readonly(),
  ).min(1).readonly(),
  overloadSingle: z.strictObject({
    pct: z.number().gt(1).max(2),
    reps: RepsSchema,
    minAddedLb: LbSchema,
  }).readonly(),
}).readonly();
export type AddedWeightTiers = z.infer<typeof AddedWeightTiersSchema>;

export const FixedSchemeSchema = z.strictObject({
  steps: z.array(WarmupStepSchema).min(1).readonly(),
}).readonly();
export type FixedScheme = z.infer<typeof FixedSchemeSchema>;

export const WarmupRefSchema = z.union([z.literal('tiers'), IdSchema]).nullable();

const common = {
  id: IdSchema,
  name: z.string().min(1),
  isBase: z.boolean().default(false),
  workSets: RangeSchema,
  stepLb: PositiveLbSchema.optional(),
  notes: z.string().min(1).optional(),
  intensityGroup: IdSchema.optional(),
};

export const ExerciseSchema = z.discriminatedUnion('loadType', [
  z.strictObject({
    ...common,
    loadType: z.literal(LoadTypeSchema.enum.barbell),
    repRange: RangeSchema,
    warmup: WarmupRefSchema.default('tiers'),
  }).readonly(),
  z.strictObject({
    ...common,
    loadType: z.literal(LoadTypeSchema.enum.weighted_bodyweight),
    repRange: RangeSchema,
    warmup: WarmupRefSchema.default('tiers'),
  }).readonly(),
  z.strictObject({
    ...common,
    loadType: z.literal(LoadTypeSchema.enum.machine),
    repRange: RangeSchema,
    warmup: WarmupRefSchema.default('tiers'),
  }).readonly(),
  z.strictObject({
    ...common,
    loadType: z.literal(LoadTypeSchema.enum.reps_only),
    warmup: z.null().default(null),
    setTargets: z.array(z.string().min(1)).min(1).readonly().optional(),
  }).readonly(),
  z.strictObject({
    ...common,
    loadType: z.literal(LoadTypeSchema.enum.light_load),
    repRange: RangeSchema,
    warmup: z.null().default(null),
  }).readonly(),
]);
export type Exercise = z.infer<typeof ExerciseSchema>;

export const ExerciseRefSchema = z.strictObject({ id: IdSchema, ref: z.literal(true) }).readonly();
export type ExerciseRef = z.infer<typeof ExerciseRefSchema>;

export const DaySchema = z.strictObject({
  id: IdSchema,
  name: z.string().min(1),
  exercises: z.array(z.union([ExerciseRefSchema, ExerciseSchema])).min(1).readonly(),
}).readonly();
export type Day = z.infer<typeof DaySchema>;

export const IntensityModeSchema = z.enum(['alternate_weekly']);

export const IntensityPairSchema = z.strictObject({
  id: IdSchema,
  exercises: z.tuple([IdSchema, IdSchema]).readonly(),
  lowPct: z.number().gt(0).lt(1),
  mode: IntensityModeSchema,
}).readonly();
export type IntensityPair = z.infer<typeof IntensityPairSchema>;

export const ConditionalNoteSchema = z.strictObject({
  exercise: IdSchema,
  when: z.strictObject({ exercise: IdSchema, intensityThisWeek: IntensitySchema }).readonly(),
  text: z.string().min(1),
}).readonly();
export type ConditionalNote = z.infer<typeof ConditionalNoteSchema>;

export const ProgramSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string().min(1),
  units: z.literal('lb'),
  rotation: z.array(IdSchema).min(1).readonly(),
  warmupTiers: WarmupTiersSchema,
  addedWeightTiers: AddedWeightTiersSchema.optional(),
  fixedSchemes: z.record(IdSchema, FixedSchemeSchema).default({}),
  intensityPairs: z.array(IntensityPairSchema).default([]),
  days: z.array(DaySchema).min(1).readonly(),
  conditionalNotes: z.array(ConditionalNoteSchema).default([]),
}).readonly();
export type Program = z.infer<typeof ProgramSchema>;
