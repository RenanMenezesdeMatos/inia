import type { DiagnosisAssessmentCoverage } from "../../agents/domain/indicator-diagnosis-coverage.js"
import { createHash } from "node:crypto"
import type { SamplingMetadata } from "../../investigation/domain/sampling-strategy.js"
import { CLOSING_TRIAGE_VERSION, type PrvTriage, type TriageDecision } from "./closing-triage.js"
import type { DiagnosisMetric, DiagnosisSegment } from "./indicator-diagnosis.js"
import { OBSERVATION_COMPATIBILITY_VERSION } from "./observation-compatibility.js"
import { classifyOperationalPattern, OPERATIONAL_PATTERN_VERSION, type OperationalPatternSummary } from "./operational-patterns.js"
import { PEER_MINIMUM_OBSERVED_INTERACTIONS, PEER_MINIMUM_POPULATION } from "./peer-practice-evidence.js"
import type { MixShift } from "./population-mix.js"
import type { InvestigationStepSelection } from "./investigation-steps.js"
import type { SignalDistribution, SignalEvolution } from "./signal-population.js"
import { formatPercent, officialValueMovementOf, previousSnapshotOf, quartileMovementOf, referencePeriodLabel, type Movement, type OfficialPrvSnapshot, type PrvClosing, type Quartile } from "./prv-closing.js"

/**
 * INDICATOR DIAGNOSIS V1 — A VERDADE DIAGNÓSTICA ESTRUTURADA (domínio puro, ZERO modelo). UMA investigação por indicador
 * triado e UM diagnóstico por fechamento; públicos diferentes recebem PROJEÇÕES dela (colaborador, supervisor), nunca
 * diagnósticos diferentes.
 *
 *   NÍVEL 1  resultado OFICIAL (valor, meta, quartil, atingimento, peso — só lidos; anterior só ordenado);
 *   NÍVEL 2  composição da população (motivos, mix × fechamento anterior, dias);
 *   NÍVEL 3  execução operacional (ProcessObservations reaproveitadas + avaliadas agora, agregadas pelo sistema).
 *
 * Tipos de conclusão (decididos por CÓDIGO):
 *   ACTIONABLE_PATTERN            padrão de desenvolvimento sustentado NA POPULAÇÃO DO COLABORADOR;
 *   MIX_AND_OPERATIONAL_PATTERN   o mesmo, com mudança relevante de mix no período;
 *   MIX_SHIFT                     só a mudança de mix (fato de composição, nunca causa);
 *   POSITIVE_PATTERN              reconhecimento: práticas seguidas de forma consistente (sem gap sustentado);
 *   NO_ACTIONABLE_DIAGNOSIS       nada sustentado (resultado VÁLIDO: "não foi identificado um padrão recorrente suficiente");
 *   INSUFFICIENT_SAMPLE           chamadas elegíveis/analisadas abaixo do mínimo (nenhum modelo é chamado);
 *   INSUFFICIENT_OBSERVABILITY    chamadas analisadas, mas quase nada observável para contar;
 *   NO_ELIGIBLE_POPULATION        nenhuma chamada do colaborador no recorte;
 *   NOT_DECOMPOSABLE              o indicador não tem métrica por atendimento (fica no fato oficial).
 *
 * PROTEÇÃO INDIVIDUAL: um padrão do GRUPO nunca vira crítica individual. A atribuição de cada comportamento compara a
 * população do colaborador com o agregado do Subgrupo (privacidade mínima): só INDIVIDUAL/INDIVIDUAL_AND_TEAM chega ao
 * colaborador; TEAM_ONLY fica na visão do supervisor.
 */
export const INDICATOR_INVESTIGATION_VERSION = "INDICATOR_INVESTIGATION_V1" as const
/** V1.0.2 — a integridade de papéis da evidência muda a avaliação das chamadas: versão nova = chave nova (o diagnóstico anterior continua gravado, nada é apagado). */
export const PRV_DIAGNOSIS_LOGIC_VERSION = "PRV_DIAGNOSIS_V1_0_2" as const
/**
 * INDICATOR DIAGNOSIS V2 — diagnóstico DIRETO de um indicador (sem fechamento do PRV): mesma investigação, mesma verdade
 * estruturada, outra origem. Versão lógica própria = chave própria (nunca colide com a do fechamento).
 */
export const DIRECT_DIAGNOSIS_LOGIC_VERSION = "INDICATOR_DIAGNOSIS_V2_0" as const
export type DiagnosisSourceKind = "PRV_CLOSING" | "DIRECT_INDICATOR"

