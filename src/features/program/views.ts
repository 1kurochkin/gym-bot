import { assertNever } from '../../shared/result.ts';
import type { ProgramSummary } from '../../core/program/program.ts';
import { type EditorExercise, FileProblemSchema, type View } from '../../core/session/types.ts';
import { NewExerciseTypeSchema } from '../../core/program/edit.ts';
import type { Language } from '../../core/settings/settings.ts';
import type { Button, Rendered } from '../../ports/ui.ts';
import { column } from '../i18n/format.ts';
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
      | 'program_file_rejected'
      | 'program_days'
      | 'program_day'
      | 'program_exercise'
      | 'program_rename'
      | 'program_remove_confirm'
      | 'program_new_name'
      | 'program_new_type'
      | 'program_new_goal'
      | 'program_pick';
  }
>;

const MAX_ISSUES = 10;
const { too_large, not_json, download_failed } = FileProblemSchema.enum;

const text = (value: string, keyboard: Button[][] = [], bold: string[] = []): Rendered => ({
  text: value,
  keyboard,
  replyKeyboard: null,
  ...(bold.length ? { bold } : {}),
});

const lines = (...items: (string | null)[]): string => items.filter((l) => l !== null).join('\n');

export function renderProgramView(view: ProgramView, lang: Language): Rendered {
  const t = MESSAGES[lang];
  const describe = (s: ProgramSummary): string =>
    t.describe(s.name, s.days, s.exercises, s.dayNames.join(', '));
  switch (view.type) {
    case 'program_status':
      return view.current
        ? text(t.current(describe(view.current)), [[{
          label: t.editor,
          action: { type: 'editor_open' },
        }]])
        : text(`${t.none}\n\n${t.howToSend}`);
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
        keyboard: [
          [{ label: t.replace, action: { type: 'program_confirm' } }],
          [{ label: t.cancel, action: { type: 'program_cancel' } }],
        ],
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
      return renderEditorView(view, lang);
  }
}

type EditorView = Extract<
  ProgramView,
  {
    type:
      | 'program_days'
      | 'program_day'
      | 'program_exercise'
      | 'program_rename'
      | 'program_remove_confirm'
      | 'program_new_name'
      | 'program_new_type'
      | 'program_new_goal'
      | 'program_pick';
  }
>;

function renderEditorView(view: EditorView, lang: Language): Rendered {
  const t = MESSAGES[lang];
  const back: Button = { label: t.back, action: { type: 'back' } };
  const remove: Button = { label: t.remove, action: { type: 'editor_remove' } };
  const goal = (e: EditorExercise): string =>
    e.repRange === null
      ? t.setsOnly(e.workSets.min, e.workSets.max)
      : `${range(e.workSets.min, e.workSets.max)}×${range(e.repRange.min, e.repRange.max)}`;
  switch (view.type) {
    case 'program_days':
      return text(t.editorDays, [
        ...column(view.days.map((d): Button => ({
          label: d.name,
          action: { type: 'editor_day', dayId: d.id },
        }))),
        [back],
      ]);
    case 'program_day':
      return text(
        lines(
          view.notice ? t.notice[view.notice] : null,
          view.dayName,
          '',
          ...view.exercises.map((e, i) => `${i + 1}. ${e.name} — ${goal(e)}`),
        ),
        [
          ...column(view.exercises.map((e): Button => ({
            label: e.name,
            action: { type: 'editor_exercise', exerciseId: e.id },
          }))),
          [{ label: t.newExercise, action: { type: 'editor_new' } }],
          [{ label: t.fromProgram, action: { type: 'editor_from' } }],
          [back],
        ],
        [view.dayName],
      );
    case 'program_exercise':
      return text(
        lines(
          view.notice ? t.notice[view.notice] : null,
          view.exercise.name,
          t.goalLine(t.types[view.exercise.loadType], goal(view.exercise)),
        ),
        [
          [{ label: t.rename, action: { type: 'editor_rename' } }],
          ...(view.removable ? [[remove]] : []),
          [back],
        ],
        [view.exercise.name],
      );
    case 'program_rename':
      return text(lines(view.invalid ? t.nameInvalid : null, t.renameAsk(view.current)), [[back]]);
    case 'program_remove_confirm':
      return text(t.removeAsk(view.exerciseName, view.dayName), [
        [{ label: t.removeYes, action: { type: 'editor_remove_answer', confirm: true } }],
        [{ label: t.removeNo, action: { type: 'editor_remove_answer', confirm: false } }],
      ]);
    case 'program_new_name':
      return text(lines(view.invalid ? t.nameInvalid : null, t.newNameAsk), [[back]]);
    case 'program_new_type':
      return text(t.newTypeAsk(view.name), [
        ...column(NewExerciseTypeSchema.options.map((loadType): Button => ({
          label: t.types[loadType],
          action: { type: 'editor_type', loadType },
        }))),
        [back],
      ]);
    case 'program_new_goal': {
      const ask = view.repsOnly ? t.setsAsk : t.goalAsk;
      return text(lines(view.name, view.invalid ? `${t.notUnderstood} ${ask}` : ask), [[back]], [
        view.name,
      ]);
    }
    case 'program_pick':
      return view.options.length
        ? text(t.pickAsk, [
          ...column(view.options.map((o): Button => ({
            label: o.name,
            action: { type: 'editor_from_pick', exerciseId: o.id },
          }))),
          [back],
        ])
        : text(t.pickNone, [[back]]);
    default:
      return assertNever(view);
  }
}

const range = (min: number, max: number): string => (min === max ? `${min}` : `${min}–${max}`);
