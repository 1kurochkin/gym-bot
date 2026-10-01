import { assertEquals } from '@std/assert';
import {
  candidateZones,
  offsetFromLocalTime,
  parseClockTime,
  parseTimeZone,
  type TimeZone,
  utcOffsetMinutes,
  zoneLabel,
} from '../../../src/core/schedule/timezone.ts';

const zone = (name: string): TimeZone => {
  const r = parseTimeZone(name);
  if (!r.ok) throw new Error(name);
  return r.value;
};
const ny = zone('America/New_York');
/** 22:40 UTC = 18:40 в Нью-Йорке (летнее время). */
const now = new Date('2026-09-28T22:40:00Z');

Deno.test('New York: летом UTC−4, зимой UTC−5 (IANA-зона, а не фиксированное смещение)', () => {
  assertEquals(zoneLabel(ny, new Date('2026-07-01T12:00:00Z')), {
    offset: 'UTC−4',
    city: 'New York',
  });
  assertEquals(zoneLabel(ny, new Date('2026-12-01T12:00:00Z')), {
    offset: 'UTC−5',
    city: 'New York',
  });
});

Deno.test('переход на зимнее время 1 ноября 2026: смещение меняется в 2:00 по местному', () => {
  assertEquals(utcOffsetMinutes(ny, new Date('2026-11-01T05:59:00Z')), -240);
  assertEquals(utcOffsetMinutes(ny, new Date('2026-11-01T06:00:00Z')), -300);
});

Deno.test('подписи: дробное смещение, UTC, фиксированное смещение Etc', () => {
  assertEquals(zoneLabel(zone('Asia/Kolkata'), now), { offset: 'UTC+5:30', city: 'Kolkata' });
  assertEquals(zoneLabel(zone('Etc/GMT+4'), now), { offset: 'UTC−4', city: null });
});

Deno.test('parseClockTime: форматы, которые пишут люди', () => {
  const cases: [string, number | null][] = [
    ['18:40', 1120],
    ['18.40', 1120],
    ['1840', 1120],
    ['7', 420],
    ['6:40 pm', 1120],
    ['6.40PM', 1120],
    ['12 am', 0],
    ['12:05 p.m.', 725],
    ['24:00', null],
    ['18:61', null],
    ['13 pm', null],
    ['привет', null],
  ];
  for (const [text, expected] of cases) {
    const r = parseClockTime(text);
    assertEquals(r.ok ? r.value : null, expected, text);
  }
});

Deno.test('offsetFromLocalTime: смещение с переходом через полночь и округлением до 15 мин', () => {
  assertEquals(offsetFromLocalTime(18 * 60 + 40, now), -240);
  assertEquals(offsetFromLocalTime(18 * 60 + 43, now), -240, 'часы пользователя спешат на 3 мин');
  assertEquals(
    offsetFromLocalTime(2 * 60 + 10, now),
    210,
    'у пользователя уже следующий день (+3:30)',
  );
});

Deno.test('candidateZones: города с этим смещением сейчас + фиксированное смещение', () => {
  assertEquals(candidateZones(-240, now, 'en'), {
    cities: [ny, zone('America/Toronto'), zone('America/Caracas')],
    fixed: zone('Etc/GMT+4'),
  });
});

Deno.test('candidateZones: язык интерфейса поднимает свои города наверх', () => {
  const ru = candidateZones(180, now, 'ru');
  assertEquals(ru.cities.slice(0, 2), [zone('Europe/Moscow'), zone('Europe/Minsk')]);
  assertEquals(ru.cities.length, 3);
});

Deno.test('candidateZones: дробное смещение — без Etc-варианта', () => {
  assertEquals(candidateZones(345, now, null), { cities: [zone('Asia/Kathmandu')], fixed: null });
});
