import { z } from 'zod';

export const LbSchema = z.number().nonnegative().brand<'lb'>();
export type Lb = z.infer<typeof LbSchema>;

export const lb = (value: number): Lb => LbSchema.parse(value);
