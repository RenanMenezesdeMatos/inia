import { DomainError } from "../../../shared/domain/domain-error.js"
import { ApplicationInvariantError } from "../../../shared/domain/execution-failure.js"
import type { ApplyEvaluationResult, ExtraSource } from "../../interventions/application/apply-evaluation.js"
import { loadPolicyHeader, loadPolicyVersion, policyVersionInForceAt } from "../../interventions/application/catalog.js"
import { evaluatePolicy } from "../../interventions/application/evaluate-policy.js"
import { OUTCOME_TEXT, type DecisionStatus, type EvaluationOutcome } from "../../interventions/domain/policy-evaluation.js"
import type { FlowNode } from "../domain/graph-schema.js"
import { resolveEnrollmentOperatorId } from "./enrollment-subject.js"
import type { ProcessContext } from "./node-handlers.js"

/**
 * Nó "Avaliar política de acompanhamento" — QUAIS intervenções cabem para o colaborador desta execução, segundo uma política
 * PUBLICADA (critérios, prazos, responsáveis e aprovações são dela; o nó não tem configuração concorrente). Reaproveita o
 * avaliador e a gravação do módulo interventions atrás do `WorkflowEffectSink` (produção grava; QA Lab simula).
 *
 * VERSÃO FIXADA no nascimento da execução: a política em vigor quando a matrícula RAIZ nasceu (o disparo). Publicações
 * posteriores valem para os próximos disparos. Retry e retomada não reavaliam: a avaliação gravada para `wf:<matrícula>:<nó>`
 * é devolvida como está (mesma versão, mesmas decisões, mesmas intervenções).
 */
export type InterventionPolicyNode = Extract<FlowNode, { type: "intervention_policy" }>

export const INTERVENTION_POLICY_NODE_OUTPUT_KIND = "INTERVENTION_POLICY_EVALUATION"

export type InterventionPolicyNodeOutput = {
  kind: typeof INTERVENTION_POLICY_NODE_OUTPUT_KIND
  policyId: string
  policyName: string
  policyVersion: number | null
  mode: InterventionPolicyNode["config"]["mode"]
  evaluationId: string
  reportId: string | null
  caseId: string | null
  /** Resultado estruturado para Conditions posteriores: agregado + POR AÇÃO (um global nunca esconde resultados diferentes). */
  structuredResult: {
    outcome: EvaluationOutcome
    outcomeLabel: string
    created: boolean
    pendingApproval: boolean
    recommended: boolean
    existing: boolean
    suppressed: boolean
    conflict: boolean
    inconclusive: boolean
    noMatch: boolean
    notApplicable: boolean
    counts: Record<DecisionStatus, number>
    /** Status por tipo de intervenção da versão (todos os tipos citados nas regras): "NOT_DECIDED" quando nenhuma regra o pediu. */
    decisionsByType: Record<string, DecisionStatus | "NOT_DECIDED">
    createdTypeKeys: string[]
    interventionIds: string[]
  }
  decisions: ApplyEvaluationResult["decisions"]
  /** Texto de leitura (justificativa reproduzível) — o mesmo da avaliação gravada. */
  text: string
}

const DECISION_STATUSES: DecisionStatus[] = ["CREATED", "PENDING_APPROVAL", "RECOMMENDED", "EXISTING", "SUPPRESSED", "CONFLICT"]

function buildOutput(node: InterventionPolicyNode, policy: { id: string; name: string }, version: { version: number; definition: { rules: { actions: { typeKey: string }[]; inconclusiveActions: { typeKey: string }[] }[] } } | null, result: ApplyEvaluationResult, text: string): InterventionPolicyNodeOutput {
  const counts = Object.fromEntries(DECISION_STATUSES.map((status) => [status, result.decisions.filter((decision) => decision.status === status).length])) as Record<DecisionStatus, number>
  const typeKeys = new Set(version?.definition.rules.flatMap((rule) => [...rule.actions, ...rule.inconclusiveActions].map((action) => action.typeKey)) ?? [])
  for (const decision of result.decisions) typeKeys.add(decision.typeKey)
  const decisionsByType = Object.fromEntries([...typeKeys].sort().map((key) => [key, result.decisions.find((decision) => decision.typeKey === key)?.status ?? "NOT_DECIDED"])) as Record<string, DecisionStatus | "NOT_DECIDED">
  return {
    kind: INTERVENTION_POLICY_NODE_OUTPUT_KIND,
    policyId: policy.id,
    policyName: policy.name,
    policyVersion: version?.version ?? null,
    mode: node.config.mode,
    evaluationId: result.evaluationId,
    reportId: result.reportId,
    caseId: result.caseId,
    structuredResult: {
      outcome: result.outcome,
      outcomeLabel: OUTCOME_TEXT[result.outcome],
      created: counts.CREATED > 0,
      pendingApproval: counts.PENDING_APPROVAL > 0,
      recommended: counts.RECOMMENDED > 0,
      existing: counts.EXISTING > 0,
      suppressed: counts.SUPPRESSED > 0,
      conflict: counts.CONFLICT > 0,
      inconclusive: result.outcome === "INCONCLUSIVE",
      noMatch: result.outcome === "NO_MATCH",
      notApplicable: result.outcome === "NOT_APPLICABLE",
      counts,
      decisionsByType,
      createdTypeKeys: result.decisions.filter((decision) => ["CREATED", "PENDING_APPROVAL", "RECOMMENDED"].includes(decision.status)).map((decision) => decision.typeKey),
      interventionIds: result.decisions.flatMap((decision) => (decision.interventionId ? [decision.interventionId] : [])),
    },
    decisions: result.decisions,
    text,
  }
}

