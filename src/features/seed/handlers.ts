import type { BotEvent } from '../../core/session/types.ts';
import type { Incoming } from '../../ports/ui.ts';

/** Апдейт → событие /seed; текст результата — общий text_entered, его разбирает автомат. */
export function toEvent(input: Incoming): BotEvent | null {
  switch (input.kind) {
    case 'command':
      return input.name === 'seed' ? { type: 'seed_requested' } : null;
    case 'callback':
      if (input.action.type === 'seed_next') return { type: 'seed_next' };
      if (input.action.type === 'seed_stop') return { type: 'seed_stopped' };
      return null;
    default:
      return null;
  }
}
