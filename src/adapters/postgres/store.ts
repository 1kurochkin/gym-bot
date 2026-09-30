import { and, eq, max, sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { type Program, ProgramSchema } from '../../core/program/schema.ts';
import { TimeZoneSchema } from '../../core/schedule/timezone.ts';
import { defaultSettings, type Settings, SettingsSchema } from '../../core/settings/settings.ts';
import {
  emptyContext,
  initialSession,
  type Session,
  SessionContextSchema,
  SessionSchema,
  SessionStepSchema,
} from '../../core/session/types.ts';
import type { Commit, Store, UserState } from '../../ports/store.ts';
import { ProgramStatusSchema } from './program-status.ts';
import * as schema from './schema.ts';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Подключение через пулер Supavisor в режиме transaction: prepared statements не поддерживаются. */
export function connect(databaseUrl: string): Db {
  return drizzle(postgres(databaseUrl, { prepare: false, max: 1 }), { schema });
}

/** Шаг, которого больше нет в автомате (после рефакторинга), сбрасывается в idle. */
const StoredStepSchema = SessionStepSchema.catch(SessionStepSchema.enum.idle);
/** Битая зона в БД — пользователь пройдёт онбординг заново, а не получит ошибку. */
const StoredZoneSchema = TimeZoneSchema.nullable().catch(null);
/** Контекст старого формата или битый — шаг начнётся заново. */
const StoredContextSchema = SessionContextSchema.catch(emptyContext);
/** Программа, которая больше не проходит схему (схема ужесточилась), не ломает бота. */
const StoredProgramSchema = ProgramSchema.nullable().catch(null);

const { active, archived } = ProgramStatusSchema.enum;

export function createPostgresStore(db: Db): Store {
  return {
    async load(userId: number): Promise<UserState> {
      const [s, st] = await Promise.all([
        db.select().from(schema.session).where(eq(schema.session.userId, userId)),
        db.select().from(schema.settings).where(eq(schema.settings.userId, userId)),
      ]);
      const settings = st[0] ? toSettings(st[0]) : defaultSettings(userId);
      return {
        session: s[0] ? toSession(s[0]) : initialSession(userId),
        settings,
        activeProgram: await loadProgram(db, settings.activeProgramId),
      };
    },

    async commit(userId: number, change: Commit): Promise<void> {
      await db.transaction(async (tx) => {
        if (change.newProgram) await saveProgram(tx, userId, change.newProgram);
        if (change.settings) {
          const row = fromSettings(change.settings);
          await tx.insert(schema.settings).values(row).onConflictDoUpdate({
            target: schema.settings.userId,
            set: { ...row, updatedAt: sql`now()` },
          });
        }
        const s = change.session;
        const row = {
          userId,
          step: s.step,
          stepNo: s.stepNo,
          lastUpdateId: s.lastUpdateId,
          context: s.context,
        };
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

async function loadProgram(db: Db, id: string | null): Promise<Program | null> {
  if (id === null) return null;
  const rows = await db.select({ definition: schema.programs.definition }).from(schema.programs)
    .where(eq(schema.programs.id, id));
  return StoredProgramSchema.parse(rows[0]?.definition ?? null);
}

/** Архивировать активную программу и сохранить новую следующей версией того же program_key. */
async function saveProgram(
  tx: Tx,
  userId: number,
  next: NonNullable<Commit['newProgram']>,
): Promise<void> {
  const { program } = next;
  await tx.update(schema.programs).set({ status: archived, archivedAt: sql`now()` }).where(
    and(eq(schema.programs.userId, userId), eq(schema.programs.status, active)),
  );
  const [last] = await tx.select({ version: max(schema.programs.version) }).from(schema.programs)
    .where(and(eq(schema.programs.userId, userId), eq(schema.programs.programKey, program.id)));
  await tx.insert(schema.programs).values({
    id: next.id,
    userId,
    programKey: program.id,
    version: (last?.version ?? 0) + 1,
    name: program.name,
    definition: program,
    status: active,
  });
}

/** Строки БД проверяются теми же zod-схемами, что и доменные типы. */
function toSession(row: typeof schema.session.$inferSelect): Session {
  return SessionSchema.parse({
    userId: row.userId,
    step: StoredStepSchema.parse(row.step),
    stepNo: row.stepNo,
    lastUpdateId: row.lastUpdateId,
    context: StoredContextSchema.parse(row.context),
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
