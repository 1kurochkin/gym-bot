---
title: "Восстановление БД из дампа"
updated: 2026-09-28
---

# Восстановление БД из дампа

Бэкап — два файла в личном чате с ботом (workflow `backup.yml`, ежедневно):
`gym-bot-schema-YYYY-MM-DD.sql.gz` и `gym-bot-data-YYYY-MM-DD.sql.gz`. Схема также лежит в `supabase/migrations/`.

Проверять процедуру раз в квартал: бэкап, который ни разу не восстанавливали, бэкапом не считается.
Дату последней проверки записывать в конец этого файла.

## Шаги

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
   gunzip -c gym-bot-data-YYYY-MM-DD.sql.gz | psql "$DB_URL"
   ```
   Для локальной БД `DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
5. Проверить: `psql "$DB_URL" -c 'select count(*) from settings; select count(*) from session;'`.
6. Если проект новый — обновить секреты и webhook по [README → Деплой](../README.md#деплой).

## Журнал проверок

| Дата | Кто | Результат |
|---|---|---|
