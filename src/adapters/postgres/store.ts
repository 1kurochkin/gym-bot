import { eq, sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { TimeZoneSchema } from '../../core/schedule/timezone.ts';
import { defaultSettings, type Settings, SettingsSchema } from '../../core/settings/settings.ts';
import {
  initialSession,
  type Session,
  SessionSchema,
  SessionStepSchema,
} from '../../core/session/types.ts';
import type { Commit, Store, UserState } from '../../ports/store.ts';
import * as schema from './schema.ts';

type Db = PostgresJsDatabase<typeof schema>;

/** Подключение через пулер Supavisor в режиме transaction: prepared statements не поддерживаются. */
export function connect(databaseUrl: string): Db {
  return drizzle(postgres(databaseUrl, { prepare: false, max: 1 }), { schema });
}

/** Шаг, которого больше нет в автомате (после рефакторинга), сбрасывается в idle. */
const StoredStepSchema = SessionStepSchema.catch(SessionStepSchema.enum.idle);
/** Битая зона в БД — пользователь пройдёт онбординг заново, а не получит ошибку. */
const StoredZoneSchema = TimeZoneSchema.nullable().catch(null);

export function createPostgresStore(db: Db): Store {
  return {
    async load(userId: number): Promise<UserState> {
      const [s, st] = await Promise.all([
        db.select().from(schema.session).where(eq(schema.session.userId, userId)),
        db.select().from(schema.settings).where(eq(schema.settings.userId, userId)),
      ]);
      return {
        session: s[0] ? toSession(s[0]) : initialSession(userId),
        settings: st[0] ? toSettings(st[0]) : defaultSettings(userId),
      };
    },

    async commit(userId: number, change: Commit): Promise<void> {
      await db.transaction(async (tx) => {
        if (change.settings) {
          const row = fromSettings(change.settings);
          await tx.insert(schema.settings).values(row).onConflictDoUpdate({
            target: schema.settings.userId,
            set: { ...row, updatedAt: sql`now()` },
          });
        }
        const s = change.session;
        const row = { userId, step: s.step, stepNo: s.stepNo, lastUpdateId: s.lastUpdateId };
        await tx.insert(schema.session).values(row).onConflictDoUpdate({
          target: schema.session.userId,
          set: { ...row, updatedAt: sql`now()` },
        });
      });
    },

    async ping(): Promise<void> {
      await db.execute(sql`select 1`);
    },
  };
}

/** Строки БД проверяются теми же zod-схемами, что и доменные типы. */
function toSession(row: typeof schema.session.$inferSelect): Session {
  return SessionSchema.parse({
    userId: row.userId,
    step: StoredStepSchema.parse(row.step),
    stepNo: row.stepNo,
    lastUpdateId: row.lastUpdateId,
  });
}

function toSettings(row: typeof schema.settings.$inferSelect): Settings {
  return SettingsSchema.parse({
    userId: row.userId,
    timezone: StoredZoneSchema.parse(row.timezone),
    barWeightLb: row.barWeightLb,
    platesLb: row.platesLb,
    exerciseOverrides: row.exerciseOverrides,
    activeProgramId: row.activeProgramId,
  });
}

function fromSettings(s: Settings): typeof schema.settings.$inferInsert {
  return {
    userId: s.userId,
    timezone: s.timezone,
    barWeightLb: s.barWeightLb,
    platesLb: [...s.platesLb],
    exerciseOverrides: { ...s.exerciseOverrides },
    activeProgramId: s.activeProgramId,
  };
}
