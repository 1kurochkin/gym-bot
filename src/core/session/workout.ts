import {
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
import { isoWeekOf, localDateOf } from '../schedule/calendar.ts';
import { activeNotes, pairIntensity, weekIntensities } from '../schedule/intensity.ts';
import { nextDay } from '../schedule/rotation.ts';
import { utcOffsetMinutes } from '../schedule/timezone.ts';
import { type Lb, lb } from '../units/lb.ts';
import { perSide } from '../units/weight-grid.ts';
import {
  pairOf,
  repOptions,
  suggestedWeight,
  warmupFor,
  type WarmupLine,
  weightOptions,
} from '../workout/plan.ts';
import {
  type ActiveWorkout,
  type WorkoutLog,
  type WorkoutStatus,
  WorkoutStatusSchema,
} from '../workout/schema.ts';
import { home, moveTo, unchanged, withEffects } from './flow.ts';
import { askTime } from './onboarding.ts';
import {
  type Effect,
  type MenuMark,
  MenuMarkSchema,
  type Session,
  type SessionContext,
  SessionStepSchema,
  type StepContext,
  type StepResult,
  type View,
} from './types.ts';

/**
 * Тренировка — меню дня (.specs/product.md → US-2…US-5): выбор дня → меню → упражнение
 * (вес → разминка → подходы до «Завершить упражнение») → меню → «Завершить тренировку».
 * Исправления (разминка «Изменить», «Назад», просмотр подходов, /undo) — workout-corrections.ts.
 */

const S = SessionStepSchema.enum;
const { warmup, work } = SetKindSchema.enum;
const { full } = WarmupVariantSchema.enum;
const { completed, aborted } = WorkoutStatusSchema.enum;
const MARK = MenuMarkSchema.enum;

/** Незавершённую тренировку старше этого не продолжаем, а закрываем (US-2). */
const RESUME_WINDOW_MS = 12 * 60 * 60 * 1000;
const MAX_WEIGHT_LB = 1500;

export type WorkoutContext = Extract<SessionContext, { kind: 'workout' }>;
/** Интенсивность упражнения и всей недели с учётом выбора пользователя. */
type IntensityInfo = { value: Intensity; byExercise: Readonly<Record<string, Intensity>> };
type Ids = () => string;
type RepsView = Extract<View, { type: 'workout_reps' }>;
export type SetView = RepsView['recorded'][number];

export const idsOf = (ctx: StepContext): Ids => {
  let i = 0;
  return () => ctx.newIds[i++] ?? `missing-id-${i}`;
};

export const workoutContext = (state: Session): WorkoutContext | null =>
  state.context.kind === 'workout' ? state.context : null;

/** Контекст меню дня: упражнение не открыто. */
export const menuContext = (
  active: { id: string; dayId: string; localDate: ActiveWorkout['localDate'] },
): WorkoutContext => ({
  kind: 'workout',
  workoutId: active.id,
  dayId: active.dayId,
  localDate: active.localDate,
  exerciseId: null,
  intensity: null,
  warmupStep: null,
  viewSet: null,
  log: null,
});

/** Открыть упражнение: запись и интенсивность — заново. */
export const atExercise = (c: WorkoutContext, exerciseId: string): WorkoutContext => ({
  ...c,
  exerciseId,
  intensity: null,
  warmupStep: null,
  viewSet: null,
  log: null,
});

export function currentExercise(ctx: StepContext, c: WorkoutContext): Exercise | undefined {
  if (!ctx.activeProgram || c.exerciseId === null) return undefined;
  return exerciseIndex(ctx.activeProgram).get(c.exerciseId);
}

/** Запись упражнения в текущей тренировке (как в БД до этого апдейта). */
export const logOf = (
  active: ActiveWorkout | null,
  exerciseId: string,
): WorkoutLog | undefined => active?.logs.find((l) => l.exerciseId === exerciseId);

/** Рабочие подходы записи (пропущенные подходы разминки — не они). */
export const workSetsOf = (log: WorkoutLog | undefined): WorkoutLog['sets'] =>
  (log?.sets ?? []).filter((s) => s.kind === work && !s.skipped);

const asView = (sets: WorkoutLog['sets']): SetView[] =>
  sets.map((s) => ({ weightLb: s.weightLb, reps: s.reps }));

/** Упражнения меню: дня по порядку программы, затем добавленные (по времени добавления). */
export function menuExercises(ctx: StepContext, active: ActiveWorkout | null): Exercise[] {
  if (!ctx.activeProgram || !active) return [];
  const day = [...dayExercises(ctx.activeProgram, active.dayId)];
  const index = exerciseIndex(ctx.activeProgram);
  const ids = new Set(day.map((e) => e.id));
  for (const log of active.logs) {
    const ex = index.get(log.exerciseId);
    if (ex && !ids.has(ex.id)) {
      ids.add(ex.id);
      day.push(ex);
    }
  }
  return day;
}

const markOf = (log: WorkoutLog | undefined): MenuMark =>
  log?.finishedAt ? MARK.done : workSetsOf(log).length > 0 ? MARK.started : MARK.todo;

// ---------------------------------------------------------------- день и меню

/** /workout: меню незавершённой тренировки, старую — закрыть, иначе — выбор дня. */
export function requestWorkout(state: Session, ctx: StepContext): StepResult {
  if (ctx.activeProgram === null) return moveTo(state, S.idle, { type: 'needs_program' });
  if (ctx.settings.timezone === null) return askTime(state, null);
  const active = ctx.activeWorkout;
  if (active === null) return chooseDayScreen(state, ctx);
  if (ctx.now.getTime() - active.startedAt.getTime() >= RESUME_WINDOW_MS) {
    return withEffects(chooseDayScreen(state, ctx), [finish(active.id, aborted, ctx)]);
  }
  return menuScreen(state, ctx, active, false);
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

/** Выбран день: тренировка с локальной датой, ISO-неделей и смещением на момент старта; меню. */
export function chooseDay(state: Session, ctx: StepContext, dayId: string): StepResult {
  const program = ctx.activeProgram;
  const zone = ctx.settings.timezone;
  const day = program?.days.find((d) => d.id === dayId);
  if (state.step !== S.workout_day || !day || zone === null) return unchanged(state);
  const localDate = localDateOf(ctx.now, zone);
  const workout = {
    id: idsOf(ctx)(),
    dayId,
    dayName: day.name,
    startedAt: ctx.now,
    localDate,
    isoWeek: isoWeekOf(localDate),
    utcOffsetMin: utcOffsetMinutes(zone, ctx.now),
  };
  return withEffects(menuScreen(state, ctx, { ...workout, logs: [] }, false), [
    { type: 'start_workout', workout },
  ]);
}

/** Меню дня; active — снимок тренировки с изменениями этого апдейта. */
export function menuScreen(
  state: Session,
  ctx: StepContext,
  active: ActiveWorkout,
  commentSaved: boolean,
): StepResult {
  const day = ctx.activeProgram ? dayExercises(ctx.activeProgram, active.dayId) : [];
  const items = menuExercises(ctx, active).map((ex) => {
    const log = logOf(active, ex.id);
    return {
      exerciseId: ex.id,
      name: ex.name,
      mark: markOf(log),
      addedWeight: ex.loadType === LoadTypeSchema.enum.weighted_bodyweight,
      sets: asView(workSetsOf(log)),
    };
  });
  const next = day.find((ex) => markOf(logOf(active, ex.id)) === MARK.todo)?.id ?? null;
  return moveTo(state, S.workout_menu, {
    type: 'workout_menu',
    dayName: active.dayName,
    localDate: active.localDate,
    items,
    next,
    commentSaved,
  }, menuContext(active));
}

/** Упражнение из меню: ▫️ — заново; ◐ и ✅ — на ввод следующего подхода. */
export function pickMenuExercise(state: Session, ctx: StepContext, exerciseId: string): StepResult {
  const c = workoutContext(state);
  const active = ctx.activeWorkout;
  if (!c || !active || state.step !== S.workout_menu) return unchanged(state);
  if (!menuExercises(ctx, active).some((e) => e.id === exerciseId)) return unchanged(state);
  return enterExercise(state, ctx, atExercise(c, exerciseId));
}

/** Вход в упражнение: с записанным — на ввод подхода, пустая запись — заново. */
export function enterExercise(state: Session, ctx: StepContext, c: WorkoutContext): StepResult {
  const ex = currentExercise(ctx, c);
  if (!ex) return unchanged(state);
  const log = logOf(ctx.activeWorkout, ex.id);
  if (!log) return showExercise(state, ctx, c);
  const works = workSetsOf(log);
  if (works.length > 0 || log.sets.some((s) => s.kind === warmup)) {
    const workLb = works.at(-1)?.weightLb ?? log.plannedWorkWeightLb;
    return repsPrompt(state, ctx, {
      ...c,
      log: { id: log.id, workLb, workSets: works.length },
    }, ex);
  }
  // Пустая запись (вес выбран, но ничего не записано) — начинаем заново.
  return withEffects(showExercise(state, ctx, c), [{ type: 'delete_exercise_log', id: log.id }]);
}

/** [➕ Добавить упражнение]: упражнения программы, которых нет в меню. */
export function requestAdd(state: Session, ctx: StepContext): StepResult {
  const c = workoutContext(state);
  const program = ctx.activeProgram;
  if (!c || !program || state.step !== S.workout_menu) return unchanged(state);
  const inMenu = new Set(menuExercises(ctx, ctx.activeWorkout).map((e) => e.id));
  const options = [...exerciseIndex(program).values()]
    .filter((e) => !inMenu.has(e.id))
    .map((e) => ({ id: e.id, name: e.name }));
  return moveTo(state, S.workout_add, { type: 'workout_add', options }, c);
}

export function chooseAdd(state: Session, ctx: StepContext, exerciseId: string): StepResult {
  const c = workoutContext(state);
  const program = ctx.activeProgram;
  if (!c || !program || state.step !== S.workout_add) return unchanged(state);
  if (!exerciseIndex(program).has(exerciseId)) return unchanged(state);
  return showExercise(state, ctx, atExercise(c, exerciseId));
}

// ---------------------------------------------------------------- вход в упражнение и вес

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

/** Первый экран упражнения: подходы (reps_only), вопрос 100/70 или выбор веса. */
export function showExercise(state: Session, ctx: StepContext, c: WorkoutContext): StepResult {
  const program = ctx.activeProgram;
  const ex = currentExercise(ctx, c);
  if (!program || !ctx.activeWorkout || !ex) {
    return ctx.activeWorkout
      ? menuScreen(state, ctx, ctx.activeWorkout, false)
      : moveTo(state, S.idle, { type: 'workout_none' });
  }
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
  }, { ...c, intensity: intensity?.value ?? c.intensity, log: null });
}

