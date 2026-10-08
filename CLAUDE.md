# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Gym Coach Bot

Личный Telegram-бот для зала: хранит программу тренировок, считает разминку
от рабочего веса, логирует каждый подход, выгружает всё в .xlsx для анализа.
Веса в фунтах (lb). Supabase Edge Functions (Deno) + Postgres.

## Начни отсюда
1. STATUS.md — текущий этап и следующий шаг.
2. .specs/README.md — индекс спецификаций (что делает бот); читай только нужный файл.
3. docs/README.md — индекс документации (как устроен код): architecture.md, harness.md, adr/.

Ссылки «раздел N» в файлах — номера исходного брифа; карта «раздел → файл» в .specs/README.md.

## Архитектура (подробно: docs/architecture.md)
Functional core, imperative shell. Диалог — чистый конечный автомат: (состояние, событие, контекст) → (новое состояние, эффекты).
- src/core/      — чистая логика и автомат диалога. Без I/O и без чтения текущего времени.
- src/features/  — срезы по фичам: апдейт → событие, данные экрана → текст и кнопки.
- src/ports/     — интерфейсы внешнего мира.
- src/adapters/  — реализации портов (Postgres, Telegram, …).
- src/app/       — composition root и HTTP-роутинг; единственное место, где встречаются адаптеры.
- supabase/      — конфиг, миграции, тонкая точка входа Edge Function.
- tests/fixtures/ — контрольные примеры из .specs/ как данные (только синтетические).
Правило зависимостей: shared ← core ← features ← app; adapters → ports. Проверяется architecture test в deno task check.
Конкретные модули и функции ищи поиском по коду, а не в документации.

## Команды
- deno task dev    — локальный Supabase + бот в long polling
- deno task check  — fmt + lint + typecheck + tests + architecture test (должен быть зелёным)
- deno test <file> --filter "<название>" — один тест
- deno task deploy — деплой функции (supabase functions deploy bot --no-verify-jwt)
- deno task webhook:set — зарегистрировать webhook с секретом (переменные из .env.prod)
- deno task db:generate --name=<имя> — SQL-миграция из src/adapters/postgres/schema.ts; применить: supabase db push
- Деплой в прод — скилл /deploy (.claude/skills/deploy/); вручную — README.md → Деплой. Восстановление: docs/runbook-restore.md
- .env.prod читать нельзя: только через .claude/skills/deploy/prod.sh (печатает имена, не значения)
- Хуки (.claude/): после правки .ts — deno check + lint файла; на Stop — deno task check

## Правила
- Спека — источник истины. Меняешь поведение → сначала .specs/, потом код, в одном коммите.
- Архитектурное решение (дорогое для отката, новая зависимость, смена слоя, схемы БД или внешнего сервиса) → ADR по docs/adr/0000-template.md со статусом proposed и на ревью владельцу. Реализацию не начинать, пока владелец не подтвердит; после «да» — статус accepted.
- Комментариев в коде не писать (ни `//`, ни `/** */`): смысл — в именах, типах, тестах и спеке.
- Документация без ссылок на функции и файлы глубже слоя (правило — docs/harness.md → «Что писать в документах»). Пути в .md проверяет тест ссылок.
- Пример в спеке без фикстуры в tests/fixtures/ = баг.
- Типы данных — только из zod-схем (type X = z.infer<typeof XSchema>), перечисления — z.enum и их .enum/.options, без строковых литералов. Рукописные TS-типы — только для портов-функций и Result.
- Ядро без классов и исключений: discriminated union, Result<T, E>, .readonly(). Никаких any и as в core/.
- Все веса — branded Lb (LbSchema.brand); время только через Clock; в БД UTC + local_date пользователя.
- LLM никогда не пишет в БД напрямую.
- Репозиторий публичный: никаких секретов, дампов и реальных данных.
- Новые зависимости только через npm: в deno.json и только если работают в Deno.

## Процесс
Ветка от свежего main → PR только в main (не поверх другой ветки) → мержит владелец → /deploy. Подробно — docs/harness.md §12.0.
Данные в проде не удалять самому: дать владельцу SQL и проверить результат.

## Definition of Done
- deno task check зелёный.
- Спека и фикстуры обновлены, если менялось поведение.
- STATUS.md обновлён: что сделано, следующий шаг.