/** V2 — INSUFFICIENT_EVIDENCE: a estratégia pede uma evidência comportamental que os DADOS não oferecem (ex.: vínculo com o atendimento anterior) — nada é inferido no lugar dela. */
export type ConclusionType = "ACTIONABLE_PATTERN" | "MIX_AND_OPERATIONAL_PATTERN" | "MIX_SHIFT" | "POSITIVE_PATTERN" | "NO_ACTIONABLE_DIAGNOSIS" | "INSUFFICIENT_SAMPLE" | "INSUFFICIENT_OBSERVABILITY" | "NO_ELIGIBLE_POPULATION" | "NOT_DECOMPOSABLE" | "INSUFFICIENT_EVIDENCE"
export const ACTIONABLE_CONCLUSIONS: readonly ConclusionType[] = ["ACTIONABLE_PATTERN", "MIX_AND_OPERATIONAL_PATTERN"]

export type BehaviorAttribution = "INDIVIDUAL" | "INDIVIDUAL_AND_TEAM" | "TEAM_ONLY" | "NONE"

export type TeamBehavior = { practiceKey: string; title: string; eligible: number; followed: number; notFollowed: number; classification: "DEVELOPMENT" | "STRENGTH" | "INCONCLUSIVE" }
export type TeamPatternContext = { status: "AVAILABLE" | "INSUFFICIENT_POPULATION" | "NOT_AVAILABLE"; contributors: number; observedInteractions: number; behaviors: TeamBehavior[] }

export type TeamObservationRow = { personId: string; interactionId: string; practiceKey: string; title: string; status: "FOLLOWED" | "NOT_FOLLOWED" }

/** Agregado do Subgrupo (sem o colaborador): só contagens, com privacidade mínima (≥ 4 pessoas contribuindo, ≥ 5 chamadas). */
export function teamPatternsOf(rows: readonly TeamObservationRow[], minimumEligible?: number): TeamPatternContext {
  const contributors = new Set(rows.map((row) => row.personId)).size
  const observedInteractions = new Set(rows.map((row) => row.interactionId)).size
  if (contributors < PEER_MINIMUM_POPULATION || observedInteractions < PEER_MINIMUM_OBSERVED_INTERACTIONS) return { status: rows.length === 0 ? "NOT_AVAILABLE" : "INSUFFICIENT_POPULATION", contributors, observedInteractions, behaviors: [] }
  // Uma contribuição por chamada × comportamento (não seguida vence) — a mesma regra do colaborador.
  const perInteraction = new Map<string, TeamObservationRow>()
  for (const row of rows) {
    const key = `${row.interactionId}|${row.practiceKey}`
    const current = perInteraction.get(key)
    if (!current || (current.status === "FOLLOWED" && row.status === "NOT_FOLLOWED")) perInteraction.set(key, row)
  }
  const byPractice = new Map<string, TeamObservationRow[]>()
  for (const row of perInteraction.values()) byPractice.set(row.practiceKey, [...(byPractice.get(row.practiceKey) ?? []), row])
  const behaviors = [...byPractice.entries()].map(([practiceKey, entries]) => {
    const followed = entries.filter((entry) => entry.status === "FOLLOWED").length
    const notFollowed = entries.length - followed
    return { practiceKey, title: entries[0]!.title, eligible: entries.length, followed, notFollowed, classification: classifyOperationalPattern({ eligible: entries.length, followed, notFollowed }, minimumEligible) }
  })
  return { status: "AVAILABLE", contributors, observedInteractions, behaviors: behaviors.sort((a, b) => b.notFollowed - a.notFollowed || a.title.localeCompare(b.title)) }
}

export function attributionOf(individual: "DEVELOPMENT" | "STRENGTH" | "INCONCLUSIVE" | null, team: "DEVELOPMENT" | "STRENGTH" | "INCONCLUSIVE" | null): BehaviorAttribution {
  const own = individual === "DEVELOPMENT"
  const group = team === "DEVELOPMENT"
  return own && group ? "INDIVIDUAL_AND_TEAM" : own ? "INDIVIDUAL" : group ? "TEAM_ONLY" : "NONE"
}

