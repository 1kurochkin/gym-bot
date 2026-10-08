import {
  addableToDay,
  addFromProgram,
  addNewExercise,
  canRemove,
  type NewExerciseType,
  parseExerciseName,
  parseGoal,
  removeFromDay,
  renameExercise,
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
  type Session,
  type SessionContext,
  SessionStepSchema,
  type StepContext,
  type StepResult,
} from './types.ts';

const S = SessionStepSchema.enum;
const NOTICE = EditorNoticeSchema.enum;

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
};

const toView = (e: Exercise): EditorExercise => ({
  id: e.id,
  name: e.name,
  loadType: e.loadType,
  workSets: e.workSets,
  repRange: 'repRange' in e ? e.repRange : null,
});

function daysScreen(state: Session, program: Program): StepResult {
  const byId = new Map(program.days.map((d) => [d.id, d.name]));
  return moveTo(state, S.program_days, {
    type: 'program_days',
    days: program.rotation.map((id) => ({ id, name: byId.get(id) ?? id })),
  }, fresh);
}

function dayScreen(
  state: Session,
  program: Program,
  dayId: string,
  notice: EditorNotice | null,
): StepResult {
  const day = program.days.find((d) => d.id === dayId);
  if (!day) return daysScreen(state, program);
  return moveTo(state, S.program_day, {
    type: 'program_day',
    dayName: day.name,
    exercises: dayExercises(program, dayId).map(toView),
    notice,
  }, { ...fresh, dayId });
}

function exerciseScreen(
  state: Session,
  program: Program,
  dayId: string,
  exerciseId: string,
  notice: EditorNotice | null,
): StepResult {
  const exercise = dayExercises(program, dayId).find((e) => e.id === exerciseId);
  if (!exercise) return dayScreen(state, program, dayId, null);
  return moveTo(state, S.program_exercise, {
    type: 'program_exercise',
    exercise: toView(exercise),
    removable: canRemove(program, dayId),
    notice,
  }, { ...fresh, dayId, exerciseId });
}

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
  return daysScreen(state, program);
}

export function pickEditorDay(state: Session, ctx: StepContext, dayId: string): StepResult {
  const program = ctx.activeProgram;
  if (!program || state.step !== S.program_days) return unchanged(state);
  return dayScreen(state, program, dayId, null);
}

export function pickEditorExercise(
  state: Session,
  ctx: StepContext,
  exerciseId: string,
): StepResult {
  const c = editContext(state);
  const program = ctx.activeProgram;
  if (!c?.dayId || !program || state.step !== S.program_day) return unchanged(state);
  return exerciseScreen(state, program, c.dayId, exerciseId, null);
}

