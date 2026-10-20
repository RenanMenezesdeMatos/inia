import { runAgent } from "../../agents/application/run-agent.js"
import { renderDiagnosisSampleForAgent } from "../../agents/domain/indicator-diagnosis-contract.js"
import { planInvestigationSteps } from "../../indicator-diagnosis/application/investigation-planner.js"
import { prepareDirectIndicatorPlan, preparePrvClosingPlan, type PrvClosingPlan } from "../../indicator-diagnosis/application/prepare-prv-closing.js"
import type { InvestigationStepSelection, StepChoice } from "../../indicator-diagnosis/domain/investigation-steps.js"
import { previousSnapshotOf, referencePeriodLabel } from "../../indicator-diagnosis/domain/prv-closing.js"
import { INDICATOR_DIAGNOSIS_SOURCE_CONTRACT, INDICATOR_DIAGNOSIS_SOURCE_KIND, PRV_CLOSING_SOURCE_CONTRACT, PRV_CLOSING_SOURCE_KIND } from "../../reliable-feedback/application/prv-closing-step.js"
import type { ActionConfig } from "../domain/graph-schema.js"
import type { ActionExecutionContext } from "./action-executors.js"
import { loadLatestTranscriptForModel } from "./transcript.js"

/**
 * INDICATOR DIAGNOSIS — "Chamar agente" nos formatos de diagnóstico de indicador com gatilho por Agenda:
 *
 *   V1  "Diagnóstico do fechamento do PRV" (fonte "Fechamentos oficiais"): o fechamento inteiro, triado pela estratégia de cada indicador;
 *   V2  "Diagnóstico do indicador" com a fonte "Fechamentos oficiais" + UM indicador: o diagnóstico DIRETO, sem PRV.
 *
 * Os dois usam o MESMO plano por indicador (prepare-prv-closing.ts) — o SISTEMA decide tudo o que é dado e escolha (período oficial,
 * triagem, população, motivo, reuso das observações compatíveis, amostra determinística). V2: quando a estratégia do indicador é
 * AGENT_SELECTED e há escolha real, a IA LÊ a estratégia e escolhe os passos (uma chamada, planejador limitado); o plano é recalculado
 * com a escolha validada. O Agent só avalia processos quando o passo existe, está disponível e foi escolhido — PREFLIGHT: sem período
 * oficial, sem indicador triado, sem população, amostra insuficiente, já diagnosticado ou tudo reaproveitado = ZERO avaliação.
 */
export type PrvAgentRun = { id: string; outputText: string | null; status: string; errorMessage: string | null; error?: unknown; workflowResult?: unknown }
type StepChoices = Record<string, { choice: StepChoice[] | null; planner: InvestigationStepSelection["planner"] }>

function sourceOf(plan: PrvClosingPlan, organizationId: string, personId: string, stepChoices: StepChoices) {
  const direct = plan.source?.kind === "DIRECT_INDICATOR"
  return {
    kind: direct ? INDICATOR_DIAGNOSIS_SOURCE_KIND : PRV_CLOSING_SOURCE_KIND,
    contract: direct ? INDICATOR_DIAGNOSIS_SOURCE_CONTRACT : PRV_CLOSING_SOURCE_CONTRACT,
    organizationId,
    personId,
    ...(direct ? { indicatorCode: plan.source!.indicatorCode } : {}),
    referencePeriod: plan.closing?.referencePeriod ?? null,
    idempotencyKey: plan.idempotencyKey,
    planStatus: plan.status,
    strategies: plan.strategies,
    triage: plan.triage?.decisions.map((decision) => ({ indicatorCode: decision.indicatorCode, decision: decision.decision, reasons: decision.reasons })) ?? [],
    investigations: plan.investigations.map((investigation) => ({ indicatorCode: investigation.indicatorCode, status: investigation.status, eligible: investigation.eligibleInteractions.length, reusable: investigation.reuse.filter((entry) => entry.status === "REUSABLE").length, toAssess: investigation.toAssess.length, steps: { mode: investigation.steps.mode, selected: investigation.steps.selected, rejected: investigation.steps.rejected, planner: investigation.steps.planner } })),
    // V2 — escolha de passos do planejador, presa aqui: "Gerar feedback" recalcula o plano com ela (validada de novo).
    ...(Object.keys(stepChoices).length > 0 ? { stepChoices } : {}),
    sample: plan.toAssess.map((request) => ({ handle: request.handle, interactionId: request.interactionId })),
    assessment: null as null | { agentRunId: string | null; interactionAssessments: unknown[]; knowledgeExcerpts: unknown[]; checkpointGovernance?: unknown; coverage?: unknown; structuredOutput?: unknown },
  }
}

/** V2 — a IA escolhe os passos das investigações AGENT_SELECTED que têm escolha real; o plano é recalculado com a escolha. */
async function withInvestigationChoices(context: ActionExecutionContext, agentId: string, prepare: (stepChoices: StepChoices | null) => Promise<PrvClosingPlan>): Promise<{ plan: PrvClosingPlan; stepChoices: StepChoices }> {
  const first = await prepare(null)
  const pending = first.status === "READY" ? first.investigations.filter((investigation) => investigation.needsPlanner) : []
  if (pending.length === 0) return { plan: first, stepChoices: {} }
  const stepChoices: StepChoices = {}
  for (const investigation of pending) {
    const previous = first.closing ? previousSnapshotOf(first.closing, investigation.indicatorCode) : null
    stepChoices[investigation.indicatorCode] = await planInvestigationSteps(context.db, { organizationId: context.organizationId, agentId, plan: investigation, previousValue: previous?.value ?? null, recorder: context.effects.agentRuns })
  }
  return { plan: await prepare(stepChoices), stepChoices }
}

