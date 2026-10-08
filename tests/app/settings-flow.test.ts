import { assert, assertEquals } from '@std/assert';
import { handleUpdate, type UpdateDeps } from '../../src/app/handle-update.ts';
import { TimeZoneSchema } from '../../src/core/schedule/timezone.ts';
import { defaultSettings } from '../../src/core/settings/settings.ts';
import { lb } from '../../src/core/units/lb.ts';
import type { Action, Incoming } from '../../src/ports/ui.ts';
import { fakeUi, memoryStore, OWNERS, TESTER } from '../support/fakes.ts';
import { specProgramJson } from '../support/spec.ts';

async function setup(): Promise<{
  store: ReturnType<typeof memoryStore>;
  ui: ReturnType<typeof fakeUi>;
  send: (input: Incoming) => Promise<void>;
  press: (action: Action) => Promise<void>;
}> {
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
      messageId: 5,
      languageCode: 'ru',
      person: TESTER,
      input,
    });
  const press = (action: Action): Promise<void> =>
    send({ kind: 'callback', action, stepNo: store.sessions.get(1)?.stepNo ?? -1 });
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
  await send({ kind: 'command', name: 'settings', args: '' });
  return { store, ui, send, press };
}

const lastText = (ui: ReturnType<typeof fakeUi>): string => ui.shown.at(-1)?.rendered.text ?? '';
const labels = (ui: ReturnType<typeof fakeUi>): string[][] =>
  ui.shown.at(-1)?.rendered.keyboard.map((row) => row.map((b) => b.label)) ?? [];
const text = (value: string): Incoming => ({ kind: 'text', text: value });

Deno.test('экран настроек: текущие значения и разделы', async () => {
  const { ui } = await setup();
  assertEquals(
    lastText(ui),
    'Настройки\nЧасовой пояс: UTC−4 · New York\nГриф: 45 lb\n' +
      'Блины: 5, 10, 25, 35, 45 lb → шаг штанги 10 lb\nШаг по упражнениям: по умолчанию\n' +
      'Язык: Русский',
  );
  assertEquals(labels(ui), [
    ['Часовой пояс'],
    ['Гриф'],
    ['Блины'],
    ['Шаг по упражнениям'],
    ['Язык'],
    ['Готово'],
  ]);
});

Deno.test('гриф: кнопкой и числом; вне диапазона — повторный вопрос', async () => {
  const { store, ui, press, send } = await setup();
  await press({ type: 'settings_section', section: 'bar' });
  assertEquals(labels(ui)[0], ['✓ 45', '35', '33 (15 кг)']);
  await press({ type: 'bar_set', lb: lb(35) });
  assertEquals(store.settings.get(1)?.barWeightLb, 35);
  assert(lastText(ui).startsWith('✅ Сохранено\n\nНастройки'), lastText(ui));
  assert(lastText(ui).includes('Гриф: 35 lb'));

  await press({ type: 'settings_section', section: 'bar' });
  await send(text('200'));
  assert(lastText(ui).startsWith('⚠️ Нужно число от 5 до 100.'));
  await send(text('44,1 lb'));
  assertEquals(store.settings.get(1)?.barWeightLb, 44.1);
});

Deno.test('блины: переключатели, сохранение, пересчёт шага штанги; пустой набор нельзя', async () => {
  const { store, ui, press } = await setup();
  await press({ type: 'settings_section', section: 'plates' });
  assertEquals(labels(ui)[0], ['2,5', '✓ 5', '✓ 10', '15']);
  await press({ type: 'plate_toggle', lb: lb(2.5) });
  assertEquals(labels(ui)[0], ['✓ 2,5', '✓ 5', '✓ 10', '15']);
  assertEquals(
    store.settings.get(1)?.platesLb,
    [5, 10, 25, 35, 45].map(lb),
    'до «Сохранить» не записано',
  );
  await press({ type: 'plates_save' });
  assertEquals(store.settings.get(1)?.platesLb, [2.5, 5, 10, 25, 35, 45].map(lb));
  assert(lastText(ui).includes('Блины: 2,5, 5, 10, 25, 35, 45 lb → шаг штанги 5 lb'), lastText(ui));

  await press({ type: 'settings_section', section: 'plates' });
  for (const p of [2.5, 5, 10, 25, 35, 45]) await press({ type: 'plate_toggle', lb: lb(p) });
  await press({ type: 'plates_save' });
  assert(lastText(ui).startsWith('⚠️ Нужен хотя бы один блин.'));
  assertEquals(store.settings.get(1)?.platesLb.length, 6);
});

