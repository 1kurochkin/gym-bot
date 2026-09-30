# Status — обновлено 2026-09-30

## Текущий этап
Этап 0. Каркас (.specs/roadmap.md)

## Чеклист этапа
- [x] Харнесс: CLAUDE.md, .specs/ + индекс, docs/ (architecture, harness, runbook'и), ADR 0000–0006, STATUS.md, хуки
- [x] deno.json (tasks, import map), каркас src/ по слоям, tests/architecture.test.ts
- [x] Supabase: config.toml (verify_jwt = false), функция bot, миграция settings + session (RLS)
- [x] grammY, Drizzle, postgres, drizzle-kit работают под Deno 2.9
- [x] Whitelist, секрет webhook, /health с секретом, идемпотентность update_id, устаревшие кнопки
- [x] Онбординг часового пояса: текущее время → кнопки зон с этим смещением, или геопозиция (tz-lookup)
- [x] GitHub Actions: ci.yml, backup.yml
- [x] Фикстуры разминки tests/fixtures/warmup-cases.json
- [x] Прогон на локальном Supabase (`supabase functions serve`): миграция, /health, секрет webhook, whitelist, геопозиция → зона в БД, повтор update_id
- [x] Живой диалог с dev-ботом (`deno task dev`): онбординг по геопозиции работает
- [ ] Деплой владельцем по README.md → Деплой: /start отвечает только владельцу
- [ ] Первый бэкап и проверка восстановления по docs/runbook-restore.md

## Последние решения
- 2026-09-28: устаревшая кнопка — убираем клавиатуру у старого сообщения (answerCallbackQuery уже отправлен до БД, всплывающую подсказку показать нельзя)
- 2026-09-28: часовой пояс — по текущему времени пользователя или геопозиции, ввод города убран (Telegram зону не передаёт)
- 2026-09-28: BOT_INFO (необязательно) — без getMe на холодном старте
- 2026-09-28: бэкап — два файла (schema, data) одним sendMediaGroup
- 2026-09-29: типы данных выводятся из zod-схем, перечисления — z.enum; строки БД, callback_data и конфиг проверяются теми же схемами; shared/brand.ts удалён (docs/architecture.md §13.5)

- 2026-09-30: документы без ссылок на функции и файлы глубже слоя; ADR и спеки — без путей в код; пути в .md проверяет tests/docs.test.ts (docs/harness.md §12.1)

## Следующий шаг
Закрыть этап 0: деплой по README.md → Деплой и первый бэкап. Затем этап 1: zod-схема программы и buildWarmup() по tests/fixtures/warmup-cases.json.

## Известные проблемы / вопросы к владельцу
- Нужны: dev- и боевой бот, проект Supabase, секреты (README.md → Деплой)
- Импорт src/ вне supabase/functions/ работает в `functions serve`; в `functions deploy` проверить при первом деплое.
- Edge runtime локально — supabase-edge-runtime 1.76 (совместим с Deno 2.1.4), а тулчейн — Deno 2.9: новые API Deno использовать осторожно, проверять через `supabase functions serve`.
- Если отправка ответа в Telegram упала после записи в БД, webhook вернёт 500, а ретрай Telegram будет проигнорирован по update_id: ответ пользователю потеряется, данные — нет.
