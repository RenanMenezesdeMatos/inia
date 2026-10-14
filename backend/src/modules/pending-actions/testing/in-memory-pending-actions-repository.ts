import type { FlowGraph } from "../../workflows/domain/graph-schema.js"
import type { PendingActionPerson, ReviewTimelineEvent } from "../domain/view-models.js"
import type { PendingActionsRepository, ReviewAlertDetailRow, ReviewAlertRow, ReviewCase, WorkdayReconciliationRecord } from "../application/pending-actions-repository.js"
import type { PendingIntervention } from "../../interventions/application/intervention-service.js"

export const ORG = "00000000-0000-4000-8000-000000000001"
export const ENROLLMENT = "11111111-1111-4111-8111-111111111111"
export const OTHER_ENROLLMENT = "22222222-2222-4222-8222-222222222222"
export const SUPERVISOR = "sup-1"
export const OTHER_SUPERVISOR = "sup-2"
export const OPERATOR = "op-1"
export const VERSION = "ver-1"

/** Grafo mínimo: gatilho → revisão (aprovada/reprovada) → fim. "escalated" não tem aresta. */
export const REVIEW_GRAPH: FlowGraph = {
  nodes: [
    { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
    { id: "orch", type: "orchestrator", label: "Diagnóstico", position: { x: 0, y: 100 }, config: { orchestratorId: "33333333-3333-4333-8333-333333333333", instruction: "Analise" } },
    { id: "review", type: "human_review", label: "Revisão do supervisor", position: { x: 0, y: 200 }, config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, contentSource: "nodeOutputs.orch", instruction: "Avalie a recorrência." } },
    { id: "end-a", type: "end", label: "Fim", position: { x: 0, y: 300 }, config: {} },
    { id: "end-r", type: "end", label: "Fim", position: { x: 100, y: 300 }, config: {} },
  ],
  edges: [
    { id: "e1", source: "trigger", sourceHandle: "always", target: "orch" },
    { id: "e2", source: "orch", sourceHandle: "always", target: "review" },
    { id: "e3", source: "review", sourceHandle: "approved", target: "end-a" },
    { id: "e4", source: "review", sourceHandle: "rejected", target: "end-r" },
  ],
} as FlowGraph

type Enrollment = { id: string; status: string; currentNodeId: string; nodeOutputs: Record<string, unknown>; versionId: string; workflowName: string; operatorId: string | null }
type Alert = { id: string; recipientId: string; organizationId: string; status: string; createdAt: string; caseId: string | null; enrollmentId: string; nodeId: string }

/** Estado mutável mínimo para os testes: alertas endereçados + execuções reais. `submit` muda a
 * execução do mesmo jeito que o SQL de submit-human-review-decision.ts faria. */
export class InMemoryPendingActionsRepository implements PendingActionsRepository {
  enrollments = new Map<string, Enrollment>()
  alerts: Alert[] = []
  /** Pendências de produção ("Produção não identificada") endereçadas a alguém. */
  reconciliations: WorkdayReconciliationRecord[] = []
  people = new Map<string, PendingActionPerson>()
  cases = new Map<string, ReviewCase>()
  events: (ReviewTimelineEvent & { enrollmentId: string })[] = []
  resolvedAlerts: string[] = []
  submissions: { enrollmentId: string; nodeId: string; decision: string; reviewerId: string }[] = []

