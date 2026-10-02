import {
  type ExerciseLogStatus,
  ExerciseLogStatusSchema,
  SetKindSchema,
  type WarmupVariant,
  WarmupVariantSchema,
} from '../history/schema.ts';
import { parseLbNumber, parseSetInput, type SetInputError } from '../input/set-input.ts';
import { dayExercises, exerciseIndex } from '../program/program.ts';
import {
  type Exercise,
  type Intensity,
  IntensitySchema,
  LoadTypeSchema,
} from '../program/schema.ts';
import { weightGrid, weightStep } from '../program/weight-step.ts';
import { perSide } from '../units/weight-grid.ts';
import { isoWeekOf, localDateOf } from '../schedule/calendar.ts';
import { activeNotes, pairIntensity, weekIntensities } from '../schedule/intensity.ts';
import { nextDay } from '../schedule/rotation.ts';
import { utcOffsetMinutes } from '../schedule/timezone.ts';
import { type Lb, lb } from '../units/lb.ts';
import {
  pairOf,
  repOptions,
  suggestedWeight,
  warmupFor,
  type WarmupLine,
  weightOptions,
} from '../workout/plan.ts';
import { type ActiveWorkout, type WorkoutStatus, WorkoutStatusSchema } from '../workout/schema.ts';
import { home, moveTo, unchanged, withEffects } from './flow.ts';
import { askTime } from './onboarding.ts';
import {
  type Effect,
  type ResumeChoice,
  ResumeChoiceSchema,
  type Session,
  type SessionContext,
  SessionStepSchema,
  type StepContext,
  type StepResult,
  type View,
} from './types.ts';

/** Тренировка — US-2…US-5 (.specs/product.md). */

const S = SessionStepSchema.enum;
const { done, skipped } = ExerciseLogStatusSchema.enum;
const { warmup, work } = SetKindSchema.enum;
const { full } = WarmupVariantSchema.enum;
const { completed, aborted } = WorkoutStatusSchema.enum;

/** Незавершённую тренировку старше этого предлагаем не продолжать, а закрыть (US-2). */
const RESUME_WINDOW_MS = 12 * 60 * 60 * 1000;
const MAX_WEIGHT_LB = 1500;

export type WorkoutContext = Extract<SessionContext, { kind: 'workout' }>;
/** Интенсивность упражнения и всей недели с учётом выбора пользователя. */
type IntensityInfo = { value: Intensity; byExercise: Readonly<Record<string, Intensity>> };
type Ids = () => string;

export const idsOf = (ctx: StepContext): Ids => {
  let i = 0;
  return () => ctx.newIds[i++] ?? `missing-id-${i}`;
};

// ---------------------------------------------------------------- начало и продолжение

