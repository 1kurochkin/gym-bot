import { assertNever } from '../../shared/result.ts';
import type { ProgramSummary } from '../../core/program/program.ts';
import {
  type EditorExercise,
  type FileProblem,
  FileProblemSchema,
  RenameTargetSchema,
  type View,
} from '../../core/session/types.ts';
import { MoveSchema, NewExerciseTypeSchema } from '../../core/program/edit.ts';
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
      | 'program_pick'
      | 'program_goal'
      | 'program_day_new'
      | 'program_first'
      | 'program_day_delete_confirm'
      | 'program_create'
      | 'program_text_ask'
      | 'program_converting'
      | 'program_draft'
      | 'program_convert_failed';
  }
>;

const MAX_ISSUES = 10;
const { too_large, not_json, download_failed } = FileProblemSchema.enum;
const { up, down } = MoveSchema.enum;
const TARGET = RenameTargetSchema.enum;

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
    case 'program_status': {
      const fromText: Button[][] = view.fromText
        ? [[{ label: t.fromText, action: { type: 'program_text' } }]]
        : [];
      return view.current
        ? text(t.current(describe(view.current)), [
          [{ label: t.editor, action: { type: 'editor_open' } }],
          ...fromText,
        ])
        : text(`${t.none}\n\n${t.howToSend}\n${t.orBuild}`, [
          [{ label: t.create, action: { type: 'editor_create' } }],
          ...fromText,
        ]);
    }
    case 'program_text_ask':
      return text(t.textAsk, [[{ label: t.back, action: { type: 'back' } }]]);
    case 'program_converting':
      return text(t.converting);
    case 'program_draft': {
      const bold = view.days.map((d) => d.name);
      const body = view.days.flatMap((d) => [
        '',
        d.name,
        ...d.exercises.map((e, i) => `${i + 1}. ${e.name} — ${goalText(t, e)}`),
      ]);
      const unparsed = view.unparsed.slice(0, MAX_ISSUES).map((u) => `• ${u}`);
      return text(
        lines(
          t.draft(describe(view.summary)),
          ...body,
          ...(unparsed.length ? ['', t.unparsed, ...unparsed] : []),
          ...(view.replaces ? ['', t.replaces(view.replaces)] : []),
        ),
        [
          [{ label: t.save, action: { type: 'program_confirm' } }],
          [{ label: t.cancel, action: { type: 'program_cancel' } }],
        ],
        bold,
      );
    }
    case 'program_convert_failed':
      return text(
        t.convertFailed[view.reason],
        view.reason === 'limit' ? [] : [[{ label: t.fromText, action: { type: 'program_text' } }]],
      );
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
      return text(fileProblem(view.reason, t));
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
      | 'program_pick'
      | 'program_goal'
      | 'program_day_new'
      | 'program_first'
      | 'program_day_delete_confirm'
      | 'program_create';
  }
>;

function renderEditorView(view: EditorView, lang: Language): Rendered {
  const t = MESSAGES[lang];
  const back: Button = { label: t.back, action: { type: 'back' } };
  const remove: Button = { label: t.remove, action: { type: 'editor_remove' } };
  const moves = (labels: { up: string; down: string }, canUp: boolean, canDown: boolean) => {
    const row: Button[] = [];
    if (canUp) row.push({ label: labels.up, action: { type: 'editor_move', move: up } });
    if (canDown) row.push({ label: labels.down, action: { type: 'editor_move', move: down } });
    return row.length ? [row] : [];
  };
  const optional = (show: boolean, button: Button): Button[][] => (show ? [[button]] : []);
  const goal = (e: EditorExercise): string => goalText(t, e);
  switch (view.type) {
    case 'program_days':
      return text(
        lines(view.notice ? t.notice[view.notice] : null, view.programName, t.editorDays),
        [
          ...column(view.days.map((d): Button => ({
            label: d.name,
            action: { type: 'editor_day', dayId: d.id },
          }))),
          [{ label: t.newDay, action: { type: 'editor_day_new' } }],
          [{ label: t.programRename, action: { type: 'editor_program_rename' } }],
          [back],
        ],
        [view.programName],
      );
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
          [{ label: t.dayRename, action: { type: 'editor_day_rename' } }],
          ...moves({ up: t.earlier, down: t.later }, view.canMoveUp, view.canMoveDown),
          ...optional(view.deletable, {
            label: t.dayDelete,
            action: { type: 'editor_day_delete' },
          }),
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
          [{ label: t.goal, action: { type: 'editor_goal' } }],
          ...moves({ up: t.up, down: t.down }, view.canMoveUp, view.canMoveDown),
          ...optional(view.removable, remove),
          [back],
        ],
        [view.exercise.name],
      );
    case 'program_rename': {
      const ask = view.target === TARGET.day
        ? t.renameDayAsk(view.current)
        : view.target === TARGET.program
        ? t.renameProgramAsk(view.current)
        : t.renameAsk(view.current);
      return text(lines(view.invalid ? t.nameInvalid : null, ask), [[back]]);
    }
    case 'program_goal': {
      const example = view.exercise.repRange === null ? t.setsAsk : t.goalAsk;
      return text(
        lines(
          t.goalChangeAsk(view.exercise.name, goal(view.exercise)),
          view.invalid ? `${t.notUnderstood} ${example}` : example,
        ),
        [[back]],
      );
    }
    case 'program_create':
      return text(lines(view.invalid ? t.nameInvalid : null, t.createAsk), [[back]]);
    case 'program_day_new':
      return text(
        lines(view.invalid ? t.nameInvalid : null, view.first ? t.firstDayAsk : t.newDayAsk),
        [[back]],
      );
    case 'program_first':
      return text(t.firstExerciseAsk(view.dayName), [
        [{ label: t.newExercise, action: { type: 'editor_new' } }],
        ...optional(view.fromProgram, { label: t.fromProgram, action: { type: 'editor_from' } }),
        [back],
      ]);
    case 'program_day_delete_confirm':
      return text(t.dayDeleteAsk(view.dayName), [
        [{ label: t.dayDeleteYes, action: { type: 'editor_remove_answer', confirm: true } }],
        [{ label: t.removeNo, action: { type: 'editor_remove_answer', confirm: false } }],
      ]);
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

function fileProblem(reason: FileProblem, t: (typeof MESSAGES)[Language]): string {
  switch (reason) {
    case too_large:
      return t.tooLarge;
    case not_json:
      return `${t.notJson} ${t.howToSend}`;
    case download_failed:
      return t.downloadFailed;
    default:
      return assertNever(reason);
  }
}

const goalText = (t: (typeof MESSAGES)[Language], e: EditorExercise): string =>
  e.repRange === null
    ? t.setsOnly(e.workSets.min, e.workSets.max)
    : `${range(e.workSets.min, e.workSets.max)}×${range(e.repRange.min, e.repRange.max)}`;
