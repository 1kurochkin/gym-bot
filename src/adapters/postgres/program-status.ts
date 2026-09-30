import { z } from 'zod';

/** Статус программы в хранилище: активна одна, остальные — архив с историей. */
export const ProgramStatusSchema = z.enum(['active', 'archived']);
export type ProgramStatus = z.infer<typeof ProgramStatusSchema>;
