import { describe, expect, it } from "vitest"
import { allowedAggregationsFor, defaultAggregationFor, OFFICIAL_AGGREGATIONS, OPERATIONAL_QUARTILE_LABELS } from "./workflow-graph.schema"
import {
  describeCalendarPeriod,
  employeeRankingConfigSchema,
  findPairedJoinNode,
  findPrecedingCollectionNode,
  findPrecedingFanOutNode,
  findPrecedingJoinNode,
  flowNodeSchema,
  resolveNodeContexts,
  type FlowGraph,
} from "./workflow-graph.schema"

const position = { x: 0, y: 0 }

describe("describeCalendarPeriod", () => {
  it("concorda em gênero pro período corrente (Este/Esta)", () => {
    expect(describeCalendarPeriod("DAY", "CURRENT")).toBe("Este dia")
    expect(describeCalendarPeriod("WEEK", "CURRENT")).toBe("Esta semana")
    expect(describeCalendarPeriod("MONTH", "CURRENT")).toBe("Este mês")
    expect(describeCalendarPeriod("QUARTER", "CURRENT")).toBe("Este trimestre")
    expect(describeCalendarPeriod("FOUR_MONTHS", "CURRENT")).toBe("Este quadrimestre")
    expect(describeCalendarPeriod("SEMESTER", "CURRENT")).toBe("Este semestre")
  })

  it("concorda em gênero pro período anterior (passado/passada), com Ontem só pra DAY", () => {
    expect(describeCalendarPeriod("DAY", "PREVIOUS")).toBe("Ontem")
    expect(describeCalendarPeriod("WEEK", "PREVIOUS")).toBe("Semana passada")
    expect(describeCalendarPeriod("MONTH", "PREVIOUS")).toBe("Mês passado")
    expect(describeCalendarPeriod("QUARTER")).toBe("Trimestre passado")
  })
})

describe("resolveNodeContexts (EMPLOYEE_COLLECTION — espelha o backend, mesma semântica exata)", () => {
  it("propaga STRUCTURE -> EMPLOYEE_COLLECTION -> EMPLOYEE ao longo do fluxo canônico", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position, config: {} },
        { id: "select", type: "select_employees", label: "Selecionar colaboradores", position, config: {} },
        { id: "apply", type: "apply_individually", label: "Aplicar individualmente", position, config: {} },
        { id: "end", type: "end", label: "Fim", position, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
        { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
        { id: "e3", source: "apply", sourceHandle: "always", target: "end" },
      ],
    }
    const contexts = resolveNodeContexts(graph)
    expect(contexts.get("trigger")).toBe("STRUCTURE")
    expect(contexts.get("select")).toBe("STRUCTURE") // contexto de ENTRADA — propaga EMPLOYEE_COLLECTION adiante
    expect(contexts.get("apply")).toBe("EMPLOYEE_COLLECTION")
    expect(contexts.get("end")).toBe("EMPLOYEE")
  })

  it("refinamento COLLECTION -> COLLECTION: o segundo select já entra com EMPLOYEE_COLLECTION", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position, config: {} },
        { id: "select-1", type: "select_employees", label: "Q4 3/3", position, config: {} },
        { id: "select-2", type: "select_employees", label: "PRV < 80%", position, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "select-1" },
        { id: "e2", source: "select-1", sourceHandle: "always", target: "select-2" },
      ],
    }
    expect(resolveNodeContexts(graph).get("select-2")).toBe("EMPLOYEE_COLLECTION")
  })
})

describe("findPrecedingCollectionNode (runtime — mesmo padrão de findPrecedingCondition)", () => {
  it("acha o 'select_employees' mais próximo andando pra trás", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position, config: {} },
        { id: "select", type: "select_employees", label: "Selecionar Q4", position, config: {} },
        { id: "apply", type: "apply_individually", label: "Aplicar individualmente", position, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
        { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
      ],
    }
    expect(findPrecedingCollectionNode(graph, "apply")?.id).toBe("select")
  })

  it("devolve undefined quando não há nenhum 'select_employees' antes", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position, config: {} },
        { id: "apply", type: "apply_individually", label: "Aplicar individualmente", position, config: {} },
      ],
      edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "apply" }],
    }
    expect(findPrecedingCollectionNode(graph, "apply")).toBeUndefined()
  })
})

