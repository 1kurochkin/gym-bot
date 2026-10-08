import { SetKindSchema, WarmupVariantSchema } from '../history/schema.ts';
import { parseSetInput, type SetInputError } from '../input/set-input.ts';
import { type Exercise, LoadTypeSchema } from '../program/schema.ts';
import type { Lb } from '../units/lb.ts';
import type { WarmupLine } from '../workout/plan.ts';
import type { WorkoutLog } from '../workout/schema.ts';
import { home, moveTo, unchanged, withEffects } from './flow.ts';
import {
  type Effect,
  type Session,
  SessionStepSchema,
  type StepContext,
  type StepResult,
  type WarmupMark,
  WarmupMarkSchema,
} from './types.ts';
import {
  answerCancel,
  atExercise,
  card,
  currentExercise,
  enterExercise,
  idsOf,
  logOf,
  menuScreen,
  repsPrompt,
  type SetView,
  warmupLines,
  warmupScreen,
  type WorkoutContext,
  workoutContext,
  workSetsOf,
} from './workout.ts';

/**
 * Исправления по ходу тренировки (.specs/product.md → US-3, US-4): «Изменить» в разминке,
 * комментарий к разминке, [← Назад] (ничего не удаляет из записанного), просмотр, правка и
 * удаление рабочего подхода, /undo.
 */

const S = SessionStepSchema.enum;
const { warmup } = SetKindSchema.enum;
const { full, custom, none } = WarmupVariantSchema.enum;

/** Запись текущего упражнения в том виде, в каком она в БД (до этого апдейта). */
const currentLog = (ctx: StepContext, c: WorkoutContext): WorkoutLog | undefined =>
  c.exerciseId === null ? undefined : logOf(ctx.activeWorkout, c.exerciseId);

const asView = (sets: WorkoutLog['sets']): SetView[] =>
  sets.map((s) => ({ weightLb: s.weightLb, reps: s.reps }));

// ---------------------------------------------------------------- «Изменить» в разминке

/** [✏️ Изменить]: идём по подходам разминки с первого. */
export function startWarmupDiff(state: Session, ctx: StepContext): StepResult {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  if (!c?.log || !ex || state.step !== S.workout_warmup) return unchanged(state);
  return markScreen(state, ctx, c, ex, 0, false, null);
}

function markScreen(
  state: Session,
  ctx: StepContext,
  c: WorkoutContext,
  ex: Exercise,
  step: number,
  editing: boolean,
  error: SetInputError | null,
): StepResult {
  const lines = warmupLines(ctx, c, ex);
  const line = lines[step];
  if (!line) return unchanged(state);
  return moveTo(state, editing ? S.workout_warmup_edit : S.workout_warmup_mark, {
    type: 'workout_warmup_mark',
    exerciseName: ex.name,
    step: step + 1,
    total: lines.length,
    line,
    addedWeight: ex.loadType === LoadTypeSchema.enum.weighted_bodyweight,
    editing,
    error,
  }, { ...c, warmupStep: step });
}

const MARK_STEPS: ReadonlySet<string> = new Set([S.workout_warmup_mark, S.workout_warmup_edit]);

/** [✅ Готово] / [⏭ Пропустить] записывают подход по плану; [✏️ Изменить] ждёт текст. */
export function markWarmup(state: Session, ctx: StepContext, mark: WarmupMark): StepResult {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  const step = c?.warmupStep ?? null;
  if (!c?.log || !ex || step === null || !MARK_STEPS.has(state.step)) return unchanged(state);
  const line = warmupLines(ctx, c, ex)[step];
  if (!line) return unchanged(state);
  switch (mark) {
    case WarmupMarkSchema.enum.edit:
      return markScreen(state, ctx, c, ex, step, true, null);
    case WarmupMarkSchema.enum.done:
      return recordWarmup(state, ctx, c, ex, step, line, line.weightLb, line.reps, false);
    case WarmupMarkSchema.enum.skip:
      return recordWarmup(state, ctx, c, ex, step, line, line.weightLb, line.reps, true);
  }
}

