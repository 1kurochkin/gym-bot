import { assertEquals, assertThrows } from '@std/assert';
import { readConfig } from '../../src/app/config.ts';

const base: Record<string, string> = {
  BOT_TOKEN: '123:abc',
  ALLOWED_USER_IDS: '1, 22',
  DATABASE_URL: 'postgres://x',
};
const read = (extra: Record<string, string> = {}): ReturnType<typeof readConfig> => {
  const env = { ...base, ...extra };
  return readConfig((k) => env[k]);
};

Deno.test('config: список id → Set, пустые необязательные переменные → null', () => {
  const c = read({ WEBHOOK_SECRET: '', CRON_SECRET: '', BOT_INFO: '' });
  assertEquals([...c.ownerIds], [1, 22]);
  assertEquals([c.webhookSecret, c.cronSecret, c.botInfo], [null, null, null]);
});

Deno.test('config: BOT_INFO разбирается из JSON', () => {
  const c = read({
    BOT_INFO: '{"id":5,"is_bot":true,"first_name":"b","username":"b_bot","can_join_groups":false}',
  });
  assertEquals(c.botInfo?.username, 'b_bot');
  assertEquals(c.botInfo?.['can_join_groups'], false, 'лишние поля getMe сохраняются');
});

Deno.test('config: ошибки конфигурации падают при старте', () => {
  assertThrows(() => read({ ALLOWED_USER_IDS: '1,abc' }));
  assertThrows(() => read({ ALLOWED_USER_IDS: '' }));
  assertThrows(() => read({ WEBHOOK_SECRET: 'short' }));
  assertThrows(() => read({ BOT_INFO: '{not json' }));
  assertThrows(() => read({ BOT_INFO: '{"id":5}' }));
});
