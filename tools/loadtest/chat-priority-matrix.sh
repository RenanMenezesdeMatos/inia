#!/usr/bin/env bash
# Matriz da prioridade do chat: para cada condição (sem disparos, volume esperado, sobrecarga), sobe a versão ANTES e a DEPOIS com
# a IA falsa e a cota compartilhada, roda chat-priority.mjs nas mesmas condições e encerra o que ficou em andamento no banco da
# medição (para a próxima rodada começar sem fila herdada).
#
#   LT_BEFORE=<backend compilado antes> LT_AFTER=<backend compilado depois> tools/loadtest/chat-priority-matrix.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DB="${LT_DATABASE_URL:-postgresql://localhost:5432/inia_chatbench}"
BEFORE="${LT_BEFORE:?}"
AFTER="${LT_AFTER:?}"
DURATION="${LT_DURATION_S:-420}"
CONDITIONS="${LT_CONDITIONS:-sem:0:0 esperado:0:3 sobrecarga:60:8}"
ratio="${LT_STREAM_FIRST_RATIO:-0.8}"

pkill -f "fake-quota.mjs" 2>/dev/null || true
LT_QUOTA_TPM="${LT_QUOTA_TPM:-600000}" LT_QUOTA_RPM="${LT_QUOTA_RPM:-400}" nohup node "$HERE/fake-quota.mjs" > "$HERE/out/bench-quota.log" 2>&1 &
sleep 1

cleanup_db() {
  # Matrículas da medição que ficaram na fila: encerradas (a próxima rodada começa sem fila herdada).
  psql "$DB" -qAt -c "update workflow_enrollments set status = 'dead', claimed_until = null where status in ('active', 'waiting') and created_at > now() - interval '1 day' and interaction_id in (select id from interactions where external_id like 'chatbench-%')" || true
}

for condition in $CONDITIONS; do
  IFS=: read -r name burst perMin <<< "$condition"
  for version in ${LT_VERSIONS:-antes depois}; do
    code="$BEFORE"; [ "$version" = "depois" ] && code="$AFTER"
    label="$version-$name"
    cleanup_db
    LT_CODE="$code" LT_PORT=3452 LT_AI=fake LT_WORKER=1 LT_STREAM_FIRST_RATIO="$ratio" "$HERE/start-bench.sh" "$label" > /dev/null 2>&1 &
    for _ in $(seq 1 60); do
      curl -fsS -o /dev/null http://127.0.0.1:3452/health 2>/dev/null && curl -fsS -o /dev/null http://127.0.0.1:3453/health 2>/dev/null && break
      sleep 1
    done
    LT_API=http://127.0.0.1:3452 LT_WORKER_HEALTH=http://127.0.0.1:3453/health LT_LABEL="$label" LT_DURATION_S="$DURATION" LT_DISPATCH_BURST="$burst" LT_DISPATCH_PER_MIN="$perMin" \
      node "$HERE/chat-priority.mjs" > "$HERE/out/matrix-$label.txt" 2>&1 || echo "falhou: $label"
    "$HERE/stop-bench.sh" "$label" > /dev/null
    sleep 8
    grep -m1 -A3 '"firstText"' "$HERE/out/matrix-$label.txt" | tr -d '\n ' ; echo "  ← $label"
  done
done
cleanup_db
pkill -f "fake-quota.mjs" 2>/dev/null || true
echo "matriz concluída"
