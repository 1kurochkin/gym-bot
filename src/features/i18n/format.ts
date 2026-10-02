import { assertNever } from '../../shared/result.ts';
import { type Language, LanguageSchema } from '../../core/settings/settings.ts';
import type { ZoneLabel } from '../../core/schedule/timezone.ts';

/**
 * Форматирование для текстов бота на языке пользователя (.specs/product.md → «Язык интерфейса»):
 * по-русски «2,5» и «01.10», по-английски «2.5» и «Oct 1». Словари фраз — в messages.ts фич.
 */

const { ru, en } = LanguageSchema.enum;

/** Дробные фунты: 2.5 → «2,5» / «2.5». */
export function num(n: number, lang: Language): string {
  switch (lang) {
    case ru:
      return String(n).replace('.', ',');
    case en:
      return String(n);
    default:
      return assertNever(lang);
  }
}

const MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Локальная дата «2026-10-01» → «01.10» / «Oct 1». */
export function date(iso: string, lang: Language): string {
  const day = iso.slice(8, 10);
  const month = iso.slice(5, 7);
  switch (lang) {
    case ru:
      return `${day}.${month}`;
    case en:
      return `${MONTHS_EN[Number(month) - 1] ?? month} ${Number(day)}`;
    default:
      return assertNever(lang);
  }
}

const WEEKDAYS: Record<Language, readonly string[]> = {
  ru: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

/** День недели локальной даты: «Пн» / «Mon». */
export const weekday = (iso: string, lang: Language): string =>
  WEEKDAYS[lang][new Date(`${iso}T12:00:00Z`).getUTCDay()] ?? '';

/** «5 дней»: русские формы для 1, 2–4 и 5+ (с учётом 11–14). */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11
    ? one
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
    ? few
    : many;
  return `${n} ${word}`;
}

/** «5 days». */
export const pluralEn = (n: number, one: string, other: string): string =>
  `${n} ${n === 1 ? one : other}`;

/** «UTC−4 · New York»; фиксированное смещение — с пояснением про летнее время. */
export function zone(label: ZoneLabel, lang: Language): string {
  const fixed: Record<Language, string> = {
    ru: 'без перехода на летнее время',
    en: 'no daylight saving',
  };
  return `${label.offset} · ${label.city ?? fixed[lang]}`;
}

/** Ряды кнопок по size в ряд. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

/** Кнопки списком — по одной в строку (кнопки с текстом; числовые — сеткой через chunk). */
export const column = <T>(items: readonly T[]): T[][] => items.map((i) => [i]);
