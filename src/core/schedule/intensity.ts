import { z } from 'zod';
import {
  type Intensity,
  type IntensityPair,
  IntensitySchema,
  type Program,
} from '../program/schema.ts';
import { type IsoWeek, IsoWeekSchema } from './calendar.ts';

/** Запись истории: какая интенсивность была у упражнения в какую неделю. */
export const IntensityLogSchema = z.object({
  exerciseId: z.string(),
  isoWeek: IsoWeekSchema,
  intensity: IntensitySchema,
}).readonly();
export type IntensityLog = z.infer<typeof IntensityLogSchema>;

export const IntensitySourceSchema = z.enum(['this_week', 'previous_week']);

/** Интенсивность пары на неделю (§6.4). unknown — истории нет, бот спрашивает, кто ведущий. */
export const PairIntensitySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('known'),
    byExercise: z.record(z.string(), IntensitySchema).readonly(),
    source: IntensitySourceSchema,
  }).readonly(),
  z.object({ kind: z.literal('unknown') }).readonly(),
]);
export type PairIntensity = z.infer<typeof PairIntensitySchema>;

const { high, low } = IntensitySchema.enum;
const { this_week, previous_week } = IntensitySourceSchema.enum;
const flip = (i: Intensity): Intensity => (i === high ? low : high);

/** Последняя запись упражнения в неделю (логи — в хронологическом порядке). */
const lastIn = (
  logs: readonly IntensityLog[],
  exerciseId: string,
  week: string,
): Intensity | undefined =>
  logs.filter((l) => l.exerciseId === exerciseId && l.isoWeek === week).at(-1)?.intensity;

/**
 * Правила 1–3 §6.4: на этой неделе одно из пары уже сделано — второе противоположно;
 * иначе — по последней неделе, когда пара выполнялась: кто был на 100%, теперь на 70%.
 */
export function pairIntensity(
  pair: IntensityPair,
  logs: readonly IntensityLog[],
  currentWeek: IsoWeek,
): PairIntensity {
  const [a, b] = pair.exercises;
  const relevant = logs.filter((l) => l.exerciseId === a || l.exerciseId === b);

  const doneA = lastIn(relevant, a, currentWeek);
  const doneB = lastIn(relevant, b, currentWeek);
  if (doneA !== undefined || doneB !== undefined) {
    const ia = doneA ?? flip(doneB ?? high);
    const ib = doneB ?? flip(ia);
    return { kind: 'known', byExercise: { [a]: ia, [b]: ib }, source: this_week };
  }

  const previous = relevant.map((l) => l.isoWeek).filter((w) => w < currentWeek).sort().at(-1);
  if (previous === undefined) return { kind: 'unknown' };
  const lastA = lastIn(relevant, a, previous);
  const lastB = lastIn(relevant, b, previous);
  const ia = lastA !== undefined ? flip(lastA) : lastB ?? high;
  const ib = lastB !== undefined ? flip(lastB) : flip(ia);
  return { kind: 'known', byExercise: { [a]: ia, [b]: ib }, source: previous_week };
}

/** Интенсивность всех упражнений из пар программы на неделю; неизвестные — без ключа. */
export function weekIntensities(
  program: Program,
  logs: readonly IntensityLog[],
  currentWeek: IsoWeek,
): Readonly<Record<string, Intensity>> {
  const result: Record<string, Intensity> = {};
  for (const pair of program.intensityPairs) {
    const p = pairIntensity(pair, logs, currentWeek);
    if (p.kind === 'known') Object.assign(result, p.byExercise);
  }
  return result;
}

/** Заметки к упражнению, чьё условие выполняется на этой неделе (§6.4, правило 7). */
export function activeNotes(
  program: Program,
  exerciseId: string,
  intensities: Readonly<Record<string, Intensity>>,
): readonly string[] {
  return program.conditionalNotes
    .filter((n) =>
      n.exercise === exerciseId && intensities[n.when.exercise] === n.when.intensityThisWeek
    )
    .map((n) => n.text);
}
