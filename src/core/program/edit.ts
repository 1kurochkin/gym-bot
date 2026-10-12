import { z } from 'zod';
import { err, type Result } from '../../shared/result.ts';
import { lb } from '../units/lb.ts';
import { dayExercises, exerciseIndex, parseProgram, type ProgramIssue } from './program.ts';
import {
  type AddedWeightTiers,
  type Day,
  type Exercise,
  type LoadType,
  LoadTypeSchema,
  type Program,
  RangeSchema,
  type WarmupTiers,
} from './schema.ts';

export const NAME_MAX = 60;
export const SETS_MAX = 20;
export const REPS_MAX = 100;

const { barbell, machine, weighted_bodyweight, reps_only, light_load } = LoadTypeSchema.enum;

export const NewExerciseTypeSchema = LoadTypeSchema.extract([
  barbell,
  machine,
  weighted_bodyweight,
  reps_only,
  light_load,
]);
export type NewExerciseType = z.infer<typeof NewExerciseTypeSchema>;

export const GoalSchema = z.object({
  workSets: RangeSchema,
  repRange: RangeSchema.nullable(),
}).readonly();
export type Goal = z.infer<typeof GoalSchema>;

export const NewExerciseSchema = z.object({
  name: z.string().min(1).max(NAME_MAX),
  loadType: NewExerciseTypeSchema,
  goal: GoalSchema,
}).readonly();
export type NewExercise = z.infer<typeof NewExerciseSchema>;

export const MoveSchema = z.enum(['up', 'down']);
export type Move = z.infer<typeof MoveSchema>;

export const CUSTOM_PROGRAM_ID = 'custom';

export function nextProgramKey(taken: readonly string[]): string {
  const used = new Set(taken);
  if (!used.has(CUSTOM_PROGRAM_ID)) return CUSTOM_PROGRAM_ID;
  let n = 2;
  while (used.has(`${CUSTOM_PROGRAM_ID}_${n}`)) n++;
  return `${CUSTOM_PROGRAM_ID}_${n}`;
}

export function parseName(text: string): string | null {
  const name = text.trim();
  return name.length >= 1 && name.length <= NAME_MAX ? name : null;
}

const RANGE = String.raw`(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?`;
const GOAL_RE = new RegExp(String.raw`^\s*${RANGE}\s*[xXхХ×*]\s*${RANGE}\s*$`);
const SETS_RE = new RegExp(String.raw`^\s*${RANGE}\s*$`);

function range(
  from: string | undefined,
  to: string | undefined,
  max: number,
): Goal['workSets'] | null {
  const min = Number(from);
  const top = to === undefined ? min : Number(to);
  if (!Number.isInteger(min) || min < 1 || top < min || top > max) return null;
  return { min, max: top };
}

export function parseGoal(text: string, type: LoadType): Goal | null {
  if (type === reps_only) {
    const m = SETS_RE.exec(text);
    const workSets = m && range(m[1], m[2], SETS_MAX);
    return workSets ? { workSets, repRange: null } : null;
  }
  const m = GOAL_RE.exec(text);
  if (!m) return null;
  const workSets = range(m[1], m[2], SETS_MAX);
  const repRange = range(m[3], m[4], REPS_MAX);
  return workSets && repRange ? { workSets, repRange } : null;
}

export function nextExerciseId(program: Program): string {
  const taken = new Set(program.days.flatMap((d) => d.exercises.map((e) => e.id)));
  let n = 1;
  while (taken.has(`ex_${n}`)) n++;
  return `ex_${n}`;
}

export function buildExercise(id: string, draft: NewExercise): Exercise {
  const base = { id, name: draft.name, isBase: false, workSets: draft.goal.workSets };
  const repRange = draft.goal.repRange ?? draft.goal.workSets;
  switch (draft.loadType) {
    case barbell:
      return { ...base, loadType: barbell, repRange, warmup: 'tiers' };
    case machine:
      return { ...base, loadType: machine, repRange, warmup: null };
    case weighted_bodyweight:
      return { ...base, loadType: weighted_bodyweight, repRange, warmup: null };
    case reps_only:
      return { ...base, loadType: reps_only, warmup: null };
    case light_load:
      return { ...base, loadType: light_load, repRange, warmup: null };
  }
}

type DayEntry = Day['exercises'][number];

export function nextDayId(program: Program): string {
  const taken = new Set(program.days.map((d) => d.id));
  let n = 1;
  while (taken.has(`day_${n}`)) n++;
  return `day_${n}`;
}

const mapDay = (program: Program, dayId: string, f: (d: Day) => Day): Program => ({
  ...program,
  days: program.days.map((d) => (d.id === dayId ? f(d) : d)),
});

const checked = (program: Program): Result<Program, readonly ProgramIssue[]> =>
  parseProgram(program);

export function renameExercise(
  program: Program,
  exerciseId: string,
  name: string,
): Result<Program, readonly ProgramIssue[]> {
  return checked({
    ...program,
    days: program.days.map((d) => ({
      ...d,
      exercises: d.exercises.map((e) => ('ref' in e || e.id !== exerciseId ? e : { ...e, name })),
    })),
  });
}

