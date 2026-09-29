import { bigint, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { SessionStep } from '../../core/session/types.ts';

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
