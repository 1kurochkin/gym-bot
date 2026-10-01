import { assertNever } from '../../shared/result.ts';
import type { Person } from '../../core/access/schema.ts';
import type { View } from '../../core/session/types.ts';
import type { Language } from '../../core/settings/settings.ts';
import type { Button, Rendered, RenderEnv } from '../../ports/ui.ts';
import { date } from '../i18n/format.ts';

export type AccessView = Extract<
  View,
  {
    type:
      | 'invite_created'
      | 'users_list'
      | 'users_revoke_confirm'
      | 'member_joined'
      | 'invite_invalid';
  }
>;

const ru = {
  invite: (link: string, until: string | null) =>
    `Ссылка-приглашение — перешли её:\n${link}\n\n` +
    `Сработает один раз${until ? `, действует до ${until}` : ', действует 7 дней'}.`,
  joined: (who: string) => `${who} присоединился по приглашению.`,
  invalid: 'Приглашение недействительно: оно истекло или уже использовано. Попроси новое.',
  users: 'Пользователи бота:',
  noUsers: 'Пока только ты. Пригласить — /invite',
  since: (d: string) => `с ${d}`,
  revoked: (who: string) => `✅ ${who}: доступ отключён, данные сохранены.\n`,
  revokeButton: (name: string) => `Отключить ${name}`,
  revokeAsk: (who: string) =>
    `Отключить ${who}? Его данные сохранятся, вернуть — новым приглашением.`,
  revokeYes: 'Отключить',
  cancel: 'Отмена',
};

const en: typeof ru = {
  invite: (link: string, until: string | null) =>
    `Invite link — forward it:\n${link}\n\n` +
    `Works once${until ? `, valid until ${until}` : ', valid for 7 days'}.`,
  joined: (who: string) => `${who} joined with your invite.`,
  invalid: 'This invite is no longer valid: it expired or was already used. Ask for a new one.',
  users: 'Bot users:',
  noUsers: 'Just you so far. Invite someone — /invite',
  since: (d: string) => `since ${d}`,
  revoked: (who: string) => `✅ ${who}: access revoked, data kept.\n`,
  revokeButton: (name: string) => `Revoke ${name}`,
  revokeAsk: (who: string) =>
    `Revoke access for ${who}? Their data stays; a new invite restores it.`,
  revokeYes: 'Revoke',
  cancel: 'Cancel',
};

const MESSAGES: Record<Language, typeof ru> = { ru, en };

/** «Иван (@ivan)». */
const who = (p: Person): string => (p.username ? `${p.name} (@${p.username})` : p.name);

const text = (value: string, keyboard: Button[][] = []): Rendered => ({
  text: value,
  keyboard,
  replyKeyboard: null,
});

export function renderAccessView(view: AccessView, lang: Language, env: RenderEnv): Rendered {
  const t = MESSAGES[lang];
  switch (view.type) {
    case 'invite_created':
      return text(
        t.invite(
          `https://t.me/${env.botUsername}?start=${view.code}`,
          view.expiresOn ? date(view.expiresOn, lang) : null,
        ),
      );
    case 'member_joined':
      return text(t.joined(who(view.person)));
    case 'invite_invalid':
      return text(t.invalid);
    case 'users_list': {
      const lines = view.members.map((m) =>
        `• ${who(m.person)}${m.joinedOn ? ` — ${t.since(date(m.joinedOn, lang))}` : ''}`
      );
      return text(
        (view.revoked ? t.revoked(who(view.revoked)) : '') +
          (lines.length ? `${t.users}\n${lines.join('\n')}` : t.noUsers),
        view.members.map((m) => [{
          label: t.revokeButton(m.person.name),
          action: { type: 'member_pick', userId: m.userId },
        }]),
      );
    }
    case 'users_revoke_confirm':
      return text(t.revokeAsk(who(view.person)), [[
        { label: t.revokeYes, action: { type: 'revoke_answer', confirm: true } },
        { label: t.cancel, action: { type: 'revoke_answer', confirm: false } },
      ]]);
    default:
      return assertNever(view);
  }
}
