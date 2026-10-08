import { assert, assertEquals } from '@std/assert';
import { bold } from '../../src/adapters/telegram/bot.ts';
import { lb } from '../../src/core/units/lb.ts';
import type { Incoming } from '../../src/ports/ui.ts';
import { workout, type World, world } from '../support/world.ts';

const open = (w: World, exerciseId: string): Promise<void> =>
  w.press({ type: 'menu_pick', exerciseId });
const finishExercise = (w: World): Promise<void> => w.press({ type: 'exercise_finish' });
const lines = (w: World): string[] => w.last().split('\n');

async function tuesday(w: World): Promise<void> {
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'tue' });
}

Deno.test('день → меню; ▶ следующее; ✅ ◐ ▫️; сводка по меню', async () => {
  const w = await world();
  await w.send(workout);
  assertEquals(w.last(), 'Выбери день:');
  assertEquals(w.buttons()[0], '▶ Фронтальный присед', 'истории нет — первый день');
  await w.press({ type: 'day_pick', dayId: 'tue' });
  assertEquals(lines(w), [
    'Жим на наклонной · 30.09',
    '▫️ Жим на наклонной',
    '▫️ Пресс',
    '▫️ Шея: сгибания',
    '▫️ Шея: разгибания',
  ]);
  assertEquals(w.buttons(), [
    '▶ Жим на наклонной',
    '▫️ Пресс',
    '▫️ Шея: сгибания',
    '▫️ Шея: разгибания',
    '➕ Добавить упражнение',
    '💬 Комментарий',
    '🏁 Завершить тренировку',
    '← Назад',
  ]);

  await open(w, 'incline_press');
  assertEquals(lines(w).slice(0, 4), [
    '🏋️ Жим на наклонной 🏋️',
    '',
    'Цель: 1 рабочий × 6–8',
    'Прошлого раза нет.',
  ]);
  assertEquals(w.ui.shown.at(-1)?.rendered.bold, ['Жим на наклонной']);
  await w.type('195');
  assertEquals(lines(w).slice(2, 7), [
    'Разминка под 195 × 6–8:',
    '1. 85 × 8 (по 20)',
    '2. 135 × 5 (по 45)',
    '3. 165 × 3 (по 60)',
    '4. 205 × 1 (по 80) перегруз',
  ], 'ровно разминка из таблицы 6.2');
  assertEquals(w.buttons(), [
    '✅ Готово',
    '✏️ Изменить',
    '💬 Комментарий',
    '⏭ Пропустить',
    '← Назад',
  ]);
  await w.press({ type: 'warmup', variant: 'full' });
  assertEquals(lines(w).slice(2), [
    'Рабочий подход №1 — 195 × ? (по 75)',
    '✍️ Или напиши: 7 — повторения, 185/6 — другой вес и повторения.',
  ]);
  await w.press({ type: 'reps_set', reps: 7 });
  assertEquals(lines(w).slice(2, 4), [
    'Записал: 195 × 7',
    'Рабочий подход №2 — 195 × ? (по 75) (сверх программы)',
  ]);
  assertEquals(
    w.buttons().slice(0, 8),
    ['4', '5', '6', '7', '8', '9', '10', '11'],
    'подряд от 7−3',
  );
  await w.type('185/6');
  assert(w.last().includes('Записал: 195 × 7, 185 × 6'), w.last());
  await finishExercise(w);
  assert(w.last().includes('✅ Жим на наклонной — 195 × 7, 185 × 6'), w.last());
  assertEquals(w.buttons()[0], '▶ Пресс');

  await open(w, 'abs');
  assert(w.last().includes('Подход №1 — 80% от отказа'), 'пресс — сразу подходы с целью');
  await w.type('20');
  await w.type('18');
  await w.press({ type: 'back' });
  await w.press({ type: 'back' });
  await w.press({ type: 'back' });
  assert(w.last().includes('◐ Пресс — 20 / 18'), w.last());

  await w.press({ type: 'workout_finish' });
  assertEquals(lines(w), [
    'Тренировка завершена: Жим на наклонной, 30.09, 0 мин',
    'Жим на наклонной: 195 × 7, 185 × 6',
    'Пресс: 20 / 18',
    'Шея: сгибания: не делал',
    'Шея: разгибания: не делал',
  ]);
  assertEquals([...w.store.workouts.values()][0]?.status, 'completed');
  const press = w.store.logs.find((l) => l.exerciseId === 'incline_press');
  assertEquals([press?.warmupVariant, press?.warmupTier, Boolean(press?.finishedAt)], [
    'full',
    2,
    true,
  ]);
  assertEquals(w.store.logs.find((l) => l.exerciseId === 'abs')?.finishedAt, undefined);

  await w.press({ type: 'comment' });
  await w.type('хорошо выспался');
  assertEquals([...w.store.workouts.values()][0]?.comment, 'хорошо выспался');
  await w.press({ type: 'workout_done' });
  assert(w.last().startsWith('Часовой пояс:'));
});

