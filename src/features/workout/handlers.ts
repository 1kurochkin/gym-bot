import type { BotEvent } from '../../core/session/types.ts';
import type { Incoming } from '../../ports/ui.ts';

/** Апдейт → событие тренировки; текст (вес, подход, комментарий) — общий text_entered. */
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
    case 'resume':
      return { type: 'resume_chosen', choice: a.choice };
    case 'intensity_set':
      return { type: 'intensity_chosen', intensity: a.intensity };
    case 'weight_set':
      return { type: 'weight_chosen', lb: a.lb };
    case 'warmup':
      return { type: 'warmup_done', variant: a.variant };
    case 'reps_set':
      return { type: 'reps_chosen', reps: a.reps };
    case 'set_more':
      return { type: 'set_more' };
    case 'exercise_next':
      return { type: 'exercise_next' };
    case 'exercise_skip':
      return { type: 'exercise_skip' };
    case 'comment':
      return { type: 'comment_requested' };
    case 'workout_done':
      return { type: 'workout_done' };
    case 'cancel_answer':
      return { type: 'cancel_answered', confirm: a.confirm };
    case 'warmup_diff':
      return { type: 'warmup_diff_started' };
    case 'warmup_mark':
      return { type: 'warmup_marked', mark: a.mark };
    case 'warmup_comment':
      return { type: 'warmup_comment_requested' };
    case 'back':
      return { type: 'back_pressed' };
    case 'replace':
      return { type: 'replace_requested' };
    case 'replace_pick':
      return { type: 'replace_chosen', exerciseId: a.exerciseId };
    case 'reorder':
      return { type: 'reorder_requested' };
    case 'reorder_pick':
      return { type: 'reorder_chosen', index: a.index };
    case 'undo':
      return { type: 'undo_requested' };
    default:
      return null;
  }
}