export type SampleAccounting = {
  eligibleCount: number
  reusableCount: number
  incompatibleCount: number
  unobservedCount: number
  selectedForAssessment: number
  analyzedCount: number
  reusedObservationCount: number
  reanalyzedInteractionCount: number
  newObservationCount: number
  selectionReason: string
  sampling: SamplingMetadata | null
  discarded: { handle: string; reason: string }[]
}

export type IndicatorInvestigation = {
  version: typeof INDICATOR_INVESTIGATION_VERSION
  indicatorId: string
  indicatorCode: string
  indicatorName: string
  unit: string
  direction: string
  snapshotId: string
  triage: TriageDecision
  strategy: { versionId: string | null; version: number | null }
  official: {
    referencePeriod: string
    value: number
    target: number | null
    achievementPercent: number | null
    weightPercent: number | null
    quartile: Quartile | null
    withinReference: boolean | null
    previous: { referencePeriod: string; value: number; quartile: Quartile | null } | null
    valueMovement: Movement | null
    quartileMovement: Movement | null
  }
  population: {
    window: { startDate: string; endDate: string; timeZone: string }
    metric: DiagnosisMetric | null
    interactionsInPeriod: number
    segments: DiagnosisSegment[]
    selectedSegment: { key: string; label: string; reason: string } | null
    overallAverageDurationSeconds: number | null
  }
  sample: SampleAccounting
  /** V1.0.1 — cobertura da avaliação das chamadas avaliadas nesta análise (primeira resposta × reparo único). Ausente em diagnósticos anteriores. */
  coverage?: DiagnosisAssessmentCoverage | null
  /** V2 — passos escolhidos (estratégia × IA × disponibilidade), com o que foi recusado e por quê. Ausente = diagnóstico anterior (FIXED). */
  steps?: InvestigationStepSelection | null
  /** V2 — população sinalizada (flag da estratégia): distribuição por motivo e evolução × período anterior. Ausente = sem sinal. */
  signal?: { flagName: string; distribution: SignalDistribution | null; evolution: SignalEvolution | null } | null
  /** V2 — evidência que a estratégia pede e o CONTRATO DE DADOS não oferece (nada é inferido no lugar dela). */
  evidenceGap?: { step: "PROCESS_ASSESSMENT"; reason: "DATA_CONTRACT_NO_INTERACTION_LINK" } | null
  /** V2 — frases que a estratégia proíbe em texto gerado (aplicadas à narrativa do redator na emissão). */
  prohibitedClaims?: string[]
  mix: MixShift | null
  patterns: OperationalPatternSummary | null
  team: TeamPatternContext
  attribution: { practiceKey: string; title: string; individual: string | null; team: string | null; attribution: BehaviorAttribution }[]
  conclusion: { type: ConclusionType; developmentPatterns: string[]; strengthPatterns: string[]; teamOnlyPatterns: string[]; mixShift: boolean; /** V2 — mudança de composição das interações SINALIZADAS × período anterior. */ signalShift?: boolean }
  supportedFindings: string[]
  unsupportedHypotheses: string[]
  limitations: string[]
}

export const CONCLUSION_LABELS: Record<ConclusionType, string> = {
  ACTIONABLE_PATTERN: "Padrão operacional acionável",
  MIX_AND_OPERATIONAL_PATTERN: "Mudança de mix e padrão operacional",
  MIX_SHIFT: "Mudança de mix de motivos",
  POSITIVE_PATTERN: "Padrão positivo",
  NO_ACTIONABLE_DIAGNOSIS: "Sem padrão acionável",
  INSUFFICIENT_SAMPLE: "Amostra insuficiente",
  INSUFFICIENT_OBSERVABILITY: "Observabilidade insuficiente",
  NO_ELIGIBLE_POPULATION: "Sem chamadas elegíveis",
  NOT_DECOMPOSABLE: "Indicador sem métrica por atendimento",
  INSUFFICIENT_EVIDENCE: "Evidência comportamental indisponível nos dados",
}

const DURATION_LIMITATION = "A duração por motivo é a duração registrada das chamadas — uma aproximação, nunca o cálculo oficial do indicador."
const CAUSALITY_LIMITATION = "Um comportamento observado nas chamadas analisadas não demonstra que ele causou o resultado do indicador."
const MIX_LIMITATION = "A mudança na composição dos motivos aconteceu no mesmo período do resultado — composição não demonstra causa."

