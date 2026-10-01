import { Api } from 'grammy';
import { setCommandMenus } from './command-menu.ts';

/**
 * Регистрирует webhook с секретным токеном: `deno task webhook:set`.
 * Переменные BOT_TOKEN, WEBHOOK_SECRET, FUNCTION_URL берутся из .env.prod (см. README → Деплой).
 */
const token = Deno.env.get('BOT_TOKEN');
const secret = Deno.env.get('WEBHOOK_SECRET');
const base = Deno.env.get('FUNCTION_URL');
if (!token || !secret || !base) {
  console.error(
    'Нужны BOT_TOKEN, WEBHOOK_SECRET и FUNCTION_URL в .env.prod (шаблон — .env.prod.example)',
  );
  Deno.exit(1);
}
const api = new Api(token);
await api.setWebhook(`${base.replace(/\/$/, '')}/webhook`, {
  secret_token: secret,
  allowed_updates: ['message', 'callback_query'],
  drop_pending_updates: true,
});
const menu = await setCommandMenus(api);
const info = await api.getWebhookInfo();
console.log(`Webhook: ${info.url}; ожидают обработки: ${info.pending_update_count}`);
console.log(`Меню команд (ru, en): ${menu}`);
