import type { Llm, LlmReply, LlmRequest } from '../../src/ports/llm.ts';

const meta = {
  provider: 'fake',
  model: 'fake-model',
  ms: 5,
  promptTokens: 100,
  completionTokens: 50,
};

export const answer = (content: unknown): LlmReply => ({
  ok: true,
  content: typeof content === 'string' ? content : JSON.stringify(content),
  ...meta,
});

export const down: LlmReply = { ok: false, reason: 'unavailable', ...meta };

export function scriptedLlm(...replies: LlmReply[]): Llm & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  const llm = (request: LlmRequest): Promise<LlmReply> => {
    requests.push(request);
    return Promise.resolve(replies.shift() ?? down);
  };
  return Object.assign(llm, { requests });
}
