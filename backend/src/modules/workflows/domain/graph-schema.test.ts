import { describe, expect, it } from "vitest"
import {
  employeeRankingConfigSchema,
  findPairedJoinNode,
  findPrecedingCollectionNode,
  findPrecedingFanOutNode,
  findPrecedingJoinNode,
  flowNodeSchema,
  resolveNodeContexts,
  type FlowGraph,
} from "./graph-schema.js"

const position = { x: 0, y: 0 }

describe("resolveNodeContexts (EMPLOYEE_COLLECTION — Parte 29/30 do pedido)", () => {
  it("propaga STRUCTURE -> EMPLOYEE_COLLECTION -> EMPLOYEE ao longo do fluxo canônico", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position, config: {} },
        { id: "select", type: "select_employees", label: "Selecionar colaboradores", position, config: {} },
        { id: "apply", type: "apply_individually", label: "Aplicar individualmente", position, config: {} },
        { id: "review", type: "human_review", label: "Revisão", position, config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, instruction: null } as never },
        { id: "end", type: "end", label: "Fim", position, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
        { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
        { id: "e3", source: "apply", sourceHandle: "always", target: "review" },
        { id: "e4", source: "review", sourceHandle: "approved", target: "end" },
        { id: "e5", source: "review", sourceHandle: "rejected", target: "end" },
        { id: "e6", source: "review", sourceHandle: "escalated", target: "end" },
      ],
    }
    const contexts = resolveNodeContexts(graph)
    expect(contexts.get("trigger")).toBe("STRUCTURE")
    // O contexto REGISTRADO de "select" é o de ENTRADA (STRUCTURE) — ele PROPAGA EMPLOYEE_COLLECTION adiante.
    expect(contexts.get("select")).toBe("STRUCTURE")
    expect(contexts.get("apply")).toBe("EMPLOYEE_COLLECTION")
    expect(contexts.get("review")).toBe("EMPLOYEE")
    expect(contexts.get("end")).toBe("EMPLOYEE")
  })

  it("refinamento COLLECTION -> COLLECTION: o segundo 'Selecionar colaboradores' já entra com contexto EMPLOYEE_COLLECTION", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position, config: {} },
        { id: "select-1", type: "select_employees", label: "Q4 3/3", position, config: {} },
        { id: "select-2", type: "select_employees", label: "PRV < 80%", position, config: {} },
        { id: "apply", type: "apply_individually", label: "Aplicar individualmente", position, config: {} },
        { id: "end", type: "end", label: "Fim", position, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "select-1" },
        { id: "e2", source: "select-1", sourceHandle: "always", target: "select-2" },
        { id: "e3", source: "select-2", sourceHandle: "always", target: "apply" },
        { id: "e4", source: "apply", sourceHandle: "always", target: "end" },
      ],
    }
    const contexts = resolveNodeContexts(graph)
    expect(contexts.get("select-1")).toBe("STRUCTURE")
    expect(contexts.get("select-2")).toBe("EMPLOYEE_COLLECTION")
    expect(contexts.get("apply")).toBe("EMPLOYEE_COLLECTION")
  })

  it("grafo sem Trigger devolve mapa vazio, nunca lança", () => {
    const graph: FlowGraph = { nodes: [{ id: "end", type: "end", label: "Fim", position, config: {} }], edges: [] }
    expect(resolveNodeContexts(graph).size).toBe(0)
  })

  it("Wait não altera o contexto propagado — passa o STRUCTURE/EMPLOYEE_COLLECTION/EMPLOYEE adiante tal como recebeu", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position, config: {} },
        { id: "select", type: "select_employees", label: "Selecionar", position, config: {} },
        { id: "apply", type: "apply_individually", label: "Aplicar", position, config: {} },
        { id: "wait", type: "wait", label: "Esperar", position, config: { durationMs: 1000 } },
        { id: "end", type: "end", label: "Fim", position, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
        { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
        { id: "e3", source: "apply", sourceHandle: "always", target: "wait" },
        { id: "e4", source: "wait", sourceHandle: "always", target: "end" },
      ],
    }
    const contexts = resolveNodeContexts(graph)
    expect(contexts.get("wait")).toBe("EMPLOYEE")
    expect(contexts.get("end")).toBe("EMPLOYEE")
  })
})

