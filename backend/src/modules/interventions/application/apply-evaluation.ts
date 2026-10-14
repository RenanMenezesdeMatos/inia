import { randomUUID } from "node:crypto"
import type pg from "pg"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { Queryable } from "../../people/application/schedule-exception-service.js"
import { dispatchAlert } from "../../workflows/application/dispatch-alert.js"
import { effectiveCapabilities } from "../domain/capabilities.js"
import { buildIntelligenceReport, INTELLIGENCE_REPORT_CONTRACT, type IntelligenceReport } from "../domain/intelligence-report.js"
import { isSensitiveType } from "../domain/intervention-type.js"
import type { InterventionPlan } from "../domain/intervention-plan.js"
import { aggregateOutcome, INTERVENTION_POLICY_EVALUATOR_VERSION, referencesOf, type DecisionStatus, type PlannedDecision } from "../domain/policy-evaluation.js"
import { serializeEvaluation, type PolicyEvaluation } from "./evaluate-policy.js"

/**
 * GRAVA uma avaliação e o que ela decidiu — numa transação só: caso (reaproveitado ou novo), intervenções, relatório de
 * inteligência, avaliação (só inserção), histórico da intervenção e do caso, e os avisos do Sino. Ou tudo, ou nada.
 *
 * Idempotência: a chave (`wf:<matrícula>:<nó>` no Workflow, ou a do pedido manual) identifica a avaliação; repetir devolve a
 * MESMA avaliação e as MESMAS intervenções (retry/retomada nunca duplica nem reavalia). Concorrência: o índice único parcial
 * de identidade ativa decide quem abre — quem perde a corrida registra a decisão como EXISTING, apontando para a vencedora.
 */
export type EvidenceItem = { kind: string; ref: string; label: string; occurredAt: string | null; addedBy: string | null }
export type ExtraSource = { kind: "INTERACTION" | "INDICATOR_RESULT" | "FEEDBACK" | "CASE_EVIDENCE"; ref: string; label: string; occurredAt?: string | null }

export type ApplyEvaluationInput = {
  evaluation: PolicyEvaluation
  origin: "WORKFLOW" | "MANUAL" | "REEVALUATION"
  idempotencyKey: string
  workflow?: { workflowId: string; workflowVersionId: string | null; enrollmentId: string; nodeId: string } | null
  requestedBy?: string | null
  supersedesEvaluationId?: string | null
  reevaluationReason?: string | null
  /** Caso a reaproveitar quando é da mesma pessoa (ex.: o caso que esta execução de Workflow já abriu). */
  preferredCaseId?: string | null
  extraSources?: readonly ExtraSource[]
  /** false = só registra (reavaliação): nenhuma intervenção é aberta ou alterada; as relacionadas recebem o evento. */
  applyDecisions?: boolean
}

export type AppliedDecision = { typeKey: string; typeName: string; status: DecisionStatus; ruleKey: string; interventionId: string | null; updated: boolean; note: string | null }
export type ApplyEvaluationResult = { evaluationId: string; reportId: string | null; caseId: string | null; outcome: PolicyEvaluation["outcome"]; decisions: AppliedDecision[]; reused: boolean }

const CREATING: readonly DecisionStatus[] = ["CREATED", "PENDING_APPROVAL", "RECOMMENDED"]
const INITIAL_STATUS: Partial<Record<DecisionStatus, string>> = { CREATED: "IN_PROGRESS", PENDING_APPROVAL: "AWAITING_APPROVAL", RECOMMENDED: "PROPOSED" }
const EVIDENCE_KIND_OF: Record<string, string | null> = { FEEDBACK: "FEEDBACK", DIAGNOSIS: "DIAGNOSIS", INDICATOR_RESULT: "INDICATOR_RESULT", INTERACTION: "INTERACTION", CASE_EVIDENCE: "CASE_EVIDENCE", INTERVENTION: null, EMPLOYMENT: null }

class EvaluationAlreadyRecorded extends Error {}

