import { z } from 'zod';
import { type Lb, lb } from '../units/lb.ts';

/** Варианты кнопок /settings (.specs/product.md → US-8). */
export const BAR_OPTIONS_LB: readonly Lb[] = [45, 35, 33].map(lb);
export const PLATE_OPTIONS_LB: readonly Lb[] = [2.5, 5, 10, 15, 25, 35, 45, 55].map(lb);
export const STEP_OPTIONS_LB: readonly Lb[] = [1, 2.5, 5, 10].map(lb);

/** Границы ручного ввода. */
export const BAR_RANGE_LB = { min: 5, max: 100 } as const;
export const STEP_RANGE_LB = { min: 0.5, max: 50 } as const;

export const SettingsSectionSchema = z.enum(['timezone', 'bar', 'plates', 'steps', 'language']);
export type SettingsSection = z.infer<typeof SettingsSectionSchema>;

/** Откуда шаг упражнения: переопределение в /settings, stepLb программы или умолчание. */
export const StepSourceSchema = z.enum(['override', 'program', 'default']);
export type StepSource = z.infer<typeof StepSourceSchema>;
