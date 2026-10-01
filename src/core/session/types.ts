import { z } from 'zod';
import { LastResultSchema, ManualResultSchema, WarmupVariantSchema } from '../history/schema.ts';
import { IntensityLogSchema } from '../schedule/intensity.ts';
import { LocalDateSchema } from '../schedule/calendar.ts';
import { WarmupLineSchema } from '../workout/plan.ts';
import {
  ActiveWorkoutSchema,
  ExerciseLogPatchSchema,
  LastWorkoutSchema,
  NewExerciseLogSchema,
  NewSetSchema,
  NewWorkoutSchema,
  WorkoutStatusSchema,
} from '../workout/schema.ts';
import { SetInputErrorSchema } from '../input/set-input.ts';
import { ProgramIssueSchema, ProgramSummarySchema } from '../program/program.ts';
import { IntensitySchema, ProgramSchema } from '../program/schema.ts';
import { SettingsSectionSchema, StepSourceSchema } from '../settings/options.ts';
import { LanguageSchema, SettingsSchema } from '../settings/settings.ts';
import { LbSchema } from '../units/lb.ts';
import { TimeInputErrorSchema, TimeZoneSchema, ZoneLabelSchema } from '../schedule/timezone.ts';

/** Шаг диалога. Новые ветки диалога добавляются сюда и в step(). */
export const SessionStepSchema = z.enum([
  'idle',
  'onboarding_tz',
  'onboarding_tz_pick',
  'program_upload',
  'program_confirm',
  'seed',
  'settings',
  'settings_bar',
  'settings_plates',
  'settings_steps',
  'settings_step_edit',
  'settings_language',
  'workout_day',
  'workout_resume',
  'workout_intensity',
  'workout_card',
  'workout_warmup',
  'workout_reps',
  'workout_after_set',
  'workout_comment',
  'workout_summary',
  'workout_final_comment',
  'workout_cancel_confirm',
]);
export type SessionStep = z.infer<typeof SessionStepSchema>;

/** Почему файл программы не принят ещё до разбора: размер, тип, загрузка. */
export const FileProblemSchema = z.enum(['too_large', 'not_json', 'download_failed']);
export type FileProblem = z.infer<typeof FileProblemSchema>;

/** Данные, которые шаг диалога помнит между сообщениями. */
export const SessionContextSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).readonly(),
  /** Новая программа ждёт подтверждения замены текущей. */
  z.object({ kind: z.literal('program_pending'), program: ProgramSchema }).readonly(),
  /** /seed: номер текущего упражнения и сколько заполнено за этот проход. */
  z.object({
    kind: z.literal('seed'),
    index: z.number().int().nonnegative(),
    filled: z.number().int().nonnegative(),
  }).readonly(),
  /** Смена часового пояса из /settings: после сохранения — снова настройки. */
  z.object({ kind: z.literal('settings_return') }).readonly(),
  /** Блины в процессе выбора, до [Сохранить]. */
  z.object({ kind: z.literal('plates'), selected: z.array(LbSchema).readonly() }).readonly(),
  z.object({ kind: z.literal('step_edit'), exerciseId: z.string() }).readonly(),
  /** Тренировка: текущее упражнение дня и его запись (после выбора веса). */
  z.object({
    kind: z.literal('workout'),
    workoutId: z.string(),
    dayId: z.string(),
    /** Локальная дата тренировки: зафиксирована при старте (ADR-0004). */
    localDate: LocalDateSchema,
    index: z.number().int().nonnegative(),
    /** Интенсивность, выбранная пользователем для текущего упражнения (иначе — по правилам §6.4). */
    intensity: IntensitySchema.nullable(),
    log: z.object({
      id: z.string(),
      workLb: LbSchema.nullable(),
      workSets: z.number().int().nonnegative(),
    }).readonly().nullable(),
  }).readonly(),
]);
export type SessionContext = z.infer<typeof SessionContextSchema>;

export const emptyContext: SessionContext = { kind: 'none' };

/** Состояние диалога; хранится в таблице session, функция stateless. */
export const SessionSchema = z.object({
  userId: z.number().int().positive(),
  step: SessionStepSchema,
  /** Растёт при каждом показе нового экрана; кнопки со старым номером считаются устаревшими. */
  stepNo: z.number().int().nonnegative(),
  /** Последний обработанный update_id Telegram (идемпотентность). */
  lastUpdateId: z.number().int().nonnegative(),
  context: SessionContextSchema,
}).readonly();
export type Session = z.infer<typeof SessionSchema>;

