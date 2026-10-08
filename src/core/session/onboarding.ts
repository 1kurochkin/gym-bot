import {
  candidateZones,
  formatOffset,
  offsetFromLocalTime,
  parseClockTime,
  parseTimeZone,
  type TimeZone,
  zoneLabel,
} from '../schedule/timezone.ts';
import { home, moveTo, withEffects } from './flow.ts';
import { settingsMenu } from './settings.ts';
import {
  type AskTimeError,
  AskTimeErrorSchema,
  type Session,
  type SessionStep,
  SessionStepSchema,
  type StepContext,
  type StepResult,
} from './types.ts';

const { onboarding_tz, onboarding_tz_pick } = SessionStepSchema.enum;
const { not_time } = AskTimeErrorSchema.enum;
const ONBOARDING: ReadonlySet<SessionStep> = new Set([onboarding_tz, onboarding_tz_pick]);

export const isOnboarding = (s: SessionStep): boolean => ONBOARDING.has(s);

const keepReturn = (state: Session): Session['context'] =>
  state.context.kind === 'settings_return' ? state.context : { kind: 'none' };

export const askTime = (state: Session, error: AskTimeError | null): StepResult =>
  moveTo(state, onboarding_tz, { type: 'ask_time', error }, keepReturn(state));

export function saveTimezone(state: Session, zone: TimeZone, ctx: StepContext): StepResult {
  const settings = { ...ctx.settings, timezone: zone };
  if (state.context.kind === 'settings_return') {
    return withEffects(settingsMenu(state, ctx, settings, true), [{
      type: 'save_settings',
      settings,
    }]);
  }
  return withEffects(home(state, zone, ctx), [{ type: 'save_settings', settings }]);
}

export function onTimeEntered(state: Session, text: string, ctx: StepContext): StepResult {
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
    options: zones.map((zone) => ({ zone, label: zoneLabel(zone, ctx.now) })),
  }, keepReturn(state));
}