export type InvestigationInput = {
  closing: PrvClosing
  triage: TriageDecision
  strategy: { versionId: string | null; version: number | null }
  snapshot: { indicatorId: string; indicatorCode: string; indicatorName: string; unit: string; direction: string; snapshotId: string }
  window: { startDate: string; endDate: string; timeZone: string }
  metric: DiagnosisMetric | null
  interactionsInPeriod: number
  segments: DiagnosisSegment[]
  selectedSegment: { key: string; label: string; reason: string } | null
  overallAverageDurationSeconds: number | null
  sample: SampleAccounting
  minimumAnalyzed: number
  mix: MixShift | null
  patterns: OperationalPatternSummary | null
  team: TeamPatternContext
  /** Onde o plano parou (auditoria): estratégia/segmentação/investigação desligadas, sem motivo elegível etc. */
  planStatus?: string
  /** V1.0.1 — cobertura da avaliação das chamadas avaliadas nesta análise. */
  assessmentCoverage?: DiagnosisAssessmentCoverage | null
  /** V2 — passos escolhidos e população sinalizada (ausentes = comportamento V1, byte a byte). */
  steps?: InvestigationStepSelection | null
  signal?: { flagName: string; distribution: SignalDistribution | null; evolution: SignalEvolution | null } | null
  prohibitedClaims?: string[]
  /** V2 — rótulo exibível do período ("agosto de 2026"); ausente = o da competência do fechamento. */
  periodLabel?: string
}

const PLAN_STATUS_LIMITATIONS: Record<string, string> = {
  STRATEGY_NOT_CONFIGURED: "O indicador não tem estratégia de diagnóstico publicada e ativa.",
  SEGMENTATION_DISABLED: "A estratégia do indicador não localiza o resultado por motivo de atendimento.",
  INVESTIGATION_DISABLED: "A estratégia do indicador não analisa chamadas.",
  DOMAIN_NOT_ALLOWED: "O especialista configurado não pertence aos domínios permitidos pela estratégia.",
  NO_ELIGIBLE_SEGMENT: "Nenhum motivo com chamadas transcritas suficientes no fechamento.",
  EVIDENCE_SOURCE_UNAVAILABLE: "A estratégia pede a avaliação dos atendimentos ANTERIORES vinculados ao sinal, mas os dados de interação não trazem esse vínculo — nenhum atendimento anterior é presumido e nenhum comportamento é avaliado a partir do sinal.",
  PROCESS_NOT_SELECTED: "A investigação escolhida para este período não incluiu a avaliação de processos nos atendimentos.",
}

const signalLimitations = (label: string) => [
  `As interações marcadas como ${label} chegam prontas da fonte de dados: a INIA não define janela nem regra do sinal, só conta o que foi marcado.`,
  `As interações marcadas são as que o colaborador atendeu; os dados não informam qual atendimento anterior originou cada uma, nem quem o atendeu.`,
]

/** Frases de FATO da população sinalizada (números do sistema; composição, nunca causa). */
export function signalFindingsOf(signal: NonNullable<InvestigationInput["signal"]>, periodLabel: string, selected: { distribution: boolean; evolution: boolean }): string[] {
  const findings: string[] = []
  const distribution = signal.distribution
  if (selected.distribution && distribution && distribution.interactions > 0) {
    findings.push(`Em ${periodLabel}, ${distribution.signaled} de ${distribution.interactions} interações atendidas vieram marcadas como ${distribution.signalLabel}${distribution.signalRatePercent !== null ? ` (${formatPercent(distribution.signalRatePercent)})` : ""}.`)
    const concentration = distribution.concentration
    if (concentration) findings.push(`${concentration.label} reuniu ${concentration.signaled} das ${distribution.signaled} interações marcadas como ${distribution.signalLabel} (${formatPercent(concentration.shareOfSignalPercent)}); nesse motivo, ${concentration.signaled} de ${concentration.interactions} interações vieram marcadas (${formatPercent(concentration.signalRatePercent)}), contra ${formatPercent(concentration.othersSignalRatePercent)} nos demais motivos.`)
  }
  const evolution = signal.evolution
  if (selected.evolution && evolution && evolution.status === "AVAILABLE") {
    findings.push(`No período anterior, ${evolution.previous.signaled} de ${evolution.previous.interactions} interações atendidas vieram marcadas${evolution.previous.signalRatePercent !== null ? ` (${formatPercent(evolution.previous.signalRatePercent)})` : ""}.`)
    if (evolution.shifted) findings.push(`${evolution.shifted.label} passou de ${formatPercent(evolution.shifted.previousSharePercent)} para ${formatPercent(evolution.shifted.currentSharePercent)} das interações marcadas entre os dois períodos.`)
  }
  return findings
}

