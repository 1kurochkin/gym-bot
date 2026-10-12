import { assert, assertEquals } from '@std/assert';
import { exerciseIndex } from '../../src/core/program/program.ts';
import type { Incoming } from '../../src/ports/ui.ts';
import { workout, type World, world } from '../support/world.ts';

const program: Incoming = { kind: 'command', name: 'program', args: '' };
const lines = (w: World): string[] => w.last().split('\n');

const active = (w: World) => [...w.store.programs.values()].find((p) => p.active);

async function openDay(w: World, dayId: string): Promise<void> {
  await w.send(program);
  await w.press({ type: 'editor_open' });
  await w.press({ type: 'editor_day', dayId });
}

Deno.test('редактор: /program → дни → день → упражнение', async () => {
  const w = await world();
  await w.send(program);
  assertEquals(w.buttons(), ['📅 Дни и упражнения']);
  await w.press({ type: 'editor_open' });
  assertEquals(lines(w), ['6 базовых, 5 дней', 'Дни программы:']);
  assertEquals(w.ui.shown.at(-1)?.rendered.bold, ['6 базовых, 5 дней']);
  assertEquals(w.buttons(), [
    'Фронтальный присед',
    'Жим на наклонной',
    'Мёртвая тяга',
    'Брусья',
    'Подтягивания + тяга',
    '➕ Новый день',
    '✏️ Название программы',
    '← Назад',
  ]);
  await w.press({ type: 'editor_day', dayId: 'tue' });
  assertEquals(lines(w), [
    'Жим на наклонной',
    '',
    '1. Жим на наклонной — 1×6–8',
    '2. Пресс — 3 подхода',
    '3. Шея: сгибания — 2×12–20',
    '4. Шея: разгибания — 2×12–20',
  ]);
  assertEquals(w.ui.shown.at(-1)?.rendered.bold, ['Жим на наклонной']);
  assertEquals(w.buttons().slice(-7), [
    '➕ Новое упражнение',
    '➕ Из программы',
    '✏️ Название дня',
    '⬆️ Раньше',
    '⬇️ Позже',
    '🗑 Удалить день',
    '← Назад',
  ]);
  await w.press({ type: 'editor_exercise', exerciseId: 'abs' });
  assertEquals(lines(w), ['Пресс', 'Тип: Только повторения · Цель: 3 подхода']);
  assertEquals(w.buttons(), [
    '✏️ Переименовать',
    '🎯 Изменить цель',
    '⬆️ Выше',
    '⬇️ Ниже',
    '🗑 Убрать из дня',
    '← Назад',
  ]);
  await w.press({ type: 'back' });
  await w.press({ type: 'back' });
  assertEquals(lines(w).at(-1), 'Дни программы:');
  await w.press({ type: 'back' });
  assert(w.last().startsWith('Текущая программа:'), w.last());
});

Deno.test('редактор: переименование — новая версия, старые записи с прежним названием', async () => {
  const w = await world();
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'tue' });
  await w.press({ type: 'menu_pick', exerciseId: 'incline_press' });
  await w.type('195');
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('7');
  const before = w.store.programs.size;
  await openDay(w, 'tue');
  await w.press({ type: 'editor_exercise', exerciseId: 'incline_press' });
  await w.press({ type: 'editor_rename' });
  assertEquals(w.last(), 'Новое название для «Жим на наклонной» (до 60 символов):');
  await w.type('x'.repeat(61));
  assertEquals(lines(w)[0], 'Название — от 1 до 60 символов.');
  await w.type('  Жим на наклонной 30°  ');
  assertEquals(lines(w).slice(0, 2), ['✅ Сохранено', 'Жим на наклонной 30°']);
  assertEquals(w.store.programs.size, before + 1, 'новая версия');
  assertEquals(active(w)?.version, 2);
  const p = active(w)?.program;
  assert(p);
  assertEquals(exerciseIndex(p).get('incline_press')?.name, 'Жим на наклонной 30°');
  assertEquals(w.store.logs.map((l) => l.exerciseName), ['Жим на наклонной']);

  await w.press({ type: 'editor_rename' });
  await w.type('Жим на наклонной 30°');
  assertEquals(lines(w)[0], 'Жим на наклонной 30°', 'то же название — без сохранения');
  assertEquals(active(w)?.version, 2);
});

