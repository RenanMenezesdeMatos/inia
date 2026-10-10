import { isObservationEligibleForAnalytics } from "./observation-readiness.js"

/**
 * INDICATOR DIAGNOSIS V1 — AGREGAÇÃO DETERMINÍSTICA DOS PADRÕES OPERACIONAIS (`summarizeOperationalPatterns`, domínio puro,
 * ZERO modelo). O modelo nunca conta, nunca calcula percentual, denominador, média, frequência nem distribuição: recebe isto pronto.
 *
 *   entrada   observações de processo (reaproveitadas + avaliadas agora) + metadados dos atendimentos (motivo, dia, hora)
 *   UMA CONTRIBUIÇÃO por atendimento × comportamento (a identidade canônica — `BEHAVIOR:`/`CHECKPOINT:` — vence o número de fontes):
 *             NOT_FOLLOWED > FOLLOWED > NOT_OBSERVABLE > NOT_APPLICABLE, como no agrupamento da amostra.
 *   denominador semântico: só FOLLOWED + NOT_FOLLOWED ELEGÍVEIS (`isObservationEligibleForAnalytics`). NOT_APPLICABLE nunca é gap;
 *             NOT_OBSERVABLE nunca vira "não seguiu"; etapa composta PARCIAL conta como não seguida (e à parte como parcial), nunca
 *             como seguida; observação que precisa de revisão fica FORA (contada à parte como "inelegível").
 *
 * Classificação (`OPERATIONAL_PATTERN_V1`) — mais exigente que a da amostra do V1.6.1, porque aqui a conclusão vira feedback de
 * CICLO: DEVELOPMENT = ≥ mínimo de chamadas elegíveis, ≥ 3 não seguidas e ≥ 60 % das elegíveis; STRENGTH = ≥ 3 seguidas e ≥ 80 %
 * das elegíveis; resto INCONCLUSIVE (fica na auditoria). "2 seguidas, 2 não seguidas, 1 não observável" não é padrão.
 *
 * Concentração por dia da semana / faixa horária só com volume (≥ 10 chamadas elegíveis no comportamento, ≥ 4 no dia/faixa) e
 * diferença material (a taxa de não seguida no dia ≥ taxa geral + 20 p.p. e o dia concentra ≥ metade das ocorrências).
 */
export const OPERATIONAL_PATTERN_VERSION = "OPERATIONAL_PATTERN_V1" as const

export const PATTERN_MIN_ELIGIBLE = 3
export const PATTERN_MIN_OCCURRENCES = 3
export const DEVELOPMENT_MIN_SHARE = 0.6
export const STRENGTH_MIN_SHARE = 0.8
export const CONCENTRATION_MIN_ELIGIBLE = 10
export const CONCENTRATION_MIN_BUCKET = 4
export const CONCENTRATION_MIN_LIFT = 0.2
export const EVIDENCE_CANDIDATES_PER_PATTERN = 3

export type ObservationStatus = "FOLLOWED" | "NOT_FOLLOWED" | "NOT_OBSERVABLE" | "NOT_APPLICABLE"

export type OperationalObservation = {
  interactionId: string
  practiceKey: string
  behavior: string | null
  title: string
  requirement: string
  documentId: string | null
  documentTitle: string | null
  status: ObservationStatus
  completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN" | null
  /** Prontidão analítica da observação (VERIFIED = elegível). Irrelevante para NOT_OBSERVABLE/NOT_APPLICABLE. */
  analyticsStatus: "VERIFIED" | "NEEDS_REVIEW" | "REJECTED"
  origin: "REUSED" | "ASSESSED"
  /** Falas do operador display-safe (projeção de exibição já aplicada). */
  evidence: { text: string; truncated: boolean }[]
  /** Regra oficial verificada (literal) e orientação oficial (só com regra) — para o "o que o processo orienta". */
  rule: { documentId: string; documentTitle: string; heading: string | null; quote: string } | null
  guidance: string | null
}

export type InteractionMeta = { interactionId: string; localDate: string; weekday: number; hour: number; segmentKey: string | null; segmentLabel: string | null; origin: "REUSED" | "ASSESSED" }

