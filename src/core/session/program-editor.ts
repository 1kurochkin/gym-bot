import {
  addableToDay,
  addDayFromProgram,
  addDayWithNew,
  addFromProgram,
  addNewExercise,
  canDeleteDay,
  canMove,
  canRemove,
  changeGoal,
  createProgram,
  deleteDay,
  type Move,
  moveDay,
  moveExercise,
  MoveSchema,
  type NewExerciseType,
  nextDayId,
  parseGoal,
  parseName,
  removeFromDay,
  renameDay,
  renameExercise,
  renameProgram,
  sameGoal,
} from '../program/edit.ts';
import { dayExercises, exerciseIndex, type ProgramIssue } from '../program/program.ts';
import { type Exercise, LoadTypeSchema, type Program } from '../program/schema.ts';
import type { Result } from '../../shared/result.ts';
import { moveTo, unchanged, withEffects } from './flow.ts';
import { requestProgram } from './program.ts';
import {
  type EditorExercise,
  type EditorNotice,
  EditorNoticeSchema,
  type RenameTarget,
  RenameTargetSchema,
  type Session,
  type SessionContext,
  SessionStepSchema,
  type StepContext,
  type StepResult,
} from './types.ts';

const S = SessionStepSchema.enum;
const NOTICE = EditorNoticeSchema.enum;
const TARGET = RenameTargetSchema.enum;
const { up, down } = MoveSchema.enum;

type EditContext = Extract<SessionContext, { kind: 'program_edit' }>;

const EDITOR_STEPS: ReadonlySet<string> = new Set([
  S.program_days,
  S.program_day,
  S.program_exercise,
  S.program_rename,
  S.program_remove_confirm,
  S.program_new_name,
  S.program_new_type,
  S.program_new_goal,
  S.program_pick,
  S.program_goal,
  S.program_day_new,
  S.program_first,
  S.program_day_delete_confirm,
  S.program_create,
]);

export const isEditor = (state: Session): boolean => EDITOR_STEPS.has(state.step);

const editContext = (state: Session): EditContext | null =>
  state.context.kind === 'program_edit' ? state.context : null;

const fresh: EditContext = {
  kind: 'program_edit',
  dayId: null,
  exerciseId: null,
  draftName: null,
  draftType: null,
  renameTarget: null,
  newDayName: null,
  newProgramName: null,
};

const toView = (e: Exercise): EditorExercise => ({
  id: e.id,
  name: e.name,
  loadType: e.loadType,
  workSets: e.workSets,
  repRange: 'repRange' in e ? e.repRange : null,
});

function daysScreen(state: Session, program: Program, notice: EditorNotice | null): StepResult {
  const byId = new Map(program.days.map((d) => [d.id, d.name]));
  return moveTo(state, S.program_days, {
    type: 'program_days',
    programName: program.name,
    days: program.rotation.map((id) => ({ id, name: byId.get(id) ?? id })),
    notice,
  }, fresh);
}

function dayScreen(
  state: Session,
  ctx: StepContext,
  program: Program,
  dayId: string,
  notice: EditorNotice | null,
): StepResult {
  const day = program.days.find((d) => d.id === dayId);
  if (!day) return daysScreen(state, program, null);
  const at = program.rotation.indexOf(dayId);
  return moveTo(state, S.program_day, {
    type: 'program_day',
    dayName: day.name,
    exercises: dayExercises(program, dayId).map(toView),
    canMoveUp: canMove(program.rotation, at, up),
    canMoveDown: canMove(program.rotation, at, down),
    deletable: canDeleteDay(program, dayId) && ctx.activeWorkout?.dayId !== dayId,
    notice,
  }, { ...fresh, dayId });
}

function exerciseScreen(
  state: Session,
  ctx: StepContext,
  program: Program,
  dayId: string,
  exerciseId: string,
  notice: EditorNotice | null,
): StepResult {
  const exercises = program.days.find((d) => d.id === dayId)?.exercises ?? [];
  const at = exercises.findIndex((e) => e.id === exerciseId);
  const exercise = dayExercises(program, dayId).find((e) => e.id === exerciseId);
  if (!exercise) return dayScreen(state, ctx, program, dayId, null);
  return moveTo(state, S.program_exercise, {
    type: 'program_exercise',
    exercise: toView(exercise),
    removable: canRemove(program, dayId),
    canMoveUp: canMove(exercises, at, up),
    canMoveDown: canMove(exercises, at, down),
    notice,
  }, { ...fresh, dayId, exerciseId });
}