export const initialSession = (userId: number): Session => ({
  userId,
  step: SessionStepSchema.enum.idle,
  stepNo: 0,
  lastUpdateId: 0,
  context: emptyContext,
});

/** Незавершённая тренировка при /workout: продолжить, завершить её или начать новую. */
export const ResumeChoiceSchema = z.enum(['continue', 'finish', 'new']);
export type ResumeChoice = z.infer<typeof ResumeChoiceSchema>;

export const BotEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }).readonly(),
  z.object({ type: z.literal('text_entered'), text: z.string() }).readonly(),
  z.object({ type: z.literal('tz_chosen'), zone: TimeZoneSchema }).readonly(),
  /** Геопозиция уже переведена в зону оболочкой; null — по координатам зону не нашли. */
  z.object({ type: z.literal('tz_located'), zone: TimeZoneSchema.nullable() }).readonly(),
  z.object({ type: z.literal('program_requested') }).readonly(),
  /** Файл программы уже скачан оболочкой: текст или причина, почему не получилось. */
  z.object({ type: z.literal('program_file'), text: z.string() }).readonly(),
  z.object({ type: z.literal('program_file_rejected'), reason: FileProblemSchema }).readonly(),
  z.object({ type: z.literal('program_confirmed') }).readonly(),
  z.object({ type: z.literal('program_cancelled') }).readonly(),
  z.object({ type: z.literal('seed_requested') }).readonly(),
  /** [Нет данных] / [Оставить] — к следующему упражнению без записи; [Закончить] — выход. */
  z.object({ type: z.literal('seed_next') }).readonly(),
  z.object({ type: z.literal('seed_stopped') }).readonly(),
  z.object({ type: z.literal('unknown_command'), name: z.string() }).readonly(),
  z.object({ type: z.literal('settings_requested') }).readonly(),
  z.object({ type: z.literal('settings_section'), section: SettingsSectionSchema }).readonly(),
  z.object({ type: z.literal('settings_back') }).readonly(),
  z.object({ type: z.literal('settings_closed') }).readonly(),
  z.object({ type: z.literal('bar_chosen'), lb: LbSchema }).readonly(),
  z.object({ type: z.literal('plate_toggled'), lb: LbSchema }).readonly(),
  z.object({ type: z.literal('plates_saved') }).readonly(),
  z.object({ type: z.literal('step_exercise_picked'), exerciseId: z.string() }).readonly(),
  z.object({ type: z.literal('step_chosen'), lb: LbSchema }).readonly(),
  z.object({ type: z.literal('step_reset') }).readonly(),
  z.object({ type: z.literal('language_chosen'), language: LanguageSchema }).readonly(),
  z.object({ type: z.literal('workout_requested') }).readonly(),
  z.object({ type: z.literal('day_chosen'), dayId: z.string() }).readonly(),
  z.object({ type: z.literal('resume_chosen'), choice: ResumeChoiceSchema }).readonly(),
  z.object({ type: z.literal('intensity_chosen'), intensity: IntensitySchema }).readonly(),
  z.object({ type: z.literal('weight_chosen'), lb: LbSchema }).readonly(),
  z.object({ type: z.literal('warmup_done'), variant: WarmupVariantSchema }).readonly(),
  z.object({ type: z.literal('reps_chosen'), reps: z.number().int().positive() }).readonly(),
  z.object({ type: z.literal('set_more') }).readonly(),
  z.object({ type: z.literal('exercise_next') }).readonly(),
  z.object({ type: z.literal('exercise_skip') }).readonly(),
  z.object({ type: z.literal('comment_requested') }).readonly(),
  z.object({ type: z.literal('workout_done') }).readonly(),
  z.object({ type: z.literal('cancel_requested') }).readonly(),
  z.object({ type: z.literal('cancel_answered'), confirm: z.boolean() }).readonly(),
]);
export type BotEvent = z.infer<typeof BotEventSchema>;

export const TimeZoneOptionSchema = z.object({ zone: TimeZoneSchema, label: ZoneLabelSchema })
  .readonly();
export type TimeZoneOption = z.infer<typeof TimeZoneOptionSchema>;

/** Почему снова спрашиваем время: ввод не распознан или по геопозиции зона не нашлась. */
export const AskTimeErrorSchema = z.enum([
  ...TimeInputErrorSchema.extract(['not_time']).options,
  'location_unknown',
]);
export type AskTimeError = z.infer<typeof AskTimeErrorSchema>;

export const DayRefSchema = z.object({ id: z.string(), name: z.string() }).readonly();
const RangeViewSchema = z.object({ min: z.number().int(), max: z.number().int() }).readonly();
const SetViewSchema = z.object({ weightLb: LbSchema.nullable(), reps: z.number().int() })
  .readonly();