async function inTransaction<T>(db: Database, work: (client: Queryable) => Promise<T>): Promise<T> {
  const client: pg.PoolClient = await db.connect()
  try {
    await client.query("begin")
    const result = await work(client)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

/** Avaliação já gravada com esta chave → o resultado de antes (sem reavaliar, sem tocar em nada). */
export async function loadRecordedEvaluation(db: Queryable | Database, organizationId: string, idempotencyKey: string): Promise<ApplyEvaluationResult | null> {
  const row = (await db.query<{ id: string; outcome: PolicyEvaluation["outcome"]; decisions: AppliedDecision[] }>(`select id, outcome, decisions from intervention_policy_evaluations where organization_id = $1 and idempotency_key = $2`, [organizationId, idempotencyKey])).rows[0]
  if (!row) return null
  const report = (await db.query<{ id: string; case_id: string }>(`select id, case_id from intervention_reports where evaluation_id = $1`, [row.id])).rows[0]
  return { evaluationId: row.id, reportId: report?.id ?? null, caseId: report?.case_id ?? null, outcome: row.outcome, decisions: row.decisions.map((decision) => ({ typeKey: decision.typeKey, typeName: decision.typeName, status: decision.status, ruleKey: decision.ruleKey, interventionId: decision.interventionId ?? null, updated: Boolean(decision.updated), note: decision.note ?? null })), reused: true }
}

async function resolveCase(tx: Queryable, input: ApplyEvaluationInput, report: { summary: string; indicatorValue: string; indicatorTarget: string }): Promise<string> {
  const { evaluation } = input
  const organizationId = evaluation.organizationId
  const personId = evaluation.person.id
  if (input.preferredCaseId) {
    const preferred = (await tx.query<{ id: string }>(`select id from supervision_cases where id = $1 and organization_id = $2 and operator_id = $3`, [input.preferredCaseId, organizationId, personId])).rows[0]
    if (preferred) return preferred.id
  }
  const active = (await tx.query<{ case_id: string }>(
    `select case_id from interventions where organization_id = $1 and person_id = $2 and subject_key = $3 and status in ('PROPOSED','AWAITING_APPROVAL','IN_PROGRESS') order by created_at desc limit 1`,
    [organizationId, personId, evaluation.subjectKey],
  )).rows[0]
  if (active) return active.case_id
  if (evaluation.indicatorCode) {
    const open = (await tx.query<{ id: string }>(
      `select id from supervision_cases where organization_id = $1 and operator_id = $2 and indicator_code = $3 and status not in ('RESOLVED', 'CLOSED') order by updated_at desc limit 1`,
      [organizationId, personId, evaluation.indicatorCode],
    )).rows[0]
    if (open) return open.id
  }
  const teamId = evaluation.person.teamId ?? (await tx.query<{ team_id: string | null }>(`select team_id from people where id = $1`, [personId])).rows[0]?.team_id
  if (!teamId) throw new DomainError(`${evaluation.person.name} não está em nenhum Grupo: o caso de supervisão precisa de um.`, "INTERVENTION_CASE_TEAM_REQUIRED", 422)
  const title = `Acompanhamento: ${evaluation.indicatorName ?? evaluation.policy.name}`
  const created = (await tx.query<{ id: string }>(
    `insert into supervision_cases (organization_id, operator_id, team_id, title, summary, status, priority, indicator_code, indicator_value, indicator_target)
     values ($1, $2, $3, $4, $5, 'ACTION_PENDING', 'P2', $6, $7, $8) returning id`,
    [organizationId, personId, teamId, title, report.summary.slice(0, 2000), evaluation.indicatorCode ?? `POLICY:${evaluation.policy.key}`, report.indicatorValue, report.indicatorTarget],
  )).rows[0]!
  await tx.query(`insert into case_timeline_events (organization_id, case_id, event_type, payload) values ($1, $2, 'CASE_OPENED_BY_POLICY', $3)`, [organizationId, created.id, JSON.stringify({ policyId: evaluation.policy.id, policyVersion: evaluation.version?.version ?? null })])
  return created.id
}

/** Conteúdo inicial determinístico conforme as capacidades — o que a política e o diagnóstico já sabem; o resto é do líder. */
async function initialContent(tx: Queryable, evaluation: PolicyEvaluation, decision: PlannedDecision, dueAt: string): Promise<{ plan: InterventionPlan; items: { kind: "TASK" | "CHECKPOINT" | "ACTIVITY"; title: string; description: string; dueAt: string | null }[] }> {
  const type = evaluation.types.get(decision.typeKey)!
  const capabilities = new Set(effectiveCapabilities(type.definition.capabilities))
  const plan: InterventionPlan = {}
  const items: { kind: "TASK" | "CHECKPOINT" | "ACTIVITY"; title: string; description: string; dueAt: string | null }[] = []
  const rule = evaluation.version!.definition.rules.find((item) => item.key === decision.ruleKey)
  if (capabilities.has("OBSERVATION")) plan.observation = { focus: `${rule?.name ?? "Observação"}${evaluation.indicatorName ? ` — ${evaluation.indicatorName}` : ""}`, until: dueAt }
  if (capabilities.has("CHECKPOINTS")) items.push({ kind: "CHECKPOINT", title: "Checkpoint de acompanhamento", description: "Registrar a leitura do indicador e do que foi feito até aqui.", dueAt })
  if (capabilities.has("TRAINING")) {
    // Indicador → diagnóstico sustentado → competência → conteúdo APROVADO → atividade: só pelo vínculo explícito da competência.
    const patternKeys = [...new Set(evaluation.diagnoses.flatMap((diagnosis) => diagnosis.patterns.map((pattern) => pattern.key)))]
    if (patternKeys.length > 0) {
      const competencies = await tx.query<{ key: string; knowledge_document_ids: string[]; activities: { key: string; title: string; description: string; documentId: string | null }[] }>(
        `select key, knowledge_document_ids, activities from competencies where organization_id = $1 and active and (practice_keys && $2::text[] or criterion_keys && $2::text[]) order by key`,
        [evaluation.organizationId, patternKeys],
      )
      const documentIds = [...new Set(competencies.rows.flatMap((row) => row.knowledge_document_ids))]
      const published = documentIds.length
        ? (await tx.query<{ id: string; title: string }>(
            `select d.id, d.title from knowledge_documents d where d.organization_id = $1 and d.id = any($2::uuid[]) and d.deleted_at is null and exists (select 1 from knowledge_versions v where v.document_id = d.id and v.status = 'PUBLISHED') order by d.title`,
            [evaluation.organizationId, documentIds],
          )).rows
        : []
      plan.competencyKeys = competencies.rows.map((row) => row.key)
      plan.contents = published.map((row) => ({ documentId: row.id, title: row.title }))
      for (const row of competencies.rows) for (const activity of row.activities) items.push({ kind: "ACTIVITY", title: activity.title, description: activity.description, dueAt })
    }
  }
  if (capabilities.has("ACTION_PLAN")) {
    const goal = evaluation.rules.flatMap((rule) => rule.trace.items).find((item) => item.type === "CONDITION" && item.kind === "INDICATOR" && item.outcome.facts.referenceKind === "GOAL")
    if (goal && goal.type === "CONDITION") plan.measurableObjective = { indicatorCode: evaluation.indicatorCode, target: `Atingir a meta vigente (${String(goal.outcome.facts.reference ?? "—")})`, by: dueAt }
  }
  return { plan, items }
}

function evidenceOf(evaluation: PolicyEvaluation, decision: PlannedDecision, evaluationId: string, extra: readonly ExtraSource[]): EvidenceItem[] {
  const evidence: EvidenceItem[] = [{ kind: "EVALUATION", ref: evaluationId, label: `Avaliação da política "${evaluation.policy.name}" v${evaluation.version?.version ?? "?"}`, occurredAt: evaluation.asOf.toISOString(), addedBy: null }]
  const rule = evaluation.rules.find((item) => item.key === decision.ruleKey)
  const references = rule && decision.mode === "MATCHED" ? referencesOf(rule.trace) : []
  for (const reference of [...references, ...extra]) {
    const kind = EVIDENCE_KIND_OF[reference.kind]
    if (!kind) continue
    if (evidence.some((item) => item.kind === kind && item.ref === reference.ref)) continue
    evidence.push({ kind, ref: reference.ref, label: reference.label, occurredAt: reference.occurredAt ?? null, addedBy: null })
  }
  return evidence
}

const ALERT_TEXT = {
  ASSIGNED: (type: string, person: string) => ({ title: `Nova intervenção: ${type}`, description: `Uma política de acompanhamento abriu "${type}" para ${person}. Você é o responsável: veja o relatório e as próximas ações no caso.` }),
  PROPOSED: (type: string, person: string) => ({ title: `Intervenção recomendada: ${type}`, description: `A política de acompanhamento recomenda "${type}" para ${person}. Aceite ou descarte com justificativa — veja o relatório no caso.` }),
  APPROVAL: (type: string, person: string) => ({ title: `Aprovação pendente: ${type}`, description: `"${type}" para ${person} aguarda sua aprovação. O relatório, as evidências e o plano estão no caso.` }),
  DECISION: (person: string) => ({ title: "Solicitação de avaliação de continuidade", description: `Foi registrada uma solicitação de avaliação de continuidade de ${person}. Ela aguarda uma decisão humana, com justificativa — a abertura não é uma decisão. O fundamento está no caso.` }),
  SIGNAL: (type: string, person: string) => ({ title: `Novo sinal: ${type}`, description: `Uma nova avaliação reforçou a intervenção "${type}" de ${person}, que continua em andamento. O novo relatório está no caso.` }),
}

async function notify(tx: Queryable, input: { organizationId: string; caseId: string; recipientIds: readonly string[]; interventionId: string; event: string; revision: number; alertType: string; title: string; description: string; severity?: "INFO" | "MEDIUM" | "HIGH" }) {
  for (const recipientId of new Set(input.recipientIds)) {
    await dispatchAlert(tx as Database, { organizationId: input.organizationId, caseId: input.caseId, recipientId, title: input.title, description: input.description, severity: input.severity ?? "MEDIUM", alertType: input.alertType, dedupeKey: `intervention:${input.interventionId}:${input.event}:${recipientId}:${input.revision}` })
  }
}

export async function recordInterventionEvent(tx: Queryable, input: { organizationId: string; interventionId: string; caseId: string; eventType: string; actorKind: "HUMAN" | "SYSTEM" | "WORKFLOW"; actorId: string | null; fromStatus: string | null; toStatus: string | null; payload?: Record<string, unknown> }) {
  await tx.query(
    `insert into intervention_events (organization_id, intervention_id, event_type, actor_kind, actor_id, from_status, to_status, payload) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [input.organizationId, input.interventionId, input.eventType, input.actorKind, input.actorId, input.fromStatus, input.toStatus, JSON.stringify(input.payload ?? {})],
  )
  // O caso é o agregador do histórico: cada passo da intervenção aparece também na linha do tempo dele.
  await tx.query(`insert into case_timeline_events (organization_id, case_id, event_type, actor_id, payload) values ($1,$2,$3,$4,$5)`, [input.organizationId, input.caseId, `INTERVENTION_${input.eventType}`, input.actorId, JSON.stringify({ interventionId: input.interventionId, fromStatus: input.fromStatus, toStatus: input.toStatus, ...(input.payload ?? {}) })])
}

const caseNumber = (value: unknown) => (typeof value === "number" ? (Number.isInteger(value) ? String(value) : value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })) : value === null || value === undefined ? "—" : String(value))

/**
 * "Indicador impactado" e "Meta" do caso aberto pela política: o fato do indicador numa regra que DECIDIU (nunca de uma regra
 * não atendida), dito como ele é — valor medido, quartil, recorrência ou contagem. A meta só entra quando a comparação foi
 * contra a meta vigente; limiar de recorrência ou de contagem não é meta.
 */
function firstIndicatorFacts(evaluation: PolicyEvaluation): { value: string; target: string } {
  const decidedRules = new Set(evaluation.decisions.flatMap((decision) => [decision.ruleKey, ...decision.alsoRequestedBy]))
  for (const rule of evaluation.rules) {
    if (!decidedRules.has(rule.key)) continue
    for (const item of rule.trace.items) {
      if (item.type !== "CONDITION" || item.kind !== "INDICATOR" || item.outcome.status === "INCONCLUSIVE") continue
      const facts = item.outcome.facts
      switch (facts.kind) {
        case "historical_aggregate":
          if (facts.changeMode === "PERCENT") return { value: `variação de ${caseNumber(facts.percentChange)}%`, target: "—" }
          return { value: caseNumber(facts.value), target: facts.referenceKind === "GOAL" ? caseNumber(facts.reference) : "—" }
        case "historical_count":
          return { value: `${caseNumber(facts.count)} ocorrência(s)`, target: "—" }
        case "performance": {
          const quartile = String(facts.metric).endsWith("QUARTILE") && typeof facts.value === "number"
          return { value: quartile ? `Q${facts.value}` : caseNumber(facts.value), target: "—" }
        }
        case "performance_recurrence":
          return { value: `${String(facts.matchQuartile)} em ${caseNumber(facts.matchCount)} de ${caseNumber(facts.totalPeriods)} fechamentos`, target: "—" }
      }
    }
  }
  return { value: "—", target: "—" }
}

export async function applyEvaluation(db: Database, input: ApplyEvaluationInput): Promise<ApplyEvaluationResult> {
  const { evaluation } = input
  const organizationId = evaluation.organizationId
  const recorded = await loadRecordedEvaluation(db, organizationId, input.idempotencyKey)
  if (recorded) return recorded
  const apply = input.applyDecisions !== false
  if (apply) {
    for (const decision of evaluation.decisions) {
      const problem = CREATING.includes(decision.status) ? evaluation.assignments.get(decision.typeKey)?.problem : null
      if (problem) throw new DomainError(problem, "INTERVENTION_ASSIGNMENT_UNRESOLVED", 422)
    }
  }
  const actorKind = input.origin === "WORKFLOW" ? "WORKFLOW" : input.requestedBy ? "HUMAN" : "SYSTEM"
  const actorId = actorKind === "HUMAN" ? (input.requestedBy ?? null) : null
  try {
    return await inTransaction(db, async (tx) => {
      const evaluationId = randomUUID()
      const needsReport = evaluation.decisions.length > 0
      const reportId = needsReport ? randomUUID() : null
      const facts = firstIndicatorFacts(evaluation)
      const preliminary = needsReport ? `${evaluation.person.name}: ${evaluation.justification.split("\n")[0]}` : ""
      let caseId: string | null = null
      if (needsReport) {
        caseId = input.origin === "REEVALUATION" && input.supersedesEvaluationId
          ? ((await tx.query<{ case_id: string }>(`select case_id from intervention_reports where evaluation_id = $1`, [input.supersedesEvaluationId])).rows[0]?.case_id ?? null)
          : null
        caseId ??= await resolveCase(tx, input, { summary: preliminary, indicatorValue: facts.value, indicatorTarget: facts.target })
      }

      const applied: AppliedDecision[] = []
      const interventionIds = new Map<string, string | null>()
      const notifications: (() => Promise<void>)[] = []
      for (const decision of evaluation.decisions) {
        const type = evaluation.types.get(decision.typeKey)
        let status = decision.status
        let interventionId: string | null = decision.existingInterventionId
        let note = decision.note
        if (apply && CREATING.includes(decision.status) && type && caseId) {
          const assignment = evaluation.assignments.get(decision.typeKey)!
          const sensitive = isSensitiveType(type.definition)
          const content = await initialContent(tx, evaluation, decision, assignment.dueAt)
          const initialStatus = INITIAL_STATUS[decision.status]!
          const rule = evaluation.version!.definition.rules.find((item) => item.key === decision.ruleKey)
          const inserted = (await tx.query<{ id: string }>(
            `insert into interventions (organization_id, person_id, case_id, type_id, type_version_id, type_key, subject_key, indicator_code, policy_id, policy_version_id, evaluation_id, report_id, rule_key,
                                        origin, workflow_id, workflow_version_id, enrollment_id, node_id, opened_by, responsible_id, approver_id, approval_recipient_ids, status, sensitive, reason,
                                        initial_situation, evidence, plan, due_at, started_at, idempotency_key)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29, case when $23 = 'IN_PROGRESS' then now() else null end, $30)
             on conflict (organization_id, person_id, type_id, subject_key) where status in ('PROPOSED','AWAITING_APPROVAL','IN_PROGRESS') do nothing
             returning id`,
            [
              organizationId, evaluation.person.id, caseId, type.typeId, type.versionId, type.key, evaluation.subjectKey, evaluation.indicatorCode, evaluation.policy.id, evaluation.version!.id, evaluationId, reportId, decision.ruleKey,
              input.origin === "WORKFLOW" ? "WORKFLOW" : "MANUAL", input.workflow?.workflowId ?? null, input.workflow?.workflowVersionId ?? null, input.workflow?.enrollmentId ?? null, input.workflow?.nodeId ?? null, actorId,
              assignment.responsible!.personId, assignment.approver?.personId ?? null, assignment.approvalRecipientIds, initialStatus, sensitive,
              `${rule?.name ?? decision.ruleKey}: ${rule?.justification ?? ""}`.slice(0, 2000),
              JSON.stringify({ asOf: evaluation.asOf.toISOString(), evaluationId, facts: referencesOf(evaluation.rules.find((item) => item.key === decision.ruleKey)!.trace).map((reference) => reference.label), justification: evaluation.justification }),
              JSON.stringify(evidenceOf(evaluation, decision, evaluationId, input.extraSources ?? [])), JSON.stringify(content.plan), assignment.dueAt, `eval:${evaluationId}:${type.key}`,
            ],
          )).rows[0]
          if (inserted) {
            interventionId = inserted.id
            for (const [position, item] of content.items.entries()) {
              // Atividade de treinamento é feita pelo colaborador; checkpoint e tarefa ficam com o responsável definir.
              await tx.query(`insert into intervention_items (organization_id, intervention_id, kind, title, description, owner_id, due_at, position) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [organizationId, inserted.id, item.kind, item.title, item.description, item.kind === "ACTIVITY" ? evaluation.person.id : null, item.dueAt, position])
            }
            await recordInterventionEvent(tx, { organizationId, interventionId: inserted.id, caseId, eventType: "OPENED", actorKind, actorId, fromStatus: null, toStatus: initialStatus, payload: { evaluationId, reportId, ruleKey: decision.ruleKey, decision: decision.status, typeVersion: type.version, policyVersion: evaluation.version!.version } })
            const id = inserted.id
            const person = evaluation.person.name
            notifications.push(async () => {
              const text = decision.status === "RECOMMENDED" ? ALERT_TEXT.PROPOSED(type.definition.name, person) : ALERT_TEXT.ASSIGNED(type.definition.name, person)
              await notify(tx, { organizationId, caseId: caseId!, recipientIds: [assignment.responsible!.personId], interventionId: id, event: "ASSIGNED", revision: 0, alertType: "INTERVENTION_ASSIGNED", ...text })
              if (decision.status === "PENDING_APPROVAL") {
                const approvalText = sensitive ? ALERT_TEXT.DECISION(person) : ALERT_TEXT.APPROVAL(type.definition.name, person)
                await notify(tx, { organizationId, caseId: caseId!, recipientIds: assignment.approvalRecipientIds, interventionId: id, event: "APPROVAL", revision: 0, alertType: sensitive ? "INTERVENTION_DECISION_REQUESTED" : "INTERVENTION_APPROVAL_REQUESTED", severity: "HIGH", ...approvalText })
              }
            })
          } else {
            // Outra avaliação (outro Workflow, outra política) abriu a mesma identidade no mesmo instante: vale a dela.
            const winner = (await tx.query<{ id: string }>(`select id from interventions where organization_id = $1 and person_id = $2 and type_id = $3 and subject_key = $4 and status in ('PROPOSED','AWAITING_APPROVAL','IN_PROGRESS')`, [organizationId, evaluation.person.id, type.typeId, evaluation.subjectKey])).rows[0]
            status = "EXISTING"
            interventionId = winner?.id ?? null
            note = "Uma intervenção igual foi aberta ao mesmo tempo por outra avaliação: esta registrou a existente."
          }
        } else if (apply && decision.status === "EXISTING" && decision.updated && decision.existingInterventionId && caseId) {
          const current = (await tx.query<{ id: string; case_id: string; status: string; revision: number; responsible_id: string; evidence: EvidenceItem[] }>(
            `select id, case_id, status, revision, responsible_id, evidence from interventions where id = $1 and organization_id = $2 for update`,
            [decision.existingInterventionId, organizationId],
          )).rows[0]
          if (current && ["PROPOSED", "AWAITING_APPROVAL", "IN_PROGRESS"].includes(current.status)) {
            const additions = evidenceOf(evaluation, decision, evaluationId, input.extraSources ?? []).filter((item) => !current.evidence.some((existing) => existing.kind === item.kind && existing.ref === item.ref))
            await tx.query(`update interventions set signal_count = signal_count + 1, last_signal_at = now(), evidence = evidence || $3::jsonb, revision = revision + 1, updated_at = now() where id = $1 and organization_id = $2`, [current.id, organizationId, JSON.stringify(additions)])
            await recordInterventionEvent(tx, { organizationId, interventionId: current.id, caseId: current.case_id, eventType: "SIGNAL_RECEIVED", actorKind, actorId, fromStatus: current.status, toStatus: current.status, payload: { evaluationId, reportId, ruleKey: decision.ruleKey, policyVersion: evaluation.version!.version } })
            notifications.push(() => notify(tx, { organizationId, caseId: current.case_id, recipientIds: [current.responsible_id], interventionId: current.id, event: "SIGNAL", revision: current.revision + 1, alertType: "INTERVENTION_SIGNAL", severity: "INFO", ...ALERT_TEXT.SIGNAL(decision.typeName, evaluation.person.name) }))
          }
        }
        interventionIds.set(decision.typeKey, interventionId)
        applied.push({ typeKey: decision.typeKey, typeName: decision.typeName, status, ruleKey: decision.ruleKey, interventionId, updated: decision.updated, note })
      }

      // Reavaliação: nada é aberto nem alterado — as intervenções da avaliação original recebem o registro (divergência visível).
      if (!apply && input.supersedesEvaluationId) {
        const related = (await tx.query<{ id: string; case_id: string; status: string }>(`select id, case_id, status from interventions where evaluation_id = $1 and organization_id = $2`, [input.supersedesEvaluationId, organizationId])).rows
        for (const intervention of related) {
          await recordInterventionEvent(tx, { organizationId, interventionId: intervention.id, caseId: intervention.case_id, eventType: "REEVALUATED", actorKind, actorId, fromStatus: intervention.status, toStatus: intervention.status, payload: { evaluationId, supersedes: input.supersedesEvaluationId, outcome: evaluation.outcome, reason: input.reevaluationReason ?? null } })
        }
      }

      // Resultado agregado das decisões FINAIS (uma corrida perdida vira EXISTING) — mesma regra fixa do avaliador.
      const finalDecisions = evaluation.decisions.map((decision) => ({ ...decision, status: applied.find((item) => item.typeKey === decision.typeKey)?.status ?? decision.status }))
      const finalOutcome = evaluation.outcome === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : aggregateOutcome(evaluation.selection, finalDecisions)
      const serialized = serializeEvaluation(evaluation)
      const inserted = await tx.query(
        `insert into intervention_policy_evaluations (id, organization_id, policy_id, policy_version_id, person_id, origin, workflow_id, workflow_version_id, enrollment_id, node_id, requested_by, as_of, outcome, evaluator_version, facts, rules, decisions, justification, supersedes_evaluation_id, reevaluation_reason, idempotency_key)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) on conflict (organization_id, idempotency_key) do nothing`,
        [
          evaluationId, organizationId, evaluation.policy.id, evaluation.version?.id ?? null, evaluation.person.id, input.origin, input.workflow?.workflowId ?? null, input.workflow?.workflowVersionId ?? null, input.workflow?.enrollmentId ?? null, input.workflow?.nodeId ?? null,
          input.requestedBy ?? null, evaluation.asOf, finalOutcome, INTERVENTION_POLICY_EVALUATOR_VERSION,
          JSON.stringify({ subject: serialized.person, asOf: serialized.asOf, timeZone: serialized.timeZone, subjectKey: serialized.subjectKey, indicatorCode: serialized.indicatorCode, notApplicableReason: serialized.notApplicableReason, recommendOnly: serialized.recommendOnly, priorInterventions: evaluation.priorInterventions, diagnoses: evaluation.diagnoses, extraSources: input.extraSources ?? [] }),
          JSON.stringify({ selection: serialized.selection, rules: serialized.rules }),
          JSON.stringify(applied.map((decision) => ({ ...decision, ...(() => { const planned = serialized.decisions.find((item) => item.typeKey === decision.typeKey); return planned ? { mode: planned.mode, effect: planned.effectiveEffect, alsoRequestedBy: planned.alsoRequestedBy, assignment: planned.assignment, typeVersion: planned.typeVersion, plannedStatus: planned.status } : {} })() }))),
          evaluation.justification, input.supersedesEvaluationId ?? null, input.reevaluationReason ?? null, input.idempotencyKey,
        ],
      )
      if (inserted.rowCount === 0) throw new EvaluationAlreadyRecorded()

      if (needsReport && caseId) {
        const report: IntelligenceReport = buildIntelligenceReport({
          asOf: evaluation.asOf,
          subject: { personId: evaluation.person.id, personName: evaluation.person.name, teamName: evaluation.person.teamName, indicatorCode: evaluation.indicatorCode, indicatorName: evaluation.indicatorName },
          policy: { id: evaluation.policy.id, key: evaluation.policy.key, name: evaluation.policy.name, version: evaluation.version!.version, versionId: evaluation.version!.id, effectiveFrom: evaluation.version!.effectiveFrom, matchStrategy: evaluation.version!.definition.matchStrategy },
          definition: evaluation.version!.definition,
          rules: evaluation.rules,
          selection: evaluation.selection,
          decisions: evaluation.decisions.map((decision) => ({ ...decision, status: applied.find((item) => item.typeKey === decision.typeKey)?.status ?? decision.status, note: applied.find((item) => item.typeKey === decision.typeKey)?.note ?? decision.note })),
          outcome: finalOutcome,
          types: evaluation.types,
          assignments: new Map([...evaluation.assignments].map(([key, value]) => [key, { responsible: value.responsible, approver: value.approver, dueAt: value.dueAt }])),
          interventionIds,
          priorInterventions: evaluation.priorInterventions,
          diagnoses: evaluation.diagnoses,
          extraSources: input.extraSources ?? [],
        })
        await tx.query(`insert into intervention_reports (id, organization_id, evaluation_id, case_id, person_id, contract_version, structured) values ($1,$2,$3,$4,$5,$6,$7)`, [reportId, organizationId, evaluationId, caseId, evaluation.person.id, INTELLIGENCE_REPORT_CONTRACT, JSON.stringify(report)])
        await tx.query(`insert into case_timeline_events (organization_id, case_id, event_type, actor_id, payload) values ($1,$2,'INTERVENTION_REPORT_CREATED',$3,$4)`, [organizationId, caseId, actorId, JSON.stringify({ reportId, evaluationId, outcome: finalOutcome })])
        await tx.query(`update supervision_cases set updated_at = now() where id = $1`, [caseId])
      }
      for (const send of notifications) await send()
      return { evaluationId, reportId, caseId, outcome: finalOutcome, decisions: applied, reused: false }
    })
  } catch (error) {
    // Duas execuções com a mesma chave ao mesmo tempo: a outra gravou primeiro; esta devolve o que ficou gravado.
    if (error instanceof EvaluationAlreadyRecorded) {
      const winner = await loadRecordedEvaluation(db, organizationId, input.idempotencyKey)
      if (winner) return winner
    }
    throw error
  }
}
