import type { Database } from "../../../infrastructure/database/pool.js"
import { renderDiagnosisSampleForAgent } from "../../agents/domain/indicator-diagnosis-contract.js"
import { loadLatestTranscript } from "../../workflows/application/transcript.js"
import { runtimeParametersOf } from "../domain/diagnostic-strategy.js"
import { segmentFactText } from "../domain/indicator-diagnosis.js"
import { resolveExecutionStrategy, type ResolvedStrategy } from "./diagnostic-strategy-service.js"
import { loadIndicatorDiagnosisPlan } from "./load-diagnosis-plan.js"

/**
 * Plano do diagnóstico + bloco da amostra para o Agent (só handle, data local e transcrição). Zero modelo. Usado pelo nó
 * "Chamar agente" (formato INDICATOR_DIAGNOSIS) e pelo "Testar diagnóstico" — a MESMA preparação. V1.6.2: parametrizado pela
 * versão da estratégia PRESA na execução (a mesma que "Gerar feedback" usa); `strategy` explícita = simulação de uma versão.
 */
export async function prepareIndicatorDiagnosis(db: Database, organizationId: string, input: { measurementId: string; collaboratorId: string; indicatorId: string; enrollmentId: string | null; agentId: string; strategy?: ResolvedStrategy | null }) {
  const strategy = input.strategy !== undefined ? input.strategy : await resolveExecutionStrategy(db, organizationId, { enrollmentId: input.enrollmentId, indicatorId: input.indicatorId })
  const parameters = runtimeParametersOf(strategy)
  const plan = await loadIndicatorDiagnosisPlan(db, { organizationId, measurementId: input.measurementId, collaboratorId: input.collaboratorId, parameters, agentId: input.agentId })
  const entries = plan?.status === "READY_FOR_ASSESSMENT" ? plan.sample : []
  const transcripts = await Promise.all(entries.map(async (entry) => ({ handle: entry.handle, localDate: entry.localDate, transcript: (await loadLatestTranscript(db, entry.interactionId))?.content ?? "" })))
  return {
    plan,
    parameters,
    sample: { measurementId: input.measurementId, strategyVersionId: parameters.strategyVersionId, sample: entries.map((entry) => ({ handle: entry.handle, interactionId: entry.interactionId })) },
    prompt: renderDiagnosisSampleForAgent({ segmentText: plan ? segmentFactText(plan) : null, periodLabel: plan?.period.label ?? "", sample: transcripts.filter((entry) => entry.transcript.trim().length > 0) }),
  }
}
