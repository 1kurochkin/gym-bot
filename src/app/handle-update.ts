import { languageFor, type Settings } from '../core/settings/settings.ts';
import { step } from '../core/session/step.ts';
import type { Clock } from '../ports/clock.ts';
import type { ZoneLocator } from '../ports/geo.ts';
import { type Commit, isWorkoutWrite, type Store } from '../ports/store.ts';
import type { IncomingUpdate, Ui } from '../ports/ui.ts';
import { render, routeEvent } from './route.ts';

/** Свежих id на апдейт: тренировка, запись упражнения, до ~10 подходов разминки и рабочий. */
const IDS_PER_UPDATE = 16;

export type UpdateDeps = {
  readonly store: Store;
  readonly ui: Ui;
  readonly clock: Clock;
  readonly zoneAt: ZoneLocator;
  /** Новый id для записи (программы и т. п.): в тестах — предсказуемый. */
  readonly newId: () => string;
};

/**
 * Цикл обработки апдейта (docs/architecture.md §13.2). Whitelist и answerCallbackQuery
 * уже сделал адаптер telegram. Здесь: идемпотентность → событие → step() → одна транзакция → отрисовка.
 */
export async function handleUpdate(deps: UpdateDeps, update: IncomingUpdate): Promise<void> {
  const loaded = await deps.store.load(update.userId);
  const { session, settings, activeProgram, lastResults } = loaded;

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
    activeProgram,
    lastResults,
    activeWorkout: loaded.activeWorkout,
    lastWorkout: loaded.lastWorkout,
    intensityLogs: loaded.intensityLogs,
    lastHighLb: loaded.lastHighLb,
    newIds: Array.from({ length: IDS_PER_UPDATE }, () => deps.newId()),
  });

  // Все эффекты записи — одной транзакцией вместе с новым состоянием сессии.
  let newSettings: Settings | undefined;
  let newProgram: Commit['newProgram'];
  const manualResults: NonNullable<Commit['manualResults']>[number][] = [];
  for (const e of result.effects) {
    if (e.type === 'save_settings') newSettings = e.settings;
    if (e.type === 'record_manual_result' && settings.activeProgramId !== null) {
      manualResults.push({
        logId: deps.newId(),
        setId: deps.newId(),
        programId: settings.activeProgramId,
        result: e.result,
      });
    }
    if (e.type === 'save_program') {
      newProgram = { id: deps.newId(), program: e.program };
      newSettings = { ...(newSettings ?? settings), activeProgramId: newProgram.id };
    }
  }
  const writes = result.effects.filter(isWorkoutWrite);
  await deps.store.commit(update.userId, {
    session: result.state,
    settings: newSettings,
    newProgram,
    manualResults,
    workout: writes.length && settings.activeProgramId !== null
      ? { programId: settings.activeProgramId, writes }
      : undefined,
  });

  // Язык — по настройкам после шага: выбор языка в /settings сразу виден на ответе.
  const lang = languageFor((newSettings ?? settings).language, update.languageCode);
  for (const e of result.effects) {
    if (e.type !== 'render') continue;
    const messageId = input.kind === 'callback' ? update.messageId : null;
    await deps.ui.show(update.chatId, render(e.view, lang), result.state.stepNo, messageId);
  }
}
