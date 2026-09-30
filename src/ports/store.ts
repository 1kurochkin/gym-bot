import { z } from 'zod';
import { SessionSchema } from '../core/session/types.ts';
import { SettingsSchema } from '../core/settings/settings.ts';

export const UserStateSchema = z.object({ session: SessionSchema, settings: SettingsSchema })
  .readonly();
export type UserState = z.infer<typeof UserStateSchema>;

export const CommitSchema = z.object({
  session: SessionSchema,
  /** Передаётся, только если настройки изменились. */
  settings: SettingsSchema.optional(),
}).readonly();
export type Commit = z.infer<typeof CommitSchema>;

/** Хранилище. Один load и один commit (транзакция) на апдейт — docs/architecture.md §13.2. */
export type Store = {
  /** Сессия и настройки одним запросом; для нового пользователя — значения по умолчанию. */
  readonly load: (userId: number) => Promise<UserState>;
  readonly commit: (userId: number, change: Commit) => Promise<void>;
  /** Лёгкий запрос в БД для /health (защита бесплатного проекта от паузы). */
  readonly ping: () => Promise<void>;
};
