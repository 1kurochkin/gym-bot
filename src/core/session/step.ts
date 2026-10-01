import { assertNever } from '../../shared/result.ts';
import { home, unchanged } from './flow.ts';
import { askTime, isOnboarding, onTimeEntered, saveTimezone } from './onboarding.ts';
import {
  cancelProgram,
  confirmProgram,
  receiveProgram,
  rejectProgramFile,
  requestProgram,
} from './program.ts';
import { requestSeed, seedText, skipSeed, stopSeed } from './seed.ts';
import {
  answerCancel,
  chooseDay,
  chooseIntensity,
  chooseReps,
  chooseResume,
  chooseWeight,
  closeSummary,
  finishWarmup,
  moreSets,
  nextExercise,
  requestCancel,
  requestComment,
  requestWorkout,
  skipExercise,
  workoutText,
} from './workout.ts';
import {
  backToSettings,
  chooseBar,
  chooseLanguage,
  closeSettings,
  openSection,
  openSettings,
  pickStepExercise,
  savePlates,
  setStep,
  settingsText,
  togglePlate,
} from './settings.ts';
import {
  AskTimeErrorSchema,
  type BotEvent,
  type Session,
  SessionStepSchema,
  type StepContext,
  type StepResult,
} from './types.ts';

const S = SessionStepSchema.enum;
const { location_unknown } = AskTimeErrorSchema.enum;

/**
 * Автомат диалога: step(state, event, ctx) → { state, effects }. Чистая функция:
 * ничего не читает и не пишет сама, всё нужное приходит в ctx (docs/architecture.md §13.2).
 * Потоки диалога — в соседних модулях; здесь только диспетчер.
 */
export function step(state: Session, event: BotEvent, ctx: StepContext): StepResult {
  const result = transition(state, event, ctx);
  const renders = result.effects.some((e) => e.type === 'render');
  return renders ? { ...result, state: { ...result.state, stepNo: state.stepNo + 1 } } : result;
}

function transition(state: Session, event: BotEvent, ctx: StepContext): StepResult {
  switch (event.type) {
    case 'start':
      return ctx.settings.timezone === null
        ? askTime(state, null)
        : home(state, ctx.settings.timezone, ctx);
    case 'tz_chosen':
      return isOnboarding(state.step) ? saveTimezone(state, event.zone, ctx) : unchanged(state);
    case 'tz_located':
      if (!isOnboarding(state.step)) return unchanged(state);
      return event.zone ? saveTimezone(state, event.zone, ctx) : askTime(state, location_unknown);
    case 'text_entered':
      return onText(state, event.text, ctx);
    case 'program_requested':
      return requestProgram(state, ctx);
    case 'program_file':
      return receiveProgram(state, event.text, ctx);
    case 'program_file_rejected':
      return rejectProgramFile(state, event.reason);
    case 'program_confirmed':
      return confirmProgram(state);
    case 'program_cancelled':
      return state.step === S.program_confirm ? cancelProgram(state) : unchanged(state);
    case 'seed_requested':
      return requestSeed(state, ctx);
    case 'seed_next':
      return skipSeed(state, ctx);
    case 'seed_stopped':
      return stopSeed(state, ctx);
    case 'settings_requested':
      return openSettings(state, ctx);
    case 'settings_section':
      return openSection(state, ctx, event.section);
    case 'settings_back':
      return backToSettings(state, ctx);
    case 'settings_closed':
      return closeSettings(state, ctx);
    case 'bar_chosen':
      return chooseBar(state, ctx, event.lb);
    case 'plate_toggled':
      return togglePlate(state, event.lb);
    case 'plates_saved':
      return savePlates(state, ctx);
    case 'step_exercise_picked':
      return pickStepExercise(state, ctx, event.exerciseId);
    case 'step_chosen':
      return setStep(state, ctx, event.lb);
    case 'step_reset':
      return setStep(state, ctx, null);
    case 'language_chosen':
      return chooseLanguage(state, ctx, event.language);
    case 'workout_requested':
      return requestWorkout(state, ctx);
    case 'day_chosen':
      return chooseDay(state, ctx, event.dayId);
    case 'resume_chosen':
      return chooseResume(state, ctx, event.choice);
    case 'intensity_chosen':
      return chooseIntensity(state, ctx, event.intensity);
    case 'weight_chosen':
      return chooseWeight(state, ctx, event.lb);
    case 'warmup_done':
      return finishWarmup(state, ctx, event.variant);
    case 'reps_chosen':
      return chooseReps(state, ctx, event.reps);
    case 'set_more':
      return moreSets(state, ctx);
    case 'exercise_next':
      return nextExercise(state, ctx);
    case 'exercise_skip':
      return skipExercise(state, ctx);
    case 'comment_requested':
      return requestComment(state, ctx);
    case 'workout_done':
      return closeSummary(state, ctx);
    case 'cancel_requested':
      return requestCancel(state, ctx);
    case 'cancel_answered':
      return answerCancel(state, ctx, event.confirm);
    case 'unknown_command':
      // Подсказка поверх текущего шага: шаг и его данные не теряются.
      return {
        state,
        effects: [{ type: 'render', view: { type: 'unknown_command', name: event.name } }],
      };
    default:
      return assertNever(event);
  }
}

function onText(state: Session, text: string, ctx: StepContext): StepResult {
  switch (state.step) {
    case S.onboarding_tz:
    case S.onboarding_tz_pick:
      return onTimeEntered(state, text, ctx);
    case S.program_upload:
    case S.program_confirm:
      return receiveProgram(state, text, ctx);
    case S.seed:
      return seedText(state, text, ctx);
    case S.settings:
    case S.settings_bar:
    case S.settings_plates:
    case S.settings_steps:
    case S.settings_step_edit:
    case S.settings_language:
      return settingsText(state, ctx, text);
    case S.workout_day:
    case S.workout_resume:
    case S.workout_intensity:
    case S.workout_card:
    case S.workout_warmup:
    case S.workout_reps:
    case S.workout_after_set:
    case S.workout_comment:
    case S.workout_summary:
    case S.workout_final_comment:
    case S.workout_cancel_confirm:
      return workoutText(state, ctx, text);
    case S.idle:
      return ctx.settings.timezone === null
        ? askTime(state, null)
        : home(state, ctx.settings.timezone, ctx);
    default:
      return assertNever(state.step);
  }
}
