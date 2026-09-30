import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
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
