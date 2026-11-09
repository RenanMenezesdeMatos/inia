import { describe, expect, it } from "vitest"
import { collectDirectionUses, collectMeasurementAggregationUses, graphCatalogProblems, indicatorCodesOfGraph, rankingNeedsDirection } from "./indicator-graph-compatibility.js"

const query = (aggregation: string | undefined, source?: string) => ({ indicatorCode: "QA_X", ...(aggregation ? { aggregation } : {}), ...(source ? { source } : {}) })

const condition = (aggregation?: string, source?: string) => ({ id: "cond", type: "condition", label: "Condição", config: { historicalQuery: query(aggregation, source) } })
const criterion = (aggregation?: string, source?: string) => ({ id: "crit", type: "select_employees", label: "Critério", config: { selectionMode: "CONDITION", criterion: { historicalQuery: query(aggregation, source) } } })
const ranking = (overrides: Record<string, unknown> = {}) => ({ id: "rank", type: "select_employees", label: "Ranking", config: { selectionMode: "RANKING", ranking: { indicatorCode: "QA_X", aggregation: "SUM", selection: "HIGHEST", ...overrides } } })

describe("quais nós dependem do catálogo", () => {
  it("Condição, critério e Ranking sobre medições; sem agregação vale Quantidade, como no publish", () => {
    const uses = collectMeasurementAggregationUses({ nodes: [condition("SUM"), criterion("LATEST"), ranking(), condition()] })
    expect(uses.map((use) => [use.nodeId, use.aggregation, use.errorCode])).toEqual([
      ["cond", "SUM", "WORKFLOW_INVALID_CONDITION"],
      ["crit", "LATEST", "WORKFLOW_INVALID_SELECTION_CRITERION"],
      ["rank", "SUM", "WORKFLOW_INVALID_SELECTION_RANKING"],
      ["cond", "COUNT", "WORKFLOW_INVALID_CONDITION"],
    ])
  })

  it("fontes oficiais não entram: Atingimento agrega um percentual já pronto, com qualquer estratégia", () => {
    expect(collectMeasurementAggregationUses({ nodes: [condition("AVERAGE", "INDICATOR_ACHIEVEMENT"), criterion("AVERAGE", "PRV_ACHIEVEMENT"), ranking({ source: "INDICATOR_ACHIEVEMENT" })] })).toEqual([])
  })

  it("lê o JSON do banco sem supor o formato: grafo antigo ou incompleto não derruba", () => {
    for (const graph of [null, undefined, {}, { nodes: "x" }, { nodes: [null, 1, { id: "a" }, { id: "b", type: "condition" }, { id: "c", type: "condition", config: { historicalQuery: {} } }] }]) {
      expect(collectMeasurementAggregationUses(graph)).toEqual([])
      expect(collectDirectionUses(graph)).toEqual([])
      expect(indicatorCodesOfGraph(graph)).toEqual([])
    }
  })

  it("direção: só Quartil operacional, Melhores/Piores e Evolução/Queda dependem dela", () => {
    expect(rankingNeedsDirection({ selection: "HIGHEST" })).toBe(false)
    for (const selection of ["BEST", "WORST", "OPERATIONAL_QUARTILE"]) expect(rankingNeedsDirection({ selection })).toBe(true)
    expect(rankingNeedsDirection({ selection: "IMPROVED", rankingBasis: "CHANGE" })).toBe(true)
    const uses = collectDirectionUses({ nodes: [ranking({ selection: "WORST" }), ranking({ selection: "HIGHEST" }), ranking({ rankingBasis: "CHANGE", selection: "IMPROVED" }), condition("WEIGHTED_AVERAGE", "OPERATIONAL_QUARTILE"), condition("WEIGHTED_AVERAGE"), ranking({ selection: "WORST", source: "INDICATOR_ACHIEVEMENT" })] })
    expect(uses.map((use) => use.feature)).toEqual(["Melhores/Piores", "Evolução/Queda", "Quartil operacional"])
  })
})

describe("o que o catálogo deixa de aceitar", () => {
  const graph = { nodes: [condition("SUM"), condition("MINIMUM"), condition("COUNT"), ranking({ aggregation: "WEIGHTED_AVERAGE", selection: "WORST" })] }

  it.each([
    ["SUM", "HIGHER", ["Média ponderada pelo volume"]],
    ["WEIGHTED_AVERAGE", "LOWER", ["Soma"]],
    ["RATE", "HIGHER", ["Soma"]],
    ["AVERAGE", "HIGHER", ["Soma", "Média ponderada pelo volume"]],
    ["LATEST", "LOWER", ["Soma", "Média ponderada pelo volume"]],
  ] as const)("estratégia %s: mínimo e quantidade sempre valem", (kind, direction, labels) => {
    const problems = graphCatalogProblems(graph, () => ({ kind, direction }))
    expect(problems.map((problem) => problem.aggregationLabel)).toEqual(labels)
  })

  it("direção TARGET aparece como problema próprio; indicador fora do catálogo não entra", () => {
    const problems = graphCatalogProblems(graph, () => ({ kind: "SUM", direction: "TARGET" }))
    expect(problems.map((problem) => problem.problem)).toEqual(["AGGREGATION", "DIRECTION"])
    expect(problems[1]!.message).toMatch(/usa Melhores\/Piores para QA_X/)
    expect(graphCatalogProblems(graph, () => undefined)).toEqual([])
  })

  it("a mensagem diz o que o nó usa e o que a estratégia aceita", () => {
    const [problem] = graphCatalogProblems({ nodes: [condition("SUM")] }, () => ({ kind: "WEIGHTED_AVERAGE", direction: "LOWER" }))
    expect(problem!.message).toBe('O nó de condição "Condição" usa "Soma" para QA_X, cuja semântica operacional é "Média ponderada (Σ total ÷ Σ volume)" — agregações válidas: Média ponderada pelo volume, Mínimo, Máximo, Quantidade de ocorrências.')
  })
})
