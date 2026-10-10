/**
 * DETECÇÃO DE ANOMALIAS — simples, explicável e determinística (sem LLM, sem ML).
 *
 * Método (documentado também na Wiki): baseline = MEDIANA da série; escala = desvio absoluto
 * mediano (MAD × 1,4826, estimador robusto do desvio-padrão). Cada ponto recebe
 * z = (valor − mediana) ÷ escala. |z| ≥ 3 → ANOMALY (pico/vale atípico); 2 ≤ |z| < 3 → ATYPICAL;
 * senão NORMAL. A escala nunca fica abaixo de 2% da baseline (série quase constante não vira
 * "anomalia" por ruído); quando ainda assim é 0 (baseline 0), qualquer diferença > 0 é ATYPICAL.
 * A direção "pior/melhor" vem da direção desejada do indicador (LOWER: acima da mediana = pior).
 * Recorrência: se ≥ 30% dos pontos são atípicos/anômalos, o padrão é RECORRENTE (não um pico
 * isolado) — o Agent lê isso como fato, não como causa.
 */
export type SeriesPoint = { date: string; value: number }

export type AnomalyClassification = "NORMAL" | "ATYPICAL" | "ANOMALY"

export type AnomalyPoint = SeriesPoint & {
  baseline: number
  deviation: number
  /** Desvio em unidades robustas (z). null quando a escala é zero. */
  score: number | null
  classification: AnomalyClassification
  /** Pela direção desejada: WORSE = pior que a baseline, BETTER = melhor. */
  performance: "WORSE" | "BETTER" | "SAME"
}

export type AnomalyReport = {
  method: string
  baseline: number | null
  scale: number | null
  points: AnomalyPoint[]
  anomalies: AnomalyPoint[]
  pattern: "NO_DATA" | "STABLE" | "ISOLATED_SPIKES" | "RECURRENT"
}

export const ANOMALY_METHOD = "Mediana + desvio absoluto mediano (MAD × 1,4826, escala mínima de 2% da baseline para não marcar variações triviais); |z| ≥ 3 = anomalia, 2 ≤ |z| < 3 = atípico; ≥ 30% de pontos fora = padrão recorrente."
/** Escala mínima relativa: numa série quase constante o MAD tende a zero e qualquer ruído viraria "anomalia". */
const MINIMUM_SCALE_RATIO = 0.02

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
}

export function detectAnomalies(points: SeriesPoint[], direction: "HIGHER" | "LOWER" | "TARGET"): AnomalyReport {
  if (points.length === 0) return { method: ANOMALY_METHOD, baseline: null, scale: null, points: [], anomalies: [], pattern: "NO_DATA" }
  const values = points.map((point) => point.value)
  const baseline = median(values)
  const mad = median(values.map((value) => Math.abs(value - baseline)))
  const scale = Math.max(mad * 1.4826, Math.abs(baseline) * MINIMUM_SCALE_RATIO)
  const classified: AnomalyPoint[] = points.map((point) => {
    const deviation = point.value - baseline
    const score = scale > 0 ? deviation / scale : null
    const magnitude = score === null ? (deviation === 0 ? 0 : 2) : Math.abs(score)
    const classification: AnomalyClassification = magnitude >= 3 ? "ANOMALY" : magnitude >= 2 ? "ATYPICAL" : "NORMAL"
    const performance: AnomalyPoint["performance"] = deviation === 0 || direction === "TARGET" ? "SAME" : (deviation > 0) === (direction === "HIGHER") ? "BETTER" : "WORSE"
    return { ...point, baseline: round(baseline), deviation: round(deviation), score: score === null ? null : round(score), classification, performance }
  })
  const anomalies = classified.filter((point) => point.classification !== "NORMAL")
  const share = anomalies.length / classified.length
  const pattern: AnomalyReport["pattern"] = anomalies.length === 0 ? "STABLE" : share >= 0.3 ? "RECURRENT" : "ISOLATED_SPIKES"
  return { method: ANOMALY_METHOD, baseline: round(baseline), scale: round(scale), points: classified, anomalies, pattern }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