describe("findPrecedingCollectionNode (runtime — espelha findPrecedingCondition)", () => {
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
    const found = findPrecedingCollectionNode(graph, "apply")
    expect(found?.id).toBe("select")
  })

  it("num refinamento (2 selects), acha o MAIS PRÓXIMO (o segundo), nunca o primeiro", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position, config: {} },
        { id: "select-1", type: "select_employees", label: "Q4 3/3", position, config: {} },
        { id: "select-2", type: "select_employees", label: "PRV < 80%", position, config: {} },
        { id: "apply", type: "apply_individually", label: "Aplicar individualmente", position, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "select-1" },
        { id: "e2", source: "select-1", sourceHandle: "always", target: "select-2" },
        { id: "e3", source: "select-2", sourceHandle: "always", target: "apply" },
      ],
    }
    expect(findPrecedingCollectionNode(graph, "apply")?.id).toBe("select-2")
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
      { id: "review", type: "human_review", label: "Revisão", position, config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, instruction: null } as never },
      { id: "join", type: "consolidate_results", label: "Consolidar resultados", position, config: {} },
      { id: "orchestrator", type: "orchestrator", label: "Resumo executivo", position, config: { orchestratorId: "orch-1", instruction: "Resuma." } },
      { id: "end", type: "end", label: "Fim", position, config: {} },
    ],
    edges: [
      { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
      { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
      { id: "e3", source: "apply", sourceHandle: "always", target: "review" },
      { id: "e4", source: "review", sourceHandle: "approved", target: "join" },
      { id: "e5", source: "review", sourceHandle: "rejected", target: "join" },
      { id: "e6", source: "review", sourceHandle: "escalated", target: "join" },
      { id: "e7", source: "join", sourceHandle: "always", target: "orchestrator" },
      { id: "e8", source: "orchestrator", sourceHandle: "always", target: "end" },
    ],
  }
}

describe("resolveNodeContexts — fan-in/JOIN (Consolidar resultados)", () => {
  it("propaga EMPLOYEE -> CONSOLIDATED_RESULT através do Join, liberando Orchestrator depois dele", () => {
    const contexts = resolveNodeContexts(fanOutJoinGraph())
    expect(contexts.get("review")).toBe("EMPLOYEE")
    expect(contexts.get("join")).toBe("EMPLOYEE") // contexto de ENTRADA do Join é o mesmo exigido do Apply pra EMPLOYEE_COLLECTION
    expect(contexts.get("orchestrator")).toBe("CONSOLIDATED_RESULT")
    expect(contexts.get("end")).toBe("CONSOLIDATED_RESULT")
  })

  it("um novo 'select_employees' depois do Join (fan-out sequencial) fica em CONSOLIDATED_RESULT — não é EMPLOYEE, continua válido", () => {
    const graph: FlowGraph = {
      nodes: [
        ...fanOutJoinGraph().nodes.filter((n) => n.id !== "orchestrator" && n.id !== "end"),
        { id: "select-b", type: "select_employees", label: "Selecionar de novo", position, config: {} },
      ],
      edges: [
        ...fanOutJoinGraph().edges.filter((e) => e.id !== "e7" && e.id !== "e8"),
        { id: "e7b", source: "join", sourceHandle: "always", target: "select-b" },
      ],
    }
    expect(resolveNodeContexts(graph).get("select-b")).toBe("CONSOLIDATED_RESULT")
  })
})

