---
title: "Модель данных"
brief_sections: [7]
source: "бриф «Спецификация: Telegram-бот помощник для тренировок», rev 47"
updated: 2026-10-01
---

# Модель данных

## 7. Модель данных

Реляционная модель в Supabase Postgres: схема описана в Drizzle, SQL-миграции лежат в `supabase/migrations/`. JSON-поля (`definition`, `exerciseOverrides`, `context`) — колонки `jsonb`. На всех таблицах включён RLS без политик: доступ только у функции через серверное подключение, публичный API Supabase данные не отдаёт. Во всех таблицах есть `user_id` (Telegram user id). Веса хранятся в lb, время — `timestamptz`.

### Часовой пояс

- Telegram не передаёт часовой пояс пользователя, поэтому при первом `/start` бот определяет его сам. Пользователь делает одно из двух:
    - **Пишет текущее время** («18:40», «6:40 pm»). Бот вычисляет смещение от UTC (округление до 15 мин) и показывает кнопками 2–4 зоны, у которых сейчас такое смещение. Первыми идут зоны, подходящие по `language_code` пользователя; последней — фиксированное смещение без перехода на летнее время (`Etc/GMT+4` = `UTC−4`). Если подходящая зона одна, она сохраняется сразу.
    - **Отправляет геопозицию** кнопкой «📍 Отправить геопозицию» (только мобильный Telegram). Зона определяется по координатам офлайн (`@photostructure/tz-lookup`), координаты не сохраняются.
- Для опытных пользователей работает и ввод IANA-имени (`Europe/Moscow`). Ввода города нет: его пишут с ошибками.
- Показывается в формате `UTC−4 · New York`.
- Внутри хранится IANA-зона (`America/New_York`), а не фиксированное смещение: в Нью-Йорке летом UTC−4, зимой UTC−5, и фиксированное «UTC−4» зимой давало бы неверные даты. Смещение в интерфейсе вычисляется на текущий момент.
- Каждая тренировка сохраняет `local_date`, `iso_week` и `utc_offset_min` на момент начала. После переезда и смены зоны в `/settings` история не пересчитывается и остаётся корректной.

### Таблицы

**`settings`** (одна строка на пользователя)

```ts
{ userId, timezone: 'America/New_York', barWeightLb: 45,
  platesLb: [5, 10, 25, 35, 45],        // после покупки: [2.5, 5, 10, 25, 35, 45]
  exerciseOverrides: { [exerciseId]: { stepLb?: number } },  // JSON-колонка
  language: 'ru' | 'en' | null,         // null — по языку Telegram (product.md → «Язык интерфейса»)
  activeProgramId }
```

**`programs`**

```ts
{ id, userId, programKey, version, name, definition: ProgramJson /* JSON */,
  status: 'active' | 'archived', createdAt, archivedAt? }
```

Определение программы хранится целиком (снапшот). Повторная загрузка с тем же `programKey` и изменённым содержимым создаёт новую `version`, тренировки ссылаются на конкретную версию.

**`workouts`**

```ts
{ id, userId, programId, dayId, dayName,
  status: 'in_progress' | 'completed' | 'aborted',
  startedAt, finishedAt?, localDate, isoWeek, utcOffsetMin, comment? }
```

**`exercise_logs`**

```ts
{ id, workoutId?, programId, exerciseId, exerciseName, order,
  status: 'done' | 'skipped' | 'substituted', substitutedFor?,
  intensity?: 'high' | 'low',
  plannedWorkWeightLb?, stepLbUsed,
  warmupTier?: number, warmupVariant: 'full' | 'short' | 'custom' | 'none',
  warmupComment?, comment?,
  source: 'workout' | 'manual_import' | 'llm_import', localDate }
```

`workoutId` пуст у записей не из тренировки (`source: manual_import`, `llm_import`): у стартовых результатов тренировки нет. У их подходов `workoutId` тоже пуст.

`stepLbUsed` и `warmupTier` сохраняются, чтобы при анализе было видно, по какому шагу и какой ступени шла тренировка (шаг может меняться при смене тренажёра или покупке блинов).

**`sets`**

```ts
{ id, exerciseLogId, workoutId?, programId, exerciseId,
  kind: 'warmup' | 'work' | 'extra', index,
  plannedWeightLb?, plannedReps?,
  weightLb: number | null,   // null для reps_only; для weighted_bodyweight — допвес
  reps, skipped: boolean, createdAt }
```

**`session`** (одна строка, состояние диалога)

```ts
{ userId, activeWorkoutId?, currentExerciseLogId?,
  step: 'idle' | 'onboarding_tz' | 'choose_day' | 'choose_weight' | 'warmup'
      | 'work_reps' | 'comment' | 'seed' | …,
  context: JSON, updatedAt, lastUpdateId }
```

**Индексы**

- `workouts (user_id, started_at desc)` — последняя тренировка.
- `exercise_logs (exercise_id, status, intensity, local_date desc)` — прошлый результат упражнения.
- `sets (program_id)` и `sets (exercise_log_id)` — экспорт и карточка упражнения.
