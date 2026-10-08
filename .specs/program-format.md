---
title: "Формат программы тренировок"
brief_sections: [4]
source: "бриф «Спецификация: Telegram-бот помощник для тренировок», rev 47"
updated: 2026-09-28
---

# Формат программы

## 4. Формат программы

Программа описывается JSON-файлом по фиксированной схеме (zod). Этот же шаблон владелец отдаёт LLM, когда генерирует новую программу, поэтому схема должна быть самодостаточной и понятной без кода. Бот валидирует файл и при ошибке отвечает списком конкретных проблем («days[2].exercises[0].repRange.min обязателен»).

**Типы упражнений (`loadType`)**

| Тип | Что такое «вес» | Пример | Разминка | Шаг веса по умолчанию |
|---|---|---|---|---|
| `barbell` | Общий вес штанги с грифом | Присед, жим, становая, тяга в наклоне | Ступени от рабочего веса (6.2) | По набору блинов из настроек |
| `weighted_bodyweight` | Допвес (0 = свой вес) | Брусья, подтягивания | Свой вес, затем ступени от допвеса (6.3) | Минимальный блин × 1 |
| `machine` | Вес, который показывает тренажёр или навешан на Смит | Икры в Смите или тренажёре | Ступени от рабочего веса или фиксированная схема | 5 lb, меняется в настройках |
| `reps_only` | Вес не пишется | Пресс | Без разминки, подходы с целевым усилием | — |
| `light_load` | Вес блина (может быть 0) | Шея | Без разминки | 2,5 lb |

**Поля упражнения:** `id`, `name`, `loadType`, `isBase` (базовое упражнение: получает перегрузочный сингл), `repRange {min, max}`, `workSets {min, max}`, `warmup` (`"tiers"` — по умолчанию, id фиксированной схемы или `null`), `stepLb` (необязательно, переопределяет шаг веса), `notes` (показываются перед упражнением), `intensityGroup` (допустимо, не используется: чередование 100/70 убрано, decisions.md 08.10), `setTargets` (для `reps_only`: подписи подходов вроде «80% от отказа»).

**Шаг веса.** Итоговый шаг для упражнения выбирается так: переопределение в `/settings` → `stepLb` в программе → значение по умолчанию для `loadType`. Если сменили тренажёр, достаточно поменять шаг в настройках, программу трогать не нужно.

**Правила уровня программы:** `rotation` (порядок дней), `intensityPairs` (допустимо, не используется), `conditionalNotes` (заметка к упражнению; показывается всегда, условие `when` не проверяется).

**Текущая программа владельца в формате шаблона**

Исходник: документ «Программа: 6 базовых упражнений, 5 дней в неделю». Разминка строится ступенями от рабочего веса (раздел 6.2), пороги ступеней в фунтах — значения по умолчанию, их можно менять.