describe("findPrecedingFanOutNode / findPairedJoinNode / findPrecedingJoinNode (fan-in/JOIN)", () => {
  it("findPrecedingFanOutNode acha o 'apply_individually' de origem do Join", () => {
    expect(findPrecedingFanOutNode(fanOutJoinGraph(), "join")?.id).toBe("apply")
  })

  it("findPrecedingFanOutNode devolve undefined quando o Join não tem origem", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position, config: {} },
        { id: "join", type: "consolidate_results", label: "Consolidar resultados", position, config: {} },
      ],
      edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "join" }],
    }
    expect(findPrecedingFanOutNode(graph, "join")).toBeUndefined()
  })

  it("findPairedJoinNode acha o Join a partir do Apply — undefined quando não há Join (comportamento legado)", () => {
    expect(findPairedJoinNode(fanOutJoinGraph(), "apply")?.id).toBe("join")
    const graph: FlowGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position, config: {} },
        { id: "select", type: "select_employees", label: "Selecionar", position, config: {} },
        { id: "apply", type: "apply_individually", label: "Aplicar individualmente", position, config: {} },
        { id: "end", type: "end", label: "Fim", position, config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
        { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
        { id: "e3", source: "apply", sourceHandle: "always", target: "end" },
      ],
    }
    expect(findPairedJoinNode(graph, "apply")).toBeUndefined()
  })

  it("findPrecedingJoinNode acha o Join mais próximo a partir do Orchestrator pós-JOIN", () => {
    expect(findPrecedingJoinNode(fanOutJoinGraph(), "orchestrator")?.id).toBe("join")
  })

  it("fan-out sequencial: findPrecedingCollectionNode a partir de um 2º select NÃO atravessa o Join (não acha o 1º select) — deriva do zero", () => {
    const graph: FlowGraph = {
      nodes: [
        ...fanOutJoinGraph().nodes.filter((n) => n.id !== "orchestrator" && n.id !== "end"),
        { id: "select-b", type: "select_employees", label: "Selecionar B", position, config: {} },
        { id: "apply-b", type: "apply_individually", label: "Aplicar B", position, config: {} },
      ],
      edges: [
        ...fanOutJoinGraph().edges.filter((e) => e.id !== "e7" && e.id !== "e8"),
        { id: "e7b", source: "join", sourceHandle: "always", target: "select-b" },
        { id: "e8b", source: "select-b", sourceHandle: "always", target: "apply-b" },
      ],
    }
    expect(findPrecedingCollectionNode(graph, "apply-b")?.id).toBe("select-b")
    // Sem a correção de boundary isso acharia "select" (o do fan-out A) — errado, são fases
    // diferentes separadas pelo Join.
  })

  it("dois Joins sequenciais: findPrecedingFanOutNode do 2º Join não atravessa o 1º Join pra achar o 1º Apply", () => {
    const graph: FlowGraph = {
      nodes: [
        ...fanOutJoinGraph().nodes.filter((n) => n.id !== "orchestrator" && n.id !== "end"),
        { id: "select-b", type: "select_employees", label: "Selecionar B", position, config: {} },
        { id: "apply-b", type: "apply_individually", label: "Aplicar B", position, config: {} },
        { id: "join-b", type: "consolidate_results", label: "Consolidar B", position, config: {} },
      ],
      edges: [
        ...fanOutJoinGraph().edges.filter((e) => e.id !== "e7" && e.id !== "e8"),
        { id: "e7b", source: "join", sourceHandle: "always", target: "select-b" },
        { id: "e8b", source: "select-b", sourceHandle: "always", target: "apply-b" },
        { id: "e9b", source: "apply-b", sourceHandle: "always", target: "join-b" },
      ],
    }
    expect(findPrecedingFanOutNode(graph, "join-b")?.id).toBe("apply-b")
  })
})

