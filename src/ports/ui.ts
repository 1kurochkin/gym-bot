import { z } from 'zod';
import { PersonSchema } from '../core/access/schema.ts';
import { TimeZoneSchema } from '../core/schedule/timezone.ts';
import { IdSchema } from '../core/program/schema.ts';
import { SettingsSectionSchema } from '../core/settings/options.ts';
import { LanguageSchema } from '../core/settings/settings.ts';
import { WarmupVariantSchema } from '../core/history/schema.ts';
import { IntensitySchema } from '../core/program/schema.ts';
import { FileProblemSchema, ResumeChoiceSchema } from '../core/session/types.ts';
import { LbSchema } from '../core/units/lb.ts';

/**
 * Граница между Telegram и приложением. Адаптер telegram переводит апдейт в Incoming,
 * а Rendered — в сообщение с клавиатурой. Фичи не знают про grammY.
 */

/** Действие кнопки. Кодируется в callback_data адаптером (лимит 64 байта) и проверяется при декодировании. */
export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tz'), zone: TimeZoneSchema }).readonly(),
  z.object({ type: z.literal('program_confirm') }).readonly(),
  z.object({ type: z.literal('program_cancel') }).readonly(),
  z.object({ type: z.literal('seed_next') }).readonly(),
  z.object({ type: z.literal('seed_stop') }).readonly(),
  z.object({ type: z.literal('settings_section'), section: SettingsSectionSchema }).readonly(),
  z.object({ type: z.literal('settings_back') }).readonly(),
  z.object({ type: z.literal('settings_close') }).readonly(),
  z.object({ type: z.literal('bar_set'), lb: LbSchema }).readonly(),
  z.object({ type: z.literal('plate_toggle'), lb: LbSchema }).readonly(),
  z.object({ type: z.literal('plates_save') }).readonly(),
  z.object({ type: z.literal('step_pick'), exerciseId: IdSchema }).readonly(),
  z.object({ type: z.literal('step_set'), lb: LbSchema }).readonly(),
  z.object({ type: z.literal('step_reset') }).readonly(),
  z.object({ type: z.literal('lang_set'), language: LanguageSchema }).readonly(),
  z.object({ type: z.literal('day_pick'), dayId: IdSchema }).readonly(),
  z.object({ type: z.literal('resume'), choice: ResumeChoiceSchema }).readonly(),
  z.object({ type: z.literal('intensity_set'), intensity: IntensitySchema }).readonly(),
  z.object({ type: z.literal('weight_set'), lb: LbSchema }).readonly(),
  z.object({ type: z.literal('warmup'), variant: WarmupVariantSchema }).readonly(),
  z.object({ type: z.literal('reps_set'), reps: z.number().int().min(1).max(100) }).readonly(),
  z.object({ type: z.literal('set_more') }).readonly(),
  z.object({ type: z.literal('exercise_next') }).readonly(),
  z.object({ type: z.literal('exercise_skip') }).readonly(),
  z.object({ type: z.literal('comment') }).readonly(),
  z.object({ type: z.literal('workout_done') }).readonly(),
  z.object({ type: z.literal('cancel_answer'), confirm: z.boolean() }).readonly(),
  z.object({ type: z.literal('member_pick'), userId: z.number().int().positive() }).readonly(),
  z.object({ type: z.literal('revoke_answer'), confirm: z.boolean() }).readonly(),
]);
export type Action = z.infer<typeof ActionSchema>;

export const IncomingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('command'), name: z.string(), args: z.string() }).readonly(),
  z.object({ kind: z.literal('text'), text: z.string() }).readonly(),
  /** Файл уже скачан адаптером: текст или причина отказа (размер, тип, загрузка). */
  z.object({
    kind: z.literal('document'),
    fileName: z.string(),
    text: z.string().nullable(),
    problem: FileProblemSchema.nullable(),
  }).readonly(),
  z.object({
    kind: z.literal('location'),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).readonly(),
  z.object({
    kind: z.literal('callback'),
    action: ActionSchema,
    stepNo: z.number().int().nonnegative(),
  }).readonly(),
]);
export type Incoming = z.infer<typeof IncomingSchema>;

export const IncomingUpdateSchema = z.object({
  updateId: z.number().int(),
  userId: z.number().int().positive(),
  chatId: z.number().int(),
  /** Сообщение с нажатой кнопкой: его редактируем вместо отправки нового. */
  messageId: z.number().int().nullable(),
  /** language_code пользователя из Telegram. */
  languageCode: z.string().nullable(),
  /** Имя и @username из Telegram: запоминаются при входе по приглашению. */
  person: PersonSchema,
  input: IncomingSchema,
}).readonly();
export type IncomingUpdate = z.infer<typeof IncomingUpdateSchema>;

export const ButtonSchema = z.object({ label: z.string(), action: ActionSchema }).readonly();
export type Button = z.infer<typeof ButtonSchema>;

/**
 * Нижняя (reply) клавиатура: кнопка «отправить геопозицию» или её удаление.
 * Такое сообщение всегда отправляется новым: reply-клавиатуру нельзя повесить при редактировании.
 */
export const ReplyKeyboardSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('request_location'), label: z.string() }).readonly(),
  z.object({ kind: z.literal('remove') }).readonly(),
]);
export type ReplyKeyboard = z.infer<typeof ReplyKeyboardSchema>;

export const RenderedSchema = z.object({
  text: z.string(),
  keyboard: z.array(z.array(ButtonSchema).readonly()).readonly(),
  replyKeyboard: ReplyKeyboardSchema.nullable(),
}).readonly();
export type Rendered = z.infer<typeof RenderedSchema>;

/** Порт с поведением — обычный TS-тип: zod-схема функции ничего бы не проверяла. */
/** Что знает только оболочка, но нужно экрану: имя бота для ссылки-приглашения. */
export const RenderEnvSchema = z.object({ botUsername: z.string() }).readonly();
export type RenderEnv = z.infer<typeof RenderEnvSchema>;

export type Ui = {
  /** Показать экран: отредактировать messageId, если он есть, иначе отправить новое сообщение. */
  readonly show: (
    chatId: number,
    rendered: Rendered,
    stepNo: number,
    messageId: number | null,
  ) => Promise<void>;
  /** Убрать клавиатуру у сообщения с устаревшими кнопками. */
  readonly dropKeyboard: (chatId: number, messageId: number) => Promise<void>;
};
