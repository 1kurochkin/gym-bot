import { z } from 'zod';
import { InviteCodeSchema, MemberSchema, type Person } from '../core/access/schema.ts';
import { LastResultSchema, ManualResultSchema } from '../core/history/schema.ts';
import { ProgramSchema } from '../core/program/schema.ts';
import { type Effect, SessionSchema } from '../core/session/types.ts';
import {
  ActiveWorkoutSchema,
  type HistoryData,
  type HistoryQuery,
  LastWorkoutSchema,
} from '../core/workout/schema.ts';
import { SettingsSchema } from '../core/settings/settings.ts';

export const UserStateSchema = z.object({
  session: SessionSchema,
  settings: SettingsSchema,
  activeProgram: ProgramSchema.nullable(),
  lastResults: z.record(z.string(), LastResultSchema).readonly(),
  activeWorkout: ActiveWorkoutSchema.nullable(),
  lastWorkout: LastWorkoutSchema.nullable(),
  members: z.array(MemberSchema).readonly(),
}).readonly();
export type UserState = z.infer<typeof UserStateSchema>;

export const CommitSchema = z.object({
  session: SessionSchema,
  settings: SettingsSchema.optional(),
  newProgram: z.object({ id: z.uuid(), program: ProgramSchema }).readonly().optional(),
  manualResults: z.array(
    z.object({
      logId: z.uuid(),
      setId: z.uuid(),
      programId: z.uuid(),
      result: ManualResultSchema,
    }).readonly(),
  ).readonly().optional(),
  newInvite: z.object({ code: InviteCodeSchema, expiresAt: z.date() }).readonly().optional(),
  revokeMember: z.number().int().positive().optional(),
}).readonly();
export type Commit = z.infer<typeof CommitSchema> & {
  readonly workout?: { readonly programId: string; readonly writes: readonly WorkoutWrite[] };
};

export type WorkoutWrite = Extract<
  Effect,
  {
    type:
      | 'start_workout'
      | 'finish_workout'
      | 'comment_workout'
      | 'open_exercise_log'
      | 'patch_exercise_log'
      | 'record_set'
      | 'delete_sets'
      | 'delete_exercise_log'
      | 'update_set'
      | 'add_set'
      | 'delete_workout';
  }
>;

const WORKOUT_WRITES: ReadonlySet<string> = new Set([
  'start_workout',
  'finish_workout',
  'comment_workout',
  'open_exercise_log',
  'patch_exercise_log',
  'record_set',
  'delete_sets',
  'delete_exercise_log',
  'update_set',
  'add_set',
  'delete_workout',
]);

export const isWorkoutWrite = (e: Effect): e is WorkoutWrite => WORKOUT_WRITES.has(e.type);

export type Store = {
  readonly load: (userId: number, opts?: { readonly withMembers: boolean }) => Promise<UserState>;
  readonly loadHistory: (userId: number, query: HistoryQuery) => Promise<HistoryData>;
  readonly isMember: (userId: number) => Promise<boolean>;
  readonly redeemInvite: (
    code: string,
    userId: number,
    person: Person,
    now: Date,
  ) => Promise<{ readonly invitedBy: number } | null>;
  readonly commit: (userId: number, change: Commit) => Promise<void>;
  readonly ping: () => Promise<void>;
};
