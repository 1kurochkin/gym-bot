import type { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { tzLookup } from '../adapters/geo/tz-lookup.ts';
import { createLlm } from '../adapters/llm/openai-compatible.ts';
import { connect, createPostgresStore } from '../adapters/postgres/store.ts';
import { createBot, createTelegramUi } from '../adapters/telegram/bot.ts';
import type { Store } from '../ports/store.ts';
import type { Config } from './config.ts';
import { handleUpdate, type UpdateDeps } from './handle-update.ts';

export type Deps = { readonly bot: Bot; readonly store: Store };

export function buildDeps(
  config: Config,
  overrides: { store?: Store; botInfo?: UserFromGetMe } = {},
): Deps {
  const store = overrides.store ?? createPostgresStore(connect(config.databaseUrl));
  let updateDeps: UpdateDeps | null = null;
  let queue: Promise<void> = Promise.resolve();
  const serialize = (run: () => Promise<void>): Promise<void> => {
    const next = queue.then(run);
    queue = next.catch(() => {});
    return next;
  };
  const bot = createBot({
    token: config.botToken,
    botInfo: overrides.botInfo ?? toBotInfo(config.botInfo),
    onUpdate: (update) => {
      const deps = updateDeps;
      if (!deps) throw new Error('deps not ready');
      return serialize(() => handleUpdate(deps, update));
    },
  });
  bot.api.config.use(async (prev, method, payload, signal) => {
    const start = performance.now();
    try {
      return await prev(method, payload, signal);
    } finally {
      console.log(JSON.stringify({ telegram: method, ms: Math.round(performance.now() - start) }));
    }
  });
  updateDeps = {
    store,
    ui: createTelegramUi(bot),
    clock: { now: () => new Date() },
    zoneAt: tzLookup,
    newId: () => crypto.randomUUID(),
    owners: config.ownerIds,
    botUsername: () => bot.botInfo.username,
    llm: config.llmProviders.length ? createLlm(config.llmProviders) : null,
    llmDailyLimit: config.llmDailyLimit,
    defer,
    serialize,
  };
  return { bot, store };
}

function toBotInfo(info: Config['botInfo']): UserFromGetMe | undefined {
  if (!info) return undefined;
  return {
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
    ...info,
  };
}

function defer(task: () => Promise<void>): void {
  const run = task().catch((e) => {
    console.error(JSON.stringify({ deferred: e instanceof Error ? e.name : 'error' }));
  });
  const runtime: unknown = Reflect.get(globalThis, 'EdgeRuntime');
  const waitUntil: unknown = runtime && typeof runtime === 'object'
    ? Reflect.get(runtime, 'waitUntil')
    : undefined;
  if (typeof waitUntil === 'function') Reflect.apply(waitUntil, runtime, [run]);
}
