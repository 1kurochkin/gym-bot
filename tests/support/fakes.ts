import {
  type LastResult,
  type LogSource,
  LogSourceSchema,
  type ManualResult,
  topSet,
} from '../../src/core/history/schema.ts';
import type { Member, Person } from '../../src/core/access/schema.ts';
import { exerciseIndex } from '../../src/core/program/program.ts';
import type { Program } from '../../src/core/program/schema.ts';
import type { IntensityLog } from '../../src/core/schedule/intensity.ts';
import { defaultSettings, type Settings } from '../../src/core/settings/settings.ts';
import { initialSession, type Session } from '../../src/core/session/types.ts';
import type { Lb } from '../../src/core/units/lb.ts';
import type {
  ActiveWorkout,
  NewExerciseLog,
  NewSet,
  NewWorkout,
  WorkoutStatus,
} from '../../src/core/workout/schema.ts';
import type { Commit, Store, UserState, WorkoutWrite } from '../../src/ports/store.ts';
import type { Rendered, Ui } from '../../src/ports/ui.ts';

/** Пользователь 1 в тестах — владелец (ALLOWED_USER_IDS). */
export const OWNERS: ReadonlySet<number> = new Set([1]);
export const TESTER: Person = { name: 'Tester', username: null };

/** Хранилище в памяти с теми же таблицами и выборками, что адаптер Postgres. */

type WorkoutRow = NewWorkout & {
  status: WorkoutStatus;
  comment: string | null;
  finishedAt: Date | null;
};
type LogRow = Omit<NewExerciseLog, 'workoutId'> & {
  workoutId: string | null;
  source: LogSource;
  warmupVariant: string;
  comment: string | null;
  seq: number;
};
type SetRow = NewSet & { seq: number };

export type MemoryStore = Store & {
  readonly sessions: Map<number, Session>;
  readonly settings: Map<number, Settings>;
  readonly programs: Map<string, { program: Program; version: number; active: boolean }>;
  /** Результаты /seed в порядке записи. */
  readonly manual: ManualResult[];
  readonly workouts: Map<string, WorkoutRow>;
  readonly logs: LogRow[];
  readonly sets: SetRow[];
  readonly members: Map<number, Member & { invitedBy: number; revoked: boolean }>;
  readonly invites: Map<string, { createdBy: number; expiresAt: Date; usedBy: number | null }>;
  commits: number;
};

export function memoryStore(): MemoryStore {
  let seq = 0;
  const store: MemoryStore = {
    sessions: new Map(),
    settings: new Map(),
    programs: new Map(),
    manual: [],
    workouts: new Map(),
    logs: [],
    sets: [],
    members: new Map(),
    invites: new Map(),
    commits: 0,
    load(userId: number, opts = { withMembers: false }): Promise<UserState> {
      const settings = store.settings.get(userId) ?? defaultSettings(userId);
      const program = settings.activeProgramId
        ? store.programs.get(settings.activeProgramId)?.program ?? null
        : null;
      const active =
        [...store.workouts.values()].filter((w) => w.status === 'in_progress').at(-1) ?? null;
      const pairIds = program?.intensityPairs.flatMap((p) => [...p.exercises]) ?? [];
      return Promise.resolve({
        session: store.sessions.get(userId) ?? initialSession(userId),
        settings,
        activeProgram: program,
        lastResults: program
          ? lastResults(store, [...exerciseIndex(program).keys()], active?.id ?? null)
          : {},
        activeWorkout: active ? snapshot(store, active) : null,
        lastWorkout: lastWorkout(store),
        intensityLogs: intensityLogs(store, pairIds),
        lastHighLb: lastHigh(store, pairIds),
        members: opts.withMembers
          ? [...store.members.values()].filter((m) => !m.revoked).map((m) => ({
            userId: m.userId,
            person: m.person,
            joinedAt: m.joinedAt,
          }))
          : [],
      });
    },
    isMember: (userId) => Promise.resolve(store.members.get(userId)?.revoked === false),
    redeemInvite(code, userId, person, now): Promise<{ invitedBy: number } | null> {
      const invite = store.invites.get(code);
      if (!invite || invite.usedBy !== null || invite.expiresAt <= now) {
        return Promise.resolve(null);
      }
      invite.usedBy = userId;
      store.members.set(userId, {
        userId,
        person,
        joinedAt: now,
        invitedBy: invite.createdBy,
        revoked: false,
      });
      return Promise.resolve({ invitedBy: invite.createdBy });
    },
    commit(userId: number, change: Commit): Promise<void> {
      store.commits++;
      if (change.newProgram) {
        const key = change.newProgram.program.id;
        const versions = [...store.programs.values()].filter((p) => p.program.id === key);
        for (const p of store.programs.values()) p.active = false;
        store.programs.set(change.newProgram.id, {
          program: change.newProgram.program,
          version: versions.length + 1,
          active: true,
        });
      }
      for (const r of change.manualResults ?? []) {
        store.manual.push(r.result);
        store.logs.push({
          id: r.logId,
          workoutId: null,
          exerciseId: r.result.exerciseId,
          exerciseName: r.result.exerciseName,
          order: 0,
          status: 'done',
          intensity: null,
          plannedWorkWeightLb: null,
          stepLbUsed: r.result.stepLbUsed,
          warmupTier: null,
          localDate: r.result.localDate,
          source: LogSourceSchema.enum.manual_import,
          warmupVariant: 'none',
          comment: r.result.comment,
          seq: ++seq,
        });
        store.sets.push({
          id: r.setId,
          exerciseLogId: r.logId,
          workoutId: '',
          exerciseId: r.result.exerciseId,
          kind: 'work',
          index: 1,
          plannedWeightLb: null,
          plannedReps: null,
          weightLb: r.result.weightLb,
          reps: r.result.reps,
          seq: ++seq,
        });
      }
      for (const w of change.workout?.writes ?? []) apply(store, w, () => ++seq);
      if (change.newInvite) {
        store.invites.set(change.newInvite.code, {
          createdBy: userId,
          expiresAt: change.newInvite.expiresAt,
          usedBy: null,
        });
      }
      const revoked = change.revokeMember === undefined
        ? undefined
        : store.members.get(change.revokeMember);
      if (revoked) revoked.revoked = true;
      store.sessions.set(userId, change.session);
      if (change.settings) store.settings.set(userId, change.settings);
      return Promise.resolve();
    },
    ping: () => Promise.resolve(),
  };
  return store;
}

