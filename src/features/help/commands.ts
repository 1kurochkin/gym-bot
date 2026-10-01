import type { Language } from '../../core/settings/settings.ts';

/**
 * Команды, которые бот уже понимает: одно место для ответа на неизвестную команду
 * и меню команд Telegram (setMyCommands). Новая команда — строка здесь, с описанием на всех языках.
 */
const COMMANDS: readonly {
  readonly command: string;
  readonly description: Readonly<Record<Language, string>>;
}[] = [
  {
    command: 'workout',
    description: { ru: 'Начать или продолжить тренировку', en: 'Start or resume a workout' },
  },
  { command: 'cancel', description: { ru: 'Прервать тренировку', en: 'Stop the workout' } },
  { command: 'start', description: { ru: 'Главный экран', en: 'Home screen' } },
  {
    command: 'program',
    description: { ru: 'Загрузить или показать программу', en: 'Upload or show the program' },
  },
  {
    command: 'seed',
    description: {
      ru: 'Ввести последние рабочие результаты',
      en: 'Enter your latest working sets',
    },
  },
  {
    command: 'settings',
    description: {
      ru: 'Часовой пояс, гриф, блины, шаг веса, язык',
      en: 'Time zone, bar, plates, weight step, language',
    },
  },
];

/** Меню команд на языке: для setMyCommands и ответа на неизвестную команду. */
export const commandsFor = (lang: Language): readonly { command: string; description: string }[] =>
  COMMANDS.map((c) => ({ command: c.command, description: c.description[lang] }));

export const KNOWN_COMMANDS: ReadonlySet<string> = new Set(COMMANDS.map((c) => c.command));
