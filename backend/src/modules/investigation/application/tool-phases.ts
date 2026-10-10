import type { ToolDefinition } from "../domain/tool-catalog.js"
import type { LedgerEntry } from "../domain/evidence-ledger.js"
import type { InvestigationSubject } from "./tool-context.js"

/**
 * TOOL SCHEMA PRUNING (V1.1 — item 10): cada rodada declara ao modelo só as Tools utilizáveis
 * NAQUELE momento — permitidas pelas capacidades efetivas, aplicáveis ao contexto e com os
 * pré-requisitos satisfeitos. Não é ordem fixa de fases: é "o que faz sentido pedir agora".
 *
 * - `synthesize_evidence` e `recommend_support_materials` nunca são declaradas: a organização
 *   das evidências e a seleção de materiais (mesma validação da V1) acontecem na síntese final,
 *   sem round-trip extra (itens 21/22). Continuam no catálogo para uso explícito.
 * - Após o PREFLIGHT do indicador em foco, snapshot/qualidade/dimensões já estão no contexto.
 * - Tools de análise de interações só entram quando existem ids/assuntos conhecidos (ledger) —
 *   antes disso o modelo não teria como preenchê-las; sem interações no período, nenhuma entra.
 */
export type PruningState = {
  subject: InvestigationSubject
  ledger: LedgerEntry[]
  preflight: { indicatorPreflighted: boolean; interactionsInPeriod: number | null; availableDimensions: string[] | null; /** Indicador em foco dentro da meta (preflight) — null = desconhecido (V1.3.1). */ withinTarget?: boolean | null }
  /** Rótulo do período padrão — para saber se uma Tool de período único já rodou nele (V1.3). */
  defaultPeriodLabel?: string | null
}

const NEVER_DECLARED = new Set(["synthesize_evidence", "recommend_support_materials"])
const PREFLIGHTED_INDICATOR_TOOLS = new Set(["get_indicator_snapshot", "validate_data_quality", "get_available_dimensions"])
const NEEDS_INTERACTION_IDS = new Set(["analyze_interactions"])
const NEEDS_SUBJECT = new Set(["analyze_peer_patterns", "find_comparable_interactions"])
const ID_SOURCES = new Set(["find_interactions", "find_comparable_interactions", "get_interaction_flags"])
const SUBJECT_SOURCES = new Set(["find_interactions", "get_interaction_context", "find_comparable_interactions", "segment_indicator"])
/** Tools cujo único argumento é o período opcional: executadas UMA vez no período padrão, já estão no ledger — não voltam a ser declaradas (V1.3 — §20). */
const SINGLE_SHOT_WHEN_DONE = new Set(["inspect_work_context", "inspect_indicator_composition", "detect_anomalies"])

export function pruneToolsForRound(tools: ToolDefinition[], state: PruningState): { declared: ToolDefinition[]; pruned: { tool: string; reason: string }[] } {
  const pruned: { tool: string; reason: string }[] = []
  const hasInteractionSubject = Boolean(state.subject.interactionId)
  const knowsIds = hasInteractionSubject || state.ledger.some((entry) => ID_SOURCES.has(entry.tool) && entry.qualityStatus !== "NO_DATA")
  const knowsSubject = hasInteractionSubject || state.ledger.some((entry) => SUBJECT_SOURCES.has(entry.tool) && entry.qualityStatus !== "NO_DATA")
  const noInteractions = state.preflight.interactionsInPeriod === 0
  const noDimensions = state.preflight.availableDimensions !== null && state.preflight.availableDimensions.length === 0
  const declared = tools.filter((tool) => {
    const drop = (reason: string) => {
      pruned.push({ tool: tool.key, reason })
      return false
    }
    if (NEVER_DECLARED.has(tool.key)) return drop("incorporada à síntese final")
    if (state.preflight.indicatorPreflighted && PREFLIGHTED_INDICATOR_TOOLS.has(tool.key)) return drop("já apurada no preflight do indicador em foco")
    // Com interação em foco ela sempre existe (pode estar fora do período padrão) — a regra vale só sem foco.
    if (tool.capability === "INTERACTION_ANALYSIS" && noInteractions && !hasInteractionSubject) return drop("sem interações do colaborador no período")
    if (NEEDS_INTERACTION_IDS.has(tool.key) && !knowsIds) return drop("exige ids de interações (find_interactions antes)")
    if (tool.key === "get_interaction_context" && !knowsIds) return drop("exige id de interação (find_interactions antes)")
    if (NEEDS_SUBJECT.has(tool.key) && !knowsSubject) return drop("exige assunto conhecido (find_interactions/segmentação por assunto antes)")
    if (tool.key === "segment_indicator" && noDimensions) return drop("nenhuma dimensão disponível para este indicador")
    if (SINGLE_SHOT_WHEN_DONE.has(tool.key) && state.defaultPeriodLabel && state.ledger.some((entry) => entry.tool === tool.key && entry.periodLabel === state.defaultPeriodLabel && entry.qualityStatus !== null)) return drop("já executada no período padrão (resultado no ledger)")
    return true
  })
  return { declared, pruned }
}
