import { z } from 'zod';
import type { TimeZone } from './timezone.ts';

/** Локальная дата пользователя YYYY-MM-DD: по ней считаются день и неделя тренировки. */
export const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).brand<'LocalDate'>();
export type LocalDate = z.infer<typeof LocalDateSchema>;

/** ISO-неделя «2026-W40» (пн–вс). Строки сравниваются лексикографически в хронологическом порядке. */
export const IsoWeekSchema = z.string().regex(/^\d{4}-W\d{2}$/).brand<'IsoWeek'>();
export type IsoWeek = z.infer<typeof IsoWeekSchema>;

const DAY_MS = 86_400_000;

/** Дата в часовом поясе пользователя на момент `at` (вечерняя тренировка не «съезжает» на завтра по UTC). */
export function localDateOf(at: Date, zone: TimeZone): LocalDate {
  const text = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
  return LocalDateSchema.parse(text);
}

/** ISO-неделя даты: неделя принадлежит году, в который попадает её четверг. */
export function isoWeekOf(date: LocalDate): IsoWeek {
  const [y, m, d] = date.split('-').map(Number);
  const utc = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  const weekday = (new Date(utc).getUTCDay() + 6) % 7; // пн = 0
  const thursday = utc + (3 - weekday) * DAY_MS;
  const year = new Date(thursday).getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4);
  const week1Monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS;
  const week = 1 + Math.floor((utc - weekday * DAY_MS - week1Monday) / (7 * DAY_MS));
  return IsoWeekSchema.parse(`${year}-W${String(week).padStart(2, '0')}`);
}
