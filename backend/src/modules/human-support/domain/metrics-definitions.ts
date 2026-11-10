import { CLASSIFICATION_OUTCOME_LABELS, CLASSIFICATION_OUTCOMES, CLASSIFICATION_REASON_LABELS, CLASSIFICATION_REASONS, EVALUATION_RESOLVED, EVALUATION_RESOLVED_LABELS, PAUSE_REASONS_V1, REQUEST_ORIGIN_LABELS, REQUEST_ORIGINS, type PauseReason, type PresenceStatus, type RequestOrigin } from "./catalogs.js"
import { estimateWait, nearestRank, type Population, type WaitEstimate } from "./queue-history.js"

/**
 * MÉTRICAS DO APOIO (M7–M18, design_draft.md seção 15). Numerador e denominador num só lugar, funções puras (a aplicação conta no
 * banco e passa aqui). Regras de toda taxa: numerador e denominador sempre; denominador < 5 = taxa oculta ("amostra pequena");
 * denominador 0 = "sem dados", nunca 0%. As três avaliações nunca se misturam: feedback do Acompanhamento (fora daqui), resposta da
 * INIA (M2–M5, `assistant/application/reply-funnel.ts`) e atendimento do Anjo (M16–M17).
 */
export const MIN_SAMPLE = 5
export type Ratio = { numerator: number | null; denominator: number | null; value: number | null; status: "OK" | "SMALL_SAMPLE" | "NO_DATA" }
export type MeasureId = "M1" | "M2" | "M3" | "M4" | "M5" | "M6" | "M7" | "M8" | "M9" | "M10" | "M11" | "M12" | "M13" | "M14" | "M15" | "M16" | "M17"
export type BreakdownItem = { key: string; label: string; count: number; value?: number | null }
export type Measure = {
  id: MeasureId
  kind: "COUNT" | "RATE" | "DISTRIBUTION" | "PERCENTILE" | "AVERAGE"
  main: Ratio
  coverage?: Ratio
  conversion?: Ratio
  noResponse?: Ratio
  percentiles?: { p50: number | null; p90: number | null; estimate: WaitEstimate | null }
  breakdown?: BreakdownItem[]
  extra?: { key: string; label: string; count: number }[]
}

export function ratio(numerator: number, denominator: number): Ratio {
  if (denominator === 0) return { numerator, denominator, value: null, status: "NO_DATA" }
  if (denominator < MIN_SAMPLE) return { numerator, denominator, value: null, status: "SMALL_SAMPLE" }
  return { numerator, denominator, value: numerator / denominator, status: "OK" }
}
const count = (value: number): Ratio => ({ numerator: value, denominator: null, value, status: "OK" })
/** Base de uma distribuição: zero = sem dados; abaixo de 5 = amostra pequena (parcelas ocultas). */
const base = (value: number): Ratio => ({ numerator: value, denominator: null, value, status: value === 0 ? "NO_DATA" : value < MIN_SAMPLE ? "SMALL_SAMPLE" : "OK" })
const share = (part: number, whole: number) => (whole >= MIN_SAMPLE ? part / whole : null)
const sortedNumbers = (values: readonly number[]) => [...values].sort((a, b) => a - b)

export type SupportCounts = {
  /** M7 — sugestões elegíveis no período, por origem. */
  suggestions: Record<"SIGNAL" | "DISLIKE", number>
  /** M8 — pedidos criados no período, por origem; convertidos = pedidos cuja mensagem de origem tem sugestão elegível no período. */
  requestsByOrigin: Record<RequestOrigin, number>
  convertedRequests: number
  /** M9 — tentativas sem Anjo em serviço. */
  noAnjoAttempts: number
  /** M10 — pedidos criados no período que terminaram, por `<status>:<causa>`; os que tiveram atendimento; os ainda abertos. */
  endedByOutcome: Record<string, number>
  hadAttendance: number
  openRequests: number
  /** M11 — população do período (espera estimada) e esperas dos atribuídos até a primeira atribuição, em segundos. */
  queuePopulation: Population | null
  assignmentWaitSeconds: number[]
  /** M12 — da atribuição à primeira mensagem do Anjo (s); atendimentos encerrados; encerrados sem resposta do Anjo por causa. */
  firstResponseSeconds: number[]
  endedAttendances: number
  endedWithoutResponseByCause: Record<string, number>
  /** M13 — duração dos atendimentos encerrados não interrompidos (s); interrompidos à parte. */
  durationSeconds: number[]
  interruptedAttendances: number
  /** M14/M15 — classificações por motivo e por resultado; títulos mais citados. */
  classificationsByReason: Partial<Record<string, number>>
  classificationsByOutcome: Partial<Record<string, number>>
  topTitles: { title: string; count: number }[]
  /** M16/M17 — avaliações vigentes; encerrados não interrompidos (cobertura). */
  resolvedCounts: Partial<Record<string, number>>
  starsCounts: Partial<Record<string, number>>
  endedNotInterrupted: number
}

