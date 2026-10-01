import { assertNever } from '../../shared/result.ts';
import type { LastResult } from '../../core/history/schema.ts';
import { IntensitySchema } from '../../core/program/schema.ts';
import { ResumeChoiceSchema, type View, WarmupMarkSchema } from '../../core/session/types.ts';
import type { Language } from '../../core/settings/settings.ts';
import type { WarmupLine } from '../../core/workout/plan.ts';
import type { Button, Rendered } from '../../ports/ui.ts';
import { chunk, date, num, weekday } from '../i18n/format.ts';
import { MESSAGES } from './messages.ts';

export type WorkoutView = Extract<View, { type: `workout_${string}` }>;

const { high, low } = IntensitySchema.enum;
const MARK = WarmupMarkSchema.enum;

const text = (value: string, keyboard: Button[][] = []): Rendered => ({
  text: value,
  keyboard,
  replyKeyboard: null,
});

/** Вес подхода: «195», допвес «+25», свой вес «свой вес», без веса — пусто. */
const weightIn = (lang: Language, w: number | null, added: boolean): string =>
  w === null
    ? ''
    : added
    ? (w === 0 ? MESSAGES[lang].bodyweight : `+${num(w, lang)}`)
    : num(w, lang);
const setIn = (lang: Language, w: number | null, reps: number, added: boolean): string =>
  w === null ? `× ${reps}` : `${weightIn(lang, w, added)} × ${reps}`;

