import { assertNever } from '../../shared/result.ts';
import type { ProgramSummary } from '../../core/program/program.ts';
import { FileProblemSchema, type View } from '../../core/session/types.ts';
import type { Language } from '../../core/settings/settings.ts';
import type { Rendered } from '../../ports/ui.ts';
import { issueText, MESSAGES } from './messages.ts';

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
const { too_large, not_json, download_failed } = FileProblemSchema.enum;

const text = (value: string): Rendered => ({ text: value, keyboard: [], replyKeyboard: null });

export function renderProgramView(view: ProgramView, lang: Language): Rendered {
  const t = MESSAGES[lang];
  const describe = (s: ProgramSummary): string =>
    t.describe(s.name, s.days, s.exercises, s.dayNames.join(', '));
  switch (view.type) {
    case 'program_status':
      return text(view.current ? t.current(describe(view.current)) : `${t.none}\n\n${t.howToSend}`);
    case 'program_invalid': {
      const shown = view.issues.slice(0, MAX_ISSUES).map((i) => `• ${issueText(i, lang)}`);
      const more = view.issues.length - shown.length;
      return text(
        `${t.invalid(view.issues.length)}\n` + shown.join('\n') +
          (more > 0 ? `\n${t.more(more)}` : '') + `\n\n${t.fixAndResend}`,
      );
    }
    case 'program_confirm':
      return {
        text: t.incoming(describe(view.incoming), view.currentName),
        keyboard: [[
          { label: t.replace, action: { type: 'program_confirm' } },
          { label: t.cancel, action: { type: 'program_cancel' } },
        ]],
        replyKeyboard: null,
      };
    case 'program_saved':
      return text(t.saved(describe(view.summary)));
    case 'program_unchanged':
      return text(t.unchanged);
    case 'program_cancelled':
      return text(t.cancelled);
    case 'program_file_rejected':
      switch (view.reason) {
        case too_large:
          return text(t.tooLarge);
        case not_json:
          return text(`${t.notJson} ${t.howToSend}`);
        case download_failed:
          return text(t.downloadFailed);
        default:
          return assertNever(view.reason);
      }
    default:
      return assertNever(view);
  }
}
