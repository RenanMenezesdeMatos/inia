/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { Agent, AgentReferenceSummary } from "@/schemas/admin/agent.schema"
import type { FlowGraph, FlowNode } from "@/schemas/admin/workflow-graph.schema"
import type { WorkflowTrigger } from "@/schemas/admin/workflow.schema"

import { ActionForm } from "./action-form"
import { AgentVersionField } from "./agent-version-field"

/**
 * Revisão aprovada da PEN-002/PEN-076 (03/11/2026): a etapa "Chamar agente" não fixa versão — cada execução usa a vigente do
 * agente. O editor não oferece escolher versão e remove a referência legada (`agentVersionId`) ao trocar de agente.
 */
const service = vi.hoisted(() => ({ fetchAgentReferences: vi.fn(), fetchAgentPromptPreview: vi.fn() }))
vi.mock("@/services/admin/agent-service", () => service)
vi.mock("@/queries/auth/use-current-user", () => ({ useCurrentUserQuery: () => ({ data: { features: { interactionFeedbackQa: false } } }) }))

const REFERENCE: AgentReferenceSummary = {
  id: "a-fat",
  name: "Especialista de Faturamento",
  agentType: "CALL_FEEDBACK",
  active: true,
  published: true,
  currentVersionId: "av-5",
  currentVersionNumber: 5,
  versions: [
    { id: "av-5", number: 5, publishedAt: "2026-11-02T10:00:00.000Z" },
    { id: "av-4", number: 4, publishedAt: "2026-10-20T10:00:00.000Z" },
  ],
}

function agent(id: string, name: string): Agent {
  return { id, name, agentType: "CALL_FEEDBACK", objective: "", description: "", contextPrompt: "", active: true, createdAt: "2026-09-16T00:00:00.000Z", createdByName: null, usageCount: 0, scopeType: "ALL_TEAMS", teamId: null, teamName: null, subteamId: null, subteamName: null, knowledgeDocuments: [], actionLimitsEnabled: false, actionLimits: null, specialty: null, specialtyKind: null, domain: null, businessDomainId: null, businessDomain: null, capability: null, consolidatedInput: false, recommendSupportMaterials: false, investigationCapabilities: [], currentVersionId: "av-5", currentVersionNumber: 5, currentVersionPublishedAt: null, published: true, hasDraft: false, draftRevision: 0, draftUpdatedAt: null, draftUpdatedByName: null, draft: null }
}

beforeAll(() => installJsdomStubs())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Chamar agente — versão do agente", () => {
  it("sem seletor de versão: diz que a etapa usa sempre a vigente e que uma versão nova vale sem republicar o Workflow", async () => {
    service.fetchAgentReferences.mockResolvedValue([REFERENCE])
    renderWithQuery(<AgentVersionField agentId="a-fat" />)

    expect(await screen.findByText("Usa sempre a versão vigente do agente (versão 5); uma versão nova vale nas próximas execuções, sem republicar o Workflow.")).toBeInTheDocument()
    expect(screen.queryByRole("combobox")).toBeNull()
    expect(screen.queryByText(/Versão do agente/)).toBeNull()
    expect(screen.queryByText(/fixad/)).toBeNull()
  })

  it("mantém os avisos de agente inativo e de agente não publicado", async () => {
    service.fetchAgentReferences.mockResolvedValue([{ ...REFERENCE, active: false, published: false, currentVersionId: null, currentVersionNumber: null, versions: [] }])
    renderWithQuery(<AgentVersionField agentId="a-fat" />)

    expect(await screen.findByRole("alert")).toHaveTextContent("está inativo e não aceita novas execuções")
    expect(screen.getByText("Agente não publicado — publique-o antes de publicar o Workflow.")).toBeInTheDocument()
    expect(screen.queryByText(/Usa sempre a versão vigente/)).toBeNull()
  })

  it("trocar o agente não grava versão e remove a referência legada", async () => {
    service.fetchAgentReferences.mockResolvedValue([REFERENCE])
    const onChange = vi.fn()
    const trigger: WorkflowTrigger = { kind: "channel_flag", channelFlagId: "flag-1", channel: "VOICE", flagName: "Rechamada", valueType: "BOOLEAN" }
    const triggerNode = { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} } as unknown as FlowNode
    const node = { id: "node", type: "action", label: "Analisar chamada", position: { x: 0, y: 0 }, config: { actionType: "CALL_AGENT", agentId: "", agentVersionId: "av-legado" } } as unknown as Extract<FlowNode, { type: "action" }>
    const graph = { nodes: [triggerNode, node], edges: [{ id: "e1", source: "trigger", target: "node", sourceHandle: "always" }] } as unknown as FlowGraph
    const agents = [agent("a-fat", "Especialista de Faturamento")]
    renderWithQuery(<ActionForm node={node} graph={graph} agents={agents} agentsById={new Map(agents.map((item) => [item.id, item]))} orchestratorsById={new Map()} trigger={trigger} workflowId="wf-1" onChange={onChange} />)

    fireEvent.click(screen.getByRole("button", { name: /Especialista de Faturamento/ }))
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    const next = onChange.mock.calls[0]![0] as Extract<FlowNode, { type: "action" }>
    expect(next.config).toMatchObject({ actionType: "CALL_AGENT", agentId: "a-fat" })
    expect(next.config).not.toHaveProperty("agentVersionId")
  })
})
