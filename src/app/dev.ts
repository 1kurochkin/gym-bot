import { buildDeps } from './build-deps.ts';
import { readConfig } from './config.ts';

/** Локальная разработка: long polling без деплоя. Нужен `supabase start` и .env (см. .env.example). */
const config = readConfig((k) => Deno.env.get(k));
const { bot } = buildDeps(config);
await bot.api.deleteWebhook();
console.log('Бот запущен в режиме long polling. Ctrl+C — остановить.');
await bot.start();
