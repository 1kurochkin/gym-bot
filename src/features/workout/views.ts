import { assertNever } from '../../shared/result.ts';
import type { LastResult } from '../../core/history/schema.ts';
import { IntensitySchema } from '../../core/program/schema.ts';
import {
  type MenuMark,
  MenuMarkSchema,
  type SummaryItem,
  type View,
  WarmupMarkSchema,
} from '../../core/session/types.ts';
import type { Language } from '../../core/settings/settings.ts';
import type { WarmupLine } from '../../core/workout/plan.ts';
import type { Button, Rendered } from '../../ports/ui.ts';
import { chunk, column, date, num, weekday } from '../i18n/format.ts';
import { MESSAGES } from './messages.ts';

export type WorkoutView = Extract<View, { type: `workout_${string}` }>;

const { high, low } = IntensitySchema.enum;
const MARK = WarmupMarkSchema.enum;
const MENU = MenuMarkSchema.enum;
const MENU_ICON: Record<MenuMark, string> = {
  [MENU.done]: '✅',
  [MENU.started]: '◐',
  [MENU.todo]: '▫️',
};

/** bold — фрагменты текста жирным: название упражнения на его экранах. */
const text = (value: string, keyboard: Button[][] = [], bold: string[] = []): Rendered => ({
  text: value,
  keyboard,
  replyKeyboard: null,
  ...(bold.length ? { bold } : {}),
});

/** Экран упражнения: «🏋️ **Название** 🏋️», пустая строка, тело (US-3). */
const exerciseScreen = (name: string, lines: (string | null)[], keyboard: Button[][]): Rendered =>
  text(
    [`🏋️ ${name} 🏋️`, '', ...lines.filter((l) => l !== null)].join('\n'),
    keyboard,
    [name],
  );

/** Вес подхода: «195», допвес «+25», свой вес «свой вес», без веса — пусто. */
const weightIn = (lang: Language, w: number | null, added: boolean): string =>
  w === null
    ? ''
    : added
    ? (w === 0 ? MESSAGES[lang].bodyweight : `+${num(w, lang)}`)
    : num(w, lang);
export const setIn = (lang: Language, w: number | null, reps: number, added: boolean): string =>
  w === null ? `× ${reps}` : `${weightIn(lang, w, added)} × ${reps}`;

/** Подходы через запятую, без веса — через « / ». */
const setsLine = (
  lang: Language,
  sets: readonly { weightLb: number | null; reps: number }[],
  added: boolean,
): string =>
  sets.every((s) => s.weightLb === null)
    ? sets.map((s) => s.reps).join(' / ')
    : sets.map((s) => setIn(lang, s.weightLb, s.reps, added)).join(', ');

