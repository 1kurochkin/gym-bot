import { assert, assertEquals } from '@std/assert';
import { workout, type World, world } from '../support/world.ts';

/**
 * US-3, US-4 (.specs/product.md): «Изменить» в разминке, комментарий к разминке, [← Назад] без
 * удаления записанного, просмотр, правка и удаление подхода, /undo.
 */

/** Вторник, жим 195: разминка из 4 подходов. */
async function pressAt195(w: World): Promise<void> {
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'tue' });
  await w.press({ type: 'menu_pick', exerciseId: 'incline_press' });
  await w.type('195');
}

const body = (w: World): string[] => w.last().split('\n').slice(2);
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

Deno.test('разминка [✏️ Изменить]: готово, изменить, пропустить — вариант custom', async () => {
  const w = await world();
  await pressAt195(w);
  await w.press({ type: 'warmup_diff' });
  assertEquals(body(w), ['Разминка 1/4: 85 × 8 (по 20)']);
  assertEquals(w.buttons(), ['✅ Готово', '✏️ Изменить', '⏭ Пропустить', '← Назад']);
  await w.press({ type: 'warmup_mark', mark: 'done' });
  await w.press({ type: 'warmup_mark', mark: 'edit' });
  assertEquals(body(w), [
    'Разминка 2/4: 135 × 5 (по 45)',
    'Напиши, что сделал: 4 — повторения, 135/4 — вес и повторения.',
  ]);
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
  assert(w.last().includes('Рабочий подход №1 — 195 × ? (по 75)'), w.last());
});

Deno.test('комментарий к разминке — на экране разминки; в следующий раз над разминкой', async () => {
  const w = await world();
  await pressAt195(w);
  await w.press({ type: 'warmup_comment' });
  assert(w.last().includes('Комментарий к разминке'), w.last());
  await w.type('устал после разминки');
  assertEquals(pressLog(w)?.warmupComment, 'устал после разминки');
  assertEquals(body(w)[0], '💬 Комментарий к разминке сохранён.');
  await w.press({ type: 'warmup', variant: 'full' });
  await w.type('7');
  await w.press({ type: 'exercise_finish' });
  await w.press({ type: 'workout_finish' });
  await w.press({ type: 'workout_done' });

  w.setNow('2026-10-06T22:40:00Z');
  await pressAt195(w);
  assertEquals(body(w)[0], '💬 Прошлый раз: устал после разминки');
});

Deno.test('[← Назад] до подходов: отметка → предыдущая, разминка → вес, вес → меню', async () => {
  const w = await world();
  await pressAt195(w);
  await w.press({ type: 'warmup_diff' });
  await w.press({ type: 'warmup_mark', mark: 'done' });
  await w.press({ type: 'back' });
  assertEquals(body(w), ['Разминка 1/4: 85 × 8 (по 20)']);
  assertEquals(warmupSets(w), [], 'отметка снята');
  await w.press({ type: 'back' });
  assert(body(w).includes('Разминка под 195 × 6–8:'), 'с первой отметки — к разминке');

  await w.press({ type: 'warmup', variant: 'full' });
  await w.press({ type: 'back' });
  assert(body(w).includes('Разминка под 195 × 6–8:'), 'с первого подхода — к разминке');
  assertEquals(warmupSets(w), [], 'разминка снята');

  await w.press({ type: 'back' });
  assert(w.last().includes('Рабочий вес сегодня?'), 'к выбору веса');
  assertEquals(pressLog(w), undefined, 'пустая запись удалена');
  await w.press({ type: 'back' });
  assert(w.last().startsWith('Жим на наклонной · 30.09'), 'в меню');
});

Deno.test('[← Назад] с подходов — просмотр прошлых, ничего не удаляется; правка и удаление', async () => {
  const w = await world();
  await pressAt195(w);
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('7');
  await w.type('6');
  await w.type('5');
  await w.press({ type: 'back' });
  assertEquals(body(w), ['Подход №3: 195 × 5']);
  assertEquals(w.buttons(), ['✏️ Изменить', '🗑 Удалить', '← Подход 2', '➡️ К подходу 4']);
  await w.press({ type: 'back' });
  assertEquals(body(w), ['Подход №2: 195 × 6']);
  assertEquals(workSets(w), ['195x7', '195x6', '195x5'], '«Назад» ничего не удалил');

  await w.press({ type: 'set_edit' });
  assertEquals(body(w), [
    'Подход №2: 195 × 6',
    'Напиши, как было: 7 — повторения, 185/7 — вес и повторения.',
  ]);
  await w.type('185/8');
  assertEquals(body(w).slice(0, 2), [
    '✅ Исправил подход №2.',
    'Записал: 195 × 7, 185 × 8, 195 × 5',
  ]);
  assertEquals(workSets(w), ['195x7', '185x8', '195x5']);

  await w.press({ type: 'back' });
  await w.press({ type: 'set_delete' });
  assertEquals(body(w).slice(0, 2), ['🗑 Удалил подход №3.', 'Записал: 195 × 7, 185 × 8']);
  assertEquals(workSets(w), ['195x7', '185x8']);

  await w.press({ type: 'back' });
  await w.press({ type: 'set_forward' });
  assert(w.last().includes('Рабочий подход №3'), w.last());

  await w.press({ type: 'back' });
  await w.press({ type: 'back' });
  assertEquals(w.buttons().slice(2), ['← В меню', '➡️ К подходу 3']);
  await w.press({ type: 'back' });
  assert(w.last().includes('◐ Жим на наклонной — 195 × 7, 185 × 8'), 'с подхода №1 — в меню');
});

Deno.test('✅ из меню — снова ввод следующего подхода, «Назад» — просмотр, не удаление', async () => {
  const w = await world();
  await pressAt195(w);
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('7');
  await w.press({ type: 'exercise_finish' });
  await w.press({ type: 'menu_pick', exerciseId: 'incline_press' });
  assert(w.last().includes('Записал: 195 × 7'), w.last());
  await w.press({ type: 'back' });
  assertEquals(body(w), ['Подход №1: 195 × 7']);
  await w.press({ type: 'back' });
  assert(w.last().includes('✅ Жим на наклонной — 195 × 7'), 'осталось ✅, подход на месте');
});

Deno.test('/undo: последний подход тренировки; разминка без подходов; нечего', async () => {
  const w = await world();
  await w.send({ kind: 'command', name: 'undo', args: '' });
  assertEquals(w.last(), 'Нечего отменять.');

  await pressAt195(w);
  await w.press({ type: 'warmup', variant: 'full' });
  await w.type('7');
  await w.press({ type: 'exercise_finish' });
  await w.send({ kind: 'command', name: 'undo', args: '' });
  assertEquals(workSets(w), []);
  assertEquals(body(w).slice(0, 2), [
    '↩️ Удалил 195 × 7.',
    'Рабочий подход №1 — 195 × ? (по 75)',
  ]);

  await w.send({ kind: 'command', name: 'undo', args: '' });
  assertEquals(warmupSets(w), [], 'разминка снята');
  assert(body(w).includes('Разминка под 195 × 6–8:'), w.last());
});
