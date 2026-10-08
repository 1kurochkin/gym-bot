import { assertNever } from '../../shared/result.ts';
import type { ProgramIssue, ProgramProblem } from '../../core/program/program.ts';
import type { Language } from '../../core/settings/settings.ts';
import { pluralEn, pluralRu } from '../i18n/format.ts';

const ru = {
  howToSend:
    'Пришли JSON программы файлом (.json). Небольшую программу можно прислать текстом одним сообщением.',
  current: (d: string) => `Текущая программа: ${d}\n\nЧтобы заменить — пришли новый JSON файлом.`,
  none: 'Программы пока нет.',
  invalid: (n: number) => `Программа не принята — ${pluralRu(n, 'ошибка', 'ошибки', 'ошибок')}:`,
  more: (n: number) => `…и ещё ${n}`,
  fixAndResend: 'Исправь и пришли снова.',
  incoming: (d: string, current: string) =>
    `Новая программа: ${d}\n\nТекущая программа «${current}» будет архивирована, история сохранится.`,
  replace: 'Заменить',
  cancel: 'Отмена',
  saved: (d: string) => `Программа сохранена: ${d}\n\nДальше — стартовые веса: /seed`,
  unchanged: 'Программа не изменилась — ничего не сохранял.',
  cancelled: 'Отменено. Текущая программа осталась.',
  tooLarge: 'Файл больше 100 КБ — программа столько весить не должна.',
  notJson: 'Нужен файл .json.',
  downloadFailed: 'Не получилось скачать файл из Telegram. Пришли его ещё раз.',
  describe: (name: string, days: number, exercises: number, dayNames: string) =>
    `«${name}» — ${pluralRu(days, 'день', 'дня', 'дней')}, ` +
    `${pluralRu(exercises, 'упражнение', 'упражнения', 'упражнений')}. Дни: ${dayNames}.`,
  editor: '📅 Дни и упражнения',
  editorDays: 'Дни программы:',
  back: '← Назад',
  newExercise: '➕ Новое упражнение',
  fromProgram: '➕ Из программы',
  rename: '✏️ Переименовать',
  remove: '🗑 Убрать из дня',
  removeYes: 'Убрать',
  removeNo: 'Отмена',
  goalLine: (type: string, goal: string) => `Тип: ${type} · Цель: ${goal}`,
  setsOnly: (min: number, max: number) =>
    `${min === max ? '' : `${min}–`}${pluralRu(max, 'подход', 'подхода', 'подходов')}`,
  notice: {
    saved: '✅ Сохранено',
    removed: '✅ Убрано',
    added: '✅ Добавлено',
    failed: '⚠️ Не получилось сохранить — программа не изменилась.',
  },
  types: {
    barbell: 'Штанга',
    machine: 'Тренажёр / гантели',
    weighted_bodyweight: 'Свой вес + допвес',
    reps_only: 'Только повторения',
    light_load: 'Лёгкий вес',
  },
  renameAsk: (name: string) => `Новое название для «${name}» (до 60 символов):`,
  nameInvalid: 'Название — от 1 до 60 символов.',
  removeAsk: (exercise: string, day: string) =>
    `Убрать «${exercise}» из дня «${day}»? История упражнения сохранится.`,
  newNameAsk: 'Название нового упражнения (до 60 символов):',
  newTypeAsk: (name: string) => `Какой тип у «${name}»?`,
  goalAsk: 'Подходы × повторения, например 3×8–12 или 1×6',
  setsAsk: 'Сколько подходов? Например 3 или 2–3',
  notUnderstood: 'Не понял.',
  pickAsk: 'Какое упражнение добавить в этот день?',
  pickNone: 'Все упражнения программы уже в этом дне.',
  root: '(корень)',
  problem: (p: ProgramProblem): string => {
    switch (p.code) {
      case 'invalid_json':
        return `не получилось прочитать JSON: ${p.reason}`;
      case 'required':
        return 'обязательное поле';
      case 'wrong_type':
        return `ожидается ${p.expected}`;
      case 'too_small':
        return p.origin === 'array'
          ? `нужно хотя бы ${pluralRu(p.limit, 'элемент', 'элемента', 'элементов')}`
          : p.origin === 'string'
          ? 'не может быть пустым'
          : `должно быть ${p.inclusive ? '≥' : '>'} ${p.limit}`;
      case 'too_big':
        return p.origin === 'array'
          ? `не больше ${pluralRu(p.limit, 'элемента', 'элементов', 'элементов')}`
          : `должно быть ${p.inclusive ? '≤' : '<'} ${p.limit}`;
      case 'unknown_keys':
        return `неизвестное поле: ${p.keys.join(', ')}`;
      case 'not_one_of':
        return `допустимо: ${p.values.join(', ')}`;
      case 'bad_id':
        return 'только латиница в нижнем регистре, цифры, _';
      case 'not_integer':
        return 'нужно целое число';
      case 'not_positive':
        return 'должно быть больше 0';
      case 'min_gt_max':
        return 'min больше max';
      case 'other':
        return p.detail;
      case 'duplicate_day':
        return `день «${p.id}» уже есть`;
      case 'unknown_day':
        return `нет дня «${p.id}»`;
      case 'day_not_in_rotation':
        return `день «${p.id}» не входит в rotation`;
      case 'duplicate_exercise':
        return `упражнение «${p.id}» уже описано; для повтора — {"id": "${p.id}", "ref": true}`;
      case 'unknown_ref':
        return `ссылка на неописанное упражнение «${p.id}»`;
      case 'unknown_exercise':
        return `нет упражнения «${p.id}»`;
      case 'pair_same':
        return 'упражнения пары должны различаться';
      case 'unknown_scheme':
        return `нет схемы разминки «${p.id}» в fixedSchemes`;
      case 'added_tiers_missing':
        return 'для упражнений с допвесом нужны addedWeightTiers';
      case 'set_targets_count':
        return `подписей ${p.count}, а подходов до ${p.max}`;
      case 'unknown_pair':
        return `нет пары «${p.id}» в intensityPairs`;
      case 'not_in_pair':
        return `упражнения «${p.id}» нет в паре «${p.pair}»`;
      case 'first_tier_not_zero':
        return 'первая ступень должна начинаться с 0';
      case 'tiers_not_ascending':
        return 'пороги ступеней должны возрастать';
      default:
        return assertNever(p);
    }
  },
};

