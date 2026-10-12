import { assert, assertEquals } from '@std/assert';
import {
  addableToDay,
  addFromProgram,
  addNewExercise,
  BLANK_ADDED_TIERS,
  BLANK_WARMUP_TIERS,
  canRemove,
  changeGoal,
  createProgram,
  deleteDay,
  moveDay,
  moveExercise,
  nextDayId,
  nextExerciseId,
  parseGoal,
  parseName,
  removeFromDay,
  renameExercise,
} from '../../../src/core/program/edit.ts';
import { dayExercises, exerciseIndex } from '../../../src/core/program/program.ts';
import type { Program } from '../../../src/core/program/schema.ts';
import { specProgram } from '../../support/spec.ts';

const program = await specProgram();
const ids = (p: Program, dayId: string): string[] => dayExercises(p, dayId).map((e) => e.id);
const value = <T>(r: { ok: true; value: T } | { ok: false }): T => {
  if (!r.ok) throw new Error('ожидался ok');
  return r.value;
};

Deno.test('цель: подходы × повторения, диапазоны и разделители', () => {
  assertEquals(parseGoal('3×8–12', 'barbell'), {
    workSets: { min: 3, max: 3 },
    repRange: { min: 8, max: 12 },
  });
  assertEquals(parseGoal(' 2-3 x 6 ', 'machine'), {
    workSets: { min: 2, max: 3 },
    repRange: { min: 6, max: 6 },
  });
  assertEquals(parseGoal('1х10', 'weighted_bodyweight')?.repRange, { min: 10, max: 10 });
  assertEquals(parseGoal('3*5', 'barbell')?.workSets, { min: 3, max: 3 });
  for (const bad of ['3', '0×8', '3×0', '3×12–8', '21×5', '3×101', 'три по восемь', '']) {
    assertEquals(parseGoal(bad, 'barbell'), null, bad);
  }
  assertEquals(parseGoal('2–3', 'reps_only'), {
    workSets: { min: 2, max: 3 },
    repRange: null,
  });
  assertEquals(parseGoal('3×10', 'reps_only'), null);
});

Deno.test('название: обрезка, 1–60 символов', () => {
  assertEquals(parseName('  Жим гантелей  '), 'Жим гантелей');
  assertEquals(parseName('   '), null);
  assertEquals(parseName('x'.repeat(60))?.length, 60);
  assertEquals(parseName('x'.repeat(61)), null);
});

Deno.test('переименование меняет описание; ссылки в других днях видят новое имя', () => {
  const next = value(renameExercise(program, 'calves', 'Икры в Смите'));
  assertEquals(exerciseIndex(next).get('calves')?.name, 'Икры в Смите');
  assertEquals(dayExercises(next, 'thu').find((e) => e.id === 'calves')?.name, 'Икры в Смите');
});

Deno.test('новое упражнение: в конец дня, id ex_1, разминка по типу', () => {
  assertEquals(nextExerciseId(program), 'ex_1');
  const next = value(addNewExercise(program, 'tue', {
    name: 'Жим гантелей',
    loadType: 'machine',
    goal: { workSets: { min: 3, max: 3 }, repRange: { min: 8, max: 12 } },
  }));
  assertEquals(ids(next, 'tue').at(-1), 'ex_1');
  const added = exerciseIndex(next).get('ex_1');
  assertEquals(added?.warmup, null);
  assertEquals(added?.isBase, false);
  assertEquals(nextExerciseId(next), 'ex_2');

  const bar = value(addNewExercise(next, 'mon', {
    name: 'Присед',
    loadType: 'barbell',
    goal: { workSets: { min: 1, max: 1 }, repRange: { min: 5, max: 5 } },
  }));
  assertEquals(exerciseIndex(bar).get('ex_2')?.warmup, 'tiers');
});

Deno.test('из программы: ссылкой в конец дня, без повторов', () => {
  assert(!addableToDay(program, 'mon').some((e) => e.id === 'calves'));
  assertEquals(addableToDay(program, 'wed')[0]?.id, 'front_squat');
  const next = value(addFromProgram(program, 'wed', 'incline_press'));
  assertEquals(ids(next, 'wed'), ['deadlift', 'incline_press']);
  assertEquals(next.days.find((d) => d.id === 'wed')?.exercises.at(-1), {
    id: 'incline_press',
    ref: true,
  });
  assert(!addFromProgram(next, 'wed', 'incline_press').ok, 'уже в дне');
});

