import type { BotEvent } from '../../core/session/types.ts';
import type { Incoming } from '../../ports/ui.ts';

export function toEvent(input: Incoming): BotEvent | null {
  switch (input.kind) {
    case 'command':
      return input.name === 'program' ? { type: 'program_requested' } : null;
    case 'document':
      if (input.problem !== null) return { type: 'program_file_rejected', reason: input.problem };
      return input.text === null ? null : { type: 'program_file', text: input.text };
    case 'callback':
      if (input.action.type === 'program_confirm') return { type: 'program_confirmed' };
      if (input.action.type === 'program_cancel') return { type: 'program_cancelled' };
      return null;
    case 'text':
    case 'location':
      return null;
  }
}
