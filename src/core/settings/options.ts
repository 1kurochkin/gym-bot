import { z } from 'zod';
import { type Lb, lb } from '../units/lb.ts';

export const BAR_OPTIONS_LB: readonly Lb[] = [45, 35, 33].map(lb);
export const PLATE_OPTIONS_LB: readonly Lb[] = [2.5, 5, 10, 15, 25, 35, 45, 55].map(lb);
export const STEP_OPTIONS_LB: readonly Lb[] = [1, 2.5, 5, 10].map(lb);

export const BAR_RANGE_LB = { min: 5, max: 100 } as const;
export const STEP_RANGE_LB = { min: 0.5, max: 50 } as const;

export const SettingsSectionSchema = z.enum(['timezone', 'bar', 'plates', 'steps', 'language']);
export type SettingsSection = z.infer<typeof SettingsSectionSchema>;

export const StepSourceSchema = z.enum(['override', 'program', 'default']);
export type StepSource = z.infer<typeof StepSourceSchema>;
