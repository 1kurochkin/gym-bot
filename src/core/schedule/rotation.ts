import { z } from 'zod';

/** Выбор дня (US-2): следующий по rotation — первым, остальные в порядке программы. */
export const DayChoiceSchema = z.object({
  next: z.string(),
  others: z.array(z.string()).readonly(),
}).readonly();
export type DayChoice = z.infer<typeof DayChoiceSchema>;

/**
 * Следующий день считается от последней завершённой тренировки, а не по календарю:
 * пропущенный день недели не сбивает порядок. Нет истории или день удалён из программы — первый.
 */
export function nextDay(rotation: readonly string[], lastCompletedDayId: string | null): DayChoice {
  const at = lastCompletedDayId === null ? -1 : rotation.indexOf(lastCompletedDayId);
  const next = rotation[(at + 1) % rotation.length] ?? '';
  return { next, others: rotation.filter((id) => id !== next) };
}
