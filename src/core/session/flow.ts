import { formatZoneLabel, type TimeZone } from '../schedule/timezone.ts';
import {
  type Effect,
  emptyContext,
  type Session,
  type SessionStep,
  SessionStepSchema,
  type StepContext,
  type StepResult,
  type View,
} from './types.ts';

/** Общие переходы автомата, которыми пользуются все потоки диалога. */

export const unchanged = (state: Session): StepResult => ({ state, effects: [] });

/** Перейти на шаг и показать экран; контекст шага по умолчанию сбрасывается. */
export function moveTo(
  state: Session,
  next: SessionStep,
  view: View,
  context: Session['context'] = emptyContext,
): StepResult {
  const effects: Effect[] = [{ type: 'render', view }];
  return { state: { ...state, step: next, context }, effects };
}

/** Добавить эффекты перед отрисовкой (запись раньше ответа пользователю). */
export const withEffects = (result: StepResult, effects: readonly Effect[]): StepResult => ({
  ...result,
  effects: [...effects, ...result.effects],
});

/** Главный экран: часовой пояс и активная программа. */
export function home(state: Session, zone: TimeZone, ctx: StepContext): StepResult {
  return moveTo(state, SessionStepSchema.enum.idle, {
    type: 'home',
    timezoneLabel: formatZoneLabel(zone, ctx.now),
    programName: ctx.activeProgram?.name ?? null,
  });
}
