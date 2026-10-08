import { assert, assertEquals } from '@std/assert';
import { clearBatches } from '../../src/adapters/telegram/bot.ts';
import { workout, world } from '../support/world.ts';

Deno.test('/clear: сначала удаление переписки, потом главный экран; тренировка остаётся', async () => {
  const w = await world();
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'tue' });
  await w.send({ kind: 'command', name: 'clear', args: '' });
  assertEquals(w.ui.cleared, [9], 'от сообщения с командой назад');
  assertEquals(w.ui.shown.length, 1, 'после очистки — только новый экран');
  assert(w.last().startsWith('Часовой пояс:'), w.last());
  assertEquals([...w.store.workouts.values()][0]?.status, 'in_progress', 'данные не тронуты');
  await w.send(workout);
  assert(w.last().startsWith('Жим на наклонной · 30.09'), 'тренировка продолжается');
});

Deno.test('пачки для deleteMessages: по 100, новые первыми, не дальше 2000 и не меньше 1', () => {
  const batches = clearBatches(250);
  assertEquals(batches.map((b) => [b[0], b.at(-1), b.length]), [
    [250, 151, 100],
    [150, 51, 100],
    [50, 1, 50],
  ]);
  const deep = clearBatches(5000);
  assertEquals([deep.length, deep.at(-1)?.at(-1)], [20, 3001]);
});
