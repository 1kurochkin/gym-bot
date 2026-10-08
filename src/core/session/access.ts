import { INVITE_TTL_MS, inviteCodeFrom, type Member } from '../access/schema.ts';
import { localDateOf } from '../schedule/calendar.ts';
import { moveTo, unchanged, withEffects } from './flow.ts';
import {
  type Person,
  type Session,
  SessionStepSchema,
  type StepContext,
  type StepResult,
} from './types.ts';

const S = SessionStepSchema.enum;

export const unknownCommand = (state: Session, ctx: StepContext, name: string): StepResult => ({
  state,
  effects: [{ type: 'render', view: { type: 'unknown_command', name, owner: ctx.isOwner } }],
});

export function requestInvite(state: Session, ctx: StepContext): StepResult {
  if (!ctx.isOwner) return unknownCommand(state, ctx, 'invite');
  const code = inviteCodeFrom(ctx.newIds[0] ?? '');
  if (code === null) return unchanged(state);
  const expiresAt = new Date(ctx.now.getTime() + INVITE_TTL_MS);
  const zone = ctx.settings.timezone;
  return withEffects(
    moveTo(state, S.idle, {
      type: 'invite_created',
      code,
      expiresOn: zone ? localDateOf(expiresAt, zone) : null,
    }),
    [{ type: 'create_invite', code, expiresAt }],
  );
}

export function requestUsers(state: Session, ctx: StepContext): StepResult {
  if (!ctx.isOwner) return unknownCommand(state, ctx, 'users');
  return usersList(state, ctx, ctx.members, null);
}

export function pickMember(state: Session, ctx: StepContext, userId: number): StepResult {
  if (state.step !== S.users) return unchanged(state);
  const member = ctx.members.find((m) => m.userId === userId);
  if (!member) return usersList(state, ctx, ctx.members, null);
  return moveTo(
    state,
    S.users_revoke_confirm,
    { type: 'users_revoke_confirm', person: member.person },
    { kind: 'member_revoke', userId, person: member.person },
  );
}

export function answerRevoke(state: Session, ctx: StepContext, confirm: boolean): StepResult {
  const c = state.context;
  if (state.step !== S.users_revoke_confirm || c.kind !== 'member_revoke') return unchanged(state);
  if (!confirm) return usersList(state, ctx, ctx.members, null);
  const rest = ctx.members.filter((m) => m.userId !== c.userId);
  return withEffects(usersList(state, ctx, rest, c.person), [
    { type: 'revoke_member', userId: c.userId },
  ]);
}

function usersList(
  state: Session,
  ctx: StepContext,
  members: readonly Member[],
  revoked: Person | null,
): StepResult {
  const zone = ctx.settings.timezone;
  return moveTo(state, S.users, {
    type: 'users_list',
    members: members.map((m) => ({
      userId: m.userId,
      person: m.person,
      joinedOn: zone ? localDateOf(m.joinedAt, zone) : null,
    })),
    revoked,
  });
}
