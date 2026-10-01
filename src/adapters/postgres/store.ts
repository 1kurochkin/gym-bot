import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, max, ne, or, sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  ExerciseLogStatusSchema,
  type LastResult,
  LastResultSchema,
  LogSourceSchema,
  SetKindSchema,
  topSet,
  WarmupVariantSchema,
} from '../../core/history/schema.ts';
import { type Member, MemberSchema, type Person } from '../../core/access/schema.ts';
import { exerciseIndex } from '../../core/program/program.ts';
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
import { lb } from '../../core/units/lb.ts';
import type { Commit, Store, UserState, WorkoutWrite } from '../../ports/store.ts';
import { type IntensityLog, IntensityLogSchema } from '../../core/schedule/intensity.ts';
import { IntensitySchema } from '../../core/program/schema.ts';
import type { Lb } from '../../core/units/lb.ts';
import {
  type ActiveWorkout,
  ActiveWorkoutSchema,
  type LastWorkout,
  LastWorkoutSchema,
  WorkoutStatusSchema,
} from '../../core/workout/schema.ts';
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
    async load(userId: number, opts = { withMembers: false }): Promise<UserState> {
      const [s, st] = await Promise.all([
        db.select().from(schema.session).where(eq(schema.session.userId, userId)),
        db.select().from(schema.settings).where(eq(schema.settings.userId, userId)),
      ]);
      const settings = st[0] ? toSettings(st[0]) : defaultSettings(userId);
      const [activeProgram, activeWorkout, lastWorkout] = await Promise.all([
        loadProgram(db, settings.activeProgramId),
        loadActiveWorkout(db, userId),
        loadLastWorkout(db, userId),
      ]);
      const exerciseIds = activeProgram ? [...exerciseIndex(activeProgram).keys()] : [];
      const pairIds = activeProgram
        ? activeProgram.intensityPairs.flatMap((p) => [...p.exercises])
        : [];
      const [lastResults, intensityLogs, lastHighLb, members] = await Promise.all([
        loadLastResults(db, userId, exerciseIds, activeWorkout?.id ?? null),
        loadIntensityLogs(db, userId, pairIds),
        loadLastHigh(db, userId, pairIds),
        opts.withMembers ? loadMembers(db) : Promise.resolve([]),
      ]);
      return {
        session: s[0] ? toSession(s[0]) : initialSession(userId),
        settings,
        activeProgram,
        lastResults,
        activeWorkout,
        lastWorkout,
        intensityLogs,
        lastHighLb,
        members,
      };
    },

    async commit(userId: number, change: Commit): Promise<void> {
      await db.transaction(async (tx) => {
        if (change.newProgram) await saveProgram(tx, userId, change.newProgram);
        for (const r of change.manualResults ?? []) await saveManualResult(tx, userId, r);
        for (const w of change.workout?.writes ?? []) {
          await saveWorkoutWrite(tx, userId, change.workout?.programId ?? '', w);
        }
        if (change.newInvite) {
          await tx.insert(schema.invites).values({
            code: change.newInvite.code,
            createdBy: userId,
            expiresAt: change.newInvite.expiresAt,
          });
        }
        if (change.revokeMember !== undefined) {
          await tx.update(schema.members).set({ revokedAt: sql`now()` })
            .where(eq(schema.members.userId, change.revokeMember));
        }
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

    async isMember(userId: number): Promise<boolean> {
      const rows = await db.select({ userId: schema.members.userId }).from(schema.members)
        .where(and(eq(schema.members.userId, userId), isNull(schema.members.revokedAt)));
      return rows.length > 0;
    },

    redeemInvite(
      code: string,
      userId: number,
      person: Person,
      now: Date,
    ): Promise<{ invitedBy: number } | null> {
      return db.transaction(async (tx) => {
        // Условие в UPDATE — гарантия одноразовости: второй вход тем же кодом ничего не обновит.
        const [invite] = await tx.update(schema.invites).set({ usedBy: userId, usedAt: now })
          .where(and(
            eq(schema.invites.code, code),
            isNull(schema.invites.usedBy),
            gt(schema.invites.expiresAt, now),
          ))
          .returning({ createdBy: schema.invites.createdBy });
        if (!invite) return null;
        const row = {
          userId,
          name: person.name,
          username: person.username,
          invitedBy: invite.createdBy,
          joinedAt: now,
          revokedAt: null,
        };
        await tx.insert(schema.members).values(row).onConflictDoUpdate({
          target: schema.members.userId,
          set: row,
        });
        return { invitedBy: invite.createdBy };
      });
    },
  };
}

async function loadMembers(db: Db): Promise<Member[]> {
  const rows = await db.select().from(schema.members).where(isNull(schema.members.revokedAt))
    .orderBy(asc(schema.members.joinedAt));
  return rows.map((r) =>
    MemberSchema.parse({
      userId: r.userId,
      person: { name: r.name, username: r.username },
      joinedAt: r.joinedAt,
    })
  );
}

async function loadProgram(db: Db, id: string | null): Promise<Program | null> {
  if (id === null) return null;
  const rows = await db.select({ definition: schema.programs.definition }).from(schema.programs)
    .where(eq(schema.programs.id, id));
  return StoredProgramSchema.parse(rows[0]?.definition ?? null);
}

const { done } = ExerciseLogStatusSchema.enum;
const { work } = SetKindSchema.enum;

/**
 * «Прошлый раз» (.specs/product.md → US-6): последняя выполненная запись каждого упражнения
 * (любой источник, по всем программам) и лучший её рабочий подход.
 */
async function loadLastResults(
  db: Db,
  userId: number,
  exerciseIds: readonly string[],
  /** Текущая незавершённая тренировка: её подходы — не «прошлый раз». */
  excludeWorkoutId: string | null,
): Promise<Record<string, LastResult>> {
  if (exerciseIds.length === 0) return {};
  const logs = await db.selectDistinctOn([schema.exerciseLogs.exerciseId], {
    id: schema.exerciseLogs.id,
    exerciseId: schema.exerciseLogs.exerciseId,
    localDate: schema.exerciseLogs.localDate,
    source: schema.exerciseLogs.source,
    comment: schema.exerciseLogs.comment,
  }).from(schema.exerciseLogs).where(and(
    eq(schema.exerciseLogs.userId, userId),
    eq(schema.exerciseLogs.status, done),
    inArray(schema.exerciseLogs.exerciseId, [...exerciseIds]),
    excludeWorkoutId === null ? undefined : or(
      isNull(schema.exerciseLogs.workoutId),
      ne(schema.exerciseLogs.workoutId, excludeWorkoutId),
    ),
  )).orderBy(
    schema.exerciseLogs.exerciseId,
    desc(schema.exerciseLogs.localDate),
    desc(schema.exerciseLogs.createdAt),
  );
  if (logs.length === 0) return {};
  const workSets = await db.select({
    logId: schema.sets.exerciseLogId,
    weightLb: schema.sets.weightLb,
    reps: schema.sets.reps,
  }).from(schema.sets).where(and(
    inArray(schema.sets.exerciseLogId, logs.map((l) => l.id)),
    eq(schema.sets.kind, work),
    eq(schema.sets.skipped, false),
  ));
  const result: Record<string, LastResult> = {};
  for (const log of logs) {
    const best = topSet(
      workSets.filter((w) => w.logId === log.id).map((w) => ({
        weightLb: w.weightLb === null ? null : lb(w.weightLb),
        reps: w.reps,
      })),
    );
    if (!best) continue;
    const parsed = LastResultSchema.safeParse({ ...log, weightLb: best.weightLb, reps: best.reps });
    if (parsed.success) result[log.exerciseId] = parsed.data;
  }
  return result;
}

const { in_progress, completed } = WorkoutStatusSchema.enum;

/** Незавершённая тренировка и всё, что в ней уже записано. */
async function loadActiveWorkout(db: Db, userId: number): Promise<ActiveWorkout | null> {
  const [w] = await db.select().from(schema.workouts).where(and(
    eq(schema.workouts.userId, userId),
    eq(schema.workouts.status, in_progress),
  )).orderBy(desc(schema.workouts.startedAt)).limit(1);
  if (!w) return null;
  const logs = await db.select().from(schema.exerciseLogs)
    .where(eq(schema.exerciseLogs.workoutId, w.id)).orderBy(asc(schema.exerciseLogs.createdAt));
  const sets = logs.length === 0 ? [] : await db.select().from(schema.sets).where(and(
    inArray(schema.sets.exerciseLogId, logs.map((l) => l.id)),
    eq(schema.sets.skipped, false),
  )).orderBy(asc(schema.sets.createdAt));
  const parsed = ActiveWorkoutSchema.safeParse({
    id: w.id,
    dayId: w.dayId,
    dayName: w.dayName,
    startedAt: w.startedAt,
    localDate: w.localDate,
    logs: logs.map((l) => ({
      id: l.id,
      exerciseId: l.exerciseId,
      exerciseName: l.exerciseName,
      status: l.status,
      plannedWorkWeightLb: l.plannedWorkWeightLb,
      sets: sets.filter((st) => st.exerciseLogId === l.id).map((st) => ({
        kind: st.kind,
        weightLb: st.weightLb,
        reps: st.reps,
      })),
    })),
  });
  return parsed.success ? parsed.data : null;
}

async function loadLastWorkout(db: Db, userId: number): Promise<LastWorkout | null> {
  const [w] = await db.select({
    dayId: schema.workouts.dayId,
    dayName: schema.workouts.dayName,
    localDate: schema.workouts.localDate,
  }).from(schema.workouts).where(and(
    eq(schema.workouts.userId, userId),
    eq(schema.workouts.status, completed),
  )).orderBy(desc(schema.workouts.startedAt)).limit(1);
  const parsed = LastWorkoutSchema.safeParse(w);
  return parsed.success ? parsed.data : null;
}

/** История 100/70: выполненные записи упражнений из пар с интенсивностью и ISO-неделей тренировки. */
async function loadIntensityLogs(
  db: Db,
  userId: number,
  pairIds: readonly string[],
): Promise<IntensityLog[]> {
  if (pairIds.length === 0) return [];
  const rows = await db.select({
    exerciseId: schema.exerciseLogs.exerciseId,
    isoWeek: schema.workouts.isoWeek,
    intensity: schema.exerciseLogs.intensity,
  }).from(schema.exerciseLogs)
    .innerJoin(schema.workouts, eq(schema.workouts.id, schema.exerciseLogs.workoutId))
    .where(and(
      eq(schema.exerciseLogs.userId, userId),
      eq(schema.exerciseLogs.status, done),
      inArray(schema.exerciseLogs.exerciseId, [...pairIds]),
      isNotNull(schema.exerciseLogs.intensity),
    )).orderBy(asc(schema.exerciseLogs.createdAt));
  return rows.flatMap((r) => {
    const parsed = IntensityLogSchema.safeParse(r);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Последний рабочий вес на 100% — база для веса на 70% (§6.4, правило 5). */
async function loadLastHigh(
  db: Db,
  userId: number,
  pairIds: readonly string[],
): Promise<Record<string, Lb>> {
  if (pairIds.length === 0) return {};
  const logs = await db.selectDistinctOn([schema.exerciseLogs.exerciseId], {
    id: schema.exerciseLogs.id,
    exerciseId: schema.exerciseLogs.exerciseId,
  }).from(schema.exerciseLogs).where(and(
    eq(schema.exerciseLogs.userId, userId),
    eq(schema.exerciseLogs.status, done),
    eq(schema.exerciseLogs.intensity, IntensitySchema.enum.high),
    inArray(schema.exerciseLogs.exerciseId, [...pairIds]),
  )).orderBy(schema.exerciseLogs.exerciseId, desc(schema.exerciseLogs.createdAt));
  if (logs.length === 0) return {};
  const sets = await db.select({
    logId: schema.sets.exerciseLogId,
    weightLb: schema.sets.weightLb,
    reps: schema.sets.reps,
  })
    .from(schema.sets).where(and(
      inArray(schema.sets.exerciseLogId, logs.map((l) => l.id)),
      eq(schema.sets.kind, work),
    ));
  const result: Record<string, Lb> = {};
  for (const log of logs) {
    const best = topSet(
      sets.filter((x) => x.logId === log.id).map((x) => ({
        weightLb: x.weightLb === null ? null : lb(x.weightLb),
        reps: x.reps,
      })),
    );
    if (best && best.weightLb !== null) result[log.exerciseId] = best.weightLb;
  }
  return result;
}

/** Запись тренировки: эффекты автомата применяются в порядке, в каком он их выдал. */
async function saveWorkoutWrite(
  tx: Tx,
  userId: number,
  programId: string,
  w: WorkoutWrite,
): Promise<void> {
  switch (w.type) {
    case 'start_workout':
      await tx.insert(schema.workouts).values({
        ...w.workout,
        userId,
        programId,
        status: in_progress,
      });
      return;
    case 'finish_workout':
      await tx.update(schema.workouts).set({ status: w.status, finishedAt: w.finishedAt })
        .where(and(eq(schema.workouts.id, w.workoutId), eq(schema.workouts.userId, userId)));
      return;
    case 'comment_workout':
      await tx.update(schema.workouts).set({ comment: w.comment })
        .where(and(eq(schema.workouts.id, w.workoutId), eq(schema.workouts.userId, userId)));
      return;
    case 'open_exercise_log':
      await tx.insert(schema.exerciseLogs).values({
        ...w.log,
        userId,
        programId,
        warmupVariant: WarmupVariantSchema.enum.none,
        source: LogSourceSchema.enum.workout,
      });
      return;
    case 'patch_exercise_log':
      await tx.update(schema.exerciseLogs).set(w.patch)
        .where(and(eq(schema.exerciseLogs.id, w.id), eq(schema.exerciseLogs.userId, userId)));
      return;
    case 'record_set':
      await tx.insert(schema.sets).values({ ...w.set, userId, programId });
      return;
  }
}

/** Результат /seed: запись manual_import без тренировки и один рабочий подход. */
async function saveManualResult(
  tx: Tx,
  userId: number,
  r: NonNullable<Commit['manualResults']>[number],
): Promise<void> {
  const { result } = r;
  await tx.insert(schema.exerciseLogs).values({
    id: r.logId,
    userId,
    workoutId: null,
    programId: r.programId,
    exerciseId: result.exerciseId,
    exerciseName: result.exerciseName,
    order: 0,
    status: done,
    stepLbUsed: result.stepLbUsed,
    warmupVariant: WarmupVariantSchema.enum.none,
    comment: result.comment,
    source: LogSourceSchema.enum.manual_import,
    localDate: result.localDate,
  });
  await tx.insert(schema.sets).values({
    id: r.setId,
    userId,
    exerciseLogId: r.logId,
    workoutId: null,
    programId: r.programId,
    exerciseId: result.exerciseId,
    kind: work,
    index: 1,
    weightLb: result.weightLb,
    reps: result.reps,
  });
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
    language: row.language,
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
    language: s.language,
    activeProgramId: s.activeProgramId,
  };
}
