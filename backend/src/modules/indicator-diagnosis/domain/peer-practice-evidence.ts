import { isComparablePracticeKey } from "./observation-readiness.js"
import type { IndicatorDirection } from "../../indicators/domain/indicator-canonical-context.js"

/**
 * V1.6.1 — PEER PRACTICE EVIDENCE (primeira versão real de VERIFIED_PEER_PATTERN; domínio puro, sem LLM).
 *
 * Pergunta que responde: "no grupo de referência com bons resultados, em situações COMPARÁVEIS, com que frequência esta etapa
 * da base foi observada?". Regras que o código aplica:
 *
 *   GRUPO DE REFERÊNCIA  determinístico, nunca escolhido por modelo: colaboradores ATIVOS do MESMO Grupo, com medição do
 *                        MESMO indicador no MESMO período (mesmo início/fim), ordenados pelo valor OFICIAL da medição conforme
 *                        a direção ("quanto menor/maior, melhor"; empate pelo id) → o QUARTIL de melhor resultado
 *                        (⌈n/4⌉). O próprio colaborador nunca entra. Direção "atingir a meta" não é ordenável → sem evidência.
 *   COMPARABILIDADE      mesma PRÁTICA (documento + trecho literal verificado da base — `KB:` do practice key) e mesmo MOTIVO
 *                        (assunto canônico/bruto) e mesmo período. Prática sem identidade da base, motivo desconhecido ou
 *                        amostra própria vazia → sem comparação.
 *   DADO                 observações PERSISTIDAS e verificadas (`process_checkpoint_observations`: etapa FOLLOWED/NOT_FOLLOWED
 *                        com fala do operador e regra VERIFIED), nunca uma análise ad hoc de fala de colega.
 *   PRIVACIDADE          só agregado. Grupo de referência ≥ 4 pessoas (a mesma `MINIMUM_COMPARISON_POPULATION` das Tools),
 *                        ≥ 4 pessoas contribuindo e ≥ 5 atendimentos observados; abaixo disso a evidência NÃO existe. Nunca
 *                        nome, matrícula, valor individual ou fala de colega.
 *   CAUSALIDADE          associação ≠ causa: `causalClaimAllowed` é sempre false.
 */
export const PEER_PRACTICE_EVIDENCE_CONTRACT = "PEER_PRACTICE_EVIDENCE_V1" as const
export const PEER_MINIMUM_POPULATION = 4
export const PEER_MINIMUM_OBSERVED_INTERACTIONS = 5
/** Diferença (pontos percentuais) a partir da qual a frequência é "maior/menor no grupo de referência". */
export const PEER_COMPARISON_THRESHOLD_POINTS = 20

export type ReferenceGroupDefinition = {
  rule: "TOP_QUARTILE_SAME_GROUP_SAME_PERIOD"
  indicatorCode: string
  period: { start: string; end: string }
  eligiblePopulation: number
  referenceSize: number
  description: string
}

export type ReferenceGroup = { ok: true; members: string[]; definition: ReferenceGroupDefinition } | { ok: false; reason: "DIRECTION_NOT_RANKABLE" | "NO_REFERENCE_DATA" | "POPULATION_BELOW_MINIMUM"; eligiblePopulation: number }

/** `minimumPopulation` (V1.6.2): mínimo da estratégia — nunca abaixo do piso de privacidade do produto. */
export function referenceGroupOf(peers: readonly { personId: string; value: number }[], input: { direction: IndicatorDirection; indicatorCode: string; period: { start: string; end: string }; minimumPopulation?: number }): ReferenceGroup {
  if (input.direction === "TARGET") return { ok: false, reason: "DIRECTION_NOT_RANKABLE", eligiblePopulation: peers.length }
  if (peers.length === 0) return { ok: false, reason: "NO_REFERENCE_DATA", eligiblePopulation: 0 }
  const ordered = [...peers].sort((a, b) => (input.direction === "LOWER" ? a.value - b.value : b.value - a.value) || a.personId.localeCompare(b.personId))
  const size = Math.ceil(ordered.length / 4)
  if (size < Math.max(input.minimumPopulation ?? PEER_MINIMUM_POPULATION, PEER_MINIMUM_POPULATION)) return { ok: false, reason: "POPULATION_BELOW_MINIMUM", eligiblePopulation: peers.length }
  return {
    ok: true,
    members: ordered.slice(0, size).map((peer) => peer.personId),
    definition: {
      rule: "TOP_QUARTILE_SAME_GROUP_SAME_PERIOD",
      indicatorCode: input.indicatorCode,
      period: input.period,
      eligiblePopulation: peers.length,
      referenceSize: size,
      description: `quartil de melhor resultado oficial do indicador no mesmo Grupo e no mesmo período (${size} de ${peers.length} pessoas)`,
    },
  }
}

