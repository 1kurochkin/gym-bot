import { z } from 'zod';
import { lb, LbSchema } from '../units/lb.ts';
import { TimeZoneSchema } from '../schedule/timezone.ts';

export const LanguageSchema = z.enum(['ru', 'en']);
export type Language = z.infer<typeof LanguageSchema>;

export function languageFor(chosen: Language | null, languageCode: string | null): Language {
  if (chosen !== null) return chosen;
  return (languageCode ?? '').toLowerCase().startsWith('ru')
    ? LanguageSchema.enum.ru
    : LanguageSchema.enum.en;
}

export const ExerciseOverridesSchema = z.record(
  z.string(),
  z.object({ stepLb: LbSchema.optional() }).readonly(),
).readonly();
export type ExerciseOverrides = z.infer<typeof ExerciseOverridesSchema>;

export const SettingsSchema = z.object({
  userId: z.number().int().positive(),
  timezone: TimeZoneSchema.nullable(),
  barWeightLb: LbSchema,
  platesLb: z.array(LbSchema).readonly(),
  exerciseOverrides: ExerciseOverridesSchema,
  language: LanguageSchema.nullable(),
  activeProgramId: z.uuid().nullable(),
}).readonly();
export type Settings = z.infer<typeof SettingsSchema>;

export const defaultSettings = (userId: number): Settings => ({
  userId,
  timezone: null,
  barWeightLb: lb(45),
  platesLb: [5, 10, 25, 35, 45].map(lb),
  exerciseOverrides: {},
  language: null,
  activeProgramId: null,
});
