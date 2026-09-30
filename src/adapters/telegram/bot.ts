import { Bot, type Context, InlineKeyboard, Keyboard } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { IncomingUpdate, Rendered, Ui } from '../../ports/ui.ts';
import { decodeCallback, encodeCallback } from './callback.ts';

export type BotOptions = {
  readonly token: string;
  readonly allowedUserIds: ReadonlySet<number>;
  readonly onUpdate: (update: IncomingUpdate) => Promise<void>;
  /** Для тестов: без него grammY при первом апдейте вызывает getMe. */
  readonly botInfo?: UserFromGetMe;
};

/** grammY-бот: whitelist, мгновенный answerCallbackQuery, перевод апдейта в IncomingUpdate. */
export function createBot(opts: BotOptions): Bot {
  const bot = new Bot(opts.token, opts.botInfo ? { botInfo: opts.botInfo } : {});

  // Whitelist: чужим — тишина.
  bot.use(async (ctx, next) => {
    const id = ctx.from?.id;
    if (id !== undefined && opts.allowedUserIds.has(id)) await next();
  });

  // Сразу убираем «часики» на кнопке, до записи в БД.
  bot.on('callback_query', async (ctx, next) => {
    await ctx.answerCallbackQuery().catch(() => {});
    await next();
  });

  bot.use(async (ctx) => {
    const update = toIncoming(ctx);
    if (update) await opts.onUpdate(update);
  });

  return bot;
}

function toIncoming(ctx: Context): IncomingUpdate | null {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (userId === undefined || chatId === undefined) return null;
  const base = {
    updateId: ctx.update.update_id,
    userId,
    chatId,
    languageCode: ctx.from?.language_code ?? null,
  };

  const data = ctx.callbackQuery?.data;
  if (data !== undefined) {
    const decoded = decodeCallback(data);
    if (!decoded) return null;
    const messageId = ctx.callbackQuery?.message?.message_id ?? null;
    return { ...base, messageId, input: { kind: 'callback', ...decoded } };
  }

  const location = ctx.message?.location;
  if (location) {
    return {
      ...base,
      messageId: null,
      input: { kind: 'location', latitude: location.latitude, longitude: location.longitude },
    };
  }

  const text = ctx.message?.text;
  if (text === undefined) return null;
  const cmd = /^\/(\w+)(?:@\w+)?\s*(.*)$/s.exec(text);
  return cmd
    ? {
      ...base,
      messageId: null,
      input: { kind: 'command', name: cmd[1] ?? '', args: cmd[2] ?? '' },
    }
    : { ...base, messageId: null, input: { kind: 'text', text } };
}

export function createTelegramUi(bot: Bot): Ui {
  return {
    async show(chatId, rendered, stepNo, messageId): Promise<void> {
      if (rendered.replyKeyboard !== null) {
        // Reply-клавиатуру можно только отправить новым сообщением; старые кнопки убираем.
        if (messageId !== null) {
          await bot.api.editMessageReplyMarkup(chatId, messageId).catch(() => {});
        }
        const reply_markup = rendered.replyKeyboard === 'remove'
          ? { remove_keyboard: true as const }
          : new Keyboard().requestLocation('📍 Отправить геопозицию').resized().oneTime();
        await bot.api.sendMessage(chatId, rendered.text, { reply_markup });
        return;
      }
      const reply_markup = toKeyboard(rendered, stepNo);
      if (messageId !== null) {
        try {
          await bot.api.editMessageText(chatId, messageId, rendered.text, { reply_markup });
          return;
        } catch (e) {
          // Тот же текст — редактировать нечего; иначе сообщение слишком старое, отправим новое.
          if (String(e).includes('message is not modified')) return;
        }
      }
      await bot.api.sendMessage(chatId, rendered.text, { reply_markup });
    },
    async dropKeyboard(chatId, messageId): Promise<void> {
      await bot.api.editMessageReplyMarkup(chatId, messageId).catch(() => {});
    },
  };
}

function toKeyboard(rendered: Rendered, stepNo: number): InlineKeyboard {
  return InlineKeyboard.from(
    rendered.keyboard.map((row) =>
      row.map((b) => InlineKeyboard.text(b.label, encodeCallback(b.action, stepNo)))
    ),
  );
}
