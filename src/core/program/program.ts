import { z } from 'zod';
import { err, ok, type Result } from '../../shared/result.ts';
import { type Exercise, LoadTypeSchema, type Program, ProgramSchema } from './schema.ts';

/**
 * Что не так в программе: код и параметры, без текста — текст на языке пользователя строит view.
 * Первая группа — нарушения схемы (из zod), вторая — перекрёстные проверки.
 */
export const ProgramProblemSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('invalid_json'), reason: z.string() }).readonly(),
  z.object({ code: z.literal('required') }).readonly(),
  z.object({ code: z.literal('wrong_type'), expected: z.string() }).readonly(),
  z.object({
    code: z.literal('too_small'),
    origin: z.string(),
    limit: z.number(),
    inclusive: z.boolean(),
  }).readonly(),
  z.object({
    code: z.literal('too_big'),
    origin: z.string(),
    limit: z.number(),
    inclusive: z.boolean(),
  }).readonly(),
  z.object({ code: z.literal('unknown_keys'), keys: z.array(z.string()).readonly() }).readonly(),
  z.object({ code: z.literal('not_one_of'), values: z.array(z.string()).readonly() }).readonly(),
  z.object({ code: z.literal('bad_id') }).readonly(),
  z.object({ code: z.literal('not_integer') }).readonly(),
  z.object({ code: z.literal('not_positive') }).readonly(),
  z.object({ code: z.literal('min_gt_max') }).readonly(),
  /** Нарушение, для которого нет своего кода: текст zod как есть. */
  z.object({ code: z.literal('other'), detail: z.string() }).readonly(),
  z.object({ code: z.literal('duplicate_day'), id: z.string() }).readonly(),
  z.object({ code: z.literal('unknown_day'), id: z.string() }).readonly(),
  z.object({ code: z.literal('day_not_in_rotation'), id: z.string() }).readonly(),
  z.object({ code: z.literal('duplicate_exercise'), id: z.string() }).readonly(),
  z.object({ code: z.literal('unknown_ref'), id: z.string() }).readonly(),
  z.object({ code: z.literal('unknown_exercise'), id: z.string() }).readonly(),
  z.object({ code: z.literal('pair_same') }).readonly(),
  z.object({ code: z.literal('unknown_scheme'), id: z.string() }).readonly(),
  z.object({ code: z.literal('added_tiers_missing') }).readonly(),
  z.object({
    code: z.literal('set_targets_count'),
    count: z.number().int(),
    max: z.number().int(),
  }).readonly(),
  z.object({ code: z.literal('unknown_pair'), id: z.string() }).readonly(),
  z.object({ code: z.literal('not_in_pair'), id: z.string(), pair: z.string() }).readonly(),
  z.object({ code: z.literal('first_tier_not_zero') }).readonly(),
  z.object({ code: z.literal('tiers_not_ascending') }).readonly(),
]);
export type ProgramProblem = z.infer<typeof ProgramProblemSchema>;

/** Проблема в программе: путь поля («days[2].exercises[0].repRange.min»; пустой — корень) и что не так. */
export const ProgramIssueSchema = z.object({ path: z.string(), problem: ProgramProblemSchema })
  .readonly();
export type ProgramIssue = z.infer<typeof ProgramIssueSchema>;

/**
 * Разбор программы из JSON (.specs/program-format.md). Ошибки — списком, каждая с путём.
 */
export function parseProgram(input: unknown): Result<Program, readonly ProgramIssue[]> {
  const parsed = ProgramSchema.safeParse(input);
  if (!parsed.success) return err(formatIssues(parsed.error.issues, input, []));
  const issues = crossCheck(parsed.data);
  return issues.length ? err(issues) : ok(parsed.data);
}

/** Разбор программы из текста (файл или сообщение): сначала JSON, затем схема. */
export function parseProgramText(text: string): Result<Program, readonly ProgramIssue[]> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return err([{ path: '', problem: { code: 'invalid_json', reason } }]);
  }
  return parseProgram(json);
}

/** Краткая сводка для ответа бота: «5 дней, 10 упражнений. Дни: …». */
export const ProgramSummarySchema = z.object({
  name: z.string(),
  days: z.number().int().nonnegative(),
  exercises: z.number().int().nonnegative(),
  dayNames: z.array(z.string()).readonly(),
}).readonly();
export type ProgramSummary = z.infer<typeof ProgramSummarySchema>;

export function programSummary(program: Program): ProgramSummary {
  const byId = new Map(program.days.map((d) => [d.id, d.name]));
  return {
    name: program.name,
    days: program.days.length,
    exercises: exerciseIndex(program).size,
    dayNames: program.rotation.map((id) => byId.get(id) ?? id),
  };
}

