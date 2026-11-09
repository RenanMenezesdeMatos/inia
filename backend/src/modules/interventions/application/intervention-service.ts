import { knowledgeAvailableSql } from "../../knowledge/application/live-knowledge-version.js"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AccessContext } from "../../access/domain/access-decision.js"
import type { Queryable } from "../../people/application/schedule-exception-service.js"
import { dispatchAlert } from "../../workflows/application/dispatch-alert.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { resolveByRoleChain } from "../../workflows/application/enrollment-subject.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { CAPABILITY_DEFINITIONS, EVIDENCE_KIND_LABELS, effectiveCapabilities, type EvidenceKind } from "../domain/capabilities.js"
import { reportNarrativeSchema, type IntelligenceReport, type ReportNarrative } from "../domain/intelligence-report.js"
import { interventionPlanSchema, planReadinessIssues, type InterventionPlan } from "../domain/intervention-plan.js"
import {
  authorizeCommand,
  canViewIntervention,
  completionInputSchema,
  completionIssues,
  CONTINUITY_DECISION_LABELS,
  CONTINUITY_DECISIONS,
  CONTINUITY_JUSTIFICATION_MIN,
  INTERVENTION_STATUS_LABELS,
  isActiveStatus,
  isOverdue,
  transition,
  validateFormValues,
  type ActorRelation,
  type ContinuityDecision,
  type FormValues,
  type InterventionCommand,
  type InterventionStatus,
} from "../domain/intervention-state.js"
import { isSensitiveType, type InterventionTypeDefinition } from "../domain/intervention-type.js"
import { recordInterventionEvent, type EvidenceItem } from "./apply-evaluation.js"
import { loadPublishedTypes, loadTypeVersion } from "./catalog.js"
import { sensitiveDecisionHolders } from "./evaluate-policy.js"
import { resolveResponsibleId, unresolvedResponsibleMessage } from "./responsible.js"
import { relationFor, canOpenFor, canSeeInterventionsOf } from "./intervention-access.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"

/**
 * INTERVENÇÕES — a experiência de quem executa e de quem decide. Toda leitura confere a relação do viewer (404 fora dela) e
 * toda escrita: (1) autorização pura (`authorizeCommand`), (2) transição pura (`transition`), (3) gravação com trava otimista
 * (`revision`) + evento + linha do tempo do caso + aviso, na mesma transação. Decidir uma pendência NÃO conclui a intervenção:
 * aceitar/aprovar levam à execução, que só termina com a conclusão registrada (atividades, aprendizagem e evolução separadas).
 */
export type Viewer = { organizationId: string; personId: string; access: AccessContext }

type Row = {
  id: string
  person_id: string
  person_name: string
  team_name: string | null
  case_id: string
  case_title: string
  type_key: string
  type_version_id: string
  subject_key: string
  indicator_code: string | null
  policy_id: string | null
  policy_name: string | null
  policy_version_id: string | null
  policy_version: number | null
  evaluation_id: string | null
  report_id: string | null
  rule_key: string | null
  origin: "MANUAL" | "WORKFLOW"
  workflow_id: string | null
  workflow_name: string | null
  enrollment_id: string | null
  node_id: string | null
  opened_by: string | null
  accepted_by: string | null
  responsible_id: string
  responsible_name: string
  approver_id: string | null
  approver_name: string | null
  approval_recipient_ids: string[]
  status: InterventionStatus
  sensitive: boolean
  reason: string
  initial_situation: Record<string, unknown>
  evidence: EvidenceItem[]
  plan: InterventionPlan
  form_values: FormValues
  ai_draft: unknown
  outcome: Record<string, unknown> | null
  due_at: string
  started_at: Date | null
  completed_at: Date | null
  cancelled_at: Date | null
  signal_count: number
  last_signal_at: Date
  revision: number
  created_at: Date
  updated_at: Date
}

const SELECT = `
  select i.id, i.person_id, p.name person_name, t.name team_name, i.case_id, c.title case_title, i.type_key, i.type_version_id, i.subject_key, i.indicator_code,
         i.policy_id, pol.name policy_name, i.policy_version_id, pv.version policy_version, i.evaluation_id, i.report_id, i.rule_key, i.origin, i.workflow_id, w.name workflow_name, i.enrollment_id, i.node_id,
         i.opened_by, i.accepted_by, i.responsible_id, r.name responsible_name, i.approver_id, a.name approver_name, i.approval_recipient_ids, i.status, i.sensitive, i.reason, i.initial_situation,
         i.evidence, i.plan, i.form_values, i.ai_draft, i.outcome, i.due_at::text, i.started_at, i.completed_at, i.cancelled_at, i.signal_count, i.last_signal_at, i.revision, i.created_at, i.updated_at
    from interventions i
    join people p on p.id = i.person_id
    left join teams t on t.id = p.team_id
    join supervision_cases c on c.id = i.case_id
    join people r on r.id = i.responsible_id
    left join people a on a.id = i.approver_id
    left join intervention_policies pol on pol.id = i.policy_id
    left join intervention_policy_versions pv on pv.id = i.policy_version_id
    left join workflows_all w on w.id = i.workflow_id`

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const notFound = () => new DomainError("Intervenção não encontrada.", "INTERVENTION_NOT_FOUND", 404)


async function today(db: Queryable | Database, organizationId: string, now: Date = new Date()): Promise<string> {
  return localDateOf(now, await resolveOrganizationTimezone(db as Database, organizationId))
}

async function loadRow(db: Queryable | Database, organizationId: string, id: string, lock = false): Promise<Row | null> {
  if (!isUuid(id)) return null
  return (await db.query<Row>(`${SELECT} where i.id = $1 and i.organization_id = $2${lock ? " for update of i" : ""}`, [id, organizationId])).rows[0] ?? null
}

const partiesOf = (row: Row) => ({ personId: row.person_id, responsibleId: row.responsible_id, approverId: row.approver_id, approvalRecipientIds: row.approval_recipient_ids, openedBy: row.opened_by, acceptedBy: row.accepted_by })

type ItemRow = { id: string; kind: "TASK" | "CHECKPOINT" | "ACTIVITY"; title: string; description: string; owner_id: string | null; owner_name: string | null; due_at: string | null; status: "PENDING" | "DONE" | "SKIPPED"; result: Record<string, unknown> | null; completed_at: Date | null; completed_by_name: string | null; position: number }

async function loadItems(db: Queryable | Database, interventionId: string): Promise<ItemRow[]> {
  return (await db.query<ItemRow>(
    `select it.id, it.kind, it.title, it.description, it.owner_id, o.name owner_name, it.due_at::text, it.status, it.result, it.completed_at, cb.name completed_by_name, it.position
       from intervention_items it left join people o on o.id = it.owner_id left join people cb on cb.id = it.completed_by
      where it.intervention_id = $1 order by it.position, it.created_at`,
    [interventionId],
  )).rows
}

function itemCounts(items: readonly ItemRow[]) {
  const of = (kind: ItemRow["kind"]) => items.filter((item) => item.kind === kind)
  const tasks = of("TASK")
  return {
    tasksTotal: tasks.length,
    tasksDone: tasks.filter((item) => item.status === "DONE").length,
    tasksSkipped: tasks.filter((item) => item.status === "SKIPPED").length,
    checkpointsTotal: of("CHECKPOINT").length,
    checkpointsDone: of("CHECKPOINT").filter((item) => item.status === "DONE").length,
    activitiesTotal: of("ACTIVITY").length,
    activitiesDone: of("ACTIVITY").filter((item) => item.status === "DONE").length,
  }
}

