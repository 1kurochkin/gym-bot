import { z } from 'zod';
import { InviteCodeSchema, MemberSchema, type Person } from '../core/access/schema.ts';
import { LastResultSchema, ManualResultSchema } from '../core/history/schema.ts';
import { ProgramSchema } from '../core/program/schema.ts';
import { type Effect, SessionSchema } from '../core/session/types.ts';
import {
  ActiveWorkoutSchema,
  type HistoryData,
  type HistoryQuery,
  LastWorkoutSchema,
} from '../core/workout/schema.ts';
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
  /** Участники с доступом; заполняется только для владельца (load с withMembers). */
  members: z.array(MemberSchema).readonly(),
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
  /** /invite: новое одноразовое приглашение от этого пользователя. */
  newInvite: z.object({ code: InviteCodeSchema, expiresAt: z.date() }).readonly().optional(),
  /** /users: отключить участника (данные остаются). */
  revokeMember: z.number().int().positive().optional(),
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
      | 'record_set'
      | 'delete_sets'
      | 'delete_exercise_log'
      | 'update_set'
      | 'add_set'
      | 'delete_workout';
  }
>;

const WORKOUT_WRITES: ReadonlySet<string> = new Set([
  'start_workout',
  'finish_workout',
  'comment_workout',
  'open_exercise_log',
  'patch_exercise_log',
  'record_set',
  'delete_sets',
  'delete_exercise_log',
  'update_set',
  'add_set',
  'delete_workout',
]);

export const isWorkoutWrite = (e: Effect): e is WorkoutWrite => WORKOUT_WRITES.has(e.type);

/** Хранилище. Один load и один commit (транзакция) на апдейт — docs/architecture.md §13.2. */
export type Store = {
  /** Сессия и настройки одним запросом; для нового пользователя — значения по умолчанию. */
  readonly load: (userId: number, opts?: { readonly withMembers: boolean }) => Promise<UserState>;
  /** /history: страница завершённых и прерванных тренировок и, если выбрана, тренировка целиком. */
  readonly loadHistory: (userId: number, query: HistoryQuery) => Promise<HistoryData>;
  /** Участник с действующим доступом (владельцы — в конфигурации, не здесь). */
  readonly isMember: (userId: number) => Promise<boolean>;
  /**
   * Войти по приглашению одной транзакцией: код существует, не использован и не истёк к `now` →
   * код помечается использованным, пользователь становится участником. Возвращает, кто пригласил;
   * null — код недействителен.
   */
  readonly redeemInvite: (
    code: string,
    userId: number,
    person: Person,
    now: Date,
  ) => Promise<{ readonly invitedBy: number } | null>;
  readonly commit: (userId: number, change: Commit) => Promise<void>;
  /** Лёгкий запрос в БД для /health (защита бесплатного проекта от паузы). */
  readonly ping: () => Promise<void>;
};
