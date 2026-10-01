import type { View } from '../../core/session/types.ts';
import type { Language } from '../../core/settings/settings.ts';
import type { Rendered } from '../../ports/ui.ts';
import { commandsFor } from './commands.ts';

export type HelpView = Extract<View, { type: 'unknown_command' }>;

const UNKNOWN: Record<Language, (name: string) => string> = {
  ru: (name) => `Не знаю команду /${name}. Доступно:`,
  en: (name) => `I don't know /${name}. Available:`,
};

export function renderHelpView(view: HelpView, lang: Language): Rendered {
  const list = commandsFor(lang).map((c) => `/${c.command} — ${c.description}`).join('\n');
  return { text: `${UNKNOWN[lang](view.name)}\n${list}`, keyboard: [], replyKeyboard: null };
}