const ALL_COMMANDS: (InterventionCommand | "EDIT" | "UPDATE_ITEM" | "ADD_EVIDENCE" | "DRAFT_WITH_AI")[] = ["ACCEPT", "APPROVE", "RETURN", "DECIDE_CONTINUITY", "COMPLETE", "CANCEL", "FORWARD", "EDIT", "UPDATE_ITEM", "ADD_EVIDENCE", "DRAFT_WITH_AI"]

function availableActions(row: Row, definition: InterventionTypeDefinition, relation: ActorRelation): string[] {
  return ALL_COMMANDS.filter((command) => {
    if (authorizeCommand(command, relation, row.sensitive)) return false
    switch (command) {
      case "EDIT":
        return row.status === "PROPOSED" || row.status === "IN_PROGRESS"
      case "UPDATE_ITEM":
        return row.status === "PROPOSED" || row.status === "IN_PROGRESS"
      case "ADD_EVIDENCE":
        return isActiveStatus(row.status) && row.status !== "AWAITING_APPROVAL"
      case "DRAFT_WITH_AI":
        return definition.aiDraft && (row.status === "PROPOSED" || row.status === "IN_PROGRESS")
      default:
        return transition(command, row.status, { approvalRequired: definition.approval.required, sensitive: row.sensitive, continuityDecision: "CONTINUITY_CONFIRMED" }).ok
    }
  })
}

export type InterventionSummary = {
  id: string
  caseId: string
  caseTitle: string
  person: { id: string; name: string; teamName: string | null }
  type: { key: string; name: string; capabilities: { key: string; label: string }[] }
  indicatorCode: string | null
  status: InterventionStatus
  statusLabel: string
  sensitive: boolean
  overdue: boolean
  dueAt: string
  responsible: { id: string; name: string }
  approver: { id: string; name: string } | null
  origin: "MANUAL" | "WORKFLOW"
  policy: { id: string; name: string; version: number | null } | null
  reason: string
  createdAt: string
  updatedAt: string
  signalCount: number
}

function summaryOf(row: Row, definition: InterventionTypeDefinition, todayDate: string): InterventionSummary {
  return {
    id: row.id,
    caseId: row.case_id,
    caseTitle: row.case_title,
    person: { id: row.person_id, name: row.person_name, teamName: row.team_name },
    type: { key: row.type_key, name: definition.name, capabilities: effectiveCapabilities(definition.capabilities).map((key) => ({ key, label: CAPABILITY_DEFINITIONS[key].label })) },
    indicatorCode: row.indicator_code,
    status: row.status,
    statusLabel: row.sensitive && row.status === "AWAITING_APPROVAL" ? "Aguardando decisão humana" : INTERVENTION_STATUS_LABELS[row.status],
    sensitive: row.sensitive,
    overdue: isOverdue(row.status, row.due_at, todayDate),
    dueAt: row.due_at,
    responsible: { id: row.responsible_id, name: row.responsible_name },
    approver: row.approver_id ? { id: row.approver_id, name: row.approver_name ?? "—" } : null,
    origin: row.origin,
    policy: row.policy_id ? { id: row.policy_id, name: row.policy_name ?? "—", version: row.policy_version } : null,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    signalCount: row.signal_count,
  }
}

export type ReportView = { id: string; evaluationId: string; createdAt: string; structured: IntelligenceReport; narrative: { status: "READY" | "FAILED" | "NONE"; attempts: number; current: ReportNarrative | null; lastError: string | null; generatedAt: string | null } }

export async function loadReport(db: Queryable | Database, organizationId: string, reportId: string): Promise<ReportView | null> {
  if (!isUuid(reportId)) return null
  const report = (await db.query<{ id: string; evaluation_id: string; created_at: Date; structured: IntelligenceReport }>(`select id, evaluation_id, created_at, structured from intervention_reports where id = $1 and organization_id = $2`, [reportId, organizationId])).rows[0]
  if (!report) return null
  const attempts = (await db.query<{ status: "READY" | "FAILED"; narrative: unknown; error: string | null; created_at: Date }>(`select status, narrative, error, created_at from intervention_report_narratives where report_id = $1 order by attempt desc`, [reportId])).rows
  const ready = attempts.find((attempt) => attempt.status === "READY")
  const parsed = ready ? reportNarrativeSchema.safeParse(ready.narrative) : null
  return {
    id: report.id,
    evaluationId: report.evaluation_id,
    createdAt: report.created_at.toISOString(),
    structured: report.structured,
    narrative: { status: ready ? "READY" : attempts.length > 0 ? "FAILED" : "NONE", attempts: attempts.length, current: parsed?.success ? parsed.data : null, lastError: attempts[0]?.status === "FAILED" ? attempts[0].error : null, generatedAt: ready?.created_at.toISOString() ?? null },
  }
}

export type InterventionDetail = InterventionSummary & {
  revision: number
  initialSituation: Record<string, unknown>
  evidence: (EvidenceItem & { kindLabel: string })[]
  plan: InterventionPlan
  formValues: FormValues
  form: InterventionTypeDefinition["form"]
  completion: InterventionTypeDefinition["completion"]
  approvalRequired: boolean
  aiDraftEnabled: boolean
  aiDraft: unknown
  outcome: Record<string, unknown> | null
  items: { id: string; kind: ItemRow["kind"]; title: string; description: string; ownerId: string | null; ownerName: string | null; dueAt: string | null; status: ItemRow["status"]; result: Record<string, unknown> | null; completedAt: string | null; completedByName: string | null; position: number; overdue: boolean }[]
  counts: ReturnType<typeof itemCounts>
  events: { id: string; eventType: string; actorKind: string; actorName: string | null; fromStatus: string | null; toStatus: string | null; payload: Record<string, unknown>; createdAt: string }[]
  report: ReportView | null
  /** Relatórios de avaliações posteriores (novos sinais, reavaliações) — o fundamento original nunca é reescrito. */
  laterReports: { id: string; evaluationId: string; createdAt: string; outcome: string }[]
  availableActions: string[]
  /** O que ainda falta para aceitar (só com a intervenção PROPOSTA) — a mesma regra que o aceite aplica. */
  readiness: { path: string; code: string; message: string }[]
  continuityDecisions: { value: ContinuityDecision; label: string }[] | null
  /** Auditoria técnica (execução do Workflow) — disponível, nunca no centro da tela. */
  audit: { origin: "MANUAL" | "WORKFLOW"; workflowId: string | null; workflowName: string | null; enrollmentId: string | null; nodeId: string | null; evaluationId: string | null; ruleKey: string | null; typeVersionId: string; policyVersionId: string | null }
}

const readinessCounts = (items: readonly ItemRow[]) => ({ tasks: items.filter((item) => item.kind === "TASK").length, tasksWithOwnerAndDue: items.filter((item) => item.kind === "TASK" && item.owner_id && item.due_at).length, checkpoints: items.filter((item) => item.kind === "CHECKPOINT").length, activities: items.filter((item) => item.kind === "ACTIVITY").length })

