import { ExerciseLogStatusSchema, SetKindSchema } from '../history/schema.ts';
import { parseSetInput, type SetInputError } from '../input/set-input.ts';
import { exerciseIndex } from '../program/program.ts';
import { type LoadType, LoadTypeSchema } from '../program/schema.ts';
import type { HistoryQuery, WorkoutLog } from '../workout/schema.ts';
import { moveTo, unchanged, withEffects } from './flow.ts';
import {
  type BotEvent,
  type HistoryNotice,
  HistoryNoticeSchema,
  type Session,
  type SessionContext,
  SessionStepSchema,
  type StepContext,
  type StepResult,
  type SummaryItem,
} from './types.ts';

const S = SessionStepSchema.enum;
const { work } = SetKindSchema.enum;
const { skipped } = ExerciseLogStatusSchema.enum;

type HistoryContext = Extract<SessionContext, { kind: 'history' }>;

const HISTORY_STEPS: ReadonlySet<string> = new Set([
  S.history_list,
  S.history_workout,
  S.history_exercise,
  S.history_set,
  S.history_add,
  S.history_delete_set,
  S.history_delete_workout,
]);
export const isHistory = (state: Session): boolean => HISTORY_STEPS.has(state.step);

const historyContext = (state: Session): HistoryContext | null =>
  state.context.kind === 'history' && isHistory(state) ? state.context : null;

const listContext = (offset: number): HistoryContext => ({
  kind: 'history',
  offset,
  workoutId: null,
  logId: null,
  setId: null,
});

export function historyQuery(state: Session, event: BotEvent): HistoryQuery | null {
  const c = state.context.kind === 'history' ? state.context : null;
  switch (event.type) {
    case 'history_requested':
      return { offset: 0, workoutId: null };
    case 'history_page':
      return { offset: event.offset, workoutId: null };
    case 'history_workout_picked':
      return { offset: c?.offset ?? 0, workoutId: event.workoutId };
    default:
      return c && isHistory(state) ? { offset: c.offset, workoutId: c.workoutId } : null;
  }
}

export function openHistory(state: Session, ctx: StepContext, offset = 0): StepResult {
  return listScreen(state, ctx, offset, false);
}

function listScreen(
  state: Session,
  ctx: StepContext,
  offset: number,
  deleted: boolean,
): StepResult {
  const page = ctx.history.page;
  return moveTo(state, S.history_list, {
    type: 'history_list',
    items: page?.items ?? [],
    offset,
    hasMore: page?.hasMore ?? false,
    deleted,
  }, listContext(offset));
}

export function turnPage(state: Session, ctx: StepContext, offset: number): StepResult {
  return state.step === S.history_list ? listScreen(state, ctx, offset, false) : unchanged(state);
}

export function pickWorkout(state: Session, ctx: StepContext, workoutId: string): StepResult {
  const c = historyContext(state);
  if (!c || state.step !== S.history_list) return unchanged(state);
  return workoutScreen(state, ctx, { ...listContext(c.offset), workoutId });
}

function workoutScreen(state: Session, ctx: StepContext, c: HistoryContext): StepResult {
  const w = ctx.history.workout;
  if (!w || w.id !== c.workoutId) return listScreen(state, ctx, c.offset, false);
  const logs = w.logs;
  return moveTo(state, S.history_workout, {
    type: 'history_workout',
    dayName: w.dayName,
    localDate: w.localDate,
    items: logs.map((l) => summaryItem(ctx, l)),
    exercises: logs.filter((l) => l.status !== skipped).map((l) => ({
      logId: l.id,
      name: l.exerciseName,
    })),
  }, { ...c, logId: null, setId: null });
}

