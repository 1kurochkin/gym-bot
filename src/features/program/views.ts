import { assertNever } from '../../shared/result.ts';
import type { ProgramSummary } from '../../core/program/program.ts';
import { FileProblemSchema, type View } from '../../core/session/types.ts';
import type { Rendered } from '../../ports/ui.ts';

export type ProgramView = Extract<
  View,
  {
    type:
      | 'program_status'
      | 'program_invalid'
      | 'program_confirm'
      | 'program_saved'
      | 'program_unchanged'
      | 'program_cancelled'
      | 'program_file_rejected';
  }
>;

/** Сколько ошибок программы показывать списком; остальные — числом. */
const MAX_ISSUES = 10;
const HOW_TO_SEND =
  'Пришли JSON программы файлом (.json). Небольшую программу можно прислать текстом одним сообщением.';
const { too_large, not_json, download_failed } = FileProblemSchema.enum;

const text = (value: string): Rendered => ({ text: value, keyboard: [], replyKeyboard: null });

export function renderProgramView(view: ProgramView): Rendered {
  switch (view.type) {
    case 'program_status':
      return text(
        view.current
          ? `Текущая программа: ${
            describe(view.current)
          }\n\nЧтобы заменить — пришли новый JSON файлом.`
          : `Программы пока нет.\n\n${HOW_TO_SEND}`,
      );
    case 'program_invalid': {
      const shown = view.issues.slice(0, MAX_ISSUES).map((i) => `• ${i.path}: ${i.message}`);
      const more = view.issues.length - shown.length;
      return text(
        `Программа не принята — ${plural(view.issues.length, 'ошибка', 'ошибки', 'ошибок')}:\n` +
          shown.join('\n') + (more > 0 ? `\n…и ещё ${more}` : '') +
          '\n\nИсправь и пришли снова.',
      );
    }
    case 'program_confirm':
      return {
        text: `Новая программа: ${describe(view.incoming)}\n\n` +
          `Текущая программа «${view.currentName}» будет архивирована, история сохранится.`,
        keyboard: [[
          { label: 'Заменить', action: { type: 'program_confirm' } },
          { label: 'Отмена', action: { type: 'program_cancel' } },
        ]],
        replyKeyboard: null,
      };
    case 'program_saved':
      return text(
        `Программа сохранена: ${describe(view.summary)}\n\nДальше — стартовые веса: /seed`,
      );
    case 'program_unchanged':
      return text('Программа не изменилась — ничего не сохранял.');
    case 'program_cancelled':
      return text('Отменено. Текущая программа осталась.');
    case 'program_file_rejected':
      switch (view.reason) {
        case too_large:
          return text('Файл больше 100 КБ — программа столько весить не должна.');
        case not_json:
          return text(`Нужен файл .json. ${HOW_TO_SEND}`);
        case download_failed:
          return text('Не получилось скачать файл из Telegram. Пришли его ещё раз.');
        default:
          return assertNever(view.reason);
      }
    default:
      return assertNever(view);
  }
}

/** «6 базовых, 5 дней» — 5 дней, 10 упражнений. Дни: … */
function describe(s: ProgramSummary): string {
  return `«${s.name}» — ${plural(s.days, 'день', 'дня', 'дней')}, ` +
    `${plural(s.exercises, 'упражнение', 'упражнения', 'упражнений')}. Дни: ${
      s.dayNames.join(', ')
    }.`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11
    ? one
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
    ? few
    : many;
  return `${n} ${word}`;
}
