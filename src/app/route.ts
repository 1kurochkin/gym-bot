import { parseTimeZone } from '../core/schedule/timezone.ts';
import type { BotEvent, View } from '../core/session/types.ts';
import type { Language } from '../core/settings/settings.ts';
import { toEvent as accessEvent } from '../features/access/handlers.ts';
import { toEvent as historyEvent } from '../features/history/handlers.ts';
import { renderHistoryView } from '../features/history/views.ts';
import { renderAccessView } from '../features/access/views.ts';
import { toEvent as onboardingEvent } from '../features/onboarding/handlers.ts';
import { renderView as renderOnboarding } from '../features/onboarding/views.ts';
import { KNOWN_COMMANDS } from '../features/help/commands.ts';
import { renderHelpView } from '../features/help/views.ts';
import { toEvent as programEvent } from '../features/program/handlers.ts';
import { renderProgramView } from '../features/program/views.ts';
import { toEvent as seedEvent } from '../features/seed/handlers.ts';
import { renderSeedView } from '../features/seed/views.ts';
import { toEvent as settingsEvent } from '../features/settings/handlers.ts';
import { renderSettingsView } from '../features/settings/views.ts';
import { toEvent as workoutEvent } from '../features/workout/handlers.ts';
import { renderWorkoutView } from '../features/workout/views.ts';
import { assertNever } from '../shared/result.ts';
import type { ZoneLocator } from '../ports/geo.ts';
import type { Incoming, Rendered, RenderEnv } from '../ports/ui.ts';

export async function routeEvent(input: Incoming, zoneAt: ZoneLocator): Promise<BotEvent | null> {
  if (input.kind === 'location') {
    const name = await zoneAt(input.latitude, input.longitude);
    const zone = name === null ? null : parseTimeZone(name);
    return { type: 'tz_located', zone: zone?.ok ? zone.value : null };
  }
  if (input.kind === 'command' && !KNOWN_COMMANDS.has(input.name)) {
    return { type: 'unknown_command', name: input.name };
  }
  return accessEvent(input) ?? historyEvent(input) ?? programEvent(input) ?? seedEvent(input) ??
    settingsEvent(input) ??
    workoutEvent(input) ??
    onboardingEvent(input);
}

export function render(view: View, lang: Language, env: RenderEnv): Rendered {
  switch (view.type) {
    case 'ask_time':
    case 'pick_zone':
    case 'home':
      return renderOnboarding(view, lang);
    case 'program_status':
    case 'program_invalid':
    case 'program_confirm':
    case 'program_saved':
    case 'program_unchanged':
    case 'program_cancelled':
    case 'program_file_rejected':
    case 'program_days':
    case 'program_day':
    case 'program_exercise':
    case 'program_rename':
    case 'program_remove_confirm':
    case 'program_new_name':
    case 'program_new_type':
    case 'program_new_goal':
    case 'program_pick':
      return renderProgramView(view, lang);
    case 'seed_prompt':
    case 'seed_done':
    case 'needs_program':
      return renderSeedView(view, lang);
    case 'unknown_command':
      return renderHelpView(view, lang);
    case 'settings_menu':
    case 'settings_bar':
    case 'settings_plates':
    case 'settings_steps':
    case 'settings_step_edit':
    case 'settings_language':
      return renderSettingsView(view, lang);
    case 'workout_days':
    case 'workout_menu':
    case 'workout_add':
    case 'workout_card':
    case 'workout_warmup':
    case 'workout_warmup_mark':
    case 'workout_warmup_comment_prompt':
    case 'workout_reps':
    case 'workout_set_view':
    case 'workout_comment_prompt':
    case 'workout_summary':
    case 'workout_cancel_confirm':
    case 'workout_commented':
    case 'workout_cancelled':
    case 'workout_none':
    case 'workout_undo_nothing':
    case 'workout_empty_deleted':
      return renderWorkoutView(view, lang);
    case 'history_list':
    case 'history_workout':
    case 'history_exercise':
    case 'history_set':
    case 'history_delete_set':
    case 'history_delete_workout':
      return renderHistoryView(view, lang);
    case 'invite_created':
    case 'users_list':
    case 'users_revoke_confirm':
    case 'member_joined':
    case 'invite_invalid':
      return renderAccessView(view, lang, env);
    default:
      return assertNever(view);
  }
}
