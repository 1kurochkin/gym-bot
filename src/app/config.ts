import { z } from 'zod';
import type { LlmProvider } from '../adapters/llm/openai-compatible.ts';

const optionalEnv = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

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

export const UserIdsSchema = z.string()
  .transform((s) => s.split(',').map((part) => Number(part.trim())))
  .pipe(z.array(z.number().int().positive()).min(1))
  .transform((ids): ReadonlySet<number> => new Set(ids));

const EnvSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  ALLOWED_USER_IDS: UserIdsSchema,
  DATABASE_URL: z.string().min(1),
  WEBHOOK_SECRET: optionalEnv(z.string().min(16)),
  CRON_SECRET: optionalEnv(z.string().min(16)),
  BOT_INFO: optionalEnv(JsonStringSchema.pipe(BotInfoSchema)),
  LLM_BASE_URL: optionalEnv(z.url()),
  LLM_MODEL: optionalEnv(z.string().min(1)),
  LLM_API_KEY: optionalEnv(z.string().min(1)),
  LLM_FALLBACK_BASE_URL: optionalEnv(z.url()),
  LLM_FALLBACK_MODEL: optionalEnv(z.string().min(1)),
  LLM_FALLBACK_API_KEY: optionalEnv(z.string().min(1)),
  LLM_DAILY_LIMIT: optionalEnv(z.coerce.number().int().nonnegative()),
});

const DEFAULT_LLM_DAILY_LIMIT = 10;

function provider(
  baseUrl: string | undefined,
  model: string | undefined,
  apiKey: string | undefined,
): LlmProvider[] {
  return baseUrl && model && apiKey ? [{ baseUrl, model, apiKey }] : [];
}

export const ConfigSchema = EnvSchema.transform((env) => ({
  botToken: env.BOT_TOKEN,
  ownerIds: env.ALLOWED_USER_IDS,
  databaseUrl: env.DATABASE_URL,
  webhookSecret: env.WEBHOOK_SECRET ?? null,
  cronSecret: env.CRON_SECRET ?? null,
  botInfo: env.BOT_INFO ?? null,
  llmProviders: [
    ...provider(env.LLM_BASE_URL, env.LLM_MODEL, env.LLM_API_KEY),
    ...provider(env.LLM_FALLBACK_BASE_URL, env.LLM_FALLBACK_MODEL, env.LLM_FALLBACK_API_KEY),
  ],
  llmDailyLimit: env.LLM_DAILY_LIMIT ?? DEFAULT_LLM_DAILY_LIMIT,
})).readonly();
export type Config = z.output<typeof ConfigSchema>;

export function readConfig(get: (key: string) => string | undefined): Config {
  const keys = EnvSchema.keyof().options;
  return ConfigSchema.parse(Object.fromEntries(keys.map((k) => [k, get(k)])));
}
