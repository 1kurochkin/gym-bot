import { assertNever } from '../../shared/result.ts';
import { home, unchanged } from './flow.ts';
import { askTime, isOnboarding, onTimeEntered, saveTimezone } from './onboarding.ts';
import {
  cancelProgram,
  confirmProgram,
  receiveProgram,
  rejectProgramFile,
  requestProgram,
} from './program.ts';
import { requestSeed, seedText, skipSeed, stopSeed } from './seed.ts';
import {
  AskTimeErrorSchema,
  type BotEvent,
  type Session,
  SessionStepSchema,
  type StepContext,
  type StepResult,
} from './types.ts';

const { idle, onboarding_tz, onboarding_tz_pick, program_upload, program_confirm, seed } =
  SessionStepSchema.enum;
const { location_unknown } = AskTimeErrorSchema.enum;

/**
 * Автомат диалога: step(state, event, ctx) → { state, effects }. Чистая функция:
 * ничего не читает и не пишет сама, всё нужное приходит в ctx (docs/architecture.md §13.2).
 * Потоки диалога — в соседних модулях; здесь только диспетчер.
 */
export function step(state: Session, event: BotEvent, ctx: StepContext): StepResult {
  const result = transition(state, event, ctx);
  const renders = result.effects.some((e) => e.type === 'render');
  return renders ? { ...result, state: { ...result.state, stepNo: state.stepNo + 1 } } : result;
}

function transition(state: Session, event: BotEvent, ctx: StepContext): StepResult {
  switch (event.type) {
    case 'start':
      return ctx.settings.timezone === null
        ? askTime(state, null)
        : home(state, ctx.settings.timezone, ctx);
    case 'tz_chosen':
      return isOnboarding(state.step) ? saveTimezone(state, event.zone, ctx) : unchanged(state);
    case 'tz_located':
      if (!isOnboarding(state.step)) return unchanged(state);
      return event.zone ? saveTimezone(state, event.zone, ctx) : askTime(state, location_unknown);
    case 'text_entered':
      return onText(state, event.text, ctx);
    case 'program_requested':
      return requestProgram(state, ctx);
    case 'program_file':
      return receiveProgram(state, event.text, ctx);
    case 'program_file_rejected':
      return rejectProgramFile(state, event.reason);
    case 'program_confirmed':
      return confirmProgram(state);
    case 'program_cancelled':
      return state.step === program_confirm ? cancelProgram(state) : unchanged(state);
    case 'seed_requested':
      return requestSeed(state, ctx);
    case 'seed_next':
      return skipSeed(state, ctx);
    case 'seed_stopped':
      return stopSeed(state, ctx);
    case 'unknown_command':
      // Подсказка поверх текущего шага: шаг и его данные не теряются.
      return {
        state,
        effects: [{ type: 'render', view: { type: 'unknown_command', name: event.name } }],
      };
    default:
      return assertNever(event);
  }
}

function onText(state: Session, text: string, ctx: StepContext): StepResult {
  switch (state.step) {
    case onboarding_tz:
    case onboarding_tz_pick:
      return onTimeEntered(state, text, ctx);
    case program_upload:
    case program_confirm:
      return receiveProgram(state, text, ctx);
    case seed:
      return seedText(state, text, ctx);
    case idle:
      return ctx.settings.timezone === null
        ? askTime(state, null)
        : home(state, ctx.settings.timezone, ctx);
    default:
      return assertNever(state.step);
  }
}
