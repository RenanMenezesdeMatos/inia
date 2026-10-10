import { finalizeInteractionCoverage, planDiagnosisRepairs, renderDiagnosisRepairPrompt, repairTargetsOf, summarizeDiagnosisCoverage, type DiagnosisAssessmentCoverage } from "../domain/indicator-diagnosis-coverage.js"
import type { InteractionAssessment } from "../domain/indicator-diagnosis-contract.js"
import type { CoverageRepairOutcome, PresentedExcerptForContract } from "../domain/process-assessment-contract.js"
import type { ProcessCheckpointCatalog } from "../../reliable-feedback/domain/checkpoint-catalog.js"
import { classifyExecutionError } from "../../../shared/domain/execution-failure.js"
import type { CoverageRepairCall } from "./assessment-coverage-repair.js"

/**
 * INDICATOR DIAGNOSIS V1.0.1 — REPARO SELETIVO DO DIAGNÓSTICO DO FECHAMENTO (ver `indicator-diagnosis-coverage.ts`).
 *
 * Por chamada da amostra: auditoria da primeira resposta → no MÁXIMO UMA chamada de reparo (só faltantes + inconsistentes, só a
 * conversa daquela chamada) → mescla. Limite do diagnóstico (`maxRepairInteractions`, da estratégia): acima dele a chamada fica
 * PARCIAL (registrado nas limitações), o custo nunca explode. Falha de um reparo (transporte, JSON) é registrada e não derruba o
 * nó nem o diagnóstico: as etapas continuam faltando. Nenhum laço, nenhuma terceira chamada, nenhum redator.
 */
export const INDICATOR_DIAGNOSIS_REPAIR_TAG = "stage:INDICATOR_DIAGNOSIS_REPAIR" as const
const REPAIR_CONCURRENCY = 4

export async function completeDiagnosisCoverage(input: {
  sample: readonly string[]
  accepted: readonly InteractionAssessment[]
  catalog: ProcessCheckpointCatalog
  presented: readonly PresentedExcerptForContract[] | null
  conversations: ReadonlyMap<string, string>
  maxRepairInteractions: number
  call: CoverageRepairCall
  agentId?: string | null
}): Promise<{ assessments: InteractionAssessment[]; coverage: DiagnosisAssessmentCoverage }> {
  // Só as chamadas com conversa entram no plano (as demais não foram apresentadas ao Agent).
  const sample = input.sample.filter((handle) => (input.conversations.get(handle) ?? "").trim().length > 0)
  const plans = planDiagnosisRepairs({ sample, accepted: input.accepted, catalog: input.catalog, presented: input.presented, maxRepairInteractions: input.maxRepairInteractions, conversations: input.conversations })
  const outcomes = new Map<string, { outcome: CoverageRepairOutcome; raw: string | null }>()
  const pending = plans.filter((plan) => plan.repair)
  for (let index = 0; index < pending.length; index += REPAIR_CONCURRENCY) {
    await Promise.all(pending.slice(index, index + REPAIR_CONCURRENCY).map(async (plan) => {
      let raw: string | null = null
      let outcome: CoverageRepairOutcome
      try {
        raw = await input.call(renderDiagnosisRepairPrompt({ targets: repairTargetsOf(plan.initial, input.catalog), inconsistent: plan.initial.inconsistentAfterInitial, conversation: input.conversations.get(plan.interactionRef)! }))
        outcome = parseRepairJson(raw)
      } catch (error) {
        outcome = { kind: "FAILED", code: `REPAIR_CALL_FAILED:${classifyExecutionError(error).category}` }
      }
      outcomes.set(plan.interactionRef, { outcome, raw })
    }))
  }
  const finalized = plans.map((plan) => {
    const repaired = outcomes.get(plan.interactionRef) ?? null
    return { interactionRef: plan.interactionRef, ...finalizeInteractionCoverage({ initial: plan.initial, assessment: plan.assessment, catalog: input.catalog, presented: input.presented, outcome: repaired?.outcome ?? null, skippedReason: plan.skippedReason, rawResponse: repaired?.raw ?? null, context: plan.context }) }
  })
  const coverage = summarizeDiagnosisCoverage(finalized.map((entry) => entry.audit), input.maxRepairInteractions)
  console.info(JSON.stringify({ event: "indicator_diagnosis_coverage", agentId: input.agentId ?? null, interactionCount: coverage.interactionCount, mustAssessPlanned: coverage.mustAssessPlanned, missingInitial: coverage.missingInitial, inconsistentInitial: coverage.inconsistentInitial, repairInteractions: coverage.repairInteractions, repairTargets: coverage.repairTargets, missingAfterRepair: coverage.missingAfterRepair, inconsistentAfterRepair: coverage.inconsistentAfterRepair, budgetSkipped: coverage.repairBudget.skipped, status: coverage.status }))
  // A chamada sem nenhuma etapa válida depois de tudo não vira avaliação (a verificação a trataria como "nada observado").
  const assessments = finalized.filter((entry) => entry.assessment.processes.some((process) => process.checkpoints.length > 0)).map((entry) => ({ interactionRef: entry.interactionRef, processAssessment: entry.assessment }))
  return { assessments, coverage }
}

/** JSON do reparo (só recorta o primeiro "{" ao último "}" quando há texto em volta; nunca reinterpreta). */
function parseRepairJson(text: string): CoverageRepairOutcome {
  const stripped = text.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim()
  for (const candidate of [stripped, stripped.slice(stripped.indexOf("{"), stripped.lastIndexOf("}") + 1)]) {
    if (candidate.length === 0) continue
    try {
      return { kind: "RESPONSE", value: JSON.parse(candidate) as unknown }
    } catch {
      // tenta o recorte
    }
  }
  return { kind: "FAILED", code: "REPAIR_JSON_INVALID" }
}