Deno.test('редактор: убрать из дня — с подтверждением; последнее не убирается', async () => {
  const w = await world();
  await openDay(w, 'mon');
  await w.press({ type: 'editor_exercise', exerciseId: 'calves' });
  await w.press({ type: 'editor_remove' });
  assertEquals(
    w.last(),
    'Убрать «Икры стоя» из дня «Фронтальный присед»? История упражнения сохранится.',
  );
  await w.press({ type: 'editor_remove_answer', confirm: false });
  assertEquals(lines(w)[0], 'Икры стоя');
  assertEquals(active(w)?.version, 1);
  await w.press({ type: 'editor_remove' });
  await w.press({ type: 'editor_remove_answer', confirm: true });
  assertEquals(lines(w), ['✅ Убрано', 'Фронтальный присед', '', '1. Фронтальный присед — 1×6–8']);
  await w.press({ type: 'editor_exercise', exerciseId: 'front_squat' });
  assertEquals(w.buttons(), ['✏️ Переименовать', '🎯 Изменить цель', '← Назад'], 'последнее в дне');
  const p = active(w)?.program;
  assert(p && exerciseIndex(p).has('calves'), 'икры остались в четверге');
});

Deno.test('редактор: новое упражнение — название, тип, цель; «Назад» по шагам', async () => {
  const w = await world();
  await openDay(w, 'wed');
  await w.press({ type: 'editor_new' });
  assertEquals(w.last(), 'Название нового упражнения (до 60 символов):');
  await w.type('Гиперэкстензия');
  assertEquals(w.last(), 'Какой тип у «Гиперэкстензия»?');
  assertEquals(w.buttons(), [
    'Штанга',
    'Тренажёр / гантели',
    'Свой вес + допвес',
    'Только повторения',
    'Лёгкий вес',
    '← Назад',
  ]);
  await w.press({ type: 'editor_type', loadType: 'weighted_bodyweight' });
  assertEquals(lines(w), ['Гиперэкстензия', 'Подходы × повторения, например 3×8–12 или 1×6']);
  await w.press({ type: 'back' });
  await w.press({ type: 'editor_type', loadType: 'reps_only' });
  assertEquals(lines(w)[1], 'Сколько подходов? Например 3 или 2–3');
  await w.type('3×15');
  assertEquals(lines(w)[1], 'Не понял. Сколько подходов? Например 3 или 2–3');
  await w.type('2–3');
  assertEquals(lines(w), [
    '✅ Добавлено',
    'Мёртвая тяга',
    '',
    '1. Мёртвая тяга — 1×6–8',
    '2. Гиперэкстензия — 2–3 подхода',
  ]);
  const p = active(w)?.program;
  assertEquals(p && exerciseIndex(p).get('ex_1')?.loadType, 'reps_only');

  await w.press({ type: 'editor_new' });
  await w.type('Жим гантелей');
  await w.press({ type: 'back' });
  assertEquals(w.last(), 'Название нового упражнения (до 60 символов):');
  await w.press({ type: 'back' });
  assertEquals(lines(w)[0], 'Мёртвая тяга');
});

Deno.test('редактор: из программы — ссылкой в день; нечего добавить', async () => {
  const w = await world();
  await openDay(w, 'wed');
  await w.press({ type: 'editor_from' });
  assertEquals(w.last(), 'Какое упражнение добавить в этот день?');
  assertEquals(w.buttons()[0], 'Фронтальный присед');
  assert(!w.buttons().includes('Мёртвая тяга'));
  await w.press({ type: 'editor_from_pick', exerciseId: 'bb_row' });
  assertEquals(lines(w).at(-1), '2. Тяга штанги в наклоне — 1×6–8');
  assertEquals(lines(w)[0], '✅ Добавлено');
});

Deno.test('редактор: текст на экранах со списками игнорируется; старые кнопки — мимо', async () => {
  const w = await world();
  await openDay(w, 'tue');
  const shown = w.ui.shown.length;
  await w.type('привет');
  assertEquals(w.ui.shown.length, shown);
  await w.press({ type: 'editor_rename' });
  assertEquals(w.ui.shown.length, shown, 'переименование — только с экрана упражнения');
});

const dayNames = (w: World): string[] => {
  const p = active(w)?.program;
  return p ? p.rotation.map((id) => p.days.find((d) => d.id === id)?.name ?? id) : [];
};