const END_OUTCOME_LABELS: Record<string, string> = {
  "CLOSED:OPERATOR_CLOSED": "Encerrado pelo operador",
  "CLOSED:ANJO_CLOSED": "Encerrado pelo Anjo",
  "CLOSED:OPERATOR_ABSENT": "Encerrado: operador sem a INIA aberta",
  "CLOSED:INACTIVITY": "Encerrado por falta de mensagens",
  "CANCELLED:OPERATOR_CANCELLED": "Cancelado pelo operador",
  "CANCELLED:SCOPE_DISABLED": "Cancelado: apoio desligado",
  "EXPIRED:QUEUE_EXPIRED": "Expirado na fila",
  "ABANDONED:OPERATOR_ABANDONED": "Abandonado (INIA fechada)",
}
const NO_RESPONSE_LABELS: Record<string, string> = { OPERATOR_CLOSED: "Encerrado pelo operador", ANJO_CLOSED: "Encerrado pelo Anjo", OPERATOR_ABSENT: "Operador ausente", INACTIVITY: "Falta de mensagens", ANJO_LOST: "Interrompido" }

export function supportMeasures(counts: SupportCounts): Measure[] {
  const suggestionTotal = counts.suggestions.SIGNAL + counts.suggestions.DISLIKE
  const requestTotal = REQUEST_ORIGINS.reduce((sum, origin) => sum + counts.requestsByOrigin[origin], 0)
  const endedRequests = Object.values(counts.endedByOutcome).reduce((sum, value) => sum + value, 0)
  const classified = Object.values(counts.classificationsByReason).reduce((sum: number, value) => sum + (value ?? 0), 0)
  const resolvedTotal = EVALUATION_RESOLVED.reduce((sum, key) => sum + (counts.resolvedCounts[key] ?? 0), 0)
  const starsTotal = ["1", "2", "3", "4", "5"].reduce((sum, key) => sum + (counts.starsCounts[key] ?? 0), 0)
  const starsSum = ["1", "2", "3", "4", "5"].reduce((sum, key) => sum + Number(key) * (counts.starsCounts[key] ?? 0), 0)
  const withoutResponse = Object.values(counts.endedWithoutResponseByCause).reduce((sum, value) => sum + value, 0)
  const waits = sortedNumbers(counts.assignmentWaitSeconds)
  const responses = sortedNumbers(counts.firstResponseSeconds)
  const durations = sortedNumbers(counts.durationSeconds)
  return [
    { id: "M7", kind: "COUNT", main: count(suggestionTotal), breakdown: (["SIGNAL", "DISLIKE"] as const).map((origin) => ({ key: origin, label: REQUEST_ORIGIN_LABELS[origin], count: counts.suggestions[origin] })) },
    {
      id: "M8",
      kind: "COUNT",
      main: count(requestTotal),
      conversion: ratio(counts.convertedRequests, suggestionTotal),
      breakdown: REQUEST_ORIGINS.map((origin) => ({ key: origin, label: REQUEST_ORIGIN_LABELS[origin], count: counts.requestsByOrigin[origin] })),
    },
    { id: "M9", kind: "COUNT", main: count(counts.noAnjoAttempts) },
    {
      id: "M10",
      kind: "DISTRIBUTION",
      main: base(endedRequests),
      breakdown: Object.entries(counts.endedByOutcome)
        .sort((a, b) => b[1] - a[1])
        .map(([key, value]) => ({ key, label: END_OUTCOME_LABELS[key] ?? key, count: value, value: share(value, endedRequests) })),
      extra: [
        { key: "HAD_ATTENDANCE", label: "Tiveram atendimento", count: counts.hadAttendance },
        { key: "OPEN", label: "Ainda abertos", count: counts.openRequests },
      ],
    },
    { id: "M11", kind: "PERCENTILE", main: count(waits.length), percentiles: { p50: null, p90: nearestRank(waits, 90), estimate: estimateWait(counts.queuePopulation) } },
    {
      id: "M12",
      kind: "PERCENTILE",
      main: count(responses.length),
      percentiles: { p50: nearestRank(responses, 50), p90: nearestRank(responses, 90), estimate: null },
      noResponse: ratio(withoutResponse, counts.endedAttendances),
      breakdown: Object.entries(counts.endedWithoutResponseByCause).map(([key, value]) => ({ key, label: NO_RESPONSE_LABELS[key] ?? key, count: value })),
    },
    { id: "M13", kind: "PERCENTILE", main: count(durations.length), percentiles: { p50: nearestRank(durations, 50), p90: nearestRank(durations, 90), estimate: null }, extra: [{ key: "INTERRUPTED", label: "Interrompidos", count: counts.interruptedAttendances }] },
    {
      id: "M14",
      kind: "DISTRIBUTION",
      main: base(classified),
      coverage: ratio(classified, counts.endedAttendances),
      breakdown: CLASSIFICATION_REASONS.map((reason) => ({ key: reason, label: CLASSIFICATION_REASON_LABELS[reason], count: counts.classificationsByReason[reason] ?? 0, value: share(counts.classificationsByReason[reason] ?? 0, classified) })),
      extra: counts.topTitles.map((entry) => ({ key: entry.title, label: entry.title, count: entry.count })),
    },
    {
      id: "M15",
      kind: "DISTRIBUTION",
      main: base(classified),
      breakdown: CLASSIFICATION_OUTCOMES.map((outcome) => ({ key: outcome, label: CLASSIFICATION_OUTCOME_LABELS[outcome], count: counts.classificationsByOutcome[outcome] ?? 0, value: share(counts.classificationsByOutcome[outcome] ?? 0, classified) })),
    },
    {
      id: "M16",
      kind: "DISTRIBUTION",
      main: base(resolvedTotal),
      coverage: ratio(resolvedTotal, counts.endedNotInterrupted),
      breakdown: EVALUATION_RESOLVED.map((key) => ({ key, label: EVALUATION_RESOLVED_LABELS[key], count: counts.resolvedCounts[key] ?? 0, value: share(counts.resolvedCounts[key] ?? 0, resolvedTotal) })),
    },
    {
      id: "M17",
      kind: "AVERAGE",
      // Média só com 5 notas ou mais.
      main: { numerator: starsSum, denominator: starsTotal, value: starsTotal >= MIN_SAMPLE ? Math.round((starsSum / starsTotal) * 100) / 100 : null, status: starsTotal === 0 ? "NO_DATA" : starsTotal < MIN_SAMPLE ? "SMALL_SAMPLE" : "OK" },
      coverage: ratio(starsTotal, counts.endedNotInterrupted),
      breakdown: ["1", "2", "3", "4", "5"].map((key) => ({ key, label: `${key} ${key === "1" ? "estrela" : "estrelas"}`, count: counts.starsCounts[key] ?? 0, value: share(counts.starsCounts[key] ?? 0, starsTotal) })),
    },
  ]
}

