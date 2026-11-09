import { DomainError } from "../../../shared/domain/domain-error.js"
import { SCHEDULE_EXCEPTION_LABELS, SUPERVISOR_PROVISIONABLE_CODES, type ScheduleExceptionCode } from "../../people/domain/schedule-exception.js"
import { CLASSIFICATION_SUPERSEDED_REASON_LABELS, JUSTIFIED_ABSENCE_REASONS, JUSTIFIED_ABSENCE_REASON_LABELS, describeWorkdayClassification } from "../../people/domain/workday-classification.js"
import { alertTextFor, describeSnapshotPlan, RECONCILIATION_RESOLUTION_LABELS, type ReconciliationRow, type SupervisorResolutionInput } from "../../people/application/workday-reconciliation-service.js"
import { resolveSource } from "../../workflows/application/output-executor.js"
import { findEdge, humanReviewDecisionSchema, type FlowGraph, type FlowNode, type HumanReviewDecision } from "../../workflows/domain/graph-schema.js"
import { describeReviewContent } from "../domain/review-content.js"
import { buildReviewPresentation } from "../domain/review-presentation.js"
import type { HumanReviewDetail, HumanReviewSummary, InterventionPendingSummary, PendingActionPerson, PendingActionStatus, PendingActionSummary, PendingActionsSummary, ReviewPreviousOutput, WorkdayReconciliationDetail, WorkdayReconciliationSummary } from "../domain/view-models.js"
import type { PendingActionsRepository, ReviewAlertRow, WorkdayReconciliationRecord } from "./pending-actions-repository.js"

export type Viewer = { personId: string; organizationId: string }

type StoredDecision = { decision?: HumanReviewDecision; reviewerId?: string; decidedAt?: string }

/** Aviso de revisão vivo — o mesmo filtro das contagens no SQL (pending-actions-repository.ts). */
const LIVE_ALERT_STATUSES = new Set(["OPEN", "SEEN", "ACKNOWLEDGED"])

/** Estado de UM ponto de revisão, derivado da execução (e do aviso ainda vivo) — mesma regra em lista, detalhe,
 * contadores e decisão. */
export function reviewStatus(row: ReviewAlertRow): { status: PendingActionStatus; stored: StoredDecision | null } {
  if (!row.enrollment) return { status: "UNAVAILABLE", stored: null }
  const stored = row.enrollment.reviewOutput as StoredDecision | null | undefined
  if (stored?.decision && humanReviewDecisionSchema.safeParse(stored.decision).success) return { status: "DECIDED", stored }
  if (row.enrollment.status === "waiting" && row.enrollment.currentNodeId === row.nodeId && LIVE_ALERT_STATUSES.has(row.alertStatus)) return { status: "PENDING", stored: null }
  return { status: "UNAVAILABLE", stored: null }
}

function humanReviewNode(graph: FlowGraph | null, nodeId: string): Extract<FlowNode, { type: "human_review" }> | null {
  const node = graph?.nodes.find((candidate) => candidate.id === nodeId)
  return node && node.type === "human_review" ? node : null
}

function buildSummary(row: ReviewAlertRow, graph: FlowGraph | null, people: Map<string, PendingActionPerson>): HumanReviewSummary {
  const { status, stored } = reviewStatus(row)
  const node = humanReviewNode(graph, row.nodeId)
  const operator = row.enrollment?.operatorId ? (people.get(row.enrollment.operatorId) ?? null) : null
  const reviewer = stored?.reviewerId ? (people.get(stored.reviewerId) ?? null) : null
  return {
    id: `${row.enrollmentId}:${row.nodeId}`,
    kind: "HUMAN_REVIEW",
    status,
    enrollmentId: row.enrollmentId,
    nodeId: row.nodeId,
    workflowName: row.enrollment?.workflowName ?? "Workflow removido",
    nodeLabel: node?.label ?? "Revisão humana",
    operator,
    reason: node?.config.instruction ?? null,
    requestedAt: row.requestedAt,
    caseId: row.caseId,
    decision: stored?.decision ?? null,
    decidedAt: stored?.decidedAt ?? null,
    reviewer: reviewer ? { personId: reviewer.personId, name: reviewer.name } : null,
  }
}