function summaryItem(ctx: StepContext, log: WorkoutLog): SummaryItem {
  const names = ctx.activeProgram ? exerciseIndex(ctx.activeProgram) : new Map();
  return {
    name: log.exerciseName,
    replaces: log.substitutedFor === null
      ? null
      : names.get(log.substitutedFor)?.name ?? log.substitutedFor,
    skipped: log.status === skipped,
    addedWeight: loadTypeOf(ctx, log) === LoadTypeSchema.enum.weighted_bodyweight,
    sets: workSets(log).map((s) => ({ weightLb: s.weightLb, reps: s.reps })),
    last: null,
  };
}

const workSets = (log: WorkoutLog): WorkoutLog['sets'] =>
  log.sets.filter((s) => s.kind === work && !s.skipped);

function loadTypeOf(ctx: StepContext, log: WorkoutLog): LoadType {
  const ex = ctx.activeProgram && exerciseIndex(ctx.activeProgram).get(log.exerciseId);
  if (ex) return ex.loadType;
  return workSets(log).every((s) => s.weightLb === null)
    ? LoadTypeSchema.enum.reps_only
    : LoadTypeSchema.enum.machine;
}

export function pickExercise(state: Session, ctx: StepContext, logId: string): StepResult {
  const c = historyContext(state);
  if (!c || state.step !== S.history_workout) return unchanged(state);
  return exerciseScreen(state, ctx, { ...c, logId }, null);
}

function currentLog(ctx: StepContext, c: HistoryContext): WorkoutLog | undefined {
  return ctx.history.workout?.logs.find((l) => l.id === c.logId);
}

function exerciseScreen(
  state: Session,
  ctx: StepContext,
  c: HistoryContext,
  notice: HistoryNotice | null,
  sets?: WorkoutLog['sets'],
): StepResult {
  const log = currentLog(ctx, c);
  const w = ctx.history.workout;
  if (!log || !w) return workoutScreen(state, ctx, c);
  return moveTo(state, S.history_exercise, {
    type: 'history_exercise',
    name: log.exerciseName,
    localDate: w.localDate,
    addedWeight: loadTypeOf(ctx, log) === LoadTypeSchema.enum.weighted_bodyweight,
    sets: (sets ?? workSets(log)).map((s, i) => ({
      id: s.id,
      index: i + 1,
      weightLb: s.weightLb,
      reps: s.reps,
    })),
    notice,
  }, { ...c, setId: null });
}

export function pickSet(state: Session, ctx: StepContext, setId: string): StepResult {
  const c = historyContext(state);
  if (!c || state.step !== S.history_exercise) return unchanged(state);
  return setScreen(state, ctx, { ...c, setId }, null);
}

export function requestAddSet(state: Session, ctx: StepContext): StepResult {
  const c = historyContext(state);
  if (!c || state.step !== S.history_exercise) return unchanged(state);
  return setScreen(state, ctx, { ...c, setId: null }, null);
}

function setScreen(
  state: Session,
  ctx: StepContext,
  c: HistoryContext,
  error: SetInputError | null,
): StepResult {
  const log = currentLog(ctx, c);
  if (!log) return workoutScreen(state, ctx, c);
  const sets = workSets(log);
  const i = c.setId === null ? sets.length : sets.findIndex((s) => s.id === c.setId);
  const set = c.setId === null ? null : sets[i];
  if (c.setId !== null && !set) return exerciseScreen(state, ctx, c, null);
  return moveTo(state, c.setId === null ? S.history_add : S.history_set, {
    type: 'history_set',
    name: log.exerciseName,
    index: i + 1,
    set: set ? { weightLb: set.weightLb, reps: set.reps } : null,
    addedWeight: loadTypeOf(ctx, log) === LoadTypeSchema.enum.weighted_bodyweight,
    weightless: loadTypeOf(ctx, log) === LoadTypeSchema.enum.reps_only,
    error,
  }, c);
}

