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

function encodeAction(a: Action): string {
  switch (a.type) {
    case 'tz':
      return `tz:${a.zone}`;
  }
}

/** Код → сырой объект → ActionSchema: в приложение попадает только проверенное действие. */
function decodeAction(code: string): Action | null {
  const tz = /^tz:([A-Za-z0-9_+\-/]+)$/.exec(code);
  const raw = tz ? { type: 'tz', zone: tz[1] } : null;
  const r = ActionSchema.safeParse(raw);
  return r.success ? r.data : null;
}
