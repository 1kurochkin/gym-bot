import type { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { tzLookup } from '../adapters/geo/tz-lookup.ts';
import { connect, createPostgresStore } from '../adapters/postgres/store.ts';
import { createBot, createTelegramUi } from '../adapters/telegram/bot.ts';
import type { Store } from '../ports/store.ts';
import type { Config } from './config.ts';
import { handleUpdate, type UpdateDeps } from './handle-update.ts';

export type Deps = { readonly bot: Bot; readonly store: Store };

/** Composition root: единственное место, где встречаются адаптеры. */
export function buildDeps(
  config: Config,
  overrides: { store?: Store; botInfo?: UserFromGetMe } = {},
): Deps {
  const store = overrides.store ?? createPostgresStore(connect(config.databaseUrl));
  let updateDeps: UpdateDeps | null = null;
  const bot = createBot({
    token: config.botToken,
    allowedUserIds: config.allowedUserIds,
    botInfo: overrides.botInfo ?? toBotInfo(config.botInfo),
    onUpdate: (update) => {
      if (!updateDeps) throw new Error('deps not ready');
      return handleUpdate(updateDeps, update);
    },
  });
  updateDeps = {
    store,
    ui: createTelegramUi(bot),
    clock: { now: () => new Date() },
    zoneAt: tzLookup,
    newId: () => crypto.randomUUID(),
  };
  return { bot, store };
}

/** BOT_INFO из окружения: недостающие флаги возможностей бота — false. */
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