/** /workout: продолжить незавершённую, закрыть старую или выбрать день. */
export function requestWorkout(state: Session, ctx: StepContext): StepResult {
  if (ctx.activeProgram === null) return moveTo(state, S.idle, { type: 'needs_program' });
  const zone = ctx.settings.timezone;
  if (zone === null) return askTime(state, null);
  const active = ctx.activeWorkout;
  if (active === null) return chooseDayScreen(state, ctx);
  if (ctx.now.getTime() - active.startedAt.getTime() >= RESUME_WINDOW_MS) {
    return withEffects(chooseDayScreen(state, ctx), [finish(active.id, aborted, ctx)]);
  }
  const time = new Intl.DateTimeFormat('ru-RU', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(active.startedAt);
  return moveTo(state, S.workout_resume, {
    type: 'workout_resume',
    dayName: active.dayName,
    startedLabel: time,
    done: active.logs.length,
    total: dayExercises(ctx.activeProgram, active.dayId).length,
  }, contextFor(active, 0));
}

export function chooseResume(state: Session, ctx: StepContext, choice: ResumeChoice): StepResult {
  const active = ctx.activeWorkout;
  if (state.step !== S.workout_resume || active === null) return unchanged(state);
  switch (choice) {
    case ResumeChoiceSchema.enum.continue:
      return resumeAt(state, ctx, active);
    case ResumeChoiceSchema.enum.finish:
      return summary(state, ctx, active, [], completed);
    case ResumeChoiceSchema.enum.new:
      return withEffects(chooseDayScreen(state, ctx), [finish(active.id, aborted, ctx)]);
  }
}

export function chooseDayScreen(state: Session, ctx: StepContext): StepResult {
  const program = ctx.activeProgram;
  if (program === null) return moveTo(state, S.idle, { type: 'needs_program' });
  const names = new Map(program.days.map((d) => [d.id, d.name]));
  const ref = (id: string): { id: string; name: string } => ({ id, name: names.get(id) ?? id });
  const choice = nextDay(program.rotation, ctx.lastWorkout?.dayId ?? null);
  return moveTo(state, S.workout_day, {
    type: 'workout_days',
    last: ctx.lastWorkout,
    next: ref(choice.next),
    others: choice.others.map(ref),
  });
}

/** Выбран день: создаём тренировку с локальной датой, ISO-неделей и смещением на момент старта. */
export function chooseDay(state: Session, ctx: StepContext, dayId: string): StepResult {
  const program = ctx.activeProgram;
  const zone = ctx.settings.timezone;
  const day = program?.days.find((d) => d.id === dayId);
  if (state.step !== S.workout_day || !day || zone === null) return unchanged(state);
  const ids = idsOf(ctx);
  const localDate = localDateOf(ctx.now, zone);
  const workout = {
    id: ids(),
    dayId,
    dayName: day.name,
    startedAt: ctx.now,
    localDate,
    isoWeek: isoWeekOf(localDate),
    utcOffsetMin: utcOffsetMinutes(zone, ctx.now),
  };
  const fresh: ActiveWorkout = { ...workout, logs: [] };
  return withEffects(
    showExercise(
      state,
      { ...ctx, activeWorkout: fresh, newIds: ctx.newIds.slice(1) },
      contextFor(fresh, 0),
    ),
    [{ type: 'start_workout', workout }],
  );
}

/**
 * Куда вернуться в незавершённой тренировке: последнее начатое упражнение, если рабочих
 * подходов меньше минимума; иначе — экран после подхода или следующее упражнение.
 */
function resumeAt(state: Session, ctx: StepContext, active: ActiveWorkout): StepResult {
  const exercises = ctx.activeProgram ? dayExercises(ctx.activeProgram, active.dayId) : [];
  const next = (): StepResult =>
    showExercise(state, ctx, contextFor(active, openSlots(ctx, active)[0] ?? exercises.length));
  // Последняя начатая запись — по времени, а не по порядку дня: порядок мог быть другим.
  const log = active.logs.at(-1);
  if (!log) return next();
  const index = exercises.findIndex((e) => e.id === slotId(log));
  const at: WorkoutContext = {
    ...contextFor(active, index),
    exerciseId: log.substitutedFor === null ? null : log.exerciseId,
  };
  const ex = currentExercise(ctx, at);
  if (index < 0 || !ex || log.status !== done) return next();

  const workSets = log.sets.filter((s) => s.kind === work);
  const workLb = workSets.at(-1)?.weightLb ?? log.plannedWorkWeightLb;
  const c: WorkoutContext = { ...at, log: { id: log.id, workLb, workSets: workSets.length } };
  const last = workSets.at(-1);
  if (workSets.length >= ex.workSets.min && last) return afterSet(state, ctx, c, ex, last, false);
  return repsPrompt(state, ctx, c, ex, null, null);
}

const contextFor = (
  active: { id: string; dayId: string; localDate: ActiveWorkout['localDate'] },
  index: number,
): WorkoutContext => ({
  kind: 'workout',
  workoutId: active.id,
  dayId: active.dayId,
  localDate: active.localDate,
  index,
  exerciseId: null,
  intensity: null,
  warmupStep: null,
  log: null,
});

/** Место дня, которое закрывает запись: заменённое упражнение или само упражнение. */
export const slotId = (log: { exerciseId: string; substitutedFor: string | null }): string =>
  log.substitutedFor ?? log.exerciseId;

/** Номера невыполненных мест дня по порядку: у места нет ни своей записи, ни записи замены. */
export function openSlots(
  ctx: StepContext,
  active: { dayId: string; logs: ActiveWorkout['logs'] } | null,
): number[] {
  if (!ctx.activeProgram || !active) return [];
  const done = new Set(active.logs.map(slotId));
  return dayExercises(ctx.activeProgram, active.dayId).flatMap((e, i) => done.has(e.id) ? [] : [i]);
}

/** Следующее место после текущего: первое невыполненное; за последним — сводка. */
function nextSlot(ctx: StepContext, active: ActiveWorkout | null, current: number): number {
  const total = ctx.activeProgram && active
    ? dayExercises(ctx.activeProgram, active.dayId).length
    : 0;
  return openSlots(ctx, active).find((i) => i !== current) ?? total;
}

/** Упражнение программы на месте дня (без учёта замены). */
export function slotExercise(ctx: StepContext, c: WorkoutContext): Exercise | undefined {
  return ctx.activeProgram ? dayExercises(ctx.activeProgram, c.dayId)[c.index] : undefined;
}

// ---------------------------------------------------------------- карточка упражнения

export const workoutContext = (state: Session): WorkoutContext | null =>
  state.context.kind === 'workout' ? state.context : null;

/** Упражнение, которое делаем сейчас: замена, если выбрана, иначе — по программе. */
export function currentExercise(ctx: StepContext, c: WorkoutContext): Exercise | undefined {
  if (!ctx.activeProgram) return undefined;
  if (c.exerciseId !== null) return exerciseIndex(ctx.activeProgram).get(c.exerciseId);
  return slotExercise(ctx, c);
}

/** Интенсивность упражнения: выбранная кнопкой или по правилам §6.4; null — не из пары. */
function intensityOf(
  ctx: StepContext,
  c: WorkoutContext,
  ex: Exercise,
): IntensityInfo | 'unknown' | null {
  const program = ctx.activeProgram;
  const pair = program && pairOf(program, ex.id);
  const zone = ctx.settings.timezone;
  if (!program || !pair || zone === null) return null;
  const week = isoWeekOf(localDateOf(ctx.now, zone));
  const rule = pairIntensity(pair, ctx.intensityLogs, week);
  const base = rule.kind === 'known' ? rule.byExercise : {};
  const value = c.intensity ?? base[ex.id];
  if (value === undefined) return 'unknown';
  const other = pair.exercises.find((id) => id !== ex.id) ?? ex.id;
  const flipped = value === IntensitySchema.enum.high
    ? IntensitySchema.enum.low
    : IntensitySchema.enum.high;
  return {
    value,
    byExercise: {
      ...weekIntensities(program, ctx.intensityLogs, week),
      [ex.id]: value,
      [other]: flipped,
    },
  };
}

export function showExercise(state: Session, ctx: StepContext, c: WorkoutContext): StepResult {
  const program = ctx.activeProgram;
  const ex = currentExercise(ctx, c);
  const active = ctx.activeWorkout;
  if (!program || !active) return moveTo(state, S.idle, { type: 'workout_none' });
  if (!ex) return summary(state, ctx, active, [], completed);

  if (ex.loadType === LoadTypeSchema.enum.reps_only) return startRepsOnly(state, ctx, c, ex);

  const intensity = intensityOf(ctx, c, ex);
  if (intensity === 'unknown') {
    const pair = pairOf(program, ex.id);
    const names = exerciseIndex(program);
    const [a, b] = pair?.exercises ?? [ex.id, ex.id];
    return moveTo(state, S.workout_intensity, {
      type: 'workout_intensity',
      exerciseName: ex.name,
      pairNames: [names.get(a)?.name ?? a, names.get(b)?.name ?? b],
    }, c);
  }
  return card(state, ctx, c, ex, intensity, false);
}

export function card(
  state: Session,
  ctx: StepContext,
  c: WorkoutContext,
  ex: Exercise,
  intensity: IntensityInfo | null,
  invalidWeight: boolean,
): StepResult {
  const program = ctx.activeProgram;
  if (!program) return unchanged(state);
  const grid = weightGrid(ex, ctx.settings);
  const last = ctx.lastResults[ex.id] ?? null;
  const base = suggestedWeight(
    ex,
    program,
    ctx.settings,
    last,
    ctx.lastHighLb[ex.id] ?? null,
    intensity?.value ?? null,
  );
  const names = exerciseIndex(program);
  const pair = pairOf(program, ex.id);
  const summary = pair && intensity
    ? pair.exercises.map((id) =>
      `${names.get(id)?.name ?? id} ${
        intensity.byExercise[id] === IntensitySchema.enum.low ? Math.round(pair.lowPct * 100) : 100
      }%`
    ).join(', ')
    : '';
  return moveTo(state, S.workout_card, {
    type: 'workout_card',
    exerciseName: ex.name,
    position: c.index + 1,
    total: dayExercises(program, c.dayId).length,
    workSets: ex.workSets,
    repRange: 'repRange' in ex ? ex.repRange : null,
    last,
    intensity: intensity ? { value: intensity.value, summary } : null,
    notes: [
      ...(ex.notes ? [ex.notes] : []),
      ...activeNotes(program, ex.id, intensity?.byExercise ?? currentWeekIntensities(ctx)),
    ],
    addedWeight: ex.loadType === LoadTypeSchema.enum.weighted_bodyweight,
    noWeight: false,
    options: grid && base !== null ? weightOptions(grid, base) : [],
    invalidWeight,
    replaces: c.exerciseId === null ? null : slotExercise(ctx, c)?.name ?? null,
    canReorder: openSlots(ctx, ctx.activeWorkout).some((i) => i !== c.index),
  }, { ...c, intensity: intensity?.value ?? c.intensity });
}

/** Кнопка 100% / 70% в карточке или ответ на вопрос «кто ведущий на этой неделе». */
export function chooseIntensity(state: Session, ctx: StepContext, value: Intensity): StepResult {
  const c = workoutContext(state);
  if (!c || (state.step !== S.workout_card && state.step !== S.workout_intensity)) {
    return unchanged(state);
  }
  return showExercise(state, ctx, { ...c, intensity: value, log: null });
}

// ---------------------------------------------------------------- вес и разминка

/** Выбран рабочий вес: открываем запись упражнения и показываем разминку (или сразу подход). */
export function chooseWeight(state: Session, ctx: StepContext, weightLb: Lb): StepResult {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  if (!c || !ex || state.step !== S.workout_card) return unchanged(state);
  const program = ctx.activeProgram;
  if (!program) return unchanged(state);
  const ids = idsOf(ctx);
  const intensity = c.intensity;
  const plan = warmupFor(ex, program, ctx.settings, weightLb, intensity);
  const logId = ids();
  const open: Effect = openLog(ctx, c, ex, logId, done, weightLb, intensity, plan?.tier ?? null);
  const next: WorkoutContext = { ...c, log: { id: logId, workLb: weightLb, workSets: 0 } };
  const shown = warmupScreen(state, ctx, next, ex);
  return withEffects(shown ?? repsPrompt(state, ctx, next, ex, null, null), [open]);
}

/** План разминки текущего упражнения под выбранный рабочий вес; [] — разминки нет. */
export function warmupLines(
  ctx: StepContext,
  c: WorkoutContext,
  ex: Exercise,
): readonly WarmupLine[] {
  const workLb = c.log?.workLb ?? null;
  if (!ctx.activeProgram || workLb === null) return [];
  return warmupFor(ex, ctx.activeProgram, ctx.settings, workLb, c.intensity)?.lines ?? [];
}

/** Экран разминки; null — у упражнения разминки нет. */
export function warmupScreen(
  state: Session,
  ctx: StepContext,
  c: WorkoutContext,
  ex: Exercise,
): StepResult | null {
  const lines = warmupLines(ctx, c, ex);
  const workLb = c.log?.workLb ?? null;
  if (lines.length === 0 || workLb === null) return null;
  return moveTo(state, S.workout_warmup, {
    type: 'workout_warmup',
    exerciseName: ex.name,
    workLb,
    addedWeight: ex.loadType === LoadTypeSchema.enum.weighted_bodyweight,
    repRange: 'repRange' in ex ? ex.repRange : null,
    lines,
    lastComment: ctx.lastResults[ex.id]?.warmupComment ?? null,
  }, { ...c, warmupStep: null });
}

/** [✅ Всё по плану] — записать разминку как по плану; [⏭ Без разминки] — ничего не писать. */
export function finishWarmup(state: Session, ctx: StepContext, variant: WarmupVariant): StepResult {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  const log = c?.log;
  if (
    !c || !ex || !log || log.workLb === null || state.step !== S.workout_warmup ||
    !ctx.activeProgram
  ) {
    return unchanged(state);
  }
  const effects: Effect[] = [{
    type: 'patch_exercise_log',
    id: log.id,
    patch: { warmupVariant: variant },
  }];
  if (variant === full) {
    const ids = idsOf(ctx);
    const plan = warmupFor(ex, ctx.activeProgram, ctx.settings, log.workLb, c.intensity);
    plan?.lines.forEach((line, i) =>
      effects.push({
        type: 'record_set',
        set: {
          id: ids(),
          exerciseLogId: log.id,
          workoutId: c.workoutId,
          exerciseId: ex.id,
          kind: warmup,
          index: i + 1,
          plannedWeightLb: line.weightLb,
          plannedReps: line.reps,
          weightLb: line.weightLb,
          reps: line.reps,
          skipped: false,
        },
      })
    );
  }
  const afterWarmup = variant === full ? { canCommentWarmup: true } : {};
  return withEffects(repsPrompt(state, ctx, c, ex, null, null, afterWarmup), effects);
}

// ---------------------------------------------------------------- рабочие подходы

type RepsExtras = {
  /** Что удалено /undo или [✏️ Исправить] перед этим вводом. */
  readonly undone?: { weightLb: Lb | null; reps: number } | null;
  readonly canCommentWarmup?: boolean;
};

export function repsPrompt(
  state: Session,
  ctx: StepContext,
  c: WorkoutContext,
  ex: Exercise,
  justRecorded: { weightLb: Lb | null; reps: number } | null,
  error: SetInputError | null,
  extras: RepsExtras = {},
): StepResult {
  const setIndex = (c.log?.workSets ?? 0) + 1;
  const workLb = c.log?.workLb ?? null;
  const grid = weightGrid(ex, ctx.settings);
  return moveTo(state, S.workout_reps, {
    type: 'workout_reps',
    exerciseName: ex.name,
    setIndex,
    weightLb: c.log?.workLb ?? null,
    addedWeight: ex.loadType === LoadTypeSchema.enum.weighted_bodyweight,
    options: repOptions('repRange' in ex ? ex.repRange : null),
    target: ex.loadType === LoadTypeSchema.enum.reps_only
      ? ex.setTargets?.[setIndex - 1] ?? null
      : null,
    justRecorded,
    overMax: setIndex > ex.workSets.max,
    error,
    perSideLb: grid && workLb !== null ? perSide(grid, workLb) : null,
    undone: extras.undone ?? null,
    canCommentWarmup: setIndex === 1 && (extras.canCommentWarmup ?? false),
    canReplace: setIndex === 1 && ex.loadType === LoadTypeSchema.enum.reps_only,
    canReorder: setIndex === 1 && ex.loadType === LoadTypeSchema.enum.reps_only &&
      openSlots(ctx, ctx.activeWorkout).some((i) => i !== c.index),
  }, { ...c, warmupStep: null });
}

/** Пресс и другие reps_only: без веса и разминки — сразу к подходам. */
function startRepsOnly(
  state: Session,
  ctx: StepContext,
  c: WorkoutContext,
  ex: Exercise,
): StepResult {
  const logId = idsOf(ctx)();
  const next: WorkoutContext = { ...c, log: { id: logId, workLb: null, workSets: 0 } };
  return withEffects(repsPrompt(state, ctx, next, ex, null, null), [
    openLog(ctx, c, ex, logId, done, null, null, null),
  ]);
}

/** Повторения кнопкой — с текущим рабочим весом. */
export function chooseReps(state: Session, ctx: StepContext, reps: number): StepResult {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  if (!c?.log || !ex || !REPS_STEPS.has(state.step)) return unchanged(state);
  return recordWork(state, ctx, c, ex, c.log.workLb, reps, null);
}

export function recordWork(
  state: Session,
  ctx: StepContext,
  c: WorkoutContext,
  ex: Exercise,
  weightLb: Lb | null,
  reps: number,
  comment: string | null,
): StepResult {
  const log = c.log;
  if (!log) return unchanged(state);
  const index = log.workSets + 1;
  const effects: Effect[] = [{
    type: 'record_set',
    set: {
      id: idsOf(ctx)(),
      exerciseLogId: log.id,
      workoutId: c.workoutId,
      exerciseId: ex.id,
      kind: work,
      index,
      plannedWeightLb: log.workLb,
      plannedReps: null,
      weightLb,
      reps,
      skipped: false,
    },
  }];
  if (comment) effects.push({ type: 'patch_exercise_log', id: log.id, patch: { comment } });
  const next: WorkoutContext = { ...c, log: { ...log, workLb: weightLb, workSets: index } };
  const recorded = { weightLb, reps };
  const result = index < ex.workSets.min
    ? repsPrompt(state, ctx, next, ex, recorded, null)
    : afterSet(state, ctx, next, ex, recorded, false);
  return withEffects(result, effects);
}

export function afterSet(
  state: Session,
  ctx: StepContext,
  c: WorkoutContext,
  ex: Exercise,
  recorded: { weightLb: Lb | null; reps: number },
  commentSaved: boolean,
): StepResult {
  const setIndex = c.log?.workSets ?? 1;
  return moveTo(state, S.workout_after_set, {
    type: 'workout_after_set',
    exerciseName: ex.name,
    recorded,
    addedWeight: ex.loadType === LoadTypeSchema.enum.weighted_bodyweight,
    setIndex,
    nextOverMax: setIndex + 1 > ex.workSets.max,
    lastExercise: !openSlots(ctx, ctx.activeWorkout).some((i) => i !== c.index),
    commentSaved,
  }, c);
}

export function moreSets(state: Session, ctx: StepContext): StepResult {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  if (!c || !ex || state.step !== S.workout_after_set) return unchanged(state);
  return repsPrompt(state, ctx, c, ex, null, null);
}

export function nextExercise(state: Session, ctx: StepContext): StepResult {
  const c = workoutContext(state);
  if (!c || state.step !== S.workout_after_set) return unchanged(state);
  return showExercise(state, ctx, atSlot(c, nextSlot(ctx, ctx.activeWorkout, c.index)));
}

/**
 * [⏭ Пропустить]: до первого рабочего подхода — запись со статусом skipped; после — упражнение
 * заканчивается досрочно, записанное остаётся. Дальше — следующее невыполненное.
 */
export function skipExercise(state: Session, ctx: StepContext): StepResult {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  if (!c || !ex || !SKIP_STEPS.has(state.step)) return unchanged(state);
  if ((c.log?.workSets ?? 0) > 0) {
    return showExercise(state, ctx, atSlot(c, nextSlot(ctx, ctx.activeWorkout, c.index)));
  }
  const effect: Effect = c.log
    ? { type: 'patch_exercise_log', id: c.log.id, patch: { status: skipped } }
    : openLog(ctx, c, ex, idsOf(ctx)(), skipped, null, c.intensity, null);
  const activeWorkout = withSkip(ctx.activeWorkout, ex, slotExercise(ctx, c)?.id ?? ex.id);
  const nextCtx = { ...ctx, newIds: ctx.newIds.slice(1), activeWorkout };
  return withEffects(
    showExercise(state, nextCtx, atSlot(c, nextSlot(nextCtx, activeWorkout, c.index))),
    [effect],
  );
}

/** Новое место дня: упражнение по программе, интенсивность и запись — заново. */
export const atSlot = (c: WorkoutContext, index: number): WorkoutContext => ({
  ...c,
  index,
  exerciseId: null,
  intensity: null,
  warmupStep: null,
  log: null,
});

/** Пропуск в этом же апдейте ещё не в БД — добавляем его в снимок для сводки. */
const withSkip = (
  active: ActiveWorkout | null,
  ex: Exercise,
  slot: string,
): ActiveWorkout | null =>
  active && {
    ...active,
    logs: [
      ...active.logs.filter((l) => slotId(l) !== slot),
      {
        id: '',
        exerciseId: ex.id,
        exerciseName: ex.name,
        substitutedFor: slot === ex.id ? null : slot,
        status: skipped,
        plannedWorkWeightLb: null,
        sets: [],
      },
    ],
  };

// ---------------------------------------------------------------- комментарии и текст

export function requestComment(state: Session, ctx: StepContext): StepResult {
  const c = workoutContext(state);
  if (!c) return unchanged(state);
  const ex = currentExercise(ctx, c);
  if (state.step === S.workout_after_set) {
    return moveTo(state, S.workout_comment, {
      type: 'workout_comment_prompt',
      exerciseName: ex?.name ?? '',
    }, c);
  }
  if (state.step === S.workout_summary) {
    return moveTo(state, S.workout_final_comment, {
      type: 'workout_comment_prompt',
      exerciseName: null,
    }, c);
  }
  return unchanged(state);
}

/** Текст во время тренировки: вес в карточке, подход, комментарий. */
export function workoutText(state: Session, ctx: StepContext, text: string): StepResult {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  if (!c) return unchanged(state);

  if (state.step === S.workout_final_comment) {
    // Тренировка уже завершена — остаёмся на шаге сводки, чтобы «Готово» работало.
    return withEffects(moveTo(state, S.workout_summary, { type: 'workout_commented' }, c), [
      { type: 'comment_workout', workoutId: c.workoutId, comment: text.trim() },
    ]);
  }
  if (!ex) return unchanged(state);

  if (state.step === S.workout_comment && c.log) {
    const lastSet = ctx.activeWorkout?.logs.find((l) => l.id === c.log?.id)?.sets.filter((s) =>
      s.kind === work
    ).at(-1);
    return withEffects(
      afterSet(state, ctx, c, ex, {
        weightLb: lastSet?.weightLb ?? c.log.workLb,
        reps: lastSet?.reps ?? 0,
      }, true),
      [{ type: 'patch_exercise_log', id: c.log.id, patch: { comment: text.trim() } }],
    );
  }

  if (state.step === S.workout_card) return cardText(state, ctx, c, ex, text);

  if (REPS_STEPS.has(state.step) && c.log) {
    const parsed = parseSetInput(text, { loadType: ex.loadType, suggestedLb: c.log.workLb });
    if (!parsed.ok) return repsPrompt(state, ctx, c, ex, null, parsed.error);
    return recordWork(
      state,
      ctx,
      c,
      ex,
      parsed.value.weightLb,
      parsed.value.reps,
      parsed.value.comment,
    );
  }
  return unchanged(state);
}

/** В карточке: число — рабочий вес; «185x7» — сразу подход без разминки. */
function cardText(
  state: Session,
  ctx: StepContext,
  c: WorkoutContext,
  ex: Exercise,
  text: string,
): StepResult {
  const weight = parseLbNumber(text.replace(/^\s*\+/, ''));
  if (weight !== null) {
    if (weight > MAX_WEIGHT_LB) return card(state, ctx, c, ex, cardIntensity(ctx, c, ex), true);
    return chooseWeight(state, ctx, lb(weight));
  }
  const parsed = parseSetInput(text, { loadType: ex.loadType, suggestedLb: null });
  if (!parsed.ok || parsed.value.weightLb === null) {
    return card(state, ctx, c, ex, cardIntensity(ctx, c, ex), true);
  }
  const opened = chooseWeight(state, ctx, parsed.value.weightLb);
  const cc = workoutContext({ ...state, context: opened.state.context });
  if (!cc?.log) return opened;
  const logEffects = opened.effects.filter((e) => e.type === 'open_exercise_log');
  const recorded = recordWork(
    state,
    { ...ctx, newIds: ctx.newIds.slice(1) },
    cc,
    ex,
    parsed.value.weightLb,
    parsed.value.reps,
    parsed.value.comment,
  );
  return withEffects(recorded, logEffects);
}

export function cardIntensity(
  ctx: StepContext,
  c: WorkoutContext,
  ex: Exercise,
): IntensityInfo | null {
  const i = intensityOf(ctx, c, ex);
  return i === 'unknown' ? null : i;
}

/** Интенсивности недели по правилам — для условных заметок упражнений не из пары. */
function currentWeekIntensities(ctx: StepContext): Readonly<Record<string, Intensity>> {
  const zone = ctx.settings.timezone;
  if (!ctx.activeProgram || zone === null) return {};
  return weekIntensities(
    ctx.activeProgram,
    ctx.intensityLogs,
    isoWeekOf(localDateOf(ctx.now, zone)),
  );
}

// ---------------------------------------------------------------- завершение и отмена

/** Сводка: подходы по упражнениям дня, прошлый раз, длительность. */
function summary(
  state: Session,
  ctx: StepContext,
  active: ActiveWorkout,
  extra: readonly Effect[],
  status: WorkoutStatus | null,
  commentSaved = false,
): StepResult {
  const program = ctx.activeProgram;
  const exercises = program ? dayExercises(program, active.dayId) : [];
  const index = program ? exerciseIndex(program) : new Map<string, Exercise>();
  const items = exercises.flatMap((slot) => {
    const log = active.logs.find((l) => slotId(l) === slot.id);
    if (!log) return [];
    const ex = index.get(log.exerciseId) ?? slot;
    return [{
      name: ex.name,
      replaces: log.substitutedFor === null ? null : slot.name,
      skipped: log.status === skipped,
      addedWeight: ex.loadType === LoadTypeSchema.enum.weighted_bodyweight,
      sets: log.sets.filter((s) => s.kind === work).map((s) => ({
        weightLb: s.weightLb,
        reps: s.reps,
      })),
      last: ctx.lastResults[ex.id] ?? null,
    }];
  });
  const view: View = {
    type: 'workout_summary',
    dayName: active.dayName,
    localDate: active.localDate,
    minutes: Math.max(0, Math.round((ctx.now.getTime() - active.startedAt.getTime()) / 60_000)),
    items,
    commentSaved,
  };
  const effects = status ? [...extra, finish(active.id, status, ctx)] : extra;
  return withEffects(
    moveTo(state, S.workout_summary, view, contextFor(active, exercises.length)),
    effects,
  );
}

/** [Готово] на сводке — главный экран. */
export function closeSummary(state: Session, ctx: StepContext): StepResult {
  if (state.step !== S.workout_summary) return unchanged(state);
  const zone = ctx.settings.timezone;
  return zone ? home(state, zone, ctx) : moveTo(state, S.idle, { type: 'workout_none' });
}

/** /cancel: подтверждение, данные сохраняются со статусом aborted. */
export function requestCancel(state: Session, ctx: StepContext): StepResult {
  const active = ctx.activeWorkout;
  if (active === null) return moveTo(state, S.idle, { type: 'workout_none' });
  return moveTo(state, S.workout_cancel_confirm, {
    type: 'workout_cancel_confirm',
    dayName: active.dayName,
  }, contextFor(active, 0));
}

export function answerCancel(state: Session, ctx: StepContext, confirm: boolean): StepResult {
  const active = ctx.activeWorkout;
  if (state.step !== S.workout_cancel_confirm || active === null) return unchanged(state);
  if (!confirm) return resumeAt(state, ctx, active);
  return withEffects(moveTo(state, S.idle, { type: 'workout_cancelled' }), [
    finish(active.id, aborted, ctx),
  ]);
}

// ---------------------------------------------------------------- общее

const REPS_STEPS: ReadonlySet<string> = new Set([
  S.workout_reps,
  S.workout_after_set,
  S.workout_warmup,
]);
const SKIP_STEPS: ReadonlySet<string> = new Set([
  S.workout_card,
  S.workout_intensity,
  S.workout_reps,
  S.workout_warmup,
]);

export const WORKOUT_STEPS: ReadonlySet<string> = new Set([
  S.workout_day,
  S.workout_resume,
  S.workout_intensity,
  S.workout_card,
  S.workout_warmup,
  S.workout_warmup_mark,
  S.workout_warmup_edit,
  S.workout_warmup_comment,
  S.workout_replace,
  S.workout_reorder,
  S.workout_reps,
  S.workout_after_set,
  S.workout_comment,
  S.workout_summary,
  S.workout_final_comment,
  S.workout_cancel_confirm,
]);

const finish = (workoutId: string, status: WorkoutStatus, ctx: StepContext): Effect => ({
  type: 'finish_workout',
  workoutId,
  status,
  finishedAt: ctx.now,
});

export function openLog(
  ctx: StepContext,
  c: WorkoutContext,
  ex: Exercise,
  id: string,
  status: ExerciseLogStatus,
  plannedWorkWeightLb: Lb | null,
  intensity: Intensity | null,
  warmupTier: number | null,
): Effect {
  return {
    type: 'open_exercise_log',
    log: {
      id,
      workoutId: c.workoutId,
      exerciseId: ex.id,
      exerciseName: ex.name,
      substitutedFor: c.exerciseId === null ? null : slotExercise(ctx, c)?.id ?? null,
      order: c.index + 1,
      status,
      intensity,
      plannedWorkWeightLb,
      stepLbUsed: weightStep(ex, ctx.settings),
      warmupTier,
      localDate: c.localDate,
    },
  };
}
