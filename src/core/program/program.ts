import { z } from 'zod';
import { err, ok, type Result } from '../../shared/result.ts';
import { type Exercise, LoadTypeSchema, type Program, ProgramSchema } from './schema.ts';

/** Проблема в программе: путь поля и понятное сообщение. */
export const ProgramIssueSchema = z.object({ path: z.string(), message: z.string() }).readonly();
export type ProgramIssue = z.infer<typeof ProgramIssueSchema>;

const ru = z.locales.ru();

/**
 * Разбор программы из JSON (.specs/program-format.md). Ошибки — списком, каждая с путём:
 * «days[2].exercises[0].repRange.min: обязательное поле».
 */
export function parseProgram(input: unknown): Result<Program, readonly ProgramIssue[]> {
  const parsed = ProgramSchema.safeParse(input, { error: ru.localeError });
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
    return err([{ path: '(JSON)', message: `не получилось прочитать JSON: ${reason}` }]);
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
    return [{
      path: formatPath(path) || '(корень)',
      message: missing ? 'обязательное поле' : issue.message,
    }];
  });
}

// ---------------------------------------------------------------- перекрёстные проверки

function crossCheck(p: Program): ProgramIssue[] {
  const issues: ProgramIssue[] = [];
  const add = (path: string, message: string): void => {
    issues.push({ path, message });
  };

  const dayIds = new Set<string>();
  p.days.forEach((d, i) => {
    if (dayIds.has(d.id)) add(`days[${i}].id`, `день «${d.id}» уже есть`);
    dayIds.add(d.id);
  });
  p.rotation.forEach((id, i) => {
    if (!dayIds.has(id)) add(`rotation[${i}]`, `нет дня «${id}»`);
  });
  for (const id of dayIds) {
    if (!p.rotation.includes(id)) add('rotation', `день «${id}» не входит в rotation`);
  }

  const defs = new Map<string, Exercise>();
  p.days.forEach((d, di) =>
    d.exercises.forEach((e, ei) => {
      if ('ref' in e) return;
      if (defs.has(e.id)) {
        add(
          `days[${di}].exercises[${ei}]`,
          `упражнение «${e.id}» уже описано; для повтора — {"id": "${e.id}", "ref": true}`,
        );
      }
      defs.set(e.id, e);
    })
  );

  const pairs = new Map(p.intensityPairs.map((pair) => [pair.id, pair]));
  p.days.forEach((d, di) =>
    d.exercises.forEach((e, ei) => {
      const at = `days[${di}].exercises[${ei}]`;
      if ('ref' in e) {
        if (!defs.has(e.id)) add(at, `ссылка на неописанное упражнение «${e.id}»`);
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
    if (a === b) add(`intensityPairs[${i}].exercises`, 'упражнения пары должны различаться');
    pair.exercises.forEach((id, j) => {
      if (!defs.has(id)) add(`intensityPairs[${i}].exercises[${j}]`, `нет упражнения «${id}»`);
    });
  });
  p.conditionalNotes.forEach((note, i) => {
    if (!defs.has(note.exercise)) {
      add(`conditionalNotes[${i}].exercise`, `нет упражнения «${note.exercise}»`);
    }
    if (!defs.has(note.when.exercise)) {
      add(`conditionalNotes[${i}].when.exercise`, `нет упражнения «${note.when.exercise}»`);
    }
  });
  return issues;
}

function checkExercise(
  p: Program,
  e: Exercise,
  at: string,
  pairs: ReadonlyMap<string, { readonly exercises: readonly string[] }>,
  add: (path: string, message: string) => void,
): void {
  const { warmup } = e;
  if (warmup !== null && warmup !== 'tiers' && !(warmup in p.fixedSchemes)) {
    add(`${at}.warmup`, `нет схемы разминки «${warmup}» в fixedSchemes`);
  }
  if (
    e.loadType === LoadTypeSchema.enum.weighted_bodyweight && warmup === 'tiers' &&
    !p.addedWeightTiers
  ) {
    add(`${at}.warmup`, 'для упражнений с допвесом нужны addedWeightTiers');
  }
  if (
    e.loadType === LoadTypeSchema.enum.reps_only && e.setTargets &&
    e.setTargets.length !== e.workSets.max
  ) {
    add(`${at}.setTargets`, `подписей ${e.setTargets.length}, а подходов до ${e.workSets.max}`);
  }
  if (e.intensityGroup !== undefined) {
    const pair = pairs.get(e.intensityGroup);
    if (!pair) add(`${at}.intensityGroup`, `нет пары «${e.intensityGroup}» в intensityPairs`);
    else if (!pair.exercises.includes(e.id)) {
      add(`${at}.intensityGroup`, `упражнения «${e.id}» нет в паре «${e.intensityGroup}»`);
    }
  }
}

function checkAscending(
  thresholds: readonly number[],
  path: string,
  add: (path: string, message: string) => void,
  firstZero: boolean,
): void {
  if (firstZero && thresholds[0] !== 0) {
    add(`${path}[0].minLb`, 'первая ступень должна начинаться с 0');
  }
  thresholds.forEach((v, i) => {
    const prev = thresholds[i - 1];
    if (prev !== undefined && v <= prev) {
      add(`${path}[${i}].minLb`, 'пороги ступеней должны возрастать');
    }
  });
}