  static fixture(): InMemoryPendingActionsRepository {
    const repository = new InMemoryPendingActionsRepository()
    repository.enrollments.set(ENROLLMENT, { id: ENROLLMENT, status: "waiting", currentNodeId: "review", nodeOutputs: { orch: { text: "### Diagnóstico\n\n**Qualidade** abaixo da meta." } }, versionId: VERSION, workflowName: "Qualidade recorrente", operatorId: OPERATOR })
    repository.enrollments.set(OTHER_ENROLLMENT, { id: OTHER_ENROLLMENT, status: "waiting", currentNodeId: "review", nodeOutputs: {}, versionId: VERSION, workflowName: "Qualidade recorrente", operatorId: "op-2" })
    repository.alerts.push(
      { id: "alert-1", recipientId: SUPERVISOR, organizationId: ORG, status: "OPEN", createdAt: "2026-09-14T10:00:00.000Z", caseId: "case-1", enrollmentId: ENROLLMENT, nodeId: "review" },
      { id: "alert-2", recipientId: OTHER_SUPERVISOR, organizationId: ORG, status: "OPEN", createdAt: "2026-09-14T11:00:00.000Z", caseId: null, enrollmentId: OTHER_ENROLLMENT, nodeId: "review" },
      // Órfão: execução apagada — nunca vira pendência.
      { id: "alert-3", recipientId: SUPERVISOR, organizationId: ORG, status: "OPEN", createdAt: "2026-09-13T10:00:00.000Z", caseId: null, enrollmentId: "99999999-9999-4999-8999-999999999999", nodeId: "review" },
    )
    repository.people.set(OPERATOR, { personId: OPERATOR, name: "Karoline", teamName: "Atendimento", jobTitle: "Operadora" })
    repository.people.set(SUPERVISOR, { personId: SUPERVISOR, name: "Vanessa", teamName: "Atendimento", jobTitle: "Supervisora" })
    repository.cases.set("case-1", { title: "Qualidade abaixo da meta", summary: "Duas monitorias abaixo de 80.", evidences: [{ id: "ev-1", type: "INDICATOR", title: "Monitoria 72", description: "Nota 72 em 12/09", occurredAt: "2026-09-12T10:00:00.000Z" }] })
    repository.events.push({ enrollmentId: ENROLLMENT, eventType: "human_review_requested", nodeId: "review", createdAt: "2026-09-14T10:00:00.000Z" })
    return repository
  }

  /** Lista: da execução, só o que foi gravado no próprio nó de revisão (como o SQL) — o Execution Context só no detalhe. */
  private toRow(alert: Alert): ReviewAlertRow {
    const enrollment = this.enrollments.get(alert.enrollmentId)
    return {
      alertId: alert.id,
      alertStatus: alert.status,
      requestedAt: alert.createdAt,
      caseId: alert.caseId,
      enrollmentId: alert.enrollmentId,
      nodeId: alert.nodeId,
      enrollment: enrollment ? { status: enrollment.status, currentNodeId: enrollment.currentNodeId, reviewOutput: enrollment.nodeOutputs[alert.nodeId] ?? null, versionId: enrollment.versionId, workflowName: enrollment.workflowName, operatorId: enrollment.operatorId } : null,
    }
  }

  /** Mesma definição do SQL: aviso vivo + execução em `waiting` no nó de revisão. */
  private isPending(alert: Alert): boolean {
    const enrollment = this.enrollments.get(alert.enrollmentId)
    return ["OPEN", "SEEN", "ACKNOWLEDGED"].includes(alert.status) && Boolean(enrollment && enrollment.status === "waiting" && enrollment.currentNodeId === alert.nodeId)
  }

  /** Quantas vezes a lista/sino leu revisões, e quais avisos pediu — o sino só pode pedir os que está mostrando. */
  reviewListReads: (readonly string[] | null)[] = []

  async loadReviewAlerts(viewerId: string, organizationId: string, options: { alertIds?: readonly string[] } = {}): Promise<ReviewAlertRow[]> {
    this.reviewListReads.push(options.alertIds ?? null)
    return this.alerts.filter((alert) => alert.recipientId === viewerId && alert.organizationId === organizationId && (!options.alertIds || options.alertIds.includes(alert.id))).map((alert) => this.toRow(alert))
  }

  async loadReviewAlert(viewerId: string, organizationId: string, enrollmentId: string, nodeId: string): Promise<ReviewAlertDetailRow | null> {
    const alert = this.alerts.find((candidate) => candidate.recipientId === viewerId && candidate.organizationId === organizationId && candidate.enrollmentId === enrollmentId && candidate.nodeId === nodeId)
    if (!alert) return null
    const row = this.toRow(alert)
    const enrollment = this.enrollments.get(alert.enrollmentId)
    return { ...row, enrollment: row.enrollment && enrollment ? { ...row.enrollment, nodeOutputs: enrollment.nodeOutputs } : null }
  }