export function renameDay(
  program: Program,
  dayId: string,
  name: string,
): Result<Program, readonly ProgramIssue[]> {
  return checked(mapDay(program, dayId, (d) => ({ ...d, name })));
}

export const renameProgram = (
  program: Program,
  name: string,
): Result<Program, readonly ProgramIssue[]> => checked({ ...program, name });

export function changeGoal(
  program: Program,
  exerciseId: string,
  goal: Goal,
): Result<Program, readonly ProgramIssue[]> {
  const withGoal = (e: Exercise): Exercise => {
    if (e.loadType !== reps_only) {
      return { ...e, workSets: goal.workSets, repRange: goal.repRange ?? goal.workSets };
    }
    const keep = e.setTargets?.length === goal.workSets.max;
    return { ...e, workSets: goal.workSets, setTargets: keep ? e.setTargets : undefined };
  };
  return checked({
    ...program,
    days: program.days.map((d) => ({
      ...d,
      exercises: d.exercises.map((e) => ('ref' in e || e.id !== exerciseId ? e : withGoal(e))),
    })),
  });
}

export const sameGoal = (e: Exercise, goal: Goal): boolean =>
  e.workSets.min === goal.workSets.min && e.workSets.max === goal.workSets.max &&
  ('repRange' in e
    ? goal.repRange !== null && e.repRange.min === goal.repRange.min &&
      e.repRange.max === goal.repRange.max
    : goal.repRange === null);

const append = (program: Program, dayId: string, entry: DayEntry): Program =>
  mapDay(program, dayId, (d) => ({ ...d, exercises: [...d.exercises, entry] }));

const refEntry = (program: Program, exerciseId: string): DayEntry | null =>
  exerciseIndex(program).has(exerciseId) ? { id: exerciseId, ref: true } : null;

export function addNewExercise(
  program: Program,
  dayId: string,
  draft: NewExercise,
): Result<Program, readonly ProgramIssue[]> {
  return checked(append(program, dayId, buildExercise(nextExerciseId(program), draft)));
}

export function addFromProgram(
  program: Program,
  dayId: string,
  exerciseId: string,
): Result<Program, readonly ProgramIssue[]> {
  const entry = refEntry(program, exerciseId);
  if (!entry || dayExercises(program, dayId).some((e) => e.id === exerciseId)) return err([]);
  return checked(append(program, dayId, entry));
}

function withDay(program: Program, name: string, entry: DayEntry): Program {
  const id = nextDayId(program);
  return {
    ...program,
    rotation: [...program.rotation, id],
    days: [...program.days, { id, name, exercises: [entry] }],
  };
}

export const addDayWithNew = (
  program: Program,
  name: string,
  draft: NewExercise,
): Result<Program, readonly ProgramIssue[]> =>
  checked(withDay(program, name, buildExercise(nextExerciseId(program), draft)));

export function addDayFromProgram(
  program: Program,
  name: string,
  exerciseId: string,
): Result<Program, readonly ProgramIssue[]> {
  const entry = refEntry(program, exerciseId);
  return entry ? checked(withDay(program, name, entry)) : err([]);
}

export const BLANK_WARMUP_TIERS: WarmupTiers = {
  byWorkWeight: [
    { minLb: lb(0), steps: [{ pct: 0.5, reps: 8 }, { pct: 0.8, reps: 3 }] },
    {
      minLb: lb(135),
      steps: [{ pct: 0.45, reps: 8 }, { pct: 0.7, reps: 5 }, { pct: 0.85, reps: 3 }],
    },
    {
      minLb: lb(225),
      steps: [
        { pct: 0.4, reps: 10 },
        { pct: 0.6, reps: 8 },
        { pct: 0.75, reps: 5 },
        { pct: 0.9, reps: 3 },
      ],
    },
  ],
  overloadSingle: { pct: 1.05, reps: 1, onlyBase: true, skipOnLowIntensity: true },
};

export const BLANK_ADDED_TIERS: AddedWeightTiers = {
  zero: { steps: [{ assist: true, reps: 12 }], afterWork: { bodyweight: true, reps: 'max' } },
  byAddedWeight: [
    {
      minLb: lb(1),
      steps: [{ pct: 0, reps: 8 }, { pct: 0.8, reps: 4 }],
      afterWork: { bodyweight: true, reps: 'max' },
    },
    { minLb: lb(25), steps: [{ pct: 0, reps: 10 }, { pct: 0.5, reps: 5 }, { pct: 0.85, reps: 3 }] },
    { minLb: lb(60), steps: [{ pct: 0, reps: 10 }, { pct: 0.4, reps: 6 }, { pct: 0.75, reps: 4 }] },
  ],
  overloadSingle: { pct: 1.1, reps: 1, minAddedLb: lb(25) },
};

