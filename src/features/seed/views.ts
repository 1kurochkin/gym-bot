import { assertNever } from '../../shared/result.ts';
import type { LastResult } from '../../core/history/schema.ts';
import { type SetInputError, SetInputErrorSchema } from '../../core/input/set-input.ts';
import type { View } from '../../core/session/types.ts';
import type { Button, Rendered } from '../../ports/ui.ts';

export type SeedView = Extract<View, { type: 'seed_prompt' | 'seed_done' | 'needs_program' }>;

const E = SetInputErrorSchema.enum;
const text = (value: string): Rendered => ({ text: value, keyboard: [], replyKeyboard: null });

export function renderSeedView(view: SeedView): Rendered {
  switch (view.type) {
    case 'seed_prompt': {
      const example = view.addedWeight ? '+25x8 или 0x8 — свой вес' : '185x8 или 185/8';
      const lines = [
        `${view.exerciseName} (${view.position}/${view.total})`,
        view.current ? `Сейчас: ${formatResult(view.current, view.addedWeight)}` : null,
        '',
        view.error ? `⚠️ ${errorText(view.error)}` : null,
        `Последний рабочий результат? Напиши вес и повторения: ${example}. Можно с комментарием.`,
      ].filter((l) => l !== null);
      const buttons: Button[] = [
        view.current
          ? { label: 'Оставить', action: { type: 'seed_next' } }
          : { label: 'Нет данных', action: { type: 'seed_next' } },
        { label: 'Закончить', action: { type: 'seed_stop' } },
      ];
      return { text: lines.join('\n'), keyboard: [buttons], replyKeyboard: null };
    }
    case 'seed_done':
      return text(
        view.filled > 0
          ? `Готово: записал ${view.filled} из ${view.total}. Это будет «прошлым разом» на тренировке.`
          : 'Ничего не записал. Вернуться можно в любой момент: /seed',
      );
    case 'needs_program':
      return text('Сначала загрузи программу: /program');
    default:
      return assertNever(view);
  }
}

/** «185 × 8 (22.09)», для допвеса «+25 × 8», без веса — «× 20». */
function formatResult(r: LastResult, addedWeight: boolean): string {
  const [, m, d] = r.localDate.split('-');
  const weight = r.weightLb === null ? '' : addedWeight ? `+${r.weightLb} ` : `${r.weightLb} `;
  return `${weight}× ${r.reps} (${d}.${m})`;
}

function errorText(error: SetInputError): string {
  switch (error) {
    case E.weight_required:
      return 'Нужен вес и повторения, например 185x8.';
    case E.reps_required:
      return 'Не хватает повторений: напиши вес и повторения, например 185x8.';
    case E.reps_out_of_range:
      return 'Повторений должно быть от 1 до 100.';
    case E.weight_out_of_range:
      return 'Вес — от 0 до 1500 lb.';
    case E.weight_not_allowed:
      return 'Здесь вес не пишется, только повторения.';
    case E.empty:
    case E.not_recognized:
      return 'Не понял. Формат: вес и повторения, например 185x8.';
    default:
      return assertNever(error);
  }
}