export function renderWorkoutView(view: WorkoutView, lang: Language): Rendered {
  const t = MESSAGES[lang];
  const weight = (w: number | null, added: boolean): string => weightIn(lang, w, added);
  const set = (w: number | null, reps: number, added: boolean): string =>
    setIn(lang, w, reps, added);
  const back: Button = { label: t.back, action: { type: 'back' } };
  switch (view.type) {
    case 'workout_days': {
      const head = view.last
        ? `${
          t.lastWorkout(
            weekday(view.last.localDate, lang),
            date(view.last.localDate, lang),
            view.last.dayName,
          )
        }\n`
        : '';
      const others = view.others.map((d): Button => ({
        label: d.name,
        action: { type: 'day_pick', dayId: d.id },
      }));
      return text(`${head}${t.pickDay}`, [
        [{ label: `▶ ${view.next.name}`, action: { type: 'day_pick', dayId: view.next.id } }],
        ...column(others),
        [back],
      ]);
    }
    case 'workout_menu': {
      const head = t.menuHead(view.dayName, date(view.localDate, lang));
      const lines = view.items.map((i) =>
        `${MENU_ICON[i.mark]} ${i.name}${
          i.sets.length ? ` — ${setsLine(lang, i.sets, i.addedWeight)}` : ''
        }`
      );
      const pick = (id: string, label: string): Button => ({
        label,
        action: { type: 'menu_pick', exerciseId: id },
      });
      const nextItem = view.items.find((i) => i.exerciseId === view.next);
      const rest = view.items.filter((i) => i.exerciseId !== view.next).map((i) =>
        pick(i.exerciseId, `${MENU_ICON[i.mark]} ${i.name}`)
      );
      return text(
        [view.commentSaved ? `${t.workoutCommentSaved}\n` : null, head, ...lines]
          .filter((l) => l !== null).join('\n'),
        [
          ...(nextItem ? [[pick(nextItem.exerciseId, `▶ ${nextItem.name}`)]] : []),
          ...column(rest),
          ...column<Button>([
            { label: t.addExercise, action: { type: 'menu_add' } },
            { label: t.comment, action: { type: 'comment' } },
            { label: t.finishWorkout, action: { type: 'workout_finish' } },
            back,
          ]),
        ],
        [head],
      );
    }
    case 'workout_add':
      return text(view.options.length ? t.addAsk : t.addNone, [
        ...column(
          view.options.map((o): Button => ({
            label: o.name,
            action: { type: 'add_pick', exerciseId: o.id },
          })),
        ),
        [back],
      ]);
    case 'workout_intensity':
      return exerciseScreen(view.exerciseName, [
        t.intensityAsk(view.pairNames[0], view.pairNames[1]),
      ], [[
        { label: '100%', action: { type: 'intensity_set', intensity: high } },
        { label: '70%', action: { type: 'intensity_set', intensity: low } },
      ], [back]]);
    case 'workout_card': {
      const reps = view.repRange ? ` × ${view.repRange.min}–${view.repRange.max}` : '';
      const base = view.options[0];
      const options = view.options.map((w, i): Button => ({
        label: i === 0 || base === undefined
          ? weight(w, view.addedWeight)
          : `${weight(w, view.addedWeight)} (${w > base ? '+' : '−'}${
            num(Math.abs(w - base), lang)
          })`,
        action: { type: 'weight_set', lb: w },
      }));
      const toggle: Button[] = view.intensity
        ? [{
          label: view.intensity.value === high ? t.make70 : t.make100,
          action: { type: 'intensity_set', intensity: view.intensity.value === high ? low : high },
        }]
        : [];
      return exerciseScreen(view.exerciseName, [
        `${t.goal}: ${t.workSets(view.workSets.min, view.workSets.max)}${reps}`,
        view.intensity ? `${t.thisWeek}: ${view.intensity.summary}` : null,
        view.last
          ? lastLine(view.last, view.addedWeight, view.repRange?.max ?? null, lang)
          : t.noLast,
        view.last?.comment ? `💬 «${view.last.comment}»` : null,
        ...view.notes.map((n) => `📝 ${n}`),
        '',
        view.invalidWeight ? t.invalidWeight : null,
        view.addedWeight ? t.askAdded : t.askWeight,
        t.typeWeight,
      ], [...(options.length ? [options] : []), ...column([...toggle, back])]);
    }
    case 'workout_warmup': {
      const reps = view.repRange ? ` × ${view.repRange.min}–${view.repRange.max}` : '';
      const lines = view.lines.map((l, i) => `${i + 1}. ${warmupLine(l, view.addedWeight, lang)}`);
      return exerciseScreen(
        view.exerciseName,
        [
          view.commentSaved ? t.warmupCommentSaved : null,
          view.lastComment ? t.lastWarmupComment(view.lastComment) : null,
          `${t.warmupFor(weight(view.workLb, view.addedWeight))}${reps}:`,
          ...lines,
          '',
          t.orWorkSet,
        ],
        column<Button>([
          { label: t.warmupDone, action: { type: 'warmup', variant: 'full' } },
          { label: t.warmupEdit, action: { type: 'warmup_diff' } },
          { label: t.comment, action: { type: 'warmup_comment' } },
          { label: t.warmupSkip, action: { type: 'warmup', variant: 'none' } },
          back,
        ]),
      );
    }
    case 'workout_warmup_mark':
      return exerciseScreen(
        view.exerciseName,
        [
          t.markHead(view.step, view.total, warmupLine(view.line, view.addedWeight, lang)),
          view.error ? `⚠️ ${t.errors[view.error]}` : null,
          view.editing ? t.markAsk : null,
        ],
        column<Button>([
          { label: t.warmupDone, action: { type: 'warmup_mark', mark: MARK.done } },
          { label: t.warmupEdit, action: { type: 'warmup_mark', mark: MARK.edit } },
          { label: t.warmupSkip, action: { type: 'warmup_mark', mark: MARK.skip } },
          back,
        ]),
      );
    case 'workout_warmup_comment_prompt':
      return exerciseScreen(view.exerciseName, [t.warmupCommentAsk], [[back]]);
    case 'workout_reps': {
      const head = view.target
        ? t.setTarget(view.setIndex, view.target)
        : `${t.workSet(view.setIndex)} ${
          view.weightLb === null ? '' : `${weight(view.weightLb, view.addedWeight)} `
        }× ?${view.perSideLb === null ? '' : ` (${t.perSide(num(view.perSideLb, lang))})`}`;
      const n = view.notice;
      const notice = n === null
        ? null
        : n.kind === 'undone'
        ? t.undone(set(n.set.weightLb, n.set.reps, view.addedWeight))
        : n.kind === 'fixed'
        ? t.fixed(n.index)
        : n.kind === 'deleted'
        ? t.deleted(n.index)
        : t.commentSaved;
      const reps = view.options.map((r): Button => ({
        label: String(r),
        action: { type: 'reps_set', reps: r },
      }));
      return exerciseScreen(view.exerciseName, [
        notice,
        view.recorded.length
          ? t.recordedList(setsLine(lang, view.recorded, view.addedWeight))
          : null,
        view.error ? `⚠️ ${t.errors[view.error]}` : null,
        `${head}${view.overMax ? t.overMax : ''}`,
        view.weightLb === null ? t.typeReps : t.typeSet,
      ], [
        ...chunk(reps, 4),
        ...column<Button>([
          { label: t.comment, action: { type: 'comment' } },
          { label: t.finishExercise, action: { type: 'exercise_finish' } },
          back,
        ]),
      ]);
    }
    case 'workout_set_view':
      return exerciseScreen(
        view.exerciseName,
        [
          t.setHead(view.index, set(view.set.weightLb, view.set.reps, view.addedWeight)),
          view.error ? `⚠️ ${t.errors[view.error]}` : null,
          view.editing ? t.setEditAsk : null,
        ],
        column<Button>([
          { label: t.setEdit, action: { type: 'set_edit' } },
          { label: t.setDelete, action: { type: 'set_delete' } },
          { label: t.forward(view.current), action: { type: 'set_forward' } },
          { label: view.index > 1 ? t.toSet(view.index - 1) : t.toMenu, action: { type: 'back' } },
        ]),
      );
    case 'workout_comment_prompt':
      return view.exerciseName === null
        ? text(t.workoutCommentAsk, [[back]])
        : text(t.exerciseCommentAsk(view.exerciseName), [[back]]);
    case 'workout_summary': {
      const items = view.items.map((i) => summaryLine(i, lang));
      return text(
        [
          t.finished(view.dayName, date(view.localDate, lang), view.minutes),
          ...items,
          view.commentSaved ? `\n${t.workoutCommentSaved}` : null,
        ].filter((l) => l !== null).join('\n'),
        column<Button>([
          { label: t.workoutComment, action: { type: 'comment' } },
          { label: t.done, action: { type: 'workout_done' } },
        ]),
      );
    }
    case 'workout_cancel_confirm':
      return text(
        t.cancelAsk(view.dayName),
        column<Button>([
          { label: t.cancelYes, action: { type: 'cancel_answer', confirm: true } },
          { label: t.continue, action: { type: 'cancel_answer', confirm: false } },
        ]),
      );
    case 'workout_commented':
      return text(t.workoutCommentSaved, [[
        { label: t.done, action: { type: 'workout_done' } },
      ]]);
    case 'workout_cancelled':
      return text(t.cancelled);
    case 'workout_none':
      return text(t.none);
    case 'workout_undo_nothing':
      return text(t.undoNothing);
    case 'workout_empty_deleted':
      return text(t.emptyDeleted);
    default:
      return assertNever(view);
  }
}

