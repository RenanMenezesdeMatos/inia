import type { Direction, ProxyKind } from "./indicator-investigation.js"

/**
 * RECORTES DA INVESTIGAÇÃO (`INVESTIGATION_SLICES_V2`, domínio puro).
 *
 * Um recorte é ONDE olhar: um conjunto de filtros (assunto, dia, dia da semana, faixa horária, canal, sinal — e combinações) sobre
 * as chamadas da PRÓPRIA pessoa no período. Recortes nascem da localização calculada pelo código (assuntos que mudaram, dias
 * fora do padrão da medição diária) e também dos RESULTADOS das ferramentas durante a investigação — um pico encontrado por
 * `detect_anomalies`, uma concentração encontrada por `segment_indicator` —, nunca só dos assuntos definidos antes do planejamento.
 *
 * Encontrar um recorte responde "onde aconteceu"; não responde "o que aconteceu nas chamadas dele" — essa é outra pergunta, que
 * o estado da investigação abre para o recorte (ver `openQuestionsOf` em investigation-toolbox.ts). Cada recorte guarda a origem
 * (cálculo do código ou a consulta F-n que o encontrou), o que foi observado e os filtros — a população (chamadas da pessoa no
 * período atual), o denominador e as fontes vão com ele até o diagnóstico e a mensagem.
 *
 * Os limiares abaixo decidem só se um resultado VALE como recorte a olhar (materialidade), nunca uma causa.
 *
 * V2 (16/10/2026, `SUBJECT_RESOLUTION_V2`): ASSUNTO é o nível preferencial (submotivo; sem submotivo, o motivo) e MOTIVO (`REASON`)
 * é um recorte a mais — o genérico da fonte, que junta os submotivos dele.
 */
export const INVESTIGATION_SLICES_VERSION = "INVESTIGATION_SLICES_V2" as const
export const SLICE_DIMENSIONS = ["SUBJECT", "REASON", "DAY", "DAY_OF_WEEK", "HOUR", "CHANNEL", "FLAG"] as const
export type SliceDimension = (typeof SLICE_DIMENSIONS)[number]
export type SliceFilter = { dimension: SliceDimension; value: string; label: string }
/** DETERIORATED/HIDDEN_DETERIORATION/IMPROVED = assunto que mudou entre os períodos; ATYPICAL_DAY = dia fora do padrão da própria
 * pessoa; CONCENTRATION = parte das chamadas (horário, canal, sinal, assunto…) com a métrica pior que o conjunto do período. */
export type SliceReason = "DETERIORATED" | "HIDDEN_DETERIORATION" | "IMPROVED" | "ATYPICAL_DAY" | "CONCENTRATION"
export type SliceOrigin = { kind: "LOCALIZATION" | "DAILY_PROFILE" | "TOOL"; ref: string | null; tool: string | null; round: number }
export type InvestigationSlice = {
  /** Referência estável na execução (R-n) — é o que o planejador e o registro usam. */
  ref: string
  key: string
  label: string
  /** Como o recorte entra numa frase de fato ("No assunto X", "Nas chamadas do recorte dia 14/08"). */
  scope: string
  filters: SliceFilter[]
  reason: SliceReason
  adverse: boolean
  origin: SliceOrigin
  /** O que foi observado (números do sistema/da ferramenta) — fato, nunca causa. */
  observation: string
  /** Outras consultas que encontraram o MESMO recorte depois. */
  corroboratedBy: string[]
}
export type SliceCandidate = Pick<InvestigationSlice, "filters" | "reason" | "adverse" | "origin" | "observation">

export const MAX_SLICES = 6
export const MAX_SLICES_PER_RESULT = 2
/** Diferença mínima (relativa) entre a parte e o conjunto para ela valer como recorte a olhar. */
export const SLICE_MATERIAL_DEVIATION = 0.2

