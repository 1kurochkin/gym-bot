import { Api } from 'grammy';
import { setCommandMenus } from './command-menu.ts';
import { UserIdsSchema } from './config.ts';

/**
 * Регистрирует webhook с секретным токеном: `deno task webhook:set`.
 * Переменные BOT_TOKEN, WEBHOOK_SECRET, FUNCTION_URL, ALLOWED_USER_IDS (меню владельцев)
 * берутся из .env.prod (см. README → Деплой).
 */
const token = Deno.env.get('BOT_TOKEN');
const secret = Deno.env.get('WEBHOOK_SECRET');
const base = Deno.env.get('FUNCTION_URL');
const owners = UserIdsSchema.safeParse(Deno.env.get('ALLOWED_USER_IDS') ?? '');
if (!token || !secret || !base || !owners.success) {
  console.error(
    'Нужны BOT_TOKEN, WEBHOOK_SECRET, FUNCTION_URL и ALLOWED_USER_IDS в .env.prod ' +
      '(шаблон — .env.prod.example)',
  );
  Deno.exit(1);
}
const api = new Api(token);
await api.setWebhook(`${base.replace(/\/$/, '')}/webhook`, {
  secret_token: secret,
  allowed_updates: ['message', 'callback_query'],
  drop_pending_updates: true,
});
const menu = await setCommandMenus(api, owners.data);
const info = await api.getWebhookInfo();
console.log(`Webhook: ${info.url}; ожидают обработки: ${info.pending_update_count}`);
console.log(`Меню команд (ru, en): ${menu}`);
