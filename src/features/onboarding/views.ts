import { assertNever } from '../../shared/result.ts';
import { type AskTimeError, AskTimeErrorSchema, type View } from '../../core/session/types.ts';
import type { Language } from '../../core/settings/settings.ts';
import type { Rendered } from '../../ports/ui.ts';
import { zone } from '../i18n/format.ts';

const { not_time, location_unknown } = AskTimeErrorSchema.enum;

export type OnboardingView = Extract<View, { type: 'ask_time' | 'pick_zone' | 'home' }>;

const ru = {
  locationButton: '📍 Отправить геопозицию',
  pickZone: (offset: string) =>
    `Сейчас у тебя ${offset}. Выбери свой пояс — от него зависит переход на зимнее время:`,
  timezone: 'Часовой пояс',
  program: (name: string) => `Программа: «${name}».\n\nНачать тренировку — /workout`,
  noProgram: 'Программа ещё не загружена — /program',
  ask: 'Сколько у тебя сейчас времени? Напиши, например, 18:40.\n' +
    'Или нажми «📍 Отправить геопозицию» внизу — определю пояс сам.',
  hello: 'Привет! Я записываю тренировки и считаю разминку.\n\n' +
    'Сначала настроим часовой пояс — по нему считаются даты и недели тренировок.',
  notTime: 'Не понял время.',
  locationUnknown: 'По этой геопозиции пояс не определился.',
};

const en: typeof ru = {
  locationButton: '📍 Send location',
  pickZone: (offset: string) =>
    `It's ${offset} for you now. Pick your zone — it decides when daylight saving switches:`,
  timezone: 'Time zone',
  program: (name: string) => `Program: “${name}”.\n\nStart a workout — /workout`,
  noProgram: 'No program yet — /program',
  ask: 'What time is it for you now? Type it, e.g. 18:40 or 6:40 pm.\n' +
    'Or tap “📍 Send location” below and I’ll find the zone myself.',
  hello: 'Hi! I log workouts and calculate warm-ups.\n\n' +
    'First let’s set your time zone — workout dates and weeks are counted by it.',
  notTime: 'I didn’t get the time.',
  locationUnknown: 'Couldn’t find a time zone for that location.',
};

const MESSAGES: Record<Language, typeof ru> = { ru, en };

export function renderView(view: OnboardingView, lang: Language): Rendered {
  const t = MESSAGES[lang];
  switch (view.type) {
    case 'ask_time':
      return {
        text: askTimeText(view.error, lang),
        keyboard: [],
        replyKeyboard: { kind: 'request_location', label: t.locationButton },
      };
    case 'pick_zone':
      return {
        text: t.pickZone(view.offsetLabel),
        keyboard: view.options.map((
          o,
        ) => [{ label: zone(o.label, lang), action: { type: 'tz', zone: o.zone } }]),
        replyKeyboard: null,
      };
    case 'home':
      return {
        text: `${t.timezone}: ${zone(view.zone, lang)}\n\n` +
          (view.programName ? t.program(view.programName) : t.noProgram),
        keyboard: [],
        replyKeyboard: { kind: 'remove' },
      };
    default:
      return assertNever(view);
  }
}

function askTimeText(error: AskTimeError | null, lang: Language): string {
  const t = MESSAGES[lang];
  switch (error) {
    case null:
      return `${t.hello}\n\n${t.ask}`;
    case not_time:
      return `${t.notTime} ${t.ask}`;
    case location_unknown:
      return `${t.locationUnknown} ${t.ask}`;
    default:
      return assertNever(error);
  }
}
