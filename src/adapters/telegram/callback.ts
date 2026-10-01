import { type Action, ActionSchema } from '../../ports/ui.ts';

/**
 * Кодек callback_data: «<stepNo>|<код>». JSON в кнопки не кладём — лимит Telegram 64 байта.
 * stepNo нужен, чтобы нажатие на кнопку от устаревшего шага не создавало дубль.
 */
export function encodeCallback(action: Action, stepNo: number): string {
  const data = `${stepNo}|${encodeAction(action)}`;
  if (new TextEncoder().encode(data).length > 64) {
    throw new Error(`callback_data > 64 bytes: ${data}`);
  }
  return data;
}

export function decodeCallback(data: string): { stepNo: number; action: Action } | null {
  const m = /^(\d+)\|(.+)$/.exec(data);
  if (!m) return null;
  const action = decodeAction(m[2] ?? '');
  return action ? { stepNo: Number(m[1]), action } : null;
}

/** Короткие коды действий без параметров. */
const SIMPLE_CODES = {
  program_confirm: 'pc',
  program_cancel: 'px',
  seed_next: 'sn',
  seed_stop: 'ss',
  settings_back: 'sb',
  settings_close: 'sc',
  plates_save: 'ps',
  step_reset: 'sr',
  set_more: 'sm',
  exercise_next: 'en',
  exercise_skip: 'ek',
  comment: 'cm',
  workout_done: 'wd',
  warmup_diff: 'wf',
  warmup_comment: 'wc',
  back: 'bk',
  replace: 'rx',
  reorder: 'ro',
  undo: 'un',
} as const;

/** Коды действий с одним параметром: «bs:45», «sp:calves». */
const PARAM_CODES = {
  settings_section: 'se',
  bar_set: 'bs',
  plate_toggle: 'pt',
  step_pick: 'sp',
  step_set: 'st',
  day_pick: 'dp',
  resume: 'rs',
  intensity_set: 'is',
  weight_set: 'ws',
  warmup: 'wu',
  reps_set: 'rp',
  cancel_answer: 'ca',
  lang_set: 'lg',
  member_pick: 'mp',
  revoke_answer: 'ra',
  warmup_mark: 'wm',
  replace_pick: 'rq',
  reorder_pick: 'rr',
} as const;

function encodeAction(a: Action): string {
  switch (a.type) {
    case 'tz':
      return `tz:${a.zone}`;
    case 'program_confirm':
    case 'program_cancel':
    case 'seed_next':
    case 'seed_stop':
    case 'settings_back':
    case 'settings_close':
    case 'plates_save':
    case 'step_reset':
    case 'set_more':
    case 'exercise_next':
    case 'exercise_skip':
    case 'comment':
    case 'workout_done':
    case 'warmup_diff':
    case 'warmup_comment':
    case 'back':
    case 'undo':
    case 'replace':
    case 'reorder':
      return SIMPLE_CODES[a.type];
    case 'day_pick':
      return `${PARAM_CODES[a.type]}:${a.dayId}`;
    case 'resume':
      return `${PARAM_CODES[a.type]}:${a.choice}`;
    case 'intensity_set':
      return `${PARAM_CODES[a.type]}:${a.intensity}`;
    case 'weight_set':
      return `${PARAM_CODES[a.type]}:${a.lb}`;
    case 'warmup':
      return `${PARAM_CODES[a.type]}:${a.variant}`;
    case 'reps_set':
      return `${PARAM_CODES[a.type]}:${a.reps}`;
    case 'cancel_answer':
    case 'revoke_answer':
      return `${PARAM_CODES[a.type]}:${a.confirm ? 1 : 0}`;
    case 'member_pick':
      return `${PARAM_CODES[a.type]}:${a.userId}`;
    case 'settings_section':
      return `${PARAM_CODES[a.type]}:${a.section}`;
    case 'bar_set':
    case 'plate_toggle':
    case 'step_set':
      return `${PARAM_CODES[a.type]}:${a.lb}`;
    case 'step_pick':
      return `${PARAM_CODES[a.type]}:${a.exerciseId}`;
    case 'lang_set':
      return `${PARAM_CODES[a.type]}:${a.language}`;
    case 'warmup_mark':
      return `${PARAM_CODES[a.type]}:${a.mark}`;
    case 'replace_pick':
      return `${PARAM_CODES[a.type]}:${a.exerciseId}`;
    case 'reorder_pick':
      return `${PARAM_CODES[a.type]}:${a.index}`;
  }
}

/** Код → сырой объект → ActionSchema: в приложение попадает только проверенное действие. */
function decodeAction(code: string): Action | null {
  const r = ActionSchema.safeParse(rawAction(code));
  return r.success ? r.data : null;
}

/** Код → сырой объект; проверку типов и значений делает ActionSchema. */
function rawAction(code: string): Record<string, unknown> | null {
  const tz = /^tz:([A-Za-z0-9_+\-/]+)$/.exec(code);
  if (tz) return { type: 'tz', zone: tz[1] };
  const simple = Object.entries(SIMPLE_CODES).find(([, c]) => c === code)?.[0];
  if (simple) return { type: simple };
  const m = /^([a-z]{2}):([A-Za-z0-9_.]+)$/.exec(code);
  const type = m && Object.entries(PARAM_CODES).find(([, c]) => c === m[1])?.[0];
  if (!m || !type) return null;
  const value = m[2] ?? '';
  switch (type) {
    case 'settings_section':
      return { type, section: value };
    case 'step_pick':
      return { type, exerciseId: value };
    case 'day_pick':
      return { type, dayId: value };
    case 'resume':
      return { type, choice: value };
    case 'intensity_set':
      return { type, intensity: value };
    case 'warmup':
      return { type, variant: value };
    case 'reps_set':
      return { type, reps: Number(value) };
    case 'cancel_answer':
    case 'revoke_answer':
      return { type, confirm: value === '1' };
    case 'member_pick':
      return { type, userId: Number(value) };
    case 'lang_set':
      return { type, language: value };
    case 'warmup_mark':
      return { type, mark: value };
    case 'replace_pick':
      return { type, exerciseId: value };
    case 'reorder_pick':
      return { type, index: Number(value) };
    default:
      return { type, lb: Number(value) };
  }
}