const en: typeof ru = {
  howToSend:
    'Send the program JSON as a file (.json). A small program can be sent as text in one message.',
  current: (d: string) => `Current program: ${d}\n\nTo replace it, send a new JSON file.`,
  none: 'No program yet.',
  invalid: (n: number) => `Program rejected — ${pluralEn(n, 'error', 'errors')}:`,
  more: (n: number) => `…and ${n} more`,
  fixAndResend: 'Fix it and send again.',
  incoming: (d: string, current: string) =>
    `New program: ${d}\n\nThe current program “${current}” will be archived; history is kept.`,
  replace: 'Replace',
  cancel: 'Cancel',
  saved: (d: string) => `Program saved: ${d}\n\nNext — starting weights: /seed`,
  unchanged: 'The program hasn’t changed — nothing saved.',
  cancelled: 'Cancelled. The current program stays.',
  tooLarge: 'The file is over 100 KB — a program shouldn’t be that big.',
  notJson: 'I need a .json file.',
  downloadFailed: 'Couldn’t download the file from Telegram. Please send it again.',
  describe: (name: string, days: number, exercises: number, dayNames: string) =>
    `“${name}” — ${pluralEn(days, 'day', 'days')}, ` +
    `${pluralEn(exercises, 'exercise', 'exercises')}. Days: ${dayNames}.`,
  editor: '📅 Days and exercises',
  editorDays: 'Program days:',
  back: '← Back',
  newExercise: '➕ New exercise',
  fromProgram: '➕ From the program',
  rename: '✏️ Rename',
  remove: '🗑 Remove from day',
  removeYes: 'Remove',
  removeNo: 'Cancel',
  goalLine: (type: string, goal: string) => `Type: ${type} · Goal: ${goal}`,
  setsOnly: (min: number, max: number) =>
    min === max ? pluralEn(max, 'set', 'sets') : `${min}–${max} sets`,
  notice: {
    saved: '✅ Saved',
    removed: '✅ Removed',
    added: '✅ Added',
    failed: '⚠️ Couldn’t save — the program is unchanged.',
  },
  types: {
    barbell: 'Barbell',
    machine: 'Machine / dumbbells',
    weighted_bodyweight: 'Bodyweight + added weight',
    reps_only: 'Reps only',
    light_load: 'Light load',
  },
  renameAsk: (name: string) => `New name for “${name}” (up to 60 characters):`,
  nameInvalid: 'The name must be 1 to 60 characters.',
  removeAsk: (exercise: string, day: string) =>
    `Remove “${exercise}” from “${day}”? Its history is kept.`,
  newNameAsk: 'Name of the new exercise (up to 60 characters):',
  newTypeAsk: (name: string) => `What type is “${name}”?`,
  goalAsk: 'Sets × reps, e.g. 3×8–12 or 1×6',
  setsAsk: 'How many sets? E.g. 3 or 2–3',
  notUnderstood: 'Didn’t get that.',
  pickAsk: 'Which exercise to add to this day?',
  pickNone: 'Every exercise of the program is already in this day.',
  root: '(root)',
  problem: (p: ProgramProblem): string => {
    switch (p.code) {
      case 'invalid_json':
        return `couldn’t read JSON: ${p.reason}`;
      case 'required':
        return 'required field';
      case 'wrong_type':
        return `expected ${p.expected}`;
      case 'too_small':
        return p.origin === 'array'
          ? `needs at least ${pluralEn(p.limit, 'item', 'items')}`
          : p.origin === 'string'
          ? 'can’t be empty'
          : `must be ${p.inclusive ? '≥' : '>'} ${p.limit}`;
      case 'too_big':
        return p.origin === 'array'
          ? `at most ${pluralEn(p.limit, 'item', 'items')}`
          : `must be ${p.inclusive ? '≤' : '<'} ${p.limit}`;
      case 'unknown_keys':
        return `unknown field: ${p.keys.join(', ')}`;
      case 'not_one_of':
        return `allowed: ${p.values.join(', ')}`;
      case 'bad_id':
        return 'only lowercase latin letters, digits, _';
      case 'not_integer':
        return 'must be a whole number';
      case 'not_positive':
        return 'must be greater than 0';
      case 'min_gt_max':
        return 'min is greater than max';
      case 'other':
        return p.detail;
      case 'duplicate_day':
        return `day “${p.id}” already exists`;
      case 'unknown_day':
        return `no day “${p.id}”`;
      case 'day_not_in_rotation':
        return `day “${p.id}” is not in rotation`;
      case 'duplicate_exercise':
        return `exercise “${p.id}” is already defined; to repeat it use {"id": "${p.id}", "ref": true}`;
      case 'unknown_ref':
        return `reference to undefined exercise “${p.id}”`;
      case 'unknown_exercise':
        return `no exercise “${p.id}”`;
      case 'pair_same':
        return 'pair exercises must differ';
      case 'unknown_scheme':
        return `no warm-up scheme “${p.id}” in fixedSchemes`;
      case 'added_tiers_missing':
        return 'weighted bodyweight exercises need addedWeightTiers';
      case 'set_targets_count':
        return `${p.count} labels, but up to ${p.max} sets`;
      case 'unknown_pair':
        return `no pair “${p.id}” in intensityPairs`;
      case 'not_in_pair':
        return `exercise “${p.id}” is not in pair “${p.pair}”`;
      case 'first_tier_not_zero':
        return 'the first tier must start at 0';
      case 'tiers_not_ascending':
        return 'tier thresholds must increase';
      default:
        return assertNever(p);
    }
  },
};

export const MESSAGES: Record<Language, typeof ru> = { ru, en };

export function issueText(issue: ProgramIssue, lang: Language): string {
  const t = MESSAGES[lang];
  const where = issue.path || (issue.problem.code === 'invalid_json' ? '(JSON)' : t.root);
  return `${where}: ${t.problem(issue.problem)}`;
}
