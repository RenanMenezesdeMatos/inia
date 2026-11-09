/**
 * Estados de um Run e as etapas da linha do tempo. Um Run avança sempre para a frente:
 * QUEUED → CONNECTING → FETCHING → PARSING → MAPPING → VALIDATING → APPLYING → (COMPLETED | PARTIAL | FAILED).
 * CANCELLED existe só para Runs ainda em fila (não há cancelamento cooperativo de uma carga em andamento).
 */
export const RUN_STATUSES = ["QUEUED", "CONNECTING", "FETCHING", "PARSING", "MAPPING", "VALIDATING", "APPLYING", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const RUN_ACTIVE_STATUSES: readonly RunStatus[] = ["CONNECTING", "FETCHING", "PARSING", "MAPPING", "VALIDATING", "APPLYING"]

export type RunStage = {
  stage: RunStatus
  startedAt: string
  finishedAt: string | null
  detail: string | null
  /** O processo caiu ou reiniciou durante esta etapa. Conta para `canResumeInterruptedRun`. */
  interrupted?: boolean
}

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

const MINUTE_MS = 60_000

/** Espera depois de cada tentativa que falhou. Somadas, cobrem uma trava de cerca de 3 horas na origem. */
const RETRY_BACKOFF_MS = [1, 5, 15, 30, 60, 60].map((minutes) => minutes * MINUTE_MS)

/** Ninguém está olhando a carga: ela pode insistir até a origem voltar. */
const UNATTENDED_TRIGGERS: readonly RunTriggerKind[] = ["SCHEDULE", "CONTINUATION"]
const UNATTENDED_MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1

/** Alguém pediu e está esperando (Sincronizar agora, primeira importação): a resposta vem em poucos minutos. */
const ATTENDED_MAX_ATTEMPTS = 3

/**
 * Quanto esperar pela próxima tentativa depois que a tentativa `attempt` (a partir de 1) falhou por erro transitório.
 * `null` = acabaram as tentativas. Erro que não é transitório nunca chega aqui: falha de vez.
 */
export function retryDelayMs(trigger: RunTriggerKind, attempt: number): number | null {
  const maxAttempts = UNATTENDED_TRIGGERS.includes(trigger) ? UNATTENDED_MAX_ATTEMPTS : ATTENDED_MAX_ATTEMPTS
  return attempt < maxAttempts ? RETRY_BACKOFF_MS[attempt - 1]! : null
}

/** Terceira queda do processo na mesma carga = FALHOU. Uma carga que derruba o processo não pode voltar indefinidamente. */
const MAX_RUN_INTERRUPTIONS = 3

/**
 * Se a carga que acabou de ser interrompida volta para a fila. Conta as quedas, não as tentativas: esperar a origem
 * voltar é barato, derrubar o processo não é, então os dois limites são independentes.
 */
export function canResumeInterruptedRun(stages: readonly RunStage[]): boolean {
  return stages.filter((stage) => stage.interrupted).length + 1 < MAX_RUN_INTERRUPTIONS
}

/**
 * Posse de um Run pelo worker que o reivindicou (`claimed_until`). Não é o tempo máximo de uma carga: cada etapa, cada lote
 * aplicado e cada página de banco externo renovam a posse. Só uma carga que parou de avançar (processo morto) a perde — e
 * `recoverInterruptedRuns` a devolve à fila.
 */
export const RUN_LEASE_SECONDS = 15 * 60
