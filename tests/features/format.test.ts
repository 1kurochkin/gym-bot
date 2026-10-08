import { assertEquals } from '@std/assert';
import { date, num, pluralRu, weekday, zone } from '../../src/features/i18n/format.ts';

Deno.test('числа и даты по языку: «2,5» и «01.10» / «2.5» и «Oct 1»', () => {
  assertEquals([num(2.5, 'ru'), num(2.5, 'en'), num(185, 'en')], ['2,5', '2.5', '185']);
  assertEquals([date('2026-10-01', 'ru'), date('2026-10-01', 'en')], ['01.10', 'Oct 1']);
  assertEquals([weekday('2026-10-01', 'ru'), weekday('2026-10-01', 'en')], ['Чт', 'Thu']);
});

Deno.test('русские формы числа: 1, 2–4, 5+ и 11–14', () => {
  const day = (n: number): string => pluralRu(n, 'день', 'дня', 'дней');
  assertEquals([1, 3, 5, 11, 12, 21, 22, 25].map(day), [
    '1 день',
    '3 дня',
    '5 дней',
    '11 дней',
    '12 дней',
    '21 день',
    '22 дня',
    '25 дней',
  ]);
});

Deno.test('подпись зоны: фиксированное смещение поясняется на языке', () => {
  const fixed = { offset: 'UTC−4', city: null };
  assertEquals(zone(fixed, 'ru'), 'UTC−4 · без перехода на летнее время');
  assertEquals(zone(fixed, 'en'), 'UTC−4 · no daylight saving');
  assertEquals(zone({ offset: 'UTC−4', city: 'New York' }, 'en'), 'UTC−4 · New York');
});