// -------------------------------------------------------------------------------------------------
// M18 — por Anjo: tempo disponível, em pausa por motivo e sem conexão no período, a partir dos eventos de presença
// -------------------------------------------------------------------------------------------------

export type PresenceEvent = { occurredAt: Date; toStatus: PresenceStatus; pauseReason: PauseReason | null; cause: string }
export type PresenceState = { status: PresenceStatus; pauseReason: PauseReason | null; connected: boolean }
export type PresenceHours = { available: number; paused: Record<PauseReason, number>; disconnected: number }

/**
 * Horas no período a partir do estado no início (`initial`) e dos eventos dentro dele, em ordem. Disponível e em pausa contam só
 * conectado; sem conexão = declarado Disponível ou Em pausa, mas sem a área do Anjo aberta. `until` = o fim do período (ou agora).
 */
export function presenceHours(initial: PresenceState, events: readonly PresenceEvent[], from: Date, until: Date): PresenceHours {
  const totals = { available: 0, disconnected: 0, paused: Object.fromEntries(PAUSE_REASONS_V1.map((reason) => [reason, 0])) as Record<PauseReason, number> }
  let state = { ...initial }
  let cursor = from.getTime()
  const accrue = (end: number) => {
    const duration = Math.max(0, end - cursor)
    if (duration > 0 && state.status !== "OFFLINE") {
      if (!state.connected) totals.disconnected += duration
      else if (state.status === "AVAILABLE") totals.available += duration
      else if (state.pauseReason) totals.paused[state.pauseReason] += duration
    }
    cursor = Math.max(cursor, end)
  }
  for (const event of events) {
    const at = Math.min(Math.max(event.occurredAt.getTime(), from.getTime()), until.getTime())
    accrue(at)
    if (event.cause === "CONNECTION_LOST") state = { ...state, connected: false }
    else if (event.cause === "CONNECTION_RESTORED") state = { ...state, connected: true }
    // Uma mudança declarada pelo Anjo só acontece com a área aberta: ele está conectado naquele instante.
    else state = { status: event.toStatus, pauseReason: event.toStatus === "PAUSED" ? event.pauseReason : null, connected: event.cause === "ANJO" && event.toStatus !== "OFFLINE" ? true : state.connected }
  }
  accrue(until.getTime())
  const hours = (ms: number) => Math.round((ms / 3_600_000) * 100) / 100
  return { available: hours(totals.available), disconnected: hours(totals.disconnected), paused: Object.fromEntries(PAUSE_REASONS_V1.map((reason) => [reason, hours(totals.paused[reason])])) as Record<PauseReason, number> }
}