function fanOutJoinGraph(): FlowGraph {
  return {
    nodes: [
      { id: "trigger", type: "trigger", label: "Gatilho", position, config: {} },
      { id: "select", type: "select_employees", label: "Selecionar Q4", position, config: {} },
      { id: "apply", type: "apply_individually", label: "Aplicar individualmente", position, config: {} },
      { id: "join", type: "consolidate_results", label: "Consolidar resultados", position, config: {} },
      { id: "orchestrator", type: "orchestrator", label: "Resumo executivo", position, config: { orchestratorId: "orch-1", instruction: "Resuma." } },
      { id: "end", type: "end", label: "Fim", position, config: {} },
    ],
    edges: [
      { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
      { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
      { id: "e3", source: "apply", sourceHandle: "always", target: "join" },
      { id: "e4", source: "join", sourceHandle: "always", target: "orchestrator" },
      { id: "e5", source: "orchestrator", sourceHandle: "always", target: "end" },
    ],
  }
}

describe("resolveNodeContexts — fan-in/JOIN (Consolidar resultados)", () => {
  it("propaga EMPLOYEE -> CONSOLIDATED_RESULT através do Join, liberando Orchestrator depois dele", () => {
    const contexts = resolveNodeContexts(fanOutJoinGraph())
    expect(contexts.get("join")).toBe("EMPLOYEE")
    expect(contexts.get("orchestrator")).toBe("CONSOLIDATED_RESULT")
    expect(contexts.get("end")).toBe("CONSOLIDATED_RESULT")
  })
})

describe("findPrecedingFanOutNode / findPairedJoinNode / findPrecedingJoinNode (fan-in/JOIN)", () => {
  it("findPrecedingFanOutNode acha o 'apply_individually' de origem do Join", () => {
    expect(findPrecedingFanOutNode(fanOutJoinGraph(), "join")?.id).toBe("apply")
  })

  it("findPairedJoinNode acha o Join a partir do Apply — undefined quando não há Join", () => {
    expect(findPairedJoinNode(fanOutJoinGraph(), "apply")?.id).toBe("join")
    const graph: FlowGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position, config: {} },
        { id: "select", type: "select_employees", label: "Selecionar", position, config: {} },
        { id: "apply", type: "apply_individually", label: "Aplicar individualmente", position, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
        { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
      ],
    }
    expect(findPairedJoinNode(graph, "apply")).toBeUndefined()
  })

  it("findPrecedingJoinNode acha o Join mais próximo a partir do Orchestrator pós-JOIN", () => {
    expect(findPrecedingJoinNode(fanOutJoinGraph(), "orchestrator")?.id).toBe("join")
  })

  it("fan-out sequencial: findPrecedingCollectionNode a partir de um 2º select NÃO atravessa o Join", () => {
    const graph: FlowGraph = {
      nodes: [
        ...fanOutJoinGraph().nodes.filter((n) => n.id !== "orchestrator" && n.id !== "end"),
        { id: "select-b", type: "select_employees", label: "Selecionar B", position, config: {} },
        { id: "apply-b", type: "apply_individually", label: "Aplicar B", position, config: {} },
      ],
      edges: [
        ...fanOutJoinGraph().edges.filter((e) => e.id !== "e4" && e.id !== "e5"),
        { id: "e4b", source: "join", sourceHandle: "always", target: "select-b" },
        { id: "e5b", source: "select-b", sourceHandle: "always", target: "apply-b" },
      ],
    }
    expect(findPrecedingCollectionNode(graph, "apply-b")?.id).toBe("select-b")
  })
})

describe("employeeRankingConfigSchema — evolução de 'Selecionar colaboradores' por Ranking (espelha o backend)", () => {
  it("COUNT nunca é uma agregação válida de ranking, mesmo num payload manual", () => {
    const result = employeeRankingConfigSchema.safeParse({
      source: "MEASUREMENT",
      indicatorCode: "QUALIDADE",
      aggregation: "COUNT",
      period: { kind: "ROLLING_DAYS", days: 7 },
      selection: "LOWEST",
      count: 5,
    })
    expect(result.success).toBe(false)
  })

  it("aceita um ranking completo válido e um objeto vazio (draft incompleto)", () => {
    expect(
      employeeRankingConfigSchema.safeParse({
        source: "MEASUREMENT",
        indicatorCode: "QUALIDADE",
        aggregation: "AVERAGE",
        period: { kind: "CALENDAR", unit: "MONTH" },
        selection: "BEST",
        count: 5,
      }).success,
    ).toBe(true)
    expect(employeeRankingConfigSchema.safeParse({}).success).toBe(true)
  })

  it("count precisa ser inteiro positivo quando presente", () => {
    expect(employeeRankingConfigSchema.safeParse({ count: 0 }).success).toBe(false)
    expect(employeeRankingConfigSchema.safeParse({ count: -3 }).success).toBe(false)
    expect(employeeRankingConfigSchema.safeParse({ count: 5 }).success).toBe(true)
  })

  it("evolução de Evolução/Grupo — aceita rankingBasis CHANGE + selection IMPROVED/DECLINED + partitionBy TEAM/SUBTEAM", () => {
    const result = employeeRankingConfigSchema.safeParse({
      source: "MEASUREMENT",
      indicatorCode: "QUALIDADE",
      aggregation: "AVERAGE",
      period: { kind: "ROLLING_DAYS", days: 30 },
      rankingBasis: "CHANGE",
      selection: "DECLINED",
      count: 2,
      partitionBy: "SUBTEAM",
    })
    expect(result.success).toBe(true)
  })

  it("ausência de rankingBasis/partitionBy é um shape válido (backward compatibility)", () => {
    const result = employeeRankingConfigSchema.safeParse({ source: "MEASUREMENT", indicatorCode: "QUALIDADE", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 }, selection: "LOWEST", count: 5 })
    expect(result.success).toBe(true)
  })
})