/** Та же программа по содержанию: сравнение без учёта порядка ключей. */
export const sameProgram = (a: Program, b: Program): boolean => canonical(a) === canonical(b);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) =>
      a < b ? -1 : 1
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Упражнения для /seed: по дням в порядке rotation, каждое один раз, без reps_only (US-6).
 */
export function seedExercises(program: Program): readonly Exercise[] {
  const seen = new Set<string>();
  const result: Exercise[] = [];
  for (const dayId of program.rotation) {
    for (const e of dayExercises(program, dayId)) {
      if (seen.has(e.id) || e.loadType === LoadTypeSchema.enum.reps_only) continue;
      seen.add(e.id);
      result.push(e);
    }
  }
  return result;
}

/** Все упражнения программы по id (описание, а не ссылки). */
export function exerciseIndex(program: Program): ReadonlyMap<string, Exercise> {
  const index = new Map<string, Exercise>();
  for (const day of program.days) {
    for (const e of day.exercises) if (!('ref' in e)) index.set(e.id, e);
  }
  return index;
}

/** Упражнения дня по порядку, со ссылками, заменёнными на описания. */
export function dayExercises(program: Program, dayId: string): readonly Exercise[] {
  const index = exerciseIndex(program);
  const day = program.days.find((d) => d.id === dayId);
  return (day?.exercises ?? []).flatMap((e) => {
    const found = index.get(e.id);
    return found ? [found] : [];
  });
}

// ---------------------------------------------------------------- ошибки схемы

type Key = PropertyKey;

const formatPath = (path: readonly Key[]): string =>
  path.reduce<string>(
    (acc, key) =>
      typeof key === 'number' ? `${acc}[${key}]` : acc ? `${acc}.${String(key)}` : String(key),
    '',
  );

function valueAt(input: unknown, path: readonly Key[]): unknown {
  let cur = input;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = Reflect.get(cur, key);
  }
  return cur;
}

function formatIssues(
  issues: readonly z.core.$ZodIssue[],
  input: unknown,
  prefix: readonly Key[],
): ProgramIssue[] {
  return issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    // Ссылка {id, ref: true} или полное упражнение: показываем ошибки той ветки, которую имели в виду.
    if (issue.code === 'invalid_union' && issue.errors.length === 2) {
      const value = valueAt(input, path);
      const isRef = value !== null && typeof value === 'object' && 'ref' in value;
      return formatIssues(issue.errors[isRef ? 0 : 1] ?? [], input, path);
    }
    const missing = issue.code === 'invalid_type' && valueAt(input, path) === undefined;
    return [{ path: formatPath(path), problem: missing ? { code: 'required' } : problemOf(issue) }];
  });
}

function problemOf(issue: z.core.$ZodIssue): ProgramProblem {
  switch (issue.code) {
    case 'invalid_type':
      return issue.expected === 'int'
        ? { code: 'not_integer' }
        : { code: 'wrong_type', expected: issue.expected };
    case 'too_small':
    case 'too_big':
      return {
        code: issue.code,
        origin: issue.origin,
        limit: Number(issue.code === 'too_small' ? issue.minimum : issue.maximum),
        inclusive: issue.inclusive ?? true,
      };
    case 'unrecognized_keys':
      return { code: 'unknown_keys', keys: issue.keys };
    case 'invalid_value':
      return { code: 'not_one_of', values: issue.values.map((v) => JSON.stringify(v)) };
    case 'invalid_union':
      // Неизвестное значение дискриминатора (loadType): zod перечисляет допустимые.
      return 'options' in issue && issue.options?.length
        ? { code: 'not_one_of', values: issue.options.map((v) => JSON.stringify(v)) }
        : { code: 'other', detail: issue.message };
    case 'invalid_format':
      return issue.format === 'regex'
        ? { code: 'bad_id' }
        : { code: 'other', detail: issue.message };
    case 'custom': {
      const problem: unknown = issue.params?.problem;
      if (problem === 'not_positive') return { code: 'not_positive' };
      if (problem === 'min_gt_max') return { code: 'min_gt_max' };
      return { code: 'other', detail: issue.message };
    }
    default:
      return { code: 'other', detail: issue.message };
  }
}

// ---------------------------------------------------------------- перекрёстные проверки