const renameScreen = (
  state: Session,
  c: EditContext,
  target: RenameTarget,
  current: string,
  invalid: boolean,
): StepResult =>
  moveTo(state, S.program_rename, { type: 'program_rename', target, current, invalid }, {
    ...c,
    renameTarget: target,
  });

const dayNameScreen = (state: Session, c: EditContext, invalid: boolean): StepResult =>
  moveTo(state, S.program_day_new, {
    type: 'program_day_new',
    first: c.newProgramName !== null,
    invalid,
  }, { ...c, newDayName: null });

const createScreen = (state: Session, invalid: boolean): StepResult =>
  moveTo(state, S.program_create, { type: 'program_create', invalid }, fresh);

const firstScreen = (state: Session, ctx: StepContext, c: EditContext): StepResult =>
  moveTo(state, S.program_first, {
    type: 'program_first',
    dayName: c.newDayName ?? '',
    fromProgram: ctx.activeProgram !== null,
  }, { ...c, draftName: null, draftType: null });

const newNameScreen = (state: Session, c: EditContext, invalid: boolean): StepResult =>
  moveTo(state, S.program_new_name, { type: 'program_new_name', invalid }, {
    ...c,
    draftName: null,
  });

const saved = (result: StepResult, program: Program): StepResult =>
  withEffects(result, [{ type: 'save_program', program }]);

function applied(
  edited: Result<Program, readonly ProgramIssue[]>,
  onSaved: (program: Program) => StepResult,
  onFailed: () => StepResult,
): StepResult {
  return edited.ok ? saved(onSaved(edited.value), edited.value) : onFailed();
}

export function openEditor(state: Session, ctx: StepContext): StepResult {
  const program = ctx.activeProgram;
  if (!program || (state.step !== S.program_upload && !isEditor(state))) return unchanged(state);
  return daysScreen(state, program, null);
}

export function requestCreate(state: Session, ctx: StepContext): StepResult {
  if (ctx.activeProgram || state.step !== S.program_upload) return unchanged(state);
  return createScreen(state, false);
}

export function pickEditorDay(state: Session, ctx: StepContext, dayId: string): StepResult {
  const program = ctx.activeProgram;
  if (!program || state.step !== S.program_days) return unchanged(state);
  return dayScreen(state, ctx, program, dayId, null);
}

export function pickEditorExercise(
  state: Session,
  ctx: StepContext,
  exerciseId: string,
): StepResult {
  const c = editContext(state);
  const program = ctx.activeProgram;
  if (!c?.dayId || !program || state.step !== S.program_day) return unchanged(state);
  return exerciseScreen(state, ctx, program, c.dayId, exerciseId, null);
}

export function requestRename(state: Session, ctx: StepContext): StepResult {
  const c = editContext(state);
  const exercise = c?.exerciseId && ctx.activeProgram
    ? exerciseIndex(ctx.activeProgram).get(c.exerciseId)
    : undefined;
  if (!c || !exercise || state.step !== S.program_exercise) return unchanged(state);
  return renameScreen(state, c, TARGET.exercise, exercise.name, false);
}

export function requestDayRename(state: Session, ctx: StepContext): StepResult {
  const c = editContext(state);
  const day = ctx.activeProgram?.days.find((d) => d.id === c?.dayId);
  if (!c || !day || state.step !== S.program_day) return unchanged(state);
  return renameScreen(state, c, TARGET.day, day.name, false);
}

export function requestProgramRename(state: Session, ctx: StepContext): StepResult {
  const c = editContext(state);
  const program = ctx.activeProgram;
  if (!c || !program || state.step !== S.program_days) return unchanged(state);
  return renameScreen(state, c, TARGET.program, program.name, false);
}

export function requestGoal(state: Session, ctx: StepContext): StepResult {
  const c = editContext(state);
  const exercise = c?.exerciseId && ctx.activeProgram
    ? exerciseIndex(ctx.activeProgram).get(c.exerciseId)
    : undefined;
  if (!c || !exercise || state.step !== S.program_exercise) return unchanged(state);
  return moveTo(state, S.program_goal, {
    type: 'program_goal',
    exercise: toView(exercise),
    invalid: false,
  }, c);
}

