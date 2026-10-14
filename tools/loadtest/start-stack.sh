#!/usr/bin/env bash
# Sobe a INIA em modo PRODUÇÃO contra o banco do teste de carga, com a IA falsa (tools/loadtest/fake-ai.mjs):
#   API (papel api) em 127.0.0.1:3433 (+2 por instância extra: 3435, 3437…), processamento (papel worker, /health em :3434)
#   e a interface (`next start`) em 127.0.0.1:3110. Logs e PIDs em tools/loadtest/out/.
# Pré-requisitos: `npm run build` no backend e `next build --webpack` no frontend com NEXT_PUBLIC_INIA_API_URL=http://127.0.0.1:3433,
# e o banco do teste (ver README.md). Para parar: tools/loadtest/stop-stack.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/tools/loadtest/out"
mkdir -p "$OUT"
LT_DB="${LT_DATABASE_URL:-postgresql://localhost:5432/inia_loadtest}"
INSTANCES="${LT_API_INSTANCES:-1}"
WEB_PORT="${LT_WEB_PORT:-3110}"
ORIGIN="http://127.0.0.1:$WEB_PORT"

# Nunca uma chave de IA de verdade: se algo escapar da IA falsa, o provedor recusa (sem custo).
# O banco do teste é cópia do dev: os segredos da Central de Dados estão cifrados com a frase de desenvolvimento
# (aes-secret-store.ts › DEV_FALLBACK_KEY), que produção exige explícita.
COMMON=(NODE_ENV=production DATABASE_URL="$LT_DB" HOST=127.0.0.1 CORS_ORIGIN="$ORIGIN" GEMINI_API_KEY=fake-loadtest-key
  SESSION_COOKIE_SECURE=false INIA_USAGE_COLLECTION=OFF LOG_LEVEL=warn
  DATA_HUB_SECRET_KEY="${LT_DATA_HUB_SECRET_KEY:-inia-dev-data-hub-secret-key-change-me}")

for ((i = 0; i < INSTANCES; i++)); do
  PORT=$((3433 + 2 * i))
  (cd "$ROOT/backend" && env "${COMMON[@]}" PORT="$PORT" INIA_PROCESS_ROLE=api \
    nohup sh -c 'node --import "$1" dist/main/server.js; echo "[loadtest] processo saiu com código $? em $(date +%T)"' _ "$ROOT/tools/loadtest/fake-ai.mjs" > "$OUT/api-$PORT.log" 2>&1 & echo $! > "$OUT/api-$PORT.pid")
done
# O worker não abre HTTP público (PORT só satisfaz a configuração); o /health dele fica em WORKER_HEALTH_PORT.
(cd "$ROOT/backend" && env "${COMMON[@]}" PORT=3499 INIA_PROCESS_ROLE=worker WORKER_HEALTH_PORT=3434 \
  WORKFLOW_WORKER_CONCURRENCY="${LT_WORKER_CONCURRENCY:-8}" \
  nohup sh -c 'node --import "$1" dist/main/server.js; echo "[loadtest] processo saiu com código $? em $(date +%T)"' _ "$ROOT/tools/loadtest/fake-ai.mjs" > "$OUT/worker.log" 2>&1 & echo $! > "$OUT/worker.pid")
(cd "$ROOT/frontend" && env NODE_ENV=production INIA_API_URL=http://127.0.0.1:3433 NEXT_TELEMETRY_DISABLED=1 \
  nohup node node_modules/next/dist/bin/next start -H 127.0.0.1 -p "$WEB_PORT" > "$OUT/web.log" 2>&1 & echo $! > "$OUT/web.pid")

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:3433/health" > /dev/null 2>&1 && curl -fsS "http://127.0.0.1:3434/health" > /dev/null 2>&1 && curl -fsS -o /dev/null "$ORIGIN/auth/login" 2>/dev/null; then
    echo "pilha no ar: API 3433 (x$INSTANCES), worker 3434, interface $WEB_PORT — banco $LT_DB"
    exit 0
  fi
  sleep 1
done
echo "a pilha não respondeu em 60 s — veja $OUT/*.log" >&2
exit 1
