import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  ExerciseLogStatus,
  LogSource,
  SetKind,
  WarmupVariant,
} from '../../core/history/schema.ts';
import type { Intensity } from '../../core/program/schema.ts';
import type { WorkoutStatus } from '../../core/workout/schema.ts';
import type { SessionStep } from '../../core/session/types.ts';
import type { ProgramStatus } from './program-status.ts';

/**
 * Схема БД (.specs/data-model.md). Этап 0: только settings и session; остальные таблицы
 * добавляются на своих этапах. RLS без политик: публичный API Supabase данные не отдаёт.
 * jsonb-колонки — unknown: их содержимое проверяют zod-схемы ядра при чтении (store.ts).
 */

export const settings = pgTable('settings', {
  userId: bigint('user_id', { mode: 'number' }).primaryKey(),
  timezone: text('timezone'),
  barWeightLb: integer('bar_weight_lb').notNull().default(45),
  platesLb: jsonb('plates_lb').$type<unknown>().notNull(),
  exerciseOverrides: jsonb('exercise_overrides').$type<unknown>().notNull().default({}),
  /** ru | en; null — по языку Telegram. */
  language: text('language'),
  activeProgramId: uuid('active_program_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const session = pgTable('session', {
  userId: bigint('user_id', { mode: 'number' }).primaryKey(),
  step: text('step').$type<SessionStep>().notNull(),
  stepNo: integer('step_no').notNull().default(0),
  lastUpdateId: bigint('last_update_id', { mode: 'number' }).notNull().default(0),
  context: jsonb('context').$type<unknown>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/**
 * Программы: снапшот определения целиком. Та же программа (program_key = id из JSON) с новым
 * содержимым — новая version; тренировки ссылаются на конкретную версию.
 */
export const programs = pgTable('programs', {
  id: uuid('id').primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  programKey: text('program_key').notNull(),
  version: integer('version').notNull(),
  name: text('name').notNull(),
  definition: jsonb('definition').$type<unknown>().notNull(),
  status: text('status').$type<ProgramStatus>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('programs_user_key_version').on(t.userId, t.programKey, t.version),
  index('programs_user_status').on(t.userId, t.status),
]).enableRLS();

/** Тренировка: день программы, локальная дата и ISO-неделя на момент старта (ADR-0004). */
export const workouts = pgTable('workouts', {
  id: uuid('id').primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  programId: uuid('program_id').notNull().references(() => programs.id),
  dayId: text('day_id').notNull(),
  dayName: text('day_name').notNull(),
  status: text('status').$type<WorkoutStatus>().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  localDate: date('local_date').notNull(),
  isoWeek: text('iso_week').notNull(),
  utcOffsetMin: integer('utc_offset_min').notNull(),
  comment: text('comment'),
}, (t) => [index('workouts_user_started').on(t.userId, t.startedAt.desc())]).enableRLS();

/**
 * Запись упражнения: из тренировки или введённая вручную (/seed). workout_id пуст у записей
 * не из тренировки.
 */
export const exerciseLogs = pgTable('exercise_logs', {
  id: uuid('id').primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  workoutId: uuid('workout_id').references(() => workouts.id),
  programId: uuid('program_id').notNull().references(() => programs.id),
  exerciseId: text('exercise_id').notNull(),
  exerciseName: text('exercise_name').notNull(),
  order: integer('order').notNull(),
  status: text('status').$type<ExerciseLogStatus>().notNull(),
  substitutedFor: text('substituted_for'),
  intensity: text('intensity').$type<Intensity>(),
  plannedWorkWeightLb: doublePrecision('planned_work_weight_lb'),
  stepLbUsed: doublePrecision('step_lb_used'),
  warmupTier: integer('warmup_tier'),
  warmupVariant: text('warmup_variant').$type<WarmupVariant>().notNull(),
  warmupComment: text('warmup_comment'),
  /** «Завершить упражнение» (✅ в меню дня). */
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  comment: text('comment'),
  source: text('source').$type<LogSource>().notNull(),
  localDate: date('local_date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('exercise_logs_last_result').on(t.userId, t.exerciseId, t.status, t.localDate.desc()),
]).enableRLS();

/** Подход: разминочный, рабочий или дополнительный. weight_lb — null для reps_only; для допвеса — допвес. */
export const sets = pgTable('sets', {
  id: uuid('id').primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  exerciseLogId: uuid('exercise_log_id').notNull().references(() => exerciseLogs.id, {
    onDelete: 'cascade',
  }),
  workoutId: uuid('workout_id'),
  programId: uuid('program_id').notNull(),
  exerciseId: text('exercise_id').notNull(),
  kind: text('kind').$type<SetKind>().notNull(),
  index: integer('index').notNull(),
  plannedWeightLb: doublePrecision('planned_weight_lb'),
  plannedReps: integer('planned_reps'),
  weightLb: doublePrecision('weight_lb'),
  reps: integer('reps').notNull(),
  skipped: boolean('skipped').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('sets_exercise_log').on(t.exerciseLogId),
  index('sets_program').on(t.programId),
]).enableRLS();

/** Участники по приглашению (.specs/product.md → US-9). Владельцы — в конфигурации, здесь их нет. */
export const members = pgTable('members', {
  userId: bigint('user_id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull(),
  username: text('username'),
  invitedBy: bigint('invited_by', { mode: 'number' }).notNull(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull(),
  /** Доступ отключён в /users; данные пользователя остаются. Новое приглашение возвращает доступ. */
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}).enableRLS();

/** Одноразовые приглашения: used_by заполняется при входе. */
export const invites = pgTable('invites', {
  code: text('code').primaryKey(),
  createdBy: bigint('created_by', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedBy: bigint('used_by', { mode: 'number' }),
  usedAt: timestamp('used_at', { withTimezone: true }),
}).enableRLS();