export function moveInEditor(state: Session, ctx: StepContext, move: Move): StepResult {
  const c = editContext(state);
  const program = ctx.activeProgram;
  if (!c?.dayId || !program) return unchanged(state);
  const { dayId, exerciseId } = c;
  if (state.step === S.program_day) {
    return applied(
      moveDay(program, dayId, move),
      (next) => dayScreen(state, ctx, next, dayId, NOTICE.saved),
      () => dayScreen(state, ctx, program, dayId, NOTICE.failed),
    );
  }
  if (state.step === S.program_exercise && exerciseId) {
    return applied(
      moveExercise(program, dayId, exerciseId, move),
      (next) => exerciseScreen(state, ctx, next, dayId, exerciseId, NOTICE.saved),
      () => exerciseScreen(state, ctx, program, dayId, exerciseId, NOTICE.failed),
    );
  }
  return unchanged(state);
}

export function requestRemove(state: Session, ctx: StepContext): StepResult {
  const c = editContext(state);
  const program = ctx.activeProgram;
  if (!c?.dayId || !c.exerciseId || !program || state.step !== S.program_exercise) {
    return unchanged(state);
  }
  const exercise = exerciseIndex(program).get(c.exerciseId);
  const day = program.days.find((d) => d.id === c.dayId);
  if (!exercise || !day || !canRemove(program, c.dayId)) return unchanged(state);
  return moveTo(state, S.program_remove_confirm, {
    type: 'program_remove_confirm',
    exerciseName: exercise.name,
    dayName: day.name,
  }, c);
}

export function requestDayDelete(state: Session, ctx: StepContext): StepResult {
  const c = editContext(state);
  const program = ctx.activeProgram;
  const day = program?.days.find((d) => d.id === c?.dayId);
  if (!c || !program || !day || state.step !== S.program_day) return unchanged(state);
  if (!canDeleteDay(program, day.id) || ctx.activeWorkout?.dayId === day.id) {
    return unchanged(state);
  }
  return moveTo(state, S.program_day_delete_confirm, {
    type: 'program_day_delete_confirm',
    dayName: day.name,
  }, c);
}

export function answerRemove(state: Session, ctx: StepContext, confirm: boolean): StepResult {
  const c = editContext(state);
  const program = ctx.activeProgram;
  if (!c?.dayId || !program) return unchanged(state);
  const { dayId, exerciseId } = c;
  if (state.step === S.program_day_delete_confirm) {
    if (!confirm || ctx.activeWorkout?.dayId === dayId) {
      return dayScreen(state, ctx, program, dayId, null);
    }
    return applied(
      deleteDay(program, dayId),
      (next) => daysScreen(state, next, NOTICE.deleted),
      () => dayScreen(state, ctx, program, dayId, NOTICE.failed),
    );
  }
  if (!exerciseId || state.step !== S.program_remove_confirm) return unchanged(state);
  if (!confirm) return exerciseScreen(state, ctx, program, dayId, exerciseId, null);
  return applied(
    removeFromDay(program, dayId, exerciseId),
    (next) => dayScreen(state, ctx, next, dayId, NOTICE.removed),
    () => dayScreen(state, ctx, program, dayId, NOTICE.failed),
  );
}

export function requestNewDay(state: Session, ctx: StepContext): StepResult {
  const c = editContext(state);
  if (!c || !ctx.activeProgram || state.step !== S.program_days) return unchanged(state);
  return dayNameScreen(state, fresh, false);
}

const choosesFirst = (state: Session, c: EditContext): boolean =>
  state.step === S.program_first && c.newDayName !== null;

export function requestNew(state: Session): StepResult {
  const c = editContext(state);
  if (!c) return unchanged(state);
  if (!(c.dayId && state.step === S.program_day) && !choosesFirst(state, c)) {
    return unchanged(state);
  }
  return newNameScreen(state, c, false);
}

export function chooseNewType(state: Session, loadType: NewExerciseType): StepResult {
  const c = editContext(state);
  if (!c?.draftName || state.step !== S.program_new_type) return unchanged(state);
  return goalScreen(state, { ...c, draftType: loadType }, false);
}

function goalScreen(state: Session, c: EditContext, invalid: boolean): StepResult {
  return moveTo(state, S.program_new_goal, {
    type: 'program_new_goal',
    name: c.draftName ?? '',
    repsOnly: c.draftType === LoadTypeSchema.enum.reps_only,
    invalid,
  }, c);
}