export type PatternClassification = "DEVELOPMENT" | "STRENGTH" | "INCONCLUSIVE"
export type DistributionBucket = { key: string; label: string; eligible: number; notFollowed: number }
export type Concentration = { dimension: "WEEKDAY" | "HOUR_BAND"; key: string; label: string; eligible: number; notFollowed: number; share: number; bucketRatePercent: number; overallRatePercent: number }

export type BehaviorPattern = {
  practiceKey: string
  behavior: string | null
  title: string
  requirement: string
  documentTitle: string | null
  counts: { followed: number; notFollowed: number; partial: number; notObservable: number; notApplicable: number; ineligible: number }
  /** F + NF elegíveis — o único denominador de "não seguida em X de Y". */
  eligible: number
  notFollowedRatePercent: number | null
  classification: PatternClassification
  interactions: { followed: string[]; notFollowed: string[] }
  byWeekday: DistributionBucket[]
  byHourBand: DistributionBucket[]
  concentration: Concentration | null
  evidenceCandidates: { interactionId: string; localDate: string; text: string; truncated: boolean }[]
  rule: OperationalObservation["rule"]
  guidance: string | null
}

export type OperationalPatternSummary = {
  version: typeof OPERATIONAL_PATTERN_VERSION
  analyzedInteractions: number
  reusedInteractions: number
  assessedInteractions: number
  behaviors: BehaviorPattern[]
  processDistribution: { documentTitle: string; behaviors: number; eligible: number; notFollowed: number }[]
  reasonDistribution: { key: string; label: string; interactions: number }[]
  dayDistribution: { key: string; label: string; interactions: number }[]
  coverage: { eligiblePopulation: number; analyzed: number; percent: number | null }
  limitations: string[]
}

export const WEEKDAY_LABELS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"]
const HOUR_BANDS = [
  { key: "MADRUGADA", label: "madrugada (0h–6h)", from: 0, to: 6 },
  { key: "MANHA", label: "manhã (6h–12h)", from: 6, to: 12 },
  { key: "TARDE", label: "tarde (12h–18h)", from: 12, to: 18 },
  { key: "NOITE", label: "noite (18h–24h)", from: 18, to: 24 },
]
const hourBandOf = (hour: number) => HOUR_BANDS.find((band) => hour >= band.from && hour < band.to) ?? HOUR_BANDS[0]!
const STATUS_PRIORITY: Record<ObservationStatus, number> = { NOT_FOLLOWED: 0, FOLLOWED: 1, NOT_OBSERVABLE: 2, NOT_APPLICABLE: 3 }
const round1 = (value: number) => Math.round(value * 10) / 10

export function classifyOperationalPattern(input: { eligible: number; followed: number; notFollowed: number }, minimumEligible: number = PATTERN_MIN_ELIGIBLE): PatternClassification {
  const minimum = Math.max(minimumEligible, PATTERN_MIN_ELIGIBLE)
  if (input.eligible < minimum) return "INCONCLUSIVE"
  if (input.notFollowed >= PATTERN_MIN_OCCURRENCES && input.notFollowed / input.eligible >= DEVELOPMENT_MIN_SHARE) return "DEVELOPMENT"
  if (input.followed >= PATTERN_MIN_OCCURRENCES && input.followed / input.eligible >= STRENGTH_MIN_SHARE) return "STRENGTH"
  return "INCONCLUSIVE"
}

function concentrationOf(buckets: readonly DistributionBucket[], dimension: Concentration["dimension"], eligible: number, notFollowed: number): Concentration | null {
  if (eligible < CONCENTRATION_MIN_ELIGIBLE || notFollowed === 0) return null
  const overall = notFollowed / eligible
  const candidates = buckets
    .filter((bucket) => bucket.eligible >= CONCENTRATION_MIN_BUCKET && bucket.notFollowed / notFollowed >= 0.5 && bucket.notFollowed / bucket.eligible >= overall + CONCENTRATION_MIN_LIFT)
    .sort((a, b) => b.notFollowed - a.notFollowed || a.key.localeCompare(b.key))
  const top = candidates[0]
  if (!top) return null
  return { dimension, key: top.key, label: top.label, eligible: top.eligible, notFollowed: top.notFollowed, share: round1((top.notFollowed / notFollowed) * 100), bucketRatePercent: round1((top.notFollowed / top.eligible) * 100), overallRatePercent: round1(overall * 100) }
}

