import type { IndicatorDirection } from "../../indicators/domain/indicator-canonical-context.js"
import type { SamplingMetadata } from "../../investigation/domain/sampling-strategy.js"

/**
 * V1.6.1 — INDICATOR DIAGNOSIS (domínio puro). O indicador é o SINAL inicial, nunca a fonte de uma dica:
 *
 *   resultado oficial (contexto canônico) → ONDE o resultado se concentra (decomposição pelas dimensões REAIS dos dados)
 *     → QUAIS chamadas investigar (amostra determinística do segmento) → ProcessAssessment por chamada (V1.6.0)
 *     → padrões agregados por etapa da base → evidência de pares (só agregado) → feedback confiável.
 *
 * Tudo aqui é determinístico e calculado pelo SISTEMA: dimensão, segmento escolhido, amostra, contagens e limitações. O LLM
 * nunca escolhe onde investigar, nunca rotula um motivo de "simples/complexo", nunca calcula número.
 *
 * Decomposição V1: só a dimensão ASSUNTO (motivo canônico da interação, com o bruto como fallback), porque é a única que liga
 * uma chamada a um processo da base. A métrica por segmento é a das interações — DURAÇÃO registrada para indicador em
 * SEGUNDOS e VOLUME para indicador em contagem (mesma regra por UNIDADE das Tools de investigação, nunca por código) —
 * e é sempre uma APROXIMAÇÃO, nunca o cálculo oficial do indicador. Unidade sem métrica de interação (ex.: percentual) =
 * indicador NÃO decomponível nesta versão: o feedback fica factual.
 */
export const INDICATOR_DIAGNOSIS_CONTRACT = "INDICATOR_DIAGNOSIS_V1" as const
export const INDICATOR_DIAGNOSIS_PLAN_VERSION = "INDICATOR_DIAGNOSIS_PLAN_V1" as const

/** Um segmento só é investigável com pelo menos 3 atendimentos COM transcrição no período. */
export const DIAGNOSIS_MIN_SEGMENT_INTERACTIONS = 3
/** Teto da amostra por diagnóstico (a mesma ordem de grandeza da análise de interações das Tools). */
export const DIAGNOSIS_SAMPLE_SIZE = 5
/** Padrão só existe com pelo menos 3 atendimentos analisados no segmento. */
export const DIAGNOSIS_MIN_ANALYZED = 3

/** V2 — INTERACTION_SIGNAL_RATE: indicador de taxa cujo evento é marcado em cada interação por um sinal JÁ calculado pela fonte (flag declarada na estratégia). */
export type DiagnosisMetric = "INTERACTION_DURATION_SECONDS" | "INTERACTION_COUNT" | "INTERACTION_SIGNAL_RATE"
export type DiagnosisDimension = "SUBJECT"

export type DiagnosisSegment = {
  /** Chave técnica do segmento = assunto canônico (ou o bruto exato quando não há canônico). */
  key: string
  label: string
  canonical: boolean
  interactions: number
  withTranscript: number
  /** Duração média registrada (s) — só a métrica de interação, nunca o indicador. */
  averageDurationSeconds: number | null
  /** Participação no total de atendimentos do período (0–100, 1 casa). */
  sharePercent: number
  eligible: boolean
}

export type DiagnosisSampleEntry = { handle: string; interactionId: string; startedAt: string; localDate: string }

/** V1.6.2: + o que a ESTRATÉGIA decide — não configurada/inativa, segmentação ou investigação desligadas, Agent fora dos domínios. */
export type DiagnosisPlanStatus = "READY_FOR_ASSESSMENT" | "NOT_DECOMPOSABLE" | "NO_INTERACTIONS" | "NO_ELIGIBLE_SEGMENT" | "STRATEGY_NOT_CONFIGURED" | "SEGMENTATION_DISABLED" | "INVESTIGATION_DISABLED" | "DOMAIN_NOT_ALLOWED"

export type IndicatorDiagnosisPlan = {
  contract: typeof INDICATOR_DIAGNOSIS_PLAN_VERSION
  measurementId: string
  collaboratorId: string
  indicator: { code: string; name: string; unit: string; direction: IndicatorDirection }
  /** Janela da MEDIÇÃO (instantes ISO, fim exclusivo) + rótulo local. A investigação nunca sai dela. */
  period: { start: string; end: string; label: string }
  dimension: DiagnosisDimension
  metric: DiagnosisMetric | null
  interactionsInPeriod: number
  overallAverageDurationSeconds: number | null
  segments: DiagnosisSegment[]
  selectedSegment: { key: string; label: string; reason: string } | null
  sample: DiagnosisSampleEntry[]
  sampling: SamplingMetadata | null
  status: DiagnosisPlanStatus
  /** V1.6.2 — a versão da estratégia que parametrizou este plano (null = sem estratégia publicada). */
  strategy: { versionId: string | null; version: number | null }
}

