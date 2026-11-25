/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { chooseUnit, scopeUnitsServiceFrom } from "@/components/admin/shared/testing/scope-units-fake"
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
const UNITS = vi.hoisted(() => [{ id: "gx", name: "Grupo X", subteams: [{ id: "x1", name: "X1" }] }])
vi.mock("@/services/scope-units/scope-units-service", () => scopeUnitsServiceFrom(UNITS))
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
  async function renderScopes(options: { enabled?: boolean; canGrantRoles?: boolean; tree?: ScopeNode[] } = {}) {
    service.fetchSupportSettings.mockResolvedValue({ enabled: options.enabled ?? true, defaultCapacity: 2, version: 1 })
    service.fetchSupportScopes.mockResolvedValue(options.tree ?? TREE)
    renderWithQuery(<HumanSupportAdminPage canGrantRoles={options.canGrantRoles ?? true} />)
    openTab("Escopos")
    await screen.findByTestId("scope-x1")
  }
  const select = (id: string) => fireEvent.click(screen.getByTestId(`scope-${id}`))
  const effective = () => screen.getByTestId("scope-effective")
  const option = (name: string) => screen.getByRole("radio", { name })

  it("a lista mostra o estado em vigor e a origem de cada escopo; o detalhe separa opção salva, resultado e origem", async () => {
    await renderScopes()
    expect(screen.getByTestId("scope-x1")).toHaveTextContent("Habilitado · Herdado de Grupo X")
    expect(screen.getByTestId("scope-x2")).toHaveTextContent("Desabilitado · Definido neste escopo")
    expect(screen.getByTestId("scope-__organization__")).toHaveTextContent("Chave geral ligada")
    select("x1")
    expect(screen.getByRole("heading", { name: "X1" })).toBeInTheDocument()
    expect(screen.getByLabelText("Caminho do escopo")).toHaveTextContent("Organização › Grupo X › X1")
    expect(within(effective()).getByRole("status")).toHaveTextContent("Anjo habilitado em X1")
    expect(effective()).toHaveTextContent("e Grupo X está com “Habilitar neste escopo”")
    expect(effective()).toHaveTextContent("Opção salva neste escopoHerdar do escopo superior")
    expect(effective()).toHaveTextContent("Resultado aplicadoHabilitado")
    expect(effective()).toHaveTextContent("OrigemHerdado de Grupo X")
    expect(option("Herdar do escopo superior")).toBeChecked()
    // Cada opção explica o efeito em uma frase.
    expect(option("Habilitar neste escopo")).toHaveAccessibleDescription(/mesmo que Grupo X esteja desabilitado/)
    expect(option("Herdar do escopo superior")).toHaveAccessibleDescription(/Segue Grupo X, que hoje está habilitado/)
  })

  it("no Grupo não existe 'Herdar do escopo superior': a mesma gravação é 'Sem configuração própria' (desabilitado)", async () => {
    await renderScopes()
    select("gx")
    expect(screen.queryByRole("radio", { name: "Herdar do escopo superior" })).not.toBeInTheDocument()
    expect(option("Sem configuração própria")).toHaveAccessibleDescription(/A organização não habilita Grupos sozinha/)
    expect(option("Habilitar neste escopo")).toBeChecked()
    expect(option("Desabilitar neste escopo")).toHaveAccessibleDescription(/no Subgrupo que herda dele/)
  })

  it("mudar a opção mostra o resultado esperado antes de salvar; depois de salvar, confirma o estado aplicado", async () => {
    service.saveSupportScopeState.mockResolvedValue({ ...TREE[0]!.children![1]!, state: "INHERIT", effective: true, effectiveSource: "GROUP" })
    await renderScopes()
    select("x2")
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled()
    fireEvent.click(option("Herdar do escopo superior"))
    const preview = screen.getByTestId("scope-preview")
    expect(preview).toHaveTextContent("Anjo habilitado pela configuração de Grupo X.")
    expect(preview).toHaveTextContent("Hoje: desabilitado · Depois de salvar: habilitado")
    expect(service.saveSupportScopeState).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }))
    await waitFor(() => expect(service.saveSupportScopeState).toHaveBeenCalledWith("subgroup", "x2", "INHERIT"))
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(await screen.findByText("Salvo. Em vigor agora: Anjo habilitado pela configuração de Grupo X.")).toBeInTheDocument()
  })

  it("Descartar volta à opção salva sem chamar o servidor", async () => {
    await renderScopes()
    select("x2")
    fireEvent.click(option("Habilitar neste escopo"))
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }))
    expect(option("Desabilitar neste escopo")).toBeChecked()
    expect(screen.queryByTestId("scope-preview")).not.toBeInTheDocument()
    expect(service.saveSupportScopeState).not.toHaveBeenCalled()
  })

  it("desabilitar um escopo habilitado confirma antes (a fila é cancelada, os atendimentos continuam)", async () => {
    service.saveSupportScopeState.mockResolvedValue({ ...TREE[0]!.children![0]!, state: "OFF", effective: false, effectiveSource: "OWN" })
    await renderScopes()
    select("x1")
    fireEvent.click(option("Desabilitar neste escopo"))
    expect(screen.getByTestId("scope-preview")).toHaveTextContent("Anjo desabilitado pela configuração deste Subgrupo.")
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("Desabilitar o Anjo em X1?")
    expect(dialog).toHaveTextContent("Os atendimentos em andamento continuam")
    expect(service.saveSupportScopeState).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Desabilitar e salvar" }))
    await waitFor(() => expect(service.saveSupportScopeState).toHaveBeenCalledWith("subgroup", "x1", "OFF"))
  })

  it("alteração no escopo superior: desabilitar o Grupo prevê e confirma o efeito nos Subgrupos que herdam, e o Subgrupo passa a mostrar o novo estado", async () => {
    const after: ScopeNode[] = [
      { ...TREE[0]!, state: "OFF", effective: false, children: [{ ...TREE[0]!.children![0]!, effective: false }, TREE[0]!.children![1]!] },
      TREE[1]!,
    ]
    service.saveSupportScopeState.mockResolvedValue(after[0]!)
    await renderScopes()
    service.fetchSupportScopes.mockResolvedValue(after)
    select("gx")
    fireEvent.click(option("Desabilitar neste escopo"))
    expect(screen.getByTestId("scope-preview")).toHaveTextContent("X1 (herda deste Grupo): passa a desabilitado")
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("Subgrupos que herdam dele (X1)")
    fireEvent.click(within(dialog).getByRole("button", { name: "Desabilitar e salvar" }))
    await waitFor(() => expect(service.saveSupportScopeState).toHaveBeenCalledWith("group", "gx", "OFF"))
    await waitFor(() => expect(screen.getByTestId("scope-x1")).toHaveTextContent("Desabilitado · Herdado de Grupo X"))
    select("x1")
    expect(within(effective()).getByRole("status")).toHaveTextContent("Anjo desabilitado em X1")
    expect(effective()).toHaveTextContent("Grupo X está com “Desabilitar neste escopo”")
  })

  it("escopo sem configuração local e Grupo sem opção própria: diz que nenhum nível habilita e o que fazer", async () => {
    const tree: ScopeNode[] = [node({ type: "GROUP", id: "gz", name: "Grupo Z", anjoCount: 1, children: [node({ id: "z1", name: "Z1", anjoCount: 1 })] })]
    await renderScopes({ tree: [...tree, ...TREE] })
    select("z1")
    expect(within(effective()).getByRole("status")).toHaveTextContent("Anjo desabilitado em Z1")
    expect(effective()).toHaveTextContent("Grupo Z também não tem opção própria")
    expect(effective()).toHaveTextContent("OrigemNenhuma opção habilita")
    expect(effective()).toHaveTextContent("Escolha “Habilitar neste escopo” abaixo, ou habilite Grupo Z e mantenha “Herdar do escopo superior”.")
  })

  it("habilitado sem nenhum Anjo: avisa e mostra onde conceder o papel (ou a quem pedir, sem acesso aos papéis)", async () => {
    await renderScopes()
    select("gy")
    expect(effective()).toHaveTextContent("Os operadores veem o apoio, mas ninguém atende os pedidos.")
    expect(screen.getByRole("link", { name: "Conceder o papel Anjo em Usuários e acessos" })).toHaveAttribute("href", "/admin/users")
    cleanup()
    await renderScopes({ canGrantRoles: false })
    select("gy")
    expect(screen.queryByRole("link", { name: /Conceder o papel Anjo/ })).not.toBeInTheDocument()
    expect(screen.getByText("Peça a quem administra os acessos para conceder o papel Anjo.")).toBeInTheDocument()
  })

  it("chave geral desligada: o motivo aparece em todos os escopos e o caminho leva à aba Configuração", async () => {
    const off = TREE.map((group) => ({ ...group, effective: false, effectiveSource: "MASTER_OFF" as const, warnings: [], children: (group.children ?? []).map((child) => ({ ...child, effective: false, effectiveSource: "MASTER_OFF" as const })) }))
    await renderScopes({ enabled: false, tree: off })
    expect(screen.getByRole("alert")).toHaveTextContent("A chave geral do Apoio com Anjo está desligada")
    expect(screen.getByTestId("scope-x1")).toHaveTextContent("Desabilitado · Bloqueado pela organização")
    select("x1")
    expect(effective()).toHaveTextContent("Opção salva neste escopoHerdar do escopo superior")
    expect(effective()).toHaveTextContent("Está desligada: nenhum escopo tem o Anjo.")
    fireEvent.click(option("Habilitar neste escopo"))
    expect(screen.getByTestId("scope-preview")).toHaveTextContent("só passa a valer quando ela for ligada")
    fireEvent.click(within(effective()).getByRole("button", { name: "Ligar na aba Configuração" }))
    expect(await screen.findByRole("switch", { name: "Apoio com Anjo ligado" })).toBeInTheDocument()
  })

  it("a Organização mostra a chave geral e manda alterá-la na aba Configuração", async () => {
    await renderScopes()
    select("__organization__")
    expect(screen.getByRole("status")).toHaveTextContent("Chave geral ligada")
    expect(screen.getByText(/Habilitado agora em 2 de 2 Grupos e 1 de 2 Subgrupos/)).toBeInTheDocument()
    expect(screen.queryByRole("radio")).not.toBeInTheDocument()
  })

  it("'Ver Anjos' leva à aba Anjos já filtrada pelo escopo", async () => {
    service.fetchSupportAnjos.mockResolvedValue([anjo({ personId: "p-ana", name: "Ana Souza", canReceiveAssignment: true })])
    await renderScopes()
    select("x1")
    fireEvent.click(screen.getByRole("button", { name: "Ver Anjos" }))
    expect(await screen.findByTestId("anjo-p-ana")).toBeInTheDocument()
    expect(service.fetchSupportAnjos).toHaveBeenCalledWith({ teamId: ["gx"], subteamId: ["x1"] })
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
    await chooseUnit("Filtrar por subgrupo", "Grupo X › X1")
    await waitFor(() => expect(service.fetchSupportAnjos).toHaveBeenCalledWith({ teamId: null, subteamId: ["x1"] }))
    expect(await screen.findByText("Pode receber agora?")).toBeInTheDocument()
    expect(within(screen.getByTestId("anjo-p-ana")).getByText("Sim")).toBeInTheDocument()
    expect(within(screen.getByTestId("anjo-p-bia")).getByText(/Em pausa$/, { selector: "span.text-muted-foreground" })).toBeInTheDocument()
    expect(within(screen.getByTestId("anjo-p-bia")).getByText(/^Não/)).toBeInTheDocument()
  })
})