const ISO_WEEKDAYS = ["", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"]
const shortDate = (date: string) => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date.slice(8, 10)}/${date.slice(5, 7)}` : date)

export function sliceKeyOf(filters: readonly SliceFilter[]): string {
  return [...filters].sort((a, b) => a.dimension.localeCompare(b.dimension) || a.value.localeCompare(b.value)).map((filter) => `${filter.dimension}=${filter.value}`).join("&")
}
function filterLabel(filter: SliceFilter): string {
  switch (filter.dimension) {
    case "SUBJECT":
      return `assunto ${filter.label}`
    case "REASON":
      return `motivo ${filter.label}`
    case "DAY":
      return `dia ${shortDate(filter.value)}`
    case "DAY_OF_WEEK":
      return ISO_WEEKDAYS[Number(filter.value)] ?? filter.label
    case "HOUR":
      return `faixa das ${filter.value}h`
    case "CHANNEL":
      return `canal ${filter.label}`
    case "FLAG":
      return `sinal ${filter.label}`
  }
}
export const sliceLabelOf = (filters: readonly SliceFilter[]) => filters.map(filterLabel).join(" · ")
export const sliceScopeOf = (filters: readonly SliceFilter[]) =>
  filters.length === 1 && filters[0]!.dimension === "SUBJECT" ? `No assunto ${filters[0]!.label}` : filters.length === 1 && filters[0]!.dimension === "REASON" ? `No motivo ${filters[0]!.label}` : `Nas chamadas do recorte ${sliceLabelOf(filters)}`

/** Recortes da execução: R-n estável por chave; o mesmo recorte achado de novo só registra a corroboração. */
export class SliceRegistry {
  private readonly byKey = new Map<string, InvestigationSlice>()
  add(candidate: SliceCandidate): { slice: InvestigationSlice; created: boolean } | null {
    const key = sliceKeyOf(candidate.filters)
    const existing = this.byKey.get(key)
    if (existing) {
      if (candidate.origin.ref && candidate.origin.ref !== existing.origin.ref && !existing.corroboratedBy.includes(candidate.origin.ref)) existing.corroboratedBy.push(candidate.origin.ref)
      return { slice: existing, created: false }
    }
    if (this.byKey.size >= MAX_SLICES) return null
    const slice: InvestigationSlice = { ...candidate, ref: `R${this.byKey.size + 1}`, key, label: sliceLabelOf(candidate.filters), scope: sliceScopeOf(candidate.filters), corroboratedBy: [] }
    this.byKey.set(key, slice)
    return { slice, created: true }
  }
  list(): InvestigationSlice[] {
    return [...this.byKey.values()]
  }
  get(ref: string): InvestigationSlice | undefined {
    return this.list().find((slice) => slice.ref === ref)
  }
}

export type DiscoveryContext = {
  direction: Direction
  proxyKind: ProxyKind | null
  minimumPerSegment: number
  /** Valor do INDICADOR na unidade dele (medição). */
  formatIndicator: (value: number) => string
  subjectLabel: (key: string) => string
  ref: string
  tool: string
  round: number
}

const numberOf = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null)
const adverseVersus = (value: number, total: number, direction: Direction) => (direction === "LOWER" ? value >= total * (1 + SLICE_MATERIAL_DEVIATION) : direction === "HIGHER" ? value <= total * (1 - SLICE_MATERIAL_DEVIATION) : false)

/**
 * O que um resultado de ferramenta ACRESCENTA como recorte (só a janela atual; só o lado adverso — onde o resultado ficou pior):
 *   - `detect_anomalies`: dias anômalos/atípicos no sentido pior → recorte por DIA;
 *   - `segment_indicator` por dia/dia da semana (medição): parte com o indicador materialmente pior que o período;
 *   - `segment_indicator` por assunto/motivo/canal/hora/sinal (chamadas): só com a métrica de DURAÇÃO (indicador em segundos), parte
 *     com volume mínimo e duração materialmente maior que o conjunto; filtros pedidos na consulta (assunto, motivo, sinal) viram combinação.
 * Qualquer outra ferramenta não cria recorte (pode mudar hipóteses — ex.: comparação com o grupo —, ver diagnosticSignalsOf).
 */
export function slicesFromToolResult(data: unknown, requestedArgs: Record<string, unknown>, context: DiscoveryContext): SliceCandidate[] {
  if (requestedArgs.window === "PREVIOUS" || !data || typeof data !== "object") return []
  const origin: SliceOrigin = { kind: "TOOL", ref: context.ref, tool: context.tool, round: context.round }
  if (context.tool === "detect_anomalies") {
    const anomalies = ((data as { anomalies?: unknown[] }).anomalies ?? []) as { date?: unknown; observedValue?: unknown; baseline?: unknown; classification?: unknown; performance?: unknown; score?: unknown }[]
    return anomalies
      .filter((point) => typeof point.date === "string" && point.performance === "WORSE" && (point.classification === "ANOMALY" || point.classification === "ATYPICAL"))
      .sort((a, b) => Math.abs(numberOf(b.score) ?? 0) - Math.abs(numberOf(a.score) ?? 0))
      .slice(0, MAX_SLICES_PER_RESULT)
      .map((point): SliceCandidate => {
        const observed = numberOf(point.observedValue)
        const baseline = numberOf(point.baseline)
        // MATERIALIDADE como fato (nunca decisão): quanto o dia se afasta da base, em percentual — um dia "fora do padrão" de uma série
        // muito estável pode estar poucos por cento acima dela.
        const deviation = observed !== null && baseline !== null && baseline !== 0 ? ((observed - baseline) / Math.abs(baseline)) * 100 : null
        return {
          filters: [{ dimension: "DAY", value: point.date as string, label: shortDate(point.date as string) }],
          reason: "ATYPICAL_DAY",
          adverse: true,
          origin,
          observation: `Dia ${shortDate(point.date as string)} ${point.classification === "ANOMALY" ? "fora do padrão" : "atípico"} na medição diária${observed !== null ? `: ${context.formatIndicator(observed)}` : ""}${baseline !== null ? ` contra a base de ${context.formatIndicator(baseline)}` : ""}${deviation !== null ? ` (${deviation >= 0 ? "+" : "−"}${Math.abs(deviation).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)` : ""}.`,
        }
      })
  }
  if (context.tool !== "segment_indicator") return []
  const result = data as { dimension?: unknown; buckets?: unknown[]; total?: { value?: unknown; averageDurationSeconds?: unknown } }
  const dimension = typeof result.dimension === "string" ? result.dimension : ""
  const buckets = (result.buckets ?? []) as Record<string, unknown>[]
  const extra: SliceFilter[] = []
  if (typeof requestedArgs.subject === "string" && requestedArgs.subject.trim() && dimension !== "SUBJECT") extra.push({ dimension: "SUBJECT", value: requestedArgs.subject.trim(), label: context.subjectLabel(requestedArgs.subject.trim()) })
  if (typeof requestedArgs.reason === "string" && requestedArgs.reason.trim() && dimension !== "REASON") extra.push({ dimension: "REASON", value: requestedArgs.reason.trim(), label: context.subjectLabel(requestedArgs.reason.trim()) })
  if (typeof requestedArgs.flag === "string" && requestedArgs.flag.trim() && dimension !== "FLAG") extra.push({ dimension: "FLAG", value: requestedArgs.flag.trim(), label: requestedArgs.flag.trim() })
  if (dimension === "DAY" || dimension === "DAY_OF_WEEK") {
    const total = numberOf(result.total?.value)
    if (total === null || buckets.length < 3) return []
    return buckets
      .map((bucket) => ({ bucket, value: numberOf(bucket.indicatorValue) }))
      .filter((entry): entry is { bucket: Record<string, unknown>; value: number } => entry.value !== null && adverseVersus(entry.value, total, context.direction))
      .sort((a, b) => Math.abs(b.value - total) - Math.abs(a.value - total))
      .slice(0, MAX_SLICES_PER_RESULT)
      .map(({ bucket, value }): SliceCandidate => {
        const raw = dimension === "DAY" ? String(bucket.dimensionValue ?? "") : String(bucket.sortKey ?? "")
        const filter: SliceFilter = dimension === "DAY" ? { dimension: "DAY", value: raw, label: shortDate(raw) } : { dimension: "DAY_OF_WEEK", value: raw, label: ISO_WEEKDAYS[Number(raw)] ?? raw }
        return { filters: [...extra, filter], reason: dimension === "DAY" ? "ATYPICAL_DAY" : "CONCENTRATION", adverse: true, origin, observation: `${sliceLabelOf([filter])}: ${context.formatIndicator(value)} contra ${context.formatIndicator(total)} no período (medição diária).` }
      })
  }
  if (dimension === "SUBJECT" || dimension === "REASON" || dimension === "CHANNEL" || dimension === "HOUR" || dimension === "FLAG") {
    // Só a métrica de duração tem sentido de "pior" aqui (indicador em segundos, menor é melhor); volume não aponta problema.
    const totalDuration = numberOf(result.total?.averageDurationSeconds)
    if (context.proxyKind !== "DURATION_SECONDS" || context.direction !== "LOWER" || totalDuration === null || buckets.length < 2) return []
    return buckets
      .map((bucket) => ({ bucket, duration: numberOf(bucket.averageDurationSeconds), n: numberOf(bucket.sampleCount) ?? 0 }))
      .filter((entry): entry is { bucket: Record<string, unknown>; duration: number; n: number } => entry.duration !== null && entry.n >= context.minimumPerSegment && entry.duration >= totalDuration * (1 + SLICE_MATERIAL_DEVIATION))
      .sort((a, b) => b.duration * b.n - a.duration * a.n)
      .slice(0, MAX_SLICES_PER_RESULT)
      .map(({ bucket, duration, n }): SliceCandidate => {
        const bySubject = dimension === "SUBJECT" || dimension === "REASON"
        const value = bySubject ? String(bucket.canonicalSubject ?? bucket.dimensionValue ?? "") : dimension === "HOUR" ? String(bucket.dimensionValue ?? "").replace(/h$/, "") : String(bucket.dimensionValue ?? "")
        const filter: SliceFilter = { dimension: dimension as SliceDimension, value, label: bySubject ? context.subjectLabel(value) : value }
        return { filters: [...extra, filter], reason: "CONCENTRATION", adverse: true, origin, observation: `${sliceLabelOf([...extra, filter])}: duração média registrada de ${Math.round(duration)} s em ${n} chamadas, contra ${Math.round(totalDuration)} s no conjunto do período.` }
      })
  }
  return []
}
