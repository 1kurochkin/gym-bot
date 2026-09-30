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
} as const;

function encodeAction(a: Action): string {
  switch (a.type) {
    case 'tz':
      return `tz:${a.zone}`;
    case 'program_confirm':
    case 'program_cancel':
    case 'seed_next':
    case 'seed_stop':
      return SIMPLE_CODES[a.type];
  }
}

/** Код → сырой объект → ActionSchema: в приложение попадает только проверенное действие. */
function decodeAction(code: string): Action | null {
  const tz = /^tz:([A-Za-z0-9_+\-/]+)$/.exec(code);
  const simple = Object.entries(SIMPLE_CODES).find(([, c]) => c === code)?.[0];
  const raw = tz ? { type: 'tz', zone: tz[1] } : simple ? { type: simple } : null;
  const r = ActionSchema.safeParse(raw);
  return r.success ? r.data : null;
}
