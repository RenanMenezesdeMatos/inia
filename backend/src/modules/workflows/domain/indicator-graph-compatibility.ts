import {
  allowedMeasurementAggregations,
  isMeasurementAggregationAllowed,
  MEASUREMENT_AGGREGATION_LABELS,
  OPERATIONAL_AGGREGATION_LABELS,
  type MeasurementAggregation,
  type OperationalAggregationKind,
} from "../../indicators/domain/operational-aggregation.js"

/**
 * O que um grafo de Workflow exige do catálogo de indicadores: a agregação de cada nó sobre medições precisa ser aceita pela
 * estratégia do indicador, e Quartil operacional, Melhores/Piores e Evolução/Queda precisam de direção HIGHER/LOWER.
 *
 * Fonte única de QUAIS nós dependem disso, usada pela publicação, pela prévia da correção de indicador, por ativar um Workflow
 * e pela execução. O grafo publicado é imutável e o cálculo aceitaria qualquer agregação (Σ de tempos comparado com um limite
 * daria um número sem erro nenhum), então uma troca de estratégia nunca pode cair aqui em silêncio. Lê o JSON do banco sem
 * supor o formato atual do schema: grafo antigo ou rascunho incompleto só não contribui.
 */
export type IndicatorCatalogEntry = { kind: OperationalAggregationKind; direction: string }

export type MeasurementAggregationUse = { nodeId: string; nodeLabel: string; subject: string; indicatorCode: string; aggregation: string; errorCode: string }

export type DirectionUse = { nodeId: string; nodeLabel: string; indicatorCode: string; feature: string; errorCode: string }

export type GraphCatalogProblem = {
  nodeId: string
  nodeLabel: string
  indicatorCode: string
  problem: "AGGREGATION" | "DIRECTION"
  /** Só em AGGREGATION: a agregação do nó, no rótulo da tela. */
  aggregationLabel: string | null
  errorCode: string
  message: string
}

type Loose = Record<string, unknown>

const asRecord = (value: unknown): Loose | null => (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : null)
const asString = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined)

/** Valor do indicador e Quartil operacional leem `indicator_measurements` — as duas fontes da camada operacional. */
export function isOperationalSource(source: unknown): boolean {
  return source === undefined || source === null || source === "MEASUREMENT" || source === "OPERATIONAL_QUARTILE"
}

/** Evolução/Queda, Melhores/Piores e Quartil operacional comparam desempenho: sem direção oficial, não há regra. */
export function rankingNeedsDirection(ranking: { rankingBasis?: unknown; selection?: unknown }): boolean {
  return (ranking.rankingBasis ?? "VALUE") === "CHANGE" || ranking.selection === "BEST" || ranking.selection === "WORST" || ranking.selection === "OPERATIONAL_QUARTILE"
}

type NodeView = { id: string; type: string; label: string; config: Loose }

function nodesOf(graph: unknown): NodeView[] {
  const nodes = asRecord(graph)?.nodes
  if (!Array.isArray(nodes)) return []
  return nodes.flatMap((raw) => {
    const node = asRecord(raw)
    const id = asString(node?.id)
    const type = asString(node?.type)
    if (!node || !id || !type) return []
    return [{ id, type, label: asString(node.label) ?? id, config: asRecord(node.config) ?? {} }]
  })
}

export function collectMeasurementAggregationUses(graph: unknown): MeasurementAggregationUse[] {
  const uses: MeasurementAggregationUse[] = []
  const add = (node: NodeView, subject: string, query: Loose | null, errorCode: string) => {
    const indicatorCode = asString(query?.indicatorCode)
    if (query && indicatorCode && isOperationalSource(query.source)) uses.push({ nodeId: node.id, nodeLabel: node.label, subject, indicatorCode, aggregation: asString(query.aggregation) ?? "COUNT", errorCode })
  }
  for (const node of nodesOf(graph)) {
    if (node.type === "condition") add(node, `O nó de condição "${node.label}"`, asRecord(node.config.historicalQuery), "WORKFLOW_INVALID_CONDITION")
    if (node.type !== "select_employees") continue
    add(node, `O critério de seleção do nó "${node.label}"`, asRecord(asRecord(node.config.criterion)?.historicalQuery), "WORKFLOW_INVALID_SELECTION_CRITERION")
    const ranking = asRecord(node.config.ranking)
    const indicatorCode = asString(ranking?.indicatorCode)
    const aggregation = asString(ranking?.aggregation)
    if (node.config.selectionMode === "RANKING" && ranking && indicatorCode && aggregation && (ranking.source ?? "MEASUREMENT") === "MEASUREMENT") {
      uses.push({ nodeId: node.id, nodeLabel: node.label, subject: `A configuração de ranking do nó "${node.label}"`, indicatorCode, aggregation, errorCode: "WORKFLOW_INVALID_SELECTION_RANKING" })
    }
  }
  return uses
}

