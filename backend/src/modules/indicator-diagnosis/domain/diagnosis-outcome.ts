import { periodLabelOf, type IndicatorCanonicalContext } from "../../indicators/domain/indicator-canonical-context.js"
import { INDICATOR_DIAGNOSIS_CONTRACT, type DiagnosisPlanStatus, type IndicatorDiagnosisPlan } from "./indicator-diagnosis.js"
import { NO_PEER_EVIDENCE_LABELS, type PeerPracticeResult } from "./peer-practice-evidence.js"
import { patternFactText, type AssessedInteraction, type ProcessPattern } from "./process-patterns.js"

/**
 * V1.6.1 — RESULTADO DO DIAGNÓSTICO (domínio puro). Três desfechos, decididos por CÓDIGO:
 *
 *   DEVELOPMENT_SUPPORTED   há ao menos uma etapa não seguida de forma recorrente na amostra → ponto de desenvolvimento
 *                           (orientação só se a etapa tiver regra oficial verificada);
 *   STRENGTH_ONLY           só etapas seguidas de forma consistente → reconhecimento proporcional (sem orientação);
 *   NO_ACTIONABLE_DIAGNOSIS nada sustentado (indicador não decomponível, sem atendimentos, sem motivo investigável, amostra
 *                           insuficiente, avaliação ausente ou nenhum padrão consistente) → o feedback fica no FATO do
 *                           indicador e diz, de forma factual, que não houve evidência para orientação específica.
 * Fora da meta com só pontos fortes também registra que não houve evidência para orientação (as etapas foram seguidas).
 * As limitações são frases determinísticas — nunca escritas por modelo.
 */
export type DiagnosisStatus = "DEVELOPMENT_SUPPORTED" | "STRENGTH_ONLY" | "NO_ACTIONABLE_DIAGNOSIS"
export type NoActionableReason = Exclude<DiagnosisPlanStatus, "READY_FOR_ASSESSMENT"> | "STRATEGY_MISMATCH" | "NO_ASSESSMENT" | "INSUFFICIENT_SAMPLE" | "INSUFFICIENT_COVERAGE" | "NO_CONSISTENT_PATTERN"

export const NO_ACTIONABLE_REASON_LABELS: Record<NoActionableReason, string> = {
  NOT_DECOMPOSABLE: "este indicador não tem métrica por atendimento para localizar onde o resultado se concentra",
  NO_INTERACTIONS: "nenhum atendimento registrado no período da medição",
  NO_ELIGIBLE_SEGMENT: "nenhum motivo com ao menos 3 atendimentos transcritos no período",
  NO_ASSESSMENT: "os atendimentos selecionados não puderam ser avaliados",
  INSUFFICIENT_SAMPLE: "atendimentos analisados abaixo da amostra mínima",
  INSUFFICIENT_COVERAGE: "os atendimentos analisados cobrem uma parte pequena demais do motivo investigado",
  // V1.6.2 — decisões da estratégia do indicador (frases para o colaborador: nunca "estratégia", nunca termo técnico).
  STRATEGY_NOT_CONFIGURED: "o diagnóstico aprofundado deste indicador ainda não está disponível",
  SEGMENTATION_DISABLED: "o diagnóstico aprofundado deste indicador não localiza o resultado por atendimentos",
  INVESTIGATION_DISABLED: "os atendimentos não foram analisados neste diagnóstico",
  DOMAIN_NOT_ALLOWED: "a análise de atendimentos não se aplica a este fluxo",
  STRATEGY_MISMATCH: "o diagnóstico não pôde ser confirmado nesta execução",
  NO_CONSISTENT_PATTERN: "nenhuma etapa do processo apareceu de forma consistente na amostra analisada",
}

export type DiscardedInteraction = { handle: string; reason: "NOT_IN_PLAN" | "PLAN_CHANGED" | "NOT_ANALYZABLE" | "DUPLICATE" }

export type PatternSummary = {
  practiceKey: string
  requirement: string
  processTitle: string
  classification: ProcessPattern["classification"]
  analyzed: number
  followed: number
  notFollowed: number
  notObservable: number
  knowledge: { documentId: string | null; documentTitle: string; applicability: string; quote: string | null } | null
  grounding: string
  peer: PeerPracticeResult | null
}