export async function getInterventionDetail(db: Database, viewer: Viewer, interventionId: string, now: Date = new Date()): Promise<InterventionDetail> {
  const row = await loadRow(db, viewer.organizationId, interventionId)
  if (!row) throw notFound()
  const relation = await relationFor(db, viewer.access, partiesOf(row))
  if (!canViewIntervention(relation)) throw notFound()
  const definition = (await loadTypeVersion(db, viewer.organizationId, row.type_version_id))?.definition
  if (!definition) throw new DomainError("A versão do tipo desta intervenção não foi encontrada.", "INTERVENTION_TYPE_VERSION_MISSING", 500)
  const todayDate = await today(db, viewer.organizationId, now)
  const [items, events, report, laterReports] = await Promise.all([
    loadItems(db, row.id),
    db.query<{ id: string; event_type: string; actor_kind: string; actor_name: string | null; from_status: string | null; to_status: string | null; payload: Record<string, unknown>; created_at: Date }>(
      `select e.id, e.event_type, e.actor_kind, p.name actor_name, e.from_status, e.to_status, e.payload, e.created_at from intervention_events e left join people p on p.id = e.actor_id where e.intervention_id = $1 order by e.created_at, e.id`,
      [row.id],
    ),
    row.report_id ? loadReport(db, viewer.organizationId, row.report_id) : Promise.resolve(null),
    db.query<{ id: string; evaluation_id: string; created_at: Date; outcome: string }>(
      `select r.id, r.evaluation_id, r.created_at, ev.outcome from intervention_events e join intervention_reports r on r.id = (e.payload->>'reportId')::uuid join intervention_policy_evaluations ev on ev.id = r.evaluation_id
        where e.intervention_id = $1 and e.event_type in ('SIGNAL_RECEIVED') and e.payload ? 'reportId' and e.payload->>'reportId' is not null order by r.created_at`,
      [row.id],
    ),
  ])
  return {
    ...summaryOf(row, definition, todayDate),
    revision: row.revision,
    initialSituation: row.initial_situation,
    evidence: row.evidence.map((item) => ({ ...item, kindLabel: EVIDENCE_KIND_LABELS[item.kind as EvidenceKind] ?? item.kind })),
    plan: row.plan,
    formValues: row.form_values,
    form: definition.form,
    completion: definition.completion,
    approvalRequired: definition.approval.required,
    aiDraftEnabled: definition.aiDraft,
    aiDraft: row.ai_draft,
    outcome: row.outcome,
    items: items.map((item) => ({ id: item.id, kind: item.kind, title: item.title, description: item.description, ownerId: item.owner_id, ownerName: item.owner_name, dueAt: item.due_at, status: item.status, result: item.result, completedAt: item.completed_at?.toISOString() ?? null, completedByName: item.completed_by_name, position: item.position, overdue: item.status === "PENDING" && item.due_at !== null && item.due_at < todayDate })),
    counts: itemCounts(items),
    events: events.rows.map((event) => ({ id: event.id, eventType: event.event_type, actorKind: event.actor_kind, actorName: event.actor_name, fromStatus: event.from_status, toStatus: event.to_status, payload: event.payload, createdAt: event.created_at.toISOString() })),
    report,
    laterReports: laterReports.rows.filter((item) => item.id !== row.report_id).map((item) => ({ id: item.id, evaluationId: item.evaluation_id, createdAt: item.created_at.toISOString(), outcome: item.outcome })),
    availableActions: availableActions(row, definition, relation),
    readiness: row.status === "PROPOSED" ? planReadinessIssues(definition, interventionPlanSchema.parse(row.plan), readinessCounts(items), row.evidence.length) : [],
    continuityDecisions: row.sensitive ? CONTINUITY_DECISIONS.map((value) => ({ value, label: CONTINUITY_DECISION_LABELS[value] })) : null,
    audit: { origin: row.origin, workflowId: row.workflow_id, workflowName: row.workflow_name, enrollmentId: row.enrollment_id, nodeId: row.node_id, evaluationId: row.evaluation_id, ruleKey: row.rule_key, typeVersionId: row.type_version_id, policyVersionId: row.policy_version_id },
  }
}

async function summariesFor(db: Database, viewer: Viewer, rows: Row[], now: Date): Promise<InterventionSummary[]> {
  const todayDate = await today(db, viewer.organizationId, now)
  const definitions = new Map<string, InterventionTypeDefinition>()
  const result: InterventionSummary[] = []
  for (const row of rows) {
    if (!definitions.has(row.type_version_id)) {
      const version = await loadTypeVersion(db, viewer.organizationId, row.type_version_id)
      if (version) definitions.set(row.type_version_id, version.definition)
    }
    const definition = definitions.get(row.type_version_id)
    if (definition) result.push(summaryOf(row, definition, todayDate))
  }
  return result
}

/** Intervenções + relatórios de um caso (o caso concentra análise, intervenções, evidências e histórico). */
export async function listCaseInterventions(db: Database, viewer: Viewer, caseId: string, now: Date = new Date()) {
  if (!isUuid(caseId)) throw new DomainError("Caso não encontrado.", "CASE_NOT_FOUND", 404)
  const owner = (await db.query<{ operator_id: string }>(`select operator_id from supervision_cases where id = $1 and organization_id = $2`, [caseId, viewer.organizationId])).rows[0]
  if (!owner || !(await canSeeInterventionsOf(db, viewer.access, owner.operator_id))) throw new DomainError("Caso não encontrado.", "CASE_NOT_FOUND", 404)
  const rows = (await db.query<Row>(`${SELECT} where i.organization_id = $1 and i.case_id = $2 order by i.created_at desc`, [viewer.organizationId, caseId])).rows
  const reports = (await db.query<{ id: string; created_at: Date; outcome: string; policy_name: string; version: number | null }>(
    `select r.id, r.created_at, ev.outcome, pol.name policy_name, pv.version from intervention_reports r join intervention_policy_evaluations ev on ev.id = r.evaluation_id join intervention_policies pol on pol.id = ev.policy_id left join intervention_policy_versions pv on pv.id = ev.policy_version_id
      where r.organization_id = $1 and r.case_id = $2 order by r.created_at desc`,
    [viewer.organizationId, caseId],
  )).rows
  return { interventions: await summariesFor(db, viewer, rows, now), reports: reports.map((report) => ({ id: report.id, createdAt: report.created_at.toISOString(), outcome: report.outcome, policyName: report.policy_name, policyVersion: report.version })) }
}

/** Intervenções de um colaborador (ficha) — em andamento primeiro. */
export async function listPersonInterventions(db: Database, viewer: Viewer, personId: string, now: Date = new Date()): Promise<InterventionSummary[]> {
  if (!isUuid(personId) || !(await canSeeInterventionsOf(db, viewer.access, personId))) throw new DomainError("Colaborador não encontrado.", "PERSON_NOT_FOUND", 404)
  const rows = (await db.query<Row>(`${SELECT} where i.organization_id = $1 and i.person_id = $2 order by (i.status in ('PROPOSED','AWAITING_APPROVAL','IN_PROGRESS')) desc, i.created_at desc limit 100`, [viewer.organizationId, personId])).rows
  return summariesFor(db, viewer, rows, now)
}

/**
 * PENDÊNCIAS de intervenção — UMA definição (lista, contador e sino usam a mesma): ação requerida do viewer AGORA.
 *  - proposta endereçada a ele como responsável (aceitar ou descartar);
 *  - aprovação/decisão endereçada a ele (a permissão é conferida de novo na decisão);
 *  - em execução sob a responsabilidade dele com prazo vencido/do dia ou tarefa/checkpoint vencendo.
 * Em execução sem nada vencendo NÃO é pendência: continua no caso e na ficha.
 */
export function pendingInterventionsCondition(alias: string, viewerParam: string, todayParam: string): string {
  return `(
    (${alias}.status = 'PROPOSED' and ${alias}.responsible_id = ${viewerParam})
    or (${alias}.status = 'AWAITING_APPROVAL' and ${viewerParam} = any(${alias}.approval_recipient_ids) and ${alias}.person_id <> ${viewerParam})
    or (${alias}.status = 'IN_PROGRESS' and ${alias}.responsible_id = ${viewerParam} and (${alias}.due_at <= ${todayParam}::date
        or exists (select 1 from intervention_items pit where pit.intervention_id = ${alias}.id and pit.status = 'PENDING' and pit.due_at <= ${todayParam}::date)))
  )`
}

export type PendingIntervention = InterventionSummary & { pendingReason: "ACCEPT" | "APPROVE" | "DECIDE" | "EXECUTE"; pendingLabel: string }

