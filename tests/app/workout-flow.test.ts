import { assert, assertEquals } from '@std/assert';
import { lb } from '../../src/core/units/lb.ts';
import type { Incoming } from '../../src/ports/ui.ts';
import { workout, world } from '../support/world.ts';

/** US-2…US-5 (.specs/product.md): тренировка через весь цикл апдейта, программа владельца из спеки. */

Deno.test('полный день: жим с разминкой и комментарием, пресс, шея, пропуск, сводка', async () => {
  const w = await world();
  await w.send(workout);
  assertEquals(w.last(), 'Выбери день:');
  assertEquals(w.buttons()[0], '▶ Фронтальный присед', 'истории нет — первый день');
  await w.press({ type: 'day_pick', dayId: 'tue' });

  assert(w.last().startsWith('🏋️ Жим на наклонной (1/4)\nЦель: 1 рабочий × 6–8'), w.last());
  assert(w.last().includes('Прошлого раза нет.'));
  await w.type('195');
  assertEquals(
    w.last().split('\n').slice(0, 5),
    [
      'Разминка под 195 × 6–8:',
      '1. 85 × 8 (по 20)',
      '2. 135 × 5 (по 45)',
      '3. 165 × 3 (по 60)',
      '4. 205 × 1 (по 80) перегруз',
    ],
    'ровно разминка из таблицы 6.2',
  );
  await w.press({ type: 'warmup', variant: 'full' });
  assert(w.last().includes('Рабочий подход 1: 195 × ?'));
  assertEquals(w.buttons().slice(0, 6), ['5', '6', '7', '8', '9', '10']);
  await w.press({ type: 'reps_set', reps: 7 });
  assert(w.last().startsWith('Записал 195 × 7.'));
  await w.press({ type: 'comment' });
  await w.type('плечо ок');
  assert(w.last().includes('💬 Комментарий сохранён.'));

  await w.press({ type: 'exercise_next' });
  assert(w.last().includes('Подход 1 — 80% от отказа'), 'пресс — сразу к подходам с целью');
  await w.type('20');
  assert(w.last().startsWith('Записал × 20.\nПодход 2 — 90% от отказа'), w.last());
  await w.type('18');
  await w.press({ type: 'reps_set', reps: 15 });
  await w.press({ type: 'exercise_next' });

  assert(w.last().startsWith('🏋️ Шея: сгибания (3/4)'));
  await w.type('10');
  assert(w.last().includes('Рабочий подход 1: 10 × ?'), 'шея без разминки');
  await w.type('15');
  await w.type('15');
  await w.press({ type: 'exercise_next' });
  assert(w.last().startsWith('🏋️ Шея: разгибания (4/4)'));
  await w.press({ type: 'exercise_skip' });

  assertEquals(w.last().split('\n'), [
    'Тренировка завершена: Жим на наклонной, 30.09, 0 мин',
    'Жим на наклонной: 195 × 7',
    'Пресс: 20 / 18 / 15',
    'Шея: сгибания: 10 × 15, 10 × 15',
    'Шея: разгибания: пропущено',
  ]);
  const [wo] = [...w.store.workouts.values()];
  assertEquals(wo?.status, 'completed');
  assertEquals(w.store.sets.length, 4 + 1 + 3 + 2, 'разминка 4 + жим 1 + пресс 3 + шея 2');
  const press = w.store.logs.find((l) => l.exerciseId === 'incline_press');
  assertEquals([press?.warmupVariant, press?.comment, press?.warmupTier], ['full', 'плечо ок', 2]);
  assertEquals(w.store.logs.find((l) => l.exerciseId === 'neck_ext')?.status, 'skipped');

  await w.press({ type: 'comment' });
  await w.type('хорошо выспался');
  assertEquals(wo?.comment, 'хорошо выспался');
  assertEquals(w.last(), '💬 Комментарий к тренировке сохранён.');
  await w.press({ type: 'workout_done' });
  assert(w.last().startsWith('Часовой пояс:'));
});

Deno.test('следующая тренировка: прошлая тренировка, следующий день, «прошлый раз» и кнопки веса', async () => {
  const w = await world();
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'tue' });
  await w.type('195');
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('9 последний тяжело');
  for (let i = 0; i < 3; i++) {
    await w.press({ type: 'exercise_next' });
    await w.press({ type: 'exercise_skip' });
  }
  await w.press({ type: 'workout_done' });

  w.setNow('2026-10-06T22:40:00Z');
  await w.send(workout);
  assertEquals(w.last(), 'Прошлая тренировка: Ср, 30.09 — Жим на наклонной.\nВыбери день:');
  assertEquals(w.buttons()[0], '▶ Мёртвая тяга');
  await w.press({ type: 'day_pick', dayId: 'tue' });
  assert(w.last().includes('Прошлый раз (30.09): 195 × 9 — выше диапазона'), w.last());
  assert(w.last().includes('💬 «последний тяжело»'));
  assertEquals(w.buttons().slice(0, 3), ['195', '205 (+10)', '185 (−10)']);
});

