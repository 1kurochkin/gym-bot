import { assertNever } from '../../shared/result.ts';
import type { LastResult } from '../../core/history/schema.ts';
import { type SetInputError, SetInputErrorSchema } from '../../core/input/set-input.ts';
import { IntensitySchema } from '../../core/program/schema.ts';
import { ResumeChoiceSchema, type View } from '../../core/session/types.ts';
import type { WarmupLine } from '../../core/workout/plan.ts';
import type { Button, Rendered } from '../../ports/ui.ts';

export type WorkoutView = Extract<View, { type: `workout_${string}` }>;

const E = SetInputErrorSchema.enum;
const { high, low } = IntensitySchema.enum;

/** 22.5 → «22,5». */
const num = (n: number): string => String(n).replace('.', ',');
/** Вес подхода: «195», допвес «+25», свой вес «свой вес», без веса — пусто. */
const weight = (w: number | null, added: boolean): string =>
  w === null ? '' : added ? (w === 0 ? 'свой вес' : `+${num(w)}`) : num(w);
const set = (w: number | null, reps: number, added: boolean): string =>
  w === null ? `× ${reps}` : `${weight(w, added)} × ${reps}`;
const date = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const weekday = (iso: string): string => WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()] ?? '';

const text = (value: string, keyboard: Button[][] = []): Rendered => ({
  text: value,
  keyboard,
  replyKeyboard: null,
});
const skip: Button = { label: '⏭ Пропустить', action: { type: 'exercise_skip' } };

export function renderWorkoutView(view: WorkoutView): Rendered {
  switch (view.type) {
    case 'workout_days': {
      const head = view.last
        ? `Прошлая тренировка: ${weekday(view.last.localDate)}, ${
          date(view.last.localDate)
        } — ${view.last.dayName}.\n`
        : '';
      const others = view.others.map((d): Button => ({
        label: d.name,
        action: { type: 'day_pick', dayId: d.id },
      }));
      return text(`${head}Выбери день:`, [
        [{ label: `▶ ${view.next.name}`, action: { type: 'day_pick', dayId: view.next.id } }],
        ...chunk(others, 2),
      ]);
    }
    case 'workout_resume':
      return text(
        `Продолжить тренировку от ${view.startedLabel} (${view.dayName}, ${view.done} из ${view.total} ${
          view.total % 10 === 1 && view.total % 100 !== 11 ? 'упражнения' : 'упражнений'
        })?`,
        [[
          {
            label: 'Продолжить',
            action: { type: 'resume', choice: ResumeChoiceSchema.enum.continue },
          },
          {
            label: 'Завершить её',
            action: { type: 'resume', choice: ResumeChoiceSchema.enum.finish },
          },
        ], [{
          label: 'Начать новую',
          action: { type: 'resume', choice: ResumeChoiceSchema.enum.new },
        }]],
      );
    case 'workout_intensity':
      return text(
        `${view.exerciseName}: на этой неделе ещё не ясно, что из пары «${view.pairNames[0]} / ${
          view.pairNames[1]
        }» идёт на 100%. Как делаешь сегодня?`,
        [[
          { label: '100%', action: { type: 'intensity_set', intensity: high } },
          { label: '70%', action: { type: 'intensity_set', intensity: low } },
        ], [skip]],
      );
    case 'workout_card': {
      const reps = view.repRange ? ` × ${view.repRange.min}–${view.repRange.max}` : '';
      const sets = view.workSets.min === view.workSets.max
        ? `${view.workSets.min} ${view.workSets.min === 1 ? 'рабочий' : 'рабочих'}`
        : `${view.workSets.min}–${view.workSets.max} рабочих`;
      const lines = [
        `🏋️ ${view.exerciseName} (${view.position}/${view.total})`,
        `Цель: ${sets}${reps}`,
        view.intensity ? `На этой неделе: ${view.intensity.summary}` : null,
        '',
        view.last
          ? lastLine(view.last, view.addedWeight, view.repRange?.max ?? null)
          : 'Прошлого раза нет.',
        view.last?.comment ? `💬 «${view.last.comment}»` : null,
        ...view.notes.map((n) => `📝 ${n}`),
        '',
        view.invalidWeight ? '⚠️ Не понял вес. Напиши число, например 185.' : null,
        view.addedWeight
          ? 'Допвес сегодня? Нажми или напиши число (0 — свой вес).'
          : 'Рабочий вес сегодня? Нажми или напиши число.',
      ].filter((l) => l !== null);
      const base = view.options[0];
      const options = view.options.map((w, i): Button => ({
        label: i === 0 || base === undefined
          ? weight(w, view.addedWeight)
          : `${weight(w, view.addedWeight)} (${w > base ? '+' : '−'}${num(Math.abs(w - base))})`,
        action: { type: 'weight_set', lb: w },
      }));
      const toggle: Button[] = view.intensity
        ? [{
          label: view.intensity.value === high ? 'Сделать 70%' : 'Сделать 100%',
          action: { type: 'intensity_set', intensity: view.intensity.value === high ? low : high },
        }]
        : [];
      return text(lines.join('\n'), [...(options.length ? [options] : []), [...toggle, skip]]);
    }
    case 'workout_warmup': {
      const reps = view.repRange ? ` × ${view.repRange.min}–${view.repRange.max}` : '';
      const lines = view.lines.map((l, i) => `${i + 1}. ${warmupLine(l, view.addedWeight)}`);
      return text(
        `Разминка под ${weight(view.workLb, view.addedWeight)}${reps}:\n${lines.join('\n')}\n\n` +
          'Или сразу напиши рабочий подход.',
        [[
          { label: '✅ Всё по плану', action: { type: 'warmup', variant: 'full' } },
          { label: '⏭ Без разминки', action: { type: 'warmup', variant: 'none' } },
        ]],
      );
    }
    case 'workout_reps': {
      const head = view.target
        ? `Подход ${view.setIndex} — ${view.target}`
        : `Рабочий подход ${view.setIndex}: ${
          view.weightLb === null ? '' : `${weight(view.weightLb, view.addedWeight)} `
        }× ?`;
      const lines = [
        view.justRecorded
          ? `Записал ${set(view.justRecorded.weightLb, view.justRecorded.reps, view.addedWeight)}.`
          : null,
        view.error ? `⚠️ ${errorText(view.error)}` : null,
        `${head}${view.overMax ? ' (сверх программы)' : ''}`,
        view.weightLb === null
          ? 'Нажми или напиши повторения.'
          : 'Нажми или напиши: 7 — повторения, 185/6 — другой вес.',
      ].filter((l) => l !== null);
      const reps = view.options.map((r): Button => ({
        label: String(r),
        action: { type: 'reps_set', reps: r },
      }));
      return text(lines.join('\n'), [...chunk(reps, 4), ...(view.setIndex === 1 ? [[skip]] : [])]);
    }
    case 'workout_after_set':
      return text(
        [
          `Записал ${set(view.recorded.weightLb, view.recorded.reps, view.addedWeight)}.`,
          view.commentSaved ? '💬 Комментарий сохранён.' : null,
          'Следующий подход можно сразу написать.',
        ].filter((l) => l !== null).join('\n'),
        [
          [
            {
              label: `➕ Ещё подход${view.nextOverMax ? ' (сверх программы)' : ''}`,
              action: { type: 'set_more' },
            },
            { label: '💬 Комментарий', action: { type: 'comment' } },
          ],
          [{
            label: view.lastExercise ? '🏁 Завершить тренировку' : '➡️ Следующее упражнение',
            action: { type: 'exercise_next' },
          }],
        ],
      );
    case 'workout_comment_prompt':
      return text(
        view.exerciseName === null
          ? 'Комментарий к тренировке (самочувствие, сон и т. п.) — напиши текстом.'
          : `Комментарий к «${view.exerciseName}» — напиши текстом. Покажу его в карточке в следующий раз.`,
      );
    case 'workout_summary': {
      const items = view.items.map((i) => {
        if (i.skipped) return `${i.name}: пропущено`;
        const sets = i.sets.every((s) => s.weightLb === null)
          ? i.sets.map((s) => s.reps).join(' / ')
          : i.sets.map((s) => set(s.weightLb, s.reps, i.addedWeight)).join(', ');
        const last = i.last ? ` (прошлый ${set(i.last.weightLb, i.last.reps, i.addedWeight)})` : '';
        return `${i.name}: ${sets || '—'}${last}`;
      });
      return text(
        [
          `Тренировка завершена: ${view.dayName}, ${date(view.localDate)}, ${view.minutes} мин`,
          ...items,
          view.commentSaved ? '\n💬 Комментарий к тренировке сохранён.' : null,
        ].filter((l) => l !== null).join('\n'),
        [[
          { label: '💬 Комментарий к тренировке', action: { type: 'comment' } },
          { label: 'Готово', action: { type: 'workout_done' } },
        ]],
      );
    }
    case 'workout_cancel_confirm':
      return text(`Прервать тренировку «${view.dayName}»? Записанное сохранится.`, [[
        { label: 'Прервать', action: { type: 'cancel_answer', confirm: true } },
        { label: 'Продолжить', action: { type: 'cancel_answer', confirm: false } },
      ]]);
    case 'workout_commented':
      return text('💬 Комментарий к тренировке сохранён.', [[
        { label: 'Готово', action: { type: 'workout_done' } },
      ]]);
    case 'workout_cancelled':
      return text('Тренировка прервана, записанное сохранено. Новая — /workout');
    case 'workout_none':
      return text('Сейчас нет начатой тренировки. Начать — /workout');
    default:
      return assertNever(view);
  }
}

