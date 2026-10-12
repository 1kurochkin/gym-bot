import { parseProgramText, programSummary, sameProgram } from '../program/program.ts';
import type { Program } from '../program/schema.ts';
import { moveTo, withEffects } from './flow.ts';
import {
  type FileProblem,
  type ProgramRef,
  type Session,
  SessionStepSchema,
  type StepContext,
  type StepResult,
} from './types.ts';

const { idle, program_upload } = SessionStepSchema.enum;

const currentRef = (ctx: StepContext): ProgramRef | null =>
  ctx.programs.find((p) => p.id === ctx.settings.activeProgramId) ?? null;

export const otherPrograms = (ctx: StepContext, key: string | null): readonly string[] =>
  ctx.programs.filter((p) => p.key !== key).map((p) => p.name);

export function requestProgram(
  state: Session,
  ctx: StepContext,
  archived: string | null = null,
): StepResult {
  const program = ctx.activeProgram;
  return moveTo(state, program_upload, {
    type: 'program_status',
    current: program ? programSummary(program) : null,
    fromText: ctx.llm.enabled,
    others: otherPrograms(ctx, program?.id ?? null),
    switchable: ctx.programs.length > 1 && ctx.activeWorkout === null,
    archivable: currentRef(ctx) !== null && ctx.activeWorkout === null,
    archived,
  });
}

export function receiveProgram(state: Session, text: string, ctx: StepContext): StepResult {
  const parsed = parseProgramText(text);
  if (!parsed.ok) {
    return moveTo(state, program_upload, { type: 'program_invalid', issues: parsed.error });
  }
  const program = parsed.value;
  const active = ctx.activeProgram;
  if (active && sameProgram(active, program)) {
    return moveTo(state, idle, { type: 'program_unchanged' });
  }
  return saveProgram(state, ctx, program);
}

export const rejectProgramFile = (state: Session, reason: FileProblem): StepResult =>
  moveTo(state, program_upload, { type: 'program_file_rejected', reason });

export const cancelProgram = (state: Session): StepResult =>
  moveTo(state, idle, { type: 'program_cancelled' });

export const saveProgram = (state: Session, ctx: StepContext, program: Program): StepResult =>
  withEffects(
    moveTo(state, idle, {
      type: 'program_saved',
      summary: programSummary(program),
      others: otherPrograms(ctx, program.id),
    }),
    [{ type: 'save_program', program }],
  );
