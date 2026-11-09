import { describe, expect, it } from "vitest"

import type { FlowGraph } from "@/schemas/admin/workflow-graph.schema"

import { connectBranch, withEdgeLabels } from "./edge-presentation"
import { fromReactFlow, toReactFlow } from "./graph-mappers"

const graph: FlowGraph = {
  nodes: [
    { id: "trigger", type: "trigger", label: "Início", position: { x: 0, y: 0 }, config: {} },
    { id: "cond", type: "condition", label: "Nota baixa?", position: { x: 0, y: 100 }, config: { comparator: "EQUALS", thresholdBoolean: true, thresholdNumeric: null } },
    { id: "a", type: "end", label: "Fim A", position: { x: 0, y: 200 }, config: {} },
    { id: "b", type: "end", label: "Fim B", position: { x: 200, y: 200 }, config: {} },
  ],
  edges: [
    { id: "e1", source: "trigger", sourceHandle: "always", target: "cond" },
    { id: "e2", source: "cond", sourceHandle: "true", target: "a" },
    { id: "e3", source: "cond", sourceHandle: "false", target: "b" },
  ],
}

describe("withEdgeLabels", () => {
  const { nodes, edges } = toReactFlow(graph)

  it("rotula só as saídas de etapa com mais de um caminho", () => {
    const labels = Object.fromEntries(withEdgeLabels(edges, nodes).map((edge) => [edge.id, edge.label]))
    expect(labels).toEqual({ e1: undefined, e2: "Sim", e3: "Não" })
  })

  it("reconhece a saída pelo ponto lateral", () => {
    const side = edges.map((edge) => (edge.id === "e3" ? { ...edge, sourceHandle: "false::right" } : edge))
    expect(withEdgeLabels(side, nodes).find((edge) => edge.id === "e3")?.label).toBe("Não")
  })

  it("o rótulo nunca entra no grafo salvo", () => {
    expect(fromReactFlow(nodes, withEdgeLabels(edges, nodes))).toEqual(fromReactFlow(nodes, edges))
  })
})

describe("connectBranch", () => {
  const { edges } = toReactFlow(graph)

  it("ligar a mesma saída pelo ponto lateral substitui a ligação anterior (WF-09)", () => {
    const next = connectBranch(edges, { source: "trigger", sourceHandle: "always::right", target: "a", targetHandle: null })
    const fromTrigger = next.filter((edge) => edge.source === "trigger")
    expect(fromTrigger).toHaveLength(1)
    expect(fromTrigger[0]?.target).toBe("a")
  })

  it("saídas diferentes da mesma etapa continuam independentes", () => {
    const next = connectBranch(edges, { source: "cond", sourceHandle: "true", target: "b", targetHandle: null })
    expect(next.filter((edge) => edge.source === "cond").map((edge) => edge.target).sort()).toEqual(["b", "b"])
  })
})