/** «Прошлый раз (15.09): 185 × 9 — выше диапазона». */
function lastLine(last: LastResult, added: boolean, max: number | null): string {
  const above = max !== null && last.reps > max ? ' — выше диапазона' : '';
  return `Прошлый раз (${date(last.localDate)}): ${set(last.weightLb, last.reps, added)}${above}`;
}

function warmupLine(l: WarmupLine, added: boolean): string {
  switch (l.label) {
    case 'assisted':
      return `с помощью (блок/резина) × ${l.reps}`;
    case 'bodyweight':
      return `свой вес × ${l.reps}`;
    case 'empty_bar':
      return `${num(l.weightLb)} × ${l.reps} (пустой гриф)`;
    case 'overload':
      return `${weight(l.weightLb, added)} × ${l.reps}${
        l.perSideLb === null ? '' : ` (по ${num(l.perSideLb)})`
      } перегруз`;
    case 'regular':
      return `${weight(l.weightLb, added)} × ${l.reps}${
        l.perSideLb === null ? '' : ` (по ${num(l.perSideLb)})`
      }`;
    default:
      return assertNever(l.label);
  }
}

function errorText(error: SetInputError): string {
  switch (error) {
    case E.reps_required:
      return 'Не хватает повторений: например 185/6.';
    case E.reps_out_of_range:
      return 'Повторений должно быть от 1 до 100.';
    case E.weight_out_of_range:
      return 'Вес — от 0 до 1500 lb.';
    case E.weight_required:
      return 'Нужен вес и повторения, например 185/6.';
    case E.weight_not_allowed:
      return 'Здесь вес не пишется, только повторения.';
    case E.empty:
    case E.not_recognized:
      return 'Не понял. Напиши повторения (7) или вес и повторения (185/6).';
    default:
      return assertNever(error);
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}