export type PeerObservationRow = { personId: string; interactionId: string; practiceKey: string; status: "FOLLOWED" | "NOT_FOLLOWED"; segmentKey: string | null }

export type PeerPracticeEvidence = {
  contract: typeof PEER_PRACTICE_EVIDENCE_CONTRACT
  status: "AVAILABLE"
  indicator: { code: string; name: string }
  practiceKey: string
  segment: { key: string; label: string }
  populationDefinition: ReferenceGroupDefinition
  populationSize: number
  contributors: number
  interactionCount: number
  followed: number
  prevalencePercent: number
  own: { followed: number; observed: number; prevalencePercent: number }
  comparison: "HIGHER_IN_REFERENCE" | "SIMILAR" | "LOWER_IN_REFERENCE"
  differencePoints: number
  privacySatisfied: true
  causalClaimAllowed: false
  provenance: { source: "process_checkpoint_observations"; method: string; computedAt: string }
}
export type NoPeerEvidenceReason = ReferenceGroup extends infer R ? (R extends { ok: false; reason: infer X } ? X : never) : never
export type NoPeerEvidence = {
  contract: typeof PEER_PRACTICE_EVIDENCE_CONTRACT
  status: "NO_PEER_EVIDENCE"
  practiceKey: string
  reason: NoPeerEvidenceReason | "PRACTICE_NOT_COMPARABLE" | "SEGMENT_NOT_COMPARABLE" | "OWN_SAMPLE_EMPTY" | "CONTRIBUTORS_BELOW_MINIMUM" | "INSUFFICIENT_OBSERVATIONS"
}
export type PeerPracticeResult = PeerPracticeEvidence | NoPeerEvidence

const round1 = (value: number) => Math.round(value * 10) / 10

