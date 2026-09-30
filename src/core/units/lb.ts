import { z } from 'zod';

/** Вес в фунтах. Все веса в системе — Lb (ADR-0002). */
export const LbSchema = z.number().nonnegative().brand<'lb'>();
export type Lb = z.infer<typeof LbSchema>;

/** Для констант и уже проверенных чисел; ввод пользователя — через LbSchema.safeParse. */
export const lb = (value: number): Lb => LbSchema.parse(value);