  async loadWorkdayReconciliations(viewerId: string, organizationId: string): Promise<WorkdayReconciliationRecord[]> {
    return this.reconciliations.filter((row) => row.recipientPersonId === viewerId && row.organizationId === organizationId && row.kind === "MISSING_EXPECTED_PRODUCTION")
  }

  async loadWorkdayReconciliation(viewerId: string, organizationId: string, reconciliationId: string): Promise<WorkdayReconciliationRecord | null> {
    return this.reconciliations.find((row) => row.recipientPersonId === viewerId && row.organizationId === organizationId && row.id === reconciliationId) ?? null
  }

  async loadGraph(versionId: string): Promise<FlowGraph | null> {
    return versionId === VERSION ? REVIEW_GRAPH : null
  }

  async loadPeople(personIds: string[]): Promise<Map<string, PendingActionPerson>> {
    return new Map(personIds.flatMap((id) => (this.people.has(id) ? [[id, this.people.get(id)!] as const] : [])))
  }

  async loadCase(caseId: string): Promise<ReviewCase | null> {
    return this.cases.get(caseId) ?? null
  }

  async loadEnrollmentEvents(enrollmentId: string): Promise<ReviewTimelineEvent[]> {
    return this.events.filter((event) => event.enrollmentId === enrollmentId).map(({ eventType, nodeId, createdAt }) => ({ eventType, nodeId, createdAt }))
  }

  async resolveAlert(alertId: string): Promise<void> {
    this.resolvedAlerts.push(alertId)
    const alert = this.alerts.find((candidate) => candidate.id === alertId)
    if (alert) alert.status = "RESOLVED"
  }

  private openReconciliations(viewerId: string, organizationId: string): WorkdayReconciliationRecord[] {
    return this.reconciliations.filter((row) => row.recipientPersonId === viewerId && row.organizationId === organizationId && row.kind === "MISSING_EXPECTED_PRODUCTION" && row.status === "OPEN")
  }

  async countPendingByOperator(viewerId: string, organizationId: string, operatorIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>()
    for (const alert of this.alerts) {
      if (alert.recipientId !== viewerId || alert.organizationId !== organizationId || !this.isPending(alert)) continue
      const operatorId = this.enrollments.get(alert.enrollmentId)?.operatorId
      if (!operatorId || !operatorIds.includes(operatorId)) continue
      counts.set(operatorId, (counts.get(operatorId) ?? 0) + 1)
    }
    for (const row of this.openReconciliations(viewerId, organizationId)) {
      if (!operatorIds.includes(row.personId)) continue
      counts.set(row.personId, (counts.get(row.personId) ?? 0) + 1)
    }
    return counts
  }

  /** Intervenções pendentes por viewer (a definição real é SQL; aqui o teste diz quais são). */
  interventionPendings = new Map<string, PendingIntervention[]>()

  async loadInterventionPendings(viewerId: string): Promise<PendingIntervention[]> {
    return this.interventionPendings.get(viewerId) ?? []
  }

  async countPending(viewerId: string, organizationId: string): Promise<number> {
    return this.alerts.filter((alert) => alert.recipientId === viewerId && alert.organizationId === organizationId && this.isPending(alert)).length + this.openReconciliations(viewerId, organizationId).length + (this.interventionPendings.get(viewerId)?.length ?? 0)
  }

  /** Simula submit-human-review-decision.ts: grava a decisão em node_outputs e retoma. */
  submit = async (input: { enrollmentId: string; nodeId: string; decision: string; reviewerId: string }): Promise<void> => {
    this.submissions.push(input)
    const enrollment = this.enrollments.get(input.enrollmentId)
    if (!enrollment || enrollment.status !== "waiting" || enrollment.currentNodeId !== input.nodeId) throw new Error("ENROLLMENT_NOT_AWAITING_DECISION")
    enrollment.nodeOutputs = { ...enrollment.nodeOutputs, [input.nodeId]: { decision: input.decision, reviewerId: input.reviewerId, decidedAt: "2026-09-15T12:00:00.000Z" } }
    enrollment.status = "active"
  }
}
