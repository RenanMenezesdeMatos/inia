#!/usr/bin/env bash
# Sobe UMA versão compilada da INIA para medir o chat: API (papel api) e, opcionalmente, o processamento (papel worker), contra
# um banco de medição (cópia do dev — nunca o dev) — com IA REAL (LT_AI=real: a chave do backend/.env, só a API, sem worker, para
# nenhum Workflow gastar IA) ou FALSA (LT_AI=fake: tools/loadtest/fake-ai.mjs, com a cota compartilhada de fake-quota.mjs).
#
#   LT_CODE=<pasta backend compilada> LT_PORT=3451 LT_AI=fake LT_WORKER=1 tools/loadtest/start-bench.sh <rótulo>
#
# PIDs e logs em tools/loadtest/out/bench-<rótulo>-*.{pid,log}. Para parar: tools/loadtest/stop-bench.sh <rótulo>.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/tools/loadtest/out"
mkdir -p "$OUT"
LABEL="${1:?rótulo}"
# Segredos do backend/.env (nunca impressos); a chave de IA só com LT_AI=real. ANTES das variáveis daqui: o .env traz PORT e
# DATABASE_URL do dev, que nunca valem para a medição.
set -a
# shellcheck disable=SC1091
. "$ROOT/backend/.env"
set +a
CODE="${LT_CODE:?LT_CODE = pasta backend com dist/}"
API_PORT="${LT_PORT:-3451}"
AI="${LT_AI:-fake}"
DB="${LT_DATABASE_URL:-postgresql://localhost:5432/inia_chatbench}"
ORIGIN="${LT_ORIGIN:-http://127.0.0.1:3110}"
case "$DB" in *"/inia"|*"/inia?"*) echo "recusado: o banco de medição nunca é o dev (inia)" >&2; exit 1 ;; esac
COMMON=(NODE_ENV=production DATABASE_URL="$DB" HOST=127.0.0.1 CORS_ORIGIN="$ORIGIN" SESSION_COOKIE_SECURE=false INIA_USAGE_COLLECTION=OFF
  LOG_LEVEL=info DATA_HUB_SECRET_KEY="${DATA_HUB_SECRET_KEY:-inia-dev-data-hub-secret-key-change-me}" JWT_SECRET="${JWT_SECRET:-bench-jwt-secret-0123456789abcdef0123456789}")
IMPORT=(--no-warnings)
if [ "$AI" = "fake" ]; then
  COMMON+=(GEMINI_API_KEY=fake-loadtest-key LT_QUOTA_URL="${LT_QUOTA_URL:-http://127.0.0.1:3480}" LT_STREAM_FIRST_RATIO="${LT_STREAM_FIRST_RATIO:-0.45}")
  IMPORT=(--import "$ROOT/tools/loadtest/fake-ai.mjs")
elif [ "$AI" != "real" ]; then
  echo "LT_AI deve ser real ou fake" >&2; exit 1
fi

(cd "$CODE" && env "${COMMON[@]}" PORT="$API_PORT" INIA_PROCESS_ROLE=api nohup node "${IMPORT[@]}" dist/main/server.js > "$OUT/bench-$LABEL-api.log" 2>&1 & echo $! > "$OUT/bench-$LABEL-api.pid")
if [ "${LT_WORKER:-0}" = "1" ]; then
  if [ "$AI" = "real" ]; then echo "recusado: worker com IA real gastaria IA nos Workflows pendentes" >&2; exit 1; fi
  (cd "$CODE" && env "${COMMON[@]}" PORT=$((API_PORT + 40)) INIA_PROCESS_ROLE=worker WORKER_HEALTH_PORT=$((API_PORT + 1)) WORKFLOW_WORKER_CONCURRENCY="${LT_WORKER_CONCURRENCY:-8}" \
    nohup node "${IMPORT[@]}" dist/main/server.js > "$OUT/bench-$LABEL-worker.log" 2>&1 & echo $! > "$OUT/bench-$LABEL-worker.pid")
fi
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$API_PORT/health" > /dev/null 2>&1; then
    echo "no ar: $LABEL — API $API_PORT (IA $AI)${LT_WORKER:+, worker /health $((API_PORT + 1))} — banco $DB"
    exit 0
  fi
  sleep 1
done
echo "a API não respondeu em 60 s — veja $OUT/bench-$LABEL-api.log" >&2
exit 1
