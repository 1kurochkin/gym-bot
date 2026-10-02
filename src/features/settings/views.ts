import { assertNever } from '../../shared/result.ts';
import {
  BAR_OPTIONS_LB,
  BAR_RANGE_LB,
  type SettingsSection,
  SettingsSectionSchema,
  STEP_OPTIONS_LB,
  STEP_RANGE_LB,
  type StepSource,
  StepSourceSchema,
} from '../../core/settings/options.ts';
import type { View } from '../../core/session/types.ts';
import { type Language, LanguageSchema } from '../../core/settings/settings.ts';
import type { Button, Rendered } from '../../ports/ui.ts';
import { chunk, column, num, zone } from '../i18n/format.ts';

export type SettingsView = Extract<
  View,
  {
    type:
      | 'settings_menu'
      | 'settings_bar'
      | 'settings_plates'
      | 'settings_steps'
      | 'settings_step_edit'
      | 'settings_language';
  }
>;

const SECTION = SettingsSectionSchema.enum;
const SOURCE = StepSourceSchema.enum;

/** Название языка — всегда на нём самом: так его найдёт и тот, кто не читает текущий. */
const LANGUAGE_NAMES: Record<Language, string> = { ru: 'Русский', en: 'English' };

const ru = {
  back: 'Назад',
  saved: '✅ Сохранено\n',
  title: 'Настройки',
  timezone: 'Часовой пояс',
  notSet: 'не задан',
  bar: 'Гриф',
  plates: 'Блины',
  barStep: 'шаг штанги',
  steps: 'Шаг по упражнениям',
  stepsDefault: 'по умолчанию',
  stepsChanged: (n: number) => `изменён у ${n}`,
  language: 'Язык',
  done: 'Готово',
  rangeError: (min: string, max: string) => `⚠️ Нужно число от ${min} до ${max}.`,
  barNow: (current: string, min: string, max: string) =>
    `Гриф сейчас: ${current} lb. Выбери или напиши вес от ${min} до ${max} lb.`,
  bar15kg: ' (15 кг)',
  platesEmpty: '⚠️ Нужен хотя бы один блин.',
  platesAsk: 'Какие блины есть в зале? Отметь все — количество не важно, считаю, что пар хватает.',
  save: 'Сохранить',
  stepsTitle: 'Шаг веса по упражнениям. У штанги шаг задают блины.',
  stepsNone: 'В программе нет упражнений, у которых настраивается шаг.',
  stepNow: (name: string, step: string, note: string) => `${name}: шаг ${step} lb${note}.`,
  stepAsk: (min: string, max: string) => `Выбери или напиши от ${min} до ${max} lb.`,
  stepReset: 'По умолчанию',
  fromProgram: ' (из программы)',
  byDefault: ' (по умолчанию)',
  languageAsk: 'Язык бота. Названия упражнений и заметки остаются как в программе.',
};

const en: typeof ru = {
  back: 'Back',
  saved: '✅ Saved\n',
  title: 'Settings',
  timezone: 'Time zone',
  notSet: 'not set',
  bar: 'Bar',
  plates: 'Plates',
  barStep: 'barbell step',
  steps: 'Weight step per exercise',
  stepsDefault: 'default',
  stepsChanged: (n: number) => `changed for ${n}`,
  language: 'Language',
  done: 'Done',
  rangeError: (min: string, max: string) => `⚠️ I need a number from ${min} to ${max}.`,
  barNow: (current: string, min: string, max: string) =>
    `Bar now: ${current} lb. Pick or type a weight from ${min} to ${max} lb.`,
  bar15kg: ' (15 kg)',
  platesEmpty: '⚠️ Select at least one plate.',
  platesAsk: 'Which plates does your gym have? Tick them all — I assume there are enough pairs.',
  save: 'Save',
  stepsTitle: 'Weight step per exercise. For the barbell, the plates set the step.',
  stepsNone: 'The program has no exercises with an adjustable step.',
  stepNow: (name: string, step: string, note: string) => `${name}: step ${step} lb${note}.`,
  stepAsk: (min: string, max: string) => `Pick or type from ${min} to ${max} lb.`,
  stepReset: 'Default',
  fromProgram: ' (from program)',
  byDefault: ' (default)',
  languageAsk: 'Bot language. Exercise names and notes stay as in your program.',
};

const MESSAGES: Record<Language, typeof ru> = { ru, en };