```json
{
  "schemaVersion": 1,
  "id": "base6-5d",
  "name": "6 базовых, 5 дней",
  "units": "lb",
  "rotation": ["mon", "tue", "wed", "thu", "fri"],
  "warmupTiers": {
    "byWorkWeight": [
      {"minLb": 0,   "steps": [{"pct": 0.50, "reps": 8}, {"pct": 0.80, "reps": 3}]},
      {"minLb": 135, "steps": [{"pct": 0.45, "reps": 8}, {"pct": 0.70, "reps": 5}, {"pct": 0.85, "reps": 3}]},
      {"minLb": 225, "steps": [{"pct": 0.40, "reps": 10}, {"pct": 0.60, "reps": 8}, {"pct": 0.75, "reps": 5}, {"pct": 0.90, "reps": 3}]}
    ],
    "overloadSingle": {"pct": 1.05, "reps": 1, "onlyBase": true, "skipOnLowIntensity": true}
  },
  "addedWeightTiers": {
    "zero": {"steps": [{"assist": true, "reps": 12}], "afterWork": {"bodyweight": true, "reps": "max"}},
    "byAddedWeight": [
      {"minLb": 1,  "steps": [{"pct": 0, "reps": 8}, {"pct": 0.80, "reps": 4}],
       "afterWork": {"bodyweight": true, "reps": "max"}},
      {"minLb": 25, "steps": [{"pct": 0, "reps": 10}, {"pct": 0.50, "reps": 5}, {"pct": 0.85, "reps": 3}]},
      {"minLb": 60, "steps": [{"pct": 0, "reps": 10}, {"pct": 0.40, "reps": 6}, {"pct": 0.75, "reps": 4}]}
    ],
    "overloadSingle": {"pct": 1.10, "reps": 1, "minAddedLb": 25}
  },
  "fixedSchemes": {
    "calves": {"steps": [{"pct": 0.5, "reps": 10}, {"pct": 0.8, "reps": 10}]}
  },
  "intensityPairs": [
    {"id": "sq_dl", "exercises": ["front_squat", "deadlift"], "lowPct": 0.7, "mode": "alternate_weekly"}
  ],
  "days": [
    {"id": "mon", "name": "Фронтальный присед", "exercises": [
      {"id": "front_squat", "name": "Фронтальный присед", "loadType": "barbell", "isBase": true,
       "repRange": {"min": 6, "max": 8}, "workSets": {"min": 1, "max": 1},
       "warmup": "tiers", "intensityGroup": "sq_dl"},
      {"id": "calves", "name": "Икры стоя", "loadType": "machine",
       "repRange": {"min": 10, "max": 12}, "workSets": {"min": 2, "max": 3},
       "warmup": "calves", "notes": "Смит или тренажёр, именно стоя"}
    ]},
    {"id": "tue", "name": "Жим на наклонной", "exercises": [
      {"id": "incline_press", "name": "Жим на наклонной", "loadType": "barbell", "isBase": true,
       "repRange": {"min": 6, "max": 8}, "workSets": {"min": 1, "max": 1},
       "warmup": "tiers"},
      {"id": "abs", "name": "Пресс", "loadType": "reps_only", "workSets": {"min": 3, "max": 3},
       "setTargets": ["80% от отказа", "90% от отказа", "в отказ"],
       "notes": "Сразу после жима"},
      {"id": "neck_flex", "name": "Шея: сгибания", "loadType": "light_load",
       "repRange": {"min": 12, "max": 20}, "workSets": {"min": 2, "max": 2}, "warmup": null,
       "notes": "Без отказа, медленно. Головокружение или онемение — стоп"},
      {"id": "neck_ext", "name": "Шея: разгибания", "loadType": "light_load",
       "repRange": {"min": 12, "max": 20}, "workSets": {"min": 2, "max": 2}, "warmup": null}
    ]},
    {"id": "wed", "name": "Мёртвая тяга", "exercises": [
      {"id": "deadlift", "name": "Мёртвая тяга", "loadType": "barbell", "isBase": true,
       "repRange": {"min": 6, "max": 8}, "workSets": {"min": 1, "max": 1},
       "warmup": "tiers", "intensityGroup": "sq_dl"}
    ]},
    {"id": "thu", "name": "Брусья", "exercises": [
      {"id": "dips", "name": "Брусья узким хватом", "loadType": "weighted_bodyweight", "isBase": true,
       "repRange": {"min": 6, "max": 8}, "workSets": {"min": 1, "max": 1},
       "warmup": "tiers", "notes": "Локти 45° назад, корпус вертикально"},
      {"id": "calves", "ref": true},
      {"id": "neck_flex", "ref": true},
      {"id": "neck_ext", "ref": true}
    ]},
    {"id": "fri", "name": "Подтягивания + тяга", "exercises": [
      {"id": "pullups", "name": "Подтягивания", "loadType": "weighted_bodyweight", "isBase": true,
       "repRange": {"min": 6, "max": 8}, "workSets": {"min": 1, "max": 1},
       "warmup": "tiers"},
      {"id": "abs", "ref": true},
      {"id": "bb_row", "name": "Тяга штанги в наклоне", "loadType": "barbell", "isBase": true,
       "repRange": {"min": 6, "max": 8}, "workSets": {"min": 1, "max": 1},
       "warmup": "tiers"}
    ]}
  ],
  "conditionalNotes": [
    {"exercise": "bb_row", "when": {"exercise": "deadlift", "intensityThisWeek": "high"},
     "text": "Становая на этой неделе шла на 100%: тягу держи умеренной или замени на тягу гантелей лёжа на наклонной 30°"}
  ]
}
```

`"ref": true` означает повтор упражнения, уже описанного в другом дне: история у него общая. Логика ссылок — через одинаковый `id`: история упражнения привязана к `exerciseId`, а не к дню.

**Загрузка стартовых весов.** После загрузки программы бот проходит по упражнениям с `loadType` ≠ `reps_only` и спрашивает последний рабочий результат (вес × повторения + необязательный комментарий) с кнопкой «Нет данных». Эти записи сохраняются как `source: "manual_import"` и не считаются тренировками.
