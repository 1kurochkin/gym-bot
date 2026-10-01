import { assertNever } from '../../shared/result.ts';
import type { LastResult } from '../../core/history/schema.ts';
import { type SetInputError, SetInputErrorSchema } from '../../core/input/set-input.ts';
import type { View } from '../../core/session/types.ts';
import type { Language } from '../../core/settings/settings.ts';
import type { Button, Rendered } from '../../ports/ui.ts';
import { date, num } from '../i18n/format.ts';

export type SeedView = Extract<View, { type: 'seed_prompt' | 'seed_done' | 'needs_program' }>;

const E = SetInputErrorSchema.enum;
const text = (value: string): Rendered => ({ text: value, keyboard: [], replyKeyboard: null });

const ru = {
  exampleAdded: '+25x8 или 0x8 — свой вес',
  example: '185x8 или 185/8',
  now: 'Сейчас',
  ask: (example: string) =>
    `Последний рабочий результат? Напиши вес и повторения: ${example}. Можно с комментарием.`,
  keep: 'Оставить',
  noData: 'Нет данных',
  stop: 'Закончить',
  done: (filled: number, total: number) =>
    `Готово: записал ${filled} из ${total}. Это будет «прошлым разом» на тренировке.`,
  nothing: 'Ничего не записал. Вернуться можно в любой момент: /seed',
  needsProgram: 'Сначала загрузи программу: /program',
  errors: {
    [E.weight_required]: 'Нужен вес и повторения, например 185x8.',
    [E.reps_required]: 'Не хватает повторений: напиши вес и повторения, например 185x8.',
    [E.reps_out_of_range]: 'Повторений должно быть от 1 до 100.',
    [E.weight_out_of_range]: 'Вес — от 0 до 1500 lb.',
    [E.weight_not_allowed]: 'Здесь вес не пишется, только повторения.',
    [E.empty]: 'Не понял. Формат: вес и повторения, например 185x8.',
    [E.not_recognized]: 'Не понял. Формат: вес и повторения, например 185x8.',
  } satisfies Record<SetInputError, string>,
};

const en: typeof ru = {
  exampleAdded: '+25x8, or 0x8 for bodyweight',
  example: '185x8 or 185/8',
  now: 'Now',
  ask: (example: string) =>
    `Your latest working set? Type weight and reps: ${example}. A comment can follow.`,
  keep: 'Keep',
  noData: 'No data',
  stop: 'Finish',
  done: (filled: number, total: number) =>
    `Done: saved ${filled} of ${total}. These will show as “last time” in your workout.`,
  nothing: 'Nothing saved. You can come back any time: /seed',
  needsProgram: 'Upload a program first: /program',
  errors: {
    [E.weight_required]: 'I need weight and reps, e.g. 185x8.',
    [E.reps_required]: 'Reps are missing: type weight and reps, e.g. 185x8.',
    [E.reps_out_of_range]: 'Reps must be from 1 to 100.',
    [E.weight_out_of_range]: 'Weight must be from 0 to 1500 lb.',
    [E.weight_not_allowed]: 'No weight here, just reps.',
    [E.empty]: 'Didn’t get that. Format: weight and reps, e.g. 185x8.',
    [E.not_recognized]: 'Didn’t get that. Format: weight and reps, e.g. 185x8.',
  },
};

const MESSAGES: Record<Language, typeof ru> = { ru, en };

export function renderSeedView(view: SeedView, lang: Language): Rendered {
  const t = MESSAGES[lang];
  switch (view.type) {
    case 'seed_prompt': {
      const lines = [
        `${view.exerciseName} (${view.position}/${view.total})`,
        view.current ? `${t.now}: ${formatResult(view.current, view.addedWeight, lang)}` : null,
        '',
        view.error ? `⚠️ ${t.errors[view.error]}` : null,
        t.ask(view.addedWeight ? t.exampleAdded : t.example),
      ].filter((l) => l !== null);
      const buttons: Button[] = [
        { label: view.current ? t.keep : t.noData, action: { type: 'seed_next' } },
        { label: t.stop, action: { type: 'seed_stop' } },
      ];
      return { text: lines.join('\n'), keyboard: [buttons], replyKeyboard: null };
    }
    case 'seed_done':
      return text(view.filled > 0 ? t.done(view.filled, view.total) : t.nothing);
    case 'needs_program':
      return text(t.needsProgram);
    default:
      return assertNever(view);
  }
}

/** «185 × 8 (22.09)», для допвеса «+25 × 8», без веса — «× 20». */
function formatResult(r: LastResult, addedWeight: boolean, lang: Language): string {
  const w = r.weightLb === null
    ? ''
    : addedWeight
    ? `+${num(r.weightLb, lang)} `
    : `${num(r.weightLb, lang)} `;
  return `${w}× ${r.reps} (${date(r.localDate, lang)})`;
}
