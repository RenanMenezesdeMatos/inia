/**
 * Camada 1 — MEDIÇÃO OPERACIONAL. Semântica de agregação de um indicador ao combinar vários
 * períodos (dias) numa janela. Vem de `indicator_definitions.operational_aggregation` (migration
 * 052), nunca inferida do nome/unidade. Aqui mora a matemática — única no sistema: Condition,
 * Ranking, quartil operacional, QA Lab e contexto de Agent chamam estas funções, nunca refazem
 * "AVG(value)" por conta própria.
 *
 * Nada aqui produz atingimento, PRV, quartil oficial ou peso oficial — isso é camada 2
 * (fechamento oficial, `employee_*_performance`), sempre recebido pronto da fonte corporativa.
 */
export const OPERATIONAL_AGGREGATION_KINDS = ["WEIGHTED_AVERAGE", "RATE", "AVERAGE", "SUM", "LATEST"] as const
export type OperationalAggregationKind = (typeof OPERATIONAL_AGGREGATION_KINDS)[number]

/** Agregações que uma Condition/Ranking pode pedir sobre medições (Valor do indicador). */
export const MEASUREMENT_AGGREGATIONS = ["COUNT", "AVERAGE", "WEIGHTED_AVERAGE", "SUM", "LATEST", "MINIMUM", "MAXIMUM"] as const
export type MeasurementAggregation = (typeof MEASUREMENT_AGGREGATIONS)[number]

export const MEASUREMENT_AGGREGATION_LABELS: Record<MeasurementAggregation, string> = {
  COUNT: "Quantidade de ocorrências",
  AVERAGE: "Média simples dos períodos",
  WEIGHTED_AVERAGE: "Média ponderada pelo volume",
  SUM: "Soma",
  LATEST: "Último valor",
  MINIMUM: "Mínimo",
  MAXIMUM: "Máximo",
}

export const OPERATIONAL_AGGREGATION_LABELS: Record<OperationalAggregationKind, string> = {
  WEIGHTED_AVERAGE: "Média ponderada (Σ total ÷ Σ volume)",
  RATE: "Taxa (Σ ocorrências ÷ Σ elegíveis)",
  AVERAGE: "Média simples dos períodos",
  SUM: "Soma dos períodos",
  LATEST: "Último valor (snapshot)",
}

/**
 * Quais agregações fazem sentido pra cada semântica. O editor só oferece estas; o publish
 * rejeita as demais (SUM de TMA, média simples de taxa com volumes diferentes por dia…).
 * MINIMUM/MAXIMUM/COUNT valem pra todos: pior dia, melhor dia, quantos dias/medições bateram X.
 */
export function allowedMeasurementAggregations(kind: OperationalAggregationKind): MeasurementAggregation[] {
  switch (kind) {
    case "WEIGHTED_AVERAGE":
    case "RATE":
      return ["WEIGHTED_AVERAGE", "MINIMUM", "MAXIMUM", "COUNT"]
    case "AVERAGE":
      return ["AVERAGE", "MINIMUM", "MAXIMUM", "COUNT"]
    case "SUM":
      return ["SUM", "AVERAGE", "MINIMUM", "MAXIMUM", "COUNT"]
    case "LATEST":
      return ["LATEST", "MAXIMUM", "MINIMUM", "AVERAGE", "COUNT"]
  }
}

export function isMeasurementAggregationAllowed(kind: OperationalAggregationKind, aggregation: string): boolean {
  return (allowedMeasurementAggregations(kind) as string[]).includes(aggregation)
}

/** A agregação "natural" do indicador — o que "o TMA da semana" significa. */
export function defaultMeasurementAggregation(kind: OperationalAggregationKind): MeasurementAggregation {
  switch (kind) {
    case "WEIGHTED_AVERAGE":
    case "RATE":
      return "WEIGHTED_AVERAGE"
    case "AVERAGE":
      return "AVERAGE"
    case "SUM":
      return "SUM"
    case "LATEST":
      return "LATEST"
  }
}

/** Componentes brutos de uma janela, como saem de UMA query (somas/contagens), nunca linha a linha. */
export type RawWindowComponents = {
  /** Linhas (períodos) na janela. */
  sampleCount: number
  /** Dias de calendário local distintos com medição. */
  daysWithData: number
  avg: number | null
  min: number | null
  max: number | null
  sum: number | null
  /** `value` da linha com period_end mais recente. */
  latest: number | null
  /** Σ(value × coalesce(denominator, 1)) e Σ coalesce(denominator, 1). */
  weightedSum: number | null
  weightTotal: number | null
  /** Σ numerator / Σ denominator só das linhas que TÊM componentes, e quantas são. */
  numeratorSum: number | null
  denominatorSum: number | null
  rowsWithComponents: number
  /** Σ sample_count das linhas que têm amostra declarada (avaliações, respostas). */
  sampleTotal: number | null
}

