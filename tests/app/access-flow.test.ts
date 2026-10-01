import { assert, assertEquals } from '@std/assert';
import { handleUpdate, type UpdateDeps } from '../../src/app/handle-update.ts';
import { TimeZoneSchema } from '../../src/core/schedule/timezone.ts';
import { defaultSettings } from '../../src/core/settings/settings.ts';
import type { Action, Incoming } from '../../src/ports/ui.ts';
import { fakeUi, memoryStore, OWNERS } from '../support/fakes.ts';

/** US-9 (.specs/product.md): приглашения и доступ. Пользователь 1 — владелец, 2 и 3 — знакомые. */

const OWNER = 1;
const FRIEND = 2;
const STRANGER = 3;

function world(): {
  store: ReturnType<typeof memoryStore>;
  ui: ReturnType<typeof fakeUi>;
  as: (userId: number, input: Incoming, languageCode?: string) => Promise<void>;
  press: (userId: number, action: Action) => Promise<void>;
  setNow: (iso: string) => void;
  shownTo: (chatId: number) => string[];
} {
  const store = memoryStore();
  const ui = fakeUi();
  let n = 0;
  let updateId = 1;
  let now = new Date('2026-10-01T16:00:00Z'); // чт, 01.10, 12:00 в Нью-Йорке
  const deps: UpdateDeps = {
    store,
    ui,
    clock: { now: () => now },
    zoneAt: () => Promise.resolve(null),
    newId: () => `0000000${++n}-0000-4000-8000-000000000000`.slice(-36),
    owners: OWNERS,
    botUsername: () => 'gym_test_bot',
  };
  store.settings.set(OWNER, {
    ...defaultSettings(OWNER),
    timezone: TimeZoneSchema.parse('America/New_York'),
    language: 'ru',
  });
  const as = (userId: number, input: Incoming, languageCode = 'ru'): Promise<void> =>
    handleUpdate(deps, {
      updateId: updateId++,
      userId,
      chatId: userId,
      messageId: null,
      languageCode,
      person: {
        name: userId === FRIEND ? 'Иван' : 'Stranger',
        username: userId === FRIEND ? 'ivan' : null,
      },
      input,
    });
  return {
    store,
    ui,
    as,
    press: (userId, action) =>
      as(userId, { kind: 'callback', action, stepNo: store.sessions.get(userId)?.stepNo ?? -1 }),
    setNow: (iso) => (now = new Date(iso)),
    shownTo: (chatId) => ui.shown.filter((s) => s.chatId === chatId).map((s) => s.rendered.text),
  };
}

const cmd = (name: string, args = ''): Incoming => ({ kind: 'command', name, args });

/** /invite от владельца → код из ссылки. */
async function invite(w: ReturnType<typeof world>): Promise<string> {
  await w.as(OWNER, cmd('invite'));
  const code = /start=([0-9a-f]{32})/.exec(w.shownTo(OWNER).at(-1) ?? '')?.[1];
  assert(code, w.shownTo(OWNER).at(-1));
  return code;
}

Deno.test('без приглашения — тишина и никаких записей', async () => {
  const w = world();
  await w.as(STRANGER, cmd('start'));
  await w.as(STRANGER, { kind: 'text', text: 'привет' });
  await w.as(STRANGER, cmd('start', 'abc'));
  assertEquals(w.shownTo(STRANGER), [
    'Приглашение недействительно: оно истекло или уже использовано. Попроси новое.',
  ], 'единственный ответ чужому — на /start с кодом');
  assertEquals(w.store.sessions.has(STRANGER), false);
});

Deno.test('/invite → ссылка → вход по ней, владельцу уведомление на его языке', async () => {
  const w = world();
  const code = await invite(w);
  assertEquals(
    w.shownTo(OWNER).at(-1),
    `Ссылка-приглашение — перешли её:\nhttps://t.me/gym_test_bot?start=${code}\n\n` +
      'Сработает один раз, действует до 08.10.',
  );

  await w.as(FRIEND, cmd('start', code), 'en');
  assert(w.shownTo(FRIEND).at(-1)?.startsWith('Hi! I log workouts'), 'онбординг на языке Telegram');
  assertEquals(w.shownTo(OWNER).at(-1), 'Иван (@ivan) присоединился по приглашению.');
  assertEquals(w.store.members.get(FRIEND)?.invitedBy, OWNER);

  await w.as(FRIEND, { kind: 'text', text: '18:40' }, 'en');
  assert(w.shownTo(FRIEND).length > 1, 'дальше бот отвечает участнику');
});

Deno.test('приглашение одноразовое и с сроком; участник код не тратит', async () => {
  const w = world();
  const code = await invite(w);
  await w.as(FRIEND, cmd('start', code));
  await w.as(STRANGER, cmd('start', code));
  assertEquals(w.store.members.has(STRANGER), false, 'второй вход тем же кодом не проходит');
  assert(w.shownTo(STRANGER).at(-1)?.startsWith('Приглашение недействительно'));

  const next = await invite(w);
  await w.as(FRIEND, cmd('start', next));
  assertEquals(w.store.invites.get(next)?.usedBy, null, 'участнику код не нужен');

  w.setNow('2026-10-08T16:00:01Z');
  await w.as(STRANGER, cmd('start', next), 'en');
  assertEquals(w.store.members.has(STRANGER), false, 'через 7 дней код истёк');
  assertEquals(
    w.shownTo(STRANGER).at(-1),
    'This invite is no longer valid: it expired or was already used. Ask for a new one.',
  );
});

Deno.test('участнику /invite и /users — неизвестные команды, без команд владельца в списке', async () => {
  const w = world();
  await w.as(FRIEND, cmd('start', await invite(w)));
  await w.as(FRIEND, cmd('invite'));
  const help = w.shownTo(FRIEND).at(-1) ?? '';
  assert(help.startsWith('Не знаю команду /invite.'), help);
  assertEquals(help.includes('/users'), false);
  assertEquals(w.store.invites.size, 1, 'участник приглашение не создал');
});

Deno.test('/users: список, отключение с подтверждением — дальше тишина, данные остаются', async () => {
  const w = world();
  await w.as(FRIEND, cmd('start', await invite(w)));
  await w.as(OWNER, cmd('users'));
  assertEquals(w.shownTo(OWNER).at(-1), 'Пользователи бота:\n• Иван (@ivan) — с 01.10');

  await w.press(OWNER, { type: 'member_pick', userId: FRIEND });
  assert(w.shownTo(OWNER).at(-1)?.startsWith('Отключить Иван (@ivan)?'));
  await w.press(OWNER, { type: 'revoke_answer', confirm: false });
  assertEquals(w.store.members.get(FRIEND)?.revoked, false, 'отмена ничего не меняет');

  await w.press(OWNER, { type: 'member_pick', userId: FRIEND });
  await w.press(OWNER, { type: 'revoke_answer', confirm: true });
  assertEquals(
    w.shownTo(OWNER).at(-1),
    '✅ Иван (@ivan): доступ отключён, данные сохранены.\nПока только ты. Пригласить — /invite',
  );

  const before = w.shownTo(FRIEND).length;
  await w.as(FRIEND, cmd('start'));
  assertEquals(w.shownTo(FRIEND).length, before, 'отключённому — тишина');
  assert(w.store.sessions.has(FRIEND), 'данные участника не удалены');

  await w.as(FRIEND, cmd('start', await invite(w)));
  assertEquals(w.store.members.get(FRIEND)?.revoked, false, 'новое приглашение возвращает доступ');
});
