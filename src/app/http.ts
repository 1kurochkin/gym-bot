import { webhookCallback } from 'grammy';
import type { Config } from './config.ts';
import type { Deps } from './build-deps.ts';

/**
 * HTTP-вход функции bot. Функция задеплоена с --no-verify-jwt, поэтому каждый путь
 * проверяет свой секрет сам: /webhook — X-Telegram-Bot-Api-Secret-Token, /health — X-Cron-Secret.
 */
export function createHttpHandler(deps: Deps, config: Config): (req: Request) => Promise<Response> {
  const webhook = config.webhookSecret
    ? webhookCallback(deps.bot, 'std/http', { secretToken: config.webhookSecret })
    : null;

  return async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;

    if (path.endsWith('/webhook') && req.method === 'POST') {
      if (!webhook) return new Response('webhook secret not configured', { status: 500 });
      return await webhook(req);
    }

    if (path.endsWith('/health')) {
      if (!config.cronSecret || req.headers.get('x-cron-secret') !== config.cronSecret) {
        return new Response('forbidden', { status: 403 });
      }
      await deps.store.ping();
      return new Response('ok');
    }

    return new Response('not found', { status: 404 });
  };
}
