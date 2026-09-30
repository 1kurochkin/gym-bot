import { z } from 'zod';
import { lb, LbSchema } from '../units/lb.ts';
import { TimeZoneSchema } from '../schedule/timezone.ts';

export const ExerciseOverridesSchema = z.record(
  z.string(),
  z.object({ stepLb: LbSchema.optional() }).readonly(),
).readonly();
export type ExerciseOverrides = z.infer<typeof ExerciseOverridesSchema>;

/** Настройки пользователя (.specs/data-model.md → settings). */
export const SettingsSchema = z.object({
  userId: z.number().int().positive(),
  /** null, пока пользователь не прошёл онбординг часового пояса. */
  timezone: TimeZoneSchema.nullable(),
  barWeightLb: LbSchema,
  platesLb: z.array(LbSchema).readonly(),
  exerciseOverrides: ExerciseOverridesSchema,
  activeProgramId: z.uuid().nullable(),
}).readonly();
export type Settings = z.infer<typeof SettingsSchema>;

/** Значения по умолчанию из .specs/warmup.md §6.1: гриф 45 lb, блины 5–45 lb. */
export const defaultSettings = (userId: number): Settings => ({
  userId,
  timezone: null,
  barWeightLb: lb(45),
  platesLb: [5, 10, 25, 35, 45].map(lb),
  exerciseOverrides: {},
  activeProgramId: null,
});
