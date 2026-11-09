import { describe, expect, it } from "vitest"

import { AdminApiError } from "@/lib/admin/admin-api"
import type { FlowGraph } from "@/schemas/admin/workflow-graph.schema"

import { describeSaveDraftFailure } from "./save-draft-error"

const graph: FlowGraph = {
  nodes: [
    { id: "trigger", type: "trigger", label: "Início", position: { x: 0, y: 0 }, config: {} },
    { id: "agente", type: "action", label: "Analisar chamada", position: { x: 0, y: 0 }, config: { actionType: "CALL_AGENT", agentId: "" } },
    { id: "saida", type: "output", label: "", position: { x: 0, y: 0 }, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "" } },
  ],
  edges: [],
}

const refused = (path: (string | number)[]) => new AdminApiError("Dados inválidos.", "VALIDATION_ERROR", [{ path, message: "Invalid UUID" }])

describe("describeSaveDraftFailure", () => {
  it("nomeia a etapa e o que falta, e aponta o nó para a tela abrir", () => {
    const failure = describeSaveDraftFailure(refused(["graph", "nodes", 1, "config", "agentId"]), graph)
    expect(failure).toEqual({ nodeId: "agente", message: 'Não foi possível salvar: em "Analisar chamada", escolha o agente.' })
  })

  it("etapa sem nome usa o nome do tipo; nunca aspas vazias", () => {
    const failure = describeSaveDraftFailure(refused(["graph", "nodes", 2, "config", "source"]), graph)
    expect(failure.nodeId).toBe("saida")
    expect(failure.message).toContain('em "Output"')
    expect(failure.message).not.toContain('""')
  })

  it("campo sem orientação própria ainda aponta a etapa", () => {
    expect(describeSaveDraftFailure(refused(["graph", "nodes", 1, "config", "campoNovo"]), graph).message).toContain("complete os campos obrigatórios")
  })

  it("outras falhas mantêm a mensagem original, sem apontar etapa", () => {
    expect(describeSaveDraftFailure(new AdminApiError("Sem conexão.", "NETWORK"), graph)).toEqual({ nodeId: null, message: "Sem conexão." })
    expect(describeSaveDraftFailure(new Error("Falhou."), graph)).toEqual({ nodeId: null, message: "Falhou." })
  })

  it("recusa de schema sem caminho reconhecido não mostra só \"Dados inválidos.\"", () => {
    const failure = describeSaveDraftFailure(new AdminApiError("Dados inválidos.", "VALIDATION_ERROR", []), graph)
    expect(failure.nodeId).toBeNull()
    expect(failure.message).toContain("campos obrigatórios")
  })
})
