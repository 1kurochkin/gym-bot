import type { ConvertOutcome } from '../program/draft.ts';
import { dayExercises, programSummary } from '../program/program.ts';
import { moveTo, unchanged, withEffects } from './flow.ts';
import { cancelProgram } from './program.ts';
import { daysScreen, toView } from './program-editor.ts';
import {
  type BotEvent,
  ConvertRefusalSchema,
  EditorNoticeSchema,
  type Session,
  SessionStepSchema,
  type StepContext,
  type StepResult,
} from './types.ts';

const S = SessionStepSchema.enum;

export const needsLlmUsage = (state: Session, event: BotEvent): boolean =>
  event.type === 'text_entered' && state.step === S.program_text;

export const isConverting = (state: Session): boolean =>
  state.step === S.program_text || state.step === S.program_converting ||
  state.step === S.program_draft;

export function requestConvert(state: Session, ctx: StepContext): StepResult {
  if (!ctx.llm.enabled || state.step !== S.program_upload) return unchanged(state);
  return moveTo(state, S.program_text, { type: 'program_text_ask' });
}

export function convertText(state: Session, ctx: StepContext, text: string): StepResult {
  if (state.step !== S.program_text) return unchanged(state);
  if (!ctx.isOwner && ctx.llm.used >= ctx.llm.limit) {
    return moveTo(state, S.program_upload, {
      type: 'program_convert_failed',
      reason: ConvertRefusalSchema.enum.limit,
    });
  }
  const requestId = ctx.newIds[0] ?? '';
  return withEffects(
    moveTo(state, S.program_converting, { type: 'program_converting' }, {
      kind: 'program_converting',
      requestId,
    }),
    [{ type: 'convert_program', requestId, text }],
  );
}

export function receiveDraft(
  state: Session,
  ctx: StepContext,
  requestId: string,
  outcome: ConvertOutcome,
): StepResult {
  const c = state.context;
  if (state.step !== S.program_converting || c.kind !== 'program_converting') {
    return unchanged(state);
  }
  if (c.requestId !== requestId) return unchanged(state);
  if (!outcome.ok) {
    return moveTo(state, S.program_upload, {
      type: 'program_convert_failed',
      reason: outcome.reason,
    });
  }
  const { program, unparsed } = outcome;
  const byId = new Map(program.days.map((d) => [d.id, d.name]));
  return moveTo(state, S.program_draft, {
    type: 'program_draft',
    summary: programSummary(program),
    days: program.rotation.map((id) => ({
      name: byId.get(id) ?? id,
      exercises: dayExercises(program, id).map(toView),
    })),
    unparsed,
    replaces: ctx.activeProgram?.name ?? null,
  }, { kind: 'program_draft', program, unparsed });
}

export function saveDraft(state: Session): StepResult {
  const c = state.context;
  if (state.step !== S.program_draft || c.kind !== 'program_draft') return unchanged(state);
  return withEffects(daysScreen(state, c.program, EditorNoticeSchema.enum.saved), [
    { type: 'save_program', program: c.program },
  ]);
}

export const cancelDraft = (state: Session): StepResult =>
  state.step === S.program_draft ? cancelProgram(state) : unchanged(state);
