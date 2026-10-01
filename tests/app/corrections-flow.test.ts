import { assert, assertEquals } from '@std/assert';
import { workout, type World, world } from '../support/world.ts';

/** US-3 и US-4 (.specs/product.md): «Отметить отличия», [← Назад], /undo и [✏️ Исправить]. */

/** Вторник — «Жим на наклонной»: штанга с разминкой из 4 подходов при 195. */
async function pressAt195(w: World): Promise<void> {
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'tue' });
  await w.type('195');
}

const warmupSets = (w: World): { weight: number | null; reps: number; skipped: boolean }[] =>
  w.store.sets.filter((s) => s.kind === 'warmup').map((s) => ({
    weight: s.weightLb,
    reps: s.reps,
    skipped: s.skipped,
  }));
const workSets = (w: World): string[] =>
  w.store.sets.filter((s) => s.kind === 'work').map((s) => `${s.weightLb}x${s.reps}`);
const pressLog = (w: World): (typeof w.store.logs)[number] | undefined =>
  w.store.logs.find((l) => l.exerciseId === 'incline_press');

Deno.test('«Отметить отличия»: готово, изменить, пропустить — вариант custom, блины на подходе', async () => {
  const w = await world();
  await pressAt195(w);
  assert(w.buttons().includes('✏️ Отметить отличия'), w.buttons().join(' | '));
  await w.press({ type: 'warmup_diff' });
  assertEquals(w.last(), 'Разминка 1/4: 85 × 8 (по 20)');
  assertEquals(w.buttons(), ['✅ Готово', '✏️ Изменить', '⏭ Пропустить', '← Назад']);

  await w.press({ type: 'warmup_mark', mark: 'done' });
  await w.press({ type: 'warmup_mark', mark: 'edit' });
  assertEquals(
    w.last(),
    'Разминка 2/4: 135 × 5 (по 45)\nНапиши, что сделал: 4 — повторения, 135/4 — вес и повторения.',
  );
  await w.type('4');
  await w.press({ type: 'warmup_mark', mark: 'skip' });
  await w.type('215/1');

  assertEquals(warmupSets(w), [
    { weight: 85, reps: 8, skipped: false },
    { weight: 135, reps: 4, skipped: false },
    { weight: 165, reps: 3, skipped: true },
    { weight: 215, reps: 1, skipped: false },
  ]);
  assertEquals(pressLog(w)?.warmupVariant, 'custom');
  assert(w.last().includes('Рабочий подход 1: 195 × ? (по 75)'), w.last());
  assert(w.buttons().includes('💬 К разминке'));
});

Deno.test('без отличий — вариант full; комментарий к разминке виден в следующий раз', async () => {
  const w = await world();
  await pressAt195(w);
  await w.press({ type: 'warmup_diff' });
  for (let i = 0; i < 4; i++) await w.press({ type: 'warmup_mark', mark: 'done' });
  assertEquals(pressLog(w)?.warmupVariant, 'full');

  await w.press({ type: 'warmup_comment' });
  assert(w.last().startsWith('Комментарий к разминке «Жим на наклонной»'), w.last());
  await w.type('устал после разминки');
  assertEquals(pressLog(w)?.warmupComment, 'устал после разминки');
  assert(w.last().includes('Рабочий подход 1: 195 × ?'), 'обратно к рабочему подходу');
  await w.type('7');
  for (let i = 0; i < 3; i++) {
    await w.press({ type: 'exercise_next' });
    await w.press({ type: 'exercise_skip' });
  }
  await w.press({ type: 'workout_done' });

  w.setNow('2026-10-06T22:40:00Z');
  await pressAt195(w);
  assert(w.last().startsWith('💬 Прошлый раз: устал после разминки\nРазминка под 195'), w.last());
});

