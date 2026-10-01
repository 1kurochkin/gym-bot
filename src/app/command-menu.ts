import type { Api } from 'grammy';
import { LanguageSchema } from '../core/settings/settings.ts';
import { commandsFor, KNOWN_COMMANDS } from '../features/help/commands.ts';

const { ru, en } = LanguageSchema.enum;

/**
 * Меню команд Telegram на двух языках: русское — для интерфейса Telegram на русском,
 * английское — для всех остальных (.specs/product.md → «Команды, которых нет»).
 * Владельцам — своё меню в их чате, с /invite и /users (US-9).
 */
export async function setCommandMenus(api: Api, owners: ReadonlySet<number>): Promise<string> {
  await api.setMyCommands(commandsFor(en, false));
  await api.setMyCommands(commandsFor(ru, false), { language_code: ru });
  for (const chat_id of owners) {
    const scope = { type: 'chat' as const, chat_id };
    await api.setMyCommands(commandsFor(en, true), { scope });
    await api.setMyCommands(commandsFor(ru, true), { scope, language_code: ru });
  }
  return [...KNOWN_COMMANDS].map((c) => `/${c}`).join(' ');
}