Deno.test('100/70: вопрос без истории, правило недели, 70% от последнего 100%, заметка к тяге', async () => {
  const w = await world();
  w.setNow('2026-09-23T22:40:00Z'); // неделя 39
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'wed' });
  assert(
    w.last().includes('ещё не ясно, что из пары «Фронтальный присед / Мёртвая тяга» идёт на 100%'),
  );
  await w.press({ type: 'intensity_set', intensity: 'high' });
  assert(w.last().includes('На этой неделе: Фронтальный присед 70%, Мёртвая тяга 100%'), w.last());
  await w.type('225');
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('6');
  await w.press({ type: 'exercise_next' });
  await w.press({ type: 'workout_done' });

  w.setNow('2026-09-29T22:40:00Z'); // неделя 40: становая была на 100% → теперь 70%
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'wed' });
  assert(w.last().includes('На этой неделе: Фронтальный присед 100%, Мёртвая тяга 70%'), w.last());
  assertEquals(
    w.buttons().slice(0, 3),
    ['155', '165 (+10)', '145 (−10)'],
    '70% от 225 → 157,5 → 155',
  );
  await w.press({ type: 'intensity_set', intensity: 'high' });
  assertEquals(w.buttons().slice(0, 4), ['225', '235 (+10)', '215 (−10)', 'Сделать 70%']);

  await w.type('225');
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('5');
  await w.press({ type: 'exercise_next' });
  await w.press({ type: 'workout_done' });
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'fri' });
  await w.type('0');
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('8');
  await w.press({ type: 'exercise_next' });
  await w.press({ type: 'exercise_skip' });
  assert(w.last().startsWith('🏋️ Тяга штанги в наклоне (3/3)'));
  assert(
    w.last().includes('📝 Становая на этой неделе шла на 100%'),
    'становая на этой неделе — 100%',
  );
});

Deno.test('продолжение: та же тренировка с того же места; старше 12 часов — закрывается', async () => {
  const w = await world();
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'tue' });
  await w.type('195');
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('7');

  await w.send(workout);
  assertEquals(w.last(), 'Продолжить тренировку от 18:40 (Жим на наклонной, 1 из 4 упражнений)?');
  await w.press({ type: 'resume', choice: 'continue' });
  assert(w.last().startsWith('Записал 195 × 7.'), 'вернулись к экрану после подхода');
  await w.press({ type: 'exercise_next' });
  assert(w.last().includes('Подход 1 — 80% от отказа'));

  w.setNow('2026-10-01T12:00:00Z');
  await w.send(workout);
  assertEquals(w.last(), 'Выбери день:', 'тренировка старше 12 часов закрыта');
  assertEquals([...w.store.workouts.values()][0]?.status, 'aborted');
});

Deno.test('двойное нажатие на кнопку повторений создаёт один подход', async () => {
  const w = await world();
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'tue' });
  await w.type('195');
  await w.press({ type: 'warmup', variant: 'none' });
  const stepNo = w.store.sessions.get(1)?.stepNo ?? -1;
  const tap: Incoming = { kind: 'callback', action: { type: 'reps_set', reps: 7 }, stepNo };
  await w.send(tap);
  await w.send(tap);
  assertEquals(w.store.sets.filter((s) => s.kind === 'work').length, 1);
});

Deno.test('/cancel: подтверждение, записанное сохраняется со статусом aborted', async () => {
  const w = await world();
  await w.send({ kind: 'command', name: 'cancel', args: '' });
  assertEquals(w.last(), 'Сейчас нет начатой тренировки. Начать — /workout');
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'tue' });
  await w.type('195x7');
  await w.send({ kind: 'command', name: 'cancel', args: '' });
  await w.press({ type: 'cancel_answer', confirm: false });
  assert(w.last().startsWith('Записал 195 × 7.'), '«Продолжить» — назад к тренировке');
  await w.send({ kind: 'command', name: 'cancel', args: '' });
  await w.press({ type: 'cancel_answer', confirm: true });
  assertEquals(w.last(), 'Тренировка прервана, записанное сохранено. Новая — /workout');
  assertEquals([...w.store.workouts.values()][0]?.status, 'aborted');
  assertEquals(w.store.sets.length, 1);
});

Deno.test('в карточке «185x7» — сразу рабочий подход без разминки; ≤ 3 действия на подход', async () => {
  const w = await world();
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'tue' });
  await w.type('185x7');
  assert(w.last().startsWith('Записал 185 × 7.'), w.last());
  const log = w.store.logs.find((l) => l.exerciseId === 'incline_press');
  assertEquals([log?.plannedWorkWeightLb, log?.warmupVariant], [lb(185), 'none']);
});

Deno.test('брусья: допвес, разминка от допвеса со своим весом и синглом', async () => {
  const w = await world();
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'thu' });
  assert(w.last().includes('Допвес сегодня?'));
  await w.type('+25');
  assertEquals(w.last().split('\n').slice(0, 5), [
    'Разминка под +25 × 6–8:',
    '1. свой вес × 10',
    '2. +10 × 5',
    '3. +20 × 3',
    '4. +30 × 1 перегруз',
  ]);
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('8');
  assert(w.last().startsWith('Записал +25 × 8.'));
});
