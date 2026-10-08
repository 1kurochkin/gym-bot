import { assert, assertEquals } from '@std/assert';
import { handleUpdate, type UpdateDeps } from '../../src/app/handle-update.ts';
import { TimeZoneSchema } from '../../src/core/schedule/timezone.ts';
import { defaultSettings } from '../../src/core/settings/settings.ts';
import type { Action, Incoming } from '../../src/ports/ui.ts';
import { fakeUi, memoryStore, OWNERS, TESTER } from '../support/fakes.ts';
import { specProgramJson } from '../support/spec.ts';

type World = {
  store: ReturnType<typeof memoryStore>;
  ui: ReturnType<typeof fakeUi>;
  send: (input: Incoming) => Promise<void>;
  press: (action: Action) => Promise<void>;
  command: (name: string) => Promise<void>;
  type: (text: string) => Promise<void>;
  last: () => string;
};

function world(languageCode: string): World {
  const store = memoryStore();
  const ui = fakeUi();
  let n = 0;
  let updateId = 1;
  const deps: UpdateDeps = {
    store,
    ui,
    clock: { now: () => new Date('2026-09-30T22:40:00Z') },
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
      languageCode,
      person: TESTER,
      input,
    });
  const press = (action: Action): Promise<void> =>
    send({ kind: 'callback', action, stepNo: store.sessions.get(1)?.stepNo ?? -1 });
  const command = (name: string): Promise<void> => send({ kind: 'command', name, args: '' });
  const type = (text: string): Promise<void> => send({ kind: 'text', text });
  const last = (): string => ui.shown.at(-1)?.rendered.text ?? '';
  return { store, ui, send, press, command, type, last };
}

async function programStrings(): Promise<string[]> {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(await specProgramJson());
  return out.sort((a, b) => b.length - a.length);
}

const CYRILLIC = /[А-Яа-яЁё]/;

Deno.test('Telegram на английском: онбординг по-английски, меню команд с language', async () => {
  const w = world('en-US');
  await w.command('start');
  assert(w.last().startsWith('Hi! I log workouts'), w.last());
  assertEquals(w.ui.shown.at(-1)?.rendered.replyKeyboard, {
    kind: 'request_location',
    label: '📍 Send location',
  });
  await w.type('18:40');
  assertEquals(
    w.ui.shown.at(-1)?.rendered.keyboard.flat().map((b) => b.label).at(-1),
    'UTC−4 · no daylight saving',
  );
});

Deno.test('выбор языка в /settings важнее Telegram и сразу виден', async () => {
  const w = world('ru');
  w.store.settings.set(1, {
    ...defaultSettings(1),
    timezone: TimeZoneSchema.parse('America/New_York'),
  });
  await w.command('settings');
  assert(w.last().endsWith('Язык: Русский'), w.last());
  await w.press({ type: 'settings_section', section: 'language' });
  assertEquals(w.ui.shown.at(-1)?.rendered.keyboard.flat().map((b) => b.label), [
    '✓ Русский',
    'English',
    'Назад',
  ]);
  await w.press({ type: 'lang_set', language: 'en' });
  assertEquals(w.store.settings.get(1)?.language, 'en');
  assert(w.last().startsWith('✅ Saved\n\nSettings\nTime zone: UTC−4 · New York'), w.last());
  assert(w.last().endsWith('Language: English'), w.last());
  await w.press({ type: 'settings_close' });
  assert(w.last().startsWith('Time zone: UTC−4 · New York'), w.last());
});

