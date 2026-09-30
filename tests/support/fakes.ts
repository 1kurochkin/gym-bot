import {
  type LastResult,
  LogSourceSchema,
  type ManualResult,
} from '../../src/core/history/schema.ts';
import type { Program } from '../../src/core/program/schema.ts';
import { defaultSettings, type Settings } from '../../src/core/settings/settings.ts';
import { initialSession, type Session } from '../../src/core/session/types.ts';
import type { Commit, Store, UserState } from '../../src/ports/store.ts';
import type { Rendered, Ui } from '../../src/ports/ui.ts';

export type MemoryStore = Store & {
  readonly sessions: Map<number, Session>;
  readonly settings: Map<number, Settings>;
  /** Все сохранённые программы по id, с версией и статусом — как таблица programs. */
  readonly programs: Map<string, { program: Program; version: number; active: boolean }>;
  /** Результаты /seed в порядке записи — как exercise_logs + sets с source manual_import. */
  readonly manual: ManualResult[];
  commits: number;
};

export function memoryStore(): MemoryStore {
  const store: MemoryStore = {
    sessions: new Map(),
    settings: new Map(),
    programs: new Map(),
    manual: [],
    commits: 0,
    load(userId: number): Promise<UserState> {
      const settings = store.settings.get(userId) ?? defaultSettings(userId);
      const active = settings.activeProgramId
        ? store.programs.get(settings.activeProgramId)
        : undefined;
      return Promise.resolve({
        session: store.sessions.get(userId) ?? initialSession(userId),
        settings,
        activeProgram: active?.program ?? null,
        lastResults: lastResults(store.manual),
      });
    },
    commit(userId: number, change: Commit): Promise<void> {
      store.commits++;
      if (change.newProgram) {
        const key = change.newProgram.program.id;
        const versions = [...store.programs.values()].filter((p) => p.program.id === key);
        for (const p of store.programs.values()) p.active = false;
        store.programs.set(change.newProgram.id, {
          program: change.newProgram.program,
          version: versions.length + 1,
          active: true,
        });
      }
      for (const r of change.manualResults ?? []) store.manual.push(r.result);
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

/** «Прошлый раз»: последняя запись каждого упражнения (в фейке — только ручные результаты). */
function lastResults(results: readonly ManualResult[]): Record<string, LastResult> {
  const last: Record<string, LastResult> = {};
  for (const r of results) {
    last[r.exerciseId] = {
      localDate: r.localDate,
      weightLb: r.weightLb,
      reps: r.reps,
      source: LogSourceSchema.enum.manual_import,
      comment: r.comment,
    };
  }
  return last;
}