describe("employeeRankingConfigSchema — evolução de 'Selecionar colaboradores' por Ranking", () => {
  it("Parte 16/80 — COUNT nunca é uma agregação válida de ranking, mesmo num payload manual (rejeitado pelo zod, nunca chega ao backend)", () => {
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

  it("aceita um ranking completo válido (Média/Mínimo/Máximo)", () => {
    for (const aggregation of ["AVERAGE", "MINIMUM", "MAXIMUM"]) {
      const result = employeeRankingConfigSchema.safeParse({
        source: "MEASUREMENT",
        indicatorCode: "QUALIDADE",
        aggregation,
        period: { kind: "CALENDAR", unit: "MONTH" },
        selection: "BEST",
        count: 5,
      })
      expect(result.success).toBe(true)
    }
  })

  it("Draft incompleto é permitido — objeto de ranking vazio ainda é um shape válido (Parte 59: Draft pode continuar incompleto)", () => {
    expect(employeeRankingConfigSchema.safeParse({}).success).toBe(true)
  })

  it("count precisa ser inteiro positivo quando presente — zero/negativo/decimal são rejeitados (Parte 24/91)", () => {
    expect(employeeRankingConfigSchema.safeParse({ count: 0 }).success).toBe(false)
    expect(employeeRankingConfigSchema.safeParse({ count: -3 }).success).toBe(false)
    expect(employeeRankingConfigSchema.safeParse({ count: 2.5 }).success).toBe(false)
    expect(employeeRankingConfigSchema.safeParse({ count: 5 }).success).toBe(true)
  })

  it("Parte 1/75 da evolução de Evolução/Grupo — aceita rankingBasis CHANGE + selection IMPROVED/DECLINED + partitionBy TEAM/SUBTEAM", () => {
    for (const selection of ["IMPROVED", "DECLINED"]) {
      for (const partitionBy of ["NONE", "TEAM", "SUBTEAM"]) {
        const result = employeeRankingConfigSchema.safeParse({
          source: "MEASUREMENT",
          indicatorCode: "QUALIDADE",
          aggregation: "AVERAGE",
          period: { kind: "ROLLING_DAYS", days: 30 },
          rankingBasis: "CHANGE",
          selection,
          count: 2,
          partitionBy,
        })
        expect(result.success).toBe(true)
      }
    }
  })

  it("Parte 2/75 — ausência de rankingBasis/partitionBy é um shape válido (equivale a VALUE/NONE em runtime, nunca exigido no schema)", () => {
    const result = employeeRankingConfigSchema.safeParse({ source: "MEASUREMENT", indicatorCode: "QUALIDADE", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 }, selection: "LOWEST", count: 5 })
    expect(result.success).toBe(true)
    expect((result as { data?: { rankingBasis?: unknown; partitionBy?: unknown } }).data?.rankingBasis).toBeUndefined()
    expect((result as { data?: { rankingBasis?: unknown; partitionBy?: unknown } }).data?.partitionBy).toBeUndefined()
  })

  it("rejeita rankingBasis/partitionBy fora do enum", () => {
    expect(employeeRankingConfigSchema.safeParse({ rankingBasis: "TREND" }).success).toBe(false)
    expect(employeeRankingConfigSchema.safeParse({ partitionBy: "COORDINATOR" }).success).toBe(false)
  })
})

describe("flowNodeSchema — 'select_employees' com selectionMode/ranking (backward compatibility, Parte 64/82)", () => {
  it("um payload legado sem `selectionMode` nem `ranking` (só `criterion`) continua parseando normalmente", () => {
    const result = flowNodeSchema.safeParse({
      id: "select",
      type: "select_employees",
      label: "Selecionar",
      position,
      config: { criterion: { comparator: "GTE", thresholdNumeric: 1 } },
    })
    expect(result.success).toBe(true)
  })

  it("um node em modo RANKING (selectionMode + ranking) parseia normalmente", () => {
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

  it("um config totalmente vazio (draft recém-criado) continua válido — nem criterion nem ranking exigidos no schema", () => {
    const result = flowNodeSchema.safeParse({ id: "select", type: "select_employees", label: "Selecionar", position, config: {} })
    expect(result.success).toBe(true)
  })
})