export function buildPeerPracticeEvidence(input: {
  indicator: { code: string; name: string }
  practiceKey: string
  segment: { key: string; label: string } | null
  own: { followed: number; notFollowed: number }
  reference: ReferenceGroup
  observations: readonly PeerObservationRow[]
  computedAt: string
  /** V1.6.2 — mínimos da estratégia (nunca abaixo dos pisos do produto). */
  minimums?: { contributors?: number; observedInteractions?: number }
}): PeerPracticeResult {
  const none = (reason: NoPeerEvidence["reason"]): NoPeerEvidence => ({ contract: PEER_PRACTICE_EVIDENCE_CONTRACT, status: "NO_PEER_EVIDENCE", practiceKey: input.practiceKey, reason })
  if (!isComparablePracticeKey(input.practiceKey)) return none("PRACTICE_NOT_COMPARABLE")
  if (!input.segment) return none("SEGMENT_NOT_COMPARABLE")
  const ownObserved = input.own.followed + input.own.notFollowed
  if (ownObserved === 0) return none("OWN_SAMPLE_EMPTY")
  if (!input.reference.ok) return none(input.reference.reason)
  const members = new Set(input.reference.members)
  // Só a MESMA prática, no MESMO motivo, de quem está no grupo de referência — um status por atendimento.
  const byInteraction = new Map<string, PeerObservationRow>()
  for (const row of input.observations) {
    if (row.practiceKey !== input.practiceKey || row.segmentKey !== input.segment.key || !members.has(row.personId)) continue
    const current = byInteraction.get(row.interactionId)
    if (!current || (current.status === "FOLLOWED" && row.status === "NOT_FOLLOWED")) byInteraction.set(row.interactionId, row)
  }
  const rows = [...byInteraction.values()]
  const contributors = new Set(rows.map((row) => row.personId)).size
  if (contributors < Math.max(input.minimums?.contributors ?? PEER_MINIMUM_POPULATION, PEER_MINIMUM_POPULATION)) return none("CONTRIBUTORS_BELOW_MINIMUM")
  if (rows.length < Math.max(input.minimums?.observedInteractions ?? PEER_MINIMUM_OBSERVED_INTERACTIONS, PEER_MINIMUM_OBSERVED_INTERACTIONS)) return none("INSUFFICIENT_OBSERVATIONS")
  const followed = rows.filter((row) => row.status === "FOLLOWED").length
  const prevalencePercent = round1((followed / rows.length) * 100)
  const ownPrevalence = round1((input.own.followed / ownObserved) * 100)
  const differencePoints = round1(prevalencePercent - ownPrevalence)
  return {
    contract: PEER_PRACTICE_EVIDENCE_CONTRACT,
    status: "AVAILABLE",
    indicator: input.indicator,
    practiceKey: input.practiceKey,
    segment: input.segment,
    populationDefinition: input.reference.definition,
    populationSize: input.reference.definition.referenceSize,
    contributors,
    interactionCount: rows.length,
    followed,
    prevalencePercent,
    own: { followed: input.own.followed, observed: ownObserved, prevalencePercent: ownPrevalence },
    comparison: differencePoints >= PEER_COMPARISON_THRESHOLD_POINTS ? "HIGHER_IN_REFERENCE" : differencePoints <= -PEER_COMPARISON_THRESHOLD_POINTS ? "LOWER_IN_REFERENCE" : "SIMILAR",
    differencePoints,
    privacySatisfied: true,
    causalClaimAllowed: false,
    provenance: { source: "process_checkpoint_observations", method: "contagem de atendimentos por status da etapa (um status por atendimento), só observações verificadas", computedAt: input.computedAt },
  }
}

const COMPARISON_TEXT: Record<PeerPracticeEvidence["comparison"], string> = {
  HIGHER_IN_REFERENCE: "frequência maior que na sua amostra",
  SIMILAR: "frequência semelhante à da sua amostra",
  LOWER_IN_REFERENCE: "frequência menor que na sua amostra",
}

/** Frase exibível (só agregado; nenhum nome, valor individual ou fala de colega). */
export function peerFactText(evidence: PeerPracticeEvidence): string {
  return `Grupo de referência (${evidence.populationDefinition.description}): a etapa foi identificada em ${evidence.followed} de ${evidence.interactionCount} atendimentos analisados de ${evidence.segment.label}; na sua amostra, em ${evidence.own.followed} de ${evidence.own.observed} — ${COMPARISON_TEXT[evidence.comparison]}.`
}

export const NO_PEER_EVIDENCE_LABELS: Record<NoPeerEvidence["reason"], string> = {
  DIRECTION_NOT_RANKABLE: "indicador sem direção ordenável (o objetivo é atingir a meta)",
  NO_REFERENCE_DATA: "nenhum colega do Grupo com medição do mesmo indicador no mesmo período",
  POPULATION_BELOW_MINIMUM: "grupo de referência menor que o mínimo de privacidade",
  PRACTICE_NOT_COMPARABLE: "etapa sem regra verificada da base (não é comparável entre pessoas)",
  SEGMENT_NOT_COMPARABLE: "motivo dos atendimentos não identificado",
  OWN_SAMPLE_EMPTY: "etapa não observável na sua amostra",
  CONTRIBUTORS_BELOW_MINIMUM: "poucas pessoas do grupo de referência com essa etapa observada no mesmo motivo",
  INSUFFICIENT_OBSERVATIONS: "poucos atendimentos do grupo de referência com essa etapa observada no mesmo motivo",
}
