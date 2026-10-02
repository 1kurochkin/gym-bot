import { assertNever } from '../../shared/result.ts';
import { type SetInputError, SetInputErrorSchema } from '../../core/input/set-input.ts';
import { HistoryNoticeSchema, type View } from '../../core/session/types.ts';
import type { Language } from '../../core/settings/settings.ts';
import { HISTORY_PAGE_SIZE } from '../../core/workout/schema.ts';
import type { Button, Rendered } from '../../ports/ui.ts';
import { column, date, weekday } from '../i18n/format.ts';
import { setIn, summaryLine } from '../workout/views.ts';

export type HistoryView = Extract<View, { type: `history_${string}` }>;

const E = SetInputErrorSchema.enum;
const N = HistoryNoticeSchema.enum;

const ru = {
  empty: 'Тренировок пока нет.',
  title: 'Тренировки:',
  deleted: '✅ Тренировка удалена.\n',
  older: '← Раньше',
  newer: 'Позже →',
  back: '← Назад',
  toList: '← К списку',
  edit: (name: string) => `✏️ ${name}`,
  deleteWorkout: '🗑 Удалить тренировку',
  addSet: '➕ Подход',
  deleteSet: '🗑 Удалить подход',
  noSets: 'Рабочих подходов нет.',
  exercise: (name: string, d: string) => `${name}, ${d}`,
  notices: { [N.fixed]: '✅ Исправлено.', [N.added]: '✅ Добавил.', [N.deleted]: '✅ Удалил.' },
  setNow: (i: number, set: string) => `Подход ${i}: ${set}.`,
  askFix: 'Напиши, как было: 7 — повторения, 185/7 — вес и повторения.',
  askFixReps: 'Напиши, сколько было повторений.',
  askAdd: (i: number) => `Подход ${i}. Напиши его: 185/7.`,
  askAddReps: (i: number) => `Подход ${i}. Напиши повторения.`,
  confirmSet: (i: number, set: string) => `Удалить подход ${i}: ${set}?`,
  confirmWorkout: (d: string, day: string) =>
    `Удалить тренировку ${d} «${day}»? Все её подходы удалятся.`,
  yes: 'Удалить',
  no: 'Отмена',
  errors: {
    [E.reps_required]: 'Не хватает повторений: например 185/7.',
    [E.reps_out_of_range]: 'Повторений должно быть от 1 до 100.',
    [E.weight_out_of_range]: 'Вес — от 0 до 1500 lb.',
    [E.weight_required]: 'Нужен вес и повторения, например 185/7.',
    [E.weight_not_allowed]: 'Здесь вес не пишется, только повторения.',
    [E.empty]: 'Не понял. Напиши 7 или 185/7.',
    [E.not_recognized]: 'Не понял. Напиши 7 или 185/7.',
  } satisfies Record<SetInputError, string>,
};

const en: typeof ru = {
  empty: 'No workouts yet.',
  title: 'Workouts:',
  deleted: '✅ Workout deleted.\n',
  older: '← Older',
  newer: 'Newer →',
  back: '← Back',
  toList: '← To the list',
  edit: (name: string) => `✏️ ${name}`,
  deleteWorkout: '🗑 Delete workout',
  addSet: '➕ Set',
  deleteSet: '🗑 Delete set',
  noSets: 'No working sets.',
  exercise: (name: string, d: string) => `${name}, ${d}`,
  notices: { [N.fixed]: '✅ Fixed.', [N.added]: '✅ Added.', [N.deleted]: '✅ Deleted.' },
  setNow: (i: number, set: string) => `Set ${i}: ${set}.`,
  askFix: 'Type what it was: 7 — reps, 185/7 — weight and reps.',
  askFixReps: 'Type how many reps it was.',
  askAdd: (i: number) => `Set ${i}. Type it: 185/7.`,
  askAddReps: (i: number) => `Set ${i}. Type the reps.`,
  confirmSet: (i: number, set: string) => `Delete set ${i}: ${set}?`,
  confirmWorkout: (d: string, day: string) =>
    `Delete the ${d} “${day}” workout? All its sets will be deleted.`,
  yes: 'Delete',
  no: 'Cancel',
  errors: {
    [E.reps_required]: 'Reps are missing: e.g. 185/7.',
    [E.reps_out_of_range]: 'Reps must be from 1 to 100.',
    [E.weight_out_of_range]: 'Weight must be from 0 to 1500 lb.',
    [E.weight_required]: 'I need weight and reps, e.g. 185/7.',
    [E.weight_not_allowed]: 'No weight here, just reps.',
    [E.empty]: 'Didn’t get that. Type 7 or 185/7.',
    [E.not_recognized]: 'Didn’t get that. Type 7 or 185/7.',
  },
};

