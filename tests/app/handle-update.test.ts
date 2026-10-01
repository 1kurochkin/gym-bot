import { assertEquals } from '@std/assert';
import { handleUpdate, type UpdateDeps } from '../../src/app/handle-update.ts';
import { TimeZoneSchema } from '../../src/core/schedule/timezone.ts';
import type { Incoming, IncomingUpdate } from '../../src/ports/ui.ts';
import { fakeUi, memoryStore, OWNERS, TESTER } from '../support/fakes.ts';

function setup(): {
  deps: UpdateDeps;
  store: ReturnType<typeof memoryStore>;
  ui: ReturnType<typeof fakeUi>;
} {
  const store = memoryStore();
  const ui = fakeUi();
  const deps: UpdateDeps = {
    store,
    ui,
    clock: { now: () => new Date('2026-09-28T22:40:00Z') },
    zoneAt: (lat) => Promise.resolve(lat > 50 ? 'Europe/Moscow' : null),
    newId: () => crypto.randomUUID(),
    owners: OWNERS,
    botUsername: () => 'gym_test_bot',
  };
  return { deps, store, ui };
}

let nextId = 100;
const upd = (input: Incoming, messageId: number | null = null): IncomingUpdate => ({
  updateId: nextId++,
  userId: 1,
  chatId: 1,
  messageId,
  languageCode: 'ru',
  person: TESTER,
  input,
});
const start: Incoming = { kind: 'command', name: 'start', args: '' };

Deno.test('онбординг: /start → время → кнопка зоны → главный экран', async () => {
  const { deps, store, ui } = setup();
  await handleUpdate(deps, upd(start));
  await handleUpdate(deps, upd({ kind: 'text', text: '18:40' }));
  const stepNo = store.sessions.get(1)?.stepNo ?? -1;
  const zone = TimeZoneSchema.parse('America/New_York');
  await handleUpdate(deps, upd({ kind: 'callback', action: { type: 'tz', zone }, stepNo }, 55));

  assertEquals(store.settings.get(1)?.timezone, zone);
  assertEquals(ui.shown.map((s) => s.rendered.replyKeyboard?.kind ?? null), [
    'request_location',
    null,
    'remove',
  ]);
  assertEquals(ui.shown[1]?.rendered.keyboard.length, 4, '3 города + фиксированное смещение');
  assertEquals(ui.shown[2]?.rendered.text.split('\n')[0], 'Часовой пояс: UTC−4 · New York');
  assertEquals(ui.shown[2]?.messageId, 55);
});

Deno.test('геопозиция: зона определяется по координатам, координаты не сохраняются', async () => {
  const { deps, store } = setup();
  await handleUpdate(deps, upd(start));
  await handleUpdate(deps, upd({ kind: 'location', latitude: 55.75, longitude: 37.62 }));
  assertEquals(store.settings.get(1)?.timezone, 'Europe/Moscow');
  assertEquals(JSON.stringify([...store.settings.values()]).includes('55.75'), false);
});

Deno.test('геопозиция без зоны (океан) → просим написать время', async () => {
  const { deps, store, ui } = setup();
  await handleUpdate(deps, upd(start));
  await handleUpdate(deps, upd({ kind: 'location', latitude: 0, longitude: -160 }));
  assertEquals(store.settings.get(1)?.timezone ?? null, null);
  assertEquals(ui.shown[1]?.rendered.text.startsWith('По этой геопозиции'), true);
});

Deno.test('повтор того же update_id (ретрай webhook) не обрабатывается дважды', async () => {
  const { deps, store, ui } = setup();
  const u = upd(start);
  await handleUpdate(deps, u);
  await handleUpdate(deps, u);
  assertEquals(ui.shown.length, 1);
  assertEquals(store.commits, 1);
});

Deno.test('двойное нажатие: вторая кнопка устарела, дубля нет, клавиатура убрана', async () => {
  const { deps, store, ui } = setup();
  await handleUpdate(deps, upd(start));
  await handleUpdate(deps, upd({ kind: 'text', text: '18:40' }));
  const stepNo = store.sessions.get(1)?.stepNo ?? -1;
  const press: Incoming = {
    kind: 'callback',
    action: { type: 'tz', zone: TimeZoneSchema.parse('America/New_York') },
    stepNo,
  };
  await handleUpdate(deps, upd(press, 55));
  await handleUpdate(deps, upd(press, 55));
  assertEquals(ui.shown.length, 3);
  assertEquals(ui.dropped, [55]);
});
