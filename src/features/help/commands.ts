import type { Language } from '../../core/settings/settings.ts';

const COMMANDS: readonly {
  readonly command: string;
  readonly description: Readonly<Record<Language, string>>;
  readonly ownerOnly?: true;
}[] = [
  {
    command: 'workout',
    description: { ru: 'Начать или продолжить тренировку', en: 'Start or resume a workout' },
  },
  { command: 'cancel', description: { ru: 'Прервать тренировку', en: 'Stop the workout' } },
  {
    command: 'undo',
    description: { ru: 'Отменить последний подход', en: 'Undo the last set' },
  },
  {
    command: 'history',
    description: { ru: 'Прошлые тренировки: исправить, удалить', en: 'Past workouts: fix, delete' },
  },
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
  {
    command: 'clear',
    description: { ru: 'Очистить переписку', en: 'Clear the chat' },
  },
  {
    command: 'invite',
    description: { ru: 'Пригласить нового пользователя', en: 'Invite a new user' },
    ownerOnly: true,
  },
  {
    command: 'users',
    description: { ru: 'Пользователи бота, отключить доступ', en: 'Bot users, revoke access' },
    ownerOnly: true,
  },
];

export const commandsFor = (
  lang: Language,
  owner: boolean,
): readonly { command: string; description: string }[] =>
  COMMANDS.filter((c) => owner || !c.ownerOnly).map((c) => ({
    command: c.command,
    description: c.description[lang],
  }));

export const KNOWN_COMMANDS: ReadonlySet<string> = new Set(COMMANDS.map((c) => c.command));
