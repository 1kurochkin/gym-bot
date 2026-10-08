import { assert, assertEquals } from '@std/assert';
import { handleUpdate, type UpdateDeps } from '../../src/app/handle-update.ts';
import type { Incoming, IncomingUpdate } from '../../src/ports/ui.ts';
import { fakeUi, memoryStore, OWNERS, TESTER } from '../support/fakes.ts';
import { specProgramJson } from '../support/spec.ts';

function setup(): {
  deps: UpdateDeps;
  store: ReturnType<typeof memoryStore>;
  ui: ReturnType<typeof fakeUi>;
} {
  const store = memoryStore();
  const ui = fakeUi();
  let n = 0;
  const deps: UpdateDeps = {
    store,
    ui,
    clock: { now: () => new Date('2026-09-30T22:40:00Z') },
    zoneAt: () => Promise.resolve(null),
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    owners: OWNERS,
    botUsername: () => 'gym_test_bot',
  };
  return { deps, store, ui };
}

let nextId = 1000;
const send = (deps: UpdateDeps, input: Incoming, messageId: number | null = null): Promise<void> =>
  handleUpdate(
    deps,
    {
      updateId: nextId++,
      userId: 1,
      chatId: 1,
      messageId,
      languageCode: 'ru',
      person: TESTER,
      input,
    } satisfies IncomingUpdate,
  );

const programText = async (
  edit: (p: Record<string, unknown>) => void = () => {},
): Promise<string> => {
  const p = structuredClone(await specProgramJson()) as Record<string, unknown>;
  edit(p);
  return JSON.stringify(p, null, 2);
};
const file = (text: string): Incoming => ({
  kind: 'document',
  fileName: 'program.json',
  text,
  problem: null,
});
const lastText = (ui: ReturnType<typeof fakeUi>): string => ui.shown.at(-1)?.rendered.text ?? '';
const stepNo = (store: ReturnType<typeof memoryStore>): number =>
  store.sessions.get(1)?.stepNo ?? -1;
const versions = (store: ReturnType<typeof memoryStore>): [number, boolean][] =>
  [...store.programs.values()].map((p) => [p.version, p.active]);

Deno.test('/program без программы — просит прислать JSON файлом', async () => {
  const { deps, ui } = setup();
  await send(deps, { kind: 'command', name: 'program', args: '' });
  assert(lastText(ui).startsWith('Программы пока нет.'));
});

Deno.test('первая программа файлом сохраняется сразу; сводка; предложение /seed', async () => {
  const { deps, store, ui } = setup();
  await send(deps, file(await programText()));
  assertEquals(versions(store), [[1, true]]);
  assertEquals(
    lastText(ui),
    'Программа сохранена: «6 базовых, 5 дней» — 5 дней, 10 упражнений. Дни: Фронтальный присед, ' +
      'Жим на наклонной, Мёртвая тяга, Брусья, Подтягивания + тяга.\n\nДальше — стартовые веса: /seed',
  );
  assertEquals(store.settings.get(1)?.activeProgramId, [...store.programs.keys()][0]);
});

Deno.test('та же программа повторно — «не изменилась», новой версии нет', async () => {
  const { deps, store, ui } = setup();
  await send(deps, file(await programText()));
  await send(deps, file(await programText()));
  assertEquals(lastText(ui), 'Программа не изменилась — ничего не сохранял.');
  assertEquals(versions(store), [[1, true]]);
});

Deno.test('замена: подтверждение кнопкой, старая архивируется, версия растёт', async () => {
  const { deps, store, ui } = setup();
  await send(deps, file(await programText()));
  await send(deps, file(await programText((p) => (p.name = '6 базовых, v2'))));

  assertEquals(versions(store), [[1, true]], 'до подтверждения ничего не сохранено');
  const confirm = ui.shown.at(-1)?.rendered;
  assert(confirm?.text.includes('«6 базовых, 5 дней» будет архивирована, история сохранится'));
  assertEquals(confirm?.keyboard.map((row) => row.map((b) => b.label)), [['Заменить'], ['Отмена']]);

  await send(
    deps,
    { kind: 'callback', action: { type: 'program_confirm' }, stepNo: stepNo(store) },
    7,
  );
  assertEquals(versions(store), [[1, false], [2, true]]);
  assert(lastText(ui).startsWith('Программа сохранена: «6 базовых, v2»'));
});

Deno.test('отмена замены: текущая остаётся, старая кнопка «Заменить» больше не работает', async () => {
  const { deps, store, ui } = setup();
  await send(deps, file(await programText()));
  await send(deps, file(await programText((p) => (p.name = 'другая'))));
  const confirmStep = stepNo(store);
  await send(
    deps,
    { kind: 'callback', action: { type: 'program_cancel' }, stepNo: confirmStep },
    7,
  );
  assertEquals(lastText(ui), 'Отменено. Текущая программа осталась.');

  await send(
    deps,
    { kind: 'callback', action: { type: 'program_confirm' }, stepNo: confirmStep },
    7,
  );
  assertEquals(versions(store), [[1, true]]);
  assertEquals(ui.dropped, [7], 'у устаревшей кнопки убрана клавиатура');
});

Deno.test('ошибки программы — списком с путями, не больше 10', async () => {
  const { deps, store, ui } = setup();
  await send(
    deps,
    file(
      await programText((p) => {
        const days = p.days as { exercises: Record<string, unknown>[] }[];
        for (const day of days) for (const e of day.exercises) e.extra = 1;
      }),
    ),
  );
  const text = lastText(ui);
  assert(text.startsWith('Программа не принята — 14 ошибок:'), text);
  assert(text.includes('• days[0].exercises[0]: '));
  assert(text.includes('…и ещё 4'));
  assertEquals(versions(store), []);
});

Deno.test('битый JSON — понятная ошибка', async () => {
  const { deps, ui } = setup();
  await send(deps, file('{"schemaVersion": 1,'));
  assert(lastText(ui).includes('• (JSON): не получилось прочитать JSON'));
});

Deno.test('текстом — после /program; в обычном режиме текст программой не считается', async () => {
  const { deps, store } = setup();
  const compact = JSON.stringify(await specProgramJson());
  await send(deps, { kind: 'text', text: compact });
  assertEquals(versions(store), [], 'без /program JSON в чате не сохраняется');

  await send(deps, { kind: 'command', name: 'program', args: '' });
  await send(deps, { kind: 'text', text: compact });
  assertEquals(versions(store), [[1, true]]);
});

Deno.test('файл не .json и слишком большой файл', async () => {
  const { deps, ui } = setup();
  await send(deps, { kind: 'document', fileName: 'program.txt', text: null, problem: 'not_json' });
  assert(lastText(ui).startsWith('Нужен файл .json.'));
  await send(deps, { kind: 'document', fileName: 'big.json', text: null, problem: 'too_large' });
  assert(lastText(ui).startsWith('Файл больше 100 КБ'));
});

Deno.test('главный экран показывает активную программу', async () => {
  const { deps, store, ui } = setup();
  store.settings.set(1, { ...(await deps.store.load(1)).settings, timezone: null });
  await send(deps, file(await programText()));
  await send(deps, { kind: 'command', name: 'start', args: '' });
  assert(lastText(ui).startsWith('Привет!'), 'без часового пояса — сначала онбординг');
  await send(deps, { kind: 'text', text: 'Europe/Moscow' });
  assert(
    lastText(ui).includes('Программа: «6 базовых, 5 дней».\n\nНачать тренировку — /workout'),
    lastText(ui),
  );
});