export function collectDirectionUses(graph: unknown): DirectionUse[] {
  const uses: DirectionUse[] = []
  const addQuery = (node: NodeView, query: Loose | null, errorCode: string) => {
    const indicatorCode = asString(query?.indicatorCode)
    if (indicatorCode && query?.source === "OPERATIONAL_QUARTILE") uses.push({ nodeId: node.id, nodeLabel: node.label, indicatorCode, feature: "Quartil operacional", errorCode })
  }
  for (const node of nodesOf(graph)) {
    if (node.type === "condition") addQuery(node, asRecord(node.config.historicalQuery), "WORKFLOW_INVALID_CONDITION")
    if (node.type !== "select_employees") continue
    addQuery(node, asRecord(asRecord(node.config.criterion)?.historicalQuery), "WORKFLOW_INVALID_SELECTION_CRITERION")
    const ranking = asRecord(node.config.ranking)
    const indicatorCode = asString(ranking?.indicatorCode)
    if (node.config.selectionMode === "RANKING" && ranking && indicatorCode && (ranking.source ?? "MEASUREMENT") === "MEASUREMENT" && rankingNeedsDirection(ranking)) {
      const feature = (ranking.rankingBasis ?? "VALUE") === "CHANGE" ? "Evolução/Queda" : ranking.selection === "OPERATIONAL_QUARTILE" ? "Quartil operacional" : "Melhores/Piores"
      uses.push({ nodeId: node.id, nodeLabel: node.label, indicatorCode, feature, errorCode: "WORKFLOW_SELECTION_RANKING_DIRECTION_UNAVAILABLE" })
    }
  }
  return uses
}

export function measurementAggregationMessage(use: Pick<MeasurementAggregationUse, "subject" | "indicatorCode" | "aggregation">, kind: OperationalAggregationKind): string {
  const allowed = allowedMeasurementAggregations(kind).map((item) => MEASUREMENT_AGGREGATION_LABELS[item]).join(", ")
  return `${use.subject} usa "${MEASUREMENT_AGGREGATION_LABELS[use.aggregation as MeasurementAggregation] ?? use.aggregation}" para ${use.indicatorCode}, cuja semântica operacional é "${OPERATIONAL_AGGREGATION_LABELS[kind]}" — agregações válidas: ${allowed}.`
}

/** Códigos que o grafo cita em nós que dependem do catálogo — o que precisa ser lido antes de `graphCatalogProblems`. */
export function indicatorCodesOfGraph(graph: unknown): string[] {
  return [...new Set([...collectMeasurementAggregationUses(graph), ...collectDirectionUses(graph)].map((use) => use.indicatorCode))]
}

/** O que no grafo o catálogo deixa de aceitar. Indicador que o catálogo não devolve fica de fora: a execução já trata como sem dados. */
export function graphCatalogProblems(graph: unknown, catalog: (indicatorCode: string) => IndicatorCatalogEntry | undefined): GraphCatalogProblem[] {
  const problems: GraphCatalogProblem[] = []
  for (const use of collectMeasurementAggregationUses(graph)) {
    const entry = catalog(use.indicatorCode)
    if (!entry || isMeasurementAggregationAllowed(entry.kind, use.aggregation)) continue
    problems.push({ nodeId: use.nodeId, nodeLabel: use.nodeLabel, indicatorCode: use.indicatorCode, problem: "AGGREGATION", aggregationLabel: MEASUREMENT_AGGREGATION_LABELS[use.aggregation as MeasurementAggregation] ?? use.aggregation, errorCode: use.errorCode, message: measurementAggregationMessage(use, entry.kind) })
  }
  for (const use of collectDirectionUses(graph)) {
    if (catalog(use.indicatorCode)?.direction !== "TARGET") continue
    problems.push({ nodeId: use.nodeId, nodeLabel: use.nodeLabel, indicatorCode: use.indicatorCode, problem: "DIRECTION", aggregationLabel: null, errorCode: use.errorCode, message: `O nó "${use.nodeLabel}" usa ${use.feature} para ${use.indicatorCode}, que ficaria sem direção de desempenho (meta por faixa/alvo).` })
  }
  return problems
}