Deno.test('редактор: название дня и программы; старая тренировка — с прежним названием дня', async () => {
  const w = await world();
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'wed' });
  await openDay(w, 'wed');
  await w.press({ type: 'editor_day_rename' });
  assertEquals(w.last(), 'Новое название для дня «Мёртвая тяга» (до 60 символов):');
  await w.type('');
  assertEquals(lines(w)[0], 'Название — от 1 до 60 символов.');
  await w.type('Тяга');
  assertEquals(lines(w).slice(0, 2), ['✅ Сохранено', 'Тяга']);
  assertEquals(dayNames(w)[2], 'Тяга');
  assertEquals([...w.store.workouts.values()].map((x) => x.dayName), ['Мёртвая тяга']);
  await w.press({ type: 'back' });
  await w.press({ type: 'editor_program_rename' });
  assertEquals(w.last(), 'Новое название программы «6 базовых, 5 дней» (до 60 символов):');
  await w.press({ type: 'back' });
  assertEquals(lines(w).at(-1), 'Дни программы:');
  await w.press({ type: 'editor_program_rename' });
  await w.type('Моя программа');
  assertEquals(lines(w), ['✅ Сохранено', 'Моя программа', 'Дни программы:']);
  assertEquals(active(w)?.program.name, 'Моя программа');
});

Deno.test('редактор: изменить цель — общая для всех дней; та же — без сохранения', async () => {
  const w = await world();
  await openDay(w, 'mon');
  await w.press({ type: 'editor_exercise', exerciseId: 'calves' });
  await w.press({ type: 'editor_goal' });
  assertEquals(lines(w), [
    'Новая цель для «Икры стоя» (сейчас 2–3×10–12):',
    'Подходы × повторения, например 3×8–12 или 1×6',
  ]);
  await w.type('много');
  assertEquals(lines(w)[1], 'Не понял. Подходы × повторения, например 3×8–12 или 1×6');
  await w.type('2–3×10–12');
  assertEquals(lines(w)[0], 'Икры стоя', 'та же цель');
  assertEquals(active(w)?.version, 1);
  await w.press({ type: 'editor_goal' });
  await w.type('3×15');
  assertEquals(lines(w), ['✅ Сохранено', 'Икры стоя', 'Тип: Тренажёр / гантели · Цель: 3×15']);
  await w.press({ type: 'back' });
  await w.press({ type: 'back' });
  await w.press({ type: 'editor_day', dayId: 'thu' });
  assert(w.last().includes('2. Икры стоя — 3×15'), 'ссылка в четверге видит новую цель');
});

Deno.test('редактор: порядок дней и упражнений', async () => {
  const w = await world();
  await openDay(w, 'mon');
  assert(!w.buttons().includes('⬆️ Раньше'), 'первый день');
  await w.press({ type: 'editor_move', move: 'down' });
  assertEquals(lines(w)[0], '✅ Сохранено');
  assertEquals(dayNames(w).slice(0, 2), ['Жим на наклонной', 'Фронтальный присед']);
  assert(w.buttons().includes('⬆️ Раньше'));
  await w.press({ type: 'back' });
  await w.press({ type: 'editor_day', dayId: 'tue' });
  await w.press({ type: 'editor_exercise', exerciseId: 'neck_ext' });
  assert(!w.buttons().includes('⬇️ Ниже'), 'последнее в дне');
  await w.press({ type: 'editor_move', move: 'up' });
  assertEquals(lines(w)[0], '✅ Сохранено');
  await w.press({ type: 'back' });
  assertEquals(lines(w).slice(2), [
    '1. Жим на наклонной — 1×6–8',
    '2. Пресс — 3 подхода',
    '3. Шея: разгибания — 2×12–20',
    '4. Шея: сгибания — 2×12–20',
  ]);
});

