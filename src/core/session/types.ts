import { z } from 'zod';
import {
  InviteCodeSchema,
  MemberSchema,
  MemberViewSchema,
  PersonSchema,
} from '../access/schema.ts';

export type { Person } from '../access/schema.ts';
import { LastResultSchema, ManualResultSchema, WarmupVariantSchema } from '../history/schema.ts';
import { LocalDateSchema } from '../schedule/calendar.ts';
import { WarmupLineSchema } from '../workout/plan.ts';
import {
  ActiveWorkoutSchema,
  ExerciseLogPatchSchema,
  HistoryDataSchema,
  HistoryItemSchema,
  LastWorkoutSchema,
  NewExerciseLogSchema,
  NewSetSchema,
  NewWorkoutSchema,
  WorkoutStatusSchema,
} from '../workout/schema.ts';
import { SetInputErrorSchema } from '../input/set-input.ts';
import { ProgramIssueSchema, ProgramSummarySchema } from '../program/program.ts';
import { ProgramSchema } from '../program/schema.ts';
import { SettingsSectionSchema, StepSourceSchema } from '../settings/options.ts';
import { LanguageSchema, SettingsSchema } from '../settings/settings.ts';
import { LbSchema } from '../units/lb.ts';
import { TimeInputErrorSchema, TimeZoneSchema, ZoneLabelSchema } from '../schedule/timezone.ts';

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
  'workout_menu',
  'workout_add',
  'workout_menu_comment',
  'workout_card',
  'workout_warmup',
  'workout_warmup_mark',
  'workout_warmup_edit',
  'workout_warmup_comment',
  'workout_reps',
  'workout_set_view',
  'workout_set_edit',
  'workout_comment',
  'workout_summary',
  'workout_final_comment',
  'workout_cancel_confirm',
  'users',
  'users_revoke_confirm',
  'history_list',
  'history_workout',
  'history_exercise',
  'history_set',
  'history_add',
  'history_delete_set',
  'history_delete_workout',
]);
export type SessionStep = z.infer<typeof SessionStepSchema>;

export const FileProblemSchema = z.enum(['too_large', 'not_json', 'download_failed']);
export type FileProblem = z.infer<typeof FileProblemSchema>;

export const SessionContextSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).readonly(),
  z.object({ kind: z.literal('program_pending'), program: ProgramSchema }).readonly(),
  z.object({
    kind: z.literal('seed'),
    index: z.number().int().nonnegative(),
    filled: z.number().int().nonnegative(),
  }).readonly(),
  z.object({ kind: z.literal('settings_return') }).readonly(),
  z.object({ kind: z.literal('plates'), selected: z.array(LbSchema).readonly() }).readonly(),
  z.object({ kind: z.literal('step_edit'), exerciseId: z.string() }).readonly(),
  z.object({
    kind: z.literal('workout'),
    workoutId: z.string(),
    dayId: z.string(),
    localDate: LocalDateSchema,
    exerciseId: z.string().nullable().default(null),
    warmupStep: z.number().int().nonnegative().nullable().default(null),
    viewSet: z.number().int().positive().nullable().default(null),
    log: z.object({
      id: z.string(),
      workLb: LbSchema.nullable(),
      workSets: z.number().int().nonnegative(),
    }).readonly().nullable(),
  }).readonly(),
  z.object({
    kind: z.literal('history'),
    offset: z.number().int().nonnegative(),
    workoutId: z.string().nullable(),
    logId: z.string().nullable(),
    setId: z.string().nullable(),
  }).readonly(),
  z.object({
    kind: z.literal('member_revoke'),
    userId: z.number().int().positive(),
    person: PersonSchema,
  }).readonly(),
]);
export type SessionContext = z.infer<typeof SessionContextSchema>;

export const emptyContext: SessionContext = { kind: 'none' };

