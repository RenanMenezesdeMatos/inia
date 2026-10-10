/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { MANAGER_CONTEXT, STRUCTURE_OVERVIEW, SUPERVISOR_CONTEXT, TEAM_MEMBERS, TEAM_OVERVIEW } from "@/components/analytics/testing/fixtures"
import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"

import { TeamView } from "./team-view"

const service = vi.hoisted(() => ({ fetchTeamOverview: vi.fn(), fetchTeamMembers: vi.fn() }))
vi.mock("@/services/analytics/analytics-service", () => service)

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Equipe — Supervisor", () => {
  it("resumo por fatos + tabela enxuta de membros com PRV, média, situação, indicadores em atenção e pendências", async () => {
    service.fetchTeamOverview.mockResolvedValue(TEAM_OVERVIEW)
    service.fetchTeamMembers.mockResolvedValue(TEAM_MEMBERS)
    renderWithQuery(<TeamView context={SUPERVISOR_CONTEXT} state={{ subject: null, period: null }} onStateChange={() => {}} employeeHref={(id) => `/supervisor/operators/${id}`} />)

    expect(await screen.findByText("Minha equipe")).toBeInTheDocument()
    expect(screen.getByText("2 colaboradores")).toBeInTheDocument()
    const summary = screen.getByRole("list", { name: "Resumo da equipe" })
    expect(summary).toHaveTextContent("Abaixo da referência")
    // Semântica explícita: ciência é a confirmação do PRÓPRIO colaborador; revisões são decisões do gestor.
    expect(summary).toHaveTextContent("Aguardando ciência do colaborador")
    expect(summary).toHaveTextContent("Revisões aguardando sua decisão")
    expect(screen.getByRole("link", { name: /Revisões aguardando sua decisão/ })).toHaveAttribute("href", "/supervisor?tab=pending")

    const table = await screen.findByRole("table")
    expect(table).toHaveTextContent("Ana Operadora")
    expect(table).toHaveTextContent("105%")
    expect(table).toHaveTextContent("102,9%")
    expect(table).toHaveTextContent("Tempo Médio de Atendimento (93,3%)")
    expect(table).toHaveTextContent("3 acompanhamentos")
    // Contadores acionáveis com destino: ciência → Acompanhamento do colaborador filtrado; revisão → Pendências.
    expect(screen.getByRole("link", { name: /1 aguardando ciência/ })).toHaveAttribute("href", "/supervisor/operators/op-1?tab=followup&ack=pending")
    expect(screen.getByRole("link", { name: /1 revisão aguarda você/ })).toHaveAttribute("href", "/supervisor?tab=pending&operator=op-2")
    // SEM DADOS é first-class: nunca 0%
    const dora = screen.getByRole("link", { name: "Abrir perfil de Dora Sem Dados" }).closest("tr")!
    expect(dora).toHaveTextContent("Sem dados")
    expect(dora).not.toHaveTextContent("0%")
    expect(screen.getByRole("link", { name: "Abrir perfil de Ana Operadora" })).toHaveAttribute("href", "/supervisor/operators/op-1")
  })

  it("filtros e ordenação vão para a API (busca, situação, indicador em atenção, pendências)", async () => {
    service.fetchTeamOverview.mockResolvedValue(TEAM_OVERVIEW)
    service.fetchTeamMembers.mockResolvedValue(TEAM_MEMBERS)
    renderWithQuery(<TeamView context={SUPERVISOR_CONTEXT} state={{ subject: null, period: null }} onStateChange={() => {}} employeeHref={(id) => `/e/${id}`} />)
    await screen.findByRole("table")
    await waitFor(() => expect(service.fetchTeamMembers).toHaveBeenCalledWith(null, "2026-09", expect.objectContaining({ sort: "situation", order: "asc", page: 1, pageSize: 10 })))

    fireEvent.click(screen.getByRole("button", { name: "Com pendências" }))
    await waitFor(() => expect(service.fetchTeamMembers).toHaveBeenLastCalledWith(null, "2026-09", expect.objectContaining({ pendingOnly: true })))

    fireEvent.click(screen.getByRole("button", { name: /Abaixo da referência/ }))
    await waitFor(() => expect(service.fetchTeamMembers).toHaveBeenLastCalledWith(null, "2026-09", expect.objectContaining({ situation: "BELOW_REFERENCE" })))

    fireEvent.change(screen.getByLabelText("Buscar colaborador por nome"), { target: { value: "ana" } })
    await waitFor(() => expect(service.fetchTeamMembers).toHaveBeenLastCalledWith(null, "2026-09", expect.objectContaining({ search: "ana" })), { timeout: 2000 })
  })

  it("estrutura vazia mostra o estado 'não possui colaboradores'", async () => {
    service.fetchTeamOverview.mockResolvedValue({ ...TEAM_OVERVIEW, summary: { ...TEAM_OVERVIEW.summary, memberCount: 0 } })
    renderWithQuery(<TeamView context={SUPERVISOR_CONTEXT} state={{ subject: null, period: null }} onStateChange={() => {}} employeeHref={(id) => `/e/${id}`} />)
    expect(await screen.findByText("Esta estrutura não possui colaboradores")).toBeInTheDocument()
    expect(service.fetchTeamMembers).not.toHaveBeenCalled()
  })
})

describe("Estrutura — Gerente+", () => {
  it("mostra unidades subordinadas primeiro (nunca centenas de operadores) e desce ao clicar", async () => {
    service.fetchTeamOverview.mockResolvedValue(STRUCTURE_OVERVIEW)
    const onStateChange = vi.fn()
    renderWithQuery(<TeamView context={MANAGER_CONTEXT} state={{ subject: null, period: null }} onStateChange={onStateChange} employeeHref={(id) => `/e/${id}`} />)
    expect(await screen.findByText("Minha estrutura")).toBeInTheDocument()
    expect(screen.getByText("Unidades por coordenador")).toBeInTheDocument()
    expect(screen.getByText("Patrícia Coordenadora")).toBeInTheDocument()
    expect(screen.getByText("81,1%")).toBeInTheDocument()
    expect(screen.getByText("2 revisões pendentes")).toBeInTheDocument()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
    expect(service.fetchTeamMembers).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Abrir estrutura de Patrícia Coordenadora" }))
    expect(onStateChange).toHaveBeenCalledWith({ subject: { kind: "COORDINATOR_STRUCTURE", id: "coord-1" } })
  })

  it("com operadores ligados diretamente além das unidades, lista só esses (directOnly)", async () => {
    service.fetchTeamOverview.mockResolvedValue({ ...STRUCTURE_OVERVIEW, directMemberCount: 1 })
    service.fetchTeamMembers.mockResolvedValue({ ...TEAM_MEMBERS, items: [TEAM_MEMBERS.items[1]!], total: 1 })
    renderWithQuery(<TeamView context={MANAGER_CONTEXT} state={{ subject: null, period: null }} onStateChange={() => {}} employeeHref={(id) => `/e/${id}`} />)
    expect(await screen.findByText("Ligados diretamente à estrutura")).toBeInTheDocument()
    await waitFor(() => expect(service.fetchTeamMembers).toHaveBeenCalledWith(null, "2026-09", expect.objectContaining({ directOnly: true })))
  })
})