/** Что показать пользователю. Текст и кнопки строят views в features/. */
export const ViewSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ask_time'), error: AskTimeErrorSchema.nullable() }).readonly(),
  z.object({
    type: z.literal('pick_zone'),
    offsetLabel: z.string(),
    options: z.array(TimeZoneOptionSchema).readonly(),
  }).readonly(),
  z.object({
    type: z.literal('home'),
    zone: ZoneLabelSchema,
    programName: z.string().nullable(),
  }).readonly(),
  z.object({ type: z.literal('program_status'), current: ProgramSummarySchema.nullable() })
    .readonly(),
  z.object({ type: z.literal('program_invalid'), issues: z.array(ProgramIssueSchema).readonly() })
    .readonly(),
  z.object({
    type: z.literal('program_confirm'),
    incoming: ProgramSummarySchema,
    currentName: z.string(),
  }).readonly(),
  z.object({ type: z.literal('program_saved'), summary: ProgramSummarySchema }).readonly(),
  z.object({ type: z.literal('program_unchanged') }).readonly(),
  z.object({ type: z.literal('program_cancelled') }).readonly(),
  z.object({
    type: z.literal('program_file_rejected'),
    reason: FileProblemSchema,
  }).readonly(),
  z.object({
    type: z.literal('seed_prompt'),
    exerciseName: z.string(),
    position: z.number().int().positive(),
    total: z.number().int().positive(),
    /** Для допвеса подсказка другая: «+25x8». */
    addedWeight: z.boolean(),
    current: LastResultSchema.nullable(),
    error: SetInputErrorSchema.nullable(),
  }).readonly(),
  z.object({
    type: z.literal('seed_done'),
    filled: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }).readonly(),
  z.object({ type: z.literal('needs_program') }).readonly(),
  z.object({ type: z.literal('unknown_command'), name: z.string() }).readonly(),
  z.object({
    type: z.literal('settings_menu'),
    zone: ZoneLabelSchema.nullable(),
    barLb: LbSchema,
    platesLb: z.array(LbSchema).readonly(),
    barStepLb: LbSchema,
    overrides: z.number().int().nonnegative(),
    language: LanguageSchema,
    saved: z.boolean(),
  }).readonly(),
  z.object({ type: z.literal('settings_bar'), currentLb: LbSchema, invalid: z.boolean() })
    .readonly(),
  z.object({
    type: z.literal('settings_plates'),
    options: z.array(LbSchema).readonly(),
    selected: z.array(LbSchema).readonly(),
    empty: z.boolean(),
  }).readonly(),
  z.object({
    type: z.literal('settings_steps'),
    items: z.array(
      z.object({
        exerciseId: z.string(),
        name: z.string(),
        stepLb: LbSchema,
        source: StepSourceSchema,
      }).readonly(),
    ).readonly(),
  }).readonly(),
  z.object({
    type: z.literal('settings_step_edit'),
    name: z.string(),
    stepLb: LbSchema,
    source: StepSourceSchema,
    invalid: z.boolean(),
  }).readonly(),
  z.object({ type: z.literal('settings_language'), selected: LanguageSchema }).readonly(),
  z.object({
    type: z.literal('workout_days'),
    last: LastWorkoutSchema.nullable(),
    next: DayRefSchema,
    others: z.array(DayRefSchema).readonly(),
  }).readonly(),
  z.object({
    type: z.literal('workout_resume'),
    dayName: z.string(),
    startedLabel: z.string(),
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }).readonly(),
  z.object({
    type: z.literal('workout_intensity'),
    exerciseName: z.string(),
    pairNames: z.tuple([z.string(), z.string()]).readonly(),
  }).readonly(),
  z.object({
    type: z.literal('workout_card'),
    exerciseName: z.string(),
    position: z.number().int().positive(),
    total: z.number().int().positive(),
    workSets: RangeViewSchema,
    repRange: RangeViewSchema.nullable(),
    last: LastResultSchema.nullable(),
    intensity: z.object({ value: IntensitySchema, summary: z.string() }).readonly().nullable(),
    notes: z.array(z.string()).readonly(),
    addedWeight: z.boolean(),
    noWeight: z.boolean(),
    options: z.array(LbSchema).readonly(),
    invalidWeight: z.boolean(),
  }).readonly(),
  z.object({
    type: z.literal('workout_warmup'),
    exerciseName: z.string(),
    workLb: LbSchema,
    addedWeight: z.boolean(),
    repRange: RangeViewSchema.nullable(),
    lines: z.array(WarmupLineSchema).readonly(),
  }).readonly(),
  z.object({
    type: z.literal('workout_reps'),
    exerciseName: z.string(),
    setIndex: z.number().int().positive(),
    weightLb: LbSchema.nullable(),
    addedWeight: z.boolean(),
    options: z.array(z.number().int().positive()).readonly(),
    target: z.string().nullable(),
    justRecorded: SetViewSchema.nullable(),
    overMax: z.boolean(),
    error: SetInputErrorSchema.nullable(),
  }).readonly(),
  z.object({
    type: z.literal('workout_after_set'),
    exerciseName: z.string(),
    recorded: SetViewSchema,
    addedWeight: z.boolean(),
    setIndex: z.number().int().positive(),
    nextOverMax: z.boolean(),
    lastExercise: z.boolean(),
    commentSaved: z.boolean(),
  }).readonly(),
  z.object({ type: z.literal('workout_comment_prompt'), exerciseName: z.string().nullable() })
    .readonly(),
  z.object({
    type: z.literal('workout_summary'),
    dayName: z.string(),
    localDate: LocalDateSchema,
    minutes: z.number().int().nonnegative(),
    items: z.array(
      z.object({
        name: z.string(),
        skipped: z.boolean(),
        addedWeight: z.boolean(),
        sets: z.array(SetViewSchema).readonly(),
        last: LastResultSchema.nullable(),
      }).readonly(),
    ).readonly(),
    commentSaved: z.boolean(),
  }).readonly(),
  z.object({ type: z.literal('workout_cancel_confirm'), dayName: z.string() }).readonly(),
  z.object({ type: z.literal('workout_commented') }).readonly(),
  z.object({ type: z.literal('workout_cancelled') }).readonly(),
  z.object({ type: z.literal('workout_none') }).readonly(),
]);
export type View = z.infer<typeof ViewSchema>;

