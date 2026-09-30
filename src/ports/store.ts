import { z } from 'zod';
import { LastResultSchema, ManualResultSchema } from '../core/history/schema.ts';
import { ProgramSchema } from '../core/program/schema.ts';
import { SessionSchema } from '../core/session/types.ts';
import { SettingsSchema } from '../core/settings/settings.ts';

export const UserStateSchema = z.object({
  session: SessionSchema,
  settings: SettingsSchema,
  /** Активная программа (по settings.activeProgramId); null — не загружена. */
  activeProgram: ProgramSchema.nullable(),
  /** «Прошлый раз» по упражнениям активной программы (по exerciseId). */
  lastResults: z.record(z.string(), LastResultSchema).readonly(),
}).readonly();
export type UserState = z.infer<typeof UserStateSchema>;

export const CommitSchema = z.object({
  session: SessionSchema,
  /** Передаётся, только если настройки изменились. */
  settings: SettingsSchema.optional(),
  /** Новая активная программа: предыдущая архивируется, версия — следующая для того же id. */
  newProgram: z.object({ id: z.uuid(), program: ProgramSchema }).readonly().optional(),
  /** Результаты /seed: запись упражнения и один рабочий подход, без тренировки. */
  manualResults: z.array(
    z.object({
      logId: z.uuid(),
      setId: z.uuid(),
      programId: z.uuid(),
      result: ManualResultSchema,
    }).readonly(),
  ).readonly().optional(),
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