async function loadGraphs(repository: PendingActionsRepository, rows: ReviewAlertRow[]): Promise<Map<string, FlowGraph | null>> {
  const versionIds = [...new Set(rows.flatMap((row) => (row.enrollment ? [row.enrollment.versionId] : [])))]
  const graphs = await Promise.all(versionIds.map(async (versionId) => [versionId, await repository.loadGraph(versionId)] as const))
  return new Map(graphs)
}

async function loadPeopleFor(repository: PendingActionsRepository, rows: ReviewAlertRow[]): Promise<Map<string, PendingActionPerson>> {
  const ids = new Set<string>()
  for (const row of rows) {
    if (row.enrollment?.operatorId) ids.add(row.enrollment.operatorId)
    const stored = row.enrollment?.reviewOutput as StoredDecision | null | undefined
    if (stored?.reviewerId) ids.add(stored.reviewerId)
  }
  return repository.loadPeople([...ids])
}

export const WORKDAY_KEY_PREFIX = "workday:"

export function workdayActionId(reconciliationId: string): string {
  return `${WORKDAY_KEY_PREFIX}${reconciliationId}`
}

function buildWorkdaySummary(row: WorkdayReconciliationRecord, people: Map<string, PendingActionPerson>): WorkdayReconciliationSummary {
  const operator = people.get(row.personId) ?? null
  const reviewer = row.resolvedByPersonId ? (people.get(row.resolvedByPersonId) ?? null) : null
  const text = alertTextFor(row.kind, operator?.name ?? "o colaborador", row.workday, row.snapshot)
  return {
    id: workdayActionId(row.id),
    kind: "WORKDAY_RECONCILIATION",
    status: row.status === "OPEN" ? "PENDING" : "DECIDED",
    reconciliationId: row.id,
    operator,
    workday: row.workday,
    reason: text.description.split(". Plano:")[0] + ".",
    plan: describeSnapshotPlan(row.snapshot),
    requestedAt: row.detectedAt,
    resolution: row.resolution,
    resolutionLabel: row.resolution ? RECONCILIATION_RESOLUTION_LABELS[row.resolution] : null,
    decidedAt: row.resolvedAt,
    reviewer: reviewer ? { personId: reviewer.personId, name: reviewer.name } : null,
    classification: row.classification ? { id: row.classification.id, classification: row.classification.classification, reasonCode: row.classification.reasonCode, label: describeWorkdayClassification(row.classification), supersededReason: row.classification.supersededReason, supersededReasonLabel: row.classification.supersededReason ? CLASSIFICATION_SUPERSEDED_REASON_LABELS[row.classification.supersededReason] : null } : null,
    availability: row.snapshot.availability ? { state: row.snapshot.availability.state, label: row.snapshot.availability.label } : null,
  }
}

async function loadPeopleForWorkdays(repository: PendingActionsRepository, rows: ReconciliationRow[]): Promise<Map<string, PendingActionPerson>> {
  const ids = new Set<string>()
  for (const row of rows) {
    ids.add(row.personId)
    if (row.resolvedByPersonId) ids.add(row.resolvedByPersonId)
  }
  return repository.loadPeople([...ids])
}

/** Lista do viewer: só o que foi endereçado a ele (o repositório filtra por recipient) — pendentes
 * primeiro (revisões e produção não identificada), histórico (decididas/indisponíveis/resolvidas) em
 * seguida. Órfãos de execução ficam fora. */
