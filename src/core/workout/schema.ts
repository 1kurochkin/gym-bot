import { z } from 'zod';
import { ExerciseLogStatusSchema, SetKindSchema, WarmupVariantSchema } from '../history/schema.ts';
import { IntensitySchema } from '../program/schema.ts';
import { IsoWeekSchema, LocalDateSchema } from '../schedule/calendar.ts';
import { LbSchema } from '../units/lb.ts';

/** Тренировка и её записи (.specs/data-model.md → workouts, exercise_logs, sets). */

export const WorkoutStatusSchema = z.enum(['in_progress', 'completed', 'aborted']);
export type WorkoutStatus = z.infer<typeof WorkoutStatusSchema>;

export const LoggedSetSchema = z.object({
  kind: SetKindSchema,
  weightLb: LbSchema.nullable(),
  reps: z.number().int().positive(),
}).readonly();
export type LoggedSet = z.infer<typeof LoggedSetSchema>;

export const WorkoutLogSchema = z.object({
  id: z.string(),
  exerciseId: z.string(),
  exerciseName: z.string(),
  status: ExerciseLogStatusSchema,
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
  comment: z.string().optional(),
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
}).readonly();
export type NewSet = z.infer<typeof NewSetSchema>;
