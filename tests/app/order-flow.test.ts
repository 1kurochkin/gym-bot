import { assert, assertEquals } from '@std/assert';
import { workout, type World, world } from '../support/world.ts';

/** US-4 (.specs/product.md): замена упражнения и другой порядок. День — вторник «Жим на наклонной». */

async function tuesday(w: World): Promise<void> {
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'tue' });
}

/** Шея: вес, без разминки, два подхода — и дальше. */
async function neck(w: World): Promise<void> {
  await w.type('10');
  await w.type('15');
  await w.type('15');
  await w.press({ type: 'exercise_next' });
}

Deno.test('замена: брусья вместо жима — своя карточка, запись с substitutedFor, в сводке «вместо»', async () => {
  const w = await world();
  await tuesday(w);
  assertEquals(w.buttons().slice(-2), ['🔄 Заменить', '🔀 Другое упражнение']);
  await w.press({ type: 'replace' });
  assertEquals(w.last(), 'Чем заменить «Жим на наклонной»?');
  assertEquals(w.buttons().includes('Жим на наклонной'), false, 'текущего в списке нет');
  await w.press({ type: 'replace_pick', exerciseId: 'dips' });
  assert(
    w.last().startsWith('🏋️ Брусья узким хватом (1/4) — вместо «Жим на наклонной»'),
    w.last(),
  );
  assert(w.last().includes('Допвес сегодня?'), 'карточка замены — своя (допвес)');

  await w.type('25');
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('8');
  const log = w.store.logs.find((l) => l.exerciseId === 'dips');
  assertEquals([log?.substitutedFor, log?.order], ['incline_press', 1]);

  await w.press({ type: 'exercise_next' });
  assert(w.last().includes('Подход 1 — 80% от отказа'), 'дальше — следующее место дня');
  for (const reps of ['20', '18', '15']) await w.type(reps);
  await w.press({ type: 'exercise_next' });
  await neck(w);
  await neck(w);
  assertEquals(w.last().split('\n').slice(0, 2), [
    'Тренировка завершена: Жим на наклонной, 30.09, 0 мин',
    'Брусья узким хватом (вместо «Жим на наклонной»): +25 × 8',
  ]);

  w.setNow('2026-10-06T22:40:00Z');
  await tuesday(w);
  assert(w.last().includes('Прошлого раза нет.'), 'история жима не испорчена заменой');
});

Deno.test('замена обратно на упражнение программы и [← Назад] из списка', async () => {
  const w = await world();
  await tuesday(w);
  await w.press({ type: 'replace' });
  await w.press({ type: 'back' });
  assert(w.last().startsWith('🏋️ Жим на наклонной (1/4)\n'), w.last());
  await w.press({ type: 'replace' });
  await w.press({ type: 'replace_pick', exerciseId: 'dips' });
  await w.press({ type: 'replace' });
  assert(w.buttons().includes('Жим на наклонной'), 'исходное можно вернуть');
  await w.press({ type: 'replace_pick', exerciseId: 'incline_press' });
  assert(w.last().startsWith('🏋️ Жим на наклонной (1/4)\n'), 'без «вместо»');
  await w.type('195');
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('7');
  assertEquals(w.store.logs.find((l) => l.exerciseId === 'incline_press')?.substitutedFor, null);
});

Deno.test('другой порядок: шея первой, потом бот возвращается к пропущенному месту', async () => {
  const w = await world();
  await tuesday(w);
  await w.press({ type: 'reorder' });
  assertEquals(w.last(), 'Какое упражнение сейчас?');
  assertEquals(w.buttons(), ['Пресс', 'Шея: сгибания', 'Шея: разгибания', '← Назад']);
  await w.press({ type: 'reorder_pick', index: 2 });
  assert(w.last().startsWith('🏋️ Шея: сгибания (3/4)'), w.last());
  await neck(w);
  assert(w.last().startsWith('🏋️ Жим на наклонной (1/4)'), 'первое невыполненное — жим');
  await w.type('195');
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('7');
  await w.press({ type: 'exercise_next' });
  assert(w.last().includes('Подход 1 — 80% от отказа'), 'дальше пресс');

  // У пресса нет карточки: замена и порядок — на первом подходе; его пустая запись убирается.
  assertEquals(w.buttons().slice(-2), ['🔄 Заменить', '🔀 Другое упражнение']);
  await w.press({ type: 'reorder' });
  assertEquals(w.buttons(), ['Шея: разгибания', '← Назад']);
  assertEquals(w.store.logs.some((l) => l.exerciseId === 'abs'), false);
  await w.press({ type: 'reorder_pick', index: 3 });
  await w.type('10');
  await w.type('15');
  await w.type('15');
  assert(w.buttons().includes('➡️ Следующее упражнение'), 'пресс ещё не сделан');
  await w.press({ type: 'exercise_next' });
  for (const reps of ['20', '18', '15']) await w.type(reps);
  assert(w.buttons().includes('🏁 Завершить тренировку'), w.buttons().join(' | '));
  await w.press({ type: 'exercise_next' });
  assertEquals(
    w.last().split('\n').slice(1, 5).map((l) => l.split(':')[0]),
    ['Жим на наклонной', 'Пресс', 'Шея', 'Шея'],
    'сводка — в порядке дня',
  );
});

Deno.test('продолжение после другого порядка — с последнего начатого упражнения', async () => {
  const w = await world();
  await tuesday(w);
  await w.press({ type: 'reorder' });
  await w.press({ type: 'reorder_pick', index: 2 });
  await w.type('10');
  await w.type('15');
  await w.send(workout);
  assert(w.last().startsWith('Продолжить тренировку'), w.last());
  await w.press({ type: 'resume', choice: 'continue' });
  assert(w.last().includes('Рабочий подход 2: 10 × ?'), w.last());
});
