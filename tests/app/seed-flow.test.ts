import { assert, assertEquals } from '@std/assert';
import { handleUpdate, type UpdateDeps } from '../../src/app/handle-update.ts';
import { TimeZoneSchema } from '../../src/core/schedule/timezone.ts';
import { defaultSettings } from '../../src/core/settings/settings.ts';
import type { Incoming } from '../../src/ports/ui.ts';
import { fakeUi, memoryStore, OWNERS, TESTER } from '../support/fakes.ts';
import { specProgramJson } from '../support/spec.ts';

/** US-6 (.specs/product.md): /seed через весь цикл апдейта, на программе владельца из спеки. */

async function setup(opts: { program?: boolean; timezone?: boolean } = {}): Promise<{
  deps: UpdateDeps;
  store: ReturnType<typeof memoryStore>;
  ui: ReturnType<typeof fakeUi>;
  send: (input: Incoming, messageId?: number) => Promise<void>;
}> {
  const store = memoryStore();
  const ui = fakeUi();
  let n = 0;
  let updateId = 1;
  const deps: UpdateDeps = {
    store,
    ui,
    // 30.09 22:40 UTC = 18:40 в Нью-Йорке
    clock: { now: () => new Date('2026-09-30T22:40:00Z') },
    zoneAt: () => Promise.resolve(null),
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    owners: OWNERS,
    botUsername: () => 'gym_test_bot',
  };
  const send = (input: Incoming, messageId: number | null = null): Promise<void> =>
    handleUpdate(deps, {
      updateId: updateId++,
      userId: 1,
      chatId: 1,
      messageId,
      languageCode: 'ru',
      person: TESTER,
      input,
    });
  if (opts.timezone !== false) {
    store.settings.set(1, {
      ...defaultSettings(1),
      timezone: TimeZoneSchema.parse('America/New_York'),
    });
  }
  if (opts.program !== false) {
    const text = JSON.stringify(await specProgramJson());
    await send({ kind: 'document', fileName: 'p.json', text, problem: null });
  }
  return { deps, store, ui, send };
}

const lastText = (ui: ReturnType<typeof fakeUi>): string => ui.shown.at(-1)?.rendered.text ?? '';
const buttons = (ui: ReturnType<typeof fakeUi>): string[] =>
  ui.shown.at(-1)?.rendered.keyboard.flat().map((b) => b.label) ?? [];
const press = (
  store: ReturnType<typeof memoryStore>,
  type: 'seed_next' | 'seed_stop',
): Incoming => ({
  kind: 'callback',
  action: { type },
  stepNo: store.sessions.get(1)?.stepNo ?? -1,
});
const command = (name: string): Incoming => ({ kind: 'command', name, args: '' });
const text = (value: string): Incoming => ({ kind: 'text', text: value });

Deno.test('/seed идёт по упражнениям в порядке дней, без пресса, каждое один раз', async () => {
  const { store, ui, send } = await setup();
  await send(command('seed'));
  assert(lastText(ui).startsWith('Фронтальный присед (1/9)'), lastText(ui));
  assertEquals(buttons(ui), ['Нет данных', 'Закончить']);

  const names: string[] = [];
  for (let i = 0; i < 9; i++) {
    names.push(lastText(ui).split(' (')[0] ?? '');
    await send(press(store, 'seed_next'), 10);
  }
  assertEquals(names, [
    'Фронтальный присед',
    'Икры стоя',
    'Жим на наклонной',
    'Шея: сгибания',
    'Шея: разгибания',
    'Мёртвая тяга',
    'Брусья узким хватом',
    'Подтягивания',
    'Тяга штанги в наклоне',
  ]);
  assertEquals(lastText(ui), 'Ничего не записал. Вернуться можно в любой момент: /seed');
  assertEquals(store.manual, []);
});

Deno.test('ввод результата: запись сразу, с датой, шагом и комментарием; дальше — следующее', async () => {
  const { store, ui, send } = await setup();
  await send(command('seed'));
  await send(text('185/8 последний тяжело'));
  assertEquals(store.manual, [{
    exerciseId: 'front_squat',
    exerciseName: 'Фронтальный присед',
    weightLb: 185,
    reps: 8,
    comment: 'последний тяжело',
    localDate: '2026-09-30',
    stepLbUsed: 10,
  }] as unknown);
  assert(lastText(ui).startsWith('Икры стоя (2/9)'));
  await send(press(store, 'seed_stop'), 10);
  assertEquals(lastText(ui), 'Готово: записал 1 из 9. Это будет «прошлым разом» на тренировке.');
});

Deno.test('одного числа мало: без предложенного веса нужен вес и повторения', async () => {
  const { store, ui, send } = await setup();
  await send(command('seed'));
  await send(text('8'));
  assert(lastText(ui).includes('⚠️ Нужен вес и повторения, например 185x8.'), lastText(ui));
  assert(lastText(ui).startsWith('Фронтальный присед (1/9)'), 'остаёмся на том же упражнении');
  assertEquals(store.manual.length, 0);
});

Deno.test('допвес: подсказка «+25x8», 0 — свой вес', async () => {
  const { store, ui, send } = await setup();
  await send(command('seed'));
  for (let i = 0; i < 6; i++) await send(press(store, 'seed_next'), 10);
  assert(lastText(ui).startsWith('Брусья узким хватом (7/9)'));
  assert(lastText(ui).includes('+25x8 или 0x8 — свой вес'));
  await send(text('+25x8'));
  assertEquals(store.manual.at(-1)?.weightLb, 25);
  assertEquals(store.manual.at(-1)?.stepLbUsed, 5, 'шаг допвеса — наименьший блин');
});

Deno.test('повторный /seed показывает «Сейчас» и кнопку «Оставить»', async () => {
  const { store, ui, send } = await setup();
  await send(command('seed'));
  await send(text('185x8'));
  await send(command('seed'));
  assertEquals(lastText(ui).split('\n').slice(0, 2), [
    'Фронтальный присед (1/9)',
    'Сейчас: 185 × 8 (30.09)',
  ]);
  assertEquals(buttons(ui), ['Оставить', 'Закончить']);
  await send(press(store, 'seed_next'), 10);
  assertEquals(store.manual.length, 1, '«Оставить» ничего не пишет');
});

Deno.test('/seed без программы и без часового пояса', async () => {
  const noProgram = await setup({ program: false });
  await noProgram.send(command('seed'));
  assertEquals(lastText(noProgram.ui), 'Сначала загрузи программу: /program');

  const noZone = await setup({ timezone: false });
  await noZone.send(command('seed'));
  assert(lastText(noZone.ui).startsWith('Привет!'), 'сначала онбординг часового пояса');
});

Deno.test('неизвестная команда — подсказка со списком, шаг не сбрасывается', async () => {
  const { store, ui, send } = await setup();
  await send(command('seed'));
  await send(command('stats'));
  assertEquals(
    lastText(ui),
    'Не знаю команду /stats. Доступно:\n/workout — Начать или продолжить тренировку\n' +
      '/cancel — Прервать тренировку\n/start — Главный экран\n' +
      '/program — Загрузить или показать программу\n/seed — Ввести последние рабочие результаты\n' +
      '/settings — Часовой пояс, гриф, блины, шаг веса, язык\n' +
      '/invite — Пригласить нового пользователя\n/users — Пользователи бота, отключить доступ',
  );
  assertEquals(store.sessions.get(1)?.step, 'seed');
  await send(text('185x8'));
  assertEquals(store.manual.length, 1, 'ввод /seed продолжается');
});
