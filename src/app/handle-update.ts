import { languageFor, type Settings } from '../core/settings/settings.ts';
import { historyQuery } from '../core/session/history.ts';
import { step } from '../core/session/step.ts';
import { needsLlmUsage } from '../core/session/program-convert.ts';
import type { BotEvent, Effect, Session } from '../core/session/types.ts';
import { type Conversion, convertProgram } from '../features/program/convert.ts';
import { ConvertFailureSchema } from '../core/program/draft.ts';
import { type Llm, LlmCallKindSchema } from '../ports/llm.ts';
import type { Clock } from '../ports/clock.ts';
import type { ZoneLocator } from '../ports/geo.ts';
import { type Commit, isWorkoutWrite, type Store, type UserState } from '../ports/store.ts';
import type { IncomingUpdate, Ui } from '../ports/ui.ts';
import { admit } from './access.ts';
import { render, routeEvent } from './route.ts';

const IDS_PER_UPDATE = 16;
const DAY_MS = 24 * 60 * 60 * 1000;

export type UpdateDeps = {
  readonly store: Store;
  readonly ui: Ui;
  readonly clock: Clock;
  readonly zoneAt: ZoneLocator;
  readonly newId: () => string;
  readonly owners: ReadonlySet<number>;
  readonly botUsername: () => string;
  readonly llm: Llm | null;
  readonly llmDailyLimit: number;
  readonly defer: (task: () => Promise<void>) => void;
  readonly serialize: (run: () => Promise<void>) => Promise<void>;
};

type Target = {
  readonly userId: number;
  readonly chatId: number;
  readonly languageCode: string | null;
  readonly messageId: number | null;
  readonly sourceMessageId: number | null;
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
  const { session } = loaded;

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

  const target = {
    userId: update.userId,
    chatId: update.chatId,
    languageCode: update.languageCode,
    messageId: input.kind === 'callback' ? update.messageId : null,
    sourceMessageId: update.messageId,
  };
  await runStep(deps, target, loaded, seen, event, mark);
}

async function runStep(
  deps: UpdateDeps,
  target: Target,
  loaded: UserState,
  seen: Session,
  event: BotEvent,
  mark: Mark,
): Promise<void> {
  const { settings, activeProgram, lastResults } = loaded;
  const isOwner = deps.owners.has(target.userId);
  const now = deps.clock.now();
  const query = historyQuery(seen, event);
  const history = query
    ? await deps.store.loadHistory(target.userId, query)
    : { page: null, workout: null };
  const llmUsed = deps.llm && needsLlmUsage(seen, event)
    ? await deps.store.countLlmCalls(target.userId, new Date(now.getTime() - DAY_MS))
    : 0;

  const result = step(seen, event, {
    now,
    settings,
    languageCode: target.languageCode,
    activeProgram,
    programs: loaded.programs,
    programKeys: loaded.programKeys,
    lastResults,
    activeWorkout: loaded.activeWorkout,
    lastWorkout: loaded.lastWorkout,
    isOwner,
    members: loaded.members,
    history,
    newIds: Array.from({ length: IDS_PER_UPDATE }, () => deps.newId()),
    llm: { enabled: deps.llm !== null, used: llmUsed, limit: deps.llmDailyLimit },
  });

  mark('step');
  let newSettings: Settings | undefined;
  let newProgram: Commit['newProgram'];
  let newInvite: Commit['newInvite'];
  let revokeMember: Commit['revokeMember'];
  let archiveProgram: Commit['archiveProgram'];
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
    if (e.type === 'archive_program') archiveProgram = e.programId;
    if (e.type === 'save_program') {
      newProgram = { id: deps.newId(), program: e.program };
      newSettings = { ...(newSettings ?? settings), activeProgramId: newProgram.id };
    }
  }
  const writes = result.effects.filter(isWorkoutWrite);
  await deps.store.commit(target.userId, {
    session: result.state,
    settings: newSettings,
    newProgram,
    newInvite,
    revokeMember,
    archiveProgram,
    manualResults,
    workout: writes.length ? { programId: settings.activeProgramId ?? '', writes } : undefined,
  });

  mark('commit');
  const lang = languageFor((newSettings ?? settings).language, target.languageCode);
  const env = { botUsername: deps.botUsername() };
  if (result.effects.some((e) => e.type === 'clear_chat') && target.sourceMessageId !== null) {
    await deps.ui.clearChat(target.chatId, target.sourceMessageId);
  }
  for (const e of result.effects) {
    if (e.type !== 'render') continue;
    await deps.ui.show(
      target.chatId,
      render(e.view, lang, env),
      result.state.stepNo,
      target.messageId,
    );
  }
  mark('show');
  startDeferred(deps, target, result.effects);
  for (const e of result.effects) {
    if (e.type !== 'follow_up') continue;
    const reloaded = await deps.store.load(target.userId, { withMembers: isOwner });
    await runStep(deps, target, reloaded, reloaded.session, e.event, mark);
  }
}

const UNAVAILABLE: Conversion = {
  outcome: { ok: false, reason: ConvertFailureSchema.enum.unavailable },
  replies: [],
};

const total = (values: readonly (number | null)[]): number | null =>
  values.some((v) => v !== null) ? values.reduce<number>((a, v) => a + (v ?? 0), 0) : null;

function startDeferred(deps: UpdateDeps, target: Target, effects: readonly Effect[]): void {
  const llm = deps.llm;
  for (const e of effects) {
    if (e.type !== 'convert_program' || !llm) continue;
    deps.defer(async () => {
      const { outcome, replies } = await convertProgram(llm, e.text).catch(() => UNAVAILABLE);
      const last = replies.at(-1);
      if (last) {
        await deps.store.recordLlmCall(target.userId, {
          kind: LlmCallKindSchema.enum.program,
          ok: outcome.ok,
          provider: last.provider,
          model: last.model,
          ms: replies.reduce((a, r) => a + r.ms, 0),
          promptTokens: total(replies.map((r) => r.promptTokens)),
          completionTokens: total(replies.map((r) => r.completionTokens)),
        });
      }
      await deps.serialize(() =>
        handleEvent(deps, target, { type: 'program_drafted', requestId: e.requestId, outcome })
      );
    });
  }
}

export async function handleEvent(
  deps: UpdateDeps,
  target: Target,
  event: BotEvent,
): Promise<void> {
  const loaded = await deps.store.load(target.userId, {
    withMembers: deps.owners.has(target.userId),
  });
  const internal = { ...target, messageId: null, sourceMessageId: null };
  await runStep(deps, internal, loaded, loaded.session, event, () => {});
}
