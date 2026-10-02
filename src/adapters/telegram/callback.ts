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
  menu_add: 'ma',
  exercise_finish: 'ef',
  set_edit: 'ed',
  set_delete: 'sd',
  set_forward: 'sf',
  workout_finish: 'wx',
  comment: 'cm',
  workout_done: 'wd',
  warmup_diff: 'wf',
  warmup_comment: 'wc',
  back: 'bk',
  history_add: 'ha',
  history_delete: 'hd',
} as const;

/** Коды действий с одним параметром: «bs:45», «sp:calves». */
const PARAM_CODES = {
  settings_section: 'se',
  bar_set: 'bs',
  plate_toggle: 'pt',
  step_pick: 'sp',
  step_set: 'st',
  day_pick: 'dp',
  menu_pick: 'mn',
  add_pick: 'ad',
  intensity_set: 'is',
  weight_set: 'ws',
  warmup: 'wu',
  reps_set: 'rp',
  cancel_answer: 'ca',
  lang_set: 'lg',
  member_pick: 'mp',
  revoke_answer: 'ra',
  warmup_mark: 'wm',
  history_page: 'hp',
  history_workout: 'hw',
  history_log: 'hl',
  history_set: 'hs',
  history_confirm: 'hc',
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
    case 'menu_add':
    case 'exercise_finish':
    case 'set_edit':
    case 'set_delete':
    case 'set_forward':
    case 'workout_finish':
    case 'comment':
    case 'workout_done':
    case 'warmup_diff':
    case 'warmup_comment':
    case 'back':
    case 'history_add':
    case 'history_delete':
      return SIMPLE_CODES[a.type];
    case 'day_pick':
      return `${PARAM_CODES[a.type]}:${a.dayId}`;
    case 'menu_pick':
    case 'add_pick':
      return `${PARAM_CODES[a.type]}:${a.exerciseId}`;
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
    case 'history_page':
      return `${PARAM_CODES[a.type]}:${a.offset}`;
    case 'history_workout':
    case 'history_log':
    case 'history_set':
      return `${PARAM_CODES[a.type]}:${a.id}`;
    case 'history_confirm':
      return `${PARAM_CODES[a.type]}:${a.confirm ? 1 : 0}`;
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
  const m = /^([a-z]{2}):([A-Za-z0-9_.-]+)$/.exec(code);
  const type = m && Object.entries(PARAM_CODES).find(([, c]) => c === m[1])?.[0];
  if (!m || !type) return null;
  const value = m[2] ?? '';
  switch (type) {
    case 'settings_section':
      return { type, section: value };
    case 'step_pick':
    case 'menu_pick':
    case 'add_pick':
      return { type, exerciseId: value };
    case 'day_pick':
      return { type, dayId: value };
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
    case 'history_page':
      return { type, offset: Number(value) };
    case 'history_workout':
    case 'history_log':
    case 'history_set':
      return { type, id: value };
    case 'history_confirm':
      return { type, confirm: value === '1' };
    default:
      return { type, lb: Number(value) };
  }
}
