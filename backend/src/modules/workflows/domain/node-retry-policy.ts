import type { ExecutionErrorCategory } from "../../../shared/domain/execution-failure.js"

/**
 * V1.7.1c — POLÍTICA DE RETRY de um nó que falhou, por categoria (shared/domain/execution-failure.ts). Pura: o motor só
 * aplica a decisão e a registra no evento (attempt, errorCategory, willRetry, retryReason, nextRetryAt, repairAttempt).
 *
 *   TRANSIENT_PROVIDER_ERROR / UNCLASSIFIED → até MAX_NODE_ATTEMPTS, com backoff (comportamento histórico);
 *   MODEL_OUTPUT_CONTRACT_INVALID           → encerra JÁ: não existe reparo seguro (uma chamada de "conserto" reenviaria a
 *                                             resposta e poderia mudar conclusões/citações sem que o código consiga provar que
 *                                             só a forma mudou) — a resposta rejeitada fica guardada para diagnóstico;
 *   APPLICATION_INVARIANT_VIOLATION         → encerra JÁ: nada muda entre uma tentativa e outra (a versão é pinada).
 */
export const MAX_NODE_ATTEMPTS = 5
export const NODE_RETRY_BACKOFF_MS = 5 * 60 * 1000

export const RETRY_REASONS = ["TRANSIENT_PROVIDER_ERROR", "UNCLASSIFIED_LEGACY_RETRY", "MAX_ATTEMPTS_REACHED", "MODEL_OUTPUT_CONTRACT_INVALID_NO_SAFE_REPAIR", "APPLICATION_INVARIANT_NOT_RETRYABLE"] as const
export type RetryReason = (typeof RETRY_REASONS)[number]

export type NodeRetryDecision = { attempts: number; willRetry: boolean; retryReason: RetryReason; nextRetryAt: Date | null; repairAttempt: false }

export function decideNodeRetry(category: ExecutionErrorCategory, previousAttempts: number, now: Date): NodeRetryDecision {
  const attempts = previousAttempts + 1
  const stop = (retryReason: RetryReason): NodeRetryDecision => ({ attempts, willRetry: false, retryReason, nextRetryAt: null, repairAttempt: false })
  if (category === "MODEL_OUTPUT_CONTRACT_INVALID") return stop("MODEL_OUTPUT_CONTRACT_INVALID_NO_SAFE_REPAIR")
  if (category === "APPLICATION_INVARIANT_VIOLATION") return stop("APPLICATION_INVARIANT_NOT_RETRYABLE")
  if (attempts >= MAX_NODE_ATTEMPTS) return stop("MAX_ATTEMPTS_REACHED")
  return { attempts, willRetry: true, retryReason: category === "TRANSIENT_PROVIDER_ERROR" ? "TRANSIENT_PROVIDER_ERROR" : "UNCLASSIFIED_LEGACY_RETRY", nextRetryAt: new Date(now.getTime() + NODE_RETRY_BACKOFF_MS), repairAttempt: false }
}
