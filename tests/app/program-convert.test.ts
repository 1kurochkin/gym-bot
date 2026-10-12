import { assert, assertEquals } from '@std/assert';
import { dirname, join, resolve } from '@std/path';
import type { Incoming } from '../../src/ports/ui.ts';
import { answer, down, scriptedLlm } from '../support/llm.ts';
import { type World, world } from '../support/world.ts';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const { draft } = JSON.parse(
  await Deno.readTextFile(join(ROOT, 'tests/fixtures/program-draft.json')),
);
const program: Incoming = { kind: 'command', name: 'program', args: '' };
const lines = (w: World): string[] => w.last().split('\n');
const active = (w: World) => {
  const id = w.store.settings.get(1)?.activeProgramId;
  return id ? w.store.programs.get(id) : undefined;
};

async function convert(w: World, text = 'Понедельник: присед 3х5…'): Promise<void> {
  await w.send(program);
  await w.press({ type: 'program_text' });
  await w.type(text);
}

Deno.test('программа из текста: кнопка только при настроенной LLM', async () => {
  const off = await world();
  await off.send(program);
  assertEquals(off.buttons(), ['📅 Дни и упражнения', '🆕 Составить программу', '🗄 В архив']);
  const on = await world({ llm: scriptedLlm() });
  await on.send(program);
  assertEquals(on.buttons(), [
    '📅 Дни и упражнения',
    '🆕 Составить программу',
    '📝 Программа из текста',
    '🗄 В архив',
  ]);
});

Deno.test('программа из текста: ожидание → предпросмотр → «Сохранить» → редактор', async () => {
  const llm = scriptedLlm(answer(draft));
  const w = await world({ llm });
  await w.send(program);
  await w.press({ type: 'program_text' });
  assert(w.last().startsWith('Пришли программу текстом одним сообщением'), w.last());
  assert(w.last().includes('Жим лёжа (штанга) 3×8–10\nПодтягивания (свой вес) 3×6–8'), 'пример');
  assert(w.last().includes('Тип в скобках'), 'подсказка про тип');
  await w.type('Понедельник: присед 3х5, тяга в наклоне 3х8-10…');
  assertEquals(w.last(), '⏳ Разбираю программу… Обычно это занимает до 30 секунд.');
  assertEquals(w.buttons(), []);
  await w.settle();
  assertEquals(llm.requests[0]?.user, 'Понедельник: присед 3х5, тяга в наклоне 3х8-10…');
  assertEquals(lines(w), [
    'Вот что получилось: «Фулбади, 3 дня» — 3 дня, 6 упражнений. Дни: Понедельник, ' +
    'Подтягивания с весом, Пятница.',
    '',
    'Понедельник',
    '1. Присед — 3×5',
    '2. Тяга в наклоне — 3×8–10',
    '3. Пресс — 3 подхода',
    '',
    'Подтягивания с весом',
    '1. Подтягивания с весом — 3×6–8',
    '2. Жим гантелей сидя — 3–20×8–12',
    '',
    'Пятница',
    '1. Присед — 3×5',
    '2. Шея — 2×15',
    '',
    'Не понял — добавь вручную в редакторе:',
    '• Отдых между подходами 2-3 минуты.',
    '',
    'Программа добавится и станет текущей; в работе останутся: «6 базовых, 5 дней».',
  ]);
  assertEquals(w.buttons(), ['💾 Сохранить', 'Отмена']);
  assertEquals(active(w)?.program.id, 'base6-5d', 'до «Сохранить» ничего не записано');
  await w.press({ type: 'program_confirm' });
  assertEquals(lines(w), ['✅ Сохранено', 'Фулбади, 3 дня', 'Дни программы:']);
  assertEquals(active(w)?.program.id, 'custom');
  assertEquals(w.store.llmCalls.map((c) => [c.kind, c.ok, c.provider]), [[
    'program',
    true,
    'fake',
  ]]);
});

Deno.test('программа из текста: «Отмена» — программа прежняя', async () => {
  const w = await world({ llm: scriptedLlm(answer(draft)) });
  await convert(w);
  await w.settle();
  await w.press({ type: 'program_cancel' });
  assertEquals(w.last(), 'Отменено. Текущая программа осталась.');
  assertEquals(active(w)?.program.id, 'base6-5d');
});

Deno.test('программа из текста: ушёл с экрана ожидания — результат отбрасывается', async () => {
  const w = await world({ llm: scriptedLlm(answer(draft)) });
  await convert(w);
  await w.send(program);
  const shown = w.ui.shown.length;
  await w.settle();
  assertEquals(w.ui.shown.length, shown);
  assert(w.last().startsWith('Текущая программа:'));
});

Deno.test('программа из текста: LLM недоступна — сообщение и повтор', async () => {
  const w = await world({ llm: scriptedLlm(down) });
  await convert(w);
  await w.settle();
  assertEquals(
    w.last(),
    'Нейросеть сейчас недоступна. Попробуй позже, пришли JSON или составь программу кнопками.',
  );
  assertEquals(w.buttons(), ['📝 Программа из текста']);
  assertEquals(w.store.llmCalls.map((c) => c.ok), [false]);
});

Deno.test('программа из текста: дневной лимит — у участника, не у владельца', async () => {
  const llm = scriptedLlm(answer(draft));
  const w = await world({ llm, llmDailyLimit: 1, owner: false });
  w.store.llmCalls.push({
    userId: 1,
    at: new Date('2026-09-30T12:00:00Z'),
    kind: 'program',
    ok: true,
    provider: 'fake',
    model: 'fake',
    ms: 1,
    promptTokens: null,
    completionTokens: null,
  });
  await convert(w);
  assertEquals(
    w.last(),
    'Лимит разборов программы за сутки исчерпан. Попробуй завтра или составь программу кнопками.',
  );
  await w.settle();
  assertEquals(llm.requests.length, 0);
  w.setNow('2026-10-01T13:00:00Z');
  await convert(w);
  await w.settle();
  assert(w.last().startsWith('Вот что получилось'), 'прошли сутки');
});