const MESSAGES: Record<Language, typeof ru> = { ru, en };

const text = (value: string, keyboard: Button[][] = []): Rendered => ({
  text: value,
  keyboard,
  replyKeyboard: null,
});

export function renderHistoryView(view: HistoryView, lang: Language): Rendered {
  const t = MESSAGES[lang];
  const back: Button = { label: t.back, action: { type: 'back' } };
  switch (view.type) {
    case 'history_list': {
      const head = view.deleted ? t.deleted : '';
      const pages: Button[] = [
        ...(view.hasMore
          ? [
            {
              label: t.older,
              action: { type: 'history_page', offset: view.offset + HISTORY_PAGE_SIZE },
            } satisfies Button,
          ]
          : []),
        ...(view.offset > 0
          ? [
            {
              label: t.newer,
              action: {
                type: 'history_page',
                offset: Math.max(0, view.offset - HISTORY_PAGE_SIZE),
              },
            } satisfies Button,
          ]
          : []),
      ];
      if (view.items.length === 0) return text(`${head}${t.empty}`, column(pages));
      return text(`${head}${t.title}`, [
        ...view.items.map((i): Button[] => [{
          label: `${weekday(i.localDate, lang)} ${date(i.localDate, lang)} · ${i.dayName}`,
          action: { type: 'history_workout', id: i.id },
        }]),
        ...column(pages),
      ]);
    }
    case 'history_workout':
      return text(
        [
          `${weekday(view.localDate, lang)} ${date(view.localDate, lang)} — ${view.dayName}`,
          ...view.items.map((i) => summaryLine(i, lang)),
        ].join('\n'),
        [
          ...column(
            view.exercises.map((e): Button => ({
              label: t.edit(e.name),
              action: { type: 'history_log', id: e.logId },
            })),
          ),
          ...column<Button>([
            { label: t.deleteWorkout, action: { type: 'history_delete' } },
            { label: t.toList, action: { type: 'back' } },
          ]),
        ],
      );
    case 'history_exercise': {
      const lines = [
        view.notice ? t.notices[view.notice] : null,
        t.exercise(view.name, date(view.localDate, lang)),
        view.sets.length ? null : t.noSets,
      ].filter((l) => l !== null);
      return text(lines.join('\n'), [
        ...column(
          view.sets.map((s): Button => ({
            label: `${s.index}: ${setIn(lang, s.weightLb, s.reps, view.addedWeight)}`,
            action: { type: 'history_set', id: s.id },
          })),
        ),
        ...column<Button>([{ label: t.addSet, action: { type: 'history_add' } }, back]),
      ]);
    }
    case 'history_set': {
      const head = view.set
        ? `${
          t.setNow(view.index, setIn(lang, view.set.weightLb, view.set.reps, view.addedWeight))
        }\n${view.weightless ? t.askFixReps : t.askFix}`
        : view.weightless
        ? t.askAddReps(view.index)
        : t.askAdd(view.index);
      return text(
        [view.error ? `⚠️ ${t.errors[view.error]}` : null, head].filter((l) => l !== null)
          .join('\n'),
        column<Button>(
          view.set ? [{ label: t.deleteSet, action: { type: 'history_delete' } }, back] : [back],
        ),
      );
    }
    case 'history_delete_set':
      return text(
        t.confirmSet(view.index, setIn(lang, view.set.weightLb, view.set.reps, view.addedWeight)),
        column<Button>([
          { label: t.yes, action: { type: 'history_confirm', confirm: true } },
          { label: t.no, action: { type: 'history_confirm', confirm: false } },
        ]),
      );
    case 'history_delete_workout':
      return text(
        t.confirmWorkout(date(view.localDate, lang), view.dayName),
        column<Button>([
          { label: t.yes, action: { type: 'history_confirm', confirm: true } },
          { label: t.no, action: { type: 'history_confirm', confirm: false } },
        ]),
      );
    default:
      return assertNever(view);
  }
}
