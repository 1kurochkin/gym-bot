import type { BotEvent } from '../../core/session/types.ts';
import type { Action, Incoming } from '../../ports/ui.ts';

export function toEvent(input: Incoming): BotEvent | null {
  switch (input.kind) {
    case 'command':
      return input.name === 'program' ? { type: 'program_requested' } : null;
    case 'document':
      if (input.problem !== null) return { type: 'program_file_rejected', reason: input.problem };
      return input.text === null ? null : { type: 'program_file', text: input.text };
    case 'callback':
      return callbackEvent(input.action);
    case 'text':
    case 'location':
      return null;
  }
}

function callbackEvent(action: Action): BotEvent | null {
  switch (action.type) {
    case 'program_confirm':
      return { type: 'program_confirmed' };
    case 'program_cancel':
      return { type: 'program_cancelled' };
    case 'editor_open':
      return { type: 'editor_opened' };
    case 'editor_day':
      return { type: 'editor_day_picked', dayId: action.dayId };
    case 'editor_exercise':
      return { type: 'editor_exercise_picked', exerciseId: action.exerciseId };
    case 'editor_rename':
      return { type: 'editor_rename_requested' };
    case 'editor_remove':
      return { type: 'editor_remove_requested' };
    case 'editor_remove_answer':
      return { type: 'editor_remove_answered', confirm: action.confirm };
    case 'editor_new':
      return { type: 'editor_new_requested' };
    case 'editor_type':
      return { type: 'editor_type_chosen', loadType: action.loadType };
    case 'editor_from':
      return { type: 'editor_from_requested' };
    case 'editor_from_pick':
      return { type: 'editor_from_picked', exerciseId: action.exerciseId };
    default:
      return null;
  }
}