export function renderSettingsView(view: SettingsView, lang: Language): Rendered {
  const t = MESSAGES[lang];
  const n = (x: number): string => num(x, lang);
  const back: Button = { label: t.back, action: { type: 'settings_back' } };
  const section = (label: string, s: SettingsSection): Button => ({
    label,
    action: { type: 'settings_section', section: s },
  });
  switch (view.type) {
    case 'settings_menu': {
      const lines = [
        view.saved ? t.saved : null,
        t.title,
        `${t.timezone}: ${view.zone ? zone(view.zone, lang) : t.notSet}`,
        `${t.bar}: ${n(view.barLb)} lb`,
        `${t.plates}: ${view.platesLb.map(n).join(', ')} lb → ${t.barStep} ${n(view.barStepLb)} lb`,
        `${t.steps}: ${view.overrides === 0 ? t.stepsDefault : t.stepsChanged(view.overrides)}`,
        `${t.language}: ${LANGUAGE_NAMES[view.language]}`,
      ].filter((l) => l !== null);
      return {
        text: lines.join('\n'),
        keyboard: [
          ...column<Button>([
            section(t.timezone, SECTION.timezone),
            section(t.bar, SECTION.bar),
            section(t.plates, SECTION.plates),
            section(t.steps, SECTION.steps),
            section(t.language, SECTION.language),
            { label: t.done, action: { type: 'settings_close' } },
          ]),
        ],
        replyKeyboard: null,
      };
    }
    case 'settings_bar':
      return {
        text: [
          view.invalid ? t.rangeError(n(BAR_RANGE_LB.min), n(BAR_RANGE_LB.max)) : null,
          t.barNow(n(view.currentLb), n(BAR_RANGE_LB.min), n(BAR_RANGE_LB.max)),
        ].filter((l) => l !== null).join('\n'),
        keyboard: [
          BAR_OPTIONS_LB.map((w): Button => ({
            label: `${w === view.currentLb ? '✓ ' : ''}${n(w)}${w === 33 ? t.bar15kg : ''}`,
            action: { type: 'bar_set', lb: w },
          })),
          [back],
        ],
        replyKeyboard: null,
      };
    case 'settings_plates':
      return {
        text: [view.empty ? t.platesEmpty : null, t.platesAsk].filter((l) => l !== null)
          .join('\n'),
        keyboard: [
          ...chunk(
            view.options.map((p): Button => ({
              label: `${view.selected.includes(p) ? '✓ ' : ''}${n(p)}`,
              action: { type: 'plate_toggle', lb: p },
            })),
            4,
          ),
          ...column<Button>([{ label: t.save, action: { type: 'plates_save' } }, back]),
        ],
        replyKeyboard: null,
      };
    case 'settings_steps':
      return {
        text: view.items.length ? t.stepsTitle : t.stepsNone,
        keyboard: [
          ...view.items.map((i) => [
            {
              label: `${i.name} — ${n(i.stepLb)} lb${sourceNote(i.source, lang)}`,
              action: { type: 'step_pick', exerciseId: i.exerciseId },
            } satisfies Button,
          ]),
          [back],
        ],
        replyKeyboard: null,
      };
    case 'settings_step_edit':
      return {
        text: [
          view.invalid ? t.rangeError(n(STEP_RANGE_LB.min), n(STEP_RANGE_LB.max)) : null,
          t.stepNow(view.name, n(view.stepLb), sourceNote(view.source, lang)),
          t.stepAsk(n(STEP_RANGE_LB.min), n(STEP_RANGE_LB.max)),
        ].filter((l) => l !== null).join('\n'),
        keyboard: [
          STEP_OPTIONS_LB.map((w): Button => ({
            label: `${w === view.stepLb ? '✓ ' : ''}${n(w)}`,
            action: { type: 'step_set', lb: w },
          })),
          ...(view.source === SOURCE.override
            ? [[{ label: t.stepReset, action: { type: 'step_reset' } } satisfies Button]]
            : []),
          [back],
        ],
        replyKeyboard: null,
      };
    case 'settings_language':
      return {
        text: t.languageAsk,
        keyboard: [
          ...column(LanguageSchema.options.map((l): Button => ({
            label: `${l === view.selected ? '✓ ' : ''}${LANGUAGE_NAMES[l]}`,
            action: { type: 'lang_set', language: l },
          }))),
          [back],
        ],
        replyKeyboard: null,
      };
    default:
      return assertNever(view);
  }
}

function sourceNote(source: StepSource, lang: Language): string {
  const t = MESSAGES[lang];
  switch (source) {
    case SOURCE.override:
      return '';
    case SOURCE.program:
      return t.fromProgram;
    case SOURCE.default:
      return t.byDefault;
    default:
      return assertNever(source);
  }
}
