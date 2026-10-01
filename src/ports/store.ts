import { z } from 'zod';
import { LastResultSchema, ManualResultSchema } from '../core/history/schema.ts';
import { ProgramSchema } from '../core/program/schema.ts';
import { IntensityLogSchema } from '../core/schedule/intensity.ts';
import { type Effect, SessionSchema } from '../core/session/types.ts';
import { LbSchema } from '../core/units/lb.ts';
import { ActiveWorkoutSchema, LastWorkoutSchema } from '../core/workout/schema.ts';
import { SettingsSchema } from '../core/settings/settings.ts';

export const UserStateSchema = z.object({
  session: SessionSchema,
  settings: SettingsSchema,
  /** Активная программа (по settings.activeProgramId); null — не загружена. */
  activeProgram: ProgramSchema.nullable(),
  /** «Прошлый раз» по упражнениям активной программы (по exerciseId). */
  lastResults: z.record(z.string(), LastResultSchema).readonly(),
  activeWorkout: ActiveWorkoutSchema.nullable(),
  lastWorkout: LastWorkoutSchema.nullable(),
  intensityLogs: z.array(IntensityLogSchema).readonly(),
  lastHighLb: z.record(z.string(), LbSchema).readonly(),
}).readonly();
export type UserState = z.infer<typeof UserStateSchema>;

export const CommitSchema = z.object({
  session: SessionSchema,
  /** Передаётся, только если настройки изменились. */
  settings: SettingsSchema.optional(),
  /** Новая активная программа: предыдущая архивируется, версия — следующая для того же id. */
  newProgram: z.object({ id: z.uuid(), program: ProgramSchema }).readonly().optional(),
  /** Результаты /seed: запись упражнения и один рабочий подход, без тренировки. */
  manualResults: z.array(
    z.object({
      logId: z.uuid(),
      setId: z.uuid(),
      programId: z.uuid(),
      result: ManualResultSchema,
    }).readonly(),
  ).readonly().optional(),
}).readonly();
export type Commit = z.infer<typeof CommitSchema> & {
  /**
   * Записи тренировки в порядке эффектов автомата (тренировка → упражнение → подходы).
   * programId — активная программа: к ней привязаны тренировка и записи.
   */
  readonly workout?: { readonly programId: string; readonly writes: readonly WorkoutWrite[] };
};

/** Эффекты автомата, которые пишут тренировку. */
export type WorkoutWrite = Extract<
  Effect,
  {
    type:
      | 'start_workout'
      | 'finish_workout'
      | 'comment_workout'
      | 'open_exercise_log'
      | 'patch_exercise_log'
      | 'record_set';
  }
>;

const WORKOUT_WRITES: ReadonlySet<string> = new Set([
  'start_workout',
  'finish_workout',
  'comment_workout',
  'open_exercise_log',
  'patch_exercise_log',
  'record_set',
]);

export const isWorkoutWrite = (e: Effect): e is WorkoutWrite => WORKOUT_WRITES.has(e.type);

/** Хранилище. Один load и один commit (транзакция) на апдейт — docs/architecture.md §13.2. */
export type Store = {
  /** Сессия и настройки одним запросом; для нового пользователя — значения по умолчанию. */
  readonly load: (userId: number) => Promise<UserState>;
  readonly commit: (userId: number, change: Commit) => Promise<void>;
  /** Лёгкий запрос в БД для /health (защита бесплатного проекта от паузы). */
  readonly ping: () => Promise<void>;
};