export function buildIndicatorInvestigation(input: InvestigationInput): IndicatorInvestigation {
  const { closing, triage } = input
  const previous = previousSnapshotOf(closing, input.snapshot.indicatorCode)
  const official = {
    referencePeriod: closing.referencePeriod,
    value: triage.official.value,
    target: triage.official.target,
    achievementPercent: triage.official.achievementPercent,
    weightPercent: triage.official.weightPercent,
    quartile: triage.official.quartile,
    withinReference: triage.official.withinReference,
    previous: previous ? { referencePeriod: previous.referencePeriod, value: previous.value, quartile: previous.quartile } : null,
    valueMovement: officialValueMovementOf(previous?.value, triage.official.value, input.snapshot.direction as "HIGHER" | "LOWER" | "TARGET"),
    quartileMovement: quartileMovementOf(previous?.quartile, triage.official.quartile),
  }
  const segmentLabel = input.selectedSegment?.label ?? "motivo investigado"
  const behaviors = input.patterns?.behaviors ?? []
  const teamByKey = new Map(input.team.behaviors.map((behavior) => [behavior.practiceKey, behavior]))
  const keys = [...new Set([...behaviors.map((behavior) => behavior.practiceKey), ...input.team.behaviors.map((behavior) => behavior.practiceKey)])]
  const attribution = keys.map((practiceKey) => {
    const own = behaviors.find((behavior) => behavior.practiceKey === practiceKey) ?? null
    const team = teamByKey.get(practiceKey) ?? null
    return { practiceKey, title: own?.title ?? team?.title ?? practiceKey, individual: own?.classification ?? null, team: team?.classification ?? null, attribution: attributionOf(own?.classification ?? null, team?.classification ?? null) }
  })
  // O colaborador só recebe o que a população DELE sustenta. Reconhecimento nunca procura gap; desenvolvimento nunca é inventado.
  const development = input.triage.decision === "INVESTIGATE" ? behaviors.filter((behavior) => behavior.classification === "DEVELOPMENT").map((behavior) => behavior.practiceKey) : []
  const strength = behaviors.filter((behavior) => behavior.classification === "STRENGTH").map((behavior) => behavior.practiceKey)
  const teamOnly = attribution.filter((entry) => entry.attribution === "TEAM_ONLY").map((entry) => entry.practiceKey)
  const mixShift = input.triage.decision === "INVESTIGATE" && input.mix?.status === "SHIFT"
  // V2 — mudança de composição do SINAL: fato de composição como o mix (nunca causa); só quando o passo foi escolhido.
  const signalShift = input.triage.decision === "INVESTIGATE" && Boolean(input.steps?.selected.includes("SIGNAL_EVOLUTION")) && Boolean(input.signal?.evolution?.shifted)
  const compositionShift = mixShift || signalShift
  const minimum = Math.max(input.minimumAnalyzed, 3)
  const observable = behaviors.some((behavior) => behavior.eligible >= minimum)
  const stopped = input.planStatus && input.planStatus in PLAN_STATUS_LIMITATIONS ? input.planStatus : null
  const type: ConclusionType =
    input.metric === null ? "NOT_DECOMPOSABLE"
    : stopped === "NO_ELIGIBLE_SEGMENT" ? (compositionShift ? "MIX_SHIFT" : "INSUFFICIENT_SAMPLE")
    : stopped === "EVIDENCE_SOURCE_UNAVAILABLE" ? (compositionShift ? "MIX_SHIFT" : "INSUFFICIENT_EVIDENCE")
    : stopped ? (compositionShift ? "MIX_SHIFT" : "NO_ACTIONABLE_DIAGNOSIS")
    : input.interactionsInPeriod === 0 || input.sample.eligibleCount === 0 ? "NO_ELIGIBLE_POPULATION"
    : input.sample.analyzedCount < minimum ? (mixShift ? "MIX_SHIFT" : "INSUFFICIENT_SAMPLE")
    : development.length > 0 ? (compositionShift ? "MIX_AND_OPERATIONAL_PATTERN" : "ACTIONABLE_PATTERN")
    : compositionShift ? "MIX_SHIFT"
    : !observable ? "INSUFFICIENT_OBSERVABILITY"
    : input.triage.decision === "RECOGNIZE" && strength.length > 0 ? "POSITIVE_PATTERN"
    : "NO_ACTIONABLE_DIAGNOSIS"

  const findings: string[] = []
  if (mixShift && input.mix?.shifted) {
    const shift = input.mix.shifted
    findings.push(`${shift.label} passou de ${formatPercent(shift.previousSharePercent)} para ${formatPercent(shift.currentSharePercent)} dos atendimentos do colaborador entre os dois fechamentos${shift.longerDuration && shift.segmentAverageDurationSeconds !== null && shift.othersAverageDurationSeconds !== null ? `; nesse motivo, a duração média registrada foi de ${shift.segmentAverageDurationSeconds} s, contra ${shift.othersAverageDurationSeconds} s nas demais chamadas` : ""}.`)
  }
  for (const behavior of behaviors) {
    if (development.includes(behavior.practiceKey)) findings.push(`${behavior.title}: não seguida em ${behavior.counts.notFollowed} de ${behavior.eligible} chamadas analisadas de ${segmentLabel}.`)
    else if (strength.includes(behavior.practiceKey)) findings.push(`${behavior.title}: seguida em ${behavior.counts.followed} de ${behavior.eligible} chamadas analisadas de ${segmentLabel}.`)
    if (development.includes(behavior.practiceKey) && behavior.concentration) findings.push(`${behavior.title}: ${behavior.concentration.notFollowed} das ${behavior.counts.notFollowed} ocorrências ficaram em ${behavior.concentration.label} (${formatPercent(behavior.concentration.bucketRatePercent)} das chamadas elegíveis desse ${behavior.concentration.dimension === "WEEKDAY" ? "dia" : "período"}, contra ${formatPercent(behavior.concentration.overallRatePercent)} no total).`)
  }
  const periodLabel = input.periodLabel ?? referencePeriodLabel(closing.referencePeriod)
  if (input.signal) findings.push(...signalFindingsOf(input.signal, periodLabel, { distribution: Boolean(input.steps?.selected.includes("SIGNAL_DISTRIBUTION")), evolution: Boolean(input.steps?.selected.includes("SIGNAL_EVOLUTION")) }))
  const unsupported = [
    ...behaviors.filter((behavior) => behavior.classification === "INCONCLUSIVE" && behavior.eligible > 0).map((behavior) => `${behavior.title}: seguida em ${behavior.counts.followed} e não seguida em ${behavior.counts.notFollowed} de ${behavior.eligible} chamadas elegíveis — não sustenta padrão.`),
    ...teamOnly.map((key) => `${attribution.find((entry) => entry.practiceKey === key)!.title}: recorrente no Subgrupo, mas não na população do colaborador — não é atribuída a ele.`),
    "O comportamento observado ou a mudança de mix ter causado o resultado do indicador (associação e composição não são causa).",
    ...(input.signal ? [`Que as interações marcadas como ${input.signal.distribution?.signalLabel ?? input.signal.flagName} tenham sido causadas por um atendimento do colaborador (o vínculo com o atendimento anterior não existe nos dados).`] : []),
  ]
  const limitations: string[] = stopped ? [PLAN_STATUS_LIMITATIONS[stopped]!] : []
  if (input.metric === "INTERACTION_DURATION_SECONDS" && (input.selectedSegment || mixShift)) limitations.push(DURATION_LIMITATION)
  if (input.sample.analyzedCount > 0) limitations.push(`Foram analisadas ${input.sample.analyzedCount} de ${input.sample.eligibleCount} chamadas elegíveis de ${segmentLabel} no período (${input.sample.reusableCount > 0 ? `${input.sample.analyzedCount - input.sample.reanalyzedInteractionCount} com avaliação anterior reaproveitada, ` : ""}${input.sample.reanalyzedInteractionCount} avaliadas nesta análise); a análise não representa todas as chamadas.`)
  const coverage = input.assessmentCoverage ?? null
  if (coverage && coverage.status === "PARTIAL") {
    const partial = coverage.interactions.filter((entry) => entry.status === "PARTIAL").length
    limitations.push(`Em ${partial} de ${coverage.interactionCount} chamadas avaliadas nesta análise, parte das etapas centrais ficou sem avaliação confiável mesmo depois da revisão única; essas etapas não entram na contagem.`)
  }
  if (coverage && coverage.repairBudget.skipped > 0) limitations.push(`${coverage.repairBudget.skipped} chamada(s) não passaram pela revisão da avaliação porque o limite de revisões do diagnóstico (${coverage.repairBudget.maxInteractions}) foi atingido.`)
  if (type === "INSUFFICIENT_SAMPLE") limitations.push(`Não houve chamadas suficientes para concluir um padrão (mínimo de ${minimum}).`)
  if (type === "INSUFFICIENT_OBSERVABILITY") limitations.push("Nas chamadas analisadas, poucas etapas puderam ser observadas com segurança — não há base para um padrão.")
  if (type === "NO_ACTIONABLE_DIAGNOSIS" && !stopped) limitations.push("Não foi identificado um padrão operacional recorrente suficiente para explicar o resultado deste fechamento.")
  if (development.length > 0 || strength.length > 0) limitations.push(CAUSALITY_LIMITATION)
  if (mixShift) limitations.push(MIX_LIMITATION)
  if (input.signal) limitations.push(...signalLimitations(input.signal.distribution?.signalLabel ?? input.signal.flagName))
  if (signalShift) limitations.push("A mudança na composição das interações marcadas aconteceu no mesmo período do resultado — composição não demonstra causa.")
  if (input.signal?.distribution?.status === "INSUFFICIENT_DATA") limitations.push(`Com menos de 5 interações marcadas no período, não há base para falar de distribuição por motivo.`)
  if (input.steps && input.steps.rejected.length > 0) limitations.push(`${input.steps.rejected.length} passo(s) pedido(s) pela investigação não foram executados por estarem fora da estratégia ou indisponíveis nos dados.`)
  limitations.push(...(input.patterns?.limitations ?? []))
  if (input.team.status === "INSUFFICIENT_POPULATION") limitations.push("O agregado do Subgrupo não tem população mínima para comparação.")

  return {
    version: INDICATOR_INVESTIGATION_VERSION,
    indicatorId: input.snapshot.indicatorId,
    indicatorCode: input.snapshot.indicatorCode,
    indicatorName: input.snapshot.indicatorName,
    unit: input.snapshot.unit,
    direction: input.snapshot.direction,
    snapshotId: input.snapshot.snapshotId,
    triage,
    strategy: input.strategy,
    official,
    population: { window: input.window, metric: input.metric, interactionsInPeriod: input.interactionsInPeriod, segments: input.segments, selectedSegment: input.selectedSegment, overallAverageDurationSeconds: input.overallAverageDurationSeconds },
    sample: input.sample,
    ...(coverage ? { coverage } : {}),
    ...(input.steps ? { steps: input.steps } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.prohibitedClaims && input.prohibitedClaims.length > 0 ? { prohibitedClaims: input.prohibitedClaims } : {}),
    ...(stopped === "EVIDENCE_SOURCE_UNAVAILABLE" ? { evidenceGap: { step: "PROCESS_ASSESSMENT" as const, reason: "DATA_CONTRACT_NO_INTERACTION_LINK" as const } } : {}),
    mix: input.mix,
    patterns: input.patterns,
    team: input.team,
    attribution,
    conclusion: { type, developmentPatterns: development, strengthPatterns: strength, teamOnlyPatterns: teamOnly, mixShift, ...(input.signal || input.steps ? { signalShift } : {}) },
    supportedFindings: findings,
    unsupportedHypotheses: unsupported,
    limitations,
  }
}