Deno.test('шаг по упражнениям: без штанги и пресса; переопределение и сброс', async () => {
  const { store, ui, press, send } = await setup();
  await press({ type: 'settings_section', section: 'steps' });
  assertEquals(labels(ui).flat(), [
    'Икры стоя — 5 lb (по умолчанию)',
    'Шея: сгибания — 2,5 lb (по умолчанию)',
    'Шея: разгибания — 2,5 lb (по умолчанию)',
    'Брусья узким хватом — 5 lb (по умолчанию)',
    'Подтягивания — 5 lb (по умолчанию)',
    'Назад',
  ]);
  await press({ type: 'step_pick', exerciseId: 'calves' });
  assertEquals(labels(ui), [['1', '2,5', '✓ 5', '10'], ['Назад']]);
  await send(text('7.5'));
  assertEquals(store.settings.get(1)?.exerciseOverrides, { calves: { stepLb: 7.5 } } as unknown);
  assertEquals(labels(ui)[0], ['Икры стоя — 7,5 lb']);

  await press({ type: 'step_pick', exerciseId: 'calves' });
  assertEquals(labels(ui).slice(1), [['По умолчанию'], ['Назад']]);
  await press({ type: 'step_reset' });
  assertEquals(store.settings.get(1)?.exerciseOverrides, {});
});

Deno.test('часовой пояс из настроек: после сохранения — снова настройки', async () => {
  const { store, ui, press, send } = await setup();
  await press({ type: 'settings_section', section: 'timezone' });
  assert(lastText(ui).includes('Сколько у тебя сейчас времени?'));
  await send(text('Europe/Moscow'));
  assertEquals(store.settings.get(1)?.timezone, 'Europe/Moscow');
  assert(
    lastText(ui).startsWith('✅ Сохранено\n\nНастройки\nЧасовой пояс: UTC+3 · Moscow'),
    lastText(ui),
  );
  assertEquals(store.sessions.get(1)?.step, 'settings');
});

Deno.test('часовой пояс из настроек через выбор зоны кнопкой', async () => {
  const { store, ui, press, send } = await setup();
  await press({ type: 'settings_section', section: 'timezone' });
  await send(text('18:40'));
  assertEquals(store.sessions.get(1)?.step, 'onboarding_tz_pick');
  await press({ type: 'tz', zone: TimeZoneSchema.parse('America/Toronto') });
  assert(lastText(ui).includes('Часовой пояс: UTC−4 · Toronto'), lastText(ui));
  assertEquals(store.sessions.get(1)?.step, 'settings');
});

Deno.test('«Назад» — без изменений; «Готово» — главный экран', async () => {
  const { store, ui, press } = await setup();
  await press({ type: 'settings_section', section: 'plates' });
  await press({ type: 'plate_toggle', lb: lb(2.5) });
  await press({ type: 'settings_back' });
  assertEquals(store.settings.get(1)?.platesLb, [5, 10, 25, 35, 45].map(lb));
  assert(lastText(ui).startsWith('Настройки'));
  await press({ type: 'settings_close' });
  assert(
    lastText(ui).startsWith('Часовой пояс: UTC−4 · New York\n\nПрограмма: «6 базовых, 5 дней».'),
  );
  assertEquals(store.sessions.get(1)?.step, 'idle');
});
