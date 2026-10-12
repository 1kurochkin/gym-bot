import { type StepSource, StepSourceSchema } from '../settings/options.ts';
import type { Settings } from '../settings/settings.ts';
import { type Lb, lb } from '../units/lb.ts';
import type { WeightGrid } from '../units/weight-grid.ts';
import { type Exercise, LoadTypeSchema } from './schema.ts';

export const overrideKey = (programKey: string, exerciseId: string): string =>
  `${programKey}/${exerciseId}`;

export const stepOverride = (
  settings: Settings,
  programKey: string,
  exerciseId: string,
): Lb | undefined =>
  settings.exerciseOverrides[overrideKey(programKey, exerciseId)]?.stepLb ??
    settings.exerciseOverrides[exerciseId]?.stepLb;

export function weightStep(exercise: Exercise, settings: Settings, programKey: string): Lb | null {
  if (exercise.loadType === LoadTypeSchema.enum.reps_only) return null;
  return stepOverride(settings, programKey, exercise.id) ?? exercise.stepLb ??
    defaultStep(exercise, settings);
}

export function weightStepWithSource(
  exercise: Exercise,
  settings: Settings,
  programKey: string,
): { stepLb: Lb; source: StepSource } | null {
  if (exercise.loadType === LoadTypeSchema.enum.reps_only) return null;
  const override = stepOverride(settings, programKey, exercise.id);
  if (override !== undefined) return { stepLb: override, source: StepSourceSchema.enum.override };
  if (exercise.stepLb !== undefined) {
    return { stepLb: exercise.stepLb, source: StepSourceSchema.enum.program };
  }
  return { stepLb: defaultStep(exercise, settings), source: StepSourceSchema.enum.default };
}

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

export function weightGrid(
  exercise: Exercise,
  settings: Settings,
  programKey: string,
): WeightGrid | null {
  if (
    exercise.loadType === LoadTypeSchema.enum.barbell &&
    !stepOverride(settings, programKey, exercise.id)
  ) {
    return { kind: 'plates', barLb: settings.barWeightLb, platesLb: settings.platesLb };
  }
  const step = weightStep(exercise, settings, programKey);
  return step === null ? null : { kind: 'step', stepLb: step };
}
