import { createHash } from "node:crypto"
import type { QueryTableCard } from "../../leadership-analytics/domain/view-models.js"
import type { ReportSource } from "./report-definition.js"

/**
 * REGRA DE ATUALIZAÇÃO — nunca entregar dado antigo como se fosse novo (docs/dev/reports-recorrentes.md):
 *   1. cobertura abaixo do mínimo → não encaminhado (INSUFFICIENT_COVERAGE);
 *   2. fonte com cadência vencida (situação funcional) → não encaminhado (STALE_SOURCES);
 *   3. mesmo período da última entrega válida e nenhuma marca d'água avançou → não encaminhado (STALE_SOURCES);
 *   4. marca avançou mas os dados deste report são idênticos (impressão digital) → não encaminhado (NO_CHANGE);
 *   5. senão → entrega válida (com dados ou legitimamente vazia).
 */
export const MINIMUM_REPORT_COVERAGE = 0.7

export type SourceState = {
  source: ReportSource
  label: string
  /** Marca d'água real (versão, maior data de dado, última carga): muda quando a base muda. null = sem metadado. */
  watermark: string | null
  /** Última atualização conhecida (ISO), para mostrar ao usuário. */
  lastUpdatedAt: string | null
  /** A fonte está vencida pela cadência configurada (ex.: feed atrasado). */
  stale: boolean
  detail: string | null
}

export type DeliveryBaseline = { periodKey: string | null; fingerprint: string | null; watermarks: Record<string, string | null> }

export type DeliveryDecision =
  | { kind: "DELIVERY" }
  | { kind: "NOT_FORWARDED"; reason: "STALE_SOURCES" | "NO_CHANGE" | "INSUFFICIENT_COVERAGE"; pendingSources: SourceState[]; message: string }

export const NOT_FORWARDED_MESSAGES = {
  STALE_SOURCES: "Report não encaminhado: as bases necessárias ainda não foram atualizadas para o período configurado.",
  NO_CHANGE: "Report não encaminhado: as bases foram consultadas, mas os dados deste report não mudaram desde a última entrega.",
  INSUFFICIENT_COVERAGE: "Report não encaminhado: as bases ainda não cobrem o período configurado (menos de 70% das pessoas com dado).",
} as const

export function decideDelivery(input: { coverage: number | null; sources: SourceState[]; periodKey: string | null; fingerprint: string; baseline: DeliveryBaseline | null }): DeliveryDecision {
  if (input.coverage !== null && input.coverage < MINIMUM_REPORT_COVERAGE) return { kind: "NOT_FORWARDED", reason: "INSUFFICIENT_COVERAGE", pendingSources: input.sources, message: NOT_FORWARDED_MESSAGES.INSUFFICIENT_COVERAGE }
  const stale = input.sources.filter((source) => source.stale)
  if (stale.length > 0) return { kind: "NOT_FORWARDED", reason: "STALE_SOURCES", pendingSources: stale, message: NOT_FORWARDED_MESSAGES.STALE_SOURCES }
  const baseline = input.baseline
  if (!baseline) return { kind: "DELIVERY" }
  if (baseline.periodKey !== input.periodKey) return { kind: "DELIVERY" }
  const unchanged = input.sources.filter((source) => (baseline.watermarks[source.source] ?? null) === source.watermark)
  if (unchanged.length === input.sources.length) return { kind: "NOT_FORWARDED", reason: "STALE_SOURCES", pendingSources: unchanged, message: NOT_FORWARDED_MESSAGES.STALE_SOURCES }
  if (baseline.fingerprint === input.fingerprint) return { kind: "NOT_FORWARDED", reason: "NO_CHANGE", pendingSources: [], message: NOT_FORWARDED_MESSAGES.NO_CHANGE }
  return { kind: "DELIVERY" }
}

/** Impressão digital do RESULTADO (colunas, linhas e período — sem horário de geração). */
export function cardFingerprint(card: QueryTableCard): string {
  return createHash("sha256").update(JSON.stringify({ title: card.title, period: card.period, columns: card.columns.map((column) => column.key), rows: card.rows.map((row) => row.cells), limitations: card.limitations })).digest("hex").slice(0, 40)
}
