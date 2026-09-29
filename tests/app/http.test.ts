import { assertEquals } from '@std/assert';
import { buildDeps } from '../../src/app/build-deps.ts';
import { readConfig } from '../../src/app/config.ts';
import { createHttpHandler } from '../../src/app/http.ts';
import { memoryStore } from '../support/fakes.ts';

const env: Record<string, string> = {
  BOT_TOKEN: '123:test',
  ALLOWED_USER_IDS: '1',
  DATABASE_URL: 'postgres://unused',
  WEBHOOK_SECRET: 'webhook-secret-0123456789',
  CRON_SECRET: 'cron-secret-0123456789',
};
const config = readConfig((k) => env[k]);
const botInfo = {
  id: 123,
  is_bot: true as const,
  first_name: 'test',
  username: 'test_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};
const handler = createHttpHandler(buildDeps(config, { store: memoryStore(), botInfo }), config);
const url = 'http://localhost/bot';

Deno.test('/health без секрета — 403, с секретом — 200', async () => {
  assertEquals((await handler(new Request(`${url}/health`))).status, 403);
  const res = await handler(
    new Request(`${url}/health`, { headers: { 'x-cron-secret': env.CRON_SECRET ?? '' } }),
  );
  assertEquals([res.status, await res.text()], [200, 'ok']);
});

Deno.test('/webhook с неверным секретом отклоняется', async () => {
  const res = await handler(
    new Request(`${url}/webhook`, {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
      body: '{}',
    }),
  );
  assertEquals(res.status, 401);
});

Deno.test('неизвестный путь — 404', async () => {
  assertEquals((await handler(new Request(`${url}/anything`))).status, 404);
});