export function createProgram(
  name: string,
  dayName: string,
  draft: NewExercise,
  id: string = CUSTOM_PROGRAM_ID,
): Result<Program, readonly ProgramIssue[]> {
  const dayId = 'day_1';
  return checked({
    schemaVersion: 1,
    id,
    name,
    units: 'lb',
    rotation: [dayId],
    warmupTiers: BLANK_WARMUP_TIERS,
    addedWeightTiers: BLANK_ADDED_TIERS,
    fixedSchemes: {},
    intensityPairs: [],
    days: [{ id: dayId, name: dayName, exercises: [buildExercise('ex_1', draft)] }],
    conditionalNotes: [],
  });
}

const swap = <T>(items: readonly T[], at: number, move: Move): readonly T[] | null => {
  const to = move === MoveSchema.enum.up ? at - 1 : at + 1;
  const a = items[at];
  const b = items[to];
  if (at < 0 || a === undefined || b === undefined) return null;
  return items.map((x, i) => (i === at ? b : i === to ? a : x));
};

export const canMove = (items: readonly unknown[], at: number, move: Move): boolean =>
  move === MoveSchema.enum.up ? at > 0 : at >= 0 && at < items.length - 1;

export function moveDay(
  program: Program,
  dayId: string,
  move: Move,
): Result<Program, readonly ProgramIssue[]> {
  const rotation = swap(program.rotation, program.rotation.indexOf(dayId), move);
  return rotation ? checked({ ...program, rotation }) : err([]);
}

export function moveExercise(
  program: Program,
  dayId: string,
  exerciseId: string,
  move: Move,
): Result<Program, readonly ProgramIssue[]> {
  const day = program.days.find((d) => d.id === dayId);
  const exercises = day &&
    swap(day.exercises, day.exercises.findIndex((e) => e.id === exerciseId), move);
  return exercises ? checked(mapDay(program, dayId, (d) => ({ ...d, exercises }))) : err([]);
}

export const canRemove = (program: Program, dayId: string): boolean =>
  (program.days.find((d) => d.id === dayId)?.exercises.length ?? 0) > 1;

export function removeFromDay(
  program: Program,
  dayId: string,
  exerciseId: string,
): Result<Program, readonly ProgramIssue[]> {
  if (!canRemove(program, dayId)) return err([]);
  const next = withoutExercise(program, dayId, exerciseId);
  return next ? checked(next) : err([]);
}

export const canDeleteDay = (program: Program, dayId: string): boolean =>
  program.days.length > 1 && program.days.some((d) => d.id === dayId);

export function deleteDay(
  program: Program,
  dayId: string,
): Result<Program, readonly ProgramIssue[]> {
  const day = program.days.find((d) => d.id === dayId);
  if (!day || !canDeleteDay(program, dayId)) return err([]);
  let next: Program | null = program;
  for (const e of day.exercises) next = next && withoutExercise(next, dayId, e.id);
  if (!next) return err([]);
  return checked({
    ...next,
    rotation: next.rotation.filter((id) => id !== dayId),
    days: next.days.filter((d) => d.id !== dayId),
  });
}

function withoutExercise(program: Program, dayId: string, exerciseId: string): Program | null {
  const definition = exerciseIndex(program).get(exerciseId);
  const day = program.days.find((d) => d.id === dayId);
  if (!definition || !day?.exercises.some((e) => e.id === exerciseId)) return null;
  const definedHere = day.exercises.some((e) => e.id === exerciseId && !('ref' in e));
  let moved = !definedHere;
  const days = program.days.map((d) => {
    if (d.id === dayId) return { ...d, exercises: d.exercises.filter((e) => e.id !== exerciseId) };
    if (moved) return d;
    const at = d.exercises.findIndex((e) => e.id === exerciseId);
    if (at < 0) return d;
    moved = true;
    return { ...d, exercises: d.exercises.map((e, i) => (i === at ? definition : e)) };
  });
  const next: Program = { ...program, days };
  return moved ? next : dropReferences(next, exerciseId);
}

function dropReferences(program: Program, exerciseId: string): Program {
  const pairs = program.intensityPairs.filter((p) => !p.exercises.includes(exerciseId));
  const pairIds = new Set(pairs.map((p) => p.id));
  return {
    ...program,
    intensityPairs: pairs,
    conditionalNotes: program.conditionalNotes.filter((n) =>
      n.exercise !== exerciseId && n.when.exercise !== exerciseId
    ),
    days: program.days.map((d) => ({
      ...d,
      exercises: d.exercises.map((e) => {
        if ('ref' in e || e.intensityGroup === undefined || pairIds.has(e.intensityGroup)) return e;
        return { ...e, intensityGroup: undefined };
      }),
    })),
  };
}

export function addableToDay(program: Program, dayId: string): readonly Exercise[] {
  const inDay = new Set(dayExercises(program, dayId).map((e) => e.id));
  const seen = new Set<string>();
  const result: Exercise[] = [];
  for (const id of program.rotation) {
    for (const e of dayExercises(program, id)) {
      if (inDay.has(e.id) || seen.has(e.id)) continue;
      seen.add(e.id);
      result.push(e);
    }
  }
  return result;
}
