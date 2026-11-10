/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { ApiError } from "@/lib/api/api-client"
import type { AnjoRow, ScopeNode } from "@/schemas/human-support/admin.schema"

import { HumanSupportAdminPage } from "./human-support-admin-page"

const service = vi.hoisted(() => ({
  fetchSupportSettings: vi.fn(),
  saveSupportSettings: vi.fn(),
  fetchSupportScopes: vi.fn(),
  saveSupportScopeState: vi.fn(),
  fetchSupportAnjos: vi.fn(),
  saveAnjoCapacity: vi.fn(),
}))
vi.mock("@/services/human-support/human-support-service", () => service)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const node = (patch: Partial<ScopeNode> & Pick<ScopeNode, "id" | "name">): ScopeNode => ({ type: "SUBGROUP", state: "INHERIT", effective: false, effectiveSource: "DEFAULT_OFF", anjoCount: 0, warnings: [], ...patch })
// CUJ 7: Grupo X ligado, X1 herdando, X2 desligado; Grupo Y ligado sem nenhum Anjo.
const TREE: ScopeNode[] = [
  node({
    type: "GROUP", id: "gx", name: "Grupo X", state: "ON", effective: true, effectiveSource: "OWN", anjoCount: 3,
    children: [
      node({ id: "x1", name: "X1", state: "INHERIT", effective: true, effectiveSource: "GROUP", anjoCount: 3 }),
      node({ id: "x2", name: "X2", state: "OFF", effective: false, effectiveSource: "OWN", anjoCount: 3 }),
    ],
  }),
  node({ type: "GROUP", id: "gy", name: "Grupo Y", state: "ON", effective: true, effectiveSource: "OWN", anjoCount: 0, warnings: ["ENABLED_WITHOUT_ANJO"], children: [] }),
]
const anjo = (patch: Partial<AnjoRow> & Pick<AnjoRow, "personId" | "name">): AnjoRow => ({
  scopes: [{ type: "GROUP", id: "gx", name: "Grupo X" }], maxConcurrent: null, effectiveCapacity: 2, status: "AVAILABLE", connected: true, used: 1, canReceiveAssignment: null, reasonNotEligible: null, ...patch,
})

function openTab(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 })
}
async function choose(combobox: HTMLElement, option: string) {
  fireEvent.click(combobox)
  fireEvent.click(await screen.findByRole("option", { name: option }))
}

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Apoio com Anjo › Configuração", () => {
  it("salvar manda a versão que foi lida", async () => {
    service.fetchSupportSettings.mockResolvedValue({ enabled: false, defaultCapacity: 2, version: 3 })
    service.saveSupportSettings.mockResolvedValue({ enabled: true, defaultCapacity: 4, version: 4 })
    renderWithQuery(<HumanSupportAdminPage canGrantRoles />)
    const save = await screen.findByRole("button", { name: "Salvar" })
    // Nada mudou: não há o que salvar.
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByRole("switch", { name: "Apoio com Anjo ligado" }))
    await choose(screen.getByRole("combobox", { name: "Capacidade padrão" }), "4 atendimentos")
    fireEvent.click(save)
    await waitFor(() => expect(service.saveSupportSettings).toHaveBeenCalledWith({ enabled: true, defaultCapacity: 4, version: 3 }))
  })

  it("409 HUMAN_SUPPORT_CONCURRENT_CHANGE: explica que mudou nesse meio-tempo e recarrega o valor atual", async () => {
    service.fetchSupportSettings.mockResolvedValueOnce({ enabled: false, defaultCapacity: 2, version: 3 }).mockResolvedValue({ enabled: true, defaultCapacity: 5, version: 4 })
    service.saveSupportSettings.mockRejectedValue(new ApiError("A configuração mudou enquanto você editava. Recarregue e tente de novo.", 409, "HUMAN_SUPPORT_CONCURRENT_CHANGE"))
    renderWithQuery(<HumanSupportAdminPage canGrantRoles />)
    fireEvent.click(await screen.findByRole("switch", { name: "Apoio com Anjo ligado" }))
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("alterada por outra pessoa enquanto você editava")
    // Recarregou: a tela mostra o que está salvo agora (ligado, capacidade 5) e o rascunho foi descartado.
    await waitFor(() => expect(service.fetchSupportSettings).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole("switch", { name: "Apoio com Anjo ligado" })).toHaveAttribute("data-state", "checked"))
    expect(screen.getByRole("combobox", { name: "Capacidade padrão" })).toHaveTextContent("5 atendimentos")
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled()
  })

  it("desligar a chave geral pede confirmação (fila cancelada, atendimentos continuam) antes de salvar", async () => {
    service.fetchSupportSettings.mockResolvedValue({ enabled: true, defaultCapacity: 2, version: 7 })
    service.saveSupportSettings.mockResolvedValue({ enabled: false, defaultCapacity: 2, version: 8 })
    renderWithQuery(<HumanSupportAdminPage canGrantRoles />)
    fireEvent.click(await screen.findByRole("switch", { name: "Apoio com Anjo ligado" }))
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("Os pedidos que estão na fila são cancelados")
    expect(dialog).toHaveTextContent("Os atendimentos em andamento continuam")
    expect(service.saveSupportSettings).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Desligar e salvar" }))
    await waitFor(() => expect(service.saveSupportSettings).toHaveBeenCalledWith({ enabled: false, defaultCapacity: 2, version: 7 }))
  })
})

