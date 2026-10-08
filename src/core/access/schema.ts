import { z } from 'zod';
import { LocalDateSchema } from '../schedule/calendar.ts';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const InviteCodeSchema = z.string().regex(/^[0-9a-f]{32}$/).brand<'InviteCode'>();
export type InviteCode = z.infer<typeof InviteCodeSchema>;

export function inviteCodeFrom(uuid: string): InviteCode | null {
  const r = InviteCodeSchema.safeParse(uuid.replaceAll('-', '').toLowerCase());
  return r.success ? r.data : null;
}

export const PersonSchema = z.object({
  name: z.string(),
  username: z.string().nullable(),
}).readonly();
export type Person = z.infer<typeof PersonSchema>;

export const MemberSchema = z.object({
  userId: z.number().int().positive(),
  person: PersonSchema,
  joinedAt: z.date(),
}).readonly();
export type Member = z.infer<typeof MemberSchema>;

export const MemberViewSchema = z.object({
  userId: z.number().int().positive(),
  person: PersonSchema,
  joinedOn: LocalDateSchema.nullable(),
}).readonly();
