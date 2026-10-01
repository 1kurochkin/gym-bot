import { ExerciseLogStatusSchema, SetKindSchema, WarmupVariantSchema } from '../history/schema.ts';
import { parseSetInput, type SetInputError } from '../input/set-input.ts';
import { dayExercises, exerciseIndex } from '../program/program.ts';
import { type Exercise, LoadTypeSchema } from '../program/schema.ts';
import type { Lb } from '../units/lb.ts';
import type { WarmupLine } from '../workout/plan.ts';
import type { WorkoutLog } from '../workout/schema.ts';
import { moveTo, unchanged, withEffects } from './flow.ts';
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
  atSlot,
  card,
  cardIntensity,
  currentExercise,
  idsOf,
  openSlots,
  repsPrompt,
  showExercise,
  slotExercise,
  slotId,
  warmupLines,
  warmupScreen,
  type WorkoutContext,
  workoutContext,
} from './workout.ts';

/**
 * Исправления по ходу тренировки (.specs/product.md → US-3, US-4): «Отметить отличия» в разминке,
 * комментарий к разминке, [← Назад] до первого рабочего подхода, /undo и [✏️ Исправить],
 * замена упражнения и другой порядок.
 */

const S = SessionStepSchema.enum;
const { warmup, work } = SetKindSchema.enum;
const { full, custom, none } = WarmupVariantSchema.enum;
const { skipped } = ExerciseLogStatusSchema.enum;

/** Запись текущего упражнения в том виде, в каком она в БД (до этого апдейта). */
const currentLog = (ctx: StepContext, c: WorkoutContext): WorkoutLog | undefined =>
  ctx.activeWorkout?.logs.find((l) => l.id === c.log?.id);

// ---------------------------------------------------------------- «Отметить отличия»

/** [✏️ Отметить отличия]: идём по подходам разминки с первого. */
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
  return withEffects(
    repsPrompt(state, ctx, c, ex, null, null, { canCommentWarmup: true }),
    [record, {
      type: 'patch_exercise_log',
      id: log.id,
      patch: { warmupVariant: differs ? custom : full },
    }],
  );
}

// ---------------------------------------------------------------- комментарий к разминке

export function requestWarmupComment(state: Session, ctx: StepContext): StepResult {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  if (!c?.log || !ex || state.step !== S.workout_reps || c.log.workSets > 0) {
    return unchanged(state);
  }
  return moveTo(state, S.workout_warmup_comment, {
    type: 'workout_warmup_comment_prompt',
    exerciseName: ex.name,
  }, c);
}

export function warmupCommentText(state: Session, ctx: StepContext, text: string): StepResult {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  if (!c?.log || !ex) return unchanged(state);
  return withEffects(repsPrompt(state, ctx, c, ex, null, null), [
    { type: 'patch_exercise_log', id: c.log.id, patch: { warmupComment: text.trim() } },
  ]);
}

// ---------------------------------------------------------------- [← Назад]

/** Назад — только до первого рабочего подхода: разминка → вес, отметка → предыдущая, подход → разминка. */
export function goBack(state: Session, ctx: StepContext): StepResult {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  if (c && (state.step === S.workout_replace || state.step === S.workout_reorder)) {
    return showExercise(state, ctx, c);
  }
  if (!c?.log || !ex) return unchanged(state);
  const log = currentLog(ctx, c);
  const warmupSets = (log?.sets ?? []).filter((s) => s.kind === warmup);

  if (state.step === S.workout_warmup) return backToCard(state, ctx, c, ex);

  if (MARK_STEPS.has(state.step)) {
    const step = c.warmupStep ?? 0;
    if (step === 0) return warmupScreen(state, ctx, c, ex) ?? unchanged(state);
    const previous = warmupSets.filter((s) => s.index === step);
    return withEffects(markScreen(state, ctx, c, ex, step - 1, false, null), [
      { type: 'delete_sets', ids: previous.map((s) => s.id) },
    ]);
  }

  if (state.step === S.workout_reps && c.log.workSets === 0) {
    const effects: Effect[] = [];
    if (warmupSets.length > 0) {
      effects.push({ type: 'delete_sets', ids: warmupSets.map((s) => s.id) }, {
        type: 'patch_exercise_log',
        id: c.log.id,
        patch: { warmupVariant: none },
      });
    }
    const shown = warmupScreen(state, ctx, c, ex);
    return shown ? withEffects(shown, effects) : backToCard(state, ctx, c, ex);
  }
  return unchanged(state);
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
  return withEffects(card(state, ctx, fresh, ex, cardIntensity(ctx, fresh, ex), false), [
    { type: 'delete_exercise_log', id: c.log.id },
  ]);
}

// ---------------------------------------------------------------- /undo и [✏️ Исправить]

/** Шаги, на которых /undo имеет смысл: тренировка идёт, сводки ещё нет. */
const UNDO_STEPS: ReadonlySet<string> = new Set([
  S.workout_intensity,
  S.workout_card,
  S.workout_warmup,
  S.workout_warmup_mark,
  S.workout_warmup_edit,
  S.workout_warmup_comment,
  S.workout_reps,
  S.workout_after_set,
  S.workout_comment,
]);

/**
 * Удалить последнюю запись тренировки и вернуться к её вводу: рабочий подход → ввод подхода;
 * разминка без рабочих → экран разминки; пропуск упражнения → его карточка.
 * Пустая запись текущего упражнения (вес выбран, пресс открыт) — позиция, а не запись:
 * она удаляется заодно, отменяется то, что записано до неё.
 */
