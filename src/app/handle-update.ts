import { languageFor, type Settings } from '../core/settings/settings.ts';
import { historyQuery } from '../core/session/history.ts';
import { step } from '../core/session/step.ts';
import type { Clock } from '../ports/clock.ts';
import type { ZoneLocator } from '../ports/geo.ts';
import { type Commit, isWorkoutWrite, type Store } from '../ports/store.ts';
import type { IncomingUpdate, Ui } from '../ports/ui.ts';
import { admit } from './access.ts';
import { render, routeEvent } from './route.ts';

const IDS_PER_UPDATE = 16;

export type UpdateDeps = {
  readonly store: Store;
  readonly ui: Ui;
  readonly clock: Clock;
  readonly zoneAt: ZoneLocator;
  readonly newId: () => string;
  readonly owners: ReadonlySet<number>;
  readonly botUsername: () => string;
};

export async function handleUpdate(deps: UpdateDeps, update: IncomingUpdate): Promise<void> {
  const timing = phaseTimer();
  try {
    await processUpdate(deps, update, timing.mark);
  } finally {
    console.log(JSON.stringify({ update: update.updateId, ms: timing.result() }));
  }
}

type Mark = (phase: string) => void;

function phaseTimer(): { mark: Mark; result: () => Record<string, number> } {
  const start = performance.now();
  let last = start;
  const phases: Record<string, number> = {};
  return {
    mark: (phase) => {
      const now = performance.now();
      phases[phase] = Math.round(now - last);
      last = now;
    },
    result: () => ({ ...phases, total: Math.round(performance.now() - start) }),
  };
}

async function processUpdate(deps: UpdateDeps, update: IncomingUpdate, mark: Mark): Promise<void> {
  const admitted = await admit(deps, update);
  mark('admit');
  if (!admitted) return;
  const isOwner = deps.owners.has(update.userId);
  const loaded = await deps.store.load(update.userId, { withMembers: isOwner });
  mark('load');
  const { session, settings, activeProgram, lastResults } = loaded;

  if (update.updateId <= session.lastUpdateId) return;
  const seen = { ...session, lastUpdateId: update.updateId };

  const input = update.input;
  if (input.kind === 'callback' && input.stepNo !== session.stepNo) {
    await deps.store.commit(update.userId, { session: seen });
    if (update.messageId !== null) await deps.ui.dropKeyboard(update.chatId, update.messageId);
    return;
  }

  const event = await routeEvent(input, deps.zoneAt);
  mark('route');
  if (!event) {
    await deps.store.commit(update.userId, { session: seen });
    return;
  }

  const query = historyQuery(seen, event);
  const history = query
    ? await deps.store.loadHistory(update.userId, query)
    : { page: null, workout: null };

  const result = step(seen, event, {
    now: deps.clock.now(),
    settings,
    languageCode: update.languageCode,
    activeProgram,
    lastResults,
    activeWorkout: loaded.activeWorkout,
    lastWorkout: loaded.lastWorkout,
    isOwner,
    members: loaded.members,
    history,
    newIds: Array.from({ length: IDS_PER_UPDATE }, () => deps.newId()),
  });

  mark('step');
  let newSettings: Settings | undefined;
  let newProgram: Commit['newProgram'];
  let newInvite: Commit['newInvite'];
  let revokeMember: Commit['revokeMember'];
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
    if (e.type === 'create_invite') newInvite = { code: e.code, expiresAt: e.expiresAt };
    if (e.type === 'revoke_member') revokeMember = e.userId;
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
    newInvite,
    revokeMember,
    manualResults,
    workout: writes.length ? { programId: settings.activeProgramId ?? '', writes } : undefined,
  });

  mark('commit');
  const lang = languageFor((newSettings ?? settings).language, update.languageCode);
  const env = { botUsername: deps.botUsername() };
  if (result.effects.some((e) => e.type === 'clear_chat') && update.messageId !== null) {
    await deps.ui.clearChat(update.chatId, update.messageId);
  }
  for (const e of result.effects) {
    if (e.type !== 'render') continue;
    const messageId = input.kind === 'callback' ? update.messageId : null;
    await deps.ui.show(update.chatId, render(e.view, lang, env), result.state.stepNo, messageId);
  }
  mark('show');
}
