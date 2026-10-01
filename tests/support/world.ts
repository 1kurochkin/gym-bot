import { handleUpdate, type UpdateDeps } from '../../src/app/handle-update.ts';
import { TimeZoneSchema } from '../../src/core/schedule/timezone.ts';
import { defaultSettings } from '../../src/core/settings/settings.ts';
import type { Action, Incoming } from '../../src/ports/ui.ts';
import { fakeUi, memoryStore, OWNERS, TESTER } from './fakes.ts';
import { specProgramJson } from './spec.ts';

/** Тренировка через весь цикл апдейта: владелец в Нью-Йорке, программа из спеки уже загружена. */

export type World = {
  store: ReturnType<typeof memoryStore>;
  ui: ReturnType<typeof fakeUi>;
  send: (input: Incoming) => Promise<void>;
  press: (action: Action) => Promise<void>;
  type: (value: string) => Promise<void>;
  setNow: (iso: string) => void;
  last: () => string;
  buttons: () => string[];
};

export async function world(): Promise<World> {
  const store = memoryStore();
  const ui = fakeUi();
  let n = 0;
  let updateId = 1;
  let now = new Date('2026-09-30T22:40:00Z'); // ср, 30.09, 18:40 в Нью-Йорке
  const deps: UpdateDeps = {
    store,
    ui,
    clock: { now: () => now },
    zoneAt: () => Promise.resolve(null),
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    owners: OWNERS,
    botUsername: () => 'gym_test_bot',
  };
  const send = (input: Incoming): Promise<void> =>
    handleUpdate(deps, {
      updateId: updateId++,
      userId: 1,
      chatId: 1,
      messageId: 9,
      languageCode: 'ru',
      person: TESTER,
      input,
    });
  store.settings.set(1, {
    ...defaultSettings(1),
    timezone: TimeZoneSchema.parse('America/New_York'),
  });
  await send({
    kind: 'document',
    fileName: 'p.json',
    text: JSON.stringify(await specProgramJson()),
    problem: null,
  });
  return {
    store,
    ui,
    send,
    press: (action) =>
      send({ kind: 'callback', action, stepNo: store.sessions.get(1)?.stepNo ?? -1 }),
    type: (value) => send({ kind: 'text', text: value }),
    setNow: (iso) => (now = new Date(iso)),
    last: () => ui.shown.at(-1)?.rendered.text ?? '',
    buttons: () => ui.shown.at(-1)?.rendered.keyboard.flat().map((b) => b.label) ?? [],
  };
}

export const workout: Incoming = { kind: 'command', name: 'workout', args: '' };
