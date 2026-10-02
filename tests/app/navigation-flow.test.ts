import { assert, assertEquals } from '@std/assert';
import { bold } from '../../src/adapters/telegram/bot.ts';
import { workout, type World, world } from '../support/world.ts';

/**
 * US-3, US-4 (.specs/product.md): [← Назад] на каждом экране тренировки, [⏭ Пропустить] на каждом
 * подходе, название упражнения жирным. День — вторник: жим, пресс (3 подхода), шея, шея.
 */

const shown = (w: World): { text: string; bold: readonly string[] } => {
  const r = w.ui.shown.at(-1)?.rendered;
  return { text: r?.text ?? '', bold: r?.bold ?? [] };
};

async function pressDone(w: World): Promise<void> {
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'tue' });
  await w.type('195');
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('7');
}

Deno.test('название упражнения — первой строкой и жирным; разметка — entities Telegram', async () => {
  const w = await world();
  await pressDone(w);
  await w.press({ type: 'exercise_next' });
  assertEquals(shown(w).text.split('\n')[0], 'Пресс');
  assertEquals(shown(w).bold, ['Пресс']);
  assertEquals(
    bold({ text: 'x\nПресс\nПодход 1', keyboard: [], replyKeyboard: null, bold: ['Пресс'] }),
    [
      { type: 'bold', offset: 2, length: 5 },
    ],
  );
});

Deno.test('[⏭ Пропустить] на втором подходе — упражнение заканчивается, записанное остаётся', async () => {
  const w = await world();
  await pressDone(w);
  await w.press({ type: 'exercise_next' });
  await w.type('20');
  assert(w.last().includes('Подход 2 — 90% от отказа'), w.last());
  assert(w.buttons().includes('⏭ Пропустить'));
  await w.press({ type: 'exercise_skip' });
  assert(w.last().startsWith('🏋️ Шея: сгибания (3/4)'), w.last());
  const abs = w.store.logs.find((l) => l.exerciseId === 'abs');
  assertEquals(abs?.status, 'done');
  assertEquals(w.store.sets.filter((s) => s.exerciseLogId === abs?.id).length, 1);
});

Deno.test('[← Назад]: выбор дня → главный; карточка первого упражнения → выбор дня', async () => {
  const w = await world();
  await w.send(workout);
  assert(w.buttons().includes('← Назад'));
  await w.press({ type: 'back' });
  assert(w.last().startsWith('Часовой пояс:'), w.last());

  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'tue' });
  await w.press({ type: 'back' });
  assertEquals(w.last(), 'Выбери день:');
  assertEquals(w.store.workouts.size, 0, 'пустая тренировка удалена');
});

Deno.test('[← Назад] с карточки — к прошлому упражнению; с пропущенного — пропуск снимается', async () => {
  const w = await world();
  await pressDone(w);
  await w.press({ type: 'exercise_next' }); // пресс без карточки — сразу подход
  await w.press({ type: 'back' });
  assert(w.last().includes('\nЗаписал 195 × 7.'), w.last());
  assertEquals(
    w.store.logs.some((l) => l.exerciseId === 'abs'),
    false,
    'пустая запись пресса удалена',
  );

  await w.press({ type: 'exercise_next' });
  await w.press({ type: 'exercise_skip' });
  assert(w.last().startsWith('🏋️ Шея: сгибания (3/4)'), w.last());
  await w.press({ type: 'back' });
  assert(w.last().includes('Подход 1 — 80% от отказа'), 'снова пресс');
  assertEquals(w.store.logs.some((l) => l.exerciseId === 'abs' && l.status === 'skipped'), false);
});

Deno.test('[← Назад] на подходах: до минимума — отмена прошлого подхода; после «Ещё подход» — к экрану после подхода', async () => {
  const w = await world();
  await pressDone(w);
  await w.press({ type: 'exercise_next' });
  await w.type('20');
  await w.press({ type: 'back' });
  assert(w.last().includes('↩️ Удалил × 20.'), w.last());
  assert(w.last().includes('Подход 1 — 80% от отказа'));

  await w.type('20');
  await w.type('18');
  await w.type('15');
  await w.press({ type: 'set_more' });
  await w.press({ type: 'back' });
  assert(w.last().includes('\nЗаписал × 15.'), w.last());
  assertEquals(w.store.sets.filter((s) => s.kind === 'work').length, 4, 'ничего не удалено');

  await w.press({ type: 'comment' });
  await w.press({ type: 'back' });
  assert(w.last().includes('\nЗаписал × 15.'), 'из комментария — обратно');
});

Deno.test('[← Назад] на «Продолжить тренировку?» — главный экран, тренировка остаётся', async () => {
  const w = await world();
  await pressDone(w);
  await w.send(workout);
  await w.press({ type: 'back' });
  assert(w.last().startsWith('Часовой пояс:'), w.last());
  assertEquals([...w.store.workouts.values()][0]?.status, 'in_progress');
});