/** «Жим на наклонной: 195 × 7, 195 × 6 (прошлый 185 × 9)», пресс — «20 / 18 / 15». */
export function summaryLine(i: SummaryItem, lang: Language): string {
  const t = MESSAGES[lang];
  const name = i.replaces ? `${i.name} (${t.insteadOf(i.replaces)})` : i.name;
  if (i.skipped) return `${name}: ${t.skipped}`;
  const last = i.last
    ? ` (${t.previous} ${setIn(lang, i.last.weightLb, i.last.reps, i.addedWeight)})`
    : '';
  return `${name}: ${setsLine(lang, i.sets, i.addedWeight) || '—'}${last}`;
}

/** «Прошлый раз (15.09): 185 × 9 — выше диапазона». */
function lastLine(last: LastResult, added: boolean, max: number | null, lang: Language): string {
  const t = MESSAGES[lang];
  const above = max !== null && last.reps > max ? t.aboveRange : '';
  return `${
    t.lastTime(date(last.localDate, lang), setIn(lang, last.weightLb, last.reps, added))
  }${above}`;
}

function warmupLine(l: WarmupLine, added: boolean, lang: Language): string {
  const t = MESSAGES[lang];
  const weight = (w: number, a: boolean): string => weightIn(lang, w, a);
  const side = l.perSideLb === null ? '' : ` (${t.perSide(num(l.perSideLb, lang))})`;
  switch (l.label) {
    case 'assisted':
      return `${t.assisted} × ${l.reps}`;
    case 'bodyweight':
      return `${t.bodyweight} × ${l.reps}`;
    case 'empty_bar':
      return `${num(l.weightLb, lang)} × ${l.reps} (${t.emptyBar})`;
    case 'overload':
      return `${weight(l.weightLb, added)} × ${l.reps}${side} ${t.overload}`;
    case 'regular':
      return `${weight(l.weightLb, added)} × ${l.reps}${side}`;
    default:
      return assertNever(l.label);
  }
}
