import { z } from 'zod';
import { LocalDateSchema } from '../schedule/calendar.ts';

/** Доступ к боту (.specs/product.md → US-9): владельцы — в конфигурации, участники — по приглашению. */

/** Срок жизни приглашения. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Код приглашения в ссылке t.me/<бот>?start=<код>: 32 hex-символа случайного UUID. */
export const InviteCodeSchema = z.string().regex(/^[0-9a-f]{32}$/).brand<'InviteCode'>();
export type InviteCode = z.infer<typeof InviteCodeSchema>;

/** UUID → код приглашения; null — не UUID. */
export function inviteCodeFrom(uuid: string): InviteCode | null {
  const r = InviteCodeSchema.safeParse(uuid.replaceAll('-', '').toLowerCase());
  return r.success ? r.data : null;
}

/** Как показать человека: имя из Telegram и @username, если есть. */
export const PersonSchema = z.object({
  name: z.string(),
  username: z.string().nullable(),
}).readonly();
export type Person = z.infer<typeof PersonSchema>;

/** Участник с действующим доступом (для /users). */
export const MemberSchema = z.object({
  userId: z.number().int().positive(),
  person: PersonSchema,
  joinedAt: z.date(),
}).readonly();
export type Member = z.infer<typeof MemberSchema>;

export const MemberViewSchema = z.object({
  userId: z.number().int().positive(),
  person: PersonSchema,
  /** Локальная дата входа по поясу владельца. */
  joinedOn: LocalDateSchema.nullable(),
}).readonly();