export async function listPendingInterventions(db: Database, viewer: Pick<Viewer, "organizationId" | "personId"> & { access?: AccessContext }, now: Date = new Date()): Promise<PendingIntervention[]> {
  const todayDate = await today(db, viewer.organizationId, now)
  const rows = (await db.query<Row>(`${SELECT} where i.organization_id = $1 and ${pendingInterventionsCondition("i", "$2::uuid", "$3")} order by i.due_at, i.created_at`, [viewer.organizationId, viewer.personId, todayDate])).rows
  const summaries = await summariesFor(db, { organizationId: viewer.organizationId, personId: viewer.personId, access: viewer.access as AccessContext }, rows, now)
  return summaries.map((summary) => {
    const row = rows.find((item) => item.id === summary.id)!
    const reason: PendingIntervention["pendingReason"] = row.status === "PROPOSED" ? "ACCEPT" : row.status === "AWAITING_APPROVAL" ? (row.sensitive ? "DECIDE" : "APPROVE") : "EXECUTE"
    const label = { ACCEPT: "Aceitar ou descartar", APPROVE: "Aprovar ou devolver", DECIDE: "Decidir (avaliação de continuidade)", EXECUTE: summary.overdue ? "Atrasada — registrar andamento" : "Itens vencendo hoje" }[reason]
    return { ...summary, pendingReason: reason, pendingLabel: label }
  })
}

export async function countPendingInterventions(db: Queryable | Database, organizationId: string, personId: string, now: Date = new Date()): Promise<number> {
  const todayDate = await today(db, organizationId, now)
  return (await db.query<{ count: number }>(`select count(*)::int count from interventions i where i.organization_id = $1 and ${pendingInterventionsCondition("i", "$2::uuid", "$3")}`, [organizationId, personId, todayDate])).rows[0]?.count ?? 0
}

// ---------------------------------------------------------------------------------------------
// COMANDOS
// ---------------------------------------------------------------------------------------------

type CommandContext = { row: Row; definition: InterventionTypeDefinition; relation: ActorRelation; tx: Queryable; items: ItemRow[] }

/** Esqueleto comum: trava a linha, confere a revisão esperada, autoriza e devolve o detalhe atualizado. */
async function runCommand(db: Database, viewer: Viewer, interventionId: string, command: Parameters<typeof authorizeCommand>[0], expectedRevision: number | undefined, work: (context: CommandContext) => Promise<void>): Promise<InterventionDetail> {
  await inTransaction(db, async (tx) => {
    const row = await loadRow(tx, viewer.organizationId, interventionId, true)
    if (!row) throw notFound()
    const relation = await relationFor(tx, viewer.access, partiesOf(row))
    if (!canViewIntervention(relation)) throw notFound()
    if (expectedRevision !== undefined && expectedRevision !== row.revision) throw new DomainError("A intervenção mudou desde que você abriu. Atualize e tente de novo.", "INTERVENTION_CONCURRENT_CHANGE", 409)
    const denial = authorizeCommand(command, relation, row.sensitive)
    if (denial) throw new DomainError(denial.message, denial.code, denial.status)
    const definition = (await loadTypeVersion(tx, viewer.organizationId, row.type_version_id))?.definition
    if (!definition) throw new DomainError("A versão do tipo desta intervenção não foi encontrada.", "INTERVENTION_TYPE_VERSION_MISSING", 500)
    await work({ row, definition, relation, tx, items: await loadItems(tx, row.id) })
  })
  return getInterventionDetail(db, viewer, interventionId)
}

function nextStatus(command: InterventionCommand, row: Row, definition: InterventionTypeDefinition, continuityDecision?: ContinuityDecision): InterventionStatus {
  const result = transition(command, row.status, { approvalRequired: definition.approval.required, sensitive: row.sensitive, ...(continuityDecision ? { continuityDecision } : {}) })
  if (!result.ok) throw new DomainError(result.denial.message, result.denial.code, result.denial.status)
  return result.to
}

async function alert(tx: Queryable, input: { organizationId: string; caseId: string; interventionId: string; recipientIds: readonly string[]; event: string; revision: number; alertType: string; title: string; description: string; severity?: "INFO" | "MEDIUM" | "HIGH" }) {
  for (const recipientId of new Set(input.recipientIds)) {
    await dispatchAlert(tx as Database, { organizationId: input.organizationId, caseId: input.caseId, recipientId, title: input.title, description: input.description, severity: input.severity ?? "MEDIUM", alertType: input.alertType, dedupeKey: `intervention:${input.interventionId}:${input.event}:${recipientId}:${input.revision}` })
  }
}

async function resolveOpenAlerts(tx: Queryable, organizationId: string, interventionId: string, events: readonly string[]) {
  for (const event of events) {
    await tx.query(`update alerts set status = 'RESOLVED', resolved_at = now() where organization_id = $1 and dedupe_key like $2 and status in ('OPEN','SEEN','ACKNOWLEDGED')`, [organizationId, `intervention:${interventionId}:${event}:%`])
  }
}

async function bump(tx: Queryable, row: Row, sets: string, values: unknown[]) {
  const updated = await tx.query(`update interventions set ${sets ? `${sets}, ` : ""}revision = revision + 1, updated_at = now() where id = $1 and revision = $2`, [row.id, row.revision, ...values])
  if (updated.rowCount === 0) throw new DomainError("A intervenção mudou desde que você abriu. Atualize e tente de novo.", "INTERVENTION_CONCURRENT_CHANGE", 409)
}

const event = (viewer: Viewer, row: Row, eventType: string, toStatus: string | null, payload: Record<string, unknown> = {}) => ({ organizationId: viewer.organizationId, interventionId: row.id, caseId: row.case_id, eventType, actorKind: "HUMAN" as const, actorId: viewer.personId, fromStatus: row.status, toStatus, payload })

export async function acceptIntervention(db: Database, viewer: Viewer, interventionId: string, input: { expectedRevision?: number | undefined; justification?: string | undefined }) {
  return runCommand(db, viewer, interventionId, "ACCEPT", input.expectedRevision, async ({ row, definition, tx, items }) => {
    let plan = row.plan
    if (row.sensitive && input.justification) plan = { ...plan, continuityRequest: { justification: input.justification.trim() } }
    const issues = planReadinessIssues(definition, interventionPlanSchema.parse(plan), readinessCounts(items), row.evidence.length)
    if (issues.length > 0) throw new DomainError(issues[0]!.message, "INTERVENTION_NOT_READY", 422, { issues })
    const to = nextStatus("ACCEPT", row, definition)
    let recipients = row.approval_recipient_ids
    if (to === "AWAITING_APPROVAL" && row.sensitive) {
      // Decisão sensível: os destinatários são recalculados na hora (quem tem a permissão HOJE no escopo do colaborador).
      const person = (await tx.query<{ team_id: string | null; subteam_id: string | null }>(`select team_id, subteam_id from people where id = $1`, [row.person_id])).rows[0]
      recipients = await sensitiveDecisionHolders(tx, viewer.organizationId, { id: row.person_id, teamId: person?.team_id ?? null, subteamId: person?.subteam_id ?? null })
    }
    // Quem aceita não decide a própria proposta: sai da lista de destinatários.
    recipients = recipients.filter((id) => id !== viewer.personId)
    if (to === "AWAITING_APPROVAL" && recipients.length === 0) throw new DomainError(row.sensitive ? "Ninguém além de você tem a permissão de decisão sensível no escopo deste colaborador." : "Não há aprovador disponível para esta intervenção (além de você).", "INTERVENTION_NO_APPROVER", 422)
    await bump(tx, row, `status = $3, accepted_by = $4, plan = $5, approval_recipient_ids = $6, started_at = case when $3 = 'IN_PROGRESS' then now() else started_at end`, [to, viewer.personId, JSON.stringify(plan), recipients])
    await recordInterventionEvent(tx, event(viewer, row, "ACCEPTED", to))
    await resolveOpenAlerts(tx, viewer.organizationId, row.id, ["ASSIGNED", "RETURNED"])
    if (to === "AWAITING_APPROVAL") {
      await alert(tx, { organizationId: viewer.organizationId, caseId: row.case_id, interventionId: row.id, recipientIds: recipients, event: "APPROVAL", revision: row.revision + 1, alertType: row.sensitive ? "INTERVENTION_DECISION_REQUESTED" : "INTERVENTION_APPROVAL_REQUESTED", severity: "HIGH", title: row.sensitive ? "Solicitação de avaliação de continuidade" : `Aprovação pendente: ${definition.name}`, description: row.sensitive ? `Uma solicitação de avaliação de continuidade de ${row.person_name} aguarda decisão humana, com justificativa. A abertura não é uma decisão.` : `"${definition.name}" para ${row.person_name} aguarda sua aprovação.` })
    }
  })
}