describe("flowNodeSchema — 'select_employees' com selectionMode/ranking (backward compatibility)", () => {
  const position = { x: 0, y: 0 }

  it("um payload legado sem selectionMode nem ranking (só criterion) continua parseando normalmente", () => {
    const result = flowNodeSchema.safeParse({
      id: "select",
      type: "select_employees",
      label: "Selecionar",
      position,
      config: { criterion: { comparator: "GTE", thresholdNumeric: 1 } },
    })
    expect(result.success).toBe(true)
  })

  it("um node em modo RANKING parseia normalmente", () => {
    const result = flowNodeSchema.safeParse({
      id: "select",
      type: "select_employees",
      label: "Selecionar",
      position,
      config: {
        selectionMode: "RANKING",
        ranking: { source: "MEASUREMENT", indicatorCode: "QUALIDADE", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 90 }, selection: "LOWEST", count: 5 },
      },
    })
    expect(result.success).toBe(true)
  })
})

describe("compatibilidade fonte × agregação (camada operacional)", () => {
  it("TMA/taxas (média ponderada) nunca oferecem média simples nem soma; backlog (snapshot) oferece último valor", () => {
    expect(allowedAggregationsFor("WEIGHTED_AVERAGE")).toEqual(["WEIGHTED_AVERAGE", "MINIMUM", "MAXIMUM", "COUNT"])
    expect(allowedAggregationsFor("RATE")).not.toContain("AVERAGE")
    expect(allowedAggregationsFor("RATE")).not.toContain("SUM")
    expect(allowedAggregationsFor("LATEST")).toContain("LATEST")
    expect(defaultAggregationFor("RATE")).toBe("WEIGHTED_AVERAGE")
    expect(defaultAggregationFor(undefined)).toBe("AVERAGE")
  })

  it("fontes oficiais só agregam entre fechamentos (média/mínimo/máximo) e o quartil operacional é sempre rotulado como operacional", () => {
    expect(OFFICIAL_AGGREGATIONS).toEqual(["AVERAGE", "MINIMUM", "MAXIMUM"])
    expect(OPERATIONAL_QUARTILE_LABELS.Q4).toContain("operacional")
    expect(OPERATIONAL_QUARTILE_LABELS.Q1).toContain("melhores 25%")
  })
})
