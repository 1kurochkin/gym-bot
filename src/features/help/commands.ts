/**
 * Команды, которые бот уже понимает: одно место для ответа на неизвестную команду
 * и меню команд Telegram (setMyCommands). Новая команда — строка здесь.
 */
export const COMMANDS: readonly { readonly command: string; readonly description: string }[] = [
  { command: 'start', description: 'Главный экран' },
  { command: 'program', description: 'Загрузить или показать программу' },
  { command: 'seed', description: 'Ввести последние рабочие результаты' },
];

export const KNOWN_COMMANDS: ReadonlySet<string> = new Set(COMMANDS.map((c) => c.command));
