import type { Api } from 'grammy';
import { LanguageSchema } from '../core/settings/settings.ts';
import { commandsFor, KNOWN_COMMANDS } from '../features/help/commands.ts';

const { ru, en } = LanguageSchema.enum;

/**
 * Меню команд Telegram на двух языках: русское — для интерфейса Telegram на русском,
 * английское — для всех остальных (.specs/product.md → «Команды, которых нет»).
 */
export async function setCommandMenus(api: Api): Promise<string> {
  await api.setMyCommands(commandsFor(en));
  await api.setMyCommands(commandsFor(ru), { language_code: ru });
  return [...KNOWN_COMMANDS].map((c) => `/${c}`).join(' ');
}
