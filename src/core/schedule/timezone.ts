import { z } from 'zod';
import { err, ok, type Result } from '../../shared/result.ts';

const isIanaZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

/** IANA-зона (America/New_York). Храним её, а не смещение: смещение меняется при переходе на зимнее время. */
export const TimeZoneSchema = z.string().min(1).refine(isIanaZone).brand<'TimeZone'>();
export type TimeZone = z.infer<typeof TimeZoneSchema>;

/** Ошибки разбора пользовательского ввода: зона и время суток. */
export const TimeInputErrorSchema = z.enum(['unknown_zone', 'not_time']);
export type TimeInputError = z.infer<typeof TimeInputErrorSchema>;
const { unknown_zone, not_time } = TimeInputErrorSchema.enum;

export function parseTimeZone(value: string): Result<TimeZone, typeof unknown_zone> {
  const r = TimeZoneSchema.safeParse(value);
  return r.success ? ok(r.data) : err(unknown_zone);
}

/** Смещение зоны на момент `at` в минутах (New York летом: −240, зимой: −300). */
export function utcOffsetMinutes(zone: TimeZone, at: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/** «UTC−4», «UTC+5:30», «UTC». Минус — типографский (U+2212). */
export function formatOffset(minutes: number): string {
  if (minutes === 0) return 'UTC';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const min = abs % 60;
  return `UTC${minutes < 0 ? '−' : '+'}${h}${min ? `:${String(min).padStart(2, '0')}` : ''}`;
}

export function cityName(zone: TimeZone): string {
  const last = zone.split('/').pop() ?? zone;
  return last.replaceAll('_', ' ');
}

/** «UTC−4 · New York»: смещение считается на текущий момент. */
export function formatZoneLabel(zone: TimeZone, at: Date): string {
  const offset = formatOffset(utcOffsetMinutes(zone, at));
  return zone.startsWith('Etc/')
    ? `${offset} · без перехода на летнее время`
    : `${offset} · ${cityName(zone)}`;
}

/** Время суток, которое написал пользователь, в минутах от полуночи: «18:40», «6.40 pm», «1840», «7». */
export function parseClockTime(text: string): Result<number, typeof not_time> {
  const m = /^\s*(\d{1,2})(?:[:.\s]?(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*$/i.exec(text);
  if (!m) return err(not_time);
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  const suffix = m[3]?.toLowerCase().replaceAll('.', '');
  if (min > 59) return err(not_time);
  if (suffix) {
    if (h < 1 || h > 12) return err(not_time);
    h = (h % 12) + (suffix === 'pm' ? 12 : 0);
  } else if (h > 23) {
    return err(not_time);
  }
  return ok(h * 60 + min);
}

/**
 * Смещение от UTC по местному времени пользователя. Округление до 15 минут
 * (часы пользователя могут расходиться на пару минут), диапазон реальных зон — от −12 до +14 ч.
 */
export function offsetFromLocalTime(localMinutes: number, now: Date): number {
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  let diff = localMinutes - utcMinutes;
  if (diff > 14 * 60) diff -= 24 * 60;
  if (diff < -12 * 60) diff += 24 * 60;
  return Math.round(diff / 15) * 15;
}

/** Крупные города по одному на регион; порядок — приоритет показа. */
const POPULAR_ZONES: readonly string[] = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Toronto',
  'America/Vancouver',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Halifax',
  'America/St_Johns',
  'America/Mexico_City',
  'America/Bogota',
  'America/Lima',
  'America/Caracas',
  'America/Santiago',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'America/Noronha',
  'Atlantic/Azores',
  'Europe/London',
  'Europe/Lisbon',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Warsaw',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Africa/Cairo',
  'Europe/Kaliningrad',
  'Europe/Kyiv',
  'Asia/Jerusalem',
  'Europe/Istanbul',
  'Europe/Moscow',
  'Europe/Minsk',
  'Africa/Nairobi',
  'Asia/Tehran',
  'Asia/Dubai',
  'Europe/Samara',
  'Asia/Tbilisi',
  'Asia/Yerevan',
  'Asia/Baku',
  'Asia/Kabul',
  'Asia/Yekaterinburg',
  'Asia/Tashkent',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Almaty',
  'Asia/Omsk',
  'Asia/Dhaka',
  'Asia/Novosibirsk',
  'Asia/Krasnoyarsk',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Irkutsk',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Australia/Perth',
  'Asia/Yakutsk',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Darwin',
  'Australia/Adelaide',
  'Asia/Vladivostok',
  'Australia/Sydney',
  'Australia/Brisbane',
  'Asia/Magadan',
  'Asia/Kamchatka',
  'Pacific/Auckland',
];

/** Зоны, которые показываем первыми для языка интерфейса Telegram. */
const LANGUAGE_ZONES: Readonly<Record<string, readonly string[]>> = {
  ru: [
    'Europe/Moscow',
    'Europe/Kaliningrad',
    'Europe/Samara',
    'Asia/Yekaterinburg',
    'Asia/Omsk',
    'Asia/Novosibirsk',
    'Asia/Krasnoyarsk',
    'Asia/Irkutsk',
    'Asia/Yakutsk',
    'Asia/Vladivostok',
    'Asia/Magadan',
    'Asia/Kamchatka',
    'Europe/Minsk',
    'Asia/Almaty',
    'Asia/Tashkent',
    'Asia/Tbilisi',
    'Asia/Yerevan',
    'Asia/Baku',
  ],
  uk: ['Europe/Kyiv'],
  be: ['Europe/Minsk'],
  kk: ['Asia/Almaty'],
  de: ['Europe/Berlin'],
  fr: ['Europe/Paris'],
  es: ['Europe/Madrid', 'America/Mexico_City', 'America/Bogota', 'America/Argentina/Buenos_Aires'],
  pt: ['America/Sao_Paulo', 'Europe/Lisbon'],
  it: ['Europe/Rome'],
  pl: ['Europe/Warsaw'],
  tr: ['Europe/Istanbul'],
  he: ['Asia/Jerusalem'],
  ja: ['Asia/Tokyo'],
  ko: ['Asia/Seoul'],
  zh: ['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore'],
};

export const ZoneCandidatesSchema = z.object({
  /** Города с таким смещением сейчас, не больше `limit`, подходящие по языку — первыми. */
  cities: z.array(TimeZoneSchema).readonly(),
  /** Фиксированное смещение без летнего времени (Etc/GMT±N); только для целых часов. */
  fixed: TimeZoneSchema.nullable(),
}).readonly();
export type ZoneCandidates = z.infer<typeof ZoneCandidatesSchema>;

/** Зоны, у которых в момент `now` смещение равно `offset`. */
export function candidateZones(
  offset: number,
  now: Date,
  languageCode: string | null,
  limit = 3,
): ZoneCandidates {
  const preferred = LANGUAGE_ZONES[(languageCode ?? '').slice(0, 2).toLowerCase()] ?? [];
  const ordered = [...preferred, ...POPULAR_ZONES.filter((z) => !preferred.includes(z))];
  const cities: TimeZone[] = [];
  for (const name of ordered) {
    const zone = parseTimeZone(name);
    if (zone.ok && utcOffsetMinutes(zone.value, now) === offset) cities.push(zone.value);
    if (cities.length === limit) break;
  }
  return { cities, fixed: fixedOffsetZone(offset) };
}

/** Etc/GMT+4 — это UTC−4: у зон Etc знак обратный (POSIX). */
function fixedOffsetZone(offset: number): TimeZone | null {
  if (offset % 60 !== 0) return null;
  const h = -offset / 60;
  const zone = parseTimeZone(h === 0 ? 'Etc/UTC' : `Etc/GMT${h > 0 ? '+' : ''}${h}`);
  return zone.ok ? zone.value : null;
}
