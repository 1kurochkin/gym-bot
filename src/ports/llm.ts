import { z } from 'zod';

export const LlmRequestSchema = z.object({
  system: z.string(),
  user: z.string(),
  schemaName: z.string(),
  schema: z.record(z.string(), z.unknown()),
}).readonly();
export type LlmRequest = z.infer<typeof LlmRequestSchema>;

export const LlmFailureSchema = z.enum(['unavailable', 'rejected']);

const usage = {
  provider: z.string(),
  model: z.string(),
  ms: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
};

export const LlmReplySchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), content: z.string(), ...usage }).readonly(),
  z.object({ ok: z.literal(false), reason: LlmFailureSchema, ...usage }).readonly(),
]);
export type LlmReply = z.infer<typeof LlmReplySchema>;

export type Llm = (request: LlmRequest) => Promise<LlmReply>;

export const LlmCallKindSchema = z.enum(['program']);
export type LlmCallKind = z.infer<typeof LlmCallKindSchema>;

export const LlmCallSchema = z.object({
  kind: LlmCallKindSchema,
  ok: z.boolean(),
  ...usage,
}).readonly();
export type LlmCall = z.infer<typeof LlmCallSchema>;
