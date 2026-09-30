import { assertEquals } from '@std/assert';
import { parseSetInput, type SetInputContext } from '../../../src/core/input/set-input.ts';
import { lb } from '../../../src/core/units/lb.ts';

const barbell180: SetInputContext = { loadType: 'barbell', suggestedLb: lb(180) };
const parse = (text: string, ctx: SetInputContext = barbell180): unknown => {
  const r = parseSetInput(text, ctx);
  return r.ok ? [r.value.weightLb, r.value.reps, r.value.weightSource, r.value.comment] : r.error;
};

Deno.test('бот предложил 180 × 6–8: одно число — повторения с этим весом', () => {
  assertEquals(parse('7'), [180, 7, 'suggested', null]);
  assertEquals(parse('  7  '), [180, 7, 'suggested', null]);
  assertEquals(parse('x7'), [180, 7, 'suggested', null]);
  assertEquals(parse('х 7'), [180, 7, 'suggested', null], 'кириллическая х');
});

Deno.test('свой вес и повторения — записывается именно он', () => {
  assertEquals(parse('185x6'), [185, 6, 'entered', null]);
  assertEquals(parse('185 х 6'), [185, 6, 'entered', null]);
  assertEquals(parse('185×6'), [185, 6, 'entered', null]);
  assertEquals(parse('185*6'), [185, 6, 'entered', null]);
  assertEquals(parse('185 6'), [185, 6, 'entered', null]);
  assertEquals(parse('182,5x7'), [182.5, 7, 'entered', null]);
  assertEquals(parse('182.5x7'), [182.5, 7, 'entered', null]);
});

Deno.test('текст после чисел — комментарий', () => {
  assertEquals(parse('7 последний тяжело'), [180, 7, 'suggested', 'последний тяжело']);
  assertEquals(parse('185x6 плечо ок'), [185, 6, 'entered', 'плечо ок']);
  assertEquals(parse('185 6 хорошо'), [185, 6, 'entered', 'хорошо'], '«х» в комментарии не мешает');
});

Deno.test('допвес: со знаком + или без, 0 — свой вес', () => {
  const dips: SetInputContext = { loadType: 'weighted_bodyweight', suggestedLb: lb(25) };
  assertEquals(parse('8', dips), [25, 8, 'suggested', null]);
  assertEquals(parse('+30x6', dips), [30, 6, 'entered', null]);
  assertEquals(parse('30x6', dips), [30, 6, 'entered', null]);
  assertEquals(parse('0x12', dips), [0, 12, 'entered', null]);
});

Deno.test('пресс (reps_only): только повторения', () => {
  const abs: SetInputContext = { loadType: 'reps_only', suggestedLb: null };
  assertEquals(parse('20', abs), [null, 20, 'none', null]);
  assertEquals(parse('x20', abs), [null, 20, 'none', null]);
  assertEquals(parse('25x20', abs), 'weight_not_allowed');
});

Deno.test('нет предложенного веса — одного числа мало', () => {
  const noHistory: SetInputContext = { loadType: 'barbell', suggestedLb: null };
  assertEquals(parse('7', noHistory), 'weight_required');
  assertEquals(parse('185x6', noHistory), [185, 6, 'entered', null]);
});

Deno.test('вес без повторений и ошибки', () => {
  assertEquals(parse('+25'), 'reps_required');
  assertEquals(parse('182,5'), 'reps_required');
  assertEquals(parse('185'), 'reps_required', 'одно число больше 100 — это вес');
  assertEquals(parse('185x0'), 'reps_out_of_range');
  assertEquals(parse('185x101'), 'reps_out_of_range');
  assertEquals(parse('2000x5'), 'weight_out_of_range');
  assertEquals(parse(''), 'empty');
  assertEquals(parse('   '), 'empty');
  assertEquals(parse('тяжело'), 'not_recognized');
  assertEquals(parse('185x6плечо'), 'not_recognized');
});
