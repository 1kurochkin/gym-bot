import { assert, assertEquals } from '@std/assert';
import type { Incoming } from '../../src/ports/ui.ts';
import { specProgramJson } from '../support/spec.ts';
import { answer, scriptedLlm } from '../support/llm.ts';
import { workout, type World, world } from '../support/world.ts';

const program: Incoming = { kind: 'command', name: 'program', args: '' };
const inWork = (w: World): string[] =>
  [...w.store.programs.values()].filter((p) => p.active).map((p) => p.program.name);
const current = (w: World) => {
  const id = w.store.settings.get(1)?.activeProgramId;
  return id ? w.store.programs.get(id)?.program : undefined;
};

async function addSecond(w: World): Promise<void> {
  const json = structuredClone(await specProgramJson()) as Record<string, unknown>;
  json.id = 'push-pull';
  json.name = 'Тяни-толкай';
  await w.send({ kind: 'document', fileName: 'p.json', text: JSON.stringify(json), problem: null });
}

async function benchOnTuesday(w: World, weight: string): Promise<void> {
  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'tue' });
  await w.press({ type: 'menu_pick', exerciseId: 'incline_press' });
  await w.type(weight);
  await w.press({ type: 'warmup', variant: 'none' });
  await w.type('7');
  await w.press({ type: 'exercise_finish' });
  await w.press({ type: 'workout_finish' });
  await w.press({ type: 'workout_done' });
}

async function pickProgram(w: World, name: string): Promise<void> {
  await w.press({ type: 'program_switch' });
  const id = [...w.store.programs.entries()].find(([, p]) => p.active && p.program.name === name)
    ?.[0];
  assert(id, name);
  await w.press({ type: 'program_switch_pick', programId: id });
}

Deno.test('вторая программа добавляется, первая остаётся в работе; /program показывает обе', async () => {
  const w = await world();
  await addSecond(w);
  assertEquals(inWork(w), ['6 базовых, 5 дней', 'Тяни-толкай']);
  assertEquals(current(w)?.name, 'Тяни-толкай');
  await w.send(program);
  assert(w.last().includes('В работе ещё: «6 базовых, 5 дней».'), w.last());
  assertEquals(w.buttons(), [
    '📅 Дни и упражнения',
    '🆕 Составить программу',
    '🔄 Другая программа',
    '🗄 В архив',
  ]);
});

Deno.test('/workout: программа над днями, «Другая программа» → её дни; «прошлый раз» по программе', async () => {
  const w = await world();
  await benchOnTuesday(w, '195');
  await addSecond(w);
  w.setNow('2026-10-02T22:40:00Z');
  await w.send(workout);
  assertEquals(w.last(), 'Программа: «Тяни-толкай»\nВыбери день:');
  assertEquals(w.buttons()[0], '▶ Фронтальный присед', 'в новой программе тренировок не было');
  assertEquals(w.buttons().at(-2), '🔄 Другая программа');
  await w.press({ type: 'program_switch' });
  assertEquals(w.last(), 'Какую программу выбрать?');
  assertEquals(w.buttons(), ['✓ Тяни-толкай', '6 базовых, 5 дней', '← Назад']);
  await w.press({ type: 'back' });
  assertEquals(w.last(), 'Программа: «Тяни-толкай»\nВыбери день:');

  await w.press({ type: 'day_pick', dayId: 'tue' });
  await w.press({ type: 'menu_pick', exerciseId: 'incline_press' });
  assert(!w.last().includes('Прошлый раз'), 'id упражнения тот же, но программа другая');
  await w.send({ kind: 'command', name: 'cancel', args: '' });
  await w.press({ type: 'cancel_answer', confirm: true });

  await w.send(workout);
  await pickProgram(w, '6 базовых, 5 дней');
  assertEquals(w.ui.shown.at(-1)?.messageId, 9, 'тот же экран, а не новое сообщение');
  assertEquals(current(w)?.name, '6 базовых, 5 дней');
  assert(
    w.last().startsWith('Программа: «6 базовых, 5 дней»\nПрошлая тренировка: Ср, 30.09'),
    w.last(),
  );
  assertEquals(w.buttons()[0], '▶ Мёртвая тяга', 'следующий день — по своей программе');
  await w.press({ type: 'day_pick', dayId: 'tue' });
  await w.press({ type: 'menu_pick', exerciseId: 'incline_press' });
  assert(w.last().includes('Прошлый раз (30.09): 195 × 7'), w.last());
});

Deno.test('архив — с подтверждением; текущей становится оставшаяся; во время тренировки нельзя', async () => {
  const w = await world();
  await addSecond(w);
  await w.send(program);
  await w.press({ type: 'program_archive' });
  assertEquals(
    w.last(),
    'Отправить «Тяни-толкай» в архив? История тренировок сохранится, программа пропадёт из выбора.',
  );
  await w.press({ type: 'program_archive_answer', confirm: false });
  assertEquals(inWork(w).length, 2);
  await w.press({ type: 'program_archive' });
  await w.press({ type: 'program_archive_answer', confirm: true });
  assertEquals(inWork(w), ['6 базовых, 5 дней']);
  assertEquals(current(w)?.name, '6 базовых, 5 дней');
  assert(
    w.last().startsWith('✅ «Тяни-толкай» в архиве.\nТекущая программа: «6 базовых'),
    w.last(),
  );
  assert(!w.buttons().includes('🔄 Другая программа'), 'осталась одна');

  await w.send(workout);
  await w.press({ type: 'day_pick', dayId: 'tue' });
  await w.send(program);
  assert(!w.buttons().includes('🗄 В архив'), 'идёт тренировка');
});

Deno.test('«Составить программу» при существующей — добавляется с новым id', async () => {
  const w = await world();
  for (const name of ['Фулбади', 'Сплит']) {
    await w.send(program);
    await w.press({ type: 'editor_create' });
    await w.type(name);
    await w.type('День А');
    await w.press({ type: 'editor_new' });
    await w.type('Присед');
    await w.press({ type: 'editor_type', loadType: 'barbell' });
    await w.type('3×5');
  }
  assertEquals(inWork(w), ['6 базовых, 5 дней', 'Фулбади', 'Сплит']);
  assertEquals(current(w)?.id, 'custom_2');
});

Deno.test('«Программа из текста» получает свободный id и не заменяет программы', async () => {
  const draft = {
    name: 'Из текста',
    days: [{
      name: 'Пн',
      exercises: [{
        name: 'Присед',
        type: 'barbell',
        setsMin: 3,
        setsMax: 3,
        repsMin: 5,
        repsMax: 5,
        note: null,
      }],
    }],
    unparsed: [],
  };
  const w = await world({ llm: scriptedLlm(answer(draft), answer(draft)) });
  for (let i = 0; i < 2; i++) {
    await w.send(program);
    await w.press({ type: 'program_text' });
    await w.type('Пн: присед 3х5');
    await w.settle();
    await w.press({ type: 'program_confirm' });
  }
  assertEquals(inWork(w).length, 3);
  assertEquals(current(w)?.id, 'custom_2');
});
