import type { ToolKey } from "./tool-catalog.js"
import type { LedgerEntry } from "./evidence-ledger.js"

/**
 * FONTES DE EVIDÊNCIA (V1.3.2 — Parte 5). O Planner do benchmark V1 aprendeu uma receita estreita
 * (buscar → contexto → analisar → KB) e ignorou as outras famílias de evidência. Em vez de um checklist
 * de Tools por objetivo (novo hardcode), o runtime dá ao modelo uma visão COMPACTA das fontes disponíveis
 * nesta execução, quais já foram consultadas e que TIPO de lacuna cada fonte responde — a escolha da
 * Tool continua do modelo; a pergunta que ele deve se fazer é "que tipo de evidência ainda poderia mudar
 * a conclusão?". O mapa Tool → fonte é determinístico.
 */
export const EVIDENCE_SOURCES = ["INTERACTION_CONTENT", "INTERACTION_EVENTS", "TEMPORAL_HISTORY", "SEGMENTATION", "POPULATION_COMPARISON", "INDICATOR_STATE", "DATA_QUALITY", "WORK_CONTEXT", "KNOWLEDGE"] as const
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number]

export const EVIDENCE_SOURCE_LABELS: Record<EvidenceSource, string> = {
  INTERACTION_CONTENT: "Conteúdo das interações (transcrições)",
  INTERACTION_EVENTS: "Eventos/fatos registrados por interação (flags, duração, assunto, data)",
  TEMPORAL_HISTORY: "Histórico/evolução no tempo",
  SEGMENTATION: "Segmentação por dimensão",
  POPULATION_COMPARISON: "Comparação com a população (agregada)",
  INDICATOR_STATE: "Situação do indicador",
  DATA_QUALITY: "Qualidade do dado",
  WORK_CONTEXT: "Jornada/contexto de trabalho",
  KNOWLEDGE: "Base de conhecimento (o que deveria acontecer)",
}

/** Mapa determinístico Tool → fonte (null = Tool auxiliar sem fonte própria). */
export const TOOL_EVIDENCE_SOURCE: Record<ToolKey, EvidenceSource | null> = {
  get_indicator_snapshot: "INDICATOR_STATE",
  compare_periods: "TEMPORAL_HISTORY",
  get_available_dimensions: "SEGMENTATION",
  segment_indicator: "SEGMENTATION",
  compare_population: "POPULATION_COMPARISON",
  inspect_indicator_composition: "INDICATOR_STATE",
  validate_data_quality: "DATA_QUALITY",
  detect_anomalies: "TEMPORAL_HISTORY",
  get_employee_history: "TEMPORAL_HISTORY",
  find_interactions: "INTERACTION_EVENTS",
  get_interaction_context: "INTERACTION_EVENTS",
  get_interaction_flags: "INTERACTION_EVENTS",
  find_comparable_interactions: "POPULATION_COMPARISON",
  analyze_interactions: "INTERACTION_CONTENT",
  analyze_peer_patterns: "POPULATION_COMPARISON",
  inspect_work_context: "WORK_CONTEXT",
  query_knowledge: "KNOWLEDGE",
  recommend_support_materials: null,
  synthesize_evidence: null,
}

/** Que TIPO de lacuna cada fonte responde — orientação genérica, nunca "chame a Tool X". */
const SOURCE_GAP_HINTS: Record<EvidenceSource, string> = {
  INTERACTION_CONTENT: "o que o colaborador faz/diz na chamada (comportamento observável)",
  INTERACTION_EVENTS: "se um evento/sinal se repete, quando e em quais interações — sem ler cada transcrição",
  TEMPORAL_HISTORY: "se algo mudou, melhorou ou piorou ao longo do período (evolução/recorrência no tempo)",
  SEGMENTATION: "se o resultado está concentrado em algum contexto (só nas dimensões que existem)",
  POPULATION_COMPARISON: "se é individual ou comum ao grupo (agregado; não é obrigatório para padrão individual)",
  INDICATOR_STATE: "valor × meta × amostra do indicador",
  DATA_QUALITY: "se o dado sustenta a conclusão (amostra, cobertura, atualidade)",
  WORK_CONTEXT: "se jornada/situação explicam amostra ou produção",
  KNOWLEDGE: "o que deveria acontecer — só quando a conclusão depende de procedimento",
}

export type EvidenceSourceCoverage = { source: EvidenceSource; tools: ToolKey[]; used: boolean; usedTools: ToolKey[] }

/** Fontes disponíveis (Tools declaradas nesta rodada ∪ já usadas) × consultadas (ledger). */
export function evidenceSourceCoverage(declaredTools: ToolKey[], ledger: LedgerEntry[]): EvidenceSourceCoverage[] {
  const usedTools = new Set(ledger.map((entry) => entry.tool as ToolKey))
  return EVIDENCE_SOURCES.map((source) => {
    const tools = [...new Set([...declaredTools, ...usedTools])].filter((tool) => TOOL_EVIDENCE_SOURCE[tool] === source)
    const used = tools.filter((tool) => usedTools.has(tool))
    return { source, tools, used: used.length > 0, usedTools: used }
  }).filter((item) => item.tools.length > 0)
}

export function sourcesUsed(ledger: LedgerEntry[]): EvidenceSource[] {
  return EVIDENCE_SOURCES.filter((source) => ledger.some((entry) => TOOL_EVIDENCE_SOURCE[entry.tool as ToolKey] === source))
}

export function sourcesAvailable(tools: ToolKey[]): EvidenceSource[] {
  return EVIDENCE_SOURCES.filter((source) => tools.some((tool) => TOOL_EVIDENCE_SOURCE[tool] === source))
}

/** Bloco do prompt de planejamento: fontes desta execução (✓ consultada / — não) + a pergunta de lacuna. Sem checklist. */
export function renderEvidenceSources(coverage: EvidenceSourceCoverage[]): string {
  if (coverage.length === 0) return ""
  const lines = coverage.map((item) => `- ${item.used ? "✓" : "—"} ${EVIDENCE_SOURCE_LABELS[item.source]}: ${item.tools.join(", ")} — responde: ${SOURCE_GAP_HINTS[item.source]}`)
  return [
    "FONTES DE EVIDÊNCIA nesta execução (✓ = já consultada):",
    ...lines,
    "Antes de propor STOP, pergunte-se: que TIPO de evidência ainda poderia mudar a conclusão ou o escopo que ela sustenta? Se existe uma fonte não consultada que responde exatamente a essa lacuna e ela é material para o objetivo, consulte-a; se não há lacuna material, pare — não consulte uma fonte só porque está listada.",
  ].join("\n")
}
