import { z } from 'zod';
import { err, ok, type Result } from '../../shared/result.ts';
import {
  BLANK_ADDED_TIERS,
  BLANK_WARMUP_TIERS,
  buildExercise,
  CUSTOM_PROGRAM_ID,
  NAME_MAX,
  NewExerciseTypeSchema,
  REPS_MAX,
  SETS_MAX,
} from './edit.ts';
import { parseProgram } from './program.ts';
import { type Day, LoadTypeSchema, type Program, ProgramSchema } from './schema.ts';

export const DraftExerciseSchema = z.strictObject({
  name: z.string(),
  type: NewExerciseTypeSchema,
  setsMin: z.number().int(),
  setsMax: z.number().int(),
  repsMin: z.number().int().nullable(),
  repsMax: z.number().int().nullable(),
  note: z.string().nullable(),
}).readonly();
export type DraftExercise = z.infer<typeof DraftExerciseSchema>;

export const DraftDaySchema = z.strictObject({
  name: z.string(),
  exercises: z.array(DraftExerciseSchema).readonly(),
}).readonly();

export const ProgramDraftSchema = z.strictObject({
  name: z.string(),
  days: z.array(DraftDaySchema).readonly(),
  unparsed: z.array(z.string()).readonly(),
}).readonly();
export type ProgramDraft = z.infer<typeof ProgramDraftSchema>;

export const DraftProblemSchema = z.enum(['empty', 'invalid']);
export type DraftProblem = z.infer<typeof DraftProblemSchema>;

const DEFAULT_REPS = { min: 8, max: 12 };

const cleanName = (text: string): string =>
  text.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX).trim();

function range(a: number, b: number, max: number): { min: number; max: number } {
  const clamp = (v: number): number => Math.min(max, Math.max(1, Math.round(v)));
  const [lo, hi] = [clamp(a), clamp(b)].sort((x, y) => x - y);
  return { min: lo ?? 1, max: hi ?? 1 };
}

function repsOf(e: DraftExercise): { min: number; max: number } | null {
  if (e.type === LoadTypeSchema.enum.reps_only) return null;
  const min = e.repsMin ?? e.repsMax;
  const max = e.repsMax ?? e.repsMin;
  return min === null || max === null ? DEFAULT_REPS : range(min, max, REPS_MAX);
}

export function programFromDraft(draft: ProgramDraft): Result<Program, DraftProblem> {
  const ids = new Map<string, string>();
  const days: Day[] = [];
  for (const d of draft.days) {
    const inDay = new Set<string>();
    const exercises: Day['exercises'][number][] = [];
    for (const e of d.exercises) {
      const name = cleanName(e.name);
      const key = name.toLowerCase();
      if (!name || inDay.has(key)) continue;
      inDay.add(key);
      const known = ids.get(key);
      if (known) {
        exercises.push({ id: known, ref: true });
        continue;
      }
      const id = `ex_${ids.size + 1}`;
      ids.set(key, id);
      const repRange = repsOf(e);
      const built = buildExercise(id, {
        name,
        loadType: e.type,
        goal: { workSets: range(e.setsMin, e.setsMax, SETS_MAX), repRange },
      });
      const note = e.note?.trim();
      exercises.push(note ? { ...built, notes: note } : built);
    }
    const first = exercises[0];
    if (!first) continue;
    const firstName = 'ref' in first ? '' : first.name;
    days.push({
      id: `day_${days.length + 1}`,
      name: cleanName(d.name) || firstName || `${days.length + 1}`,
      exercises,
    });
  }
  const firstDay = days[0];
  if (!firstDay) return err(DraftProblemSchema.enum.empty);
  const parsed = parseProgram({
    schemaVersion: 1,
    id: CUSTOM_PROGRAM_ID,
    name: cleanName(draft.name) || firstDay.name,
    units: 'lb',
    rotation: days.map((d) => d.id),
    warmupTiers: BLANK_WARMUP_TIERS,
    addedWeightTiers: BLANK_ADDED_TIERS,
    days,
  });
  return parsed.ok ? ok(parsed.value) : err(DraftProblemSchema.enum.invalid);
}

export const ConvertFailureSchema = z.enum(['unavailable', 'not_understood']);
export type ConvertFailure = z.infer<typeof ConvertFailureSchema>;

export const ConvertOutcomeSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    program: ProgramSchema,
    unparsed: z.array(z.string()).readonly(),
  }).readonly(),
  z.object({ ok: z.literal(false), reason: ConvertFailureSchema }).readonly(),
]);
export type ConvertOutcome = z.infer<typeof ConvertOutcomeSchema>;