Deno.test('название жирным — entities Telegram без разметки в тексте', () => {
  assertEquals(
    bold({ text: '🏋️ Пресс 🏋️\n', keyboard: [], replyKeyboard: null, bold: ['Пресс'] }),
    [{ type: 'bold', offset: 4, length: 5 }],
  );
});

Deno.test('следующая тренировка: прошлая, следующий день, «прошлый раз» и кнопки веса', async () => {
  const w = await world();
  await tuesday(w);
  await open(w, 'incline_press');
  await w.type('195');
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('9 последний тяжело');
  await finishExercise(w);
  await w.press({ type: 'workout_finish' });
  await w.press({ type: 'workout_done' });

  w.setNow('2026-10-06T22:40:00Z');
  await w.send(workout);
  assertEquals(w.last(), 'Прошлая тренировка: Ср, 30.09 — Жим на наклонной.\nВыбери день:');
  assertEquals(w.buttons()[0], '▶ Мёртвая тяга');
  await w.press({ type: 'day_pick', dayId: 'tue' });
  await open(w, 'incline_press');
  assert(w.last().includes('Прошлый раз (30.09): 195 × 9 — выше диапазона'), w.last());
  assert(w.last().includes('💬 «последний тяжело»'));
  assertEquals(w.buttons().slice(0, 3), ['195', '205 (+10)', '185 (−10)']);
  await w.type('195');
  await w.press({ type: 'warmup', variant: 'none' });
  assertEquals(
    w.buttons().slice(0, 8),
    ['6', '7', '8', '9', '10', '11', '12', '13'],
    'от прошлых 9',
  );
});

Deno.test('пара из intensityPairs: без вопроса 100/70, вес — прошлый раз, заметка всегда', async () => {
  const w = await world();
  w.setNow('2026-09-23T22:40:00Z');
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'wed' });
  await open(w, 'deadlift');
  assert(w.last().includes('Рабочий вес сегодня?'), w.last());
  assert(!w.last().includes('На этой неделе'), w.last());
  await w.type('225');
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('6');
  await finishExercise(w);
  await w.press({ type: 'workout_finish' });
  await w.press({ type: 'workout_done' });
  assert(w.store.logs.every((l) => l.intensity === null));

  w.setNow('2026-09-29T22:40:00Z');
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'wed' });
  await open(w, 'deadlift');
  assertEquals(w.buttons(), ['225', '235 (+10)', '215 (−10)', '← Назад']);
  await w.press({ type: 'back' });
  await w.press({ type: 'workout_finish' });

  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'fri' });
  await open(w, 'bb_row');
  assert(w.last().includes('📝 Становая на этой неделе шла на 100%'), w.last());
});

Deno.test('/workout при начатой тренировке — сразу её меню; старше 12 часов — закрывается', async () => {
  const w = await world();
  await tuesday(w);
  await open(w, 'incline_press');
  await w.type('195');
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('7');
  await w.send(workout);
  assert(w.last().includes('◐ Жим на наклонной — 195 × 7'), w.last());
  await open(w, 'incline_press');
  assert(w.last().includes('Рабочий подход №2'), 'продолжение со следующего подхода');

  w.setNow('2026-10-01T12:00:00Z');
  await w.send(workout);
  assertEquals(w.last(), 'Выбери день:', 'тренировка старше 12 часов закрыта');
  assertEquals([...w.store.workouts.values()][0]?.status, 'aborted');
});

