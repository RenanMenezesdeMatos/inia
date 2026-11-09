/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import type { ActionConfig, FlowGraph } from "@/schemas/admin/workflow-graph.schema"

import { EscalateForm } from "./escalate-form"

vi.mock("@/queries/admin/use-user-account-queries", () => ({ useUserAccountsQuery: () => ({ data: [] }) }))
installJsdomStubs()

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

type EscalateConfig = Extract<ActionConfig, { actionType: "ESCALATE" }>

const position = { x: 0, y: 0 }
const GRAPH: FlowGraph = {
  nodes: [
    { id: "gatilho", type: "trigger", label: "Gatilho", position, config: {} },
    { id: "agente", type: "action", label: "Agente", position, config: { actionType: "CALL_AGENT", agentId: "agente-ficticio" } },
    { id: "feedback", type: "action", label: "Gerar feedback", position, config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: "agente", feedbackDomain: "MONITORING" } },
    { id: "escalonar", type: "action", label: "Escalonar", position, config: { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "MANAGER" }, surfaces: ["FOLLOW_UP"] } },
    { id: "fim", type: "end", label: "Fim", position, config: {} },
  ],
  edges: [
    { id: "1", source: "gatilho", sourceHandle: "always", target: "agente" },
    { id: "2", source: "agente", sourceHandle: "always", target: "feedback" },
    { id: "3", source: "feedback", sourceHandle: "always", target: "escalonar" },
    { id: "4", source: "escalonar", sourceHandle: "always", target: "fim" },
  ],
}

function renderForm(config: Partial<EscalateConfig>, onChange: (next: ActionConfig) => void = () => {}) {
  const full: EscalateConfig = { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "MANAGER" }, surfaces: ["FOLLOW_UP"], ...config }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EscalateForm config={full} graph={GRAPH} fromNodeId="escalonar" workflowId="workflow-ficticio" agentsById={new Map()} orchestratorsById={new Map()} onChange={onChange} />
    </QueryClientProvider>,
  )
}

const FEEDBACK = "Feedback confiável: Gerar feedback"
const contentField = () => screen.getByRole("combobox", { name: "Conteúdo a escalonar (opcional)" })
const surface = (name: string) => screen.getByRole("button", { name })

describe("EscalateForm — conteúdo a escalonar", () => {
  it("oferece o feedback gerado antes, e quem escolhe grava o caminho dele", () => {
    const onChange = vi.fn()
    renderForm({}, onChange)
    fireEvent.keyDown(contentField(), { key: "ArrowDown" })
    fireEvent.click(screen.getByRole("option", { name: FEEDBACK }))
    expect(onChange.mock.calls[0]![0].contentSource).toBe("nodeOutputs.feedback")
  })

  it("mostra o feedback já configurado, em vez de um campo em branco", () => {
    renderForm({ contentSource: "nodeOutputs.feedback" })
    expect(contentField()).toHaveTextContent(FEEDBACK)
  })

  it("com um feedback como conteúdo, Chat e Avatar ficam indisponíveis e a tela explica o motivo", () => {
    renderForm({ contentSource: "nodeOutputs.feedback" })
    expect(surface("Chat")).toBeDisabled()
    expect(surface("Avatar")).toBeDisabled()
    expect(surface("Acompanhamento")).toBeEnabled()
    expect(surface("Notificação")).toBeEnabled()
    expect(screen.getByText(/feedback é do colaborador analisado/)).toBeInTheDocument()
  })

  it("Chat já marcado continua clicável, para poder tirar", () => {
    renderForm({ contentSource: "nodeOutputs.feedback", surfaces: ["CHAT"] })
    expect(surface("Chat")).toBeEnabled()
  })

  it("com outro conteúdo, Chat e Avatar seguem disponíveis", () => {
    renderForm({ contentSource: "nodeOutputs.agente" })
    expect(surface("Chat")).toBeEnabled()
    expect(surface("Avatar")).toBeEnabled()
    expect(screen.queryByText(/feedback é do colaborador analisado/)).not.toBeInTheDocument()
  })
})
