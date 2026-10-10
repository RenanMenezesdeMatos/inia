/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { Agent } from "@/schemas/admin/agent.schema"

import { AgentPicker } from "./agent-picker"

afterEach(cleanup)

function agent(id: string, name: string, specialty: Agent["specialty"]): Agent {
  return { id, name, agentType: "CUSTOM", objective: "", description: "", contextPrompt: "", active: true, createdAt: "2026-09-16T00:00:00.000Z", createdByName: null, usageCount: 0, scopeType: "ALL_TEAMS", teamId: null, teamName: null, subteamId: null, subteamName: null, knowledgeDocuments: [], prohibitedTopics: [], specialty, specialtyKind: null, domain: null, businessDomainId: null, businessDomain: null, capability: null, consolidatedInput: false, recommendSupportMaterials: false, investigationCapabilities: [] }
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
