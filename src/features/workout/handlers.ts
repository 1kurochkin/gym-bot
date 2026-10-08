import type { BotEvent } from '../../core/session/types.ts';
import type { Incoming } from '../../ports/ui.ts';

export function toEvent(input: Incoming): BotEvent | null {
  if (input.kind === 'command') {
    if (input.name === 'workout') return { type: 'workout_requested' };
    if (input.name === 'cancel') return { type: 'cancel_requested' };
    if (input.name === 'undo') return { type: 'undo_requested' };
    return null;
  }
  if (input.kind !== 'callback') return null;
  const a = input.action;
  switch (a.type) {
    case 'day_pick':
      return { type: 'day_chosen', dayId: a.dayId };
    case 'menu_pick':
      return { type: 'menu_exercise_picked', exerciseId: a.exerciseId };
    case 'menu_add':
      return { type: 'menu_add_requested' };
    case 'add_pick':
      return { type: 'add_exercise_chosen', exerciseId: a.exerciseId };
    case 'weight_set':
      return { type: 'weight_chosen', lb: a.lb };
    case 'warmup':
      return { type: 'warmup_done', variant: a.variant };
    case 'warmup_diff':
      return { type: 'warmup_diff_started' };
    case 'warmup_mark':
      return { type: 'warmup_marked', mark: a.mark };
    case 'warmup_comment':
      return { type: 'warmup_comment_requested' };
    case 'reps_set':
      return { type: 'reps_chosen', reps: a.reps };
    case 'exercise_finish':
      return { type: 'exercise_finished' };
    case 'set_edit':
      return { type: 'set_edit_requested' };
    case 'set_delete':
      return { type: 'set_delete_requested' };
    case 'set_forward':
      return { type: 'set_forward' };
    case 'back':
      return { type: 'back_pressed' };
    case 'comment':
      return { type: 'comment_requested' };
    case 'workout_finish':
      return { type: 'workout_finished' };
    case 'workout_done':
      return { type: 'workout_done' };
    case 'cancel_answer':
      return { type: 'cancel_answered', confirm: a.confirm };
    default:
      return null;
  }
}