export function renderWorkoutView(view: WorkoutView, lang: Language): Rendered {
  const t = MESSAGES[lang];
  const weight = (w: number | null, added: boolean): string => weightIn(lang, w, added);
  const set = (w: number | null, reps: number, added: boolean): string =>
    setIn(lang, w, reps, added);
  const skip: Button = { label: t.skip, action: { type: 'exercise_skip' } };
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
        ...chunk(others, 2),
      ]);
    }
    case 'workout_resume':
      return text(t.resume(view.startedLabel, view.dayName, view.done, view.total), [[
        {
          label: t.continue,
          action: { type: 'resume', choice: ResumeChoiceSchema.enum.continue },
        },
        {
          label: t.finishOld,
          action: { type: 'resume', choice: ResumeChoiceSchema.enum.finish },
        },
      ], [{
        label: t.startNew,
        action: { type: 'resume', choice: ResumeChoiceSchema.enum.new },
      }]]);
    case 'workout_intensity':
      return text(t.intensityAsk(view.exerciseName, view.pairNames[0], view.pairNames[1]), [[
        { label: '100%', action: { type: 'intensity_set', intensity: high } },
        { label: '70%', action: { type: 'intensity_set', intensity: low } },
      ], [skip]]);
    case 'workout_card': {
      const reps = view.repRange ? ` × ${view.repRange.min}–${view.repRange.max}` : '';
      const lines = [
        `🏋️ ${view.exerciseName} (${view.position}/${view.total})`,
        `${t.goal}: ${t.workSets(view.workSets.min, view.workSets.max)}${reps}`,
        view.intensity ? `${t.thisWeek}: ${view.intensity.summary}` : null,
        '',
        view.last
          ? lastLine(view.last, view.addedWeight, view.repRange?.max ?? null, lang)
          : t.noLast,
        view.last?.comment ? `💬 «${view.last.comment}»` : null,
        ...view.notes.map((n) => `📝 ${n}`),
        '',
        view.invalidWeight ? t.invalidWeight : null,
        view.addedWeight ? t.askAdded : t.askWeight,
      ].filter((l) => l !== null);
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
      return text(lines.join('\n'), [...(options.length ? [options] : []), [...toggle, skip]]);
    }
    case 'workout_warmup': {
      const reps = view.repRange ? ` × ${view.repRange.min}–${view.repRange.max}` : '';
      const lines = view.lines.map((l, i) => `${i + 1}. ${warmupLine(l, view.addedWeight, lang)}`);
      const comment = view.lastComment ? `${t.lastWarmupComment(view.lastComment)}\n` : '';
      return text(
        `${comment}${t.warmupFor(weight(view.workLb, view.addedWeight))}${reps}:\n` +
          `${lines.join('\n')}\n\n${t.orWorkSet}`,
        [
          [
            { label: t.warmupFull, action: { type: 'warmup', variant: 'full' } },
            { label: t.warmupDiff, action: { type: 'warmup_diff' } },
          ],
          [
            { label: t.warmupNone, action: { type: 'warmup', variant: 'none' } },
            { label: t.back, action: { type: 'back' } },
          ],
        ],
      );
    }
    case 'workout_warmup_mark': {
      const head = t.markHead(view.step, view.total, warmupLine(view.line, view.addedWeight, lang));
      return text(
        [
          head,
          view.error ? `⚠️ ${t.errors[view.error]}` : null,
          view.editing ? t.markAsk : null,
        ].filter((l) => l !== null).join('\n'),
        [
          [
            { label: t.markDone, action: { type: 'warmup_mark', mark: MARK.done } },
            { label: t.markEdit, action: { type: 'warmup_mark', mark: MARK.edit } },
            { label: t.markSkip, action: { type: 'warmup_mark', mark: MARK.skip } },
          ],
          [{ label: t.back, action: { type: 'back' } }],
        ],
      );
    }
    case 'workout_warmup_comment_prompt':
      return text(t.warmupCommentAsk(view.exerciseName));
    case 'workout_undo_nothing':
      return text(t.undoNothing);
    case 'workout_reps': {
      const head = view.target
        ? t.setTarget(view.setIndex, view.target)
        : `${t.workSet(view.setIndex)} ${
          view.weightLb === null ? '' : `${weight(view.weightLb, view.addedWeight)} `
        }× ?${view.perSideLb === null ? '' : ` (${t.perSide(num(view.perSideLb, lang))})`}`;
      const lines = [
        view.undone
          ? t.undone(set(view.undone.weightLb, view.undone.reps, view.addedWeight))
          : null,
        view.justRecorded
          ? t.recorded(set(view.justRecorded.weightLb, view.justRecorded.reps, view.addedWeight))
          : null,
        view.error ? `⚠️ ${t.errors[view.error]}` : null,
        `${head}${view.overMax ? t.overMax : ''}`,
        view.weightLb === null ? t.askReps : t.askRepsOrWeight,
      ].filter((l) => l !== null);
      const reps = view.options.map((r): Button => ({
        label: String(r),
        action: { type: 'reps_set', reps: r },
      }));
      const extra: Button[] = [
        ...(view.justRecorded ? [{ label: t.fix, action: { type: 'undo' } } satisfies Button] : []),
        ...(view.canCommentWarmup
          ? [{ label: t.warmupComment, action: { type: 'warmup_comment' } } satisfies Button]
          : []),
        ...(view.canBack ? [{ label: t.back, action: { type: 'back' } } satisfies Button] : []),
        ...(view.setIndex === 1 ? [skip] : []),
      ];
      return text(lines.join('\n'), [...chunk(reps, 4), ...(extra.length ? chunk(extra, 2) : [])]);
    }
    case 'workout_after_set':
      return text(
        [
          t.recorded(set(view.recorded.weightLb, view.recorded.reps, view.addedWeight)),
          view.commentSaved ? t.commentSaved : null,
          t.nextSetHint,
        ].filter((l) => l !== null).join('\n'),
        [
          [
            {
              label: `${t.moreSet}${view.nextOverMax ? t.overMax : ''}`,
              action: { type: 'set_more' },
            },
            { label: t.comment, action: { type: 'comment' } },
          ],
          [
            { label: t.fix, action: { type: 'undo' } },
            {
              label: view.lastExercise ? t.finishWorkout : t.nextExercise,
              action: { type: 'exercise_next' },
            },
          ],
        ],
      );
    case 'workout_comment_prompt':
      return text(
        view.exerciseName === null ? t.workoutCommentAsk : t.exerciseCommentAsk(view.exerciseName),
      );
    case 'workout_summary': {
      const items = view.items.map((i) => {
        if (i.skipped) return `${i.name}: ${t.skipped}`;
        const sets = i.sets.every((s) => s.weightLb === null)
          ? i.sets.map((s) => s.reps).join(' / ')
          : i.sets.map((s) => set(s.weightLb, s.reps, i.addedWeight)).join(', ');
        const last = i.last
          ? ` (${t.previous} ${set(i.last.weightLb, i.last.reps, i.addedWeight)})`
          : '';
        return `${i.name}: ${sets || '—'}${last}`;
      });
      return text(
        [
          t.finished(view.dayName, date(view.localDate, lang), view.minutes),
          ...items,
          view.commentSaved ? `\n${t.workoutCommentSaved}` : null,
        ].filter((l) => l !== null).join('\n'),
        [[
          { label: t.workoutComment, action: { type: 'comment' } },
          { label: t.done, action: { type: 'workout_done' } },
        ]],
      );
    }
    case 'workout_cancel_confirm':
      return text(t.cancelAsk(view.dayName), [[
        { label: t.cancelYes, action: { type: 'cancel_answer', confirm: true } },
        { label: t.continue, action: { type: 'cancel_answer', confirm: false } },
      ]]);
    case 'workout_commented':
      return text(t.workoutCommentSaved, [[
        { label: t.done, action: { type: 'workout_done' } },
      ]]);
    case 'workout_cancelled':
      return text(t.cancelled);
    case 'workout_none':
      return text(t.none);
    default:
      return assertNever(view);
  }
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
