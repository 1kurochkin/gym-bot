---
title: "Технический гайд: стек, инфраструктура, архитектура кода"
brief_sections: [3, 13]
source: "бриф «Спецификация: Telegram-бот помощник для тренировок», rev 47"
updated: 2026-09-28
---

# Архитектура

## 3. Стек и архитектура

**Решение (28.09, ADR-0001 accepted):** Supabase — Edge Functions + Postgres, бесплатный план.

| Слой | Выбор | Комментарий |
|---|---|---|
| Язык | TypeScript | Edge Functions работают на Deno, тулчейн тоже Deno (`deno test`, `deno lint`, `deno fmt`), npm-пакеты через `npm:`. Архитектура кода — раздел 13 |
| Бот-фреймворк | grammY | Официально поддерживает Deno и Supabase Edge Functions: `webhookCallback(bot, "std/http")` |
| Хостинг | Одна Supabase Edge Function `bot` = webhook для всех команд | Бесплатно до 500 000 вызовов в месяц — это на порядки больше, чем нужно |
| БД | Supabase Postgres + Drizzle ORM (`npm:drizzle-orm`, `npm:postgres`) | Подключение через пулер Supavisor в режиме transaction (порт 6543, `prepare: false`) |
| Миграции | `supabase/migrations/*.sql` (генерируются из схемы Drizzle) | Применяются `supabase db push` |
| Экспорт | Библиотека `.xlsx`, работающая в Deno (exceljs или SheetJS через `npm:`), проверить на этапе 4 | Файл собирается в памяти и отправляется документом |
| Валидация | zod (+ генерация JSON Schema для LLM) |  |
| LLM (фаза 2) | DeepSeek через OpenAI-совместимый SDK | Провайдер меняется переменной окружения |
| Планировщик | GitHub Actions `schedule` | Ежедневный бэкап БД (он же защита от засыпания) |
| Расчёт разминки | Чистая функция в TS, без LLM | Детерминированно, покрыто тестами |

**Особенности Supabase, которые нужно учесть в реализации**

1. **Проверка JWT.** По умолчанию Edge Function требует JWT Supabase, а Telegram его не присылает. Функцию `bot` нужно деплоить с `--no-verify-jwt` (или `verify_jwt = false` в `supabase/config.toml`). Защиту обеспечивает проверка заголовка `X-Telegram-Bot-Api-Secret-Token` и whitelist пользователя (раздел 9).
2. **Засыпание проекта.** Бесплатный проект ставится на паузу после 7 дней без активности в БД; проект потом надо будить в дашборде. Защита: ежедневный бэкап (п. 3) сам подключается к БД, а для надёжности тот же workflow вызывает эндпоинт `/health`, который делает лёгкий запрос в БД. Внутренний `pg_cron` для этого не использовать: нет гарантии, что он считается внешней активностью.
3. **Нет автоматических бэкапов на бесплатном плане.** Решение — свой бэкап в два слоя:
    - **Ежедневный дамп БД в Telegram.** GitHub Actions `backup.yml` раз в сутки делает `supabase db dump` (схема и данные отдельно, строка подключения — в GitHub Secrets), сжимает в `.sql.gz` и отправляет файлом через Bot API (`sendDocument`) в личный чат владельца с ботом. Получатель задаётся отдельным секретом `BACKUP_CHAT_ID` (только администратор) и не зависит от списка пользователей `ALLOWED_USER_IDS`: дамп содержит данные всех пользователей, поэтому другим пользователям он не отправляется никогда. Файл видит только владелец, Telegram хранит его бессрочно. Данных мало, дамп будет весить килобайты (лимит Bot API — 50 МБ). Репозиторий публичный, поэтому дамп **никогда** не коммитится и не сохраняется как артефакт workflow: артефакты публичного репозитория может скачать любой пользователь GitHub. Если понадобится вторая копия — только зашифрованная (`age`, в репозитории лежит лишь публичный ключ, приватный — у владельца).
    - **Миграции в git.** Схема восстанавливается из `supabase/migrations/`, даже если дамп схемы потерян.

    **Восстановление** описано в `docs/runbook-restore.md`: создать проект (или `supabase start` локально), применить миграции, залить данные `psql < data.sql`. Проверить процедуру один раз на этапе 0 и затем раз в квартал: бэкап, который ни разу не восстанавливали, бэкапом не считается.
