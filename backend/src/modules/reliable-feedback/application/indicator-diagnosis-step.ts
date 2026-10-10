import type { IndicatorCanonicalContext } from "../../indicators/domain/indicator-canonical-context.js"
import { personMentionRolesOf } from "../../investigation/domain/person-mention-roles.js"
import { buildDiagnosisOutcome, type DiscardedInteraction, type IndicatorDiagnosisOutcome } from "../../indicator-diagnosis/domain/diagnosis-outcome.js"
import { segmentFactText, type IndicatorDiagnosisPlan } from "../../indicator-diagnosis/domain/indicator-diagnosis.js"
import { buildPeerPracticeEvidence, referenceGroupOf, type PeerObservationRow, type PeerPracticeResult } from "../../indicator-diagnosis/domain/peer-practice-evidence.js"
import { aggregateProcessPatterns, observationsFrom, type AssessedInteraction, type ProcessObservation } from "../../indicator-diagnosis/domain/process-patterns.js"
import type { DisplayProjectionContext } from "../../investigation/domain/feedback-display-evidence.js"
import { buildSampleApplicabilityItem } from "../domain/applicability-items.js"
import { buildDiagnosisItems } from "../domain/diagnosis-items.js"
import type { FeedbackInvestigationResultV1 } from "../domain/feedback-investigation-result.js"
import { verifyProcessAssessments } from "../domain/process-assessment.js"
import type { ReliableItemDraft } from "../domain/reliable-feedback-item.js"
import type { MonitoringContextLoader, PublishedKnowledgeLoader } from "./generate-reliable-feedback.js"
import { runtimeParametersOf, type DiagnosisRuntimeParameters } from "../../indicator-diagnosis/domain/diagnostic-strategy.js"
import type { ResolvedStrategy } from "../../indicator-diagnosis/application/diagnostic-strategy-service.js"

/** Plano do diagnóstico recalculado pelo SISTEMA (mesma função do nó "Chamar agente"). null = medição fora da organização/colaborador. */
export type DiagnosisPlanLoader = (organizationId: string, input: { measurementId: string; collaboratorId: string; parameters: DiagnosisRuntimeParameters; agentId: string | null }) => Promise<IndicatorDiagnosisPlan | null>
/** V1.6.2 — a versão da estratégia desta execução (presa na matrícula; simulação = a efetiva). */
export type DiagnosticStrategyResolver = (organizationId: string, input: { enrollmentId: string | null; indicatorId: string }) => Promise<ResolvedStrategy | null>
/** População elegível (valor oficial por pessoa) + observações verificadas das práticas pedidas, no período da medição. */
export type PeerPracticeLoader = (organizationId: string, input: { measurementId: string; collaboratorId: string; practiceKeys: readonly string[] }) => Promise<{ peers: { personId: string; value: number }[]; observations: PeerObservationRow[] }>

export type DiagnosisStepDeps = {
  loadMonitoringContext: MonitoringContextLoader
  loadPublishedKnowledge: PublishedKnowledgeLoader
  loadIndicatorDiagnosisPlan: DiagnosisPlanLoader
  loadPeerPracticeData: PeerPracticeLoader
  resolveDiagnosticStrategy: DiagnosticStrategyResolver
  now: () => Date
}

export type DiagnosisStepResult = { items: ReliableItemDraft[]; outcome: IndicatorDiagnosisOutcome; observations: ProcessObservation[]; excludedForMateriality: string[]; parameters: DiagnosisRuntimeParameters; plan: IndicatorDiagnosisPlan | null }

/**
 * V1.6.1 — o DIAGNÓSTICO dentro de "Gerar feedback" (nenhuma chamada de modelo aqui):
 *   1. RECALCULA o plano (onde investigar + amostra) — a amostra que veio no nó de origem só vale se bater atendimento a
 *      atendimento com a do sistema (mesmo handle → mesmo atendimento); o resto é descartado com o motivo;
 *   2. carrega cada transcrição pela MESMA porta da monitoria (atendimento da organização E do colaborador);
 *   3. VERIFICA cada avaliação pela mesma regra da V1.6.0 (fala do operador por turno + regra literal publicada, apresentada e
 *      ancorada) — sem segunda lógica de avaliação de chamada;
 *   4. AGREGA por prática (contagens do sistema) → padrões DEVELOPMENT/STRENGTH/INCONCLUSIVE;
 *   5. PARES: grupo de referência determinístico + observações verificadas persistidas → agregado com privacidade;
 *   6. itens de padrão + resultado (status, achados sustentados, hipóteses não sustentadas, limitações) + observações novas.
 */