Deno.test('убрать из дня: описание переезжает в первый день со ссылкой', () => {
  const next = value(removeFromDay(program, 'mon', 'calves'));
  assertEquals(ids(next, 'mon'), ['front_squat']);
  assertEquals(ids(next, 'thu'), ['dips', 'calves', 'neck_flex', 'neck_ext']);
  assert(exerciseIndex(next).has('calves'));
});

Deno.test('убрать из последнего дня: уходит из программы вместе с заметками и парами', () => {
  const wed = value(addFromProgram(program, 'wed', 'incline_press'));
  const gone = value(removeFromDay(wed, 'wed', 'deadlift'));
  assertEquals(ids(gone, 'wed'), ['incline_press']);
  assert(!exerciseIndex(gone).has('deadlift'));
  assertEquals(gone.intensityPairs, []);
  assertEquals(gone.conditionalNotes, []);
  assertEquals(exerciseIndex(gone).get('front_squat')?.intensityGroup, undefined);
});

Deno.test('последнее упражнение дня не убирается', () => {
  assert(!canRemove(program, 'wed'));
  assert(!removeFromDay(program, 'wed', 'deadlift').ok);
  assert(canRemove(program, 'mon'));
});

Deno.test('удалить день: описания переезжают, упражнения только этого дня уходят с парами и заметками', () => {
  const p = value(deleteDay(program, 'mon'));
  assertEquals(p.rotation, ['tue', 'wed', 'thu', 'fri']);
  assert(!p.days.some((d) => d.id === 'mon'));
  assert(!exerciseIndex(p).has('front_squat'));
  assertEquals(exerciseIndex(p).get('calves')?.name, 'Икры стоя');
  assertEquals(ids(p, 'thu'), ['dips', 'calves', 'neck_flex', 'neck_ext']);
  assertEquals(p.intensityPairs, []);
  assertEquals(p.conditionalNotes.filter((n) => n.exercise === 'front_squat'), []);
  const one = { ...program, rotation: ['mon'], days: program.days.slice(0, 1) };
  assert(!deleteDay(one, 'mon').ok, 'единственный день');
  assert(!deleteDay(program, 'sun').ok);
});

Deno.test('цель: подписи подходов остаются, только если их столько же', () => {
  const abs = (p: Program) => exerciseIndex(p).get('abs');
  const three = value(changeGoal(program, 'abs', { workSets: { min: 2, max: 3 }, repRange: null }));
  const kept = abs(three);
  assertEquals(kept && 'setTargets' in kept ? kept.setTargets?.length : null, 3);
  const two = value(changeGoal(program, 'abs', { workSets: { min: 2, max: 2 }, repRange: null }));
  const dropped = abs(two);
  assertEquals(dropped && 'setTargets' in dropped ? dropped.setTargets : null, undefined);
});

Deno.test('порядок: соседи меняются местами, за край — нельзя', () => {
  assertEquals(value(moveDay(program, 'tue', 'up')).rotation.slice(0, 2), ['tue', 'mon']);
  assert(!moveDay(program, 'mon', 'up').ok);
  assert(!moveDay(program, 'fri', 'down').ok);
  assertEquals(ids(value(moveExercise(program, 'tue', 'abs', 'down')), 'tue'), [
    'incline_press',
    'neck_flex',
    'abs',
    'neck_ext',
  ]);
  assert(!moveExercise(program, 'wed', 'deadlift', 'down').ok);
});

Deno.test('программа с нуля: id custom, один день, разминочные таблицы — как в шаблоне спеки', () => {
  assertEquals(BLANK_WARMUP_TIERS, program.warmupTiers);
  assertEquals(BLANK_ADDED_TIERS, program.addedWeightTiers);
  const p = value(createProgram('Фулбади', 'День А', {
    name: 'Подтягивания',
    loadType: 'weighted_bodyweight',
    goal: { workSets: { min: 3, max: 3 }, repRange: { min: 5, max: 8 } },
  }));
  assertEquals([p.id, p.name, p.rotation], ['custom', 'Фулбади', ['day_1']]);
  assertEquals(ids(p, 'day_1'), ['ex_1']);
  assertEquals(nextDayId(p), 'day_2');
  assertEquals(nextDayId(program), 'day_1');
});
