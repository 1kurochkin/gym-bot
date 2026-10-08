import { z } from 'zod';

export const DayChoiceSchema = z.object({
  next: z.string(),
  others: z.array(z.string()).readonly(),
}).readonly();
export type DayChoice = z.infer<typeof DayChoiceSchema>;

export function nextDay(rotation: readonly string[], lastCompletedDayId: string | null): DayChoice {
  const at = lastCompletedDayId === null ? -1 : rotation.indexOf(lastCompletedDayId);
  const next = rotation[(at + 1) % rotation.length] ?? '';
  return { next, others: rotation.filter((id) => id !== next) };
}
