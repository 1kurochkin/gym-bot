import { assert, assertEquals } from '@std/assert';
import { workout, world } from '../support/world.ts';

/**
 * Приёмка этапа 3 (.specs/roadmap.md → «Готово, когда», п. 1). Остальные пункты — сквозные
 * тесты тренировки: разминка 195 по таблице 6.2, продолжение, двойное нажатие, 100/70,
 * ≤ 3 действия на подход (tests/app/workout-flow.test.ts).
 */
Deno.test('приёмка 1: после пятницы прошлой недели — «Подтягивания + тяга» и первым присед', async () => {
  const w = await world();
  w.setNow('2026-09-25T22:40:00Z'); // пт, 25.09 — прошлая неделя
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'fri' });
  await w.press({ type: 'menu_pick', exerciseId: 'pullups' });
  await w.type('0');
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('8');
  await w.press({ type: 'exercise_finish' });
  await w.press({ type: 'workout_finish' });
  assert(w.last().startsWith('Тренировка завершена'), w.last());
  await w.press({ type: 'workout_done' });

  w.setNow('2026-09-30T22:40:00Z'); // ср, 30.09
  await w.send(workout);
  assertEquals(w.last(), 'Прошлая тренировка: Пт, 25.09 — Подтягивания + тяга.\nВыбери день:');
  assertEquals(w.buttons()[0], '▶ Фронтальный присед');
});
