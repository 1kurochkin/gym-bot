import type { BotEvent } from '../../core/session/types.ts';
import type { Incoming } from '../../ports/ui.ts';

/**
 * Апдейт → событие автомата. null — апдейт не относится к этой фиче.
 * Геопозицию переводит в зону оболочка (app/), здесь она не обрабатывается.
 */
export function toEvent(input: Incoming): BotEvent | null {
  switch (input.kind) {
    case 'command':
      return input.name === 'start' ? { type: 'start' } : null;
    case 'text':
      return { type: 'text_entered', text: input.text };
    case 'callback':
      // Зона уже проверена ActionSchema при декодировании callback_data.
      return input.action.type === 'tz' ? { type: 'tz_chosen', zone: input.action.zone } : null;
    case 'location':
    case 'document':
      return null;
  }
}
