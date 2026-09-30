import { assertEquals } from '@std/assert';
import { isoWeekOf, localDateOf, LocalDateSchema } from '../../../src/core/schedule/calendar.ts';
import { TimeZoneSchema } from '../../../src/core/schedule/timezone.ts';

const ny = TimeZoneSchema.parse('America/New_York');
const d = (s: string): ReturnType<typeof LocalDateSchema.parse> => LocalDateSchema.parse(s);

Deno.test('локальная дата: вечерняя тренировка в Нью-Йорке — сегодня, хотя по UTC уже завтра', () => {
  assertEquals(localDateOf(new Date('2026-09-30T23:30:00-04:00'), ny), '2026-09-30');
  assertEquals(localDateOf(new Date('2026-10-01T03:30:00Z'), ny), '2026-09-30');
});

Deno.test('локальная дата на переходе на зимнее время (1 ноября 2026)', () => {
  assertEquals(localDateOf(new Date('2026-11-01T04:30:00Z'), ny), '2026-11-01', '00:30 EDT');
  assertEquals(localDateOf(new Date('2026-11-02T04:30:00Z'), ny), '2026-11-01', '23:30 EST');
});

Deno.test('ISO-неделя: пн–вс, четверг определяет год', () => {
  assertEquals(isoWeekOf(d('2026-09-22')), '2026-W39', 'пример из спецификации экспорта');
  assertEquals(isoWeekOf(d('2026-09-28')), '2026-W40', 'понедельник');
  assertEquals(isoWeekOf(d('2026-10-04')), '2026-W40', 'воскресенье той же недели');
  assertEquals(isoWeekOf(d('2026-10-05')), '2026-W41');
  assertEquals(
    isoWeekOf(d('2027-01-01')),
    '2026-W53',
    '1 января 2027 — пятница, неделя прошлого года',
  );
  assertEquals(isoWeekOf(d('2026-01-01')), '2026-W01', '1 января 2026 — четверг');
  assertEquals(
    isoWeekOf(d('2024-12-30')),
    '2025-W01',
    '30 декабря 2024 — уже неделя следующего года',
  );
});

Deno.test('недели сравниваются строками хронологически', () => {
  assertEquals(['2027-W01', '2026-W09', '2026-W53', '2026-W10'].sort(), [
    '2026-W09',
    '2026-W10',
    '2026-W53',
    '2027-W01',
  ]);
});
