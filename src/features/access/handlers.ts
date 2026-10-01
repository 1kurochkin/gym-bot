import type { BotEvent } from '../../core/session/types.ts';
import type { Incoming } from '../../ports/ui.ts';

/** Апдейт → событие /invite и /users. Владелец ли это — решает автомат по контексту. */
export function toEvent(input: Incoming): BotEvent | null {
  if (input.kind === 'command') {
    if (input.name === 'invite') return { type: 'invite_requested' };
    if (input.name === 'users') return { type: 'users_requested' };
    return null;
  }
  if (input.kind !== 'callback') return null;
  const a = input.action;
  switch (a.type) {
    case 'member_pick':
      return { type: 'member_picked', userId: a.userId };
    case 'revoke_answer':
      return { type: 'revoke_answered', confirm: a.confirm };
    default:
      return null;
  }
}
