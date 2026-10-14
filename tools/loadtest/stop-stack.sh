#!/usr/bin/env bash
# Para o que start-stack.sh subiu (pelos PIDs gravados em tools/loadtest/out/).
OUT="$(cd "$(dirname "$0")" && pwd)/out"
for pidfile in "$OUT"/*.pid; do
  [ -f "$pidfile" ] || continue
  pid="$(cat "$pidfile")"
  # `next start` sobe um processo filho que segura a porta: para os filhos primeiro.
  pkill -P "$pid" 2> /dev/null
  kill "$pid" 2> /dev/null && echo "parado $(basename "$pidfile" .pid) ($pid)"
  rm -f "$pidfile"
done
