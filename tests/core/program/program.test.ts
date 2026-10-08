import { assertEquals } from '@std/assert';
import { dayExercises, parseProgram } from '../../../src/core/program/program.ts';
import { LanguageSchema } from '../../../src/core/settings/settings.ts';
import { issueText } from '../../../src/features/program/messages.ts';
import { specProgramJson } from '../../support/spec.ts';

// deno-lint-ignore no-explicit-any
type AnyJson = any;

async function variant(edit: (p: AnyJson) => void): Promise<unknown> {
  const p: AnyJson = structuredClone(await specProgramJson());
  edit(p);
  return p;
}
const messages = (r: ReturnType<typeof parseProgram>): string[] =>
  r.ok ? [] : r.error.map((i) => issueText(i, LanguageSchema.enum.ru));

Deno.test('программа владельца из спецификации валидна', async () => {
  const r = parseProgram(await specProgramJson());
  assertEquals(messages(r), []);
});

Deno.test('ссылки ref раскрываются в описание упражнения; значения по умолчанию', async () => {
  const r = parseProgram(await specProgramJson());
  if (!r.ok) throw new Error('invalid');
  const thu = dayExercises(r.value, 'thu');
  assertEquals(thu.map((e) => e.id), ['dips', 'calves', 'neck_flex', 'neck_ext']);
  assertEquals(thu[1]?.loadType, 'machine', 'calves из понедельника');
  assertEquals(thu[1]?.isBase, false, 'isBase по умолчанию false');
  assertEquals(r.value.fixedSchemes['calves']?.steps.length, 2);
});

Deno.test('ошибка поля — с путём и по-русски', async () => {
  const r = parseProgram(await variant((p) => delete p.days[2].exercises[0].repRange.min));
  assertEquals(messages(r), ['days[2].exercises[0].repRange.min: обязательное поле']);
});

Deno.test('ошибки на языке пользователя: путь тот же, пояснение переведено', async () => {
  const r = parseProgram(
    await variant((p) => {
      delete p.days[2].exercises[0].repRange.min;
      p.days[0].exercises[0].repRang = 1;
      p.days[1].exercises[0].loadType = 'kettlebell';
    }),
  );
  const en = r.ok ? [] : r.error.map((i) => issueText(i, LanguageSchema.enum.en));
  assertEquals(en, [
    'days[0].exercises[0]: unknown field: repRang',
    'days[1].exercises[0].loadType: allowed: "barbell", "weighted_bodyweight", "machine", ' +
    '"reps_only", "light_load"',
    'days[2].exercises[0].repRange.min: required field',
  ]);
  assertEquals(messages(r)[0], 'days[0].exercises[0]: неизвестное поле: repRang');
});

Deno.test('опечатка в ключе и неизвестный loadType', async () => {
  const typo = parseProgram(await variant((p) => (p.days[0].exercises[0].repRang = 1)));
  assertEquals(messages(typo).length, 1);
  assertEquals(messages(typo)[0]?.startsWith('days[0].exercises[0]: '), true);
  assertEquals(messages(typo)[0]?.includes('repRang'), true);

  const kind = parseProgram(await variant((p) => (p.days[0].exercises[0].loadType = 'kettlebell')));
  assertEquals(messages(kind)[0]?.startsWith('days[0].exercises[0].loadType: '), true);
});

Deno.test('ошибка в ссылке ref показывается как ошибка ссылки', async () => {
  const r = parseProgram(await variant((p) => (p.days[3].exercises[1].extra = 1)));
  assertEquals(messages(r).length, 1);
  assertEquals(messages(r)[0]?.startsWith('days[3].exercises[1]: '), true);
  assertEquals(messages(r)[0]?.includes('extra'), true);
});

Deno.test('min больше max', async () => {
  const r = parseProgram(
    await variant((p) => (p.days[0].exercises[0].repRange = { min: 9, max: 8 })),
  );
  assertEquals(messages(r), ['days[0].exercises[0].repRange.min: min больше max']);
});

Deno.test('перекрёстные ссылки: ref, rotation, схема разминки, пары, заметки', async () => {
  const r = parseProgram(
    await variant((p) => {
      p.days[3].exercises[1].id = 'calf_raise';
      p.rotation = ['mon', 'tue', 'wed', 'thu', 'sat'];
      p.days[0].exercises[1].warmup = 'calves_v2';
      p.intensityPairs[0].exercises = ['front_squat', 'rdl'];
      p.conditionalNotes[0].when.exercise = 'rdl';
    }),
  );
  assertEquals(messages(r), [
    'rotation[4]: нет дня «sat»',
    'rotation: день «fri» не входит в rotation',
    'days[0].exercises[1].warmup: нет схемы разминки «calves_v2» в fixedSchemes',
    'days[2].exercises[0].intensityGroup: упражнения «deadlift» нет в паре «sq_dl»',
    'days[3].exercises[1]: ссылка на неописанное упражнение «calf_raise»',
    'intensityPairs[0].exercises[1]: нет упражнения «rdl»',
    'conditionalNotes[0].when.exercise: нет упражнения «rdl»',
  ]);
});

Deno.test('повторное описание упражнения вместо ref', async () => {
  const r = parseProgram(
    await variant((p) => {
      p.days[3].exercises[1] = structuredClone(p.days[0].exercises[1]);
    }),
  );
  assertEquals(messages(r), [
    'days[3].exercises[1]: упражнение «calves» уже описано; для повтора — {"id": "calves", "ref": true}',
  ]);
});

Deno.test('ступени разминки: с нуля и по возрастанию; подписи подходов пресса', async () => {
  const r = parseProgram(
    await variant((p) => {
      p.warmupTiers.byWorkWeight[0].minLb = 10;
      p.warmupTiers.byWorkWeight[2].minLb = 100;
      p.days[1].exercises[1].setTargets = ['80%', 'отказ'];
    }),
  );
  assertEquals(messages(r), [
    'days[1].exercises[1].setTargets: подписей 2, а подходов до 3',
    'warmupTiers.byWorkWeight[0].minLb: первая ступень должна начинаться с 0',
    'warmupTiers.byWorkWeight[2].minLb: пороги ступеней должны возрастать',
  ]);
});
