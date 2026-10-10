/**
 * SAÍDA PADRÃO de toda Tool: `data` (o fato), `quality` (dá pra confiar?) e `provenance` (de onde
 * veio). Todo fato analítico que chega ao Agent carrega contexto suficiente pra saber período,
 * população, filtros e fonte — a IA nunca recebe um número solto.
 */
export const TOOL_QUALITY_STATUSES = [
  "SUFFICIENT",
  "INSUFFICIENT_SAMPLE",
  "INSUFFICIENT_COVERAGE",
  "STALE",
  "SOURCE_DELAY",
  "AVAILABILITY_UNKNOWN",
  "NO_DATA",
  "NOT_SUPPORTED",
] as const
export type ToolQualityStatus = (typeof TOOL_QUALITY_STATUSES)[number]

export const TOOL_QUALITY_STATUS_LABELS: Record<ToolQualityStatus, string> = {
  SUFFICIENT: "Dado suficiente",
  INSUFFICIENT_SAMPLE: "Amostra insuficiente",
  INSUFFICIENT_COVERAGE: "Cobertura insuficiente",
  STALE: "Dado desatualizado",
  SOURCE_DELAY: "Fonte atrasada",
  AVAILABILITY_UNKNOWN: "Disponibilidade desconhecida",
  NO_DATA: "Sem dados",
  NOT_SUPPORTED: "Não suportado",
}

export type ToolQuality = {
  status: ToolQualityStatus
  /** Linhas/observações que formaram o fato (medições, interações, avaliações…). */
  sampleCount: number | null
  /** 0..1 — dias com dado ÷ dias elegíveis (indicadores) ou proporção coberta (outros). */
  coverage: number | null
  /** Situação da fonte, quando conhecida. */
  freshness: "FRESH" | "STALE" | "UNKNOWN" | null
  /** Frase curta, legível, explicando a classificação — nunca uma conclusão sobre o colaborador. */
  note?: string
}

export type ToolProvenance = {
  /** Janela analisada (ISO) — ausente em fatos sem tempo (ex.: dimensões disponíveis). */
  period?: { start: string; end: string; label?: string } | undefined
  /** Quem entrou na conta: "colaborador", "pares do Subgrupo X (n=24)", "interações do recorte"… */
  population: string
  /** Filtros aplicados, em texto legível (assunto, flag, dimensão…). */
  filters: string[]
  /** Tabela/camada de origem: MEASUREMENT (operacional diário), OFFICIAL_PERFORMANCE, INTERACTIONS, TRANSCRIPTS, WORK_CALENDAR, KNOWLEDGE_BASE… */
  dataSource: string
  /** Como o número foi formado (ex.: "Σ 142.639 s ÷ Σ 287 contatos"). */
  method?: string | undefined
}

export type ToolResult<T = unknown> = {
  data: T
  quality: ToolQuality
  provenance: ToolProvenance
}

export function sufficient(sampleCount: number | null, coverage: number | null, note?: string): ToolQuality {
  return { status: "SUFFICIENT", sampleCount, coverage, freshness: null, ...(note ? { note } : {}) }
}

export function noData(note: string): ToolQuality {
  return { status: "NO_DATA", sampleCount: 0, coverage: null, freshness: null, note }
}

export function notSupported(note: string): ToolQuality {
  return { status: "NOT_SUPPORTED", sampleCount: null, coverage: null, freshness: null, note }
}

/**
 * DERIVAÇÕES DETERMINÍSTICAS (V1.3.1 — §2): toda proporção/delta útil à conclusão é calculada pela
 * aplicação e entregue pronta ao modelo — a IA interpreta, nunca deriva "6 de 7 = 86%".
 */
export function percentOf(part: number | null | undefined, whole: number | null | undefined): number | null {
  if (part === null || part === undefined || whole === null || whole === undefined || whole <= 0) return null
  return Math.round((part / whole) * 1000) / 10
}

export function deltaOf(current: number | null | undefined, reference: number | null | undefined): { absolute: number; percent: number | null } | null {
  if (current === null || current === undefined || reference === null || reference === undefined) return null
  const absolute = Math.round((current - reference) * 100) / 100
  return { absolute, percent: reference !== 0 ? Math.round((absolute / Math.abs(reference)) * 1000) / 10 : null }
}