function crossCheck(p: Program): ProgramIssue[] {
  const issues: ProgramIssue[] = [];
  const add = (path: string, problem: ProgramProblem): void => {
    issues.push({ path, problem });
  };

  const dayIds = new Set<string>();
  p.days.forEach((d, i) => {
    if (dayIds.has(d.id)) add(`days[${i}].id`, { code: 'duplicate_day', id: d.id });
    dayIds.add(d.id);
  });
  p.rotation.forEach((id, i) => {
    if (!dayIds.has(id)) add(`rotation[${i}]`, { code: 'unknown_day', id });
  });
  for (const id of dayIds) {
    if (!p.rotation.includes(id)) add('rotation', { code: 'day_not_in_rotation', id });
  }

  const defs = new Map<string, Exercise>();
  p.days.forEach((d, di) =>
    d.exercises.forEach((e, ei) => {
      if ('ref' in e) return;
      if (defs.has(e.id)) {
        add(`days[${di}].exercises[${ei}]`, { code: 'duplicate_exercise', id: e.id });
      }
      defs.set(e.id, e);
    })
  );

  const pairs = new Map(p.intensityPairs.map((pair) => [pair.id, pair]));
  p.days.forEach((d, di) =>
    d.exercises.forEach((e, ei) => {
      const at = `days[${di}].exercises[${ei}]`;
      if ('ref' in e) {
        if (!defs.has(e.id)) add(at, { code: 'unknown_ref', id: e.id });
        return;
      }
      checkExercise(p, e, at, pairs, add);
    })
  );

  checkAscending(
    p.warmupTiers.byWorkWeight.map((t) => t.minLb),
    'warmupTiers.byWorkWeight',
    add,
    true,
  );
  if (p.addedWeightTiers) {
    checkAscending(
      p.addedWeightTiers.byAddedWeight.map((t) => t.minLb),
      'addedWeightTiers.byAddedWeight',
      add,
      false,
    );
  }

  p.intensityPairs.forEach((pair, i) => {
    const [a, b] = pair.exercises;
    if (a === b) add(`intensityPairs[${i}].exercises`, { code: 'pair_same' });
    pair.exercises.forEach((id, j) => {
      if (!defs.has(id)) {
        add(`intensityPairs[${i}].exercises[${j}]`, { code: 'unknown_exercise', id });
      }
    });
  });
  p.conditionalNotes.forEach((note, i) => {
    if (!defs.has(note.exercise)) {
      add(`conditionalNotes[${i}].exercise`, { code: 'unknown_exercise', id: note.exercise });
    }
    if (!defs.has(note.when.exercise)) {
      add(`conditionalNotes[${i}].when.exercise`, {
        code: 'unknown_exercise',
        id: note.when.exercise,
      });
    }
  });
  return issues;
}

function checkExercise(
  p: Program,
  e: Exercise,
  at: string,
  pairs: ReadonlyMap<string, { readonly exercises: readonly string[] }>,
  add: (path: string, problem: ProgramProblem) => void,
): void {
  const { warmup } = e;
  if (warmup !== null && warmup !== 'tiers' && !(warmup in p.fixedSchemes)) {
    add(`${at}.warmup`, { code: 'unknown_scheme', id: warmup });
  }
  if (
    e.loadType === LoadTypeSchema.enum.weighted_bodyweight && warmup === 'tiers' &&
    !p.addedWeightTiers
  ) {
    add(`${at}.warmup`, { code: 'added_tiers_missing' });
  }
  if (
    e.loadType === LoadTypeSchema.enum.reps_only && e.setTargets &&
    e.setTargets.length !== e.workSets.max
  ) {
    add(`${at}.setTargets`, {
      code: 'set_targets_count',
      count: e.setTargets.length,
      max: e.workSets.max,
    });
  }
  if (e.intensityGroup !== undefined) {
    const pair = pairs.get(e.intensityGroup);
    if (!pair) add(`${at}.intensityGroup`, { code: 'unknown_pair', id: e.intensityGroup });
    else if (!pair.exercises.includes(e.id)) {
      add(`${at}.intensityGroup`, {
        code: 'not_in_pair',
        id: e.id,
        pair: e.intensityGroup,
      });
    }
  }
}

function checkAscending(
  thresholds: readonly number[],
  path: string,
  add: (path: string, problem: ProgramProblem) => void,
  firstZero: boolean,
): void {
  if (firstZero && thresholds[0] !== 0) {
    add(`${path}[0].minLb`, { code: 'first_tier_not_zero' });
  }
  thresholds.forEach((v, i) => {
    const prev = thresholds[i - 1];
    if (prev !== undefined && v <= prev) {
      add(`${path}[${i}].minLb`, { code: 'tiers_not_ascending' });
    }
  });
}
