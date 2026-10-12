import { type TimeZone, zoneLabel } from '../schedule/timezone.ts';
import {
  type Effect,
  emptyContext,
  type Guide,
  type Session,
  type SessionStep,
  SessionStepSchema,
  type StepContext,
  type StepResult,
  type View,
} from './types.ts';

export const unchanged = (state: Session): StepResult => ({ state, effects: [] });

export function moveTo(
  state: Session,
  next: SessionStep,
  view: View,
  context: Session['context'] = emptyContext,
): StepResult {
  const effects: Effect[] = [{ type: 'render', view }];
  return { state: { ...state, step: next, context }, effects };
}

export const withEffects = (result: StepResult, effects: readonly Effect[]): StepResult => ({
  ...result,
  effects: [...effects, ...result.effects],
});

export const guideFor = (ctx: StepContext): Guide => ({
  owner: ctx.isOwner,
  fromText: ctx.llm.enabled,
});

export function home(
  state: Session,
  zone: TimeZone,
  ctx: StepContext,
  withGuide = false,
): StepResult {
  return moveTo(state, SessionStepSchema.enum.idle, {
    type: 'home',
    zone: zoneLabel(zone, ctx.now),
    programName: ctx.activeProgram?.name ?? null,
    guide: withGuide ? guideFor(ctx) : null,
  });
}

export const help = (state: Session, ctx: StepContext): StepResult => ({
  state,
  effects: [{ type: 'render', view: { type: 'help', guide: guideFor(ctx) } }],
});
