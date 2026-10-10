import { z } from "zod"

/**
 * V1.7.1c — falha técnica de um nó (evento `node_failed`/`flow_dead`), para a área administrativa: categoria, código,
 * tentativa, campos inválidos e a decisão de retry. Nunca o conteúdo da resposta do modelo (ela fica na execução do agente).
 * Eventos anteriores à V1.7.1c não têm `errorCategory` → nada é mostrado além da mensagem de sempre.
 */
export const executionFailureSchema = z.object({
  label: z.string(),
  category: z.string().nullable(),
  code: z.string().nullable(),
  attempt: z.number().nullable(),
  willRetry: z.boolean().nullable(),
  retryReason: z.string().nullable(),
  nextRetryAt: z.string().nullable(),
  repairAttempt: z.boolean().nullable(),
  contract: z.object({ name: z.string().nullable(), version: z.string().nullable(), violationCount: z.number(), fields: z.array(z.string()), rawResponseStored: z.boolean() }).nullable(),
  model: z.string().nullable(),
  agentRunId: z.string().nullable(),
})
export type ExecutionFailure = z.infer<typeof executionFailureSchema>

/** Payload bruto do evento → o mesmo formato do detalhe de Resultados (campos ausentes = null). */
export function failureFromEventPayload(payload: Record<string, unknown>): ExecutionFailure | null {
  if (typeof payload.errorCategory !== "string") return null
  const contract = payload.contract && typeof payload.contract === "object" ? (payload.contract as Record<string, unknown>) : null
  const violations = Array.isArray(contract?.violations) ? (contract.violations as { path?: unknown; code?: unknown }[]) : []
  const text = (value: unknown) => (typeof value === "string" ? value : null)
  return {
    label: text(payload.errorCategoryLabel) ?? payload.errorCategory,
    category: payload.errorCategory,
    code: text(payload.errorCode),
    attempt: typeof payload.attempts === "number" ? payload.attempts : null,
    willRetry: typeof payload.willRetry === "boolean" ? payload.willRetry : null,
    retryReason: text(payload.retryReason),
    nextRetryAt: text(payload.nextRetryAt),
    repairAttempt: typeof payload.repairAttempt === "boolean" ? payload.repairAttempt : null,
    contract: contract
      ? { name: text(contract.name), version: text(contract.version), violationCount: typeof contract.violationCount === "number" ? contract.violationCount : violations.length, fields: [...new Set(violations.map((violation) => `${String(violation.path)} (${String(violation.code)})`))], rawResponseStored: contract.rawResponseStored === true }
      : null,
    model: text(payload.model),
    agentRunId: text(payload.agentRunId),
  }
}
