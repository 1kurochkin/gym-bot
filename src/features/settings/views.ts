import { assertNever } from '../../shared/result.ts';
import {
  BAR_OPTIONS_LB,
  BAR_RANGE_LB,
  SettingsSectionSchema,
  STEP_OPTIONS_LB,
  STEP_RANGE_LB,
  type StepSource,
  StepSourceSchema,
} from '../../core/settings/options.ts';
import type { View } from '../../core/session/types.ts';
import type { Button, Rendered } from '../../ports/ui.ts';

export type SettingsView = Extract<
  View,
  {
    type:
      | 'settings_menu'
      | 'settings_bar'
      | 'settings_plates'
      | 'settings_steps'
      | 'settings_step_edit';
  }
>;

const SECTION = SettingsSectionSchema.enum;
const back: Button = { label: 'Назад', action: { type: 'settings_back' } };

/** 2.5 → «2,5»: дробные фунты с запятой. */
const num = (n: number): string => String(n).replace('.', ',');

export function renderSettingsView(view: SettingsView): Rendered {
  switch (view.type) {
    case 'settings_menu': {
      const overrides = view.overrides === 0 ? 'по умолчанию' : `изменён у ${view.overrides}`;
      const lines = [
        view.saved ? '✅ Сохранено\n' : null,
        'Настройки',
        `Часовой пояс: ${view.timezoneLabel ?? 'не задан'}`,
        `Гриф: ${num(view.barLb)} lb`,
        `Блины: ${view.platesLb.map(num).join(', ')} lb → шаг штанги ${num(view.barStepLb)} lb`,
        `Шаг по упражнениям: ${overrides}`,
      ].filter((l) => l !== null);
      return {
        text: lines.join('\n'),
        keyboard: [
          [
            {
              label: 'Часовой пояс',
              action: { type: 'settings_section', section: SECTION.timezone },
            },
            { label: 'Гриф', action: { type: 'settings_section', section: SECTION.bar } },
          ],
          [
            { label: 'Блины', action: { type: 'settings_section', section: SECTION.plates } },
            {
              label: 'Шаг по упражнениям',
              action: { type: 'settings_section', section: SECTION.steps },
            },
          ],
          [{ label: 'Готово', action: { type: 'settings_close' } }],
        ],
        replyKeyboard: null,
      };
    }
    case 'settings_bar':
      return {
        text: [
          view.invalid ? `⚠️ Нужно число от ${BAR_RANGE_LB.min} до ${BAR_RANGE_LB.max}.` : null,
          `Гриф сейчас: ${
            num(view.currentLb)
          } lb. Выбери или напиши вес от ${BAR_RANGE_LB.min} до ${BAR_RANGE_LB.max} lb.`,
        ].filter((l) => l !== null).join('\n'),
        keyboard: [
          BAR_OPTIONS_LB.map((w): Button => ({
            label: `${w === view.currentLb ? '✓ ' : ''}${num(w)}${w === 33 ? ' (15 кг)' : ''}`,
            action: { type: 'bar_set', lb: w },
          })),
          [back],
        ],
        replyKeyboard: null,
      };
    case 'settings_plates':
      return {
        text: [
          view.empty ? '⚠️ Нужен хотя бы один блин.' : null,
          'Какие блины есть в зале? Отметь все — количество не важно, считаю, что пар хватает.',
        ].filter((l) => l !== null).join('\n'),
        keyboard: [
          ...chunk(
            view.options.map((p): Button => ({
              label: `${view.selected.includes(p) ? '✓ ' : ''}${num(p)}`,
              action: { type: 'plate_toggle', lb: p },
            })),
            4,
          ),
          [{ label: 'Сохранить', action: { type: 'plates_save' } } satisfies Button, back],
        ],
        replyKeyboard: null,
      };
    case 'settings_steps':
      return {
        text: view.items.length
          ? 'Шаг веса по упражнениям. У штанги шаг задают блины.'
          : 'В программе нет упражнений, у которых настраивается шаг.',
        keyboard: [
          ...view.items.map((i) => [
            {
              label: `${i.name} — ${num(i.stepLb)} lb${sourceNote(i.source)}`,
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
          view.invalid
            ? `⚠️ Нужно число от ${num(STEP_RANGE_LB.min)} до ${STEP_RANGE_LB.max}.`
            : null,
          `${view.name}: шаг ${num(view.stepLb)} lb${sourceNote(view.source)}.`,
          `Выбери или напиши от ${num(STEP_RANGE_LB.min)} до ${STEP_RANGE_LB.max} lb.`,
        ].filter((l) => l !== null).join('\n'),
        keyboard: [
          STEP_OPTIONS_LB.map((w): Button => ({
            label: `${w === view.stepLb ? '✓ ' : ''}${num(w)}`,
            action: { type: 'step_set', lb: w },
          })),
          view.source === StepSourceSchema.enum.override
            ? [{ label: 'По умолчанию', action: { type: 'step_reset' } } satisfies Button, back]
            : [back],
        ],
        replyKeyboard: null,
      };
    default:
      return assertNever(view);
  }
}

function sourceNote(source: StepSource): string {
  switch (source) {
    case StepSourceSchema.enum.override:
      return '';
    case StepSourceSchema.enum.program:
      return ' (из программы)';
    case StepSourceSchema.enum.default:
      return ' (по умолчанию)';
    default:
      return assertNever(source);
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}
