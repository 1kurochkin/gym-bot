import type { View } from '../../core/session/types.ts';
import type { Rendered } from '../../ports/ui.ts';
import { COMMANDS } from './commands.ts';

export type HelpView = Extract<View, { type: 'unknown_command' }>;

export function renderHelpView(view: HelpView): Rendered {
  const list = COMMANDS.map((c) => `/${c.command} — ${c.description}`).join('\n');
  return {
    text: `Не знаю команду /${view.name}. Доступно:\n${list}`,
    keyboard: [],
    replyKeyboard: null,
  };
}
