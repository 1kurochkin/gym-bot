import { assertEquals } from '@std/assert';
import { step } from '../../../src/core/session/step.ts';
import {
  type BotEvent,
  initialSession,
  type Session,
  type View,
} from '../../../src/core/session/types.ts';
import { defaultSettings, type Settings } from '../../../src/core/settings/settings.ts';
import { parseTimeZone, type TimeZone } from '../../../src/core/schedule/timezone.ts';

const noWorkout = {
  activeWorkout: null,
  lastWorkout: null,
  isOwner: false,
  members: [],
  history: { page: null, workout: null },
  newIds: [],
};

/** 22:40 UTC = 18:40 в Нью-Йорке. */
const now = new Date('2026-09-28T22:40:00Z');
const zone = (name: string): TimeZone => {
  const r = parseTimeZone(name);
  if (!r.ok) throw new Error(name);
  return r.value;
};

/** Прогон последовательности событий: сценарии тестируются без Telegram. */
function run(
  events: BotEvent[],
  settings: Settings = defaultSettings(1),
  languageCode: string | null = 'en',
): { state: Session; settings: Settings; views: View[] } {
  let state = initialSession(1);
  let s = settings;
  const views: View[] = [];
  for (const ev of events) {
    const r = step(state, ev, {
      now,
      settings: s,
      languageCode,
      activeProgram: null,
      lastResults: {},
      ...noWorkout,
    });
    state = r.state;
    for (const e of r.effects) {
      if (e.type === 'save_settings') s = e.settings;
      if (e.type === 'render') views.push(e.view);
    }
  }
  return { state, settings: s, views };
}

Deno.test('первый /start спрашивает текущее время', () => {
  const r = run([{ type: 'start' }]);
  assertEquals(r.views, [{ type: 'ask_time', error: null }]);
  assertEquals(r.state.step, 'onboarding_tz');
});

Deno.test('время → кнопки зон с этим смещением → выбор кнопкой сохраняет IANA-зону', () => {
  const picked = run([{ type: 'start' }, { type: 'text_entered', text: '18:40' }]);
  const pick = picked.views[1];
  assertEquals(pick?.type === 'pick_zone' && pick.offsetLabel, 'UTC−4');
  assertEquals(pick?.type === 'pick_zone' && pick.options.map((o) => o.label), [
    { offset: 'UTC−4', city: 'New York' },
    { offset: 'UTC−4', city: 'Toronto' },
    { offset: 'UTC−4', city: 'Caracas' },
    { offset: 'UTC−4', city: null },
  ]);
  assertEquals(picked.state.step, 'onboarding_tz_pick');

  const done = run([
    { type: 'start' },
    { type: 'text_entered', text: '18:40' },
    { type: 'tz_chosen', zone: zone('America/New_York') },
  ]);
  assertEquals(done.settings.timezone, 'America/New_York');
  assertEquals(done.state.step, 'idle');
  assertEquals(done.views.at(-1), {
    type: 'home',
    zone: { offset: 'UTC−4', city: 'New York' },
    programName: null,
  });
});

Deno.test('единственный город с таким смещением сохраняется сразу', () => {
  const r = run([{ type: 'start' }, { type: 'text_entered', text: '4:25' }]);
  assertEquals(r.settings.timezone, 'Asia/Kathmandu');
  assertEquals(r.views.map((v) => v.type), ['ask_time', 'home']);
});

Deno.test('не время → повторный вопрос; на экране выбора можно ввести время заново', () => {
  const r = run([
    { type: 'start' },
    { type: 'text_entered', text: 'вечер' },
    { type: 'text_entered', text: '18:40' },
    { type: 'text_entered', text: '19:40' },
  ]);
  assertEquals(r.views.map((v) => v.type), ['ask_time', 'ask_time', 'pick_zone', 'pick_zone']);
  assertEquals(r.views[1], { type: 'ask_time', error: 'not_time' });
});

Deno.test('геопозиция: зона найдена → сохранена; не найдена → просим время', () => {
  const ok = run([{ type: 'start' }, { type: 'tz_located', zone: zone('Europe/Moscow') }]);
  assertEquals(ok.settings.timezone, 'Europe/Moscow');
  const miss = run([{ type: 'start' }, { type: 'tz_located', zone: null }]);
  assertEquals(miss.views.at(-1), { type: 'ask_time', error: 'location_unknown' });
  assertEquals(miss.settings.timezone, null);
});

Deno.test('IANA-имя вместо времени тоже принимается', () => {
  const r = run([{ type: 'start' }, { type: 'text_entered', text: 'Europe/Moscow' }]);
  assertEquals(r.settings.timezone, 'Europe/Moscow');
});

Deno.test('повторный /start после онбординга сразу показывает главный экран', () => {
  const r = run([{ type: 'start' }], { ...defaultSettings(1), timezone: zone('America/New_York') });
  assertEquals(r.views.map((v) => v.type), ['home']);
});

Deno.test('stepNo растёт с каждым экраном; выбор зоны вне онбординга игнорируется', () => {
  const ctx = {
    now,
    settings: defaultSettings(1),
    languageCode: null,
    activeProgram: null,
    lastResults: {},
    ...noWorkout,
  };
  assertEquals(step(initialSession(1), { type: 'start' }, ctx).state.stepNo, 1);
  const ignored = step(initialSession(1), { type: 'tz_chosen', zone: zone('Europe/Moscow') }, ctx);
  assertEquals(ignored, { state: initialSession(1), effects: [] });
});
