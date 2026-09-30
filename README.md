# Gym Coach Bot

Личный Telegram-бот для зала: хранит программу тренировок, считает разминку от рабочего веса,
логирует каждый подход и выгружает всё в `.xlsx` для анализа. Веса в фунтах (lb).

Стек: Supabase Edge Functions (Deno, grammY) + Postgres (Drizzle), GitHub Actions для CI и бэкапа.

- Что делает бот — [.specs/](.specs/README.md)
- Как устроен код — [docs/](docs/README.md), прежде всего
  [docs/architecture.md](docs/architecture.md)
- Текущий этап — [STATUS.md](STATUS.md)

> Репозиторий публичный: секреты, дампы БД, выгрузки и реальные данные тренировок сюда не
> коммитятся. Все `.env*` файлы, кроме шаблонов `*.example`, в `.gitignore`.

## Требования

```bash
brew install deno supabase/tap/supabase jq
```

Плюс Docker Desktop — для локального Supabase.

## Локальный запуск

1. Создать **dev-бота** в @BotFather (отдельного от боевого: long polling и webhook на одном токене
   конфликтуют). Свой Telegram user id подскажет @userinfobot.
2. Поднять локальный Supabase (Postgres + миграции из `supabase/migrations/`):
   ```bash
   supabase start
   ```
3. Заполнить `.env`:
   ```bash
   cp .env.example .env   # вписать BOT_TOKEN dev-бота и ALLOWED_USER_IDS
   ```
4. Запустить бота в режиме long polling и написать ему `/start`:
   ```bash
   deno task dev
   ```

> **Если dev и прод — один бот** (одинаковый `BOT_TOKEN` в `.env` и `.env.prod`): `deno task dev`
> при старте снимает webhook, и прод перестаёт отвечать. После локальной разработки верните его:
> `deno task webhook:set`.

Данные — в Supabase Studio: http://127.0.0.1:54323 → Table Editor. Сбросить локальную БД к
миграциям: `supabase db reset`.

## Проверки

```bash
deno task check                                  # fmt + lint + typecheck + тесты + architecture test
deno test tests/core/ --allow-read --filter "…"  # один тест
```

CI (`.github/workflows/ci.yml`) запускает `deno task check` на каждый push.

## Деплой

**Быстрый путь — скилл `/deploy` в Claude Code.** Он проверит логин в Supabase CLI (если нет —
попросит выполнить `supabase login`), предложит проект, создаст `.env.prod` и сам сгенерирует
`WEBHOOK_SECRET`, `CRON_SECRET`, `BOT_INFO`, `FUNCTION_URL`. Вручную останется вписать в `.env.prod`
токен бота, свой id и две строки подключения к БД. Дальше — секреты, миграции, функция, webhook и
проверка `/health`. Значения секретов скилл не читает и в чат не выводит
(`.claude/skills/deploy/prod.sh`).

Ниже — те же шаги вручную.

### Первый деплой (один раз)

**1. Боевой бот.** Создать в @BotFather второго бота — боевого. Dev-бот остаётся для
`deno task dev`.

**2. Проект Supabase.** Создать проект на [supabase.com](https://supabase.com) (бесплатный план).
`<ref>` — id проекта из URL дашборда: `https://supabase.com/dashboard/project/<ref>`.

```bash
supabase login
supabase link --project-ref <ref>
supabase db push                 # применить миграции
```

**3. Секреты функции.** Скопировать шаблон и заполнить:

```bash
cp .env.prod.example .env.prod
```

| Переменная         | Откуда взять                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BOT_TOKEN`        | токен боевого бота                                                                                                                               |
| `ALLOWED_USER_IDS` | свой Telegram user id (несколько — через запятую)                                                                                                |
| `DATABASE_URL`     | Dashboard → **Connect** → **Transaction pooler** (порт **6543**), подставить пароль БД                                                           |
| `MIGRATION_DB_URL` | Dashboard → **Connect** → **Session pooler** (порт **5432**), подставить пароль БД — для миграций, в функцию не загружается                      |
| `WEBHOOK_SECRET`   | `openssl rand -hex 32`                                                                                                                           |
| `CRON_SECRET`      | `openssl rand -hex 32`                                                                                                                           |
| `BOT_INFO`         | необязательно: `curl https://api.telegram.org/bot<BOT_TOKEN>/getMe \| jq -c .result` — функция не будет вызывать getMe на каждом холодном старте |
| `FUNCTION_URL`     | `https://<ref>.supabase.co/functions/v1/bot`                                                                                                     |

Загрузить их в Supabase (значения не попадают в историю shell):

```bash
supabase secrets set --env-file .env.prod
```

**4. Деплой функции и webhook.**

```bash
deno task deploy        # supabase functions deploy bot --no-verify-jwt
deno task webhook:set   # регистрирует webhook с WEBHOOK_SECRET, берёт переменные из .env.prod
```

Проверка: `/start` боевому боту от владельца → вопрос о часовом поясе; от чужого аккаунта — тишина.
Логи функции: Dashboard → Edge Functions → bot → Logs.

**5. Бэкап (GitHub Actions).** Опубликовать репозиторий на GitHub и добавить секреты в Settings →
Secrets and variables → Actions:

| Секрет           | Значение                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `BACKUP_DB_URL`  | Dashboard → Connect → **Session pooler** (порт **5432**) — `pg_dump` не работает через transaction pooler |
| `BOT_TOKEN`      | токен боевого бота                                                                                        |
| `BACKUP_CHAT_ID` | свой Telegram user id — единственный получатель дампа                                                     |
| `FUNCTION_URL`   | `https://<ref>.supabase.co/functions/v1/bot`                                                              |
| `CRON_SECRET`    | тот же, что в `.env.prod`                                                                                 |

Затем Actions → **backup** → Run workflow: в личный чат с ботом должны прийти два файла
`gym-bot-schema-*.sql.gz` и `gym-bot-data-*.sql.gz`. Дальше workflow работает ежедневно и заодно не
даёт бесплатному проекту уйти в паузу. Один раз проверить восстановление по
[docs/runbook-restore.md](docs/runbook-restore.md).

### Обычный деплой (после изменений)

```bash
deno task check                            # должен быть зелёным
deno task db:generate --name=<что-меняем>  # только если менялась схема БД
supabase db push                           # применить новые миграции
deno task deploy                           # задеплоить функцию
```

Webhook и секреты повторно не нужны. Исключения:

- поменялся токен бота или `WEBHOOK_SECRET` → обновить `.env.prod`, затем
  `supabase secrets set --env-file .env.prod` и `deno task webhook:set`;
- поменялся другой секрет → только `supabase secrets set --env-file .env.prod`.

## Восстановление из бэкапа

[docs/runbook-restore.md](docs/runbook-restore.md).
