import { z } from 'zod';
import { SettingsSchema } from '../settings/settings.ts';
import { TimeInputErrorSchema, TimeZoneSchema } from '../schedule/timezone.ts';

/** Шаг диалога. Новые ветки диалога добавляются сюда и в step(). */
export const SessionStepSchema = z.enum(['idle', 'onboarding_tz', 'onboarding_tz_pick']);
export type SessionStep = z.infer<typeof SessionStepSchema>;

/** Состояние диалога; хранится в таблице session, функция stateless. */
export const SessionSchema = z.object({
  userId: z.number().int().positive(),
  step: SessionStepSchema,
  /** Растёт при каждом показе нового экрана; кнопки со старым номером считаются устаревшими. */
  stepNo: z.number().int().nonnegative(),
  /** Последний обработанный update_id Telegram (идемпотентность). */
  lastUpdateId: z.number().int().nonnegative(),
}).readonly();
export type Session = z.infer<typeof SessionSchema>;

export const initialSession = (userId: number): Session => ({
  userId,
  step: SessionStepSchema.enum.idle,
  stepNo: 0,
  lastUpdateId: 0,
});

export const BotEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }).readonly(),
  z.object({ type: z.literal('text_entered'), text: z.string() }).readonly(),
  z.object({ type: z.literal('tz_chosen'), zone: TimeZoneSchema }).readonly(),
  /** Геопозиция уже переведена в зону оболочкой; null — по координатам зону не нашли. */
  z.object({ type: z.literal('tz_located'), zone: TimeZoneSchema.nullable() }).readonly(),
]);
export type BotEvent = z.infer<typeof BotEventSchema>;

export const TimeZoneOptionSchema = z.object({ zone: TimeZoneSchema, label: z.string() })
  .readonly();
export type TimeZoneOption = z.infer<typeof TimeZoneOptionSchema>;

/** Почему снова спрашиваем время: ввод не распознан или по геопозиции зона не нашлась. */
export const AskTimeErrorSchema = z.enum([
  ...TimeInputErrorSchema.extract(['not_time']).options,
  'location_unknown',
]);
export type AskTimeError = z.infer<typeof AskTimeErrorSchema>;

/** Что показать пользователю. Текст и кнопки строят views в features/. */
export const ViewSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ask_time'), error: AskTimeErrorSchema.nullable() }).readonly(),
  z.object({
    type: z.literal('pick_zone'),
    offsetLabel: z.string(),
    options: z.array(TimeZoneOptionSchema).readonly(),
  }).readonly(),
  z.object({ type: z.literal('home'), timezoneLabel: z.string() }).readonly(),
]);
export type View = z.infer<typeof ViewSchema>;

export const EffectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('save_settings'), settings: SettingsSchema }).readonly(),
  z.object({ type: z.literal('render'), view: ViewSchema }).readonly(),
]);
export type Effect = z.infer<typeof EffectSchema>;

export const StepContextSchema = z.object({
  now: z.date(),
  settings: SettingsSchema,
  /** language_code из Telegram: по нему зоны-кандидаты сортируются. */
  languageCode: z.string().nullable(),
}).readonly();
export type StepContext = z.infer<typeof StepContextSchema>;

export const StepResultSchema = z.object({
  state: SessionSchema,
  effects: z.array(EffectSchema).readonly(),
}).readonly();
export type StepResult = z.infer<typeof StepResultSchema>;
