/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { AiUsageRanking, AiUsageRankingContext } from "@/schemas/admin/ai-usage-ranking.schema"

import { AiManagementPage } from "./ai-management-page"
import { UsageRankingTab } from "./usage-ranking-tab"

const navigation = vi.hoisted(() => ({ search: "", replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
  usePathname: () => "/admin/ai",
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const ranking = vi.hoisted(() => ({ fetchAiUsageRanking: vi.fn(), fetchAiUsageRankingContext: vi.fn() }))
vi.mock("@/services/admin/ai-usage-ranking-service", () => ranking)
const ai = vi.hoisted(() => ({ fetchAiPermissions: vi.fn(), fetchAiOverview: vi.fn(), fetchAiProviders: vi.fn(), fetchAiModels: vi.fn(), fetchAiUseCases: vi.fn() }))
vi.mock("@/services/admin/ai-management-service", () => ai)

const METRICS = { requests: 0, attempts: 0, errors: 0, tokens: null, tokensReported: 0, unknownCostCalls: 0, costByCurrency: {}, people: 0, share: null }
const CONTEXT: AiUsageRankingContext = {
  levels: [],
  scope: { organizationWide: true, labels: ["Organização inteira"] },
  teams: [{ id: "team-norte", name: "Norte", subteams: [{ id: "sub-n1", name: "N1" }] }],
}

function rankingPage(overrides: Partial<AiUsageRanking> = {}): AiUsageRanking {
  return {
    level: "SUPERVISOR",
    levelLabel: "Supervisor",
    period: { from: "2026-09-16T03:00:00.000Z", to: "2026-10-15T15:00:00.000Z", label: "Últimos 30 dias", timezone: "America/Sao_Paulo" },
    scope: { organizationWide: true, unlinkedWithoutPersonVisible: true },
    items: [
      { ...METRICS, position: 1, key: "sup-1", name: "Supervisor Um", jobTitle: "Supervisor de atendimento", teamName: "Norte", active: true, requests: 5, attempts: 6, errors: 1, tokens: 390, tokensReported: 5, people: 3, share: 41.7, costByCurrency: { USD: "0.039" }, requestsBySource: { WORKFLOW: 0, REQUEST: 5 } },
      { ...METRICS, position: 2, key: "sup-2", name: "Supervisor Dois", jobTitle: null, teamName: "Norte", active: false, requests: 2, attempts: 2, tokens: 400, tokensReported: 2, people: 1, share: 16.7, costByCurrency: { BRL: "0.04" }, requestsBySource: { WORKFLOW: 2, REQUEST: 0 } },
    ],
    total: 3,
    page: 1,
    pageSize: 20,
    unlinked: { ...METRICS, requests: 4, attempts: 4, people: 1, share: 33.3, reasons: [{ reason: "NO_PERSON", requests: 2, tokens: 10, costByCurrency: {} }, { reason: "OUTSIDE_LEVEL", requests: 1, tokens: 10, costByCurrency: {} }, { reason: "WORKFLOW_WITHOUT_PERSON", requests: 1, tokens: 7, costByCurrency: {} }] },
    totals: { ...METRICS, requests: 12, attempts: 13, people: 6, share: 100, costByCurrency: { USD: "0.039", BRL: "0.04" } },
    ...overrides,
  }
}

beforeAll(installJsdomStubs)
beforeEach(() => {
  navigation.search = ""
  ranking.fetchAiUsageRankingContext.mockResolvedValue(CONTEXT)
  ranking.fetchAiUsageRanking.mockResolvedValue(rankingPage())
  ai.fetchAiProviders.mockResolvedValue([])
  ai.fetchAiModels.mockResolvedValue([])
  ai.fetchAiUseCases.mockResolvedValue([])
  ai.fetchAiOverview.mockReturnValue(new Promise(() => {}))
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("IA / Modelos — Quem mais usa", () => {
  it("abre na Diretoria, 30 dias, por chamadas — e pede ao backend só códigos e paginação (nada de nome na URL)", async () => {
    renderWithQuery(<UsageRankingTab />)
    await screen.findByTestId("ranking-row-1")
    expect(ranking.fetchAiUsageRanking.mock.calls[0]?.[0]).toEqual({ level: "DIRECTOR", sort: "REQUESTS", period: "30D", page: 1, pageSize: 20 })
    const selector = screen.getByLabelText("Visão do ranking")
    expect(within(selector).getAllByRole("radio").map((item) => item.textContent)).toEqual(["Diretoria", "Gerência Sênior", "Gerência", "Grupo", "Subgrupo", "Supervisor"])
    expect(within(selector).getByRole("radio", { name: "Diretoria que mais usa" })).toHaveAttribute("data-state", "on")
  })

  it("trocar a visão grava o nível na URL e volta para a primeira página", async () => {
    renderWithQuery(<UsageRankingTab />)
    await screen.findByTestId("ranking-row-1")
    fireEvent.click(screen.getByRole("radio", { name: "Supervisor que mais usa" }))
    expect(navigation.replace).toHaveBeenCalledWith("/admin/ai?level=SUPERVISOR", { scroll: false })
  })

  it("visão vinda da URL: tabela com posição, participação, custo por moeda, inativo marcado e a linha fixa 'Sem vínculo' com os motivos", async () => {
    navigation.search = "level=SUPERVISOR"
    renderWithQuery(<UsageRankingTab />)
    const first = await screen.findByTestId("ranking-row-1")
    expect(ranking.fetchAiUsageRanking.mock.calls[0]?.[0]).toMatchObject({ level: "SUPERVISOR" })
    expect(screen.getByRole("columnheader", { name: "Supervisor(a)" })).toBeInTheDocument()
    expect(first).toHaveTextContent("Supervisor Um")
    expect(first).toHaveTextContent("Supervisor de atendimento · Norte")
    expect(first).toHaveTextContent("41,7%")
    expect(first).toHaveTextContent("US$")
    expect(first).toHaveTextContent("Pedidos 5")
    expect(screen.getByTestId("ranking-row-2")).toHaveTextContent("Inativo")
    expect(screen.getByTestId("ranking-row-2")).toHaveTextContent("R$")
    const unlinked = screen.getByTestId("ranking-row-unlinked")
    expect(unlinked).toHaveTextContent("Sem vínculo")
    expect(unlinked).toHaveTextContent("Sem pessoa identificada: 2")
    expect(unlinked).toHaveTextContent("Pessoa sem Supervisor acima na estrutura: 1")
    expect(unlinked).toHaveTextContent("Workflow sem colaborador: 1")
    expect(screen.getByTestId("ranking-row-total")).toHaveTextContent("12")
    expect(screen.getByText(/1–3 de 3 supervisores/)).toBeInTheDocument()
  })

  it("só uso sem vínculo no recorte: a linha 'Sem vínculo' continua aparecendo (nunca some)", async () => {
    ranking.fetchAiUsageRanking.mockResolvedValue(rankingPage({ items: [], total: 0 }))
    renderWithQuery(<UsageRankingTab />)
    expect(await screen.findByTestId("ranking-row-unlinked")).toHaveTextContent("4")
    expect(screen.queryByTestId("ranking-row-1")).not.toBeInTheDocument()
  })

  it("escopo restrito: avisa o recorte e que uso sem pessoa só aparece para quem vê a organização inteira", async () => {
    ranking.fetchAiUsageRankingContext.mockResolvedValue({ ...CONTEXT, scope: { organizationWide: false, labels: ["Grupo Norte"] } })
    renderWithQuery(<UsageRankingTab />)
    expect(await screen.findByText(/Você vê só o uso das pessoas do seu escopo \(Grupo Norte\)/)).toBeInTheDocument()
  })

  it("filtro de Grupo manda só o id opaco; sem uso no período mostra o estado vazio", async () => {
    renderWithQuery(<UsageRankingTab />)
    await screen.findByTestId("ranking-row-1")
    ranking.fetchAiUsageRanking.mockResolvedValue(rankingPage({ items: [], total: 0, totals: METRICS, unlinked: { ...METRICS, reasons: [] } }))
    fireEvent.click(screen.getByRole("combobox", { name: "Filtrar por grupo" }))
    fireEvent.click(await screen.findByRole("option", { name: "Norte › N1" }))
    await waitFor(() => expect(ranking.fetchAiUsageRanking).toHaveBeenLastCalledWith(expect.objectContaining({ subteamId: "sub-n1" })))
    expect(ranking.fetchAiUsageRanking.mock.lastCall?.[0]).not.toHaveProperty("teamId")
    expect(await screen.findByText("Nenhum uso de IA para os filtros escolhidos")).toBeInTheDocument()
  })

  it("a aba só existe com a permissão explícita do ranking (calculada no backend)", async () => {
    ai.fetchAiPermissions.mockResolvedValue(["AI_CONFIG_READ", "AI_USAGE_READ"])
    const { unmount } = renderWithQuery(<AiManagementPage />)
    await waitFor(() => expect(ai.fetchAiPermissions).toHaveBeenCalled())
    // Deixa a consulta de permissões resolver antes de afirmar a ausência.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.getByRole("tab", { name: "Visão geral" })).toBeInTheDocument()
    expect(screen.queryByRole("tab", { name: "Quem mais usa" })).not.toBeInTheDocument()
    unmount()

    ai.fetchAiPermissions.mockResolvedValue(["AI_CONFIG_READ", "AI_USAGE_READ", "AI_USAGE_RANKING_READ"])
    navigation.search = "tab=ranking"
    renderWithQuery(<AiManagementPage />)
    expect(await screen.findByRole("tab", { name: "Quem mais usa", selected: true })).toBeInTheDocument()
    expect(await screen.findByTestId("ranking-row-1")).toBeInTheDocument()
  })
})
