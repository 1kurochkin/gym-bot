import { InviteCodeSchema } from '../core/access/schema.ts';
import { languageFor } from '../core/settings/settings.ts';
import type { IncomingUpdate } from '../ports/ui.ts';
import type { UpdateDeps } from './handle-update.ts';
import { render } from './route.ts';

export async function admit(deps: UpdateDeps, update: IncomingUpdate): Promise<boolean> {
  if (deps.owners.has(update.userId)) return true;
  if (await deps.store.isMember(update.userId)) return true;

  const input = update.input;
  if (input.kind !== 'command' || input.name !== 'start' || input.args.trim() === '') return false;

  const lang = languageFor(null, update.languageCode);
  const env = { botUsername: deps.botUsername() };
  const code = InviteCodeSchema.safeParse(input.args.trim());
  const joined = code.success
    ? await deps.store.redeemInvite(code.data, update.userId, update.person, deps.clock.now())
    : null;
  if (joined === null) {
    const text = render({ type: 'invite_invalid' }, lang, env);
    await deps.ui.show(update.chatId, text, 0, null);
    return false;
  }

  const inviter = await deps.store.load(joined.invitedBy);
  const inviterLang = languageFor(inviter.settings.language, null);
  const note = render({ type: 'member_joined', person: update.person }, inviterLang, env);
  await deps.ui.show(joined.invitedBy, note, 0, null).catch(() => {});
  return true;
}