Deno.test('двойное нажатие на кнопку повторений создаёт один подход', async () => {
  const w = await world();
  await tuesday(w);
  await open(w, 'incline_press');
  await w.type('195');
  await w.press({ type: 'warmup', variant: 'none' });
  const stepNo = w.store.sessions.get(1)?.stepNo ?? -1;
  const tap: Incoming = { kind: 'callback', action: { type: 'reps_set', reps: 7 }, stepNo };
  await w.send(tap);
  await w.send(tap);
  assertEquals(w.store.sets.filter((s) => s.kind === 'work').length, 1);
});

Deno.test('/cancel: подтверждение; «Продолжить» — в меню; записанное — aborted', async () => {
  const w = await world();
  await w.send({ kind: 'command', name: 'cancel', args: '' });
  assertEquals(w.last(), 'Сейчас нет начатой тренировки. Начать — /workout');
  await tuesday(w);
  await open(w, 'incline_press');
  await w.type('185x7');
  await w.send({ kind: 'command', name: 'cancel', args: '' });
  await w.press({ type: 'cancel_answer', confirm: false });
  assert(w.last().startsWith('Жим на наклонной · 30.09'), w.last());
  await w.send({ kind: 'command', name: 'cancel', args: '' });
  await w.press({ type: 'cancel_answer', confirm: true });
  assertEquals(w.last(), 'Тренировка прервана, записанное сохранено. Новая — /workout');
  assertEquals([...w.store.workouts.values()][0]?.status, 'aborted');
});

Deno.test('в карточке «185x7» — сразу подход без разминки; 1 нажатие на подход', async () => {
  const w = await world();
  await tuesday(w);
  await open(w, 'incline_press');
  await w.type('185x7');
  assert(w.last().includes('Записал: 185 × 7'), w.last());
  const log = w.store.logs.find((l) => l.exerciseId === 'incline_press');
  assertEquals([log?.plannedWorkWeightLb, log?.warmupVariant], [lb(185), 'none']);
  const before = w.ui.shown.length;
  await w.press({ type: 'reps_set', reps: 6 });
  assertEquals(w.ui.shown.length - before, 1, 'подход — одно нажатие, сразу следующий ввод');
});

Deno.test('брусья: допвес, разминка от допвеса со своим весом и синглом', async () => {
  const w = await world();
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'thu' });
  await open(w, 'dips');
  assert(w.last().includes('Допвес сегодня?'));
  await w.type('+25');
  assertEquals(lines(w).slice(2, 7), [
    'Разминка под +25 × 6–8:',
    '1. свой вес × 10',
    '2. +10 × 5',
    '3. +20 × 3',
    '4. +30 × 1 перегруз',
  ]);
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('8');
  assert(w.last().includes('Записал: +25 × 8'));
});

Deno.test('[➕ Добавить упражнение]: из программы, сразу открывается и встаёт в меню', async () => {
  const w = await world();
  await tuesday(w);
  await w.press({ type: 'menu_add' });
  assertEquals(w.last(), 'Какое упражнение добавить?');
  assertEquals(w.buttons().includes('Пресс'), false, 'уже в меню — не предлагается');
  await w.press({ type: 'add_pick', exerciseId: 'dips' });
  assert(w.last().startsWith('🏋️ Брусья узким хватом 🏋️'), w.last());
  await w.type('0');
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('10');
  await finishExercise(w);
  assertEquals(lines(w).at(-1), '✅ Брусья узким хватом — свой вес × 10');
});

Deno.test('завершить тренировку без подходов — она удаляется', async () => {
  const w = await world();
  await tuesday(w);
  await open(w, 'incline_press');
  await w.press({ type: 'back' });
  await w.press({ type: 'workout_finish' });
  assertEquals(w.last(), 'Подходов не было — тренировку не сохранял. Начать — /workout');
  assertEquals(w.store.workouts.size, 0);
});

Deno.test('штанга легче грифа (40 при грифе 45) — подход записывается, без «по …»', async () => {
  const w = await world();
  await tuesday(w);
  await open(w, 'incline_press');
  await w.type('40');
  await w.press({ type: 'warmup', variant: 'none' });
  assert(w.last().includes('Рабочий подход №1 — 40 × ?'), w.last());
  assertEquals(w.last().includes('(по'), false);
  await w.press({ type: 'reps_set', reps: 10 });
  assert(w.last().includes('Записал: 40 × 10'), w.last());
});