export async function runIndicatorDiagnosisStep(deps: DiagnosisStepDeps, input: { organizationId: string; collaboratorId: string; measurementId: string; enrollmentId: string | null; agentId: string | null; canonical: IndicatorCanonicalContext; source: NonNullable<FeedbackInvestigationResultV1["indicatorDiagnosis"]>; startIndex: number }): Promise<DiagnosisStepResult> {
  const { source } = input
  // V1.6.2 — a MESMA versão da estratégia do nó de origem (presa na execução). Divergência = nada do diagnóstico é aceito.
  const strategy = await deps.resolveDiagnosticStrategy(input.organizationId, { enrollmentId: input.enrollmentId, indicatorId: input.canonical.indicator.id })
  const strategyMatches = (strategy?.id ?? null) === source.strategyVersionId
  const parameters = runtimeParametersOf(strategy)
  const plan = source.measurementId === input.measurementId && strategyMatches ? await deps.loadIndicatorDiagnosisPlan(input.organizationId, { measurementId: input.measurementId, collaboratorId: input.collaboratorId, parameters, agentId: input.agentId }) : null
  const discarded: DiscardedInteraction[] = []
  const assessed: AssessedInteraction[] = []
  const displayContextByHandle = new Map<string, DisplayProjectionContext>()
  const seen = new Set<string>()
  const documentIds = [...new Set(source.presented.map((excerpt) => excerpt.documentId))]
  const published = documentIds.length > 0 ? await deps.loadPublishedKnowledge(input.organizationId, documentIds) : new Map()
  for (const entry of plan?.status === "READY_FOR_ASSESSMENT" ? source.assessments : []) {
    const handle = entry.interactionRef
    if (seen.has(handle)) {
      discarded.push({ handle, reason: "DUPLICATE" })
      continue
    }
    seen.add(handle)
    const planned = plan!.sample.find((sample) => sample.handle === handle)
    const claimed = source.sample.find((sample) => sample.handle === handle)
    if (!planned || !claimed) {
      discarded.push({ handle, reason: "NOT_IN_PLAN" })
      continue
    }
    if (planned.interactionId !== claimed.interactionId) {
      discarded.push({ handle, reason: "PLAN_CHANGED" })
      continue
    }
    const context = await deps.loadMonitoringContext(input.organizationId, planned.interactionId, input.collaboratorId)
    if (!context || context.transcript.trim().length === 0) {
      discarded.push({ handle, reason: "NOT_ANALYZABLE" })
      continue
    }
    const verified = verifyProcessAssessments({ sources: [{ sourceRef: handle, assessment: entry.assessment, presented: source.presented }], interactionId: planned.interactionId, transcript: context.transcript, published })
    assessed.push({ handle, interactionId: planned.interactionId, label: context.label, assessment: verified, otherOperatorNames: context.otherOperatorNames })
    displayContextByHandle.set(handle, { otherOperatorNames: context.otherOperatorNames, mentionRoles: personMentionRolesOf(context.transcript, context.subjectOperatorName ?? null) })
  }

  const patterns = aggregateProcessPatterns(assessed, { minimumAnalyzed: parameters.sample.minimumAnalyzed })
  const segment = plan?.selectedSegment ? { key: plan.selectedSegment.key, label: plan.selectedSegment.label } : null
  const supported = patterns.filter((pattern) => pattern.classification !== "INCONCLUSIVE")
  const peers = new Map<string, PeerPracticeResult>()
  const comparable = supported.filter((pattern) => pattern.knowledgeIdentity)
  const data = parameters.peer.enabled && comparable.length > 0 && segment ? await deps.loadPeerPracticeData(input.organizationId, { measurementId: input.measurementId, collaboratorId: input.collaboratorId, practiceKeys: comparable.map((pattern) => pattern.practiceKey) }) : { peers: [], observations: [] }
  const reference = referenceGroupOf(data.peers, { direction: input.canonical.indicator.direction, indicatorCode: input.canonical.indicator.code, period: { start: plan?.period.start ?? "", end: plan?.period.end ?? "" }, minimumPopulation: parameters.peer.minimumPopulation })
  const computedAt = deps.now().toISOString()
  for (const pattern of parameters.peer.enabled ? supported : []) {
    peers.set(pattern.practiceKey, buildPeerPracticeEvidence({
      indicator: { code: input.canonical.indicator.code, name: input.canonical.indicator.name },
      practiceKey: pattern.practiceKey,
      segment,
      own: { followed: pattern.followed.length, notFollowed: pattern.notFollowed.length },
      reference,
      observations: data.observations,
      computedAt,
      minimums: { contributors: parameters.peer.minimumContributors, observedInteractions: parameters.peer.minimumObservedInteractions },
    }))
  }

  const outcome = buildDiagnosisOutcome({ canonical: input.canonical, plan, assessed, discarded, patterns, peers, hadAssessments: source.assessments.length > 0, minimumAnalyzed: parameters.sample.minimumAnalyzed, minimumCoveragePercent: parameters.sample.minimumCoveragePercent, peerEnabled: parameters.peer.enabled, strategyMismatch: !strategyMatches })
  const built = buildDiagnosisItems({ patterns, peers, segmentLabel: segment?.label ?? "motivo investigado", segmentText: plan ? segmentFactText(plan) : null, displayContextByHandle, startIndex: input.startIndex })
  // V1.7.1b — produto não confirmado em atendimentos da amostra: as etapas que dependem dele ficaram fora dos padrões — dito.
  const attention = buildSampleApplicabilityItem(assessed, input.startIndex + built.items.length)
  const items = attention ? [...built.items, attention] : built.items
  const excludedForMateriality = built.excludedForMateriality
  return { items, outcome, observations: observationsFrom(input.collaboratorId, assessed), excludedForMateriality, parameters, plan }
}
