import { parseTimeZone } from '../core/schedule/timezone.ts';
import { step } from '../core/session/step.ts';
import type { BotEvent } from '../core/session/types.ts';
import { toEvent } from '../features/onboarding/handlers.ts';
import { renderView } from '../features/onboarding/views.ts';
import type { Clock } from '../ports/clock.ts';
import type { ZoneLocator } from '../ports/geo.ts';
import type { Store } from '../ports/store.ts';
import type { Incoming, IncomingUpdate, Ui } from '../ports/ui.ts';

export type UpdateDeps = {
  readonly store: Store;
  readonly ui: Ui;
  readonly clock: Clock;
  readonly zoneAt: ZoneLocator;
};

/**
 * Цикл обработки апдейта (docs/architecture.md §13.2). Whitelist и answerCallbackQuery
 * уже сделал адаптер telegram. Здесь: идемпотентность → событие → step() → одна транзакция → отрисовка.
 */
export async function handleUpdate(deps: UpdateDeps, update: IncomingUpdate): Promise<void> {
  const { session, settings } = await deps.store.load(update.userId);

  // Telegram повторяет webhook при таймауте: уже обработанный update_id игнорируем.
  if (update.updateId <= session.lastUpdateId) return;
  const seen = { ...session, lastUpdateId: update.updateId };

  const input = update.input;
  if (input.kind === 'callback' && input.stepNo !== session.stepNo) {
    // Кнопка от устаревшего шага: не создаём дубль, убираем старую клавиатуру.
    await deps.store.commit(update.userId, { session: seen });
    if (update.messageId !== null) await deps.ui.dropKeyboard(update.chatId, update.messageId);
    return;
  }

  const event = await routeEvent(input, deps.zoneAt);
  if (!event) {
    await deps.store.commit(update.userId, { session: seen });
    return;
  }

  const result = step(seen, event, {
    now: deps.clock.now(),
    settings,
    languageCode: update.languageCode,
  });

  let newSettings = undefined;
  for (const e of result.effects) if (e.type === 'save_settings') newSettings = e.settings;
  await deps.store.commit(update.userId, { session: result.state, settings: newSettings });

  for (const e of result.effects) {
    if (e.type !== 'render') continue;
    const messageId = input.kind === 'callback' ? update.messageId : null;
    await deps.ui.show(update.chatId, renderView(e.view), result.state.stepNo, messageId);
  }
}

/** Роутинг по фичам. Пока одна фича; новые добавляются сюда. */
async function routeEvent(input: Incoming, zoneAt: ZoneLocator): Promise<BotEvent | null> {
  if (input.kind === 'location') {
    // Поиск зоны по координатам — I/O-зависимость, поэтому здесь, а не в фиче. Координаты не сохраняем.
    const name = await zoneAt(input.latitude, input.longitude);
    const zone = name === null ? null : parseTimeZone(name);
    return { type: 'tz_located', zone: zone?.ok ? zone.value : null };
  }
  return toEvent(input);
}