4. **Лимиты функции.** Время выполнения на бесплатном плане ограничено (порядка 150 с на запрос), для бота и экспорта с запасом. Потребление CPU при экспорте всё равно замерить на этапе 4.
5. **Холодный старт.** У Edge Functions он небольшой, но есть. Держать бандл лёгким: не тянуть тяжёлые зависимости в путь обработки кнопок, импортировать модули экспорта и LLM динамически (`await import(...)`) только когда они нужны.

**Как бот ощущается быстрым**

- `answerCallbackQuery` сразу после нажатия кнопки, до записи в БД: убирает «часики».
- Редактировать текущее сообщение (`editMessageText`), а не присылать новое.
- Одна транзакция на шаг, без лишних чтений: сессия и данные текущего упражнения загружаются одним запросом.
- Разминка считается локально, без обращения к БД.

Хранилище спрятано за интерфейсами репозиториев (`ProgramRepo`, `WorkoutRepo`, `SettingsRepo`), чтобы смена провайдера затрагивала один модуль. Отвергнутые альтернативы (Cloudflare Workers + D1, Firebase, VPS) описаны в ADR-0001.

**Схема работы**

```
Telegram ──webhook──▶ Edge Function "bot" (grammY, Deno)
                         │
                         ├── core/     (warmup, units, schedule, session: чистые функции)
                         ├── adapters/postgres (Drizzle + Supavisor)
                         ├── adapters/xlsx     (по команде /export, динамический импорт)
                         └── adapters/deepseek (фаза 2, динамический импорт)

GitHub Actions (cron, ежедневно) ──▶ db dump → .sql.gz в личный чат Telegram, затем /health
```

**Состояние диалога.** Функция stateless, поэтому текущий шаг (активная тренировка, текущее упражнение, что ждём на вводе) хранится в таблице `session`, а не в памяти.

**Структура репозитория**

```
supabase/
  config.toml           verify_jwt = false для функции bot
  migrations/           SQL-миграции
  functions/bot/index.ts  точка входа: роутинг /webhook, /health
src/                    код приложения — структура в разделе 13.4
.github/workflows/
  ci.yml                deno task check на каждый push
  backup.yml            ежедневно: db dump → Telegram, /health
docs/
  runbook-restore.md    как восстановить БД из дампа
```

## 13. Архитектура кода

**Решение (28.09, ADR-0006):** функциональное ядро и императивная оболочка, диалог как явный конечный автомат, структура по фичам поверх доменного ядра, тулчейн Deno.

### 13.1. Functional core, imperative shell

Почти вся ценность бота в чистой логике: разминка, округление под блины, ротация дней, чередование 100/70, переходы диалога. Ввод-вывод (Telegram, Postgres, LLM) тонкий. Поэтому:

- **Ядро (`src/core/`)** — чистые функции над обычными данными: без I/O, без `Date.now()`, без импорта фич и адаптеров. Тестируется без моков.
- **Оболочка (`features/`, `adapters/`, `app/`)** — принимает апдейт, загружает состояние, вызывает ядро, применяет эффекты (запись в БД, ответ в Telegram).

**Не ООП.** Функция stateless и живёт один запрос, долгоживущих объектов с поведением нет. Иерархии классов упражнений не будет. Вариативность выражается через discriminated union по `loadType` и таблицу стратегий:

```ts
type Exercise =
  | { loadType: 'barbell'; ... }
  | { loadType: 'weighted_bodyweight'; ... }
  | { loadType: 'machine'; ... }
  | { loadType: 'reps_only'; ... }
  | { loadType: 'light_load'; ... };

const warmupBuilders: { [K in LoadType]: WarmupBuilder<K> } = {
  barbell: buildBarbellWarmup,
  weighted_bodyweight: buildAddedWeightWarmup,
  machine: buildMachineWarmup,
  reps_only: () => [],
  light_load: () => [],
};
```

