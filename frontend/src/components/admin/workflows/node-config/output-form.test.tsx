/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import type { FlowGraph, FlowNode, OutputTarget } from "@/schemas/admin/workflow-graph.schema"
import { validateWorkflowGraph } from "@/schemas/admin/workflow-validation"
import type { WorkflowTrigger } from "@/schemas/admin/workflow.schema"

import { OutputForm } from "./output-form"

installJsdomStubs()

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const SCHEDULE: WorkflowTrigger = { kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1, frequency: { type: "DAILY" } }
const position = { x: 0, y: 0 }
const output = (id: string, target: OutputTarget): Extract<FlowNode, { type: "output" }> => ({ id, type: "output", label: id, position, config: { target, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.agente" } })

/** Um Workflow consolidado completo: um Output em cada trecho do fluxo, com o sujeito de cada um. */
function consolidatedGraph(target: OutputTarget): FlowGraph {
  const agent: FlowNode = { id: "agente", type: "action", label: "Agente", position, config: { actionType: "CALL_AGENT", agentId: "agente-ficticio", scheduledDataSource: { kind: "PERFORMANCE", closures: 1 } } }
  return {
    nodes: [
      { id: "gatilho", type: "trigger", label: "Gatilho", position, config: {} },
      { id: "selecionar", type: "select_employees", label: "Selecionar", position, config: { selectionMode: "RANKING", ranking: { source: "PRV_ACHIEVEMENT", aggregation: "AVERAGE", period: { kind: "CALENDAR", unit: "MONTH" }, selection: "BEST", count: 1 } } },
      { id: "aplicar", type: "apply_individually", label: "Aplicar", position, config: {} },
      agent,
      output("individual", target),
      { id: "consolidar", type: "consolidate_results", label: "Consolidar", position, config: {} },
      output("depois-de-consolidar", { type: "ROLE", role: "DIRECTOR" }),
      { id: "fim", type: "end", label: "Fim", position, config: {} },
    ],
    edges: [
      { id: "1", source: "gatilho", sourceHandle: "always", target: "selecionar" },
      { id: "2", source: "selecionar", sourceHandle: "always", target: "aplicar" },
      { id: "3", source: "aplicar", sourceHandle: "always", target: "agente" },
      { id: "4", source: "agente", sourceHandle: "always", target: "individual" },
      { id: "5", source: "individual", sourceHandle: "always", target: "consolidar" },
      { id: "6", source: "consolidar", sourceHandle: "always", target: "depois-de-consolidar" },
      { id: "7", source: "depois-de-consolidar", sourceHandle: "always", target: "fim" },
    ],
  }
}

function renderForm(graph: FlowGraph, nodeId: string, evaluationMode: "INDIVIDUAL" | "CONSOLIDATED", onChange: (next: FlowNode) => void = () => {}) {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId) as Extract<FlowNode, { type: "output" }>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OutputForm node={node} graph={graph} agentsById={new Map()} orchestratorsById={new Map()} workflowId="workflow-ficticio" evaluationMode={evaluationMode} trigger={SCHEDULE} onChange={onChange} />
    </QueryClientProvider>,
  )
}

const recipientField = () => screen.getByRole("combobox", { name: "Destinatário" })
function offeredRecipients(): (string | null)[] {
  fireEvent.keyDown(recipientField(), { key: "ArrowDown" })
  return screen.getAllByRole("option").map((option) => option.textContent)
}

const OWN = "O próprio colaborador"

describe("OutputForm — quem aparece em Destinatário", () => {
  it("no caminho individual de um Workflow consolidado, mostra o valor e o oferece", () => {
    renderForm(consolidatedGraph({ type: "CURRENT_OPERATOR" }), "individual", "CONSOLIDATED")
    expect(recipientField()).toHaveTextContent(OWN)
    expect(offeredRecipients()).toContain(OWN)
  })

  it("no caminho individual, quem trocou de destinatário consegue voltar", () => {
    const onChange = vi.fn()
    renderForm(consolidatedGraph({ type: "SUPERVISOR_OF_OPERATOR" }), "individual", "CONSOLIDATED", onChange)
    expect(offeredRecipients()).toContain(OWN)
    fireEvent.click(screen.getByRole("option", { name: OWN }))
    expect(onChange.mock.calls[0]![0].config.target).toEqual({ type: "CURRENT_OPERATOR" })
  })

  it("depois de \"Consolidar resultados\", não oferece: ali não há um colaborador como sujeito", () => {
    renderForm(consolidatedGraph({ type: "CURRENT_OPERATOR" }), "depois-de-consolidar", "CONSOLIDATED")
    expect(recipientField()).toHaveTextContent("Cargo específico")
    expect(offeredRecipients()).not.toContain(OWN)
  })

  it("antes de \"Aplicar individualmente\", não oferece", () => {
    const graph = consolidatedGraph({ type: "CURRENT_OPERATOR" })
    graph.nodes.push(output("na-estrutura", { type: "ROLE", role: "DIRECTOR" }))
    graph.edges.push({ id: "8", source: "gatilho", sourceHandle: "always", target: "na-estrutura" })
    renderForm(graph, "na-estrutura", "CONSOLIDATED")
    expect(offeredRecipients()).not.toContain(OWN)
  })

  it("valor salvo onde não vale continua visível, nunca um campo em branco, e a validação aponta o problema", () => {
    const graph = consolidatedGraph({ type: "CURRENT_OPERATOR" })
    const stale = output("depois-de-consolidar", { type: "CURRENT_OPERATOR" })
    graph.nodes = graph.nodes.map((node) => (node.id === stale.id ? stale : node))
    renderForm(graph, stale.id, "CONSOLIDATED")
    expect(recipientField()).toHaveTextContent(OWN)
    const issues = validateWorkflowGraph(graph, SCHEDULE, new Map(), new Map(), true)
    expect(issues.some((issue) => issue.nodeId === stale.id && issue.code === "WORKFLOW_OUTPUT_TARGET_INVALID_MODE")).toBe(true)
  })

  it("o que a lista oferece é o que a publicação aceita, no caminho individual", () => {
    const graph = consolidatedGraph({ type: "CURRENT_OPERATOR" })
    const issues = validateWorkflowGraph(graph, SCHEDULE, new Map(), new Map(), true)
    expect(issues.filter((issue) => issue.code === "WORKFLOW_OUTPUT_TARGET_INVALID_MODE")).toEqual([])
  })

  it("em Workflow individual, oferece sempre", () => {
    const graph: FlowGraph = {
      nodes: [{ id: "gatilho", type: "trigger", label: "Gatilho", position, config: {} }, output("entrega", { type: "ROLE", role: "MANAGER" }), { id: "fim", type: "end", label: "Fim", position, config: {} }],
      edges: [{ id: "1", source: "gatilho", sourceHandle: "always", target: "entrega" }, { id: "2", source: "entrega", sourceHandle: "always", target: "fim" }],
    }
    renderForm(graph, "entrega", "INDIVIDUAL")
    expect(offeredRecipients()).toContain(OWN)
  })
})