/** Instante de nascimento da execução (matrícula RAIZ); no QA Lab a matrícula não existe no banco → o relógio simulado. */
async function bornAtOf(context: ProcessContext): Promise<Date> {
  const rootId = context.enrollment.parent_enrollment_id ?? context.enrollment.id
  const row = (await context.db.query<{ created_at: Date }>(`select created_at from workflow_enrollments where id = $1 and organization_id = $2`, [rootId, context.enrollment.organization_id])).rows[0]
  return row?.created_at ?? context.now
}

/** Registros VERIFICÁVEIS que a execução já tem (gatilho e nós de análise escolhidos) — nunca o texto gerado pela IA. */
function analysisSources(context: ProcessContext, node: InterventionPolicyNode): { sources: ExtraSource[]; caseIds: string[] } {
  const sources: ExtraSource[] = []
  const caseIds: string[] = []
  if (context.enrollment.interaction_id) sources.push({ kind: "INTERACTION", ref: context.enrollment.interaction_id, label: "Atendimento que disparou a execução" })
  if (context.enrollment.indicator_measurement_id) sources.push({ kind: "INDICATOR_RESULT", ref: `measurement:${context.enrollment.indicator_measurement_id}`, label: "Medição que disparou a execução" })
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  for (const sourceNodeId of node.config.analysisSourceNodeIds) {
    const output = context.enrollment.node_outputs[sourceNodeId]
    const label = context.graph.nodes.find((candidate) => candidate.id === sourceNodeId)?.label ?? sourceNodeId
    const visit = (value: unknown, depth: number) => {
      if (!value || typeof value !== "object" || depth > 2) return
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (key === "feedbackId" && typeof inner === "string" && uuid.test(inner)) sources.push({ kind: "FEEDBACK", ref: inner, label: `Feedback publicado por "${label}"` })
        else if (key === "caseId" && typeof inner === "string" && uuid.test(inner)) caseIds.push(inner)
        else if (key === "interactionId" && typeof inner === "string" && uuid.test(inner)) sources.push({ kind: "INTERACTION", ref: inner, label: `Atendimento analisado por "${label}"` })
        else if (inner && typeof inner === "object") visit(inner, depth + 1)
      }
    }
    visit(output, 0)
  }
  const seen = new Set<string>()
  return { sources: sources.filter((source) => (seen.has(`${source.kind}:${source.ref}`) ? false : (seen.add(`${source.kind}:${source.ref}`), true))), caseIds }
}

export async function executeInterventionPolicyNode(context: ProcessContext, node: InterventionPolicyNode): Promise<InterventionPolicyNodeOutput> {
  const organizationId = context.enrollment.organization_id
  const idempotencyKey = `wf:${context.enrollment.id}:${node.id}`
  const policy = await loadPolicyHeader(context.db, organizationId, node.config.policyId)
  if (!policy) throw new ApplicationInvariantError(`O nó "${node.label}" usa uma política de acompanhamento que não existe mais nesta organização.`)

  const recorded = await context.effects.interventions.recorded(context.db, organizationId, idempotencyKey)
  if (recorded) {
    const row = (await context.db.query<{ policy_version_id: string | null; justification: string }>(`select policy_version_id, justification from intervention_policy_evaluations where id = $1`, [recorded.evaluationId])).rows[0]
    const version = row?.policy_version_id ? await loadPolicyVersion(context.db, organizationId, row.policy_version_id) : null
    return buildOutput(node, policy, version, recorded, row?.justification ?? "")
  }

  const operatorId = await resolveEnrollmentOperatorId({ db: context.db, enrollment: { interactionId: context.enrollment.interaction_id, indicatorMeasurementId: context.enrollment.indicator_measurement_id, scheduledSubjectId: context.enrollment.scheduled_subject_id } })
  if (!operatorId) throw new ApplicationInvariantError(`O nó "${node.label}" não encontrou o colaborador desta execução.`)
  const version = await policyVersionInForceAt(context.db, organizationId, policy.id, await bornAtOf(context))
  const evaluation = await evaluatePolicy(context.db, { organizationId, policy, personId: operatorId, asOf: context.now, recommendOnly: node.config.mode === "RECOMMEND_ONLY", version })
  if (!evaluation) throw new ApplicationInvariantError(`O nó "${node.label}" não encontrou o colaborador desta execução.`)
  const { sources, caseIds } = analysisSources(context, node)
  const preferredCaseId = (await context.effects.findRecentCaseId(context.db, context.enrollment.id)) ?? caseIds[0] ?? null
  let result: ApplyEvaluationResult
  try {
    result = await context.effects.interventions.apply(context.db, {
      evaluation,
      origin: "WORKFLOW",
      idempotencyKey,
      workflow: { workflowId: context.enrollment.workflow_id, workflowVersionId: context.enrollment.version_id, enrollmentId: context.enrollment.id, nodeId: node.id },
      preferredCaseId,
      extraSources: sources,
    })
  } catch (error) {
    // Configuração/estrutura (responsável ou aprovador inexistente na cadeia, colaborador sem Grupo): não adianta repetir.
    if (error instanceof DomainError && !(error instanceof ApplicationInvariantError) && error.statusCode === 422) throw new ApplicationInvariantError(`${node.label}: ${error.message}`, "WORKFLOW_NODE_INVARIANT")
    throw error
  }
  if (result.reportId && !result.reused && version?.definition.report.aiNarrative) {
    try {
      await context.effects.interventions.generateNarrative(context.db, { organizationId, reportId: result.reportId })
    } catch {
      // A narrativa é complemento: a tentativa (pronta ou falha) já fica registrada quando dá; o fundamento continua gravado.
    }
  }
  return buildOutput(node, policy, version, result, evaluation.justification)
}