export function historyText(state: Session, ctx: StepContext, text: string): StepResult {
  const c = historyContext(state);
  if (!c || (state.step !== S.history_set && state.step !== S.history_add)) return unchanged(state);
  const log = currentLog(ctx, c);
  if (!log) return workoutScreen(state, ctx, c);
  const sets = workSets(log);
  const set = sets.find((s) => s.id === c.setId) ?? null;
  const suggested = set?.weightLb ?? sets.at(-1)?.weightLb ?? null;
  const parsed = parseSetInput(text, { loadType: loadTypeOf(ctx, log), suggestedLb: suggested });
  if (!parsed.ok) return setScreen(state, ctx, c, parsed.error);
  const { weightLb, reps } = parsed.value;

  if (set) {
    const next = sets.map((s) => s.id === set.id ? { ...s, weightLb, reps } : s);
    return withEffects(
      exerciseScreen(state, ctx, c, HistoryNoticeSchema.enum.fixed, next),
      [{ type: 'update_set', id: set.id, weightLb, reps }],
    );
  }
  const added = {
    id: '',
    kind: work,
    index: sets.length + 1,
    weightLb,
    reps,
    skipped: false,
  };
  return withEffects(
    exerciseScreen(state, ctx, c, HistoryNoticeSchema.enum.added, [...sets, added]),
    [{ type: 'add_set', id: ctx.newIds[0] ?? '', logId: log.id, weightLb, reps }],
  );
}

export function requestDelete(state: Session, ctx: StepContext): StepResult {
  const c = historyContext(state);
  if (!c) return unchanged(state);
  if (state.step === S.history_set) {
    const log = currentLog(ctx, c);
    const sets = log ? workSets(log) : [];
    const i = sets.findIndex((s) => s.id === c.setId);
    const set = sets[i];
    if (!log || !set) return unchanged(state);
    return moveTo(state, S.history_delete_set, {
      type: 'history_delete_set',
      index: i + 1,
      set: { weightLb: set.weightLb, reps: set.reps },
      addedWeight: loadTypeOf(ctx, log) === LoadTypeSchema.enum.weighted_bodyweight,
    }, c);
  }
  const w = ctx.history.workout;
  if (state.step === S.history_workout && w) {
    return moveTo(state, S.history_delete_workout, {
      type: 'history_delete_workout',
      dayName: w.dayName,
      localDate: w.localDate,
    }, c);
  }
  return unchanged(state);
}

export function answerDelete(state: Session, ctx: StepContext, confirm: boolean): StepResult {
  const c = historyContext(state);
  if (!c) return unchanged(state);
  if (state.step === S.history_delete_set) {
    if (!confirm || c.setId === null) return setScreen(state, ctx, c, null);
    const log = currentLog(ctx, c);
    const rest = log ? workSets(log).filter((s) => s.id !== c.setId) : [];
    return withEffects(
      exerciseScreen(state, ctx, c, HistoryNoticeSchema.enum.deleted, rest),
      [{ type: 'delete_sets', ids: [c.setId] }],
    );
  }
  if (state.step === S.history_delete_workout) {
    if (!confirm || c.workoutId === null) return workoutScreen(state, ctx, c);
    const id = c.workoutId;
    const page = ctx.history.page;
    const ctxAfter: StepContext = {
      ...ctx,
      history: {
        ...ctx.history,
        page: page && { ...page, items: page.items.filter((i) => i.id !== id) },
      },
    };
    return withEffects(listScreen(state, ctxAfter, c.offset, true), [
      { type: 'delete_workout', id },
    ]);
  }
  return unchanged(state);
}

export function historyBack(state: Session, ctx: StepContext): StepResult {
  const c = historyContext(state);
  if (!c) return unchanged(state);
  switch (state.step) {
    case S.history_workout:
      return listScreen(state, ctx, c.offset, false);
    case S.history_exercise:
      return workoutScreen(state, ctx, c);
    case S.history_set:
    case S.history_add:
      return exerciseScreen(state, ctx, c, null);
    default:
      return unchanged(state);
  }
}