function apply(store: MemoryStore, w: WorkoutWrite, next: () => number): void {
  switch (w.type) {
    case 'start_workout':
      store.workouts.set(w.workout.id, {
        ...w.workout,
        status: 'in_progress',
        comment: null,
        finishedAt: null,
      });
      return;
    case 'finish_workout': {
      const row = store.workouts.get(w.workoutId);
      if (row) Object.assign(row, { status: w.status, finishedAt: w.finishedAt });
      return;
    }
    case 'comment_workout': {
      const row = store.workouts.get(w.workoutId);
      if (row) row.comment = w.comment;
      return;
    }
    case 'open_exercise_log':
      store.logs.push({
        ...w.log,
        source: LogSourceSchema.enum.workout,
        warmupVariant: 'none',
        comment: null,
        seq: next(),
      });
      return;
    case 'patch_exercise_log': {
      const row = store.logs.find((l) => l.id === w.id);
      if (row) Object.assign(row, w.patch);
      return;
    }
    case 'record_set':
      store.sets.push({ ...w.set, seq: next() });
      return;
  }
}

const workSets = (store: MemoryStore, logId: string): { weightLb: Lb | null; reps: number }[] =>
  store.sets.filter((s) => s.exerciseLogId === logId && s.kind === 'work');

function lastResults(
  store: MemoryStore,
  ids: readonly string[],
  activeId: string | null,
): Record<string, LastResult> {
  const result: Record<string, LastResult> = {};
  const logs = store.logs
    .filter((l) =>
      l.status === 'done' && ids.includes(l.exerciseId) &&
      (l.workoutId === null || l.workoutId !== activeId)
    )
    .sort((a, b) =>
      a.localDate === b.localDate ? a.seq - b.seq : a.localDate < b.localDate ? -1 : 1
    );
  for (const log of logs) {
    const best = topSet(workSets(store, log.id));
    if (best) {
      result[log.exerciseId] = {
        localDate: log.localDate,
        weightLb: best.weightLb,
        reps: best.reps,
        source: log.source,
        comment: log.comment,
      };
    }
  }
  return result;
}

function snapshot(store: MemoryStore, w: WorkoutRow): ActiveWorkout {
  return {
    id: w.id,
    dayId: w.dayId,
    dayName: w.dayName,
    startedAt: w.startedAt,
    localDate: w.localDate,
    logs: store.logs.filter((l) => l.workoutId === w.id).map((l) => ({
      id: l.id,
      exerciseId: l.exerciseId,
      exerciseName: l.exerciseName,
      status: l.status,
      plannedWorkWeightLb: l.plannedWorkWeightLb,
      sets: store.sets.filter((s) => s.exerciseLogId === l.id).map((s) => ({
        kind: s.kind,
        weightLb: s.weightLb,
        reps: s.reps,
      })),
    })),
  };
}

function lastWorkout(store: MemoryStore): UserState['lastWorkout'] {
  const w = [...store.workouts.values()].filter((x) => x.status === 'completed').at(-1);
  return w ? { dayId: w.dayId, dayName: w.dayName, localDate: w.localDate } : null;
}

function intensityLogs(store: MemoryStore, pairIds: readonly string[]): IntensityLog[] {
  return store.logs.flatMap((l) => {
    const w = l.workoutId ? store.workouts.get(l.workoutId) : undefined;
    return w && l.status === 'done' && l.intensity !== null && pairIds.includes(l.exerciseId)
      ? [{ exerciseId: l.exerciseId, isoWeek: w.isoWeek, intensity: l.intensity }]
      : [];
  });
}

function lastHigh(store: MemoryStore, pairIds: readonly string[]): Record<string, Lb> {
  const result: Record<string, Lb> = {};
  for (const l of store.logs) {
    if (l.status !== 'done' || l.intensity !== 'high' || !pairIds.includes(l.exerciseId)) continue;
    const best = topSet(workSets(store, l.id));
    if (best && best.weightLb !== null) result[l.exerciseId] = best.weightLb;
  }
  return result;
}

export type Shown = {
  chatId: number;
  rendered: Rendered;
  stepNo: number;
  messageId: number | null;
};

export function fakeUi(): Ui & { shown: Shown[]; dropped: number[] } {
  const shown: Shown[] = [];
  const dropped: number[] = [];
  return {
    shown,
    dropped,
    show(chatId, rendered, stepNo, messageId): Promise<void> {
      shown.push({ chatId, rendered, stepNo, messageId });
      return Promise.resolve();
    },
    dropKeyboard(_chatId, messageId): Promise<void> {
      dropped.push(messageId);
      return Promise.resolve();
    },
  };
}