export type AggregatedWindowValue = {
  value: number | null
  aggregation: MeasurementAggregation
  kind: OperationalAggregationKind
  /** Como o número foi formado — texto curto pra QA/trace (ex.: "Σ 142.639 s ÷ Σ 287 contatos"). */
  method: string
  sampleCount: number
  daysWithData: number
  numerator: number | null
  denominator: number | null
  sampleTotal: number | null
}

/**
 * Une componentes brutos de várias janelas/dias num único bucket (Σ somas e contagens; média,
 * mínimo e máximo derivados; "último" = o do item mais recente na ORDEM RECEBIDA). É o que as
 * Tools de investigação usam pra segmentar por dia da semana/semana a partir da série diária —
 * a semântica continua sendo aplicada por `combineWindowComponents`, nunca "AVG(value)" cego.
 */
export function mergeRawComponents(items: readonly RawWindowComponents[]): RawWindowComponents {
  const merged: RawWindowComponents = { sampleCount: 0, daysWithData: 0, avg: null, min: null, max: null, sum: null, latest: null, weightedSum: null, weightTotal: null, numeratorSum: null, denominatorSum: null, rowsWithComponents: 0, sampleTotal: null }
  const add = (current: number | null, value: number | null) => (value === null ? current : (current ?? 0) + value)
  let weightedAvgSum = 0
  for (const item of items) {
    merged.sampleCount += item.sampleCount
    merged.daysWithData += item.daysWithData
    merged.rowsWithComponents += item.rowsWithComponents
    merged.sum = add(merged.sum, item.sum)
    merged.weightedSum = add(merged.weightedSum, item.weightedSum)
    merged.weightTotal = add(merged.weightTotal, item.weightTotal)
    merged.numeratorSum = add(merged.numeratorSum, item.numeratorSum)
    merged.denominatorSum = add(merged.denominatorSum, item.denominatorSum)
    merged.sampleTotal = add(merged.sampleTotal, item.sampleTotal)
    if (item.avg !== null) weightedAvgSum += item.avg * item.sampleCount
    if (item.min !== null) merged.min = merged.min === null ? item.min : Math.min(merged.min, item.min)
    if (item.max !== null) merged.max = merged.max === null ? item.max : Math.max(merged.max, item.max)
    if (item.latest !== null) merged.latest = item.latest
  }
  merged.avg = merged.sampleCount > 0 ? weightedAvgSum / merged.sampleCount : null
  return merged
}

/** Taxas são persistidas em % (value = numerador ÷ denominador × 100). */
export function rateScale(kind: OperationalAggregationKind): number {
  return kind === "RATE" ? 100 : 1
}

/**
 * Combina os componentes de uma janela no valor pedido. WEIGHTED_AVERAGE usa numerador/
 * denominador quando TODAS as linhas os têm (Σnum ÷ Σden × escala); senão cai pra
 * Σ(value×peso) ÷ Σpeso, onde linhas sem denominador pesam 1 (legado sem componentes = média
 * simples, nunca inventa volume). Janela sem linha = `null` (SEM DADOS), nunca zero.
 */