export function cardIntensity(
  ctx: StepContext,
  c: WorkoutContext,
  ex: Exercise,
): IntensityInfo | null {
  const i = intensityOf(ctx, c, ex);
  return i === 'unknown' ? null : i;
}

/** Кнопка 100% / 70% в карточке или ответ на вопрос «кто ведущий на этой неделе». */
export function chooseIntensity(state: Session, ctx: StepContext, value: Intensity): StepResult {
  const c = workoutContext(state);
  if (!c || (state.step !== S.workout_card && state.step !== S.workout_intensity)) {
    return unchanged(state);
  }
  return showExercise(state, ctx, { ...c, intensity: value, log: null });
}

/** Выбран рабочий вес: открываем запись упражнения и показываем разминку (или сразу подход). */
export function chooseWeight(state: Session, ctx: StepContext, weightLb: Lb): StepResult {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  if (!c || !ex || state.step !== S.workout_card || !ctx.activeProgram) return unchanged(state);
  const plan = warmupFor(ex, ctx.activeProgram, ctx.settings, weightLb, c.intensity);
  const logId = idsOf(ctx)();
  const open = openLog(ctx, c, ex, logId, weightLb, c.intensity, plan?.tier ?? null);
  const next: WorkoutContext = { ...c, log: { id: logId, workLb: weightLb, workSets: 0 } };
  const shown = warmupScreen(state, ctx, next, ex, false);
  return withEffects(shown ?? repsPrompt(state, ctx, next, ex, { recorded: [] }), [open]);
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
  commentSaved: boolean,
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
    commentSaved,
  }, { ...c, warmupStep: null, viewSet: null });
}

