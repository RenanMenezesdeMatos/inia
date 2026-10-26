#!/usr/bin/env bash
# Para o que start-bench.sh subiu com o rótulo dado.
set -uo pipefail
OUT="$(cd "$(dirname "$0")" && pwd)/out"
LABEL="${1:?rótulo}"
for file in "$OUT"/bench-"$LABEL"-*.pid; do
  [ -f "$file" ] || continue
  # O PID gravado pode ser o invólucro (env/nohup): o node é filho dele.
  pid="$(cat "$file")"
  children="$(pgrep -P "$pid" 2>/dev/null || true)"
  pkill -TERM -P "$pid" 2>/dev/null || true
  kill "$pid" 2>/dev/null || true
  # O desligamento é gracioso (a porta segue aberta alguns segundos): espera sair, senão o próximo start-bench vê "no ar" a API
  # antiga e as perguntas batem numa porta fechada (22/10/2026).
  for _ in $(seq 1 30); do
    alive=0
    for p in $pid $children; do kill -0 "$p" 2>/dev/null && alive=1; done
    [ "$alive" = 0 ] && break
    sleep 0.5
  done
  rm -f "$file"
done
echo "parado: $LABEL"