export const SessionSchema = z.object({
  userId: z.number().int().positive(),
  step: SessionStepSchema,
  stepNo: z.number().int().nonnegative(),
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

export const MenuMarkSchema = z.enum(['done', 'started', 'todo']);
export type MenuMark = z.infer<typeof MenuMarkSchema>;

export const WarmupMarkSchema = z.enum(['done', 'edit', 'skip']);
export type WarmupMark = z.infer<typeof WarmupMarkSchema>;

export const BotEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }).readonly(),
  z.object({ type: z.literal('clear_requested') }).readonly(),
  z.object({ type: z.literal('text_entered'), text: z.string() }).readonly(),
  z.object({ type: z.literal('tz_chosen'), zone: TimeZoneSchema }).readonly(),
  z.object({ type: z.literal('tz_located'), zone: TimeZoneSchema.nullable() }).readonly(),
  z.object({ type: z.literal('program_requested') }).readonly(),
  z.object({ type: z.literal('program_file'), text: z.string() }).readonly(),
  z.object({ type: z.literal('program_file_rejected'), reason: FileProblemSchema }).readonly(),
  z.object({ type: z.literal('program_confirmed') }).readonly(),
  z.object({ type: z.literal('program_cancelled') }).readonly(),
  z.object({ type: z.literal('seed_requested') }).readonly(),
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
  z.object({ type: z.literal('menu_exercise_picked'), exerciseId: z.string() }).readonly(),
  z.object({ type: z.literal('menu_add_requested') }).readonly(),
  z.object({ type: z.literal('add_exercise_chosen'), exerciseId: z.string() }).readonly(),
  z.object({ type: z.literal('weight_chosen'), lb: LbSchema }).readonly(),
  z.object({ type: z.literal('warmup_done'), variant: WarmupVariantSchema }).readonly(),
  z.object({ type: z.literal('warmup_diff_started') }).readonly(),
  z.object({ type: z.literal('warmup_marked'), mark: WarmupMarkSchema }).readonly(),
  z.object({ type: z.literal('warmup_comment_requested') }).readonly(),
  z.object({ type: z.literal('back_pressed') }).readonly(),
  z.object({ type: z.literal('undo_requested') }).readonly(),
  z.object({ type: z.literal('reps_chosen'), reps: z.number().int().positive() }).readonly(),
  z.object({ type: z.literal('exercise_finished') }).readonly(),
  z.object({ type: z.literal('set_edit_requested') }).readonly(),
  z.object({ type: z.literal('set_delete_requested') }).readonly(),
  z.object({ type: z.literal('set_forward') }).readonly(),
  z.object({ type: z.literal('comment_requested') }).readonly(),
  z.object({ type: z.literal('workout_finished') }).readonly(),
  z.object({ type: z.literal('workout_done') }).readonly(),
  z.object({ type: z.literal('cancel_requested') }).readonly(),
  z.object({ type: z.literal('cancel_answered'), confirm: z.boolean() }).readonly(),
  z.object({ type: z.literal('history_requested') }).readonly(),
  z.object({ type: z.literal('history_page'), offset: z.number().int().nonnegative() }).readonly(),
  z.object({ type: z.literal('history_workout_picked'), workoutId: z.string() }).readonly(),
  z.object({ type: z.literal('history_exercise_picked'), logId: z.string() }).readonly(),
  z.object({ type: z.literal('history_set_picked'), setId: z.string() }).readonly(),
  z.object({ type: z.literal('history_add_requested') }).readonly(),
  z.object({ type: z.literal('history_delete_requested') }).readonly(),
  z.object({ type: z.literal('history_delete_answered'), confirm: z.boolean() }).readonly(),
  z.object({ type: z.literal('invite_requested') }).readonly(),
  z.object({ type: z.literal('users_requested') }).readonly(),
  z.object({ type: z.literal('member_picked'), userId: z.number().int().positive() }).readonly(),
  z.object({ type: z.literal('revoke_answered'), confirm: z.boolean() }).readonly(),
]);
export type BotEvent = z.infer<typeof BotEventSchema>;

export const TimeZoneOptionSchema = z.object({ zone: TimeZoneSchema, label: ZoneLabelSchema })
  .readonly();
export type TimeZoneOption = z.infer<typeof TimeZoneOptionSchema>;

export const AskTimeErrorSchema = z.enum([
  ...TimeInputErrorSchema.extract(['not_time']).options,
  'location_unknown',
]);
export type AskTimeError = z.infer<typeof AskTimeErrorSchema>;

export const DayRefSchema = z.object({ id: z.string(), name: z.string() }).readonly();
const RangeViewSchema = z.object({ min: z.number().int(), max: z.number().int() }).readonly();
const SetViewSchema = z.object({ weightLb: LbSchema.nullable(), reps: z.number().int() })
  .readonly();

const RepsNoticeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('undone'), set: SetViewSchema }).readonly(),
  z.object({ kind: z.literal('fixed'), index: z.number().int().positive() }).readonly(),
  z.object({ kind: z.literal('deleted'), index: z.number().int().positive() }).readonly(),
  z.object({ kind: z.literal('commented') }).readonly(),
]);

const SummaryItemSchema = z.object({
  name: z.string(),
  replaces: z.string().nullable(),
  skipped: z.boolean(),
  addedWeight: z.boolean(),
  sets: z.array(SetViewSchema).readonly(),
  last: LastResultSchema.nullable(),
}).readonly();
export type SummaryItem = z.infer<typeof SummaryItemSchema>;

export const HistoryNoticeSchema = z.enum(['fixed', 'added', 'deleted']);
export type HistoryNotice = z.infer<typeof HistoryNoticeSchema>;

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
  z.object({ type: z.literal('unknown_command'), name: z.string(), owner: z.boolean() }).readonly(),
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
    type: z.literal('workout_menu'),
    dayName: z.string(),
    localDate: LocalDateSchema,
    items: z.array(
      z.object({
        exerciseId: z.string(),
        name: z.string(),
        mark: MenuMarkSchema,
        addedWeight: z.boolean(),
        sets: z.array(SetViewSchema).readonly(),
      }).readonly(),
    ).readonly(),
    next: z.string().nullable(),
    commentSaved: z.boolean(),
  }).readonly(),
  z.object({ type: z.literal('workout_add'), options: z.array(DayRefSchema).readonly() })
    .readonly(),
  z.object({
    type: z.literal('workout_card'),
    exerciseName: z.string(),
    workSets: RangeViewSchema,
    repRange: RangeViewSchema.nullable(),
    last: LastResultSchema.nullable(),
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
    lastComment: z.string().nullable(),
    commentSaved: z.boolean(),
  }).readonly(),
  z.object({
    type: z.literal('workout_warmup_mark'),
    exerciseName: z.string(),
    step: z.number().int().positive(),
    total: z.number().int().positive(),
    line: WarmupLineSchema,
    addedWeight: z.boolean(),
    editing: z.boolean(),
    error: SetInputErrorSchema.nullable(),
  }).readonly(),
  z.object({ type: z.literal('workout_warmup_comment_prompt'), exerciseName: z.string() })
    .readonly(),
  z.object({
    type: z.literal('workout_reps'),
    exerciseName: z.string(),
    setIndex: z.number().int().positive(),
    weightLb: LbSchema.nullable(),
    addedWeight: z.boolean(),
    options: z.array(z.number().int().positive()).readonly(),
    target: z.string().nullable(),
    recorded: z.array(SetViewSchema).readonly(),
    overMax: z.boolean(),
    error: SetInputErrorSchema.nullable(),
    perSideLb: LbSchema.nullable(),
    notice: RepsNoticeSchema.nullable(),
  }).readonly(),
  z.object({
    type: z.literal('workout_set_view'),
    exerciseName: z.string(),
    index: z.number().int().positive(),
    set: SetViewSchema,
    addedWeight: z.boolean(),
    current: z.number().int().positive(),
    editing: z.boolean(),
    error: SetInputErrorSchema.nullable(),
  }).readonly(),
  z.object({ type: z.literal('workout_comment_prompt'), exerciseName: z.string().nullable() })
    .readonly(),
  z.object({
    type: z.literal('workout_summary'),
    dayName: z.string(),
    localDate: LocalDateSchema,
    minutes: z.number().int().nonnegative(),
    items: z.array(SummaryItemSchema).readonly(),
    commentSaved: z.boolean(),
  }).readonly(),
  z.object({ type: z.literal('workout_cancel_confirm'), dayName: z.string() }).readonly(),
  z.object({ type: z.literal('workout_commented') }).readonly(),
  z.object({ type: z.literal('workout_cancelled') }).readonly(),
  z.object({ type: z.literal('workout_none') }).readonly(),
  z.object({ type: z.literal('workout_undo_nothing') }).readonly(),
  z.object({ type: z.literal('workout_empty_deleted') }).readonly(),
  z.object({
    type: z.literal('history_list'),
    items: z.array(HistoryItemSchema).readonly(),
    offset: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    deleted: z.boolean(),
  }).readonly(),
  z.object({
    type: z.literal('history_workout'),
    dayName: z.string(),
    localDate: LocalDateSchema,
    items: z.array(SummaryItemSchema).readonly(),
    exercises: z.array(z.object({ logId: z.string(), name: z.string() }).readonly()).readonly(),
  }).readonly(),
  z.object({
    type: z.literal('history_exercise'),
    name: z.string(),
    localDate: LocalDateSchema,
    addedWeight: z.boolean(),
    sets: z.array(
      z.object({
        id: z.string(),
        index: z.number().int(),
        weightLb: LbSchema.nullable(),
        reps: z.number().int(),
      })
        .readonly(),
    ).readonly(),
    notice: HistoryNoticeSchema.nullable(),
  }).readonly(),
  z.object({
    type: z.literal('history_set'),
    name: z.string(),
    index: z.number().int().positive(),
    set: SetViewSchema.nullable(),
    addedWeight: z.boolean(),
    weightless: z.boolean(),
    error: SetInputErrorSchema.nullable(),
  }).readonly(),
  z.object({
    type: z.literal('history_delete_set'),
    index: z.number().int().positive(),
    set: SetViewSchema,
    addedWeight: z.boolean(),
  }).readonly(),
  z.object({
    type: z.literal('history_delete_workout'),
    dayName: z.string(),
    localDate: LocalDateSchema,
  }).readonly(),
  z.object({
    type: z.literal('invite_created'),
    code: InviteCodeSchema,
    expiresOn: LocalDateSchema.nullable(),
  }).readonly(),
  z.object({
    type: z.literal('users_list'),
    members: z.array(MemberViewSchema).readonly(),
    revoked: PersonSchema.nullable(),
  }).readonly(),
  z.object({ type: z.literal('users_revoke_confirm'), person: PersonSchema }).readonly(),
  z.object({ type: z.literal('member_joined'), person: PersonSchema }).readonly(),
  z.object({ type: z.literal('invite_invalid') }).readonly(),
]);
export type View = z.infer<typeof ViewSchema>;