/** Текст на шаге отметки: «4» — повторения с плановым весом, «135/4» — вес и повторения. */
export function warmupMarkText(state: Session, ctx: StepContext, text: string): StepResult {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  const step = c?.warmupStep ?? null;
  if (!c?.log || !ex || step === null) return unchanged(state);
  const line = warmupLines(ctx, c, ex)[step];
  if (!line) return unchanged(state);
  const parsed = parseSetInput(text, { loadType: ex.loadType, suggestedLb: line.weightLb });
  if (!parsed.ok) return markScreen(state, ctx, c, ex, step, true, parsed.error);
  const weight = parsed.value.weightLb ?? line.weightLb;
  return recordWarmup(state, ctx, c, ex, step, line, weight, parsed.value.reps, false);
}

function recordWarmup(
  state: Session,
  ctx: StepContext,
  c: WorkoutContext,
  ex: Exercise,
  step: number,
  line: WarmupLine,
  weightLb: Lb,
  reps: number,
  skipped: boolean,
): StepResult {
  const log = c.log;
  if (!log) return unchanged(state);
  const record: Effect = {
    type: 'record_set',
    set: {
      id: idsOf(ctx)(),
      exerciseLogId: log.id,
      workoutId: c.workoutId,
      exerciseId: ex.id,
      kind: warmup,
      index: step + 1,
      plannedWeightLb: line.weightLb,
      plannedReps: line.reps,
      weightLb,
      reps,
      skipped,
    },
  };
  const lines = warmupLines(ctx, c, ex);
  if (step + 1 < lines.length) {
    return withEffects(markScreen(state, ctx, c, ex, step + 1, false, null), [record]);
  }
  // Последний подход: вариант — custom, если хоть один отличался от плана.
  const earlier = (currentLog(ctx, c)?.sets ?? []).filter((s) => s.kind === warmup);
  const differs = skipped || weightLb !== line.weightLb || reps !== line.reps ||
    earlier.some((s) => {
      const planned = lines[s.index - 1];
      return s.skipped || !planned || s.weightLb !== planned.weightLb || s.reps !== planned.reps;
    });
  return withEffects(repsPrompt(state, ctx, c, ex), [record, {
    type: 'patch_exercise_log',
    id: log.id,
    patch: { warmupVariant: differs ? custom : full },
  }]);
}

// ---------------------------------------------------------------- комментарий к разминке

/** [💬 Комментарий] на экране разминки. */
export function requestWarmupComment(state: Session, ctx: StepContext): StepResult {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  if (!c?.log || !ex || state.step !== S.workout_warmup) return unchanged(state);
  return moveTo(state, S.workout_warmup_comment, {
    type: 'workout_warmup_comment_prompt',
    exerciseName: ex.name,
  }, c);
}

export function warmupCommentText(state: Session, ctx: StepContext, text: string): StepResult {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  if (!c?.log || !ex) return unchanged(state);
  const shown = warmupScreen(state, ctx, c, ex, true) ?? repsPrompt(state, ctx, c, ex);
  return withEffects(shown, [
    { type: 'patch_exercise_log', id: c.log.id, patch: { warmupComment: text.trim() } },
  ]);
}

// ---------------------------------------------------------------- [← Назад]

/** [← Назад] на любом экране тренировки: на предыдущий экран, записанное не удаляется (US-4). */
export function goBack(state: Session, ctx: StepContext): StepResult {
  const active = ctx.activeWorkout;
  switch (state.step) {
    case S.workout_day:
    case S.workout_menu:
      return toHome(state, ctx);
    case S.workout_cancel_confirm:
      return answerCancel(state, ctx, false);
    case S.workout_add:
    case S.workout_menu_comment:
      return active ? menuScreen(state, ctx, active, false) : unchanged(state);
  }
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  if (!c || !ex || !active) return unchanged(state);

  switch (state.step) {
    case S.workout_card:
      return menuScreen(state, ctx, active, false);
    case S.workout_comment:
      return repsPrompt(state, ctx, c, ex);
    case S.workout_warmup_comment:
      return warmupScreen(state, ctx, c, ex, false) ?? repsPrompt(state, ctx, c, ex);
    case S.workout_set_view:
    case S.workout_set_edit: {
      const k = c.viewSet ?? 1;
      return k > 1 ? setView(state, ctx, c, ex, k - 1, false, null) : leaveExercise(state, ctx, c);
    }
  }
  if (!c.log) return unchanged(state);
  const log = currentLog(ctx, c);
  const warmupSets = (log?.sets ?? []).filter((s) => s.kind === warmup);

  if (state.step === S.workout_warmup) return backToCard(state, ctx, c, ex);

  if (MARK_STEPS.has(state.step)) {
    const step = c.warmupStep ?? 0;
    if (step === 0) return warmupScreen(state, ctx, c, ex, false) ?? unchanged(state);
    const previous = warmupSets.filter((s) => s.index === step);
    return withEffects(markScreen(state, ctx, c, ex, step - 1, false, null), [
      { type: 'delete_sets', ids: previous.map((s) => s.id) },
    ]);
  }

  if (state.step !== S.workout_reps) return unchanged(state);
  const works = workSetsOf(log);
  if (works.length > 0) return setView(state, ctx, c, ex, works.length, false, null);
  // Подходов нет: reps_only — в меню (пустая запись удаляется); иначе — к разминке или весу.
  if (ex.loadType === LoadTypeSchema.enum.reps_only) return leaveExercise(state, ctx, c);
  const effects: Effect[] = [];
  if (warmupSets.length > 0) {
    effects.push({ type: 'delete_sets', ids: warmupSets.map((s) => s.id) }, {
      type: 'patch_exercise_log',
      id: c.log.id,
      patch: { warmupVariant: none },
    });
  }
  const shown = warmupScreen(state, ctx, c, ex, false);
  return shown ? withEffects(shown, effects) : backToCard(state, ctx, c, ex);
}

