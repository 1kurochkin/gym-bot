import type { BotEvent } from '../../core/session/types.ts';
import type { Incoming } from '../../ports/ui.ts';

export function toEvent(input: Incoming): BotEvent | null {
  if (input.kind === 'command') {
    return input.name === 'settings' ? { type: 'settings_requested' } : null;
  }
  if (input.kind !== 'callback') return null;
  const a = input.action;
  switch (a.type) {
    case 'settings_section':
      return { type: 'settings_section', section: a.section };
    case 'settings_back':
      return { type: 'settings_back' };
    case 'settings_close':
      return { type: 'settings_closed' };
    case 'bar_set':
      return { type: 'bar_chosen', lb: a.lb };
    case 'plate_toggle':
      return { type: 'plate_toggled', lb: a.lb };
    case 'plates_save':
      return { type: 'plates_saved' };
    case 'step_pick':
      return { type: 'step_exercise_picked', exerciseId: a.exerciseId };
    case 'step_set':
      return { type: 'step_chosen', lb: a.lb };
    case 'step_reset':
      return { type: 'step_reset' };
    case 'lang_set':
      return { type: 'language_chosen', language: a.language };
    default:
      return null;
  }
}
