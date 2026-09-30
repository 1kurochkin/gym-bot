import { assertEquals } from '@std/assert';
import { nextDay } from '../../../src/core/schedule/rotation.ts';

const rotation = ['mon', 'tue', 'wed', 'thu', 'fri'];

Deno.test('следующий день — по порядку от последней завершённой, первым в списке', () => {
  assertEquals(nextDay(rotation, 'mon'), { next: 'tue', others: ['mon', 'wed', 'thu', 'fri'] });
});

Deno.test('после последнего дня — снова первый (пятница → фронтальный присед)', () => {
  assertEquals(nextDay(rotation, 'fri').next, 'mon');
});

Deno.test('нет истории или день удалён из программы — первый день', () => {
  assertEquals(nextDay(rotation, null).next, 'mon');
  assertEquals(nextDay(rotation, 'sat').next, 'mon');
});