/**
 * A VERDADE DIAGNÓSTICA ESTRUTURADA (o Diagnostic Artifact genérico): N investigações de indicador + triagem + versões. O nome é
 * histórico — a mesma estrutura serve ao fechamento do PRV (N indicadores) e ao diagnóstico DIRETO de um indicador (V2, `source`).
 */
export type PrvClosingDiagnosis = {
  version: typeof PRV_DIAGNOSIS_LOGIC_VERSION | typeof DIRECT_DIAGNOSIS_LOGIC_VERSION
  /** V2 — origem da execução. Ausente = fechamento do PRV (diagnósticos anteriores). */
  source?: { kind: DiagnosisSourceKind; indicatorCode: string | null; periodLabel: string }
  idempotencyKey: string
  referencePeriod: string
  referencePeriodLabel: string
  personId: string
  prv: OfficialPrvSnapshot | null
  previousPrv: OfficialPrvSnapshot | null
  triage: PrvTriage
  investigations: IndicatorInvestigation[]
  /** Mesmo comportamento com padrão de desenvolvimento em mais de um indicador (o feedback do ciclo pode consolidar). */
  sharedPatterns: { practiceKey: string; title: string; indicators: string[] }[]
  versions: { closingTriage: typeof CLOSING_TRIAGE_VERSION; operationalPattern: typeof OPERATIONAL_PATTERN_VERSION; observationCompatibility: typeof OBSERVATION_COMPATIBILITY_VERSION; investigation: typeof INDICATOR_INVESTIGATION_VERSION }
  generatedAt: string
}

