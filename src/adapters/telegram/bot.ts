import { Bot, type Context, InlineKeyboard, Keyboard } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { FileProblemSchema } from '../../core/session/types.ts';
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
    const update = await toIncoming(ctx, (fileId) => downloadText(bot, fileId));
    if (update) await opts.onUpdate(update);
  });

  return bot;
}

/** Файл программы: не больше 100 КБ, расширение .json или тип application/json. */
const MAX_FILE_BYTES = 100 * 1024;
const { too_large, not_json, download_failed } = FileProblemSchema.enum;

type Download = (fileId: string) => Promise<string | null>;

/** Скачать файл из Telegram как текст; null — не получилось. */
async function downloadText(bot: Bot, fileId: string): Promise<string | null> {
  try {
    const file = await bot.api.getFile(fileId);
    if (!file.file_path) return null;
    const res = await fetch(`https://api.telegram.org/file/bot${bot.token}/${file.file_path}`, {
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function toIncoming(ctx: Context, download: Download): Promise<IncomingUpdate | null> {
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

  const doc = ctx.message?.document;
  if (doc) {
    const fileName = doc.file_name ?? 'файл';
    const isJson = fileName.toLowerCase().endsWith('.json') || doc.mime_type === 'application/json';
    const tooLarge = (doc.file_size ?? 0) > MAX_FILE_BYTES;
    const text = isJson && !tooLarge ? await download(doc.file_id) : null;
    const problem = !isJson
      ? not_json
      : tooLarge
      ? too_large
      : text === null
      ? download_failed
      : null;
    return { ...base, messageId: null, input: { kind: 'document', fileName, text, problem } };
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