export async function approveIntervention(db: Database, viewer: Viewer, interventionId: string, input: { expectedRevision?: number | undefined; note?: string | undefined }) {
  return runCommand(db, viewer, interventionId, "APPROVE", input.expectedRevision, async ({ row, definition, tx }) => {
    const to = nextStatus("APPROVE", row, definition)
    await bump(tx, row, `status = $3, started_at = now()`, [to])
    await recordInterventionEvent(tx, event(viewer, row, "APPROVED", to, { note: input.note?.trim() || null }))
    await resolveOpenAlerts(tx, viewer.organizationId, row.id, ["APPROVAL"])
    await alert(tx, { organizationId: viewer.organizationId, caseId: row.case_id, interventionId: row.id, recipientIds: [row.responsible_id], event: "APPROVED", revision: row.revision + 1, alertType: "INTERVENTION_APPROVED", title: `Aprovada: ${definition.name}`, description: `"${definition.name}" para ${row.person_name} foi aprovada e está em execução.` })
  })
}

export async function returnIntervention(db: Database, viewer: Viewer, interventionId: string, input: { expectedRevision?: number | undefined; reason: string }) {
  const reason = String(input.reason ?? "").trim()
  if (reason.length < 5) throw new DomainError("Diga o que precisa mudar (pelo menos 5 caracteres).", "INTERVENTION_REASON_REQUIRED", 422)
  return runCommand(db, viewer, interventionId, "RETURN", input.expectedRevision, async ({ row, definition, tx }) => {
    const to = nextStatus("RETURN", row, definition)
    await bump(tx, row, `status = $3`, [to])
    await recordInterventionEvent(tx, event(viewer, row, "RETURNED", to, { reason }))
    await resolveOpenAlerts(tx, viewer.organizationId, row.id, ["APPROVAL"])
    await alert(tx, { organizationId: viewer.organizationId, caseId: row.case_id, interventionId: row.id, recipientIds: [row.responsible_id], event: "RETURNED", revision: row.revision + 1, alertType: "INTERVENTION_RETURNED", title: `Devolvida para ajuste: ${definition.name}`, description: `"${definition.name}" de ${row.person_name} voltou para ajuste: ${reason}` })
  })
}

/**
 * Decisão da AVALIAÇÃO DE CONTINUIDADE — só humano (sessão), com a permissão sensível no escopo, nunca quem pediu, com
 * justificativa. Grava SÓ a decisão: nenhuma linha de situação funcional, cadastro ou acesso é tocada (não existe caminho).
 */
export async function decideContinuity(db: Database, viewer: Viewer, interventionId: string, input: { expectedRevision?: number | undefined; decision: ContinuityDecision; justification: string }) {
  const decision = z.enum(CONTINUITY_DECISIONS).parse(input.decision)
  const justification = String(input.justification ?? "").trim()
  if (justification.length < CONTINUITY_JUSTIFICATION_MIN) throw new DomainError(`A justificativa da decisão precisa de pelo menos ${CONTINUITY_JUSTIFICATION_MIN} caracteres.`, "CONTINUITY_JUSTIFICATION_REQUIRED", 422)
  return runCommand(db, viewer, interventionId, "DECIDE_CONTINUITY", input.expectedRevision, async ({ row, definition, tx }) => {
    const to = nextStatus("DECIDE_CONTINUITY", row, definition, decision)
    const outcome = { continuity: { decision, label: CONTINUITY_DECISION_LABELS[decision], justification, decidedBy: viewer.personId, decidedAt: new Date().toISOString(), employmentStatusChanged: false } }
    if (to === "COMPLETED") await bump(tx, row, `status = $3, outcome = $4, completed_at = now()`, [to, JSON.stringify(outcome)])
    else await bump(tx, row, `status = $3`, [to])
    await recordInterventionEvent(tx, event(viewer, row, "CONTINUITY_DECIDED", to, { decision, justification }))
    await resolveOpenAlerts(tx, viewer.organizationId, row.id, ["APPROVAL"])
    await alert(tx, { organizationId: viewer.organizationId, caseId: row.case_id, interventionId: row.id, recipientIds: [row.responsible_id], event: "DECIDED", revision: row.revision + 1, alertType: "INTERVENTION_DECIDED", title: "Avaliação de continuidade: decisão registrada", description: `Decisão sobre ${row.person_name}: ${CONTINUITY_DECISION_LABELS[decision]}. Nenhuma situação funcional foi alterada pela INIA.` })
  })
}

export async function completeIntervention(db: Database, viewer: Viewer, interventionId: string, rawInput: unknown) {
  const { expectedRevision: rawRevision, ...body } = (rawInput ?? {}) as Record<string, unknown>
  const input = completionInputSchema.parse(body)
  const expectedRevision = typeof rawRevision === "number" ? rawRevision : undefined
  return runCommand(db, viewer, interventionId, "COMPLETE", expectedRevision, async ({ row, definition, tx, items }) => {
    const to = nextStatus("COMPLETE", row, definition)
    const counts = itemCounts(items)
    const issues = completionIssues(definition, input, counts)
    if (issues.length > 0) throw new DomainError(issues[0]!.message, "INTERVENTION_NOT_COMPLETABLE", 422, { issues })
    // TRÊS registros separados: atividades (contadas aqui), aprendizagem e evolução operacional (declaradas, com leitura).
    const outcome = { activities: counts, learning: input.learning, operational: input.operational, note: input.note, completedBy: viewer.personId }
    await bump(tx, row, `status = $3, outcome = $4, form_values = $5, completed_at = now()`, [to, JSON.stringify(outcome), JSON.stringify({ ...row.form_values, ...input.formValues })])
    await recordInterventionEvent(tx, event(viewer, row, "COMPLETED", to, { operational: input.operational?.result ?? null, learning: input.learning?.result ?? null }))
    await resolveOpenAlerts(tx, viewer.organizationId, row.id, ["ASSIGNED", "APPROVED", "SIGNAL", "FORWARDED"])
  })
}

export async function cancelIntervention(db: Database, viewer: Viewer, interventionId: string, input: { expectedRevision?: number | undefined; reason: string }) {
  const reason = String(input.reason ?? "").trim()
  if (reason.length < 5) throw new DomainError("Diga por que a intervenção está sendo cancelada (pelo menos 5 caracteres).", "INTERVENTION_REASON_REQUIRED", 422)
  return runCommand(db, viewer, interventionId, "CANCEL", input.expectedRevision, async ({ row, definition, tx }) => {
    const to = nextStatus("CANCEL", row, definition)
    await bump(tx, row, `status = $3, outcome = coalesce(outcome, '{}'::jsonb) || $4::jsonb, cancelled_at = now()`, [to, JSON.stringify({ cancellation: { reason, by: viewer.personId } })])
    await recordInterventionEvent(tx, event(viewer, row, "CANCELLED", to, { reason }))
    await resolveOpenAlerts(tx, viewer.organizationId, row.id, ["ASSIGNED", "APPROVAL", "APPROVED", "SIGNAL", "RETURNED", "FORWARDED"])
  })
}

