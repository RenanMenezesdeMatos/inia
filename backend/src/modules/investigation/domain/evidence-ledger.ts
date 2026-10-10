import type { ToolInvocationTrace } from "./tool-trace.js"

/**
 * EVIDENCE LEDGER (V1.1 — item 8): o que o modelo recebe no lugar do trace bruto. Uma linha
 * compacta por fato (F1..Fn): Tool + argumentos essenciais + resumo determinístico + qualidade
 * quando não é SUFFICIENT + período quando difere do padrão. Nunca UUIDs, measurementIds,
 * timestamps técnicos, `method` ou proveniência integral — isso continua no trace persistido.
 */
export type LedgerEntry = {
  ref: string
  /** Sequência lógica da chamada no trace (para ligar ledger ↔ trace). */
  sequence: number
  round: number | null
  tool: string
  capability: string
  /** Argumentos que mudam o sentido do fato (indicador, dimensão, referência, camada, ordenação). */
  keyArgs: string
  summary: string
  qualityStatus: string | null
  qualityNote: string | null
  /** Amostra do fato (quality.sampleCount) — base da representatividade da evidência de interação (V1.2). */
  sampleCount: number | null
  periodLabel: string | null
  /** true quando o fato veio do preflight determinístico (rodada 0). */
  preflight: boolean
  /** Sinais determinísticos do resultado (direção/meta/qualidade) — base dos fatos críticos à decisão (V1.3.1). */
  signals?: import("./decision-critical-facts.js").DecisionSignals | null | undefined
}

const KEY_ARGS = ["indicatorCode", "dimension", "reference", "layer", "orderBy", "subject", "flag", "limit", "query"]

export function ledgerEntryFromTrace(item: ToolInvocationTrace, ref: string, defaultPeriodLabel: string | null): LedgerEntry {
  const keyArgs = KEY_ARGS.filter((key) => item.argumentsSummary[key] !== undefined && item.argumentsSummary[key] !== null && item.argumentsSummary[key] !== "")
    .map((key) => `${key}=${String(item.argumentsSummary[key]).slice(0, 60)}`)
    .join(" ")
  const periodLabel = item.provenance?.period?.label ?? null
  return {
    ref,
    sequence: item.sequence,
    round: item.round ?? null,
    tool: item.tool,
    capability: item.capability,
    keyArgs,
    summary: item.resultSummary.replace(/^\(cache\) /, ""),
    qualityStatus: item.quality?.status ?? null,
    qualityNote: item.quality?.note ?? null,
    sampleCount: item.quality?.sampleCount ?? null,
    signals: item.signals ?? null,
    periodLabel: periodLabel && periodLabel !== defaultPeriodLabel ? periodLabel : null,
    preflight: item.round === 0,
  }
}

/** Linha do ledger como o modelo lê. */
export function renderLedgerEntry(entry: LedgerEntry): string {
  const quality = entry.qualityStatus && entry.qualityStatus !== "SUFFICIENT" ? ` [${entry.qualityStatus}${entry.qualityNote ? `: ${entry.qualityNote}` : ""}]` : ""
  const period = entry.periodLabel ? ` [período ${entry.periodLabel}]` : ""
  return `${entry.ref} (${entry.tool}${entry.keyArgs ? ` ${entry.keyArgs}` : ""}): ${entry.summary}${period}${quality}`
}

export function renderLedger(entries: LedgerEntry[]): string {
  return entries.length > 0 ? entries.map(renderLedgerEntry).join("\n") : "(nenhum fato apurado até aqui)"
}

/** Tools cujo fato é EVIDÊNCIA COMPORTAMENTAL (o que aconteceu de fato nas interações/transcrições). */
export const BEHAVIORAL_EVIDENCE_TOOLS = new Set(["analyze_interactions", "analyze_peer_patterns", "get_interaction_context", "get_interaction_flags", "find_comparable_interactions", "find_interactions"])

/** Fatos que podem sustentar uma afirmação comportamental: capacidade de interações, com dado. */
export function isBehavioralEvidence(entry: LedgerEntry): boolean {
  return BEHAVIORAL_EVIDENCE_TOOLS.has(entry.tool) && entry.qualityStatus !== "NO_DATA" && entry.qualityStatus !== "NOT_SUPPORTED"
}