Новый тип упражнения — новая ветка union и одна функция; компилятор покажет все места, где его забыли обработать (исчерпывающий `switch` с `assertNever`).

**Объекты — только в адаптерах**, и то как фабрики-замыкания, а не классы: `createWorkoutRepo(db): WorkoutRepo`. Зависимости передаются явно через composition root (`app/buildDeps(env)`), без DI-контейнеров и декораторов. Классы допустимы только там, где их требует библиотека.

### 13.2. Диалог как конечный автомат

Самая сложная часть бота — диалог тренировки (день → вес → разминка → подходы → комментарий → следующее упражнение, плюс отмена, возобновление, пропуск, замена). Вся его логика — одна чистая функция в `core/session/`:

```ts
type Step = (state: Session, event: BotEvent, ctx: StepContext)
  => { state: Session; effects: Effect[] };

type BotEvent =
  | { type: 'day_chosen'; dayId: string }
  | { type: 'weight_chosen'; weightLb: Lb }
  | { type: 'warmup_confirmed'; variant: WarmupVariant }
  | { type: 'reps_entered'; reps: number }
  | { type: 'comment_entered'; text: string }
  | ...;

type Effect =
  | { type: 'save_set'; set: NewSet }
  | { type: 'save_exercise_log'; log: ExerciseLogPatch }
  | { type: 'finish_workout'; ... }
  | { type: 'render'; view: View };
```

`StepContext` содержит уже загруженные данные (программа, история упражнения, настройки, текущее время из `Clock`), поэтому `step` ничего не читает сам.

**Цикл обработки апдейта в оболочке:**

1. Middleware: whitelist, проверка `update_id` (идемпотентность), `answerCallbackQuery`.
2. Хендлер фичи декодирует нажатие или текст в `BotEvent`.
3. Загрузка `Session` и `StepContext` одним запросом.
4. `step(state, event, ctx)`.
5. Одна транзакция: применить эффекты записи и сохранить новый `Session`.
6. Отрисовать `render`-эффект (`editMessageText` или новое сообщение).

Что это даёт: возобновление тренировки бесплатно (состояние всегда в БД); сценарии приёмки тестируются как последовательность событий без Telegram; новая ветка диалога — новый `case`, а не новый хендлер с дублированной логикой.

Не используются: плагин conversations из grammY (в serverless переигрывает историю, сложно отлаживать) и XState (лишний вес и абстракция для автомата из десятка состояний). Достаточно union-типов и `switch`.

### 13.3. Отображение и кнопки

- **Views — чистые функции:** `renderWarmup(vm) → { text, keyboard }`. Все тексты сообщений живут в `features/*/views.ts`, а не разбросаны по хендлерам.
- **Кодек `callback_data`.** В Telegram лимит 64 байта на кнопку, поэтому JSON в кнопки не кладётся. Типизированный кодек в `adapters/telegram/callback.ts`: короткие префиксы (`w:195`, `r:7`, `wu:full`) плюс номер шага сессии. Нажатие на кнопку от устаревшего шага игнорируется с подсказкой «кнопка устарела».

### 13.4. Структура файлов

```
supabase/
  config.toml               verify_jwt = false для функции bot
  migrations/               SQL-миграции
  functions/bot/index.ts    тонкая точка входа: Deno.serve(app)

src/
  core/                     чистое ядро: импортирует только shared/ и zod
    units/                  Lb (branded), plates, rounding
    warmup/                 tiers, addedWeight, buildWarmup
    program/                zod-схема, типы, разрешение ref-упражнений
    schedule/               ротация дней, чередование 100/70, ISO-недели, часовые пояса
    session/                автомат диалога: state, events, effects, step()
  features/                 вертикальные срезы: то, что видит пользователь
    workout/                handlers.ts (апдейт → event), views.ts, index.ts
    program-upload/
    seed/
    export/
    settings/
  ports/                    интерфейсы: WorkoutRepo, ProgramRepo, SettingsRepo, Clock, Llm, Notifier
  adapters/
    postgres/               схема Drizzle, реализации репозиториев
    telegram/               настройка grammY, middleware, кодек callback_data
    deepseek/
    xlsx/
  app/                      composition root: buildDeps(env), роутинг /webhook и /health
  shared/                   Result<T, E>, ошибки, id, логгер

tests/
  core/ features/ ...       повторяет src/
  fixtures/                 контрольные примеры из спецификации (синтетические)
  architecture.test.ts      проверка правила зависимостей

deno.json                   tasks, import map, lint/fmt-настройки
.github/workflows/          ci.yml, backup.yml
docs/                       adr/, runbook-restore.md
.specs/  CLAUDE.md  STATUS.md
```