/** Chave de idempotência: mesmo fechamento + mesmas versões de estratégia + mesma lógica = o mesmo diagnóstico. */
export function prvDiagnosisIdempotencyKey(input: { organizationId: string; personId: string; referencePeriod: string; strategies: readonly { indicatorCode: string; strategyVersionId: string | null }[] }): string {
  const fingerprint = [...input.strategies].map((entry) => `${entry.indicatorCode}@${entry.strategyVersionId ?? "none"}`).sort().join("|")
  const hash = createHash("sha256").update(`${input.organizationId}|${input.personId}|${input.referencePeriod}|${fingerprint}`).digest("hex").slice(0, 24)
  return `${PRV_DIAGNOSIS_LOGIC_VERSION}:${input.referencePeriod}:${hash}`
}

/**
 * V2 — chave do diagnóstico DIRETO: indicador + período + destinatário + versão da estratégia + snapshot oficial (id E valores —
 * o fechamento oficial é UPSERT: um valor corrigido pela fonte é outra fonte, outro diagnóstico). Mesma versão + mesma fonte =
 * nunca um segundo diagnóstico; versão nova publicada = diagnóstico novo (o anterior continua gravado).
 */
export function directDiagnosisIdempotencyKey(input: { organizationId: string; personId: string; referencePeriod: string; indicatorCode: string; strategyVersionId: string | null; snapshot: { snapshotId: string; value: number; target: number | null; achievementPercent: number | null; quartile: string | null } }): string {
  const source = `${input.snapshot.snapshotId}:${input.snapshot.value}:${input.snapshot.target ?? "-"}:${input.snapshot.achievementPercent ?? "-"}:${input.snapshot.quartile ?? "-"}`
  const hash = createHash("sha256").update(`${input.organizationId}|${input.personId}|${input.referencePeriod}|${input.indicatorCode}@${input.strategyVersionId ?? "none"}|${source}`).digest("hex").slice(0, 24)
  return `${DIRECT_DIAGNOSIS_LOGIC_VERSION}:${input.referencePeriod}:${hash}`
}

