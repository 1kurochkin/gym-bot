import { assertEquals } from '@std/assert';
import { decodeCallback, encodeCallback } from '../../src/adapters/telegram/callback.ts';
import { TimeZoneSchema } from '../../src/core/schedule/timezone.ts';
import { ActionSchema } from '../../src/ports/ui.ts';

Deno.test('кодек callback_data: туда и обратно, включая Etc/GMT+4', () => {
  for (
    const name of ['America/New_York', 'Etc/GMT+4', 'Etc/GMT-14', 'America/Argentina/Buenos_Aires']
  ) {
    const zone = TimeZoneSchema.parse(name);
    const data = encodeCallback({ type: 'tz', zone }, 12);
    assertEquals(decodeCallback(data), { stepNo: 12, action: { type: 'tz', zone } });
  }
});

Deno.test('самое длинное IANA-имя укладывается в 64 байта', () => {
  const zone = TimeZoneSchema.parse('America/Argentina/ComodRivadavia');
  encodeCallback({ type: 'tz', zone }, 999999);
});

Deno.test('кодек: кнопки программы, /seed и настроек', () => {
  const actions = [
    { type: 'program_confirm' },
    { type: 'seed_next' },
    { type: 'settings_section', section: 'plates' },
    { type: 'bar_set', lb: 33 },
    { type: 'plate_toggle', lb: 2.5 },
    { type: 'step_pick', exerciseId: 'neck_flex' },
    { type: 'step_set', lb: 7.5 },
    { type: 'step_reset' },
    { type: 'settings_close' },
  ] as const;
  for (const a of actions) {
    const decoded = decodeCallback(encodeCallback(ActionSchema.parse(a), 3));
    assertEquals(decoded, { stepNo: 3, action: a } as unknown);
  }
  assertEquals(decodeCallback('3|se:gym'), null, 'неизвестный раздел отсекается схемой');
  assertEquals(decodeCallback('3|bs:-5'), null);
});

Deno.test('мусор в callback_data не декодируется', () => {
  assertEquals(decodeCallback('tz:Europe/Moscow'), null);
  assertEquals(decodeCallback('1|{"a":1}'), null);
  assertEquals(decodeCallback('1|tz:Europe/Moscow;drop'), null);
  assertEquals(decodeCallback('1|tz:Mars/Base'), null, 'несуществующая зона отсекается схемой');
});