export async function buildPendingActions(repository: PendingActionsRepository, viewer: Viewer): Promise<PendingActionsSummary> {
  const [reviewRows, workdayRows, interventionRows] = await Promise.all([repository.loadReviewAlerts(viewer.personId, viewer.organizationId), repository.loadWorkdayReconciliations(viewer.personId, viewer.organizationId), repository.loadInterventionPendings(viewer.personId, viewer.organizationId)])
  const rows = reviewRows.filter((row) => row.enrollment !== null)
  const [graphs, people, workdayPeople] = await Promise.all([loadGraphs(repository, rows), loadPeopleFor(repository, rows), loadPeopleForWorkdays(repository, workdayRows)])
  const summaries: PendingActionSummary[] = [
    ...rows.map((row) => buildSummary(row, row.enrollment ? (graphs.get(row.enrollment.versionId) ?? null) : null, people)),
    ...workdayRows.map((row) => buildWorkdaySummary(row, workdayPeople)),
    ...interventionRows.map(
      (row): InterventionPendingSummary => ({
        id: `intervention:${row.id}`,
        kind: "INTERVENTION",
        status: "PENDING",
        interventionId: row.id,
        caseId: row.caseId,
        operator: { personId: row.person.id, name: row.person.name, teamName: row.person.teamName, jobTitle: null },
        typeName: row.type.name,
        reason: row.reason,
        pendingReason: row.pendingReason,
        pendingLabel: row.pendingLabel,
        dueAt: row.dueAt,
        overdue: row.overdue,
        sensitive: row.sensitive,
        requestedAt: row.updatedAt,
        decidedAt: null,
        reviewer: null,
      }),
    ),
  ]
  const byRecency = (a: PendingActionSummary, b: PendingActionSummary) => b.requestedAt.localeCompare(a.requestedAt)
  const pending = summaries.filter((item) => item.status === "PENDING").sort(byRecency)
  const history = summaries.filter((item) => item.status !== "PENDING").sort(byRecency)
  return { pending, history, pendingCount: pending.length }
}

function workdayNotFound(): DomainError {
  return new DomainError("Pendência não encontrada ou não endereçada a você.", "PENDING_ACTION_NOT_FOUND", 404)
}

/** Detalhe de "Produção não identificada após o fechamento das fontes": plano conhecido, fontes de evidência, motivos disponíveis. */
export async function buildWorkdayReconciliationDetail(repository: PendingActionsRepository, viewer: Viewer, reconciliationId: string): Promise<WorkdayReconciliationDetail> {
  const row = await repository.loadWorkdayReconciliation(viewer.personId, viewer.organizationId, reconciliationId)
  if (!row) throw workdayNotFound()
  const people = await loadPeopleForWorkdays(repository, [row])
  return {
    ...buildWorkdaySummary(row, people),
    evidenceSources: row.snapshot.evidenceSources,
    shiftEnd: row.snapshot.shiftEnd,
    justifiedReasons: JUSTIFIED_ABSENCE_REASONS.map((code) => ({ code, label: JUSTIFIED_ABSENCE_REASON_LABELS[code] })),
    provisionableCodes: SUPERVISOR_PROVISIONABLE_CODES.map((code) => ({ code, label: SCHEDULE_EXCEPTION_LABELS[code] })),
    resolutionException: row.resolutionException ? { id: row.resolutionException.id, code: row.resolutionException.code as ScheduleExceptionCode, label: SCHEDULE_EXCEPTION_LABELS[row.resolutionException.code as ScheduleExceptionCode] ?? row.resolutionException.code } : null,
  }
}

export type ResolveWorkday = (input: { organizationId: string; id: string; actorPersonId: string; decision: SupervisorResolutionInput }) => Promise<unknown>

/**
 * Decisão do Supervisor sobre uma pendência de produção. Autorização = a pendência foi endereçada a
 * este viewer (recipient). A gravação é a MESMA função do serviço de reconciliação (classificação
 * revisável com histórico, ou AJUSTE_ESCALA auditável; resolve o alerta; audita) — idempotente para a
 * mesma decisão; outra classificação é uma revisão registrada.
 */
export async function decideWorkdayReconciliation(repository: PendingActionsRepository, resolve: ResolveWorkday, viewer: Viewer, reconciliationId: string, decision: SupervisorResolutionInput): Promise<WorkdayReconciliationDetail> {
  const row = await repository.loadWorkdayReconciliation(viewer.personId, viewer.organizationId, reconciliationId)
  if (!row) throw workdayNotFound()
  await resolve({ organizationId: viewer.organizationId, id: reconciliationId, actorPersonId: viewer.personId, decision })
  return buildWorkdayReconciliationDetail(repository, viewer, reconciliationId)
}

function notFound(): DomainError {
  return new DomainError("Revisão não encontrada ou não endereçada a você.", "PENDING_ACTION_NOT_FOUND", 404)
}

function previousOutputs(graph: FlowGraph | null, nodeOutputs: Record<string, unknown>, nodeId: string): ReviewPreviousOutput[] {
  const outputs: ReviewPreviousOutput[] = []
  for (const [outputNodeId, value] of Object.entries(nodeOutputs)) {
    if (outputNodeId === nodeId) continue
    const node = graph?.nodes.find((candidate) => candidate.id === outputNodeId)
    if (!node || (node.type !== "action" && node.type !== "orchestrator")) continue
    const text = describeReviewContent(value)
    if (text) outputs.push({ nodeId: outputNodeId, nodeLabel: node.label, text })
  }
  return outputs
}