export function diagnosisMetricFor(unit: string): DiagnosisMetric | null {
  if (unit === "SECONDS") return "INTERACTION_DURATION_SECONDS"
  if (unit === "COUNT") return "INTERACTION_COUNT"
  return null
}

/**
 * V2 — métrica por atendimento a partir da UNIDADE e, quando a estratégia declara, do SINAL DA POPULAÇÃO (nunca do código do
 * indicador): a unidade manda (duração/volume, o comportamento de sempre); sem métrica pela unidade, um sinal declarado torna o
 * indicador decomponível pela taxa de interações sinalizadas.
 */
export function diagnosisMetricOf(unit: string, populationSignal: { flagName: string } | null): DiagnosisMetric | null {
  return diagnosisMetricFor(unit) ?? (populationSignal ? "INTERACTION_SIGNAL_RATE" : null)
}

const round1 = (value: number) => Math.round(value * 10) / 10

/** Segmentos com participação e elegibilidade — ordem: mais atendimentos primeiro, empate pelo rótulo. */
export function buildSegments(rows: readonly { key: string; label: string; canonical: boolean; interactions: number; withTranscript: number; averageDurationSeconds: number | null }[], minimumSegmentInteractions: number = DIAGNOSIS_MIN_SEGMENT_INTERACTIONS): DiagnosisSegment[] {
  const total = rows.reduce((sum, row) => sum + row.interactions, 0)
  return rows
    .map((row) => ({ ...row, sharePercent: total > 0 ? round1((row.interactions / total) * 100) : 0, eligible: row.withTranscript >= Math.max(minimumSegmentInteractions, DIAGNOSIS_MIN_SEGMENT_INTERACTIONS) }))
    .sort((a, b) => b.interactions - a.interactions || a.label.localeCompare(b.label))
}

/**
 * ONDE INVESTIGAR (regra única, determinística). Só segmentos elegíveis.
 *   Fora da meta + duração + "quanto menor, melhor": o segmento com MAIOR excesso de tempo registrado acima da média geral,
 *     ponderado pelo volume ((média do segmento − média geral) × atendimentos) — onde o tempo se concentra, não "o mais
 *     difícil". Sem nenhum segmento acima da média, cai na regra de volume.
 *   Demais casos (dentro da meta, volume, outra direção): o segmento com MAIS atendimentos — o mais representativo.
 * Nunca rotula motivo; o motivo da escolha fica registrado.
 */
export function selectDiagnosisSegment(segments: readonly DiagnosisSegment[], input: { metric: DiagnosisMetric; direction: IndicatorDirection; withinTarget: boolean | null; overallAverageDurationSeconds: number | null }): { key: string; label: string; reason: string } | null {
  const eligible = segments.filter((segment) => segment.eligible)
  if (eligible.length === 0) return null
  if (input.withinTarget === false && input.metric === "INTERACTION_DURATION_SECONDS" && input.direction === "LOWER" && input.overallAverageDurationSeconds !== null) {
    const overall = input.overallAverageDurationSeconds
    const excess = eligible
      .map((segment) => ({ segment, score: segment.averageDurationSeconds === null ? 0 : (segment.averageDurationSeconds - overall) * segment.interactions }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.segment.label.localeCompare(b.segment.label))
    const top = excess[0]
    if (top) return { key: top.segment.key, label: top.segment.label, reason: "maior tempo registrado acima da média geral do período, ponderado pelo volume de atendimentos" }
  }
  const byVolume = [...eligible].sort((a, b) => b.interactions - a.interactions || a.label.localeCompare(b.label))[0]!
  return { key: byVolume.key, label: byVolume.label, reason: "motivo com mais atendimentos no período (o mais representativo)" }
}

/** Frase exibível do segmento investigado (dados do sistema; a duração é sempre identificada como aproximação). */
export function segmentFactText(plan: IndicatorDiagnosisPlan): string | null {
  const segment = plan.segments.find((entry) => entry.key === plan.selectedSegment?.key)
  if (!segment) return null
  const base = `Motivo investigado: ${segment.label} — ${segment.interactions} de ${plan.interactionsInPeriod} atendimentos do período`
  if (plan.metric === "INTERACTION_DURATION_SECONDS" && segment.averageDurationSeconds !== null && plan.overallAverageDurationSeconds !== null) {
    return `${base}; duração média registrada de ${segment.averageDurationSeconds} s nesse motivo e de ${plan.overallAverageDurationSeconds} s em todos os atendimentos (duração registrada das chamadas, não o cálculo oficial do indicador).`
  }
  return `${base}.`
}
