import { assert, assertEquals } from '@std/assert';
import {
  addableToDay,
  addFromProgram,
  addNewExercise,
  canRemove,
  nextExerciseId,
  parseExerciseName,
  parseGoal,
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
  assertEquals(parseExerciseName('  Жим гантелей  '), 'Жим гантелей');
  assertEquals(parseExerciseName('   '), null);
  assertEquals(parseExerciseName('x'.repeat(60))?.length, 60);
  assertEquals(parseExerciseName('x'.repeat(61)), null);
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
