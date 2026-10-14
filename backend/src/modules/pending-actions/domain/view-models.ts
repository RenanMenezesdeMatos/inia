import type { ReviewPresentation } from "./review-presentation.js"
import type { ScheduleExceptionCode } from "../../people/domain/schedule-exception.js"
import type { WorkActivityEvidenceSources } from "../../people/domain/work-activity-evidence.js"
import type { ClassificationSupersededReason, JustifiedAbsenceReason, WorkdayClassificationKind } from "../../people/domain/workday-classification.js"
import type { HumanReviewDecision } from "../../workflows/domain/graph-schema.js"

/**
 * Contratos da Surface PENDÊNCIAS ("tenho algo para decidir/fazer") — distinta de Acompanhamento
 * (conteúdo para ler) e de Notificações (algo novo aconteceu). Dois tipos acionáveis reais:
 *  - HUMAN_REVIEW: Revisão Humana de Workflow — aponta para a execução real (`enrollmentId` + `nodeId`),
 *    a mesma que o motor retoma depois da decisão (nunca uma cópia);
 *  - WORKDAY_RECONCILIATION: "Produção não identificada após o fechamento das fontes" (people/application/
 *    workday-reconciliation-service.ts) — o Supervisor CLASSIFICA o que aconteceu num dia programado sem
 *    evidência de produção: falta injustificada / ausência justificada (motivo) / trabalhou — dados não
 *    chegaram (classificações revisáveis) ou corrigir planejamento. Nunca antes de as fontes fecharem.
 */
export type PendingActionKind = "HUMAN_REVIEW" | "WORKDAY_RECONCILIATION" | "INTERVENTION"

/** PENDING: a execução está parada esperando esta decisão. DECIDED: alguém já decidiu (histórico).
 * UNAVAILABLE: a execução não está mais nesse ponto (cancelada/falhou/seguiu por outro caminho). */
export type PendingActionStatus = "PENDING" | "DECIDED" | "UNAVAILABLE"

export type PendingActionPerson = { personId: string; name: string; teamName: string | null; jobTitle: string | null }

export type HumanReviewSummary = {
  /** `${enrollmentId}:${nodeId}` — chave estável usada em URL/deep link. */
  id: string
  kind: "HUMAN_REVIEW"
  status: PendingActionStatus
  enrollmentId: string
  nodeId: string
  workflowName: string
  nodeLabel: string
  operator: PendingActionPerson | null
  /** Instrução configurada no node (o "motivo" da revisão). */
  reason: string | null
  requestedAt: string
  caseId: string | null
  decision: HumanReviewDecision | null
  decidedAt: string | null
  reviewer: { personId: string; name: string } | null
}

export type WorkdayResolutionKind = "NOT_WORKED" | "UNJUSTIFIED_ABSENCE" | "JUSTIFIED_ABSENCE" | "WORKED_DATA_MISSING" | "SCHEDULE_CORRECTED" | "PRODUCTION_RECEIVED_AFTER_ALERT" | "PLAN_UPDATED_AFTER_ALERT" | "SOURCES_STILL_OPEN" | "DATA_SOURCE_DELAYED" | "STATUS_NON_PRODUCTIVE"

export type WorkdayReconciliationSummary = {
  /** `workday:${reconciliationId}` — chave estável usada em URL/deep link. */
  id: string
  kind: "WORKDAY_RECONCILIATION"
  /** PENDING = OPEN; DECIDED = resolvida (pelo Supervisor ou automaticamente). */
  status: PendingActionStatus
  reconciliationId: string
  operator: PendingActionPerson | null
  /** AAAA-MM-DD do dia sem produção identificada. */
  workday: string
  /** "Não foi identificada produção para João em 16/09." */
  reason: string
  /** O que o sistema sabia do PLANO ao detectar (escala, turno, exceção, situação). */
  plan: string
  requestedAt: string
  resolution: WorkdayResolutionKind | null
  resolutionLabel: string | null
  decidedAt: string | null
  reviewer: { personId: string; name: string } | null
  /** Classificação vinculada (vigente, ou superada por produção/RH posterior — o rótulo diz). */
  classification: { id: string; classification: WorkdayClassificationKind; reasonCode: JustifiedAbsenceReason | null; label: string; supersededReason: ClassificationSupersededReason | null; supersededReasonLabel: string | null } | null
  /** Disponibilidade dos dados registrada na detecção ("fontes fechadas desde…"). */
  availability: { state: string; label: string } | null
}

/**
 * Intervenção que exige resposta do viewer AGORA (aceitar/descartar, aprovar/devolver, decidir, ou item vencendo). O detalhe e
 * os controles moram no CASO (`/supervisor/cases/:caseId?intervention=:id`); resolver a pendência não encerra a intervenção.
 */
export type InterventionPendingSummary = {
  /** `intervention:${interventionId}` — chave estável usada em URL/deep link. */
  id: string
  kind: "INTERVENTION"
  status: PendingActionStatus
  interventionId: string
  caseId: string
  operator: PendingActionPerson | null
  typeName: string
  reason: string
  pendingReason: "ACCEPT" | "APPROVE" | "DECIDE" | "EXECUTE"
  pendingLabel: string
  dueAt: string
  overdue: boolean
  sensitive: boolean
  requestedAt: string
  decidedAt: null
  reviewer: null
}

export type PendingActionSummary = HumanReviewSummary | WorkdayReconciliationSummary | InterventionPendingSummary

export type PendingActionsSummary = {
  pending: PendingActionSummary[]
  history: PendingActionSummary[]
  pendingCount: number
}

export type ReviewEvidence = { id: string; type: string; title: string; description: string; occurredAt: string }
export type ReviewPreviousOutput = { nodeId: string; nodeLabel: string; text: string }
export type ReviewTimelineEvent = { eventType: string; nodeId: string | null; createdAt: string }

export type HumanReviewDetail = HumanReviewSummary & {
  instruction: string | null
  /** Conteúdo a revisar (Markdown/texto), resolvido do Execution Context da execução real. */
  content: string | null
  /** HUMAN REVIEW CONTEXT (V1.2): apresentação legível do mesmo conteúdo — resultado, evolução, comparação, evidências, limitações, base das recomendações, materiais, resumo das ferramentas. */
  presentation: ReviewPresentation | null
  /** Só as decisões que têm uma aresta de saída no grafo — o motor falharia nas outras. */
  allowedDecisions: HumanReviewDecision[]
  caseTitle: string | null
  caseSummary: string | null
  evidences: ReviewEvidence[]
  previousOutputs: ReviewPreviousOutput[]
  timeline: ReviewTimelineEvent[]
}

export type WorkdayReconciliationDetail = WorkdayReconciliationSummary & {
  evidenceSources: WorkActivityEvidenceSources
  shiftEnd: string | null
  /** Motivos que o Supervisor pode escolher em "Ausência justificada". */
  justifiedReasons: { code: JustifiedAbsenceReason; label: string }[]
  /** Compatibilidade: os mesmos motivos provisionáveis como exceção (a UI anterior lia este campo). */
  provisionableCodes: { code: ScheduleExceptionCode; label: string }[]
  /** Exceção criada pela resolução (NOT_WORKED legado / SCHEDULE_CORRECTED), quando houver. */
  resolutionException: { id: string; code: ScheduleExceptionCode; label: string } | null
}
