import type { ExecutionErrorCategory } from "../../../shared/domain/execution-failure.js"

/**
 * V1.7.1c — POLÍTICA DE RETRY de um nó que falhou, por categoria (shared/domain/execution-failure.ts). Pura: o motor só
 * aplica a decisão e a registra no evento (attempt, errorCategory, willRetry, retryReason, nextRetryAt, repairAttempt).
 *
 *   TRANSIENT_PROVIDER_ERROR / UNCLASSIFIED → até MAX_NODE_ATTEMPTS, com espera progressiva e variação (`nodeRetryDelayMs`);
 *   MODEL_OUTPUT_CONTRACT_INVALID           → encerra JÁ: não existe reparo seguro (uma chamada de "conserto" reenviaria a
 *                                             resposta e poderia mudar conclusões/citações sem que o código consiga provar que
 *                                             só a forma mudou) — a resposta rejeitada fica guardada para diagnóstico;
 *   APPLICATION_INVARIANT_VIOLATION         → encerra JÁ: nada muda entre uma tentativa e outra (a versão é pinada).
 */
export const MAX_NODE_ATTEMPTS = 5
/** Espera antes da 1ª nova tentativa; dobra a cada uma (5 → 10 → 20 min), nunca acima do teto, com ±20% de variação. */
export const NODE_RETRY_BACKOFF_MS = 5 * 60 * 1000
export const NODE_RETRY_BACKOFF_MAX_MS = 20 * 60 * 1000
export const NODE_RETRY_JITTER = 0.2

/**
 * Espera antes da tentativa seguinte (`attempts` = tentativas já feitas, ≥ 1). PROGRESSIVA e com VARIAÇÃO: num disparo em massa
 * que esbarrou no limite do provedor, centenas de nós falham juntos — com espera fixa (até 21/10: 5 min para todos) voltavam
 * todos no mesmo minuto e causavam um novo pico, disputando a cota com o chat. `random` em [0, 1) (determinístico nos testes).
 */
export function nodeRetryDelayMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(NODE_RETRY_BACKOFF_MAX_MS, NODE_RETRY_BACKOFF_MS * 2 ** Math.max(0, attempts - 1))
  return Math.round(base * (1 - NODE_RETRY_JITTER + random() * 2 * NODE_RETRY_JITTER))
}

export const RETRY_REASONS = ["TRANSIENT_PROVIDER_ERROR", "UNCLASSIFIED_LEGACY_RETRY", "MAX_ATTEMPTS_REACHED", "MODEL_OUTPUT_CONTRACT_INVALID_NO_SAFE_REPAIR", "APPLICATION_INVARIANT_NOT_RETRYABLE"] as const
export type RetryReason = (typeof RETRY_REASONS)[number]

export type NodeRetryDecision = { attempts: number; willRetry: boolean; retryReason: RetryReason; nextRetryAt: Date | null; repairAttempt: false }

export function decideNodeRetry(category: ExecutionErrorCategory, previousAttempts: number, now: Date, random: () => number = Math.random): NodeRetryDecision {
  const attempts = previousAttempts + 1
  const stop = (retryReason: RetryReason): NodeRetryDecision => ({ attempts, willRetry: false, retryReason, nextRetryAt: null, repairAttempt: false })
  if (category === "MODEL_OUTPUT_CONTRACT_INVALID") return stop("MODEL_OUTPUT_CONTRACT_INVALID_NO_SAFE_REPAIR")
  if (category === "APPLICATION_INVARIANT_VIOLATION") return stop("APPLICATION_INVARIANT_NOT_RETRYABLE")
  if (attempts >= MAX_NODE_ATTEMPTS) return stop("MAX_ATTEMPTS_REACHED")
  return { attempts, willRetry: true, retryReason: category === "TRANSIENT_PROVIDER_ERROR" ? "TRANSIENT_PROVIDER_ERROR" : "UNCLASSIFIED_LEGACY_RETRY", nextRetryAt: new Date(now.getTime() + nodeRetryDelayMs(attempts, random)), repairAttempt: false }
}