export function requestRename(state: Session, ctx: StepContext): StepResult {
  const c = editContext(state);
  const exercise = c?.exerciseId && ctx.activeProgram
    ? exerciseIndex(ctx.activeProgram).get(c.exerciseId)
    : undefined;
  if (!c || !exercise || state.step !== S.program_exercise) return unchanged(state);
  return moveTo(state, S.program_rename, {
    type: 'program_rename',
    current: exercise.name,
    invalid: false,
  }, c);
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

export function answerRemove(state: Session, ctx: StepContext, confirm: boolean): StepResult {
  const c = editContext(state);
  const program = ctx.activeProgram;
  if (!c?.dayId || !c.exerciseId || !program || state.step !== S.program_remove_confirm) {
    return unchanged(state);
  }
  const { dayId, exerciseId } = c;
  if (!confirm) return exerciseScreen(state, program, dayId, exerciseId, null);
  return applied(
    removeFromDay(program, dayId, exerciseId),
    (next) => dayScreen(state, next, dayId, NOTICE.removed),
    () => dayScreen(state, program, dayId, NOTICE.failed),
  );
}

export function requestNew(state: Session): StepResult {
  const c = editContext(state);
  if (!c?.dayId || state.step !== S.program_day) return unchanged(state);
  return moveTo(state, S.program_new_name, { type: 'program_new_name', invalid: false }, c);
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
  moveTo(state, S.program_new_type, { type: 'program_new_type', name: c.draftName ?? '' }, c);

export function requestFromProgram(state: Session, ctx: StepContext): StepResult {
  const c = editContext(state);
  const program = ctx.activeProgram;
  if (!c?.dayId || !program || state.step !== S.program_day) return unchanged(state);
  return moveTo(state, S.program_pick, {
    type: 'program_pick',
    options: addableToDay(program, c.dayId).map((e) => ({ id: e.id, name: e.name })),
  }, c);
}

export function pickFromProgram(state: Session, ctx: StepContext, exerciseId: string): StepResult {
  const c = editContext(state);
  const program = ctx.activeProgram;
  if (!c?.dayId || !program || state.step !== S.program_pick) return unchanged(state);
  const { dayId } = c;
  return applied(
    addFromProgram(program, dayId, exerciseId),
    (next) => dayScreen(state, next, dayId, NOTICE.added),
    () => dayScreen(state, program, dayId, NOTICE.failed),
  );
}

export function editorText(state: Session, ctx: StepContext, text: string): StepResult {
  const c = editContext(state);
  const program = ctx.activeProgram;
  if (!c?.dayId || !program) return unchanged(state);
  const { dayId } = c;
  switch (state.step) {
    case S.program_rename: {
      const exercise = c.exerciseId ? exerciseIndex(program).get(c.exerciseId) : undefined;
      if (!exercise) return dayScreen(state, program, dayId, null);
      const name = parseExerciseName(text);
      if (name === null) {
        return moveTo(state, S.program_rename, {
          type: 'program_rename',
          current: exercise.name,
          invalid: true,
        }, c);
      }
      if (name === exercise.name) return exerciseScreen(state, program, dayId, exercise.id, null);
      return applied(
        renameExercise(program, exercise.id, name),
        (next) => exerciseScreen(state, next, dayId, exercise.id, NOTICE.saved),
        () => exerciseScreen(state, program, dayId, exercise.id, NOTICE.failed),
      );
    }
    case S.program_new_name: {
      const name = parseExerciseName(text);
      if (name === null) {
        return moveTo(state, S.program_new_name, { type: 'program_new_name', invalid: true }, c);
      }
      return typeScreen(state, { ...c, draftName: name });
    }
    case S.program_new_goal: {
      const { draftName, draftType } = c;
      if (!draftName || !draftType) return dayScreen(state, program, dayId, null);
      const goal = parseGoal(text, draftType);
      if (!goal) return goalScreen(state, c, true);
      return applied(
        addNewExercise(program, dayId, { name: draftName, loadType: draftType, goal }),
        (next) => dayScreen(state, next, dayId, NOTICE.added),
        () => dayScreen(state, program, dayId, NOTICE.failed),
      );
    }
    default:
      return unchanged(state);
  }
}

export function editorBack(state: Session, ctx: StepContext): StepResult {
  const c = editContext(state);
  const program = ctx.activeProgram;
  if (!program) return unchanged(state);
  if (state.step === S.program_days || !c?.dayId) return requestProgram(state, ctx);
  const { dayId } = c;
  switch (state.step) {
    case S.program_day:
      return daysScreen(state, program);
    case S.program_exercise:
    case S.program_new_name:
    case S.program_pick:
      return dayScreen(state, program, dayId, null);
    case S.program_rename:
    case S.program_remove_confirm:
      return c.exerciseId
        ? exerciseScreen(state, program, dayId, c.exerciseId, null)
        : dayScreen(state, program, dayId, null);
    case S.program_new_type:
      return moveTo(state, S.program_new_name, { type: 'program_new_name', invalid: false }, {
        ...c,
        draftName: null,
      });
    case S.program_new_goal:
      return typeScreen(state, { ...c, draftType: null });
    default:
      return unchanged(state);
  }
}
