import { parseProgramText, programSummary, sameProgram } from '../program/program.ts';
import type { Program } from '../program/schema.ts';
import { moveTo, unchanged, withEffects } from './flow.ts';
import {
  type FileProblem,
  type Session,
  SessionStepSchema,
  type StepContext,
  type StepResult,
} from './types.ts';

/** Загрузка программы, US-1 (.specs/product.md). */

const { idle, program_upload, program_confirm } = SessionStepSchema.enum;

/** /program: показать текущую программу и ждать JSON. */
export const requestProgram = (state: Session, ctx: StepContext): StepResult =>
  moveTo(state, program_upload, {
    type: 'program_status',
    current: ctx.activeProgram ? programSummary(ctx.activeProgram) : null,
  });

/** Пришёл текст программы — файлом (в любой момент) или сообщением (после /program). */
export function receiveProgram(state: Session, text: string, ctx: StepContext): StepResult {
  const parsed = parseProgramText(text);
  if (!parsed.ok) {
    return moveTo(state, program_upload, { type: 'program_invalid', issues: parsed.error });
  }
  const program = parsed.value;
  const active = ctx.activeProgram;
  if (active === null) return save(state, program);
  if (sameProgram(active, program)) return moveTo(state, idle, { type: 'program_unchanged' });
  return moveTo(
    state,
    program_confirm,
    { type: 'program_confirm', incoming: programSummary(program), currentName: active.name },
    { kind: 'program_pending', program },
  );
}

export const rejectProgramFile = (state: Session, reason: FileProblem): StepResult =>
  moveTo(state, program_upload, { type: 'program_file_rejected', reason });

/** [Заменить]: сохраняем программу, которая ждала подтверждения. */
export function confirmProgram(state: Session): StepResult {
  const ctx = state.context;
  if (state.step !== program_confirm || ctx.kind !== 'program_pending') {
    return unchanged(state);
  }
  return save(state, ctx.program);
}

export const cancelProgram = (state: Session): StepResult =>
  moveTo(state, idle, { type: 'program_cancelled' });

const save = (state: Session, program: Program): StepResult =>
  withEffects(moveTo(state, idle, { type: 'program_saved', summary: programSummary(program) }), [
    { type: 'save_program', program },
  ]);
