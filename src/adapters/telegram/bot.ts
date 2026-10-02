import { Bot, type Context, InlineKeyboard, Keyboard } from 'grammy';
import type { MessageEntity, UserFromGetMe } from 'grammy/types';
import { FileProblemSchema } from '../../core/session/types.ts';
import type { IncomingUpdate, Rendered, Ui } from '../../ports/ui.ts';
import { decodeCallback, encodeCallback } from './callback.ts';

export type BotOptions = {
  readonly token: string;
  readonly onUpdate: (update: IncomingUpdate) => Promise<void>;
  /** Для тестов: без него grammY при первом апдейте вызывает getMe. */
  readonly botInfo?: UserFromGetMe;
};

/**
 * grammY-бот: только личные чаты, answerCallbackQuery после обработки, перевод апдейта в IncomingUpdate.
 * Кому отвечать (владелец, участник, приглашение) решает приложение: app/access.ts.
 */
export function createBot(opts: BotOptions): Bot {
  const bot = new Bot(opts.token, opts.botInfo ? { botInfo: opts.botInfo } : {});

  // Только личные чаты: группы и каналы бот не обслуживает.
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type === 'private' && ctx.from !== undefined) await next();
  });

  // Ответ на нажатие — после обработки: пока бот работает, Telegram крутит индикатор на кнопке
  // (.specs/decisions.md, 01.10). Двойное нажатие отсекает номер шага в кнопке, а не этот ответ.
  bot.on('callback_query', async (ctx, next) => {
    try {
      await next();
    } finally {
      await ctx.answerCallbackQuery().catch(() => {});
    }
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
    person: {
      name: [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || String(userId),
      username: ctx.from?.username ?? null,
    },
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
    const fileName = doc.file_name ?? 'file';
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
        const reply_markup = rendered.replyKeyboard.kind === 'remove'
          ? { remove_keyboard: true as const }
          : new Keyboard().requestLocation(rendered.replyKeyboard.label).resized().oneTime();
        await bot.api.sendMessage(chatId, rendered.text, {
          reply_markup,
          entities: bold(rendered),
        });
        return;
      }
      const reply_markup = toKeyboard(rendered, stepNo);
      if (messageId !== null) {
        try {
          await bot.api.editMessageText(chatId, messageId, rendered.text, {
            reply_markup,
            entities: bold(rendered),
          });
          return;
        } catch (e) {
          // Тот же текст — редактировать нечего; иначе сообщение слишком старое, отправим новое.
          if (String(e).includes('message is not modified')) return;
        }
      }
      await bot.api.sendMessage(chatId, rendered.text, { reply_markup, entities: bold(rendered) });
    },
    async dropKeyboard(chatId, messageId): Promise<void> {
      await bot.api.editMessageReplyMarkup(chatId, messageId).catch(() => {});
    },
  };
}

/**
 * Жирные фрагменты — разметкой Telegram (entities), а не HTML: тексту из программы не нужно
 * экранирование. Смещения в UTF-16, как и индексы строк JS.
 */
export function bold(rendered: Rendered): MessageEntity[] {
  return (rendered.bold ?? []).flatMap((part) => {
    const offset = part ? rendered.text.indexOf(part) : -1;
    return offset < 0 ? [] : [{ type: 'bold' as const, offset, length: part.length }];
  });
}

function toKeyboard(rendered: Rendered, stepNo: number): InlineKeyboard {
  return InlineKeyboard.from(
    rendered.keyboard.map((row) =>
      row.map((b) => InlineKeyboard.text(b.label, encodeCallback(b.action, stepNo)))
    ),
  );
}