export const EffectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('save_settings'), settings: SettingsSchema }).readonly(),
  z.object({ type: z.literal('render'), view: ViewSchema }).readonly(),
  z.object({ type: z.literal('clear_chat') }).readonly(),
  z.object({ type: z.literal('save_program'), program: ProgramSchema }).readonly(),
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
  z.object({ type: z.literal('delete_sets'), ids: z.array(z.string()).readonly() }).readonly(),
  z.object({
    type: z.literal('update_set'),
    id: z.string(),
    weightLb: LbSchema.nullable(),
    reps: z.number().int().positive(),
  }).readonly(),
  z.object({
    type: z.literal('add_set'),
    id: z.string(),
    logId: z.string(),
    weightLb: LbSchema.nullable(),
    reps: z.number().int().positive(),
  }).readonly(),
  z.object({ type: z.literal('delete_workout'), id: z.string() }).readonly(),
  z.object({ type: z.literal('delete_exercise_log'), id: z.string() }).readonly(),
  z.object({ type: z.literal('create_invite'), code: InviteCodeSchema, expiresAt: z.date() })
    .readonly(),
  z.object({ type: z.literal('revoke_member'), userId: z.number().int().positive() }).readonly(),
]);
export type Effect = z.infer<typeof EffectSchema>;

export const StepContextSchema = z.object({
  now: z.date(),
  settings: SettingsSchema,
  languageCode: z.string().nullable(),
  activeProgram: ProgramSchema.nullable(),
  lastResults: z.record(z.string(), LastResultSchema).readonly(),
  activeWorkout: ActiveWorkoutSchema.nullable(),
  lastWorkout: LastWorkoutSchema.nullable(),
  isOwner: z.boolean(),
  history: HistoryDataSchema,
  members: z.array(MemberSchema).readonly(),
  newIds: z.array(z.string()).readonly(),
}).readonly();
export type StepContext = z.infer<typeof StepContextSchema>;

export const StepResultSchema = z.object({
  state: SessionSchema,
  effects: z.array(EffectSchema).readonly(),
}).readonly();
export type StepResult = z.infer<typeof StepResultSchema>;