Deno.test('редактор: новый день — сохраняется с первым упражнением, в конце ротации', async () => {
  const w = await world();
  await w.send(program);
  await w.press({ type: 'editor_open' });
  await w.press({ type: 'editor_day_new' });
  assertEquals(w.last(), 'Название нового дня (до 60 символов):');
  await w.type('Спина');
  assertEquals(w.last(), 'День «Спина»: добавь первое упражнение.');
  assertEquals(w.buttons(), ['➕ Новое упражнение', '➕ Из программы', '← Назад']);
  await w.press({ type: 'editor_new' });
  await w.press({ type: 'back' });
  assertEquals(w.last(), 'День «Спина»: добавь первое упражнение.', '«Назад» с первого шага');
  await w.press({ type: 'back' });
  assertEquals(w.last(), 'Название нового дня (до 60 символов):');
  await w.type('Спина');
  assertEquals(active(w)?.version, 1, 'пустой день не сохраняется');
  await w.press({ type: 'editor_new' });
  await w.type('Тяга гантели');
  await w.press({ type: 'editor_type', loadType: 'light_load' });
  await w.type('3×10');
  assertEquals(lines(w), ['✅ Добавлено', 'Спина', '', '1. Тяга гантели — 3×10']);
  assertEquals(active(w)?.version, 2);
  assertEquals(active(w)?.program.rotation.at(-1), 'day_1');
  assertEquals(dayNames(w).at(-1), 'Спина');
  await w.press({ type: 'back' });
  await w.press({ type: 'editor_day_new' });
  await w.type('Пресс отдельно');
  await w.press({ type: 'editor_from' });
  await w.press({ type: 'editor_from_pick', exerciseId: 'abs' });
  assertEquals(lines(w), ['✅ Добавлено', 'Пресс отдельно', '', '1. Пресс — 3 подхода']);
  assertEquals(active(w)?.program.rotation.at(-1), 'day_2');
});

Deno.test('редактор: удалить день — с подтверждением; не единственный и не текущей тренировки', async () => {
  const w = await world();
  await openDay(w, 'mon');
  await w.press({ type: 'editor_day_delete' });
  assertEquals(
    w.last(),
    'Удалить день «Фронтальный присед»? Упражнения, которых нет в других днях, уйдут из программы. История сохранится.',
  );
  await w.press({ type: 'editor_remove_answer', confirm: false });
  assertEquals(lines(w)[0], 'Фронтальный присед');
  await w.press({ type: 'editor_day_delete' });
  await w.press({ type: 'editor_remove_answer', confirm: true });
  assertEquals(lines(w).slice(0, 2), ['✅ Удалено', '6 базовых, 5 дней']);
  const p = active(w)?.program;
  assert(p);
  assertEquals(p.rotation, ['tue', 'wed', 'thu', 'fri']);
  assert(!exerciseIndex(p).has('front_squat'));
  assert(exerciseIndex(p).has('calves'), 'икры остались в четверге');

  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'wed' });
  await openDay(w, 'wed');
  assert(!w.buttons().includes('🗑 Удалить день'), 'по дню идёт тренировка');
});

Deno.test('составить программу с нуля — без JSON', async () => {
  const w = await world({ program: false });
  await w.send(program);
  assertEquals(w.buttons(), ['🆕 Составить программу']);
  await w.press({ type: 'editor_create' });
  assertEquals(w.last(), 'Название программы (до 60 символов):');
  await w.press({ type: 'back' });
  assert(w.last().startsWith('Программы пока нет.'));
  await w.press({ type: 'editor_create' });
  await w.type('Фулбади');
  assertEquals(w.last(), 'Название первого дня (до 60 символов):');
  await w.press({ type: 'back' });
  assertEquals(w.last(), 'Название программы (до 60 символов):');
  await w.type('Фулбади');
  await w.type('День А');
  assertEquals(w.last(), 'День «День А»: добавь первое упражнение.');
  assertEquals(w.buttons(), ['➕ Новое упражнение', '← Назад']);
  await w.press({ type: 'editor_new' });
  await w.type('Присед');
  await w.press({ type: 'editor_type', loadType: 'barbell' });
  assertEquals(w.store.programs.size, 0, 'до первого упражнения ничего не сохранено');
  await w.type('3×5');
  assertEquals(lines(w), ['✅ Программа создана', 'День А', '', '1. Присед — 3×5']);
  const p = active(w)?.program;
  assertEquals(p?.id, 'custom');
  assertEquals(p?.name, 'Фулбади');
  assertEquals(p && exerciseIndex(p).get('ex_1')?.warmup, 'tiers');
  assert(!w.buttons().includes('🗑 Удалить день'), 'единственный день');
  await w.press({ type: 'back' });
  assertEquals(lines(w), ['Фулбади', 'Дни программы:']);
});