export function undo(state: Session, ctx: StepContext): StepResult {
  const active = ctx.activeWorkout;
  const program = ctx.activeProgram;
  const nothing = moveTo(state, state.step, { type: 'workout_undo_nothing' }, state.context);
  const c = workoutContext(state);
  if (!active || !program || !c || !UNDO_STEPS.has(state.step)) return nothing;
  const current = active.logs.find((l) => l.id === c.log?.id && l.sets.length === 0);
  const log = active.logs.filter((l) =>
    l !== current && (l.status === skipped || l.sets.length > 0)
  ).at(-1);
  if (!log) return nothing;
  const dropCurrent: Effect[] = current ? [{ type: 'delete_exercise_log', id: current.id }] : [];
  const index = dayExercises(program, active.dayId).findIndex((e) => e.id === slotId(log));
  const base: WorkoutContext = {
    ...atSlot(c, index),
    exerciseId: log.substitutedFor === null ? null : log.exerciseId,
  };
  const ex = currentExercise(ctx, base);
  if (index < 0 || !ex) return nothing;

  const works = log.sets.filter((s) => s.kind === work);
  const warmups = log.sets.filter((s) => s.kind === warmup);
  const lastWork = works.at(-1);

  if (lastWork) {
    const workLb = lastWork.weightLb ?? log.plannedWorkWeightLb;
    const next: WorkoutContext = {
      ...base,
      log: { id: log.id, workLb, workSets: works.length - 1 },
    };
    const undone = { weightLb: lastWork.weightLb, reps: lastWork.reps };
    return withEffects(repsPrompt(state, ctx, next, ex, null, null, { undone }), [
      ...dropCurrent,
      { type: 'delete_sets', ids: [lastWork.id] },
    ]);
  }

  if (warmups.length > 0) {
    const next: WorkoutContext = {
      ...base,
      log: { id: log.id, workLb: log.plannedWorkWeightLb, workSets: 0 },
    };
    const shown = warmupScreen(state, ctx, next, ex);
    if (shown) {
      return withEffects(shown, [
        ...dropCurrent,
        { type: 'delete_sets', ids: warmups.map((s) => s.id) },
        { type: 'patch_exercise_log', id: log.id, patch: { warmupVariant: none } },
      ]);
    }
  }

  return withEffects(card(state, ctx, base, ex, cardIntensity(ctx, base, ex), false), [
    ...dropCurrent,
    { type: 'delete_exercise_log', id: log.id },
  ]);
}

// ---------------------------------------------------------------- замена и порядок

/**
 * Откуда можно уйти к другому упражнению: карточка или первый подход упражнения без карточки
 * (reps_only), пока ничего не записано. Пустая запись такого упражнения удаляется.
 */
function leaving(
  state: Session,
  ctx: StepContext,
): { c: WorkoutContext; ex: Exercise; drop: Effect[] } | null {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  if (!c || !ex) return null;
  if (state.step === S.workout_card) return { c: { ...c, log: null }, ex, drop: [] };
  const empty = ex.loadType === LoadTypeSchema.enum.reps_only && c.log?.workSets === 0;
  if (state.step !== S.workout_reps || !empty || !c.log) return null;
  return {
    c: { ...c, log: null },
    ex,
    drop: [{ type: 'delete_exercise_log', id: c.log.id }],
  };
}

/** [🔄 Заменить]: упражнения программы, кроме текущего (заменённое — тоже, чтобы вернуть). */
export function requestReplace(state: Session, ctx: StepContext): StepResult {
  const from = leaving(state, ctx);
  if (!from || !ctx.activeProgram) return unchanged(state);
  const options = [...exerciseIndex(ctx.activeProgram).values()]
    .filter((e) => e.id !== from.ex.id)
    .map((e) => ({ id: e.id, name: e.name }));
  return withEffects(
    moveTo(state, S.workout_replace, {
      type: 'workout_replace',
      exerciseName: from.ex.name,
      options,
    }, from.c),
    from.drop,
  );
}

export function chooseReplace(state: Session, ctx: StepContext, exerciseId: string): StepResult {
  const c = workoutContext(state);
  const program = ctx.activeProgram;
  if (!c || !program || state.step !== S.workout_replace) return unchanged(state);
  if (!exerciseIndex(program).has(exerciseId)) return unchanged(state);
  const slot = slotExercise(ctx, c);
  return showExercise(state, ctx, {
    ...atSlot(c, c.index),
    exerciseId: exerciseId === slot?.id ? null : exerciseId,
  });
}

/** [🔀 Другое упражнение]: невыполненные места дня, кроме текущего. */
export function requestReorder(state: Session, ctx: StepContext): StepResult {
  const from = leaving(state, ctx);
  const program = ctx.activeProgram;
  if (!from || !program) return unchanged(state);
  const exercises = dayExercises(program, from.c.dayId);
  const options = openSlots(ctx, ctx.activeWorkout)
    .filter((i) => i !== from.c.index)
    .flatMap((index) => {
      const e = exercises[index];
      return e ? [{ index, name: e.name }] : [];
    });
  if (options.length === 0) return unchanged(state);
  return withEffects(
    moveTo(state, S.workout_reorder, { type: 'workout_reorder', options }, from.c),
    from.drop,
  );
}

export function chooseReorder(state: Session, ctx: StepContext, index: number): StepResult {
  const c = workoutContext(state);
  if (!c || state.step !== S.workout_reorder) return unchanged(state);
  if (!openSlots(ctx, ctx.activeWorkout).includes(index)) return unchanged(state);
  return showExercise(state, ctx, atSlot(c, index));
}