/** Encaminhamento hierárquico: a RESPONSABILIDADE passa a alguém acima na cadeia do colaborador (nunca um par ou abaixo). */
export async function forwardIntervention(db: Database, viewer: Viewer, interventionId: string, input: { expectedRevision?: number | undefined; toPersonId: string; reason: string }) {
  const reason = String(input.reason ?? "").trim()
  if (reason.length < 5) throw new DomainError("Diga por que está encaminhando (pelo menos 5 caracteres).", "INTERVENTION_REASON_REQUIRED", 422)
  if (!isUuid(String(input.toPersonId ?? ""))) throw new DomainError("Escolha para quem encaminhar.", "INTERVENTION_FORWARD_TARGET_INVALID", 422)
  return runCommand(db, viewer, interventionId, "FORWARD", input.expectedRevision, async ({ row, definition, tx }) => {
    nextStatus("FORWARD", row, definition)
    const chain = (await tx.query<{ id: string; name: string }>(
      `with recursive up as (select p.reports_to_id id, 1 depth from people p where p.id = $1 union all select x.reports_to_id, up.depth + 1 from people x join up on x.id = up.id where x.reports_to_id is not null and up.depth < 12)
       select p.id, p.name from up join people p on p.id = up.id where p.active and p.organization_id = $2`,
      [row.person_id, viewer.organizationId],
    )).rows
    const target = chain.find((person) => person.id === input.toPersonId)
    if (!target || target.id === row.responsible_id) throw new DomainError("Encaminhe para alguém acima na cadeia de gestão do colaborador (diferente do responsável atual).", "INTERVENTION_FORWARD_TARGET_INVALID", 422)
    await bump(tx, row, `responsible_id = $3`, [target.id])
    await recordInterventionEvent(tx, event(viewer, row, "FORWARDED", row.status, { from: row.responsible_id, to: target.id, reason }))
    await alert(tx, { organizationId: viewer.organizationId, caseId: row.case_id, interventionId: row.id, recipientIds: [target.id], event: "FORWARDED", revision: row.revision + 1, alertType: "INTERVENTION_FORWARDED", title: `Encaminhada a você: ${definition.name}`, description: `${row.responsible_name} encaminhou a você "${definition.name}" de ${row.person_name}: ${reason}` })
  })
}

export const planUpdateSchema = z.object({ expectedRevision: z.number().int().optional(), plan: interventionPlanSchema.optional(), formValues: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional() }).strict()

export async function updateInterventionPlan(db: Database, viewer: Viewer, interventionId: string, raw: unknown) {
  const input = planUpdateSchema.parse(raw ?? {})
  return runCommand(db, viewer, interventionId, "EDIT", input.expectedRevision, async ({ row, definition, tx }) => {
    if (row.status !== "PROPOSED" && row.status !== "IN_PROGRESS") throw new DomainError("O plano só muda enquanto a intervenção está proposta ou em execução (nunca durante a aprovação).", "INTERVENTION_PLAN_LOCKED", 409)
    const plan = input.plan ?? row.plan
    const formValues = { ...row.form_values, ...(input.formValues ?? {}) }
    const issues = validateFormValues(definition.form, formValues, { requireComplete: false })
    if (issues.length > 0) throw new DomainError(issues[0]!.message, "INTERVENTION_FORM_INVALID", 422, { issues })
    if (plan.contents?.length) {
      const published = (await tx.query<{ id: string }>(`select d.id from knowledge_documents d where d.organization_id = $1 and d.id = any($2::uuid[]) and d.deleted_at is null and ${knowledgeAvailableSql("d.id")}`, [viewer.organizationId, plan.contents.map((content) => content.documentId)])).rows
      if (published.length !== new Set(plan.contents.map((content) => content.documentId)).size) throw new DomainError("Treinamento só usa conteúdos publicados da base de conhecimento.", "TRAINING_CONTENT_NOT_APPROVED", 422)
    }
    await bump(tx, row, `plan = $3, form_values = $4`, [JSON.stringify(plan), JSON.stringify(formValues)])
    await recordInterventionEvent(tx, event(viewer, row, "PLAN_UPDATED", row.status))
  })
}

const itemInputSchema = z.object({ expectedRevision: z.number().int().optional(), kind: z.enum(["TASK", "CHECKPOINT", "ACTIVITY"]), title: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).default(""), ownerId: z.string().uuid().nullable().default(null), dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null) }).strict()

async function ownerAllowed(tx: Queryable, organizationId: string, personId: string, ownerId: string): Promise<boolean> {
  if (ownerId === personId) return true
  const chain = await tx.query(
    `with recursive up as (select reports_to_id id, 1 depth from people where id = $1 union all select x.reports_to_id, up.depth + 1 from people x join up on x.id = up.id where x.reports_to_id is not null and up.depth < 12) select 1 from up join people p on p.id = up.id where up.id = $2 and p.organization_id = $3 and p.active`,
    [personId, ownerId, organizationId],
  )
  return (chain.rowCount ?? 0) > 0
}