const typeScreen = (state: Session, c: EditContext): StepResult =>
  moveTo(state, S.program_new_type, { type: 'program_new_type', name: c.draftName ?? '' }, {
    ...c,
    draftType: null,
  });

export function requestFromProgram(state: Session, ctx: StepContext): StepResult {
  const c = editContext(state);
  const program = ctx.activeProgram;
  if (!c || !program) return unchanged(state);
  if (!(c.dayId && state.step === S.program_day) && !choosesFirst(state, c)) {
    return unchanged(state);
  }
  return moveTo(state, S.program_pick, {
    type: 'program_pick',
    options: addableToDay(program, c.dayId ?? '').map((e) => ({ id: e.id, name: e.name })),
  }, c);
}

export function pickFromProgram(state: Session, ctx: StepContext, exerciseId: string): StepResult {
  const c = editContext(state);
  const program = ctx.activeProgram;
  if (!c || !program || state.step !== S.program_pick) return unchanged(state);
  const { dayId, newDayName } = c;
  if (dayId) {
    return applied(
      addFromProgram(program, dayId, exerciseId),
      (next) => dayScreen(state, ctx, next, dayId, NOTICE.added),
      () => dayScreen(state, ctx, program, dayId, NOTICE.failed),
    );
  }
  if (newDayName === null) return unchanged(state);
  const newDayId = nextDayId(program);
  return applied(
    addDayFromProgram(program, newDayName, exerciseId),
    (next) => dayScreen(state, ctx, next, newDayId, NOTICE.added),
    () => daysScreen(state, program, NOTICE.failed),
  );
}

function renameText(
  state: Session,
  ctx: StepContext,
  program: Program,
  c: EditContext,
  text: string,
): StepResult {
  const { dayId, exerciseId } = c;
  const day = program.days.find((d) => d.id === dayId);
  const exercise = exerciseId ? exerciseIndex(program).get(exerciseId) : undefined;
  const name = parseName(text);
  switch (c.renameTarget) {
    case TARGET.exercise: {
      if (!dayId || !exercise) return daysScreen(state, program, null);
      if (name === null) return renameScreen(state, c, TARGET.exercise, exercise.name, true);
      if (name === exercise.name) {
        return exerciseScreen(state, ctx, program, dayId, exercise.id, null);
      }
      return applied(
        renameExercise(program, exercise.id, name),
        (next) => exerciseScreen(state, ctx, next, dayId, exercise.id, NOTICE.saved),
        () => exerciseScreen(state, ctx, program, dayId, exercise.id, NOTICE.failed),
      );
    }
    case TARGET.day: {
      if (!day) return daysScreen(state, program, null);
      if (name === null) return renameScreen(state, c, TARGET.day, day.name, true);
      if (name === day.name) return dayScreen(state, ctx, program, day.id, null);
      return applied(
        renameDay(program, day.id, name),
        (next) => dayScreen(state, ctx, next, day.id, NOTICE.saved),
        () => dayScreen(state, ctx, program, day.id, NOTICE.failed),
      );
    }
    case TARGET.program: {
      if (name === null) return renameScreen(state, c, TARGET.program, program.name, true);
      if (name === program.name) return daysScreen(state, program, null);
      return applied(
        renameProgram(program, name),
        (next) => daysScreen(state, next, NOTICE.saved),
        () => daysScreen(state, program, NOTICE.failed),
      );
    }
    case null:
      return daysScreen(state, program, null);
  }
}

function goalText(
  state: Session,
  ctx: StepContext,
  program: Program,
  c: EditContext,
  text: string,
): StepResult {
  const { dayId, exerciseId } = c;
  const exercise = exerciseId ? exerciseIndex(program).get(exerciseId) : undefined;
  if (!dayId || !exercise) return daysScreen(state, program, null);
  const goal = parseGoal(text, exercise.loadType);
  if (!goal) {
    return moveTo(state, S.program_goal, {
      type: 'program_goal',
      exercise: toView(exercise),
      invalid: true,
    }, c);
  }
  if (sameGoal(exercise, goal)) {
    return exerciseScreen(state, ctx, program, dayId, exercise.id, null);
  }
  return applied(
    changeGoal(program, exercise.id, goal),
    (next) => exerciseScreen(state, ctx, next, dayId, exercise.id, NOTICE.saved),
    () => exerciseScreen(state, ctx, program, dayId, exercise.id, NOTICE.failed),
  );
}

