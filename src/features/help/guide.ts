import type { Language } from '../../core/settings/settings.ts';

const LANGUAGE_LINE = '🌐 Язык / Language: /settings → Язык / Language';

const ru = {
  title: 'Как пользоваться',
  program: (fromText: boolean) =>
    [
      '1️⃣ Программа — /program',
      '• 🆕 Составить программу — дни и упражнения кнопками',
      ...(fromText
        ? ['• 📝 Программа из текста — пришли программу, как она у тебя записана, я разберу']
        : []),
      '• или пришли файл .json',
      'Потом её можно править: /program → 📅 Дни и упражнения.',
      'Программ может быть несколько: новая добавляется к остальным, ' +
      'переключиться — /program → 🔄 Другая программа.',
    ].join('\n'),
  seed: '2️⃣ Стартовые веса — /seed (можно пропустить): последние рабочие веса, ' +
    'чтобы бот сразу их предлагал.',
  workout: '3️⃣ Тренировка — /workout\n' +
    'День → упражнение → рабочий вес → разминку бот посчитает сам → после каждого подхода ' +
    'нажми число повторений. «🏁 Завершить упражнение» — обратно в меню дня, ' +
    '«🏁 Завершить тренировку» — сводка.\n' +
    'Ошибся — «← Назад» или /undo. Прервать тренировку — /cancel.',
  history: '4️⃣ История — /history: посмотреть, исправить или удалить прошлые подходы.',
  settings: '5️⃣ Настройки — /settings: язык, часовой пояс, вес грифа, набор блинов, шаг веса.',
  owner: '👑 Для владельца: /invite — пригласить пользователя, /users — кто пользуется ботом.',
  footer: 'Веса — в фунтах (lb). Все команды — в меню рядом с полем ввода. Эта подсказка — /help.',
  hint: 'Как пользоваться — /help',
};

const en: typeof ru = {
  title: 'How to use',
  program: (fromText: boolean) =>
    [
      '1️⃣ Program — /program',
      '• 🆕 Build a program — days and exercises with buttons',
      ...(fromText
        ? ['• 📝 Program from text — send the program the way you wrote it, I’ll parse it']
        : []),
      '• or send a .json file',
      'Edit it later: /program → 📅 Days and exercises.',
      'You can keep several programs: a new one is added to the others, ' +
      'switch — /program → 🔄 Another program.',
    ].join('\n'),
  seed: '2️⃣ Starting weights — /seed (optional): your latest working weights, ' +
    'so the bot suggests them right away.',
  workout: '3️⃣ Workout — /workout\n' +
    'Day → exercise → working weight → the bot calculates the warm-up → after each set ' +
    'tap the number of reps. “🏁 Finish exercise” — back to the day menu, ' +
    '“🏁 Finish workout” — summary.\n' +
    'Made a mistake — “← Back” or /undo. Stop the workout — /cancel.',
  history: '4️⃣ History — /history: view, fix or delete past sets.',
  settings: '5️⃣ Settings — /settings: language, time zone, bar weight, plates, weight step.',
  owner: '👑 For the owner: /invite — invite a user, /users — who uses the bot.',
  footer: 'Weights are in pounds (lb). All commands are in the menu next to the input field. ' +
    'This guide — /help.',
  hint: 'How to use — /help',
};

export const GUIDE: Record<Language, typeof ru> = { ru, en };

export function guideText(
  lang: Language,
  options: { readonly owner: boolean; readonly fromText: boolean },
): string {
  const t = GUIDE[lang];
  return [
    LANGUAGE_LINE,
    t.title,
    t.program(options.fromText),
    t.seed,
    t.workout,
    t.history,
    t.settings,
    ...(options.owner ? [t.owner] : []),
    t.footer,
  ].join('\n\n');
}
