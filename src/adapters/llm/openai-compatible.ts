import { z } from 'zod';
import type { Llm, LlmReply, LlmRequest } from '../../ports/llm.ts';

export const LlmProviderSchema = z.object({
  baseUrl: z.url(),
  model: z.string().min(1),
  apiKey: z.string().min(1),
}).readonly();
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

const CompletionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
  }).optional(),
});

const TIMEOUT_MS = 45_000;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export function createLlm(
  providers: readonly LlmProvider[],
  fetchFn: typeof fetch = fetch,
  timeoutMs = TIMEOUT_MS,
): Llm {
  return async (request) => {
    let last: LlmReply | null = null;
    for (const provider of providers) {
      last = await callProvider(provider, request, fetchFn, timeoutMs);
      console.log(JSON.stringify({
        llm: provider.model,
        provider: last.provider,
        ok: last.ok,
        reason: last.ok ? undefined : last.reason,
        ms: last.ms,
      }));
      if (last.ok) return last;
    }
    return last ?? {
      ok: false,
      reason: 'unavailable',
      provider: 'none',
      model: 'none',
      ms: 0,
      promptTokens: null,
      completionTokens: null,
    };
  };
}

async function callProvider(
  provider: LlmProvider,
  request: LlmRequest,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<LlmReply> {
  const start = performance.now();
  const meta = {
    provider: new URL(provider.baseUrl).hostname,
    model: provider.model,
    promptTokens: null,
    completionTokens: null,
  };
  const elapsed = (): number => Math.round(performance.now() - start);
  try {
    const res = await fetchFn(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0,
        reasoning_effort: 'low',
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: request.schemaName, schema: request.schema, strict: true },
        },
      }),
    });
    if (!res.ok) {
      await res.body?.cancel();
      const reason = RETRYABLE.has(res.status) ? 'unavailable' : 'rejected';
      return { ok: false, reason, ...meta, ms: elapsed() };
    }
    const parsed = CompletionSchema.safeParse(await res.json());
    const content = parsed.success ? parsed.data.choices[0]?.message.content : null;
    if (!parsed.success || !content) {
      return { ok: false, reason: 'rejected', ...meta, ms: elapsed() };
    }
    return {
      ok: true,
      content,
      ...meta,
      promptTokens: parsed.data.usage?.prompt_tokens ?? null,
      completionTokens: parsed.data.usage?.completion_tokens ?? null,
      ms: elapsed(),
    };
  } catch {
    return { ok: false, reason: 'unavailable', ...meta, ms: elapsed() };
  }
}
