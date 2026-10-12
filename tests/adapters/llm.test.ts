import { assert, assertEquals } from '@std/assert';
import { createLlm } from '../../src/adapters/llm/openai-compatible.ts';

const request = { system: 's', user: 'u', schemaName: 'draft', schema: { type: 'object' } };
const groq = { baseUrl: 'https://api.groq.com/openai/v1', model: 'gpt-oss', apiKey: 'k1' };
const gemini = { baseUrl: 'https://gemini.test/v1beta/openai/', model: 'flash', apiKey: 'k2' };

const completion = (content: string) =>
  Response.json({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  });

type Call = { url: string; body: Record<string, unknown>; auth: string | null };

function fakeFetch(...responses: (Response | Error)[]): typeof fetch & { calls: Call[] } {
  const calls: Call[] = [];
  const f = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
      auth: headers.get('authorization'),
    });
    const next = responses.shift() ?? new Response(null, { status: 500 });
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return Object.assign(f, { calls });
}

Deno.test('llm: OpenAI-совместимый запрос со строгой схемой; ответ и токены', async () => {
  const f = fakeFetch(completion('{"a":1}'));
  const reply = await createLlm([groq], f)(request);
  assert(reply.ok);
  assertEquals(reply.content, '{"a":1}');
  assertEquals([reply.provider, reply.promptTokens, reply.completionTokens], [
    'api.groq.com',
    10,
    20,
  ]);
  const call = f.calls[0];
  assertEquals(call?.url, 'https://api.groq.com/openai/v1/chat/completions');
  assertEquals(call?.auth, 'Bearer k1');
  assertEquals(call?.body.response_format, {
    type: 'json_schema',
    json_schema: { name: 'draft', schema: { type: 'object' }, strict: true },
  });
});

Deno.test('llm: 429, ошибка сети или отказ — следующий провайдер', async () => {
  const f = fakeFetch(new Response('slow down', { status: 429 }), completion('{}'));
  const reply = await createLlm([groq, gemini], f)(request);
  assert(reply.ok);
  assertEquals(reply.model, 'flash');
  assertEquals(f.calls[1]?.url, 'https://gemini.test/v1beta/openai/chat/completions');

  const both = await createLlm(
    [groq, gemini],
    fakeFetch(new TypeError('net'), new Response(null, { status: 400 })),
  )(request);
  assertEquals(both.ok ? null : both.reason, 'rejected');
  const none = await createLlm([groq], fakeFetch(new TypeError('net')))(request);
  assertEquals(none.ok ? null : none.reason, 'unavailable');
});
