import { assertNever } from '../../shared/result.ts';
import {
  candidateZones,
  formatOffset,
  formatZoneLabel,
  offsetFromLocalTime,
  parseClockTime,
  parseTimeZone,
  type TimeZone,
} from '../schedule/timezone.ts';
import {
  type AskTimeError,
  AskTimeErrorSchema,
  type BotEvent,
  type Effect,
  type Session,
  type SessionStep,
  SessionStepSchema,
  type StepContext,
  type StepResult,
  type View,
} from './types.ts';

const { idle, onboarding_tz, onboarding_tz_pick } = SessionStepSchema.enum;
const { not_time, location_unknown } = AskTimeErrorSchema.enum;
const ONBOARDING: ReadonlySet<SessionStep> = new Set([onboarding_tz, onboarding_tz_pick]);

/**
 * Автомат диалога: step(state, event, ctx) → { state, effects }. Чистая функция:
 * ничего не читает и не пишет сама, всё нужное приходит в ctx (docs/architecture.md §13.2).
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
    default:
      return assertNever(event);
  }
}

function onText(state: Session, text: string, ctx: StepContext): StepResult {
  switch (state.step) {
    case onboarding_tz:
    case onboarding_tz_pick:
      return onTimeEntered(state, text, ctx);
    case idle:
      return ctx.settings.timezone === null
        ? askTime(state, null)
        : home(state, ctx.settings.timezone, ctx);
    default:
      return assertNever(state.step);
  }
}

/**
 * Пользователь написал, сколько у него сейчас времени: считаем смещение и предлагаем зоны
 * с таким смещением. Единственный город сохраняется сразу. IANA-имя тоже принимается.
 */
function onTimeEntered(state: Session, text: string, ctx: StepContext): StepResult {
  if (text.includes('/')) {
    const zone = parseTimeZone(text.trim());
    return zone.ok ? saveTimezone(state, zone.value, ctx) : askTime(state, not_time);
  }
  const time = parseClockTime(text);
  if (!time.ok) return askTime(state, not_time);

  const offset = offsetFromLocalTime(time.value, ctx.now);
  const { cities, fixed } = candidateZones(offset, ctx.now, ctx.languageCode);
  const [only] = cities;
  if (cities.length === 1 && only) return saveTimezone(state, only, ctx);

  const zones = fixed ? [...cities, fixed] : cities;
  if (zones.length === 0) return askTime(state, not_time);
  return moveTo(state, onboarding_tz_pick, {
    type: 'pick_zone',
    offsetLabel: formatOffset(offset),
    options: zones.map((zone) => ({ zone, label: formatZoneLabel(zone, ctx.now) })),
  });
}

const isOnboarding = (s: SessionStep): boolean => ONBOARDING.has(s);

const askTime = (state: Session, error: AskTimeError | null): StepResult =>
  moveTo(state, onboarding_tz, { type: 'ask_time', error });

function saveTimezone(state: Session, zone: TimeZone, ctx: StepContext): StepResult {
  const settings = { ...ctx.settings, timezone: zone };
  const result = home(state, zone, ctx);
  return { ...result, effects: [{ type: 'save_settings', settings }, ...result.effects] };
}

function home(state: Session, zone: TimeZone, ctx: StepContext): StepResult {
  return moveTo(state, idle, { type: 'home', timezoneLabel: formatZoneLabel(zone, ctx.now) });
}

function moveTo(state: Session, next: SessionStep, view: View): StepResult {
  const effects: Effect[] = [{ type: 'render', view }];
  return { state: { ...state, step: next }, effects };
}

const unchanged = (state: Session): StepResult => ({ state, effects: [] });
