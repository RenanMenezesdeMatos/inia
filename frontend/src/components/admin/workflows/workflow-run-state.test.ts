import { describe, expect, it } from "vitest"

import type { FlowGraph } from "@/schemas/admin/workflow-graph.schema"

import { hasUnpublishedGraphChanges, isEmptyFlow, workflowRunState } from "./workflow-run-state"

const graph = (overrides: Partial<FlowGraph> = {}): FlowGraph => ({
  nodes: [
    { id: "trigger", type: "trigger", label: "Início", position: { x: 0, y: 0 }, config: {} },
    { id: "wait", type: "wait", label: "Aguardar", position: { x: 0, y: 100 }, config: { durationMs: 60000 } },
    { id: "end", type: "end", label: "Fim", position: { x: 0, y: 200 }, config: {} },
  ],
  edges: [
    { id: "e1", source: "trigger", sourceHandle: "always", target: "wait" },
    { id: "e2", source: "wait", sourceHandle: "always", target: "end" },
  ],
  ...overrides,
})

describe("workflowRunState", () => {
  it("rascunho nunca roda, mesmo com o interruptor ligado", () => {
    expect(workflowRunState({ published: false, active: true }).key).toBe("DRAFT")
    expect(workflowRunState({ published: false, active: true }).label).toContain("ainda não roda")
  })

  it("publicado e ativo está no ar; publicado e inativo não roda e diz que as execuções ficam paradas", () => {
    expect(workflowRunState({ published: true, active: true }).label).toBe("No ar")
    const inactive = workflowRunState({ published: true, active: false })
    expect(inactive.label).toContain("não roda")
    expect(inactive.description).toContain("ficam paradas")
  })
})

describe("hasUnpublishedGraphChanges", () => {
  it("sem versão publicada, tudo é novo", () => {
    expect(hasUnpublishedGraphChanges(graph(), null)).toBe(true)
  })

  it("mover uma etapa e a ordem dos campos não contam como alteração", () => {
    const moved = graph()
    moved.nodes[1] = { ...moved.nodes[1]!, position: { x: 500, y: 500 } }
    const reordered = graph()
    reordered.edges = [reordered.edges[1]!, reordered.edges[0]!]
    expect(hasUnpublishedGraphChanges(moved, graph())).toBe(false)
    expect(hasUnpublishedGraphChanges(reordered, graph())).toBe(false)
  })

  it("mudar configuração, nome ou ligação conta como alteração", () => {
    const config = graph()
    config.nodes[1] = { id: "wait", type: "wait", label: "Aguardar", position: { x: 0, y: 100 }, config: { durationMs: 120000 } }
    const renamed = graph()
    renamed.nodes[1] = { ...renamed.nodes[1]!, label: "Outro nome" }
    const rewired = graph()
    rewired.edges = [{ id: "e1", source: "trigger", sourceHandle: "always", target: "end" }]
    expect(hasUnpublishedGraphChanges(config, graph())).toBe(true)
    expect(hasUnpublishedGraphChanges(renamed, graph())).toBe(true)
    expect(hasUnpublishedGraphChanges(rewired, graph())).toBe(true)
  })

  it("a versão do orquestrador gravada pela publicação não aparece como alteração", () => {
    const orchestrator = (pinned?: string): FlowGraph => ({
      nodes: [{ id: "o", type: "orchestrator", label: "O", position: { x: 0, y: 0 }, config: { orchestratorId: "x", instruction: "y", ...(pinned ? { orchestratorVersionId: pinned } : {}) } }],
      edges: [],
    })
    expect(hasUnpublishedGraphChanges(orchestrator(), orchestrator("v1"))).toBe(false)
  })
})

describe("isEmptyFlow", () => {
  it("só Gatilho e Fim é um fluxo vazio", () => {
    const empty = graph({ nodes: graph().nodes.filter((node) => node.type !== "wait"), edges: [] })
    expect(isEmptyFlow(empty)).toBe(true)
    expect(isEmptyFlow(graph())).toBe(false)
  })
})