describe("Apoio com Anjo › Escopos", () => {
  async function renderScopes() {
    service.fetchSupportSettings.mockResolvedValue({ enabled: true, defaultCapacity: 2, version: 1 })
    service.fetchSupportScopes.mockResolvedValue(TREE)
    renderWithQuery(<HumanSupportAdminPage canGrantRoles />)
    openTab("Escopos")
    await screen.findByTestId("scope-x1")
  }

  it("mostra o efetivo de cada nó, quantos Anjos atendem e o alerta 'Ligado sem Anjo'", async () => {
    await renderScopes()
    // CUJ 7: X1 "Ligado (herdado do Grupo)" e X2 "Desligado" (o efetivo; o estado gravado fica no seletor).
    expect(within(screen.getByTestId("scope-x1")).getByText("Ligado (herdado do Grupo)")).toBeInTheDocument()
    expect(within(screen.getByTestId("scope-x1")).getByRole("combobox", { name: "Estado de X1" })).toHaveTextContent("Herdar")
    expect(within(screen.getByTestId("scope-x2")).getByText("Desligado", { selector: "td > span" })).toBeInTheDocument()
    expect(within(screen.getByTestId("scope-gx")).getByRole("button", { name: "3 Anjos" })).toBeInTheDocument()
    expect(within(screen.getByTestId("scope-gy")).getByText("Ligado sem Anjo")).toBeInTheDocument()
    expect(within(screen.getByTestId("scope-gx")).queryByText("Ligado sem Anjo")).not.toBeInTheDocument()
  })

  it("ligar um escopo chama a mutação na hora, sem confirmação", async () => {
    service.saveSupportScopeState.mockResolvedValue({ ...TREE[0]!.children![1]!, state: "ON", effective: true })
    await renderScopes()
    await choose(screen.getByRole("combobox", { name: "Estado de X2" }), "Ligado")
    await waitFor(() => expect(service.saveSupportScopeState).toHaveBeenCalledWith("subgroup", "x2", "ON"))
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })

  it("desligar um escopo ligado confirma antes (a fila é cancelada, os atendimentos continuam)", async () => {
    service.saveSupportScopeState.mockResolvedValue({ ...TREE[0]!.children![0]!, state: "OFF", effective: false, effectiveSource: "OWN" })
    await renderScopes()
    await choose(screen.getByRole("combobox", { name: "Estado de X1" }), "Desligado")
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("Desligar o apoio em X1?")
    expect(dialog).toHaveTextContent("Os atendimentos em andamento continuam")
    expect(service.saveSupportScopeState).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Desligar" }))
    await waitFor(() => expect(service.saveSupportScopeState).toHaveBeenCalledWith("subgroup", "x1", "OFF"))
  })

  it("desligar o Grupo avisa que os Subgrupos que herdam dele também saem", async () => {
    service.saveSupportScopeState.mockResolvedValue({ ...TREE[0]!, state: "OFF", effective: false })
    await renderScopes()
    await choose(screen.getByRole("combobox", { name: "Estado de Grupo X" }), "Desligado")
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("Subgrupos que herdam dele (X1)")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(service.saveSupportScopeState).not.toHaveBeenCalled()
  })

  it("o número de Anjos leva à aba Anjos já filtrada pelo escopo", async () => {
    service.fetchSupportAnjos.mockResolvedValue([anjo({ personId: "p-ana", name: "Ana Souza", canReceiveAssignment: true })])
    await renderScopes()
    fireEvent.click(within(screen.getByTestId("scope-x1")).getByRole("button", { name: "3 Anjos" }))
    expect(await screen.findByTestId("anjo-p-ana")).toBeInTheDocument()
    expect(service.fetchSupportAnjos).toHaveBeenCalledWith({ teamId: "gx", subteamId: "x1" })
  })
})