function newGoalText(state: Session, ctx: StepContext, c: EditContext, text: string): StepResult {
  const program = ctx.activeProgram;
  const { draftName, draftType, dayId, newDayName, newProgramName } = c;
  if (!draftName || !draftType) return unchanged(state);
  const goal = parseGoal(text, draftType);
  if (!goal) return goalScreen(state, c, true);
  const draft = { name: draftName, loadType: draftType, goal };
  if (program && dayId) {
    return applied(
      addNewExercise(program, dayId, draft),
      (next) => dayScreen(state, ctx, next, dayId, NOTICE.added),
      () => dayScreen(state, ctx, program, dayId, NOTICE.failed),
    );
  }
  if (program && newDayName !== null) {
    const newDayId = nextDayId(program);
    return applied(
      addDayWithNew(program, newDayName, draft),
      (next) => dayScreen(state, ctx, next, newDayId, NOTICE.added),
      () => daysScreen(state, program, NOTICE.failed),
    );
  }
  if (!program && newProgramName !== null && newDayName !== null) {
    return applied(
      createProgram(newProgramName, newDayName, draft),
      (next) => dayScreen(state, ctx, next, next.rotation[0] ?? '', NOTICE.created),
      () => createScreen(state, false),
    );
  }
  return unchanged(state);
}

export function editorText(state: Session, ctx: StepContext, text: string): StepResult {
  const c = editContext(state);
  const program = ctx.activeProgram;
  if (!c) return unchanged(state);
  switch (state.step) {
    case S.program_rename:
      return program ? renameText(state, ctx, program, c, text) : unchanged(state);
    case S.program_goal:
      return program ? goalText(state, ctx, program, c, text) : unchanged(state);
    case S.program_create: {
      const name = parseName(text);
      if (name === null) return createScreen(state, true);
      return dayNameScreen(state, { ...fresh, newProgramName: name }, false);
    }
    case S.program_day_new: {
      const name = parseName(text);
      if (name === null) return dayNameScreen(state, c, true);
      return firstScreen(state, ctx, { ...c, newDayName: name });
    }
    case S.program_new_name: {
      const name = parseName(text);
      if (name === null) return newNameScreen(state, c, true);
      return typeScreen(state, { ...c, draftName: name });
    }
    case S.program_new_goal:
      return newGoalText(state, ctx, c, text);
    default:
      return unchanged(state);
  }
}

function backToTarget(state: Session, ctx: StepContext, c: EditContext): StepResult {
  const program = ctx.activeProgram;
  if (c.dayId && program) return dayScreen(state, ctx, program, c.dayId, null);
  if (c.newDayName !== null) return firstScreen(state, ctx, c);
  return program ? daysScreen(state, program, null) : requestProgram(state, ctx);
}

export function editorBack(state: Session, ctx: StepContext): StepResult {
  const c = editContext(state) ?? fresh;
  const program = ctx.activeProgram;
  switch (state.step) {
    case S.program_days:
    case S.program_create:
      return requestProgram(state, ctx);
    case S.program_day_new:
      return program ? daysScreen(state, program, null) : createScreen(state, false);
    case S.program_first:
      return dayNameScreen(state, c, false);
    case S.program_new_name:
    case S.program_pick:
      return backToTarget(state, ctx, c);
    case S.program_new_type:
      return newNameScreen(state, c, false);
    case S.program_new_goal:
      return typeScreen(state, c);
  }
  if (!program) return requestProgram(state, ctx);
  const { dayId, exerciseId } = c;
  switch (state.step) {
    case S.program_day:
      return daysScreen(state, program, null);
    case S.program_exercise:
    case S.program_day_delete_confirm:
      return dayId ? dayScreen(state, ctx, program, dayId, null) : daysScreen(state, program, null);
    case S.program_remove_confirm:
    case S.program_goal:
      return dayId && exerciseId
        ? exerciseScreen(state, ctx, program, dayId, exerciseId, null)
        : daysScreen(state, program, null);
    case S.program_rename:
      if (c.renameTarget === TARGET.program || !dayId) return daysScreen(state, program, null);
      return c.renameTarget === TARGET.exercise && exerciseId
        ? exerciseScreen(state, ctx, program, dayId, exerciseId, null)
        : dayScreen(state, ctx, program, dayId, null);
    default:
      return unchanged(state);
  }
}
