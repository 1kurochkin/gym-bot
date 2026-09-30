import { parseLbNumber } from '../input/set-input.ts';
import { exerciseIndex } from '../program/program.ts';
import { type Exercise, LoadTypeSchema } from '../program/schema.ts';
import { barbellStep, weightStepWithSource } from '../program/weight-step.ts';
import { formatZoneLabel } from '../schedule/timezone.ts';
import {
  BAR_RANGE_LB,
  PLATE_OPTIONS_LB,
  type SettingsSection,
  SettingsSectionSchema,
  STEP_RANGE_LB,
  type StepSource,
} from '../settings/options.ts';
import type { Settings } from '../settings/settings.ts';
import { type Lb, lb } from '../units/lb.ts';
import { home, moveTo, unchanged, withEffects } from './flow.ts';
import { type Session, SessionStepSchema, type StepContext, type StepResult } from './types.ts';

/** /settings — US-8 (.specs/product.md). */

const S = SessionStepSchema.enum;
const SECTION = SettingsSectionSchema.enum;

/** Экран настроек; `settings` — уже с изменениями, если они только что сохранены. */
export function settingsMenu(
  state: Session,
  ctx: StepContext,
  settings: Settings,
  saved: boolean,
): StepResult {
  return moveTo(state, S.settings, {
    type: 'settings_menu',
    timezoneLabel: settings.timezone ? formatZoneLabel(settings.timezone, ctx.now) : null,
    barLb: settings.barWeightLb,
    platesLb: settings.platesLb,
    barStepLb: barbellStep(settings),
    overrides: Object.values(settings.exerciseOverrides).filter((o) =>
      o.stepLb !== undefined
    ).length,
    saved,
  });
}

/** Сохранить и вернуться к экрану настроек с отметкой «Сохранено». */
const save = (state: Session, ctx: StepContext, settings: Settings): StepResult =>
  withEffects(settingsMenu(state, ctx, settings, true), [{ type: 'save_settings', settings }]);

export const openSettings = (state: Session, ctx: StepContext): StepResult =>
  settingsMenu(state, ctx, ctx.settings, false);

export function openSection(
  state: Session,
  ctx: StepContext,
  section: SettingsSection,
): StepResult {
  if (!isSettings(state)) return unchanged(state);
  switch (section) {
    case SECTION.timezone:
      return moveTo(state, S.onboarding_tz, { type: 'ask_time', error: null }, {
        kind: 'settings_return',
      });
    case SECTION.bar:
      return barScreen(state, ctx.settings.barWeightLb, false);
    case SECTION.plates:
      return platesScreen(state, ctx.settings.platesLb, false);
    case SECTION.steps:
      return stepsScreen(state, ctx);
  }
}

export function backToSettings(state: Session, ctx: StepContext): StepResult {
  return isSettings(state) ? settingsMenu(state, ctx, ctx.settings, false) : unchanged(state);
}

export function closeSettings(state: Session, ctx: StepContext): StepResult {
  if (!isSettings(state)) return unchanged(state);
  const zone = ctx.settings.timezone;
  return zone
    ? home(state, zone, ctx)
    : moveTo(state, S.onboarding_tz, { type: 'ask_time', error: null });
}

// ---------------------------------------------------------------- гриф

const barScreen = (state: Session, currentLb: Lb, invalid: boolean): StepResult =>
  moveTo(state, S.settings_bar, { type: 'settings_bar', currentLb, invalid });

export function chooseBar(state: Session, ctx: StepContext, value: number): StepResult {
  if (state.step !== S.settings_bar) return unchanged(state);
  if (!(value >= BAR_RANGE_LB.min && value <= BAR_RANGE_LB.max)) {
    return barScreen(state, ctx.settings.barWeightLb, true);
  }
  return save(state, ctx, { ...ctx.settings, barWeightLb: lb(value) });
}

// ---------------------------------------------------------------- блины

const platesScreen = (state: Session, selected: readonly Lb[], empty: boolean): StepResult =>
  moveTo(
    state,
    S.settings_plates,
    { type: 'settings_plates', options: PLATE_OPTIONS_LB, selected, empty },
    { kind: 'plates', selected },
  );

