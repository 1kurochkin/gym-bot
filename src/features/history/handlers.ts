import type { BotEvent } from '../../core/session/types.ts';
import type { Incoming } from '../../ports/ui.ts';

/** Апдейт → событие /history; ввод подхода — общий text_entered, «Назад» — общий back. */
export function toEvent(input: Incoming): BotEvent | null {
  if (input.kind === 'command') {
    return input.name === 'history' ? { type: 'history_requested' } : null;
  }
  if (input.kind !== 'callback') return null;
  const a = input.action;
  switch (a.type) {
    case 'history_page':
      return { type: 'history_page', offset: a.offset };
    case 'history_workout':
      return { type: 'history_workout_picked', workoutId: a.id };
    case 'history_log':
      return { type: 'history_exercise_picked', logId: a.id };
    case 'history_set':
      return { type: 'history_set_picked', setId: a.id };
    case 'history_add':
      return { type: 'history_add_requested' };
    case 'history_delete':
      return { type: 'history_delete_requested' };
    case 'history_confirm':
      return { type: 'history_delete_answered', confirm: a.confirm };
    default:
      return null;
  }
}
