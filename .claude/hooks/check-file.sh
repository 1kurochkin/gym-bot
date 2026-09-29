#!/usr/bin/env bash
# После правки .ts: typecheck и lint файла. Код 2 — вывод уходит агенту, чтобы он сразу исправил.
f=$(jq -r '.tool_input.file_path // empty')
[[ "$f" == *.ts ]] || exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0
out=$( (deno check "$f" && deno lint "$f") 2>&1 ) || { echo "$out" | tail -40 >&2; exit 2; }
