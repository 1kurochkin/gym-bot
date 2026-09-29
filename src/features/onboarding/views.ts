import { assertNever } from '../../shared/result.ts';
import { type AskTimeError, AskTimeErrorSchema, type View } from '../../core/session/types.ts';
import { type Rendered, ReplyKeyboardSchema } from '../../ports/ui.ts';

const { request_location, remove } = ReplyKeyboardSchema.enum;
const { not_time, location_unknown } = AskTimeErrorSchema.enum;

export function renderView(view: View): Rendered {
  switch (view.type) {
    case 'ask_time':
      return {
        text: askTimeText(view.error),
        keyboard: [],
        replyKeyboard: request_location,
      };
    case 'pick_zone':
      return {
        text:
          `Сейчас у тебя ${view.offsetLabel}. Выбери свой пояс — от него зависит переход на зимнее время:`,
        keyboard: view.options.map((
          o,
        ) => [{ label: o.label, action: { type: 'tz', zone: o.zone } }]),
        replyKeyboard: null,
      };
    case 'home':
      return {
        text: `Часовой пояс: ${view.timezoneLabel}\n\nПрограмма ещё не загружена.`,
        keyboard: [],
        replyKeyboard: remove,
      };
    default:
      return assertNever(view);
  }
}

function askTimeText(error: AskTimeError | null): string {
  const ask = 'Сколько у тебя сейчас времени? Напиши, например, 18:40.\n' +
    'Или нажми «📍 Отправить геопозицию» внизу — определю пояс сам.';
  switch (error) {
    case null:
      return 'Привет! Я записываю тренировки и считаю разминку.\n\n' +
        'Сначала настроим часовой пояс — по нему считаются даты и недели тренировок.\n\n' + ask;
    case not_time:
      return `Не понял время. ${ask}`;
    case location_unknown:
      return `По этой геопозиции пояс не определился. ${ask}`;
    default:
      return assertNever(error);
  }
}
