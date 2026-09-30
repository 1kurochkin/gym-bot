import { parseTimeZone } from '../core/schedule/timezone.ts';
import type { BotEvent, View } from '../core/session/types.ts';
import { toEvent as onboardingEvent } from '../features/onboarding/handlers.ts';
import { renderView as renderOnboarding } from '../features/onboarding/views.ts';
import { KNOWN_COMMANDS } from '../features/help/commands.ts';
import { renderHelpView } from '../features/help/views.ts';
import { toEvent as programEvent } from '../features/program/handlers.ts';
import { renderProgramView } from '../features/program/views.ts';
import { toEvent as seedEvent } from '../features/seed/handlers.ts';
import { renderSeedView } from '../features/seed/views.ts';
import { assertNever } from '../shared/result.ts';
import type { ZoneLocator } from '../ports/geo.ts';
import type { Incoming, Rendered } from '../ports/ui.ts';

/**
 * Роутинг апдейта по фичам. Фичи с командами, файлами и кнопками — первыми;
 * онбординг последним: он превращает любой текст в text_entered, а шаг решает автомат.
 */
export async function routeEvent(input: Incoming, zoneAt: ZoneLocator): Promise<BotEvent | null> {
  if (input.kind === 'location') {
    // Поиск зоны по координатам — I/O-зависимость, поэтому здесь, а не в фиче. Координаты не сохраняем.
    const name = await zoneAt(input.latitude, input.longitude);
    const zone = name === null ? null : parseTimeZone(name);
    return { type: 'tz_located', zone: zone?.ok ? zone.value : null };
  }
  if (input.kind === 'command' && !KNOWN_COMMANDS.has(input.name)) {
    return { type: 'unknown_command', name: input.name };
  }
  return programEvent(input) ?? seedEvent(input) ?? onboardingEvent(input);
}

/** Экран → текст и кнопки фичи, которой он принадлежит. */
export function render(view: View): Rendered {
  switch (view.type) {
    case 'ask_time':
    case 'pick_zone':
    case 'home':
      return renderOnboarding(view);
    case 'program_status':
    case 'program_invalid':
    case 'program_confirm':
    case 'program_saved':
    case 'program_unchanged':
    case 'program_cancelled':
    case 'program_file_rejected':
      return renderProgramView(view);
    case 'seed_prompt':
    case 'seed_done':
    case 'seed_needs_program':
      return renderSeedView(view);
    case 'unknown_command':
      return renderHelpView(view);
    default:
      return assertNever(view);
  }
}