export function buildPrvClosingDiagnosis(input: { closing: PrvClosing; triage: PrvTriage; investigations: IndicatorInvestigation[]; idempotencyKey: string; generatedAt: string; source?: { kind: DiagnosisSourceKind; indicatorCode: string | null } }): PrvClosingDiagnosis {
  const shared = new Map<string, { title: string; indicators: string[] }>()
  for (const investigation of input.investigations) {
    for (const key of investigation.conclusion.developmentPatterns) {
      const title = investigation.patterns?.behaviors.find((behavior) => behavior.practiceKey === key)?.title ?? key
      const entry = shared.get(key) ?? { title, indicators: [] }
      entry.indicators.push(investigation.indicatorCode)
      shared.set(key, entry)
    }
  }
  const direct = input.source?.kind === "DIRECT_INDICATOR"
  return {
    version: direct ? DIRECT_DIAGNOSIS_LOGIC_VERSION : PRV_DIAGNOSIS_LOGIC_VERSION,
    ...(input.source ? { source: { kind: input.source.kind, indicatorCode: input.source.indicatorCode, periodLabel: referencePeriodLabel(input.closing.referencePeriod) } } : {}),
    idempotencyKey: input.idempotencyKey,
    referencePeriod: input.closing.referencePeriod,
    referencePeriodLabel: referencePeriodLabel(input.closing.referencePeriod),
    personId: input.closing.personId,
    prv: input.closing.prv,
    previousPrv: input.closing.previous?.prv ?? null,
    triage: input.triage,
    investigations: input.investigations,
    sharedPatterns: [...shared.entries()].filter(([, entry]) => entry.indicators.length > 1).map(([practiceKey, entry]) => ({ practiceKey, ...entry })),
    versions: { closingTriage: CLOSING_TRIAGE_VERSION, operationalPattern: OPERATIONAL_PATTERN_VERSION, observationCompatibility: OBSERVATION_COMPATIBILITY_VERSION, investigation: INDICATOR_INVESTIGATION_VERSION },
    generatedAt: input.generatedAt,
  }
}
