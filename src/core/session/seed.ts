import { parseSetInput, type SetInputError } from '../input/set-input.ts';
import { seedExercises } from '../program/program.ts';
import { LoadTypeSchema } from '../program/schema.ts';
import { weightStep } from '../program/weight-step.ts';
import { localDateOf } from '../schedule/calendar.ts';
import { moveTo, unchanged, withEffects } from './flow.ts';
import { askTime } from './onboarding.ts';
import { type Session, SessionStepSchema, type StepContext, type StepResult } from './types.ts';

const { idle, seed } = SessionStepSchema.enum;

export function requestSeed(state: Session, ctx: StepContext): StepResult {
  if (ctx.activeProgram === null) return moveTo(state, idle, { type: 'needs_program' });
  if (ctx.settings.timezone === null) return askTime(state, null);
  return prompt(state, ctx, 0, 0, null);
}

export function skipSeed(state: Session, ctx: StepContext): StepResult {
  const c = state.context;
  if (state.step !== seed || c.kind !== 'seed') return unchanged(state);
  return prompt(state, ctx, c.index + 1, c.filled, null);
}

export function stopSeed(state: Session, ctx: StepContext): StepResult {
  const c = state.context;
  if (state.step !== seed || c.kind !== 'seed') return unchanged(state);
  return done(state, c.filled, total(ctx));
}

export function seedText(state: Session, text: string, ctx: StepContext): StepResult {
  const c = state.context;
  const exercise = ctx.activeProgram
    ? seedExercises(ctx.activeProgram)[c.kind === 'seed' ? c.index : -1]
    : undefined;
  const zone = ctx.settings.timezone;
  if (c.kind !== 'seed' || exercise === undefined || zone === null) {
    return done(state, 0, total(ctx));
  }

  const parsed = parseSetInput(text, { loadType: exercise.loadType, suggestedLb: null });
  if (!parsed.ok) return prompt(state, ctx, c.index, c.filled, parsed.error);
  const { weightLb, reps, comment } = parsed.value;
  return withEffects(prompt(state, ctx, c.index + 1, c.filled + 1, null), [{
    type: 'record_manual_result',
    result: {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      weightLb,
      reps,
      comment,
      localDate: localDateOf(ctx.now, zone),
      stepLbUsed: weightStep(exercise, ctx.settings),
    },
  }]);
}

function prompt(
  state: Session,
  ctx: StepContext,
  index: number,
  filled: number,
  error: SetInputError | null,
): StepResult {
  const list = ctx.activeProgram ? seedExercises(ctx.activeProgram) : [];
  const exercise = list[index];
  if (exercise === undefined) return done(state, filled, list.length);
  return moveTo(state, seed, {
    type: 'seed_prompt',
    exerciseName: exercise.name,
    position: index + 1,
    total: list.length,
    addedWeight: exercise.loadType === LoadTypeSchema.enum.weighted_bodyweight,
    current: ctx.lastResults[exercise.id] ?? null,
    error,
  }, { kind: 'seed', index, filled });
}

const done = (state: Session, filled: number, count: number): StepResult =>
  moveTo(state, idle, { type: 'seed_done', filled, total: count });

const total = (ctx: StepContext): number =>
  ctx.activeProgram ? seedExercises(ctx.activeProgram).length : 0;
