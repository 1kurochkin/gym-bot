import { moveTo, unchanged, withEffects } from './flow.ts';
import { requestProgram } from './program.ts';
import { chooseDayScreen } from './workout.ts';
import {
  type BotEvent,
  emptyContext,
  type ProgramRef,
  type Session,
  SessionStepSchema,
  type StepContext,
  type StepResult,
  type SwitchOrigin,
  SwitchOriginSchema,
} from './types.ts';

const S = SessionStepSchema.enum;
const ORIGIN = SwitchOriginSchema.enum;

const originOf = (state: Session): SwitchOrigin | null => {
  if (state.step === S.program_upload) return ORIGIN.program;
  if (state.step === S.workout_day) return ORIGIN.workout;
  return null;
};

const reopen = (origin: SwitchOrigin): BotEvent =>
  origin === ORIGIN.workout ? { type: 'workout_requested' } : { type: 'program_requested' };

export function requestSwitch(state: Session, ctx: StepContext): StepResult {
  const from = originOf(state);
  if (!from || ctx.programs.length < 2 || ctx.activeWorkout) return unchanged(state);
  return moveTo(state, S.program_switch, {
    type: 'program_switch',
    options: ctx.programs.map((p) => ({
      id: p.id,
      name: p.name,
      current: p.id === ctx.settings.activeProgramId,
    })),
  }, { kind: 'program_switch', from });
}

export function switchProgram(state: Session, ctx: StepContext, programId: string): StepResult {
  const c = state.context;
  if (state.step !== S.program_switch || c.kind !== 'program_switch' || ctx.activeWorkout) {
    return unchanged(state);
  }
  if (!ctx.programs.some((p) => p.id === programId)) return unchanged(state);
  const settings = { ...ctx.settings, activeProgramId: programId };
  return {
    state: { ...state, step: S.idle, context: emptyContext },
    effects: [{ type: 'save_settings', settings }, { type: 'follow_up', event: reopen(c.from) }],
  };
}

export function switchBack(state: Session, ctx: StepContext): StepResult {
  const c = state.context;
  if (c.kind !== 'program_switch') return requestProgram(state, ctx);
  return c.from === ORIGIN.workout ? chooseDayScreen(state, ctx) : requestProgram(state, ctx);
}

const current = (ctx: StepContext): ProgramRef | null =>
  ctx.programs.find((p) => p.id === ctx.settings.activeProgramId) ?? null;

export function requestArchive(state: Session, ctx: StepContext): StepResult {
  const program = current(ctx);
  if (state.step !== S.program_upload || !program || ctx.activeWorkout) return unchanged(state);
  return moveTo(state, S.program_archive_confirm, {
    type: 'program_archive_confirm',
    name: program.name,
  });
}

export function answerArchive(state: Session, ctx: StepContext, confirm: boolean): StepResult {
  const program = current(ctx);
  if (state.step !== S.program_archive_confirm) return unchanged(state);
  if (!confirm || !program || ctx.activeWorkout) return requestProgram(state, ctx);
  const next = ctx.programs.find((p) => p.id !== program.id) ?? null;
  const settings = { ...ctx.settings, activeProgramId: next?.id ?? null };
  return withEffects({ state: { ...state, step: S.idle, context: emptyContext }, effects: [] }, [
    { type: 'archive_program', programId: program.id },
    { type: 'save_settings', settings },
    { type: 'follow_up', event: { type: 'program_requested', archived: program.name } },
  ]);
}

export const isSwitching = (state: Session): boolean => state.step === S.program_switch;