describe("Apoio com Anjo › Anjos", () => {
  async function renderAnjos(canGrantRoles = true) {
    service.fetchSupportSettings.mockResolvedValue({ enabled: true, defaultCapacity: 2, version: 1 })
    service.fetchSupportScopes.mockResolvedValue(TREE)
    service.fetchSupportAnjos.mockImplementation(async (filter: { teamId?: string | null; subteamId?: string | null }) =>
      filter.subteamId
        ? [anjo({ personId: "p-ana", name: "Ana Souza", canReceiveAssignment: true }), anjo({ personId: "p-bia", name: "Bia Lima", status: "PAUSED", canReceiveAssignment: false, reasonNotEligible: "PAUSED" })]
        : [anjo({ personId: "p-ana", name: "Ana Souza" }), anjo({ personId: "p-bia", name: "Bia Lima", status: "PAUSED", maxConcurrent: 3, effectiveCapacity: 3, connected: false, used: 0 })],
    )
    renderWithQuery(<HumanSupportAdminPage canGrantRoles={canGrantRoles} />)
    openTab("Anjos")
    await screen.findByTestId("anjo-p-ana")
  }

  it("lista escopos, situação agora e vagas usadas; 'Conceder papel' leva ao editor de papéis", async () => {
    await renderAnjos()
    const ana = screen.getByTestId("anjo-p-ana")
    expect(within(ana).getByText("Grupo X")).toBeInTheDocument()
    expect(within(ana).getByText("Disponível")).toBeInTheDocument()
    expect(within(ana).getByText("1 de 2")).toBeInTheDocument()
    expect(within(ana).getByRole("combobox", { name: "Capacidade de Ana Souza" })).toHaveTextContent("Padrão da organização (2)")
    expect(within(screen.getByTestId("anjo-p-bia")).getByText(/sem conexão/)).toBeInTheDocument()
    expect(within(screen.getByTestId("anjo-p-bia")).getByRole("combobox", { name: "Capacidade de Bia Lima" })).toHaveTextContent("3 atendimentos")
    // Sem filtro, não há "pode receber agora?" (o servidor só calcula com um escopo escolhido).
    expect(screen.queryByText("Pode receber agora?")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Conceder papel" })).toHaveAttribute("href", "/admin/users")
  })

  it("sem acesso ao editor de papéis, o link não aparece", async () => {
    await renderAnjos(false)
    expect(screen.queryByRole("link", { name: "Conceder papel" })).not.toBeInTheDocument()
  })

  it("capacidade editável: um número próprio ou o padrão da organização (vazio)", async () => {
    service.saveAnjoCapacity.mockImplementation(async (personId: string, maxConcurrent: number | null) => anjo({ personId, name: "Ana Souza", maxConcurrent, effectiveCapacity: maxConcurrent ?? 2 }))
    await renderAnjos()
    await choose(screen.getByRole("combobox", { name: "Capacidade de Ana Souza" }), "3 atendimentos")
    await waitFor(() => expect(service.saveAnjoCapacity).toHaveBeenCalledWith("p-ana", 3))
    await choose(screen.getByRole("combobox", { name: "Capacidade de Bia Lima" }), "Padrão da organização (2)")
    await waitFor(() => expect(service.saveAnjoCapacity).toHaveBeenCalledWith("p-bia", null))
  })

  it("filtrar por Subgrupo mostra quem atende e, para quem não pode receber agora, o motivo", async () => {
    await renderAnjos()
    await choose(screen.getByRole("combobox", { name: "Filtrar por Grupo ou Subgrupo" }), "Grupo X › X1")
    await waitFor(() => expect(service.fetchSupportAnjos).toHaveBeenCalledWith({ teamId: "gx", subteamId: "x1" }))
    expect(await screen.findByText("Pode receber agora?")).toBeInTheDocument()
    expect(within(screen.getByTestId("anjo-p-ana")).getByText("Sim")).toBeInTheDocument()
    expect(within(screen.getByTestId("anjo-p-bia")).getByText(/Em pausa$/, { selector: "span.text-muted-foreground" })).toBeInTheDocument()
    expect(within(screen.getByTestId("anjo-p-bia")).getByText(/^Não/)).toBeInTheDocument()
  })
})
