import { z } from 'zod';
import { ExerciseLogStatusSchema, SetKindSchema, WarmupVariantSchema } from '../history/schema.ts';
import { IntensitySchema } from '../program/schema.ts';
import { IsoWeekSchema, LocalDateSchema } from '../schedule/calendar.ts';
import { LbSchema } from '../units/lb.ts';

/** Тренировка и её записи (.specs/data-model.md → workouts, exercise_logs, sets). */

export const WorkoutStatusSchema = z.enum(['in_progress', 'completed', 'aborted']);
export type WorkoutStatus = z.infer<typeof WorkoutStatusSchema>;

/** Записанный подход в порядке записи; skipped — разминочный подход, отмеченный «Пропустить». */
export const LoggedSetSchema = z.object({
  id: z.string(),
  kind: SetKindSchema,
  index: z.number().int().positive(),
  weightLb: LbSchema.nullable(),
  reps: z.number().int().positive(),
  skipped: z.boolean(),
}).readonly();
export type LoggedSet = z.infer<typeof LoggedSetSchema>;

export const WorkoutLogSchema = z.object({
  id: z.string(),
  exerciseId: z.string(),
  exerciseName: z.string(),
  /** Замена (до меню дня): id упражнения программы, вместо которого сделано это. */
  substitutedFor: z.string().nullable(),
  status: ExerciseLogStatusSchema,
  /** Нажато «Завершить упражнение» (✅ в меню дня). */
  finishedAt: z.date().nullable(),
  plannedWorkWeightLb: LbSchema.nullable(),
  sets: z.array(LoggedSetSchema).readonly(),
}).readonly();
export type WorkoutLog = z.infer<typeof WorkoutLogSchema>;

/** Незавершённая тренировка с тем, что уже записано: для продолжения и сводки. */
export const ActiveWorkoutSchema = z.object({
  id: z.string(),
  dayId: z.string(),
  dayName: z.string(),
  startedAt: z.date(),
  localDate: LocalDateSchema,
  logs: z.array(WorkoutLogSchema).readonly(),
}).readonly();
export type ActiveWorkout = z.infer<typeof ActiveWorkoutSchema>;

/** Последняя завершённая тренировка — для «Прошлая тренировка: …» и следующего дня. */
export const LastWorkoutSchema = z.object({
  dayId: z.string(),
  dayName: z.string(),
  localDate: LocalDateSchema,
}).readonly();
export type LastWorkout = z.infer<typeof LastWorkoutSchema>;

/** Новая тренировка (эффект start_workout). */
export const NewWorkoutSchema = z.object({
  id: z.string(),
  dayId: z.string(),
  dayName: z.string(),
  startedAt: z.date(),
  localDate: LocalDateSchema,
  isoWeek: IsoWeekSchema,
  utcOffsetMin: z.number().int(),
}).readonly();
export type NewWorkout = z.infer<typeof NewWorkoutSchema>;

/** Запись упражнения в тренировке (эффект open_exercise_log). */
export const NewExerciseLogSchema = z.object({
  id: z.string(),
  workoutId: z.string(),
  exerciseId: z.string(),
  exerciseName: z.string(),
  /** Замена: id заменённого упражнения программы; null — упражнение по программе. */
  substitutedFor: z.string().nullable(),
  order: z.number().int().nonnegative(),
  status: ExerciseLogStatusSchema,
  intensity: IntensitySchema.nullable(),
  plannedWorkWeightLb: LbSchema.nullable(),
  stepLbUsed: LbSchema.nullable(),
  warmupTier: z.number().int().nonnegative().nullable(),
  localDate: LocalDateSchema,
}).readonly();
export type NewExerciseLog = z.infer<typeof NewExerciseLogSchema>;

export const ExerciseLogPatchSchema = z.object({
  status: ExerciseLogStatusSchema.optional(),
  warmupVariant: WarmupVariantSchema.optional(),
  warmupComment: z.string().optional(),
  comment: z.string().optional(),
  /** «Завершить упражнение» (✅ в меню дня). */
  finishedAt: z.date().optional(),
}).readonly();

export type ExerciseLogPatch = z.infer<typeof ExerciseLogPatchSchema>;

export const NewSetSchema = z.object({
  id: z.string(),
  exerciseLogId: z.string(),
  workoutId: z.string(),
  exerciseId: z.string(),
  kind: SetKindSchema,
  index: z.number().int().positive(),
  plannedWeightLb: LbSchema.nullable(),
  plannedReps: z.number().int().positive().nullable(),
  weightLb: LbSchema.nullable(),
  reps: z.number().int().positive(),
  /** Разминочный подход отмечен «Пропустить»: записан для анализа, в подходы не входит. */
  skipped: z.boolean(),
}).readonly();
export type NewSet = z.infer<typeof NewSetSchema>;

/** /history (.specs/product.md → US-10): тренировка в списке. */
export const HistoryItemSchema = z.object({
  id: z.string(),
  dayName: z.string(),
  localDate: LocalDateSchema,
}).readonly();
export type HistoryItem = z.infer<typeof HistoryItemSchema>;

/** Страница истории: новые сверху; hasMore — есть тренировки раньше. */
export const HistoryPageSchema = z.object({
  offset: z.number().int().nonnegative(),
  items: z.array(HistoryItemSchema).readonly(),
  hasMore: z.boolean(),
}).readonly();
export type HistoryPage = z.infer<typeof HistoryPageSchema>;

/** Завершённая или прерванная тренировка с записями и подходами — для просмотра и правки. */
export const PastWorkoutSchema = z.object({
  id: z.string(),
  dayName: z.string(),
  localDate: LocalDateSchema,
  logs: z.array(WorkoutLogSchema).readonly(),
}).readonly();
export type PastWorkout = z.infer<typeof PastWorkoutSchema>;

/** Что подгрузить для /history: страницу списка и, если выбрана, тренировку. */
export const HistoryQuerySchema = z.object({
  offset: z.number().int().nonnegative(),
  workoutId: z.string().nullable(),
}).readonly();
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;

export const HistoryDataSchema = z.object({
  page: HistoryPageSchema.nullable(),
  workout: PastWorkoutSchema.nullable(),
}).readonly();
export type HistoryData = z.infer<typeof HistoryDataSchema>;

export const HISTORY_PAGE_SIZE = 8;