Deno.test('английский: ни одного русского слова бота во всех сценариях, кроме текстов программы', async () => {
  const w = world('en');
  w.store.settings.set(1, {
    ...defaultSettings(1),
    timezone: TimeZoneSchema.parse('America/New_York'),
  });
  await w.send({
    kind: 'document',
    fileName: 'p.json',
    text: '{"schemaVersion": 1,',
    problem: null,
  });
  await w.send({
    kind: 'document',
    fileName: 'p.json',
    text: '{"schemaVersion": 2, "extra": 1}',
    problem: null,
  });
  await w.send({ kind: 'document', fileName: 'p.txt', text: null, problem: 'not_json' });
  await w.send({
    kind: 'document',
    fileName: 'p.json',
    text: JSON.stringify(await specProgramJson()),
    problem: null,
  });
  await w.command('program');
  await w.command('seed');
  await w.type('abc');
  await w.type('185x8');
  await w.press({ type: 'seed_stop' });
  await w.command('settings');
  for (const section of ['bar', 'plates', 'steps', 'language'] as const) {
    await w.press({ type: 'settings_section', section });
    await w.press({ type: 'settings_back' });
  }
  await w.press({ type: 'settings_section', section: 'bar' });
  await w.type('500');
  await w.press({ type: 'settings_close' });
  await w.command('workout');
  await w.press({ type: 'day_pick', dayId: 'tue' });
  await w.press({ type: 'menu_add' });
  await w.press({ type: 'back' });
  await w.press({ type: 'menu_pick', exerciseId: 'incline_press' });
  await w.type('abc');
  await w.type('195');
  await w.press({ type: 'warmup_diff' });
  await w.press({ type: 'warmup_mark', mark: 'done' });
  await w.press({ type: 'warmup_mark', mark: 'edit' });
  await w.type('x');
  await w.press({ type: 'back' });
  await w.press({ type: 'back' });
  await w.press({ type: 'warmup', variant: 'full' });
  await w.press({ type: 'warmup_comment' });
  await w.type('tired');
  await w.press({ type: 'reps_set', reps: 6 });
  await w.press({ type: 'reps_set', reps: 7 });
  await w.press({ type: 'back' });
  await w.press({ type: 'set_edit' });
  await w.type('x');
  await w.type('8');
  await w.press({ type: 'back' });
  await w.press({ type: 'set_delete' });
  await w.command('undo');
  await w.type('x');
  await w.press({ type: 'reps_set', reps: 7 });
  await w.press({ type: 'comment' });
  await w.type('ok');
  await w.press({ type: 'exercise_finish' });
  await w.press({ type: 'menu_pick', exerciseId: 'abs' });
  await w.type('20');
  await w.press({ type: 'exercise_finish' });
  await w.press({ type: 'comment' });
  await w.type('menu comment');
  await w.press({ type: 'workout_finish' });
  await w.press({ type: 'comment' });
  await w.type('slept well');
  await w.press({ type: 'workout_done' });
  await w.command('workout');
  await w.press({ type: 'day_pick', dayId: 'fri' });
  await w.press({ type: 'menu_pick', exerciseId: 'pullups' });
  await w.type('0');
  await w.command('workout');
  await w.command('cancel');
  await w.press({ type: 'cancel_answer', confirm: true });
  await w.command('cancel');
  await w.command('stats');
  await w.command('undo');
  await w.command('history');
  const done = [...w.store.workouts.values()].find((x) => x.status !== 'in_progress');
  await w.press({ type: 'history_workout', id: done?.id ?? '' });
  const log = w.store.logs.find((l) => l.workoutId === done?.id && l.status === 'done');
  await w.press({ type: 'history_log', id: log?.id ?? '' });
  const first = w.store.sets.find((x) => x.exerciseLogId === log?.id && x.kind === 'work');
  await w.press({ type: 'history_set', id: first?.id ?? '' });
  await w.type('?');
  await w.type('5');
  await w.press({ type: 'history_add' });
  await w.press({ type: 'back' });
  await w.press({ type: 'back' });
  await w.press({ type: 'history_delete' });
  await w.press({ type: 'history_confirm', confirm: true });

  const known = [...(await programStrings()), 'Русский'];
  const leaks = w.ui.shown.flatMap((s) => {
    const parts = [s.rendered.text, ...s.rendered.keyboard.flat().map((b) => b.label)];
    return parts.map((p) => known.reduce((acc, k) => acc.replaceAll(k, ''), p))
      .filter((p) => CYRILLIC.test(p));
  });
  assertEquals(leaks, []);
  assert(w.ui.shown.length >= 40, `сценарий прошёл ${w.ui.shown.length} экранов`);
});