function toHome(state: Session, ctx: StepContext): StepResult {
  const zone = ctx.settings.timezone;
  return zone ? home(state, zone, ctx) : unchanged(state);
}

/** Из упражнения — в меню; пустая запись (ничего не записано) удаляется. */
function leaveExercise(state: Session, ctx: StepContext, c: WorkoutContext): StepResult {
  const active = ctx.activeWorkout;
  if (!active) return unchanged(state);
  const log = currentLog(ctx, c) ?? active.logs.find((l) => l.id === c.log?.id);
  const empty = log && log.sets.length === 0;
  const after = empty ? { ...active, logs: active.logs.filter((l) => l.id !== log.id) } : active;
  return withEffects(
    menuScreen(state, ctx, after, false),
    empty ? [{ type: 'delete_exercise_log', id: log.id }] : [],
  );
}

/** К выбору рабочего веса: запись упражнения (пока без подходов) удаляется. */
function backToCard(
  state: Session,
  ctx: StepContext,
  c: WorkoutContext,
  ex: Exercise,
): StepResult {
  if (!c.log) return unchanged(state);
  const fresh: WorkoutContext = { ...c, log: null, warmupStep: null };
  return withEffects(card(state, ctx, fresh, ex, false), [
    { type: 'delete_exercise_log', id: c.log.id },
  ]);
}

// ---------------------------------------------------------------- просмотр подхода

function setView(
  state: Session,
  ctx: StepContext,
  c: WorkoutContext,
  ex: Exercise,
  k: number,
  editing: boolean,
  error: SetInputError | null,
): StepResult {
  const works = workSetsOf(currentLog(ctx, c));
  const set = works[k - 1];
  if (!set) return repsPrompt(state, ctx, c, ex);
  return moveTo(state, editing ? S.workout_set_edit : S.workout_set_view, {
    type: 'workout_set_view',
    exerciseName: ex.name,
    index: k,
    set: { weightLb: set.weightLb, reps: set.reps },
    addedWeight: ex.loadType === LoadTypeSchema.enum.weighted_bodyweight,
    current: works.length + 1,
    editing,
    error,
  }, { ...c, viewSet: k });
}

const VIEW_STEPS: ReadonlySet<string> = new Set([S.workout_set_view, S.workout_set_edit]);

/** [✏️ Изменить]: ждём текст «7» или «185/7». */
export function requestSetEdit(state: Session, ctx: StepContext): StepResult {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  if (!c || !ex || c.viewSet === null || !VIEW_STEPS.has(state.step)) return unchanged(state);
  return setView(state, ctx, c, ex, c.viewSet, true, null);
}