export const EffectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('save_settings'), settings: SettingsSchema }).readonly(),
  z.object({ type: z.literal('render'), view: ViewSchema }).readonly(),
  /** Сохранить программу активной; предыдущая архивируется. */
  z.object({ type: z.literal('save_program'), program: ProgramSchema }).readonly(),
  /** Записать результат, введённый вручную (/seed). */
  z.object({ type: z.literal('record_manual_result'), result: ManualResultSchema }).readonly(),
  z.object({ type: z.literal('start_workout'), workout: NewWorkoutSchema }).readonly(),
  z.object({
    type: z.literal('finish_workout'),
    workoutId: z.string(),
    status: WorkoutStatusSchema,
    finishedAt: z.date(),
  }).readonly(),
  z.object({ type: z.literal('comment_workout'), workoutId: z.string(), comment: z.string() })
    .readonly(),
  z.object({ type: z.literal('open_exercise_log'), log: NewExerciseLogSchema }).readonly(),
  z.object({ type: z.literal('patch_exercise_log'), id: z.string(), patch: ExerciseLogPatchSchema })
    .readonly(),
  z.object({ type: z.literal('record_set'), set: NewSetSchema }).readonly(),
]);
export type Effect = z.infer<typeof EffectSchema>;

export const StepContextSchema = z.object({
  now: z.date(),
  settings: SettingsSchema,
  /** language_code из Telegram: по нему зоны-кандидаты сортируются. */
  languageCode: z.string().nullable(),
  /** Активная программа пользователя; null — ещё не загружена. */
  activeProgram: ProgramSchema.nullable(),
  /** «Прошлый раз» по упражнениям активной программы. */
  lastResults: z.record(z.string(), LastResultSchema).readonly(),
  /** Незавершённая тренировка с записанным; null — нет. */
  activeWorkout: ActiveWorkoutSchema.nullable(),
  lastWorkout: LastWorkoutSchema.nullable(),
  /** История интенсивности упражнений из пар 100/70 (по ISO-неделям). */
  intensityLogs: z.array(IntensityLogSchema).readonly(),
  /** Последний рабочий вес на 100% по упражнениям из пар — база для 70%. */
  lastHighLb: z.record(z.string(), LbSchema).readonly(),
  /** Свежие id для новых записей: автомат остаётся чистой функцией. */
  newIds: z.array(z.string()).readonly(),
}).readonly();
export type StepContext = z.infer<typeof StepContextSchema>;

export const StepResultSchema = z.object({
  state: SessionSchema,
  effects: z.array(EffectSchema).readonly(),
}).readonly();
export type StepResult = z.infer<typeof StepResultSchema>;
