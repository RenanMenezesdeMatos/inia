/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { ReactFlowProvider, type Node, type NodeProps } from "@xyflow/react"
import { afterEach, describe, expect, it } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import type { FlowNode } from "@/schemas/admin/workflow-graph.schema"

import type { RFNodeData } from "./graph-mappers"
import { describeNodeConfig, nodeDisplayName, nodeKindLabel } from "./node-visuals"
import { WorkflowEditorProvider } from "./workflow-editor-context"
import { WorkflowNode } from "./workflow-node"

installJsdomStubs()
afterEach(cleanup)

const UUID = "7f1f0c2a-3f1e-4a55-9a6a-111111111111"
const position = { x: 0, y: 0 }

function renderNode(flowNode: FlowNode) {
  const props = { id: flowNode.id, data: { flowNode }, selected: false } as unknown as NodeProps<Node<RFNodeData>>
  return render(
    <ReactFlowProvider>
      <WorkflowEditorProvider value={{}}>
        <WorkflowNode {...props} />
      </WorkflowEditorProvider>
    </ReactFlowProvider>,
  )
}

describe("WorkflowNode (WF-15)", () => {
  it("mostra o nome da etapa e o nome da ação; nunca o id técnico", () => {
    const { container } = renderNode({ id: UUID, type: "action", label: "Analisar chamada", position, config: { actionType: "CALL_AGENT", agentId: "" } })
    expect(screen.getByText("Analisar chamada")).toBeInTheDocument()
    expect(screen.getByText("Chamar agente")).toBeInTheDocument()
    expect(screen.getByText("Agente ainda não escolhido")).toBeInTheDocument()
    expect(container.textContent).not.toContain(UUID)
  })

  it("etapa antiga sem nome aparece pelo que ela é", () => {
    renderNode({ id: UUID, type: "wait", label: "  ", position, config: { durationMs: 60000 } })
    expect(screen.getAllByText("Aguardar").length).toBeGreaterThan(0)
  })
})

describe("nomes e resumo das etapas", () => {
  const output = (target: Extract<FlowNode, { type: "output" }>["config"]["target"]): FlowNode => ({ id: "o", type: "output", label: "", position, config: { target, surfaces: ["FOLLOW_UP"], source: "x" } })

  it("WF-30: Output para um cargo diz qual cargo", () => {
    expect(describeNodeConfig(output({ type: "ROLE", role: "MANAGER" }), {})).toBe("Gerente — Acompanhamento")
  })

  it("nodeKindLabel e nodeDisplayName nunca devolvem vazio nem \"Ação\"", () => {
    const action: FlowNode = { id: "a", type: "action", label: "", position, config: { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "MANAGER" }, surfaces: ["NOTIFICATION"] } }
    expect(nodeKindLabel(action)).toBe("Escalonar")
    expect(nodeDisplayName(action)).toBe("Escalonar")
    expect(nodeDisplayName({ ...action, label: "Avisar a gerência" })).toBe("Avisar a gerência")
  })
})
