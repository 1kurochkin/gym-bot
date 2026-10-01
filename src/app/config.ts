import { z } from 'zod';

/** Пустая переменная окружения считается незаданной. */
const optionalEnv = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

/** Ответ getMe. С ним grammY не вызывает getMe на каждом холодном старте функции. */
const BotInfoSchema = z.object({
  id: z.number(),
  is_bot: z.literal(true),
  first_name: z.string(),
  username: z.string(),
}).loose();

const JsonStringSchema = z.string().transform((s, ctx) => {
  try {
    return JSON.parse(s);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'ожидается JSON' });
    return z.NEVER;
  }
});

/** «1, 2» → Set{1, 2}: Telegram user id через запятую. */
export const UserIdsSchema = z.string()
  .transform((s) => s.split(',').map((part) => Number(part.trim())))
  .pipe(z.array(z.number().int().positive()).min(1))
  .transform((ids): ReadonlySet<number> => new Set(ids));

/** Переменные окружения. Секреты — supabase secrets set / .env, не в коде. */
const EnvSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  ALLOWED_USER_IDS: UserIdsSchema,
  DATABASE_URL: z.string().min(1),
  WEBHOOK_SECRET: optionalEnv(z.string().min(16)),
  CRON_SECRET: optionalEnv(z.string().min(16)),
  BOT_INFO: optionalEnv(JsonStringSchema.pipe(BotInfoSchema)),
});

export const ConfigSchema = EnvSchema.transform((env) => ({
  botToken: env.BOT_TOKEN,
  /** Владельцы: всегда с доступом, приглашают остальных (.specs/product.md → US-9). */
  ownerIds: env.ALLOWED_USER_IDS,
  databaseUrl: env.DATABASE_URL,
  webhookSecret: env.WEBHOOK_SECRET ?? null,
  cronSecret: env.CRON_SECRET ?? null,
  botInfo: env.BOT_INFO ?? null,
})).readonly();
export type Config = z.output<typeof ConfigSchema>;

export function readConfig(get: (key: string) => string | undefined): Config {
  const keys = EnvSchema.keyof().options;
  return ConfigSchema.parse(Object.fromEntries(keys.map((k) => [k, get(k)])));
}
