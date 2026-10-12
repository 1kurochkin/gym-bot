import { assert, assertEquals } from '@std/assert';
import { TimeZoneSchema } from '../../src/core/schedule/timezone.ts';
import { defaultSettings } from '../../src/core/settings/settings.ts';
import type { Incoming } from '../../src/ports/ui.ts';
import { scriptedLlm } from '../support/llm.ts';
import { world } from '../support/world.ts';

const command = (name: string): Incoming => ({ kind: 'command', name, args: '' });
const NEW_YORK = TimeZoneSchema.parse('America/New_York');

Deno.test('новый пользователь: после часового пояса — главный экран с инструкцией', async () => {
  const w = await world({ program: false, owner: false });
  w.store.settings.set(1, defaultSettings(1));
  await w.send(command('start'));
  await w.press({ type: 'tz', zone: NEW_YORK });
  assertEquals(w.last().split('\n\n'), [
    'Часовой пояс: UTC−4 · New York',
    'Программы ещё нет — /program: составить кнопками, из текста или файлом .json.',
    '🌐 Язык / Language: /settings → Язык / Language',
    'Как пользоваться',
    '1️⃣ Программа — /program\n' +
    '• 🆕 Составить программу — дни и упражнения кнопками\n' +
    '• или пришли файл .json\n' +
    'Потом её можно править: /program → 📅 Дни и упражнения.\n' +
    'Программ может быть несколько: новая добавляется к остальным, ' +
    'переключиться — /program → 🔄 Другая программа.',
    '2️⃣ Стартовые веса — /seed (можно пропустить): последние рабочие веса, ' +
    'чтобы бот сразу их предлагал.',
    '3️⃣ Тренировка — /workout\n' +
    'День → упражнение → рабочий вес → разминку бот посчитает сам → после каждого подхода ' +
    'нажми число повторений. «🏁 Завершить упражнение» — обратно в меню дня, ' +
    '«🏁 Завершить тренировку» — сводка.\n' +
    'Ошибся — «← Назад» или /undo. Прервать тренировку — /cancel.',
    '4️⃣ История — /history: посмотреть, исправить или удалить прошлые подходы.',
    '5️⃣ Настройки — /settings: язык, часовой пояс, вес грифа, набор блинов, шаг веса.',
    'Веса — в фунтах (lb). Все команды — в меню рядом с полем ввода. Эта подсказка — /help.',
  ]);
  await w.send(command('start'));
  assertEquals(w.last().split('\n\n').at(-1), 'Как пользоваться — /help', 'дальше — только ссылка');
});

Deno.test('/help: с LLM — «Программа из текста», у владельца — свой блок', async () => {
  const w = await world({ llm: scriptedLlm() });
  await w.send(command('help'));
  assert(w.last().includes('• 📝 Программа из текста — пришли программу'), w.last());
  assert(w.last().includes('👑 Для владельца: /invite'), w.last());
  const member = await world({ owner: false });
  await member.send(command('help'));
  assert(!member.last().includes('👑'));
  assert(!member.last().includes('📝'));
});

Deno.test('/help на английском и посреди сценария: шаг не сбрасывается', async () => {
  const w = await world();
  await w.send(command('settings'));
  await w.press({ type: 'settings_section', section: 'language' });
  await w.press({ type: 'lang_set', language: 'en' });
  await w.send(command('seed'));
  const step = w.store.sessions.get(1)?.step;
  await w.send(command('help'));
  assert(w.last().startsWith('🌐 Язык / Language: /settings → Язык / Language\n\nHow to use'));
  assertEquals(w.store.sessions.get(1)?.step, step);
});