/** Uma contribuição por atendimento × comportamento (a fonte que prevalece pela prioridade de status). */
export function dedupeByInteractionAndBehavior(observations: readonly OperationalObservation[]): OperationalObservation[] {
  const byKey = new Map<string, OperationalObservation>()
  for (const observation of observations) {
    const key = `${observation.interactionId}|${observation.practiceKey}`
    const current = byKey.get(key)
    if (!current || STATUS_PRIORITY[observation.status] < STATUS_PRIORITY[current.status]) byKey.set(key, current ? { ...observation, evidence: observation.evidence.length > 0 ? observation.evidence : current.evidence, rule: observation.rule ?? current.rule, guidance: observation.guidance ?? current.guidance } : observation)
    else if (current && !current.rule && observation.rule) byKey.set(key, { ...current, rule: observation.rule, guidance: current.guidance ?? observation.guidance })
  }
  return [...byKey.values()]
}

const eligibleForCount = (observation: OperationalObservation) => (observation.status === "FOLLOWED" || observation.status === "NOT_FOLLOWED") && isObservationEligibleForAnalytics({ status: observation.status, completeness: observation.completeness, analyticsStatus: observation.analyticsStatus })

export function summarizeOperationalPatterns(input: { interactions: readonly InteractionMeta[]; observations: readonly OperationalObservation[]; eligiblePopulation: number; minimumEligible?: number }): OperationalPatternSummary {
  const meta = new Map(input.interactions.map((interaction) => [interaction.interactionId, interaction]))
  // Só observações de atendimentos DO recorte (nunca misturar chamadas fora da população).
  const inScope = dedupeByInteractionAndBehavior(input.observations.filter((observation) => meta.has(observation.interactionId)))
  const byPractice = new Map<string, OperationalObservation[]>()
  for (const observation of inScope) byPractice.set(observation.practiceKey, [...(byPractice.get(observation.practiceKey) ?? []), observation])

  const behaviors: BehaviorPattern[] = [...byPractice.entries()].map(([practiceKey, entries]) => {
    const counted = entries.filter(eligibleForCount)
    const followed = counted.filter((entry) => entry.status === "FOLLOWED")
    const notFollowed = counted.filter((entry) => entry.status === "NOT_FOLLOWED")
    const weekday = new Map<number, DistributionBucket>()
    const hourBand = new Map<string, DistributionBucket>()
    for (const entry of counted) {
      const info = meta.get(entry.interactionId)!
      const day = weekday.get(info.weekday) ?? { key: String(info.weekday), label: WEEKDAY_LABELS[info.weekday]!, eligible: 0, notFollowed: 0 }
      day.eligible += 1
      if (entry.status === "NOT_FOLLOWED") day.notFollowed += 1
      weekday.set(info.weekday, day)
      const band = hourBandOf(info.hour)
      const bucket = hourBand.get(band.key) ?? { key: band.key, label: band.label, eligible: 0, notFollowed: 0 }
      bucket.eligible += 1
      if (entry.status === "NOT_FOLLOWED") bucket.notFollowed += 1
      hourBand.set(band.key, bucket)
    }
    const byWeekday = [...weekday.entries()].sort((a, b) => a[0] - b[0]).map(([, bucket]) => bucket)
    const byHourBand = HOUR_BANDS.map((band) => hourBand.get(band.key)).filter((bucket): bucket is DistributionBucket => Boolean(bucket))
    const eligible = counted.length
    const classification = classifyOperationalPattern({ eligible, followed: followed.length, notFollowed: notFollowed.length }, input.minimumEligible)
    const concentration = classification === "DEVELOPMENT" ? concentrationOf(byWeekday, "WEEKDAY", eligible, notFollowed.length) ?? concentrationOf(byHourBand, "HOUR_BAND", eligible, notFollowed.length) : null
    // Evidência representativa: poucas chamadas (nunca dezenas), da classe que define o padrão, em ordem de data.
    const defining = classification === "STRENGTH" ? followed : notFollowed
    const evidenceCandidates = defining
      .filter((entry) => entry.evidence.length > 0)
      .map((entry) => ({ interactionId: entry.interactionId, localDate: meta.get(entry.interactionId)!.localDate, text: entry.evidence[0]!.text, truncated: entry.evidence[0]!.truncated }))
      .sort((a, b) => a.localDate.localeCompare(b.localDate) || a.interactionId.localeCompare(b.interactionId))
      .slice(0, EVIDENCE_CANDIDATES_PER_PATTERN)
    const withRule = entries.find((entry) => entry.rule) ?? null
    const first = entries[0]!
    return {
      practiceKey,
      behavior: first.behavior,
      title: first.title,
      requirement: first.requirement,
      documentTitle: withRule?.rule?.documentTitle ?? first.documentTitle,
      counts: {
        followed: followed.length,
        notFollowed: notFollowed.length,
        partial: notFollowed.filter((entry) => entry.completeness === "PARTIAL").length,
        notObservable: entries.filter((entry) => entry.status === "NOT_OBSERVABLE").length,
        notApplicable: entries.filter((entry) => entry.status === "NOT_APPLICABLE").length,
        ineligible: entries.filter((entry) => (entry.status === "FOLLOWED" || entry.status === "NOT_FOLLOWED") && !eligibleForCount(entry)).length,
      },
      eligible,
      notFollowedRatePercent: eligible > 0 ? round1((notFollowed.length / eligible) * 100) : null,
      classification,
      interactions: { followed: followed.map((entry) => entry.interactionId), notFollowed: notFollowed.map((entry) => entry.interactionId) },
      byWeekday,
      byHourBand,
      concentration,
      evidenceCandidates,
      rule: withRule?.rule ?? null,
      guidance: withRule?.rule ? withRule.guidance : null,
    }
  })
  const order: Record<PatternClassification, number> = { DEVELOPMENT: 0, STRENGTH: 1, INCONCLUSIVE: 2 }
  behaviors.sort((a, b) => order[a.classification] - order[b.classification] || b.counts.notFollowed - a.counts.notFollowed || b.eligible - a.eligible || a.title.localeCompare(b.title))

  const processes = new Map<string, { documentTitle: string; behaviors: number; eligible: number; notFollowed: number }>()
  for (const behavior of behaviors) {
    const title = behavior.documentTitle ?? "Sem documento identificado"
    const entry = processes.get(title) ?? { documentTitle: title, behaviors: 0, eligible: 0, notFollowed: 0 }
    entry.behaviors += 1
    entry.eligible += behavior.eligible
    entry.notFollowed += behavior.counts.notFollowed
    processes.set(title, entry)
  }
  const reasons = new Map<string, { key: string; label: string; interactions: number }>()
  const days = new Map<number, number>()
  for (const interaction of input.interactions) {
    const key = interaction.segmentKey ?? "SEM_MOTIVO"
    const reason = reasons.get(key) ?? { key, label: interaction.segmentLabel ?? "Sem motivo registrado", interactions: 0 }
    reason.interactions += 1
    reasons.set(key, reason)
    days.set(interaction.weekday, (days.get(interaction.weekday) ?? 0) + 1)
  }
  const analyzed = input.interactions.length
  const limitations: string[] = []
  const reused = input.interactions.filter((interaction) => interaction.origin === "REUSED").length
  if (reused > 0) limitations.push("Nas chamadas avaliadas anteriormente, só as etapas seguidas ou não seguidas ficaram registradas: etapas não observáveis ou não aplicáveis dessas chamadas não entram na contagem.")
  if (behaviors.some((behavior) => behavior.counts.ineligible > 0)) limitations.push("Observações que ainda precisam de revisão ficaram fora das contagens.")
  return {
    version: OPERATIONAL_PATTERN_VERSION,
    analyzedInteractions: analyzed,
    reusedInteractions: reused,
    assessedInteractions: analyzed - reused,
    behaviors,
    processDistribution: [...processes.values()].sort((a, b) => b.notFollowed - a.notFollowed || a.documentTitle.localeCompare(b.documentTitle)),
    reasonDistribution: [...reasons.values()].sort((a, b) => b.interactions - a.interactions || a.label.localeCompare(b.label)),
    dayDistribution: [...days.entries()].sort((a, b) => a[0] - b[0]).map(([weekday, interactions]) => ({ key: String(weekday), label: WEEKDAY_LABELS[weekday]!, interactions })),
    coverage: { eligiblePopulation: input.eligiblePopulation, analyzed, percent: input.eligiblePopulation > 0 ? round1((analyzed / input.eligiblePopulation) * 100) : null },
    limitations,
  }
}