export async function addInterventionItem(db: Database, viewer: Viewer, interventionId: string, raw: unknown) {
  const input = itemInputSchema.parse(raw ?? {})
  return runCommand(db, viewer, interventionId, "UPDATE_ITEM", input.expectedRevision, async ({ row, definition, tx, items }) => {
    if (row.status !== "PROPOSED" && row.status !== "IN_PROGRESS") throw new DomainError("Itens só mudam com a intervenção proposta ou em execução.", "INTERVENTION_PLAN_LOCKED", 409)
    const capabilities = new Set(effectiveCapabilities(definition.capabilities))
    const allowed = { TASK: capabilities.has("TASKS"), CHECKPOINT: capabilities.has("CHECKPOINTS"), ACTIVITY: capabilities.has("TRAINING") }[input.kind]
    if (!allowed) throw new DomainError("Este tipo de intervenção não usa esse tipo de item.", "INTERVENTION_ITEM_KIND_UNSUPPORTED", 422)
    if (input.ownerId && !(await ownerAllowed(tx, viewer.organizationId, row.person_id, input.ownerId))) throw new DomainError("O responsável da tarefa precisa ser o colaborador ou alguém da cadeia de gestão dele.", "INTERVENTION_ITEM_OWNER_INVALID", 422)
    await tx.query(`insert into intervention_items (organization_id, intervention_id, kind, title, description, owner_id, due_at, position) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [viewer.organizationId, row.id, input.kind, input.title, input.description, input.ownerId, input.dueAt, items.length])
    await bump(tx, row, "", [])
    await recordInterventionEvent(tx, event(viewer, row, "ITEM_ADDED", row.status, { kind: input.kind, title: input.title }))
  })
}

const itemUpdateSchema = z.object({ expectedRevision: z.number().int().optional(), status: z.enum(["PENDING", "DONE", "SKIPPED"]), note: z.string().trim().max(2000).default(""), reading: z.string().trim().max(2000).default("") }).strict()

export async function updateInterventionItem(db: Database, viewer: Viewer, interventionId: string, itemId: string, raw: unknown) {
  const input = itemUpdateSchema.parse(raw ?? {})
  return runCommand(db, viewer, interventionId, "UPDATE_ITEM", input.expectedRevision, async ({ row, tx, items }) => {
    const item = items.find((candidate) => candidate.id === itemId)
    if (!item) throw new DomainError("Item não encontrado.", "INTERVENTION_ITEM_NOT_FOUND", 404)
    if (row.status !== "IN_PROGRESS" && input.status !== "PENDING") throw new DomainError("Itens são concluídos durante a execução.", "INTERVENTION_NOT_IN_PROGRESS", 409)
    if (item.kind === "CHECKPOINT" && input.status === "DONE" && input.reading.length < 5) throw new DomainError("Registre a leitura do checkpoint (o que foi observado e o valor do indicador).", "CHECKPOINT_READING_REQUIRED", 422)
    if (input.status === "SKIPPED" && input.note.length < 5) throw new DomainError("Diga por que o item foi dispensado.", "INTERVENTION_ITEM_SKIP_REASON", 422)
    const result = input.status === "PENDING" ? null : { note: input.note || null, reading: input.reading || null }
    await tx.query(`update intervention_items set status = $2, result = $3, completed_at = case when $2 = 'PENDING' then null else now() end, completed_by = case when $2 = 'PENDING' then null else $4::uuid end, updated_at = now() where id = $1`, [item.id, input.status, result ? JSON.stringify(result) : null, viewer.personId])
    await bump(tx, row, "", [])
    await recordInterventionEvent(tx, event(viewer, row, item.kind === "CHECKPOINT" ? "CHECKPOINT_RECORDED" : "ITEM_UPDATED", row.status, { itemId: item.id, kind: item.kind, title: item.title, status: input.status, reading: input.reading || null }))
  })
}

/** Competências ativas para o treinamento: só nome, descrição, documentos PUBLICADOS e atividades (dado de configuração). */
export async function listTrainingCompetencies(db: Queryable | Database, organizationId: string) {
  const rows = await db.query<{ key: string; name: string; description: string; indicator_codes: string[]; knowledge_document_ids: string[]; activities: { key: string; title: string; description: string; kind: string; estimatedMinutes: number | null }[] }>(
    `select key, name, description, indicator_codes, knowledge_document_ids, activities from competencies where organization_id = $1 and active order by name`,
    [organizationId],
  )
  const documentIds = [...new Set(rows.rows.flatMap((row) => row.knowledge_document_ids))]
  const published = documentIds.length
    ? new Map((await db.query<{ id: string; title: string }>(`select d.id, d.title from knowledge_documents d where d.organization_id = $1 and d.id = any($2::uuid[]) and d.deleted_at is null and ${knowledgeAvailableSql("d.id")}`, [organizationId, documentIds])).rows.map((row) => [row.id, row.title]))
    : new Map<string, string>()
  return rows.rows.map((row) => ({
    key: row.key,
    name: row.name,
    description: row.description,
    indicatorCodes: row.indicator_codes,
    contents: row.knowledge_document_ids.flatMap((id) => (published.has(id) ? [{ documentId: id, title: published.get(id)! }] : [])),
    activities: (Array.isArray(row.activities) ? row.activities : []).map((activity) => ({ title: activity.title, description: activity.description, kind: activity.kind, estimatedMinutes: activity.estimatedMinutes ?? null })),
  }))
}

const competencyApplySchema = z.object({ expectedRevision: z.number().int().optional(), competencyKey: z.string().trim().min(1).max(40) }).strict()

/**
 * Treinamento: o líder escolhe a COMPETÊNCIA (do catálogo da organização). Entram os conteúdos aprovados dela (só documentos
 * publicados) e as atividades sugeridas viram itens com prazo — sem IA. Repetir não duplica conteúdo nem atividade.
 */
export async function applyTrainingCompetency(db: Database, viewer: Viewer, interventionId: string, raw: unknown) {
  const input = competencyApplySchema.parse(raw ?? {})
  return runCommand(db, viewer, interventionId, "EDIT", input.expectedRevision, async ({ row, definition, tx, items }) => {
    if (row.status !== "PROPOSED" && row.status !== "IN_PROGRESS") throw new DomainError("O plano só muda enquanto a intervenção está proposta ou em execução (nunca durante a aprovação).", "INTERVENTION_PLAN_LOCKED", 409)
    if (!effectiveCapabilities(definition.capabilities).includes("TRAINING")) throw new DomainError("Só intervenções com treinamento usam competências.", "INTERVENTION_NOT_TRAINING", 422)
    const competency = (await listTrainingCompetencies(tx, viewer.organizationId)).find((item) => item.key === input.competencyKey)
    if (!competency) throw new DomainError("Competência não encontrada ou inativa.", "COMPETENCY_NOT_FOUND", 422)
    if (competency.contents.length === 0) throw new DomainError(`"${competency.name}" não tem conteúdo publicado na base: o treinamento só usa conteúdo aprovado.`, "TRAINING_CONTENT_NOT_APPROVED", 422)
    const plan = { ...row.plan }
    plan.competencyKeys = [...new Set([...(plan.competencyKeys ?? []), competency.key])].slice(0, 10)
    const contents = [...(plan.contents ?? [])]
    for (const content of competency.contents) if (!contents.some((item) => item.documentId === content.documentId)) contents.push(content)
    plan.contents = contents.slice(0, 20)
    const titles = new Set(items.map((item) => item.title.toLocaleLowerCase("pt-BR")))
    let position = items.length
    let added = 0
    for (const activity of competency.activities) {
      if (titles.has(activity.title.toLocaleLowerCase("pt-BR"))) continue
      const description = [activity.description, activity.estimatedMinutes ? `Tempo estimado: ${activity.estimatedMinutes} min.` : ""].filter(Boolean).join(" ")
      await tx.query(`insert into intervention_items (organization_id, intervention_id, kind, title, description, owner_id, due_at, position) values ($1,$2,'ACTIVITY',$3,$4,$5,$6,$7)`, [viewer.organizationId, row.id, activity.title, description, row.person_id, row.due_at, position])
      position += 1
      added += 1
    }
    await bump(tx, row, `plan = $3`, [JSON.stringify(plan)])
    await recordInterventionEvent(tx, event(viewer, row, "COMPETENCY_APPLIED", row.status, { competencyKey: competency.key, contents: competency.contents.length, activitiesAdded: added }))
  })
}

const evidenceInputSchema = z.object({ expectedRevision: z.number().int().optional(), kind: z.enum(["FEEDBACK", "DIAGNOSIS", "INTERACTION", "CASE_EVIDENCE"]), ref: z.string().trim().min(1).max(200) }).strict()

/** Evidência adicionada à mão: só referência a um registro VERIFICÁVEL do colaborador (nunca texto livre). */
export async function addInterventionEvidence(db: Database, viewer: Viewer, interventionId: string, raw: unknown) {
  const input = evidenceInputSchema.parse(raw ?? {})
  return runCommand(db, viewer, interventionId, "ADD_EVIDENCE", input.expectedRevision, async ({ row, tx }) => {
    let label: string | null = null
    if (input.kind === "FEEDBACK" && isUuid(input.ref)) label = (await tx.query<{ label: string }>(`select 'Feedback ' || coalesce(f.feedback_kind::text, '') || ' de ' || to_char(f.published_at, 'DD/MM/YYYY') label from feedbacks f where f.id = $1 and f.organization_id = $2 and f.operator_id = $3 and f.status in ('PUBLISHED','ACKNOWLEDGED')`, [input.ref, viewer.organizationId, row.person_id])).rows[0]?.label ?? null
    if (input.kind === "INTERACTION" && isUuid(input.ref)) label = (await tx.query<{ label: string }>(`select 'Atendimento ' || coalesce(external_id, '') || ' de ' || to_char(started_at, 'DD/MM/YYYY') label from interactions where id = $1 and organization_id = $2 and operator_id = $3`, [input.ref, viewer.organizationId, row.person_id])).rows[0]?.label ?? null
    if (input.kind === "CASE_EVIDENCE" && isUuid(input.ref)) label = (await tx.query<{ label: string }>(`select e.title label from evidences e join supervision_cases c on c.id = e.case_id where e.id = $1 and e.organization_id = $2 and c.operator_id = $3`, [input.ref, viewer.organizationId, row.person_id])).rows[0]?.label ?? null
    if (input.kind === "DIAGNOSIS") {
      const [, id] = input.ref.split(":")
      if (id && isUuid(id)) label = (await tx.query<{ label: string }>(`select 'Diagnóstico ' || indicator_code label from indicator_investigations where id = $1 and organization_id = $2 and person_id = $3 and is_current`, [id, viewer.organizationId, row.person_id])).rows[0]?.label ?? null
    }
    if (!label) throw new DomainError("Referência não encontrada para este colaborador.", "INTERVENTION_EVIDENCE_NOT_FOUND", 422)
    if (row.evidence.some((item) => item.kind === input.kind && item.ref === input.ref)) return
    const item: EvidenceItem = { kind: input.kind, ref: input.ref, label, occurredAt: null, addedBy: viewer.personId }
    await bump(tx, row, `evidence = evidence || $3::jsonb`, [JSON.stringify([item])])
    await recordInterventionEvent(tx, event(viewer, row, "EVIDENCE_ADDED", row.status, { kind: input.kind, ref: input.ref }))
  })
}

export const manualOpenSchema = z
  .object({
    personId: z.string().uuid(),
    typeKey: z.string().trim().min(1).max(40),
    indicatorCode: z.string().trim().min(1).max(40).nullable().default(null),
    reason: z.string().trim().min(10).max(2000),
    dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    caseId: z.string().uuid().nullable().default(null),
    idempotencyKey: z.string().trim().min(8).max(120),
  })
  .strict()

/** Abertura MANUAL pelo líder (ou por quem executa no escopo) — nasce PROPOSTA; o resto segue a mesma máquina de estados. */
export async function openManualIntervention(db: Database, viewer: Viewer, raw: unknown, now: Date = new Date()): Promise<InterventionDetail> {
  const input = manualOpenSchema.parse(raw ?? {})
  if (!(await canOpenFor(db, viewer.access, input.personId))) throw new DomainError("Colaborador não encontrado.", "PERSON_NOT_FOUND", 404)
  const existing = (await db.query<{ id: string }>(`select id from interventions where organization_id = $1 and idempotency_key = $2`, [viewer.organizationId, `manual:${viewer.personId}:${input.idempotencyKey}`])).rows[0]
  if (existing) return getInterventionDetail(db, viewer, existing.id, now)
  const type = (await loadPublishedTypes(db, viewer.organizationId)).get(input.typeKey)
  if (!type || !type.active) throw new DomainError("Tipo de intervenção não encontrado ou inativo.", "INTERVENTION_TYPE_NOT_FOUND", 422)
  const person = (await db.query<{ name: string; team_id: string | null; subteam_id: string | null }>(`select name, team_id, subteam_id from people where id = $1 and organization_id = $2 and active`, [input.personId, viewer.organizationId])).rows[0]
  if (!person) throw new DomainError("Colaborador não encontrado.", "PERSON_NOT_FOUND", 404)
  const responsibleId = await resolveResponsibleId(db, input.personId, type.definition.responsibleRole)
  if (!responsibleId) throw new DomainError(unresolvedResponsibleMessage(type.definition.responsibleRole, person.name, type.definition.name, "ser responsável por"), "INTERVENTION_ASSIGNMENT_UNRESOLVED", 422)
  let approverId: string | null = null
  let recipients: string[] = []
  if (type.definition.approval.required) {
    approverId = (await resolveByRoleChain(db, input.personId, [type.definition.approval.approverRole]))[0]?.id ?? null
    recipients = isSensitiveType(type.definition) ? await sensitiveDecisionHolders(db, viewer.organizationId, { id: input.personId, teamId: person.team_id, subteamId: person.subteam_id }) : approverId ? [approverId] : []
    if (isSensitiveType(type.definition) && approverId && !recipients.includes(approverId)) approverId = null
  }
  const todayDate = await today(db, viewer.organizationId, now)
  const dueAt = input.dueAt ?? new Date(Date.parse(`${todayDate}T12:00:00Z`) + type.definition.defaultDueDays * 86_400_000).toISOString().slice(0, 10)
  const subjectKey = input.indicatorCode ? `INDICATOR:${input.indicatorCode}` : "GENERAL"
  const id = await inTransaction(db, async (tx) => {
    let caseId = input.caseId ? (await tx.query<{ id: string }>(`select id from supervision_cases where id = $1 and organization_id = $2 and operator_id = $3`, [input.caseId, viewer.organizationId, input.personId])).rows[0]?.id ?? null : null
    if (!caseId) {
      if (!person.team_id) throw new DomainError(`${person.name} não está em nenhum Grupo: o caso de supervisão precisa de um.`, "INTERVENTION_CASE_TEAM_REQUIRED", 422)
      caseId = (await tx.query<{ id: string }>(
        `insert into supervision_cases (organization_id, operator_id, team_id, title, summary, status, priority, indicator_code, indicator_value, indicator_target, assignee_id) values ($1,$2,$3,$4,$5,'ACTION_PENDING','P2',$6,'—','—',$7) returning id`,
        // Título e resumo neutros: o caso é lido por quem vê Indicadores/Agents; o tipo e a justificativa ficam na intervenção (SCOPE-02).
        [viewer.organizationId, input.personId, person.team_id, `Acompanhamento: ${input.indicatorCode ?? "geral"}`, "Caso aberto para uma intervenção manual. As ações e os motivos ficam nas intervenções do colaborador.", input.indicatorCode ?? "GENERAL", responsibleId],
      )).rows[0]!.id
    }
    const interventionId = randomUUID()
    const inserted = await tx.query(
      `insert into interventions (id, organization_id, person_id, case_id, type_id, type_version_id, type_key, subject_key, indicator_code, origin, opened_by, responsible_id, approver_id, approval_recipient_ids, status, sensitive, reason, initial_situation, due_at, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'MANUAL',$10,$11,$12,$13,'PROPOSED',$14,$15,$16,$17,$18)
       on conflict (organization_id, person_id, type_id, subject_key) where status in ('PROPOSED','AWAITING_APPROVAL','IN_PROGRESS') do nothing`,
      [interventionId, viewer.organizationId, input.personId, caseId, type.typeId, type.versionId, type.key, subjectKey, input.indicatorCode, viewer.personId, responsibleId, approverId, recipients.filter((recipient) => recipient !== viewer.personId), isSensitiveType(type.definition), input.reason, JSON.stringify({ asOf: now.toISOString(), openedManually: true }), dueAt, `manual:${viewer.personId}:${input.idempotencyKey}`],
    )
    if (inserted.rowCount === 0) throw new DomainError(`${person.name} já tem "${type.definition.name}" em andamento para este assunto.`, "INTERVENTION_ALREADY_ACTIVE", 409)
    await recordInterventionEvent(tx, { organizationId: viewer.organizationId, interventionId, caseId, eventType: "OPENED", actorKind: "HUMAN", actorId: viewer.personId, fromStatus: null, toStatus: "PROPOSED", payload: { manual: true, typeVersion: type.version } })
    if (responsibleId !== viewer.personId) await alert(tx, { organizationId: viewer.organizationId, caseId, interventionId, recipientIds: [responsibleId], event: "ASSIGNED", revision: 0, alertType: "INTERVENTION_ASSIGNED", title: `Nova intervenção: ${type.definition.name}`, description: `"${type.definition.name}" foi aberta para ${person.name}. Você é o responsável.` })
    return interventionId
  })
  return getInterventionDetail(db, viewer, id, now)
}