/** Текст на просмотре подхода: перезаписать его и вернуться к вводу. */
export function setEditText(state: Session, ctx: StepContext, text: string): StepResult {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  if (!c || !ex || c.viewSet === null) return unchanged(state);
  const works = workSetsOf(currentLog(ctx, c));
  const set = works[c.viewSet - 1];
  if (!set) return repsPrompt(state, ctx, c, ex);
  const parsed = parseSetInput(text, { loadType: ex.loadType, suggestedLb: set.weightLb });
  if (!parsed.ok) return setView(state, ctx, c, ex, c.viewSet, true, parsed.error);
  const { weightLb, reps } = parsed.value;
  const recorded = works.map((s) =>
    s.id === set.id ? { weightLb, reps } : { weightLb: s.weightLb, reps: s.reps }
  );
  return withEffects(
    repsPrompt(state, ctx, c, ex, { recorded, notice: { kind: 'fixed', index: c.viewSet } }),
    [{ type: 'update_set', id: set.id, weightLb, reps }],
  );
}

/** [🗑 Удалить]: подход удаляется, бот возвращается к вводу. */
export function deleteViewedSet(state: Session, ctx: StepContext): StepResult {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  if (!c || !ex || c.viewSet === null || !VIEW_STEPS.has(state.step)) return unchanged(state);
  const works = workSetsOf(currentLog(ctx, c));
  const set = works[c.viewSet - 1];
  if (!set) return repsPrompt(state, ctx, c, ex);
  return withEffects(
    repsPrompt(state, ctx, c, ex, {
      recorded: asView(works.filter((s) => s.id !== set.id)),
      notice: { kind: 'deleted', index: c.viewSet },
    }),
    [{ type: 'delete_sets', ids: [set.id] }],
  );
}

/** [➡️ К подходу N]: обратно к вводу. */
export function forwardToInput(state: Session, ctx: StepContext): StepResult {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  if (!c || !ex || !VIEW_STEPS.has(state.step)) return unchanged(state);
  return repsPrompt(state, ctx, c, ex);
}

// ---------------------------------------------------------------- /undo

/** Шаги, на которых /undo имеет смысл: тренировка идёт, сводки ещё нет. */
const UNDO_STEPS: ReadonlySet<string> = new Set([
  S.workout_menu,
  S.workout_add,
  S.workout_card,
  S.workout_warmup,
  S.workout_warmup_mark,
  S.workout_warmup_edit,
  S.workout_warmup_comment,
  S.workout_reps,
  S.workout_set_view,
  S.workout_set_edit,
  S.workout_comment,
]);

/**
 * /undo: удалить последний рабочий подход тренировки и вернуться к его вводу. Если у последнего
 * упражнения рабочих подходов нет, но отмечена разминка — удаляется разминка, бот показывает её.
 */
export function undo(state: Session, ctx: StepContext): StepResult {
  const active = ctx.activeWorkout;
  const nothing = moveTo(state, state.step, { type: 'workout_undo_nothing' }, state.context);
  const c = workoutContext(state);
  if (!active || !c || !UNDO_STEPS.has(state.step)) return nothing;
  const lastWithWork = [...active.logs].reverse().find((l) => workSetsOf(l).length > 0);
  const lastWithWarmup = [...active.logs].reverse().find((l) =>
    l.sets.some((s) => s.kind === warmup)
  );
  const log = lastWithWork ?? lastWithWarmup;
  if (!log) return nothing;
  const at = atExercise(c, log.exerciseId);
  const ex = currentExercise(ctx, at);
  if (!ex) return nothing;

  const works = workSetsOf(log);
  const lastWork = works.at(-1);
  if (lastWork) {
    const rest = works.slice(0, -1);
    const next: WorkoutContext = {
      ...at,
      log: {
        id: log.id,
        workLb: lastWork.weightLb ?? log.plannedWorkWeightLb,
        workSets: rest.length,
      },
    };
    const undone = { weightLb: lastWork.weightLb, reps: lastWork.reps };
    return withEffects(
      repsPrompt(state, ctx, next, ex, {
        recorded: asView(rest),
        notice: { kind: 'undone', set: undone },
      }),
      [{ type: 'delete_sets', ids: [lastWork.id] }],
    );
  }
  const warmups = log.sets.filter((s) => s.kind === warmup);
  const next: WorkoutContext = {
    ...at,
    log: { id: log.id, workLb: log.plannedWorkWeightLb, workSets: 0 },
  };
  const shown = warmupScreen(state, ctx, next, ex, false) ?? enterExercise(state, ctx, at);
  return withEffects(shown, [
    { type: 'delete_sets', ids: warmups.map((s) => s.id) },
    { type: 'patch_exercise_log', id: log.id, patch: { warmupVariant: none } },
  ]);
}
