import { describe, expect, it } from "vitest"

import type { FlowGraph, FlowNode } from "@/schemas/admin/workflow-graph.schema"

import { findNodeDependents } from "./graph-references"

const position = { x: 0, y: 0 }
const agent: FlowNode = { id: "agente", type: "action", label: "Análise", position, config: { actionType: "CALL_AGENT", agentId: "a1" } }

function graphWith(...nodes: FlowNode[]): FlowGraph {
  return { nodes: [agent, ...nodes], edges: [] }
}

const dependents = (graph: FlowGraph) => findNodeDependents(graph, "agente").map((node) => node.id)

describe("findNodeDependents", () => {
  it("acha Output, Revisão humana e Gerar feedback que usam a etapa", () => {
    const graph = graphWith(
      { id: "saida", type: "output", label: "Saída", position, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.agente" } },
      { id: "revisao", type: "human_review", label: "Revisão", position, config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, contentSource: "nodeOutputs.agente.structuredResult.resumo" } },
      { id: "feedback", type: "action", label: "Feedback", position, config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: "agente", feedbackDomain: "AUTO" } },
    )
    expect(dependents(graph)).toEqual(["saida", "revisao", "feedback"])
  })

  it("acha Condição simples e dentro de grupo", () => {
    const graph = graphWith(
      { id: "simples", type: "condition", label: "C1", position, config: { comparator: "EQUALS", thresholdBoolean: true, thresholdNumeric: null, sourcePath: "nodeOutputs.agente.ok" } },
      {
        id: "grupo",
        type: "condition",
        label: "C2",
        position,
        config: { comparator: "EQUALS", thresholdBoolean: null, thresholdNumeric: null, group: { operator: "ALL", rules: [{ comparator: "EQUALS", thresholdBoolean: true, thresholdNumeric: null, sourcePath: "nodeOutputs.agente.ok" }] } },
      },
    )
    expect(dependents(graph)).toEqual(["simples", "grupo"])
  })

  it("não confunde prefixo de id nem texto igual ao id em campo comum", () => {
    const graph = graphWith(
      { id: "outro", type: "output", label: "Saída", position, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.agente2" } },
      { id: "texto", type: "condition", label: "C", position, config: { comparator: "EQUALS", thresholdBoolean: null, thresholdNumeric: null, thresholdText: "agente", sourcePath: "nodeOutputs.outra.campo" } },
    )
    expect(dependents(graph)).toEqual([])
  })
})
