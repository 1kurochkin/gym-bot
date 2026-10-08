import { z } from 'zod';
import { err, type Result } from '../../shared/result.ts';
import { dayExercises, exerciseIndex, parseProgram, type ProgramIssue } from './program.ts';
import { type Day, type Exercise, LoadTypeSchema, type Program, RangeSchema } from './schema.ts';

export const NAME_MAX = 60;
const SETS_MAX = 20;
const REPS_MAX = 100;

const { barbell, machine, weighted_bodyweight, reps_only } = LoadTypeSchema.enum;

export const NewExerciseTypeSchema = LoadTypeSchema.extract([
  barbell,
  machine,
  weighted_bodyweight,
  reps_only,
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

export function parseExerciseName(text: string): string | null {
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

export function parseGoal(text: string, type: NewExerciseType): Goal | null {
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

function buildExercise(id: string, draft: NewExercise): Exercise {
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
  }
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

export function addNewExercise(
  program: Program,
  dayId: string,
  draft: NewExercise,
): Result<Program, readonly ProgramIssue[]> {
  const exercise = buildExercise(nextExerciseId(program), draft);
  return checked(mapDay(program, dayId, (d) => ({ ...d, exercises: [...d.exercises, exercise] })));
}

export function addFromProgram(
  program: Program,
  dayId: string,
  exerciseId: string,
): Result<Program, readonly ProgramIssue[]> {
  if (!exerciseIndex(program).has(exerciseId)) return err([]);
  if (dayExercises(program, dayId).some((e) => e.id === exerciseId)) return err([]);
  return checked(
    mapDay(program, dayId, (d) => ({
      ...d,
      exercises: [...d.exercises, { id: exerciseId, ref: true }],
    })),
  );
}

export const canRemove = (program: Program, dayId: string): boolean =>
  (program.days.find((d) => d.id === dayId)?.exercises.length ?? 0) > 1;

export function removeFromDay(
  program: Program,
  dayId: string,
  exerciseId: string,
): Result<Program, readonly ProgramIssue[]> {
  if (!canRemove(program, dayId)) return err([]);
  const definition = exerciseIndex(program).get(exerciseId);
  const day = program.days.find((d) => d.id === dayId);
  if (!definition || !day?.exercises.some((e) => e.id === exerciseId)) return err([]);
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
  return checked(moved ? next : dropReferences(next, exerciseId));
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
