#!/usr/bin/env bash
# Работа с .env.prod для скилла /deploy. Значения секретов НИКОГДА не печатаются:
# наружу выходят только имена переменных, статусы и коды ответа.
#
#   prod.sh check              — какие обязательные переменные пусты (имена)
#   prod.sh fill               — сгенерировать WEBHOOK_SECRET, CRON_SECRET, BOT_INFO, если пусты
#   prod.sh set-ref <ref>      — записать FUNCTION_URL для проекта
#   prod.sh ref                — project ref из FUNCTION_URL
#   prod.sh secrets            — загрузить секреты функции в Supabase
#   prod.sh db-push            — применить миграции (MIGRATION_DB_URL, session pooler)
#   prod.sh webhook-status     — совпадает ли webhook с FUNCTION_URL, ошибки доставки
#   prod.sh health             — HTTP-код /health с CRON_SECRET
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
ENV_FILE=.env.prod

# Секреты функции; остальное (MIGRATION_DB_URL, FUNCTION_URL) в функцию не загружается.
FUNCTION_KEYS=(BOT_TOKEN ALLOWED_USER_IDS DATABASE_URL WEBHOOK_SECRET CRON_SECRET BOT_INFO)
REQUIRED=(BOT_TOKEN ALLOWED_USER_IDS DATABASE_URL MIGRATION_DB_URL WEBHOOK_SECRET CRON_SECRET FUNCTION_URL)

get() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

set_var() {
  local tmp
  tmp=$(mktemp)
  chmod 600 "$tmp"
  K="$1" V="$2" awk 'BEGIN{k=ENVIRON["K"]; v=ENVIRON["V"]; done=0}
    index($0, k"=")==1 {print k"="v; done=1; next} {print}
    END{if(!done) print k"="v}' "$ENV_FILE" >"$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

mask() { sed -E 's#postgres(ql)?://[^[:space:]]+#<db-url>#g; s#bot[0-9]+:[A-Za-z0-9_-]+#bot<token>#g'; }

ref() {
  local url
  url=$(get FUNCTION_URL)
  [[ $url =~ ^https://([a-z0-9]+)\.supabase\.co/functions/v1/bot/?$ ]] || {
    echo "FUNCTION_URL пуст или не вида https://<ref>.supabase.co/functions/v1/bot" >&2
    exit 1
  }
  echo "${BASH_REMATCH[1]}"
}

case "${1:-}" in
  check)
    [[ -f $ENV_FILE ]] || { echo "NO_FILE: нет $ENV_FILE (шаблон .env.prod.example)"; exit 2; }
    missing=()
    for k in "${REQUIRED[@]}"; do [[ -n $(get "$k") ]] || missing+=("$k"); done
    [[ $(get DATABASE_URL) == *:6543/* || -z $(get DATABASE_URL) ]] ||
      echo "WARN: DATABASE_URL должен быть Transaction pooler (порт 6543)"
    [[ $(get MIGRATION_DB_URL) == *:5432/* || -z $(get MIGRATION_DB_URL) ]] ||
      echo "WARN: MIGRATION_DB_URL должен быть Session pooler (порт 5432)"
    if ((${#missing[@]})); then echo "MISSING: ${missing[*]}"; exit 1; fi
    echo "OK"
    ;;
  fill)
    [[ -f $ENV_FILE ]] || cp .env.prod.example "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    for k in WEBHOOK_SECRET CRON_SECRET; do
      [[ -n $(get "$k") ]] || { set_var "$k" "$(openssl rand -hex 32)"; echo "FILLED: $k"; }
    done
    if [[ -z $(get BOT_INFO) && -n $(get BOT_TOKEN) ]]; then
      info=$(curl -fsS "https://api.telegram.org/bot$(get BOT_TOKEN)/getMe" | jq -c .result) &&
        { set_var BOT_INFO "$info"; echo "FILLED: BOT_INFO (@$(jq -r .username <<<"$info"))"; } ||
        echo "WARN: getMe не ответил — проверь BOT_TOKEN"
    fi
    ;;
  set-ref)
    [[ ${2:-} =~ ^[a-z0-9]{20}$ ]] || { echo "ref — 20 символов [a-z0-9]" >&2; exit 1; }
    [[ -f $ENV_FILE ]] || cp .env.prod.example "$ENV_FILE"
    set_var FUNCTION_URL "https://$2.supabase.co/functions/v1/bot"
    echo "FUNCTION_URL → https://$2.supabase.co/functions/v1/bot"
    ;;
  ref) ref ;;
  secrets)
    r=$(ref)
    tmp=$(mktemp)
    chmod 600 "$tmp"
    trap 'rm -f "$tmp"' EXIT
    for k in "${FUNCTION_KEYS[@]}"; do v=$(get "$k"); [[ -z $v ]] || echo "$k=$v" >>"$tmp"; done
    supabase secrets set --env-file "$tmp" --project-ref "$r" 2>&1 | mask
    echo "SET: $(cut -d= -f1 "$tmp" | tr '\n' ' ')"
    ;;
  db-push)
    url=$(get MIGRATION_DB_URL)
    [[ -n $url ]] || { echo "MISSING: MIGRATION_DB_URL"; exit 1; }
    supabase db push --db-url "$url" --yes 2>&1 | mask
    ;;
  webhook-status)
    info=$(curl -fsS "https://api.telegram.org/bot$(get BOT_TOKEN)/getWebhookInfo")
    want="$(get FUNCTION_URL | sed 's#/$##')/webhook"
    jq -r --arg want "$want" '.result |
      "url: \(if .url == $want then "OK" elif .url == "" then "NOT_SET" else "MISMATCH (\(.url))" end)",
      "pending: \(.pending_update_count)",
      "last_error: \(.last_error_message // "none")"' <<<"$info"
    ;;
  health)
    curl -s -o /dev/null -w 'health: %{http_code}\n' \
      -H "x-cron-secret: $(get CRON_SECRET)" "$(get FUNCTION_URL | sed 's#/$##')/health"
    ;;
  *)
    sed -n '2,13p' "$0"
    exit 1
    ;;
esac