async function assessPlan(config: Extract<ActionConfig, { actionType: "CALL_AGENT" }>, context: ActionExecutionContext, operatorId: string, teamId: string, plan: PrvClosingPlan, source: ReturnType<typeof sourceOf>): Promise<PrvAgentRun> {
  if (plan.status !== "READY" || plan.toAssess.length === 0) return { id: "", outputText: null, status: "COMPLETED", errorMessage: null, workflowResult: source }

  const first = plan.investigations.find((investigation) => investigation.toAssess.length > 0)!
  const transcripts = await Promise.all(plan.toAssess.map(async (request) => ({ handle: request.handle, localDate: request.localDate, transcript: (await loadLatestTranscriptForModel(context.db, request.interactionId))?.content ?? "" })))
  const period = referencePeriodLabel(plan.closing!.referencePeriod)
  const segmentText = first.selectedSegment ? `Motivo investigado pelo sistema: ${first.selectedSegment.label} (fechamento de ${period}). O sistema já escolheu as chamadas; avalie os processos de cada uma.` : null
  const inputContext = renderDiagnosisSampleForAgent({ segmentText, periodLabel: period, sample: transcripts.filter((entry) => entry.transcript.trim().length > 0) })
  const run = await runAgent(context.db, {
    organizationId: context.organizationId,
    agentId: config.agentId,
    inputContext,
    source: "WORKFLOW",
    recorder: context.effects.agentRuns,
    // A população já foi escolhida pelo sistema: nenhuma Tool de investigação nesta chamada.
    allowedCapabilities: [],
    now: context.now,
    workflow: {
      kind: "indicator",
      operatorId,
      teamId,
      indicatorMeasurementId: null,
      measuredAt: first.window.end.toISOString(),
      indicatorCode: first.indicatorCode,
      indicatorName: first.snapshot.indicatorName,
      unit: first.snapshot.unit,
      value: first.snapshot.value,
      targetValue: first.snapshot.target,
      comparator: "EQUALS",
      thresholdNumeric: null,
      periodSummary: { measurementIds: [first.snapshot.snapshotId], periodLabel: `Fechamento de ${period}`, periodStart: first.window.startDate, periodEnd: first.window.endDate },
      outputContract: "INDICATOR_DIAGNOSIS",
      diagnosisSample: { measurementId: plan.idempotencyKey!, strategyVersionId: first.strategy?.id ?? null, sample: source.sample },
      // As etapas do encerramento do processo do motivo investigado precisam de disposição em cada chamada (marcas AVALIAR).
      // V1.0.1 — reparo seletivo por chamada (faltantes + inconsistentes), no máximo um por chamada e até o limite da estratégia.
      diagnosisCoverage: { subject: first.selectedSegment?.label ?? null, repair: { maxInteractions: first.parameters.sample.maxRepairInteractions, conversations: transcripts.filter((entry) => entry.transcript.trim().length > 0).map((entry) => ({ handle: entry.handle, transcript: entry.transcript })) } },
    },
  })
  if (run.status === "FAILED") return run as PrvAgentRun
  const result = ("workflowResult" in run ? run.workflowResult : null) as { diagnosis?: { interactionAssessments?: unknown[]; coverage?: unknown; structuredOutput?: unknown }; knowledgeExcerpts?: unknown[]; checkpointGovernance?: unknown } | null
  source.assessment = { agentRunId: run.id, interactionAssessments: result?.diagnosis?.interactionAssessments ?? [], knowledgeExcerpts: result?.knowledgeExcerpts ?? [], ...(result?.checkpointGovernance ? { checkpointGovernance: result.checkpointGovernance } : {}), ...(result?.diagnosis?.coverage ? { coverage: result.diagnosis.coverage } : {}), ...(result?.diagnosis?.structuredOutput ? { structuredOutput: result.diagnosis.structuredOutput } : {}) }
  return { id: run.id, outputText: run.outputText, status: run.status, errorMessage: run.errorMessage, workflowResult: source }
}

export async function callAgentForPrvClosing(config: Extract<ActionConfig, { actionType: "CALL_AGENT" }>, context: ActionExecutionContext, operatorId: string, teamId: string): Promise<PrvAgentRun> {
  const { plan, stepChoices } = await withInvestigationChoices(context, config.agentId, (choices) => preparePrvClosingPlan(context.db, context.organizationId, { personId: operatorId, now: context.now, agentId: config.agentId, stepChoices: choices }))
  return assessPlan(config, context, operatorId, teamId, plan, sourceOf(plan, context.organizationId, operatorId, stepChoices))
}

/** V2 — diagnóstico DIRETO de um indicador (sem fechamento do PRV): o Workflow diz qual indicador; o resto é do sistema. */
export async function callAgentForIndicatorDiagnosis(config: Extract<ActionConfig, { actionType: "CALL_AGENT" }>, context: ActionExecutionContext, operatorId: string, teamId: string, indicatorCode: string): Promise<PrvAgentRun> {
  const { plan, stepChoices } = await withInvestigationChoices(context, config.agentId, (choices) => prepareDirectIndicatorPlan(context.db, context.organizationId, { personId: operatorId, now: context.now, agentId: config.agentId, indicatorCode, stepChoices: choices }))
  return assessPlan(config, context, operatorId, teamId, plan, sourceOf(plan, context.organizationId, operatorId, stepChoices))
}
