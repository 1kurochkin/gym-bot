import type { BotEvent } from '../../core/session/types.ts';
import type { Incoming } from '../../ports/ui.ts';

export const toEvent = (input: Incoming): BotEvent | null =>
  input.kind === 'command' && input.name === 'help' ? { type: 'help_requested' } : null;