export function combineWindowComponents(raw: RawWindowComponents, aggregation: MeasurementAggregation, kind: OperationalAggregationKind): AggregatedWindowValue {
  const base = { aggregation, kind, sampleCount: raw.sampleCount, daysWithData: raw.daysWithData, numerator: raw.numeratorSum, denominator: raw.denominatorSum, sampleTotal: raw.sampleTotal }
  if (raw.sampleCount === 0) return { ...base, value: null, method: "sem medições na janela" }
  switch (aggregation) {
    case "WEIGHTED_AVERAGE": {
      const hasComponents = raw.rowsWithComponents === raw.sampleCount && raw.numeratorSum !== null && raw.denominatorSum !== null
      if (hasComponents) {
        if (raw.denominatorSum === 0) return { ...base, value: null, method: "denominador zero na janela" }
        const value = (raw.numeratorSum! / raw.denominatorSum!) * rateScale(kind)
        return { ...base, value: roundValue(value), method: kind === "RATE" ? `Σ ${formatNumber(raw.numeratorSum!)} ocorrências ÷ Σ ${formatNumber(raw.denominatorSum!)} elegíveis × 100` : `Σ ${formatNumber(raw.numeratorSum!)} ÷ Σ ${formatNumber(raw.denominatorSum!)}` }
      }
      if (raw.weightTotal === null || raw.weightTotal === 0 || raw.weightedSum === null) return { ...base, value: raw.avg, method: "média simples (linhas sem volume)" }
      return { ...base, value: roundValue(raw.weightedSum / raw.weightTotal), method: `Σ(valor × volume) ÷ Σ volume (${formatNumber(raw.weightTotal)})` }
    }
    case "AVERAGE":
      return { ...base, value: raw.avg === null ? null : roundValue(raw.avg), method: `média simples de ${raw.sampleCount} período(s)` }
    case "SUM":
      return { ...base, value: raw.sum === null ? null : roundValue(raw.sum), method: `soma de ${raw.sampleCount} período(s)` }
    case "LATEST":
      return { ...base, value: raw.latest, method: "último valor da janela (snapshot)" }
    case "MINIMUM":
      return { ...base, value: raw.min, method: `mínimo entre ${raw.sampleCount} período(s)` }
    case "MAXIMUM":
      return { ...base, value: raw.max, method: `máximo entre ${raw.sampleCount} período(s)` }
    case "COUNT":
      return { ...base, value: raw.sampleCount, method: "contagem de medições" }
  }
}

function roundValue(value: number): number {
  return Math.round(value * 100) / 100
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString("pt-BR") : value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
}

// ---------------------------------------------------------------------------------------------
// FALTA INJUSTIFICADA — política por indicador (`indicator_definitions.unjustified_absence_policy`).
// ---------------------------------------------------------------------------------------------
/**
 * Como um indicador trata um dia de FALTA INJUSTIFICADA confirmada pelo Supervisor (dia que CONTINUA
 * esperado/elegível, sem medição):
 *  NO_SAMPLE          — não existe amostra: TMA, Qualidade, taxas… nada entra (nunca "0 segundos").
 *  ZERO_CONTRIBUTION  — contribuição LÓGICA 0 na agregação: Produção, volume — o dia conta como zero
 *                       produzido. É contribuição de cálculo, NUNCA uma linha em indicator_measurements.
 * Configuração (tela Indicadores), nunca `if code === "PRODUCAO"`. O default é o seguro: NO_SAMPLE.
 */
export const UNJUSTIFIED_ABSENCE_POLICIES = ["NO_SAMPLE", "ZERO_CONTRIBUTION"] as const
export type UnjustifiedAbsencePolicy = (typeof UNJUSTIFIED_ABSENCE_POLICIES)[number]

/** Unidades que representam CONTAGEM — só nelas "zero produzido num dia" tem significado. */
const COUNT_LIKE_UNITS = ["COUNT", "CASES", "CASES_PER_DAY"] as const

/**
 * ZERO_CONTRIBUTION só faz sentido quando "0 num dia" é um valor real da grandeza: soma de contagens
 * (Produção) ou média de contagens por dia. Para média de tempo/nota/estrelas (TMA, Qualidade), taxa
 * (0 ocorrências ÷ 0 elegíveis não existe), média ponderada e snapshot, um zero seria valor inventado.
 */
export function zeroContributionSupported(kind: OperationalAggregationKind, unit: string): boolean {
  const countLike = (COUNT_LIKE_UNITS as readonly string[]).includes(unit)
  return (kind === "SUM" || kind === "AVERAGE") && countLike
}

/**
 * Aplica `zeroDays` contribuições lógicas 0 aos componentes brutos de uma janela — como se existissem
 * `zeroDays` períodos com valor 0 (soma inalterada, média diluída, mínimo 0, dias com dado contados).
 * Componentes de taxa/ponderação não são tocados (a política é bloqueada para eles).
 */
export function applyZeroContribution(raw: RawWindowComponents, zeroDays: number): RawWindowComponents {
  if (zeroDays <= 0) return raw
  const sampleCount = raw.sampleCount + zeroDays
  const sum = raw.sum ?? 0
  return {
    ...raw,
    sampleCount,
    daysWithData: raw.daysWithData + zeroDays,
    sum,
    avg: sampleCount > 0 ? sum / sampleCount : null,
    min: raw.min === null ? 0 : Math.min(raw.min, 0),
    max: raw.max === null ? 0 : Math.max(raw.max, 0),
    latest: raw.latest,
  }
}
