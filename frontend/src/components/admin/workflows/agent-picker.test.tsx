/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Label } from "@/components/ui/label"
import type { Agent } from "@/schemas/admin/agent.schema"

import { AgentPicker } from "./agent-picker"

afterEach(cleanup)

function agent(id: string, name: string, specialty: Agent["specialty"]): Agent {
  return { id, name, agentType: "CUSTOM", objective: "", description: "", contextPrompt: "", active: true, createdAt: "2026-09-16T00:00:00.000Z", createdByName: null, usageCount: 0, scopeType: "ALL_TEAMS", teamId: null, teamName: null, subteamId: null, subteamName: null, knowledgeDocuments: [], actionLimitsEnabled: false, actionLimits: null, specialty, specialtyKind: null, domain: null, businessDomainId: null, businessDomain: null, capability: null, consolidatedInput: false, recommendSupportMaterials: false, investigationCapabilities: [], currentVersionId: "v1", currentVersionNumber: 1, currentVersionPublishedAt: null, published: true, hasDraft: false, draftRevision: 0, draftUpdatedAt: null, draftUpdatedByName: null, draft: null }
}

describe("AgentPicker — especialista incompatível com a política aparece desabilitado, com o motivo", () => {
  it("o agente de outro domínio não pode ser escolhido e mostra 'pertence a outro domínio'", () => {
    const onChange = vi.fn()
    const agents = [agent("a-fat", "Especialista de Faturamento", "FATURAMENTO"), agent("a-ret", "Especialista de Retenção", "RETENCAO")]
    render(<AgentPicker agents={agents} value="" onChange={onChange} disabledReason={(candidate) => (candidate.specialty === "RETENCAO" ? "Este especialista pertence a outro domínio (Retenção e Cancelamento)." : null)} />)
    const forbidden = screen.getByRole("button", { name: /Especialista de Retenção/ })
    expect(forbidden).toBeDisabled()
    expect(forbidden).toHaveAttribute("title", "Este especialista pertence a outro domínio (Retenção e Cancelamento).")
    expect(forbidden).toHaveTextContent("pertence a outro domínio")
    fireEvent.click(forbidden)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: /Especialista de Faturamento/ }))
    expect(onChange).toHaveBeenCalledWith("a-fat")
  })
})

describe("AgentPicker — caracterização: a lista acompanha o valor que vem de fora", () => {
  it("sem agente escolhido a lista (com busca) aparece; o valor preenchido por fora a fecha; limpar por fora abre de novo", () => {
    const agents = [agent("a-fat", "Especialista de Faturamento", "FATURAMENTO")]
    const { rerender } = render(<AgentPicker agents={agents} value="" onChange={vi.fn()} />)
    expect(screen.getByPlaceholderText("Buscar agente...")).toBeInTheDocument()
    rerender(<AgentPicker agents={agents} value="a-fat" onChange={vi.fn()} />)
    expect(screen.queryByPlaceholderText("Buscar agente...")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Especialista de Faturamento/ })).toBeInTheDocument()
    rerender(<AgentPicker agents={agents} value="" onChange={vi.fn()} />)
    expect(screen.getByPlaceholderText("Buscar agente...")).toBeInTheDocument()
  })
})

describe("AgentPicker — o rótulo de quem usa o seletor nomeia a busca", () => {
  it("com id, o <Label htmlFor> encontra o campo de busca; o agente escolhido continua nomeado pelo próprio nome", () => {
    const agents = [agent("a-fat", "Especialista de Faturamento", "FATURAMENTO")]
    const { rerender } = render(
      <>
        <Label htmlFor="picker-agent">Agente</Label>
        <AgentPicker id="picker-agent" agents={agents} value="" onChange={vi.fn()} />
      </>,
    )
    expect(screen.getByLabelText("Agente")).toBe(screen.getByPlaceholderText("Buscar agente..."))
    rerender(
      <>
        <Label htmlFor="picker-agent">Agente</Label>
        <AgentPicker id="picker-agent" agents={agents} value="a-fat" onChange={vi.fn()} />
      </>,
    )
    expect(screen.getByRole("button", { name: /Especialista de Faturamento/ })).toBeInTheDocument()
  })
})

// QA de 17/11: a etapa de um Workflow B2B com agente B2C salvo parecia válida com o seletor fechado.
describe("AgentPicker — agente escolhido que não pode mais ser usado", () => {
  it("com a lista fechada, mostra o motivo abaixo do agente escolhido", () => {
    const agents = [agent("a-b2c", "Agente B2C", null)]
    render(<AgentPicker agents={agents} value="a-b2c" onChange={vi.fn()} disabledReason={() => "De outro universo de atuação (B2C) — escolha um agente do universo deste Workflow."} />)
    expect(screen.queryByPlaceholderText("Buscar agente...")).not.toBeInTheDocument()
    expect(screen.getByTestId("agent-picker-selected-blocked")).toHaveTextContent("De outro universo de atuação (B2C)")
  })

  it("agente escolhido válido não mostra aviso", () => {
    const agents = [agent("a-ok", "Agente válido", null)]
    render(<AgentPicker agents={agents} value="a-ok" onChange={vi.fn()} disabledReason={() => null} />)
    expect(screen.queryByTestId("agent-picker-selected-blocked")).not.toBeInTheDocument()
  })
})
