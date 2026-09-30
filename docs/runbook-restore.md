---
title: "Восстановление БД из дампа"
updated: 2026-09-30
---

# Восстановление БД из дампа

Бэкап — два файла в личном чате с ботом (workflow `backup.yml`, ежедневно):
`gym-bot-schema-YYYY-MM-DD.sql.gz` и `gym-bot-data-YYYY-MM-DD.sql.gz`. Схема также лежит в `supabase/migrations/`.

Проверять процедуру раз в квартал: бэкап, который ни разу не восстанавливали, бэкапом не считается.
Дату последней проверки записывать в конец этого файла.

## Шаги

> **Восстанавливать только в базу Supabase** — локальную (`supabase start`) или проект.
> В голый Postgres дамп не ляжет: данные содержат служебную строку для схемы `auth`,
> а схема из дампа ссылается на схему `extensions` — обе есть только в Supabase.
>
> `psql` на хосте не нужен: для локальной БД команды выполняются внутри контейнера
> (`docker exec -i supabase_db_gym-bot psql -U postgres`). Для проекта — `brew install libpq`
> и `psql` из него.

1. Скачать из Telegram свежий `gym-bot-data-*.sql.gz` (и `schema`, если миграции недоступны).
2. Поднять пустую БД:
   - локально: `supabase start` (Postgres на `127.0.0.1:54322`);
   - или новый проект Supabase: `supabase link --project-ref <ref>`.
3. Применить схему из миграций:
   - локально: `supabase db reset` (применит `supabase/migrations/`);
   - в проекте: `supabase db push`.

   Если миграции потеряны — `gunzip -c gym-bot-schema-*.sql.gz | psql "$DB_URL"`.
4. Залить данные:
   ```bash
   # локально
   gunzip -c gym-bot-data-YYYY-MM-DD.sql.gz | docker exec -i supabase_db_gym-bot psql -U postgres
   # в проект (DB_URL — Session pooler, порт 5432)
   gunzip -c gym-bot-data-YYYY-MM-DD.sql.gz | psql "$DB_URL"
   ```
5. Проверить, что данные на месте:
   ```bash
   docker exec -i supabase_db_gym-bot psql -U postgres -c 'select count(*) from settings; select count(*) from session;'
   ```
6. Если проект новый — обновить секреты и webhook по [README → Деплой](../README.md#деплой).

## Журнал проверок

| Дата | Кто | Результат |
|---|---|---|
| 2026-09-30 | Claude Code + владелец | Бэкап от 2026-09-30 восстановлен во временную базу локального Postgres: миграции + данные → `settings` 1 (зона совпала), `session` 1, RLS на месте. Ограничение: на голом Postgres падает служебный `setval` схемы `auth` и схема из дампа (нужна `extensions`) — поэтому целевая база только Supabase |