/** [✅ Готово] — разминка по плану; [⏭ Пропустить] — без разминки. */
export function finishWarmup(state: Session, ctx: StepContext, variant: WarmupVariant): StepResult {
  const c = workoutContext(state);
  const ex = c && currentExercise(ctx, c);
  const log = c?.log;
  if (!c || !ex || !log || log.workLb === null || state.step !== S.workout_warmup) {
    return unchanged(state);
  }
  const effects: Effect[] = [{
    type: 'patch_exercise_log',
    id: log.id,
    patch: { warmupVariant: variant },
  }];
  if (variant === full) {
    const ids = idsOf(ctx);
    warmupLines(ctx, c, ex).forEach((line, i) =>
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
  return withEffects(repsPrompt(state, ctx, c, ex), effects);
}

// ---------------------------------------------------------------- рабочие подходы

type RepsOptions = {
  /** Рабочие подходы упражнения с изменениями этого апдейта; по умолчанию — из БД. */
  readonly recorded?: readonly SetView[];
  readonly error?: SetInputError | null;
  readonly notice?: RepsView['notice'];
};

/** Ввод рабочего подхода: записанные, кнопки повторений, ✍️ подсказка. */
export function repsPrompt(
  state: Session,
  ctx: StepContext,
  c: WorkoutContext,
  ex: Exercise,
  opts: RepsOptions = {},
): StepResult {
  const recorded = opts.recorded ?? asView(workSetsOf(logOf(ctx.activeWorkout, ex.id)));
  const setIndex = recorded.length + 1;
  const workLb = c.log?.workLb ?? null;
  const grid = weightGrid(ex, ctx.settings);
  const anchor = recorded.at(-1)?.reps ?? ctx.lastResults[ex.id]?.reps ?? null;
  return moveTo(state, S.workout_reps, {
    type: 'workout_reps',
    exerciseName: ex.name,
    setIndex,
    weightLb: workLb,
    addedWeight: ex.loadType === LoadTypeSchema.enum.weighted_bodyweight,
    options: repOptions('repRange' in ex ? ex.repRange : null, anchor),
    target: ex.loadType === LoadTypeSchema.enum.reps_only
      ? ex.setTargets?.[setIndex - 1] ?? null
      : null,
    recorded,
    overMax: setIndex > ex.workSets.max,
    error: opts.error ?? null,
    perSideLb: grid && workLb !== null ? perSide(grid, workLb) : null,
    notice: opts.notice ?? null,
  }, {
    ...c,
    warmupStep: null,
    viewSet: null,
    log: c.log && { ...c.log, workSets: recorded.length },
  });
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
  return withEffects(repsPrompt(state, ctx, next, ex, { recorded: [] }), [
    openLog(ctx, c, ex, logId, null, null, null),
  ]);
}

const REPS_STEPS: ReadonlySet<string> = new Set([S.workout_reps, S.workout_warmup]);

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
  const before = workSetsOf(logOf(ctx.activeWorkout, ex.id));
  const index = (before.at(-1)?.index ?? 0) + 1;
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
  const next: WorkoutContext = { ...c, log: { ...log, workLb: weightLb } };
  return withEffects(
    repsPrompt(state, ctx, next, ex, {
      recorded: [...asView(before), { weightLb, reps }],
      notice: comment ? { kind: 'commented' } : null,
    }),
    effects,
  );
}

/** [🏁 Завершить упражнение]: ✅ в меню; без рабочих подходов запись не нужна. */
export function finishExercise(state: Session, ctx: StepContext): StepResult {
  const c = workoutContext(state);
  const active = ctx.activeWorkout;
  if (!c?.log || !active || c.exerciseId === null || state.step !== S.workout_reps) {
    return unchanged(state);
  }
  const logId = c.log.id;
  const hasWork = workSetsOf(logOf(active, c.exerciseId)).length > 0;
  const effect: Effect = hasWork
    ? { type: 'patch_exercise_log', id: logId, patch: { finishedAt: ctx.now } }
    : { type: 'delete_exercise_log', id: logId };
  const after: ActiveWorkout = {
    ...active,
    logs: hasWork
      ? active.logs.map((l) => (l.id === logId ? { ...l, finishedAt: ctx.now } : l))
      : active.logs.filter((l) => l.id !== logId),
  };
  return withEffects(menuScreen(state, ctx, after, false), [effect]);
}

// ---------------------------------------------------------------- комментарии и текст

/** [💬 Комментарий]: на подходе — к упражнению, в меню и на сводке — к тренировке. */
export function requestComment(state: Session, ctx: StepContext): StepResult {
  const c = workoutContext(state);
  if (!c) return unchanged(state);
  const ex = currentExercise(ctx, c);
  switch (state.step) {
    case S.workout_reps:
      return moveTo(state, S.workout_comment, {
        type: 'workout_comment_prompt',
        exerciseName: ex?.name ?? '',
      }, c);
    case S.workout_menu:
      return moveTo(state, S.workout_menu_comment, {
        type: 'workout_comment_prompt',
        exerciseName: null,
      }, c);
    case S.workout_summary:
      return moveTo(state, S.workout_final_comment, {
        type: 'workout_comment_prompt',
        exerciseName: null,
      }, c);
    default:
      return unchanged(state);
  }
}

/** Текст во время тренировки: вес в карточке, подход, комментарии. */
export function workoutText(state: Session, ctx: StepContext, text: string): StepResult {
  const c = workoutContext(state);
  if (!c) return unchanged(state);
  const comment = text.trim();

  if (state.step === S.workout_final_comment) {
    // Тренировка уже завершена — остаёмся на шаге сводки, чтобы «Готово» работало.
    return withEffects(moveTo(state, S.workout_summary, { type: 'workout_commented' }, c), [
      { type: 'comment_workout', workoutId: c.workoutId, comment },
    ]);
  }
  if (state.step === S.workout_menu_comment && ctx.activeWorkout) {
    return withEffects(menuScreen(state, ctx, ctx.activeWorkout, true), [
      { type: 'comment_workout', workoutId: c.workoutId, comment },
    ]);
  }
  const ex = currentExercise(ctx, c);
  if (!ex) return unchanged(state);

  if (state.step === S.workout_comment && c.log) {
    return withEffects(repsPrompt(state, ctx, c, ex, { notice: { kind: 'commented' } }), [
      { type: 'patch_exercise_log', id: c.log.id, patch: { comment } },
    ]);
  }
  if (state.step === S.workout_card) return cardText(state, ctx, c, ex, text);
  if (REPS_STEPS.has(state.step) && c.log) {
    const parsed = parseSetInput(text, { loadType: ex.loadType, suggestedLb: c.log.workLb });
    if (!parsed.ok) return repsPrompt(state, ctx, c, ex, { error: parsed.error });
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

/** [🏁 Завершить тренировку]: сводка; без единого рабочего подхода — тренировка удаляется. */
export function finishWorkout(state: Session, ctx: StepContext): StepResult {
  const active = ctx.activeWorkout;
  if (!active || state.step !== S.workout_menu) return unchanged(state);
  if (!active.logs.some((l) => workSetsOf(l).length > 0)) {
    return withEffects(moveTo(state, S.idle, { type: 'workout_empty_deleted' }), [
      { type: 'delete_workout', id: active.id },
    ]);
  }
  return summary(state, ctx, active);
}

/** Сводка: подходы по упражнениям меню, прошлый раз, длительность. */
function summary(state: Session, ctx: StepContext, active: ActiveWorkout): StepResult {
  const day = new Set(
    ctx.activeProgram ? dayExercises(ctx.activeProgram, active.dayId).map((e) => e.id) : [],
  );
  const items = menuExercises(ctx, active).flatMap((ex) => {
    const sets = workSetsOf(logOf(active, ex.id));
    if (sets.length === 0 && !day.has(ex.id)) return [];
    return [{
      name: ex.name,
      replaces: null,
      skipped: sets.length === 0,
      addedWeight: ex.loadType === LoadTypeSchema.enum.weighted_bodyweight,
      sets: asView(sets),
      last: ctx.lastResults[ex.id] ?? null,
    }];
  });
  return withEffects(
    moveTo(state, S.workout_summary, {
      type: 'workout_summary',
      dayName: active.dayName,
      localDate: active.localDate,
      minutes: Math.max(0, Math.round((ctx.now.getTime() - active.startedAt.getTime()) / 60_000)),
      items,
      commentSaved: false,
    }, menuContext(active)),
    [finish(active.id, completed, ctx)],
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
  }, menuContext(active));
}

export function answerCancel(state: Session, ctx: StepContext, confirm: boolean): StepResult {
  const active = ctx.activeWorkout;
  if (state.step !== S.workout_cancel_confirm || active === null) return unchanged(state);
  if (!confirm) return menuScreen(state, ctx, active, false);
  return withEffects(moveTo(state, S.idle, { type: 'workout_cancelled' }), [
    finish(active.id, aborted, ctx),
  ]);
}

// ---------------------------------------------------------------- общее

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
  plannedWorkWeightLb: Lb | null,
  intensity: Intensity | null,
  warmupTier: number | null,
): Effect {
  const menu = menuExercises(ctx, ctx.activeWorkout);
  const at = menu.findIndex((e) => e.id === ex.id);
  return {
    type: 'open_exercise_log',
    log: {
      id,
      workoutId: c.workoutId,
      exerciseId: ex.id,
      exerciseName: ex.name,
      substitutedFor: null,
      order: (at >= 0 ? at : menu.length) + 1,
      status: ExerciseLogStatusSchema.enum.done,
      intensity,
      plannedWorkWeightLb,
      stepLbUsed: weightStep(ex, ctx.settings),
      warmupTier,
      localDate: c.localDate,
    },
  };
}