export type IndicatorDiagnosisOutcome = {
  contract: typeof INDICATOR_DIAGNOSIS_CONTRACT
  status: DiagnosisStatus
  reason: NoActionableReason | null
  /** V1.6.2 — versão da estratégia que parametrizou o diagnóstico (auditoria; null = sem estratégia). */
  strategy?: { versionId: string | null; version: number | null }
  indicatorContext: {
    indicatorCode: string
    indicatorName: string
    value: number
    target: number | null
    direction: string
    withinTarget: boolean | null
    gapToTarget: number | null
    period: string
    history: null
    provenance: IndicatorCanonicalContext["provenance"]
  }
  segmentation: { dimension: string; metric: string | null; interactionsInPeriod: number; segments: IndicatorDiagnosisPlan["segments"]; selected: IndicatorDiagnosisPlan["selectedSegment"] }
  sampling: IndicatorDiagnosisPlan["sampling"]
  investigations: { handle: string; label: string; followed: number; notFollowed: number; notObservable: number; notApplicable: number }[]
  discarded: DiscardedInteraction[]
  patterns: PatternSummary[]
  supportedFindings: string[]
  unsupportedHypotheses: string[]
  limitations: string[]
}

/** Cobertura = atendimentos analisados ÷ atendimentos do motivo investigado no período (só com mínimo configurado). */
function coverageBelow(analyzed: number, plan: IndicatorDiagnosisPlan | null, minimumPercent: number | null): boolean {
  if (minimumPercent === null || !plan) return false
  const segment = plan.segments.find((entry) => entry.key === plan.selectedSegment?.key)
  if (!segment || segment.interactions === 0) return false
  return (analyzed / segment.interactions) * 100 < minimumPercent
}

const CAUSALITY_LIMITATION = "Uma etapa observada nos atendimentos analisados não demonstra que ela causou o resultado do indicador."