export function togglePlate(state: Session, plate: Lb): StepResult {
  const c = state.context;
  if (state.step !== S.settings_plates || c.kind !== 'plates') return unchanged(state);
  const selected = c.selected.includes(plate)
    ? c.selected.filter((p) => p !== plate)
    : [...c.selected, plate].sort((a, b) => a - b);
  return platesScreen(state, selected, false);
}

export function savePlates(state: Session, ctx: StepContext): StepResult {
  const c = state.context;
  if (state.step !== S.settings_plates || c.kind !== 'plates') return unchanged(state);
  if (c.selected.length === 0) return platesScreen(state, c.selected, true);
  return save(state, ctx, { ...ctx.settings, platesLb: c.selected });
}

// ---------------------------------------------------------------- шаг по упражнениям

/** Упражнения активной программы с весом, кроме штанги: у неё шаг задают блины. */
type StepItem = { readonly exercise: Exercise; readonly stepLb: Lb; readonly source: StepSource };

function stepExercises(ctx: StepContext): StepItem[] {
  if (!ctx.activeProgram) return [];
  return [...exerciseIndex(ctx.activeProgram).values()].flatMap((e) => {
    if (e.loadType === LoadTypeSchema.enum.barbell) return [];
    const step = weightStepWithSource(e, ctx.settings);
    return step ? [{ exercise: e, ...step }] : [];
  });
}

function stepsScreen(state: Session, ctx: StepContext): StepResult {
  if (!ctx.activeProgram) return moveTo(state, S.settings, { type: 'needs_program' });
  return moveTo(state, S.settings_steps, {
    type: 'settings_steps',
    items: stepExercises(ctx).map((i) => ({
      exerciseId: i.exercise.id,
      name: i.exercise.name,
      stepLb: i.stepLb,
      source: i.source,
    })),
  });
}

export function pickStepExercise(state: Session, ctx: StepContext, exerciseId: string): StepResult {
  if (state.step !== S.settings_steps) return unchanged(state);
  return stepEditScreen(state, ctx, exerciseId, false);
}

function stepEditScreen(
  state: Session,
  ctx: StepContext,
  exerciseId: string,
  invalid: boolean,
): StepResult {
  const item = stepExercises(ctx).find((i) => i.exercise.id === exerciseId);
  if (!item) return stepsScreen(state, ctx);
  return moveTo(
    state,
    S.settings_step_edit,
    {
      type: 'settings_step_edit',
      name: item.exercise.name,
      stepLb: item.stepLb,
      source: item.source,
      invalid,
    },
    { kind: 'step_edit', exerciseId },
  );
}

/** Новый шаг (кнопкой или числом) или null — убрать переопределение. */
export function setStep(state: Session, ctx: StepContext, value: number | null): StepResult {
  const c = state.context;
  if (state.step !== S.settings_step_edit || c.kind !== 'step_edit') return unchanged(state);
  if (value !== null && !(value >= STEP_RANGE_LB.min && value <= STEP_RANGE_LB.max)) {
    return stepEditScreen(state, ctx, c.exerciseId, true);
  }
  const { [c.exerciseId]: _removed, ...rest } = ctx.settings.exerciseOverrides;
  const overrides = value === null ? rest : { ...rest, [c.exerciseId]: { stepLb: lb(value) } };
  const settings = { ...ctx.settings, exerciseOverrides: overrides };
  const result = stepsScreen(state, { ...ctx, settings });
  return withEffects(result, [{ type: 'save_settings', settings }]);
}

/** Число, введённое текстом в разделе «Гриф» или «Шаг». */
export function settingsText(state: Session, ctx: StepContext, text: string): StepResult {
  const value = parseLbNumber(text) ?? Number.NaN;
  if (state.step === S.settings_bar) return chooseBar(state, ctx, value);
  if (state.step === S.settings_step_edit) return setStep(state, ctx, value);
  return settingsMenu(state, ctx, ctx.settings, false);
}

const SETTINGS_STEPS: ReadonlySet<string> = new Set([
  S.settings,
  S.settings_bar,
  S.settings_plates,
  S.settings_steps,
  S.settings_step_edit,
]);
const isSettings = (state: Session): boolean => SETTINGS_STEPS.has(state.step);
