import { z } from 'zod';

export const ProgramStatusSchema = z.enum(['active', 'archived']);
export type ProgramStatus = z.infer<typeof ProgramStatusSchema>;
