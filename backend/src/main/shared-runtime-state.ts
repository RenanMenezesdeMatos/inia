import { hostname } from "node:os"
import type { Database } from "../infrastructure/database/pool.js"
import { aiCallLimiterConfigFromEnv, createAiCallLimiter, setAiCallLimiter } from "../shared/application/model-routing/ai-call-limiter.js"
import { setProviderCallGate, type ProviderCallGate } from "../shared/application/model-routing/provider-call-gate.js"
import type { RateLimitStore } from "../shared/application/rate-limit/rate-limit-store.js"
import { createPostgresProviderCallGate } from "../shared/infrastructure/model-routing/postgres-provider-call-gate.js"
import { createPostgresRateLimitStore } from "../shared/infrastructure/rate-limit/postgres-rate-limit-store.js"
import type { ProcessRole } from "./process-role.js"

/**
 * ESTADO QUE PRECISA VALER PARA TODOS OS PROCESSOS (N APIs + M workers) — ligado na subida de cada um (server.ts e a prova de
 * dois processos): limites de requisição no PostgreSQL e o portão POR CONEXÃO DE IA (vagas da conexão e pausa depois de um
 * 429, divididas por todas as instâncias). O limitador de IA de cada processo continua local (fila, prioridade, vagas do
 * processo — INIA_AI_MAX_CONCURRENT_CALLS).
 */
export function installSharedRuntimeState(db: Pick<Database, "query">, role: ProcessRole): { rateLimitStore: RateLimitStore; providerGate: ProviderCallGate; stop(): void } {
  setAiCallLimiter(createAiCallLimiter(aiCallLimiterConfigFromEnv()))
  const gate = createPostgresProviderCallGate(db, { source: `${role}@${hostname()}#${process.pid}` })
  setProviderCallGate(gate)
  return { rateLimitStore: createPostgresRateLimitStore(db), providerGate: gate, stop: () => gate.stop() }
}
