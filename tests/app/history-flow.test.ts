import { assert, assertEquals } from '@std/assert';
import { LocalDateSchema } from '../../src/core/schedule/calendar.ts';
import { workout, type World, world } from '../support/world.ts';

const history = { kind: 'command', name: 'history', args: '' } as const;

async function tuesday(w: World): Promise<void> {
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'tue' });
  await w.press({ type: 'menu_pick', exerciseId: 'incline_press' });
  await w.type('195');
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('7');
  await w.press({ type: 'exercise_finish' });
  await w.press({ type: 'menu_pick', exerciseId: 'abs' });
  for (const reps of ['20', '18', '15']) await w.type(reps);
  await w.press({ type: 'exercise_finish' });
  await w.press({ type: 'workout_finish' });
  await w.press({ type: 'workout_done' });
}

const workoutId = (w: World): string => [...w.store.workouts.keys()][0] ?? '';
const pressLogId = (w: World): string =>
  w.store.logs.find((l) => l.exerciseId === 'incline_press')?.id ?? '';
const pressSets = (w: World): string[] =>
  w.store.sets.filter((s) => s.exerciseLogId === pressLogId(w) && s.kind === 'work')
    .map((s) => `${s.index}:${s.weightLb}x${s.reps}`);

Deno.test('список → тренировка → упражнение: исправить, добавить и удалить подход', async () => {
  const w = await world();
  await tuesday(w);
  await w.send(history);
  assertEquals(w.last(), 'Тренировки:');
  assertEquals(w.buttons(), ['Ср 30.09 · Жим на наклонной']);

  await w.press({ type: 'history_workout', id: workoutId(w) });
  assertEquals(w.last().split('\n'), [
    'Ср 30.09 — Жим на наклонной',
    'Жим на наклонной: 195 × 7',
    'Пресс: 20 / 18 / 15',
  ]);
  assertEquals(w.buttons(), [
    '✏️ Жим на наклонной',
    '✏️ Пресс',
    '🗑 Удалить тренировку',
    '← К списку',
  ]);

  await w.press({ type: 'history_log', id: pressLogId(w) });
  assertEquals(w.last(), 'Жим на наклонной, 30.09');
  assertEquals(w.buttons(), ['1: 195 × 7', '➕ Подход', '← Назад']);

  const setId = w.store.sets.find((s) => s.exerciseLogId === pressLogId(w))?.id ?? '';
  await w.press({ type: 'history_set', id: setId });
  assertEquals(
    w.last(),
    'Подход 1: 195 × 7.\nНапиши, как было: 7 — повторения, 185/7 — вес и повторения.',
  );
  await w.type('6');
  assertEquals(w.last(), '✅ Исправлено.\nЖим на наклонной, 30.09');
  assertEquals(pressSets(w), ['1:195x6']);

  await w.press({ type: 'history_add' });
  assertEquals(w.last(), 'Подход 2. Напиши его: 185/7.');
  await w.type('185/5');
  assertEquals(w.buttons().slice(0, 2), ['1: 195 × 6', '2: 185 × 5']);
  assertEquals(pressSets(w), ['1:195x6', '2:185x5']);

  const second = w.store.sets.find((s) => s.exerciseLogId === pressLogId(w) && s.index === 2);
  await w.press({ type: 'history_set', id: second?.id ?? '' });
  await w.press({ type: 'history_delete' });
  assertEquals(w.last(), 'Удалить подход 2: 185 × 5?');
  await w.press({ type: 'history_confirm', confirm: false });
  assert(w.last().startsWith('Подход 2: 185 × 5.'), 'отмена — обратно к подходу');
  await w.press({ type: 'history_delete' });
  await w.press({ type: 'history_confirm', confirm: true });
  assertEquals(w.last(), '✅ Удалил.\nЖим на наклонной, 30.09');
  assertEquals(pressSets(w), ['1:195x6']);

  await w.press({ type: 'back' });
  assert(w.last().startsWith('Ср 30.09 — Жим на наклонной\nЖим на наклонной: 195 × 6'), w.last());
  await w.press({ type: 'back' });
  assertEquals(w.last(), 'Тренировки:');

  w.setNow('2026-10-06T22:40:00Z');
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'tue' });
  await w.press({ type: 'menu_pick', exerciseId: 'incline_press' });
  assert(w.last().includes('Прошлый раз (30.09): 195 × 6'), w.last());
});

Deno.test('ошибка ввода и упражнение только на повторения', async () => {
  const w = await world();
  await tuesday(w);
  await w.send(history);
  await w.press({ type: 'history_workout', id: workoutId(w) });
  const abs = w.store.logs.find((l) => l.exerciseId === 'abs')?.id ?? '';
  await w.press({ type: 'history_log', id: abs });
  assertEquals(w.buttons().slice(0, 3), ['1: × 20', '2: × 18', '3: × 15']);
  const first = w.store.sets.find((s) => s.exerciseLogId === abs && s.index === 1);
  await w.press({ type: 'history_set', id: first?.id ?? '' });
  assertEquals(w.last(), 'Подход 1: × 20.\nНапиши, сколько было повторений.');
  await w.type('абв');
  assert(w.last().startsWith('⚠️ Не понял.'), w.last());
  await w.type('22');
  assertEquals(w.buttons()[0], '1: × 22');
});

Deno.test('удаление тренировки с подтверждением: записи и подходы удаляются', async () => {
  const w = await world();
  await tuesday(w);
  await w.send(history);
  await w.press({ type: 'history_workout', id: workoutId(w) });
  await w.press({ type: 'history_delete' });
  assertEquals(
    w.last(),
    'Удалить тренировку 30.09 «Жим на наклонной»? Все её подходы удалятся.',
  );
  await w.press({ type: 'history_confirm', confirm: true });
  assertEquals(w.last(), '✅ Тренировка удалена.\nТренировок пока нет.');
  assertEquals([w.store.workouts.size, w.store.sets.length], [0, 0]);
  assertEquals(w.store.logs.filter((l) => l.workoutId !== null), []);
});

Deno.test('текущая тренировка в истории не видна; страницы по 8', async () => {
  const w = await world();
  await w.send(history);
  assertEquals(w.last(), 'Тренировок пока нет.');

  for (let i = 1; i <= 9; i++) {
    const day = String(i).padStart(2, '0');
    w.store.workouts.set(`00000000-0000-4000-8000-0000000009${day}`, {
      id: `00000000-0000-4000-8000-0000000009${day}`,
      dayId: 'tue',
      dayName: 'Жим на наклонной',
      startedAt: new Date(`2026-09-${day}T22:40:00Z`),
      localDate: LocalDateSchema.parse(`2026-09-${day}`),
      isoWeek: '2026-W36' as never,
      utcOffsetMin: -240,
      status: 'completed',
      comment: null,
      finishedAt: null,
    });
  }
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'tue' });

  await w.send(history);
  assertEquals(w.buttons().length, 8 + 1);
  assertEquals(w.buttons()[0], 'Ср 09.09 · Жим на наклонной');
  assertEquals(w.buttons().at(-1), '← Раньше');
  await w.press({ type: 'history_page', offset: 8 });
  assertEquals(w.buttons(), ['Вт 01.09 · Жим на наклонной', 'Позже →']);
});
