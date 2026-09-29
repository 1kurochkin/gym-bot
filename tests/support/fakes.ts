import { defaultSettings, type Settings } from '../../src/core/settings/settings.ts';
import { initialSession, type Session } from '../../src/core/session/types.ts';
import type { Commit, Store, UserState } from '../../src/ports/store.ts';
import type { Rendered, Ui } from '../../src/ports/ui.ts';

export type MemoryStore = Store & {
  readonly sessions: Map<number, Session>;
  readonly settings: Map<number, Settings>;
  commits: number;
};

export function memoryStore(): MemoryStore {
  const store: MemoryStore = {
    sessions: new Map(),
    settings: new Map(),
    commits: 0,
    load(userId: number): Promise<UserState> {
      return Promise.resolve({
        session: store.sessions.get(userId) ?? initialSession(userId),
        settings: store.settings.get(userId) ?? defaultSettings(userId),
      });
    },
    commit(userId: number, change: Commit): Promise<void> {
      store.commits++;
      store.sessions.set(userId, change.session);
      if (change.settings) store.settings.set(userId, change.settings);
      return Promise.resolve();
    },
    ping: () => Promise.resolve(),
  };
  return store;
}

export type Shown = {
  chatId: number;
  rendered: Rendered;
  stepNo: number;
  messageId: number | null;
};

export function fakeUi(): Ui & { shown: Shown[]; dropped: number[] } {
  const shown: Shown[] = [];
  const dropped: number[] = [];
  return {
    shown,
    dropped,
    show(chatId, rendered, stepNo, messageId): Promise<void> {
      shown.push({ chatId, rendered, stepNo, messageId });
      return Promise.resolve();
    },
    dropKeyboard(_chatId, messageId): Promise<void> {
      dropped.push(messageId);
      return Promise.resolve();
    },
  };
}
