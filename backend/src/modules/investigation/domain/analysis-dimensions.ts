/**
 * CATÁLOGO DE DIMENSÕES ANALÍTICAS — por quais recortes um dado pode ser segmentado.
 *
 * Só o que os dados reais suportam hoje; a arquitetura é extensível (uma dimensão nova é uma
 * entrada aqui + o `bucketOf` correspondente no executor), nunca hardcode espalhado.
 *
 * Duas FONTES, que nunca se misturam:
 *  - MEASUREMENT: `indicator_measurements` diária (pessoa × indicador × dia, com numerador/
 *    denominador/amostra). Recortes possíveis: dia, dia da semana, semana. NÃO existe vínculo
 *    medição ↔ interação, logo um indicador NÃO pode ser segmentado por assunto/hora/flag a partir
 *    das medições.
 *  - INTERACTION: `interactions` (assunto = `reason`, canal, horário, duração) + `interaction_flags`.
 *    Recortes possíveis: assunto, canal, hora, dia da semana, flag. A métrica é da PRÓPRIA interação
 *    (duração registrada em segundos, volume) — uma PROXY declarada, nunca "o indicador".
 *
 * Compatibilidade indicador × dimensão de interação é por METADATA (unidade/semântica), nunca por
 * código: unidade SECONDS ↔ duração das interações; COUNT ↔ volume de interações.
 */
export const ANALYSIS_DIMENSIONS = ["DAY", "DAY_OF_WEEK", "WEEK", "SUBJECT", "CHANNEL", "HOUR", "FLAG"] as const
export type AnalysisDimension = (typeof ANALYSIS_DIMENSIONS)[number]

export type DimensionSource = "MEASUREMENT" | "INTERACTION"

export type AnalysisDimensionDefinition = {
  key: AnalysisDimension
  label: string
  source: DimensionSource
  /** Campo/expressão de origem (documentação e trace — nunca interpolado sem passar pelo executor). */
  field: string
  grouping: string
  /** Restrições de privacidade aplicadas aos buckets. */
  privacy: string
}

export const ANALYSIS_DIMENSION_DEFINITIONS: Record<AnalysisDimension, AnalysisDimensionDefinition> = {
  DAY: { key: "DAY", label: "Dia", source: "MEASUREMENT", field: "indicator_measurements.period_start (data local)", grouping: "uma medição por dia", privacy: "só o próprio colaborador" },
  DAY_OF_WEEK: { key: "DAY_OF_WEEK", label: "Dia da semana", source: "MEASUREMENT", field: "extract(isodow from period_start local)", grouping: "Σ componentes por dia da semana", privacy: "só o próprio colaborador" },
  WEEK: { key: "WEEK", label: "Semana", source: "MEASUREMENT", field: "date_trunc('week', period_start local)", grouping: "Σ componentes por semana ISO", privacy: "só o próprio colaborador" },
  SUBJECT: { key: "SUBJECT", label: "Assunto", source: "INTERACTION", field: "interactions.reason", grouping: "duração média e volume por assunto", privacy: "interações do próprio colaborador; pares só agregados" },
  CHANNEL: { key: "CHANNEL", label: "Canal", source: "INTERACTION", field: "interactions.channel", grouping: "duração média e volume por canal", privacy: "interações do próprio colaborador; pares só agregados" },
  HOUR: { key: "HOUR", label: "Hora do dia", source: "INTERACTION", field: "extract(hour from started_at local)", grouping: "duração média e volume por hora", privacy: "interações do próprio colaborador" },
  FLAG: { key: "FLAG", label: "Flag", source: "INTERACTION", field: "interaction_flags.channel_flag_id", grouping: "duração média e volume por flag presente", privacy: "interações do próprio colaborador" },
}

/** Métrica derivada das interações compatível com o indicador (por UNIDADE, nunca por código). */
export type InteractionMetric = "INTERACTION_DURATION_SECONDS" | "INTERACTION_COUNT"

export function interactionMetricFor(indicator: { unit: string }): InteractionMetric | null {
  if (indicator.unit === "SECONDS") return "INTERACTION_DURATION_SECONDS"
  if (indicator.unit === "COUNT") return "INTERACTION_COUNT"
  return null
}

export const INTERACTION_METRIC_LABELS: Record<InteractionMetric, string> = {
  INTERACTION_DURATION_SECONDS: "duração registrada das interações (segundos) — proxy, não a medição do indicador",
  INTERACTION_COUNT: "volume de interações registradas — proxy, não a medição do indicador",
}

export type DimensionAvailability = {
  dimension: AnalysisDimension
  label: string
  source: DimensionSource
  available: boolean
  /** Métrica que será segmentada nessa dimensão (indicador em si ou proxy de interação). */
  metric: string
  reason?: string
}

/** Disponibilidade das dimensões para UM indicador, só por metadata. */
export function dimensionsForIndicator(indicator: { code: string; unit: string; dailySupported: boolean }, hasInteractions: boolean): DimensionAvailability[] {
  const proxy = interactionMetricFor(indicator)
  return ANALYSIS_DIMENSIONS.map((key) => {
    const definition = ANALYSIS_DIMENSION_DEFINITIONS[key]
    if (definition.source === "MEASUREMENT") {
      return indicator.dailySupported
        ? { dimension: key, label: definition.label, source: "MEASUREMENT", available: true, metric: `${indicator.code} (medição operacional diária)` }
        : { dimension: key, label: definition.label, source: "MEASUREMENT", available: false, metric: indicator.code, reason: "o indicador não tem medição operacional diária" }
    }
    if (!proxy) {
      return { dimension: key, label: definition.label, source: "INTERACTION", available: false, metric: indicator.code, reason: `não há medição por interação deste indicador (unidade ${indicator.unit}); recorte por ${definition.label.toLowerCase()} não é suportado` }
    }
    if (!hasInteractions) {
      return { dimension: key, label: definition.label, source: "INTERACTION", available: false, metric: INTERACTION_METRIC_LABELS[proxy], reason: "o colaborador não tem interações registradas no período" }
    }
    return { dimension: key, label: definition.label, source: "INTERACTION", available: true, metric: INTERACTION_METRIC_LABELS[proxy] }
  })
}