**Правило зависимостей:**

```
shared ← core ← features ← app
          ↑        ↑
        ports ← adapters
```

`core` не импортирует `features`, `adapters`, `app` и `ports`; `features` зависят от `core` и `ports`, но не от `adapters`; конкретные адаптеры подключаются только в `app/`. Правило проверяет `tests/architecture.test.ts`: тест проходит по импортам файлов и падает при нарушении. Он входит в `deno task check`, поэтому агент не сможет незаметно протащить запрос к БД в расчёт разминки.

**Почему это масштабируется:** новая фича — новая папка в `features/`, ядро не трогается; второй интерфейс (например, веб-дашборд) переиспользует `core` и `ports` целиком; смена БД затрагивает одну папку в `adapters/`.

### 13.5. Соглашения

- **Типы данных — из zod-схем.** Каждый тип данных объявляется схемой `XSchema` и выводится: `type X = z.infer<typeof XSchema>`. Рукописные `type`/`interface` для данных не пишем. Union — `z.discriminatedUnion`, неизменяемость — `.readonly()`. Схема заодно проверяет данные на границах: строки БД (`adapters/postgres`), `callback_data`, конфиг.
- **Перечисления — `z.enum`.** Значения берутся из схемы (`SessionStepSchema.enum.idle`, `.options`), а не повторяются строковыми литералами. Подмножество — `.extract([...])`, расширение — `z.enum([...Base.options, 'new'])`.
- **Исключения из правила** — обычные TS-типы: порты с поведением (`Store`, `Ui`, `Clock`, `ZoneLocator`), зависимости (`UpdateDeps`, `Deps`) и дженерик `Result<T, E>`. Схема функции ничего не проверяет.
- **Ошибки.** Ядро не бросает исключения, а возвращает `Result<T, E>` с типизированной причиной из `z.enum` (`TimeInputErrorSchema`, …). Исключения — только в оболочке, для настоящих сбоев (БД недоступна).
- **Единицы.** Branded-тип через zod: `LbSchema = z.number().nonnegative().brand<'lb'>()`. Нельзя случайно передать килограммы или повторения туда, где ждут фунты. Значение получается только через схему (`lb()`, `LbSchema.safeParse`), без приведения типов.
- **Время** только через порт `Clock`: тесты смены недели и перехода на зимнее время детерминированы.
- **Данные неизменяемы:** `.readonly()` в схемах, никаких мутаций входных аргументов.
- **Никаких `any` и `as`** в `core/` (проверяет `tests/architecture.test.ts`), `strict` в `deno.json`.
- **Имена файлов** — kebab-case, один модуль — одна ответственность; `index.ts` только реэкспортирует публичный API папки.

### 13.6. Тулчейн: Deno везде

Edge Functions работают на Deno, поэтому и разработка, и тесты тоже на Deno: один рантайм, нет класса ошибок «в тестах работает, в функции нет».

| Задача | Команда |
|---|---|
| Локальный запуск | `deno task dev` — локальный Supabase + бот в режиме long polling |
| Проверка | `deno task check` = `deno fmt --check` + `deno lint` + `deno check` + `deno test` (включая architecture test) |
| Деплой | `deno task deploy` → `supabase functions deploy bot --no-verify-jwt` |
| Миграции | `deno task db:generate` (drizzle-kit через `npm:`), `supabase db push` |

npm-пакеты (grammY, Drizzle, zod, xlsx-библиотека) подключаются через `npm:` в import map `deno.json`. На этапе 0 проверить, что drizzle-kit и выбранная xlsx-библиотека работают под Deno; если нет — зафиксировать замену в ADR.