export function buildDiagnosisOutcome(input: {
  canonical: IndicatorCanonicalContext
  plan: IndicatorDiagnosisPlan | null
  assessed: readonly AssessedInteraction[]
  discarded: readonly DiscardedInteraction[]
  patterns: readonly ProcessPattern[]
  peers: ReadonlyMap<string, PeerPracticeResult>
  hadAssessments: boolean
  /** V1.6.2 — da versão da estratégia (runtimeParametersOf): amostra e cobertura mínimas; comparação com pares ligada? */
  minimumAnalyzed?: number
  minimumCoveragePercent?: number | null
  peerEnabled?: boolean
  /** A versão da estratégia do nó de origem não é a desta execução — nada do diagnóstico é aceito. */
  strategyMismatch?: boolean
}): IndicatorDiagnosisOutcome {
  const { canonical, plan } = input
  const segmentLabel = plan?.selectedSegment?.label ?? "motivo investigado"
  const supported = input.patterns.filter((pattern) => pattern.classification !== "INCONCLUSIVE")
  const development = supported.filter((pattern) => pattern.classification === "DEVELOPMENT")
  const reason: NoActionableReason | null =
    input.strategyMismatch ? "STRATEGY_MISMATCH"
    : !plan ? "NOT_DECOMPOSABLE"
    : plan.status !== "READY_FOR_ASSESSMENT" ? plan.status
    : !input.hadAssessments || input.assessed.length === 0 ? "NO_ASSESSMENT"
    : input.assessed.length < Math.max(input.minimumAnalyzed ?? 3, 3) ? "INSUFFICIENT_SAMPLE"
    : coverageBelow(input.assessed.length, plan, input.minimumCoveragePercent ?? null) ? "INSUFFICIENT_COVERAGE"
    : supported.length === 0 ? "NO_CONSISTENT_PATTERN"
    : null
  const status: DiagnosisStatus = reason ? "NO_ACTIONABLE_DIAGNOSIS" : development.length > 0 ? "DEVELOPMENT_SUPPORTED" : "STRENGTH_ONLY"

  const limitations: string[] = []
  if (plan?.metric === "INTERACTION_DURATION_SECONDS" && plan.selectedSegment) limitations.push("A duração por motivo vem da duração registrada das chamadas — uma aproximação, não o cálculo oficial do indicador.")
  const segment = plan?.segments.find((entry) => entry.key === plan.selectedSegment?.key)
  if (segment && input.assessed.length > 0) limitations.push(`Foram analisados ${input.assessed.length} de ${segment.interactions} atendimentos de ${segment.label} no período; a análise não representa todos os atendimentos.`)
  if (reason) limitations.push(`Não houve evidência suficiente para uma orientação específica: ${NO_ACTIONABLE_REASON_LABELS[reason]}.`)
  else if (status === "STRENGTH_ONLY" && canonical.withinTarget === false) limitations.push("Não houve evidência suficiente para uma orientação específica: as etapas avaliadas foram seguidas na amostra analisada.")
  if (supported.length > 0) {
    limitations.push(CAUSALITY_LIMITATION)
    const peerReasons = supported.map((pattern) => input.peers.get(pattern.practiceKey)).filter((peer): peer is PeerPracticeResult & { status: "NO_PEER_EVIDENCE" } => peer?.status === "NO_PEER_EVIDENCE")
    if (input.peerEnabled !== false && supported.every((pattern) => input.peers.get(pattern.practiceKey)?.status !== "AVAILABLE")) limitations.push(`Sem comparação com grupo de referência: ${NO_PEER_EVIDENCE_LABELS[peerReasons[0]?.reason ?? "PRACTICE_NOT_COMPARABLE"]}.`)
  }

  return {
    contract: INDICATOR_DIAGNOSIS_CONTRACT,
    status,
    reason,
    strategy: plan?.strategy ?? { versionId: null, version: null },
    indicatorContext: {
      indicatorCode: canonical.indicator.code,
      indicatorName: canonical.indicator.name,
      value: canonical.measurement.value,
      target: canonical.target?.value ?? null,
      direction: canonical.indicator.direction,
      withinTarget: canonical.withinTarget,
      gapToTarget: canonical.gapToTarget,
      period: periodLabelOf(canonical.measurement.periodStart, canonical.measurement.periodEnd),
      history: null,
      provenance: canonical.provenance,
    },
    segmentation: { dimension: plan?.dimension ?? "SUBJECT", metric: plan?.metric ?? null, interactionsInPeriod: plan?.interactionsInPeriod ?? 0, segments: plan?.segments ?? [], selected: plan?.selectedSegment ?? null },
    sampling: plan?.sampling ?? null,
    investigations: input.assessed.map((interaction) => ({ handle: interaction.handle, label: interaction.label, followed: interaction.assessment.summary.FOLLOWED, notFollowed: interaction.assessment.summary.NOT_FOLLOWED, notObservable: interaction.assessment.summary.NOT_OBSERVABLE, notApplicable: interaction.assessment.summary.NOT_APPLICABLE })),
    discarded: [...input.discarded],
    patterns: input.patterns.map((pattern) => ({
      practiceKey: pattern.practiceKey,
      requirement: pattern.requirement,
      processTitle: pattern.processTitle,
      classification: pattern.classification,
      analyzed: pattern.analyzed,
      followed: pattern.followed.length,
      notFollowed: pattern.notFollowed.length,
      notObservable: pattern.notObservable.length,
      knowledge: pattern.knowledge ? { documentId: pattern.knowledge.documentId, documentTitle: pattern.knowledge.documentTitle, applicability: pattern.knowledge.applicability, quote: pattern.knowledge.quote } : null,
      grounding: pattern.grounding,
      peer: input.peers.get(pattern.practiceKey) ?? null,
    })),
    supportedFindings: supported.map((pattern) => patternFactText(pattern, segmentLabel)),
    unsupportedHypotheses: [
      ...input.patterns.filter((pattern) => pattern.classification === "INCONCLUSIVE" && (pattern.followed.length > 0 || pattern.notFollowed.length > 0)).map((pattern) => `Etapa “${pattern.requirement}”: evidência pontual (seguida em ${pattern.followed.length}, não seguida em ${pattern.notFollowed.length} de ${pattern.analyzed}) — não sustenta padrão.`),
      "O comportamento observado na amostra ter causado o resultado do indicador (associação não é causa).",
    ],
    limitations,
  }
}
