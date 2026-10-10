import { describe, expect, it } from "vitest"
import type { FlowGraph } from "../domain/graph-schema.js"
import { appendMissingOutputNodes } from "./legacy-output-migration.js"

function legacyGraph(): FlowGraph {
  return {
    nodes: [
      { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
      { id: "condition", type: "condition", label: "Condição", position: { x: 0, y: 160 }, config: { comparator: "LTE", thresholdNumeric: 3 } },
      { id: "action", type: "action", label: "Ação", position: { x: 0, y: 320 }, config: { actionType: "CALL_AGENT", agentId: "agent-1" } },
      { id: "end", type: "end", label: "Fim", position: { x: 0, y: 480 }, config: {} },
    ],
    edges: [
      { id: "e-trigger-condition", source: "trigger", sourceHandle: "always", target: "condition" },
      { id: "e-condition-true", source: "condition", sourceHandle: "true", target: "action" },
      { id: "e-condition-false", source: "condition", sourceHandle: "false", target: "end" },
      { id: "e-action-end", source: "action", sourceHandle: "always", target: "end" },
    ],
  }
}

describe("appendMissingOutputNodes", () => {
  it("inserts Output(CURRENT_OPERATOR, FOLLOW_UP) between a terminal CALL_AGENT and its target", () => {
    const { graph, changed } = appendMissingOutputNodes(legacyGraph())
    expect(changed).toBe(true)

    const outputNode = graph.nodes.find((node) => node.type === "output")
    expect(outputNode).toBeDefined()
    if (outputNode?.type !== "output") throw new Error("expected an output node")
    expect(outputNode.config).toMatchObject({ target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.action" })

    const actionEdge = graph.edges.find((edge) => edge.source === "action" && edge.sourceHandle === "always")
    expect(actionEdge?.target).toBe(outputNode.id)
    const outputEdge = graph.edges.find((edge) => edge.source === outputNode.id)
    expect(outputEdge?.target).toBe("end")

    // a aresta condition->true continua intocada, só o trecho depois do agente foi religado
    expect(graph.edges.find((edge) => edge.id === "e-condition-true")?.target).toBe("action")
  })

  it("is a no-op when the graph already has an output node", () => {
    const base = legacyGraph()
    const alreadyMigrated: FlowGraph = {
      nodes: [...base.nodes, { id: "output", type: "output", label: "Output", position: { x: 0, y: 640 }, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.action" } }],
      edges: base.edges,
    }
    const { changed } = appendMissingOutputNodes(alreadyMigrated)
    expect(changed).toBe(false)
  })

  it("is a no-op when the graph has no CALL_AGENT node", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        { id: "end", type: "end", label: "Fim", position: { x: 0, y: 160 }, config: {} },
      ],
      edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "end" }],
    }
    const { changed } = appendMissingOutputNodes(graph)
    expect(changed).toBe(false)
  })
})
