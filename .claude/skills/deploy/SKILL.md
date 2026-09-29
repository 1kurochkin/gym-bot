---
name: deploy
description: Деплой бота в прод (Supabase Edge Function + миграции + секреты + webhook) с проверкой логина в Supabase CLI. Используй, когда просят задеплоить, выкатить, обновить прод, «залить на сервер», настроить боевого бота или webhook.
---

# /deploy — деплой в Supabase

Полный цикл: логин → проект → `.env.prod` → проверки → секреты → миграции → функция → webhook →
проверка. Ручная версия тех же шагов — README.md → «Деплой».

## Жёсткие правила

- **Секреты не видит никто, кроме файла.** Не читай `.env.prod` (ни `cat`, ни Read, ни `grep`
  значений), не проси присылать токены, пароли или строки подключения в чат, не подставляй их в
  команды сам. Всё, что трогает значения, — только через `.claude/skills/deploy/prod.sh` (печатает
  имена и статусы).
- **Логин делает пользователь.** `supabase login` интерактивный (браузер) и не работает без TTY.
  Если CLI не авторизован — попроси пользователя выполнить `supabase login` в своём терминале и жди.
- **Прод — только после подтверждения.** Перед первым изменением прода покажи проект (имя, ref,
  регион) и что будет сделано, дождись «да». Одно подтверждение покрывает один запуск /deploy.
- **Красный `deno task check` — стоп.** Не деплой с падающими тестами.
- `.env.prod` никогда не коммитится (он в `.gitignore`, проверь `git check-ignore .env.prod`).

## Шаги

### 1. Логин в Supabase CLI

```bash
supabase projects list -o json
```

- Ошибка про access token / login → попроси пользователя выполнить в своём терминале:
  `supabase login` (откроется браузер), затем сообщить, что готово. Повтори проверку.
- Успех → запомни список проектов (name, ref, region, status).

### 2. Выбор проекта

- Если `.env.prod` есть и `prod.sh ref` возвращает ref — это целевой проект; убедись, что он есть в
  списке.
- Иначе: один проект в списке → предложи его; несколько → спроси, какой (AskUserQuestion с name +
  ref). Нет проектов → попроси создать на supabase.com (бесплатный план) и вернуться.
- Проект не `ACTIVE_HEALTHY` (например, на паузе) → попроси восстановить его в дашборде.

### 3. `.env.prod`

```bash
.claude/skills/deploy/prod.sh fill    # создаст из шаблона, сгенерирует WEBHOOK_SECRET, CRON_SECRET, BOT_INFO
.claude/skills/deploy/prod.sh check
```

Если `FUNCTION_URL` пуст или указывает на другой проект:

```bash
.claude/skills/deploy/prod.sh set-ref <ref>
```

`MISSING: …` → попроси пользователя открыть `.env.prod` в редакторе и заполнить перечисленные
переменные (не в чат!). Подскажи, где взять:

| Переменная         | Где взять                                                         |
| ------------------ | ----------------------------------------------------------------- |
| `BOT_TOKEN`        | @BotFather → боевой бот (не dev)                                  |
| `ALLOWED_USER_IDS` | свой id у @userinfobot                                            |
| `DATABASE_URL`     | Dashboard → Connect → **Transaction pooler** (6543), с паролем БД |
| `MIGRATION_DB_URL` | Dashboard → Connect → **Session pooler** (5432), с паролем БД     |

Прямая ссылка: `https://supabase.com/dashboard/project/<ref>?showConnect=true`. Повторяй `fill` +
`check`, пока не будет `OK`. `WARN` про порты — исправить до деплоя.

### 4. Проверки перед деплоем

```bash
deno task check
git status --short
```

Незакоммиченные изменения — не блокер, но скажи о них пользователю: в прод уйдёт рабочая копия.

### 5. Подтверждение

Покажи: проект (name / ref / region), какие миграции новые (`ls supabase/migrations/*.sql`), что
будут обновлены секреты функции и задеплоена функция `bot`. Жди «да».

### 6. Деплой

```bash
.claude/skills/deploy/prod.sh secrets                  # секреты функции (без MIGRATION_DB_URL и FUNCTION_URL)
.claude/skills/deploy/prod.sh db-push                  # миграции через session pooler
supabase functions deploy bot --no-verify-jwt --use-api --project-ref "$(.claude/skills/deploy/prod.sh ref)"
```

- `db-push` упал на аутентификации → неверный пароль в `MIGRATION_DB_URL`, попроси поправить файл.
- Ошибка сборки функции про импорт `../../../src/...` → код вне `supabase/functions/` не попал в
  бандл. Остановись, опиши пользователю и предложи ADR (перенос `src/` в
  `supabase/functions/_shared/`).

### 7. Webhook

```bash
.claude/skills/deploy/prod.sh webhook-status
```

`url: NOT_SET` или `MISMATCH`, либо в этом запуске `fill` сгенерировал новый `WEBHOOK_SECRET` →

```bash
deno task webhook:set
```

Иначе не трогай: `webhook:set` сбрасывает очередь необработанных апдейтов.

### 8. Проверка

```bash
.claude/skills/deploy/prod.sh health          # ожидаем health: 200
.claude/skills/deploy/prod.sh webhook-status  # url: OK, last_error: none
```

Попроси пользователя написать боевому боту `/start`, затем ещё раз `webhook-status`: `last_error`
должен остаться `none`. Логи: Dashboard → Edge Functions → bot → Logs.

### 9. После деплоя

- Обнови STATUS.md: отметь пункт деплоя, запиши дату и ref.
- Первый деплой → напомни про секреты GitHub для бэкапа (README → Деплой → шаг 5): `BACKUP_DB_URL` =
  то же значение, что `MIGRATION_DB_URL`; `BACKUP_CHAT_ID` = свой id; `FUNCTION_URL`, `CRON_SECRET`,
  `BOT_TOKEN` — как в `.env.prod`. Пользователь вносит их сам в GitHub.

## Итог пользователю

Коротко: какой проект, что применено (миграции, функция, секреты — по именам, webhook тронут или
нет), результат `health` и `webhook-status`, что осталось сделать руками.