/** Detalhe de uma revisão: contexto suficiente para decidir — instrução, conteúdo do Execution
 * Context, caso/evidências, resultados anteriores de Agent/Orchestrator e linha do tempo. */
export async function buildHumanReviewDetail(repository: PendingActionsRepository, viewer: Viewer, enrollmentId: string, nodeId: string): Promise<HumanReviewDetail> {
  const row = await repository.loadReviewAlert(viewer.personId, viewer.organizationId, enrollmentId, nodeId)
  if (!row || !row.enrollment) throw notFound()
  const [graph, people, reviewCase, timeline] = await Promise.all([
    repository.loadGraph(row.enrollment.versionId),
    loadPeopleFor(repository, [row]),
    row.caseId ? repository.loadCase(row.caseId) : Promise.resolve(null),
    repository.loadEnrollmentEvents(row.enrollmentId),
  ])
  const summary = buildSummary(row, graph, people)
  const node = humanReviewNode(graph, nodeId)
  const contentValue = node?.config.contentSource ? resolveSource(row.enrollment.nodeOutputs, node.config.contentSource, row.enrollment.variables) : undefined
  const allowedDecisions = graph ? humanReviewDecisionSchema.options.filter((decision) => findEdge(graph, nodeId, decision) !== undefined) : []
  return {
    ...summary,
    instruction: node?.config.instruction ?? null,
    content: describeReviewContent(contentValue),
    presentation: buildReviewPresentation(contentValue),
    allowedDecisions,
    caseTitle: reviewCase?.title ?? null,
    caseSummary: reviewCase?.summary ?? null,
    evidences: reviewCase?.evidences ?? [],
    previousOutputs: previousOutputs(graph, row.enrollment.nodeOutputs, nodeId),
    timeline,
  }
}

export type SubmitDecision = (input: { enrollmentId: string; nodeId: string; decision: HumanReviewDecision; reviewerId: string }) => Promise<unknown>

/**
 * Decisão pela Surface Pendências. Autorização = a revisão foi endereçada a este viewer (alerta
 * com recipient_id = ele). A gravação é a MESMA função da rota admin (submit-human-review-
 * decision.ts): persiste, retoma o workflow e é protegida por optimistic lock. Idempotente do
 * ponto de vista do usuário: repetir uma decisão já gravada (mesmo valor) devolve o estado
 * DECIDED sem executar nada de novo; uma decisão diferente da já gravada é recusada (409).
 */
export async function decideHumanReview(
  repository: PendingActionsRepository,
  submit: SubmitDecision,
  viewer: Viewer,
  input: { enrollmentId: string; nodeId: string; decision: HumanReviewDecision },
): Promise<HumanReviewDetail> {
  const row = await repository.loadReviewAlert(viewer.personId, viewer.organizationId, input.enrollmentId, input.nodeId)
  if (!row || !row.enrollment) throw notFound()
  const { status, stored } = reviewStatus(row)
  if (status === "DECIDED") {
    if (stored?.decision === input.decision) return buildHumanReviewDetail(repository, viewer, input.enrollmentId, input.nodeId)
    throw new DomainError("Esta revisão já foi decidida.", "PENDING_ACTION_ALREADY_DECIDED", 409)
  }
  if (status !== "PENDING") throw new DomainError("Esta execução não está mais aguardando esta revisão.", "PENDING_ACTION_UNAVAILABLE", 409)

  const graph = await repository.loadGraph(row.enrollment.versionId)
  if (graph && findEdge(graph, input.nodeId, input.decision) === undefined) {
    throw new DomainError("Esta decisão não está prevista no workflow para esta revisão.", "PENDING_ACTION_DECISION_NOT_ALLOWED", 422)
  }

  await submit({ enrollmentId: input.enrollmentId, nodeId: input.nodeId, decision: input.decision, reviewerId: viewer.personId })
  await repository.resolveAlert(row.alertId)
  return buildHumanReviewDetail(repository, viewer, input.enrollmentId, input.nodeId)
}