Deno.test('[← Назад]: отметка → предыдущая, разминка → выбор веса, первый подход → разминка', async () => {
  const w = await world();
  await pressAt195(w);
  await w.press({ type: 'warmup_diff' });
  await w.press({ type: 'warmup_mark', mark: 'done' });
  await w.press({ type: 'back' });
  assertEquals(w.last(), 'Разминка 1/4: 85 × 8 (по 20)');
  assertEquals(warmupSets(w), [], 'отметка первого подхода снята');
  await w.press({ type: 'back' });
  assert(w.last().startsWith('Разминка под 195'), 'с первой отметки — к разминке');

  await w.press({ type: 'warmup', variant: 'full' });
  assertEquals(warmupSets(w).length, 4);
  assert(w.buttons().includes('← Назад'));
  await w.press({ type: 'back' });
  assert(w.last().startsWith('Разминка под 195'), w.last());
  assertEquals(warmupSets(w), [], 'разминка снята');
  assertEquals(pressLog(w)?.warmupVariant, 'none');

  await w.press({ type: 'back' });
  assert(w.last().startsWith('🏋️ Жим на наклонной (1/4)'), 'к выбору веса');
  assertEquals(pressLog(w), undefined, 'запись упражнения удалена');
  await w.type('185');
  assert(w.last().startsWith('Разминка под 185'), 'вес выбирается заново');
});

Deno.test('[✏️ Исправить] и /undo: последний подход удаляется, бот ждёт его снова', async () => {
  const w = await world();
  await pressAt195(w);
  await w.press({ type: 'warmup', variant: 'none' });
  await w.press({ type: 'reps_set', reps: 7 });
  assert(w.buttons().includes('✏️ Исправить'));
  await w.press({ type: 'undo' });
  assertEquals(workSets(w), []);
  assertEquals(
    w.last().split('\n').slice(0, 2),
    ['↩️ Удалил 195 × 7.', 'Рабочий подход 1: 195 × ? (по 75)'],
  );
  await w.type('185/8');
  assertEquals(workSets(w), ['185x8']);

  // Следующее упражнение ещё не начато — /undo возвращает к прошлому.
  await w.press({ type: 'exercise_next' });
  await w.send({ kind: 'command', name: 'undo', args: '' });
  assertEquals(workSets(w), []);
  assert(w.last().includes('Рабочий подход 1: 185 × ?'), w.last());
  await w.type('8');
  await w.press({ type: 'exercise_next' });

  // Пропуск тоже отменяется: снова карточка того же упражнения.
  for (const reps of ['20', '18', '15']) await w.type(reps); // пресс: минимум 3 подхода
  await w.press({ type: 'exercise_next' });
  await w.press({ type: 'exercise_skip' });
  assert(w.last().startsWith('🏋️ Шея: разгибания (4/4)'), w.last());
  await w.send({ kind: 'command', name: 'undo', args: '' });
  assert(w.last().startsWith('🏋️ Шея: сгибания (3/4)'), w.last());
  assertEquals(w.store.logs.some((l) => l.exerciseId === 'neck_flex'), false);
});

Deno.test('/undo: разминка без рабочих подходов снимается целиком; без тренировки — нечего', async () => {
  const w = await world();
  await w.send({ kind: 'command', name: 'undo', args: '' });
  assertEquals(w.last(), 'Нечего отменять.');

  await pressAt195(w);
  await w.press({ type: 'warmup', variant: 'full' });
  await w.send({ kind: 'command', name: 'undo', args: '' });
  assertEquals(warmupSets(w), []);
  assert(w.last().startsWith('Разминка под 195'), w.last());
});

Deno.test('без штанги вес на сторону не показывается', async () => {
  const w = await world();
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'tue' });
  await w.press({ type: 'exercise_skip' });
  await w.press({ type: 'exercise_skip' });
  await w.type('10');
  assert(w.last().includes('Рабочий подход 1: 10 × ?'), w.last());
  assertEquals(w.last().includes('(по'), false);
});
