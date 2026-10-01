import { type StepSource, StepSourceSchema } from '../settings/options.ts';
import type { Settings } from '../settings/settings.ts';
import { type Lb, lb } from '../units/lb.ts';
import type { WeightGrid } from '../units/weight-grid.ts';
import { type Exercise, LoadTypeSchema } from './schema.ts';

/**
 * Шаг веса упражнения (.specs/program-format.md → «Шаг веса»): переопределение в /settings →
 * stepLb в программе → умолчание для loadType. Штанга: наименьший блин с двух сторон.
 */
export function weightStep(exercise: Exercise, settings: Settings): Lb | null {
  if (exercise.loadType === LoadTypeSchema.enum.reps_only) return null;
  return settings.exerciseOverrides[exercise.id]?.stepLb ?? exercise.stepLb ??
    defaultStep(exercise, settings);
}

/** Шаг и его источник — для экрана /settings. */
export function weightStepWithSource(
  exercise: Exercise,
  settings: Settings,
): { stepLb: Lb; source: StepSource } | null {
  if (exercise.loadType === LoadTypeSchema.enum.reps_only) return null;
  const override = settings.exerciseOverrides[exercise.id]?.stepLb;
  if (override !== undefined) return { stepLb: override, source: StepSourceSchema.enum.override };
  if (exercise.stepLb !== undefined) {
    return { stepLb: exercise.stepLb, source: StepSourceSchema.enum.program };
  }
  return { stepLb: defaultStep(exercise, settings), source: StepSourceSchema.enum.default };
}

/** Шаг штанги по блинам: наименьший блин с двух сторон. */
export const barbellStep = (settings: Settings): Lb => lb(Math.min(...settings.platesLb) * 2);

function defaultStep(exercise: Exercise, settings: Settings): Lb {
  const smallest = Math.min(...settings.platesLb);
  switch (exercise.loadType) {
    case LoadTypeSchema.enum.barbell:
      return lb(smallest * 2);
    case LoadTypeSchema.enum.weighted_bodyweight:
      return lb(smallest);
    case LoadTypeSchema.enum.machine:
      return lb(5);
    default:
      return lb(2.5);
  }
}

/** Сетка весов упражнения: штанга — по блинам, остальное — по шагу; без веса — null. */
export function weightGrid(exercise: Exercise, settings: Settings): WeightGrid | null {
  if (
    exercise.loadType === LoadTypeSchema.enum.barbell &&
    !settings.exerciseOverrides[exercise.id]?.stepLb
  ) {
    return { kind: 'plates', barLb: settings.barWeightLb, platesLb: settings.platesLb };
  }
  const step = weightStep(exercise, settings);
  return step === null ? null : { kind: 'step', stepLb: step };
}
