import { buildDeps } from './build-deps.ts';
import { readConfig } from './config.ts';
import { setCommandMenus } from './command-menu.ts';

const config = readConfig((k) => Deno.env.get(k));
const { bot } = buildDeps(config);
await bot.api.deleteWebhook();
await setCommandMenus(bot.api, config.ownerIds);
console.log('Бот запущен в режиме long polling. Ctrl+C — остановить.');
await bot.start();
