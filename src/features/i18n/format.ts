import { assertNever } from '../../shared/result.ts';
import { type Language, LanguageSchema } from '../../core/settings/settings.ts';
import type { ZoneLabel } from '../../core/schedule/timezone.ts';

const { ru, en } = LanguageSchema.enum;

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

export const weekday = (iso: string, lang: Language): string =>
  WEEKDAYS[lang][new Date(`${iso}T12:00:00Z`).getUTCDay()] ?? '';

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

export const pluralEn = (n: number, one: string, other: string): string =>
  `${n} ${n === 1 ? one : other}`;

export function zone(label: ZoneLabel, lang: Language): string {
  const fixed: Record<Language, string> = {
    ru: 'без перехода на летнее время',
    en: 'no daylight saving',
  };
  return `${label.offset} · ${label.city ?? fixed[lang]}`;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

export const column = <T>(items: readonly T[]): T[][] => items.map((i) => [i]);
