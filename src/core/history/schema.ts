import { z } from 'zod';
import { LocalDateSchema } from '../schedule/calendar.ts';
import { LbSchema } from '../units/lb.ts';

/** Словарь истории тренировок (.specs/data-model.md → exercise_logs, sets). */

export const ExerciseLogStatusSchema = z.enum(['done', 'skipped', 'substituted']);
export type ExerciseLogStatus = z.infer<typeof ExerciseLogStatusSchema>;

/** Откуда запись: тренировка, ручной ввод (/seed) или импорт через LLM (фаза 2). */
export const LogSourceSchema = z.enum(['workout', 'manual_import', 'llm_import']);
export type LogSource = z.infer<typeof LogSourceSchema>;

export const SetKindSchema = z.enum(['warmup', 'work', 'extra']);
export type SetKind = z.infer<typeof SetKindSchema>;

export const WarmupVariantSchema = z.enum(['full', 'short', 'custom', 'none']);
export type WarmupVariant = z.infer<typeof WarmupVariantSchema>;

/** Подход для выбора «прошлого раза»: вес (null — без веса) и повторения. */
export const WorkSetSchema = z.object({
  weightLb: LbSchema.nullable(),
  reps: z.number().int().positive(),
}).readonly();
export type WorkSet = z.infer<typeof WorkSetSchema>;

/** «Прошлый раз» упражнения: лучший рабочий подход последней выполненной записи. */
export const LastResultSchema = z.object({
  localDate: LocalDateSchema,
  weightLb: LbSchema.nullable(),
  reps: z.number().int().positive(),
  source: LogSourceSchema,
  comment: z.string().nullable(),
}).readonly();
export type LastResult = z.infer<typeof LastResultSchema>;

/** Результат, введённый вручную (/seed): одна запись и один рабочий подход, без тренировки. */
export const ManualResultSchema = z.object({
  exerciseId: z.string(),
  exerciseName: z.string(),
  weightLb: LbSchema.nullable(),
  reps: z.number().int().positive(),
  comment: z.string().nullable(),
  localDate: LocalDateSchema,
  stepLbUsed: LbSchema.nullable(),
}).readonly();
export type ManualResult = z.infer<typeof ManualResultSchema>;

/** Лучший подход: больший вес, при равенстве — больше повторений; без веса — по повторениям. */
export function topSet(sets: readonly WorkSet[]): WorkSet | null {
  let best: WorkSet | null = null;
  for (const s of sets) {
    if (
      best === null ||
      (s.weightLb ?? 0) > (best.weightLb ?? 0) ||
      ((s.weightLb ?? 0) === (best.weightLb ?? 0) && s.reps > best.reps)
    ) best = s;
  }
  return best;
}
