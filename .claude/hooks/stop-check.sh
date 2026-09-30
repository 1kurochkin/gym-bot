#!/usr/bin/env bash
# Перед завершением работы: полный deno task check. stop_hook_active — защита от зацикливания.
[[ $(jq -r '.stop_hook_active') == "true" ]] && exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0
out=$(NO_COLOR=1 deno task check 2>&1) || { echo "$out" | tail -40 >&2; exit 2; }
