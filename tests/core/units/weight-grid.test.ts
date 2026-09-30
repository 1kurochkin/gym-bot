import { assertEquals } from '@std/assert';
import { lb } from '../../../src/core/units/lb.ts';
import {
  barbellWeights,
  nextAbove,
  perSide,
  roundToGrid,
  unachievable,
  type WeightGrid,
} from '../../../src/core/units/weight-grid.ts';

const plates = (list: number[]): WeightGrid => ({
  kind: 'plates',
  barLb: lb(45),
  platesLb: list.map(lb),
});
const standard = plates([5, 10, 25, 35, 45]);
const withSmall = plates([2.5, 5, 10, 25, 35, 45]);
const step5: WeightGrid = { kind: 'step', stepLb: lb(5) };

Deno.test('собираемые веса: блины 5–45 → 45 + 10·k, с 2,5 → 45 + 5·k', () => {
  assertEquals(
    barbellWeights(lb(45), standard.kind === 'plates' ? standard.platesLb : []).slice(0, 4),
    [45, 55, 65, 75],
  );
  assertEquals(
    barbellWeights(lb(45), withSmall.kind === 'plates' ? withSmall.platesLb : []).slice(0, 4),
    [45, 50, 55, 60],
  );
  assertEquals(barbellWeights(lb(45), [lb(25)]).slice(0, 3), [45, 95, 145], 'только блины 25');
});

Deno.test('округление к ближайшему, при равенстве вниз, не ниже грифа', () => {
  assertEquals(roundToGrid(standard, 87.75), 85);
  assertEquals(roundToGrid(standard, 90), 85, 'равенство 85/95 → вниз');
  assertEquals(roundToGrid(standard, 202.5), 205);
  assertEquals(roundToGrid(standard, 20), 45, 'пустой гриф');
  assertEquals(roundToGrid(withSmall, 87.75), 90);
});

Deno.test('шаг тренажёра: ближайшее кратное, при равенстве вниз, не ниже шага', () => {
  assertEquals(roundToGrid(step5, 67.5), 65);
  assertEquals(roundToGrid(step5, 34), 35);
  assertEquals(roundToGrid(step5, 12), 10);
  assertEquals(roundToGrid(step5, 1), 5, 'нижний предел — один шаг');
  assertEquals(roundToGrid({ kind: 'step', stepLb: lb(2.5) }, 6.4), 7.5);
});

Deno.test('следующий вес выше и вес на сторону', () => {
  assertEquals(nextAbove(standard, 95), 105);
  assertEquals(nextAbove(standard, 99.75), 105);
  assertEquals(nextAbove(step5, 40), 45);
  assertEquals(perSide(standard, lb(205)), 80);
  assertEquals(perSide(withSmall, lb(90)), 22.5);
  assertEquals(perSide(step5, lb(90)), null);
});

Deno.test('несобираемый рабочий вес: 190 без блинов 2,5 → ближайшие 185 / 195', () => {
  assertEquals(unachievable(standard, 190), { lower: lb(185), upper: lb(195) });
  assertEquals(unachievable(standard, 195), null);
  assertEquals(unachievable(withSmall, 190), null);
});
