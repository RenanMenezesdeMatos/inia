/**
 * Estados de um Run e as etapas da linha do tempo. Um Run avança sempre para a frente:
 * QUEUED → CONNECTING → FETCHING → PARSING → MAPPING → VALIDATING → APPLYING → (COMPLETED | PARTIAL | FAILED).
 * CANCELLED existe só para Runs ainda em fila (não há cancelamento cooperativo de uma carga em andamento).
 */
export const RUN_STATUSES = ["QUEUED", "CONNECTING", "FETCHING", "PARSING", "MAPPING", "VALIDATING", "APPLYING", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const RUN_ACTIVE_STATUSES: readonly RunStatus[] = ["CONNECTING", "FETCHING", "PARSING", "MAPPING", "VALIDATING", "APPLYING"]

export type RunStage = { stage: RunStatus; startedAt: string; finishedAt: string | null; detail: string | null }

/** CONTINUATION = carga de banco externo que segue, sozinha, do ponto aplicado pela anterior (limite de linhas por carga). */
export const RUN_TRIGGER_KINDS = ["MANUAL", "SCHEDULE", "PUSH", "FILE_UPLOAD", "REPROCESS", "CONTINUATION"] as const
export type RunTriggerKind = (typeof RUN_TRIGGER_KINDS)[number]

export type RunMetrics = {
  bytes: number | null
  recordsReceived: number
  recordsParsed: number
  recordsValid: number
  recordsRejected: number
  recordsInserted: number
  recordsUpdated: number
  recordsUnchanged: number
  recordsDeactivated: number
  /** Erros REAIS: registros rejeitados (quarentena) e falha da carga. */
  errorCount: number
  /** Avisos NÃO bloqueantes de registros aplicados (ex.: conflito de situação funcional resolvido pela precedência). */
  warningCount: number
  businessMaxEventTime: string | null
}

export function emptyMetrics(): RunMetrics {
  return { bytes: null, recordsReceived: 0, recordsParsed: 0, recordsValid: 0, recordsRejected: 0, recordsInserted: 0, recordsUpdated: 0, recordsUnchanged: 0, recordsDeactivated: 0, errorCount: 0, warningCount: 0, businessMaxEventTime: null }
}

/** Retry com backoff limitado só para erro transitório; o resto falha de vez. */
export const MAX_RUN_ATTEMPTS = 3
export const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000] as const
