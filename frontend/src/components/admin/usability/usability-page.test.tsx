/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { AdminApiError } from "@/lib/admin/admin-api"

import * as schemas from "@/schemas/admin/usability.schema"

import fixtures from "./testing/usability-fixtures.json"
import { UsabilityPage } from "./usability-page"
import { activeFilterKeys, queryForTab, readUsabilityUrl, withFilter, withTab, withoutFilters } from "./usability-url-state"

/**
 * Monitoria de usabilidade — a tela sobre as respostas REAIS da API (geradas da massa de prova por
 * backend/scripts/usage-analytics/dump-fixture-responses.ts). Nada aqui inventa número: o teste confere que a tela mostra o
 * que a API devolveu, com base, cobertura e estados de permissão.
 */
const navigation = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/usability", useSearchParams: () => navigation.params, useRouter: () => ({ replace: navigation.replace, push: vi.fn(), refresh: vi.fn() }) }))

const session = vi.hoisted(() => ({ user: null as unknown }))
vi.mock("@/queries/auth/use-current-user", () => ({ useCurrentUserQuery: () => ({ data: session.user }) }))

const service = vi.hoisted(() => ({ fetchUsabilityContext: vi.fn(), fetchUsabilityTab: vi.fn(), fetchUsabilityPerson: vi.fn(), fetchUsabilityTimeline: vi.fn(), searchUsabilityPeople: vi.fn(), downloadUsabilityCsv: vi.fn() }))
vi.mock("@/services/admin/usability-service", async (original) => ({ ...(await original<typeof import("@/services/admin/usability-service")>()), ...service }))

function userWith(capabilities: Partial<Record<string, boolean>>, usabilityPanel = true) {
  return {
    sub: "account-1",
    access: { capabilities: { canViewUsability: true, canViewUsabilityPeople: true, canExportUsability: true, canViewUsabilityComments: false, canManageUsability: false, ...capabilities }, permissions: [], roles: [] },
    features: { usabilityPanel, usageCollection: true },
  }
}

const withCan = <T extends { meta: { can: Record<string, boolean> } }>(response: T, can: Record<string, boolean>): T => ({ ...response, meta: { ...response.meta, can: { ...response.meta.can, ...can } } })

beforeAll(() => installJsdomStubs())
beforeEach(() => {
  navigation.params = new URLSearchParams()
  navigation.replace.mockReset()
  session.user = userWith({})
  service.fetchUsabilityContext.mockResolvedValue(fixtures.context)
  service.fetchUsabilityTab.mockImplementation(async (tab: string) => {
    const byTab: Record<string, unknown> = { overview: fixtures.overview, people: fixtures.people, screens: fixtures.screens, feedbacks: fixtures.feedbacks, conversations: fixtures.conversations, workflows: fixtures.workflows, journeys: fixtures.journeys, quality: fixtures.quality }
    if (tab in byTab) return byTab[tab]
    throw new Error(`aba sem fixture: ${tab}`)
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Monitoria de usabilidade — tela", () => {
  it("Visão geral mostra os números da API com base (“2 de 6”), variação e definição oficial", async () => {
    renderWithQuery(<UsabilityPage />)
    expect(await screen.findByText("33,3%")).toBeInTheDocument()
    expect(screen.getByText("2 de 6")).toBeInTheDocument()
    expect(screen.getByText(/\+13,3 p\.p\. vs\. período anterior/)).toBeInTheDocument()
    // Cada número tem o "?" com a definição do dicionário versionado.
    expect(screen.getAllByRole("button", { name: /^O que é:/ }).length).toBeGreaterThan(5)
    expect(service.fetchUsabilityTab).toHaveBeenCalledWith("overview", {})
  })

  it("filtro que a aba não suporta fica riscado com o motivo e NÃO vai para a consulta", async () => {
    navigation.params = new URLSearchParams("feedbackKind=MONITORING&period=LAST_30_DAYS&xpto=1")
    renderWithQuery(<UsabilityPage />)
    expect(await screen.findByText(/não se aplica nesta aba: Tipo de feedback só se aplica a Feedbacks e ciência/)).toBeInTheDocument()
    expect(screen.getByText(/Parâmetros desconhecidos no endereço foram ignorados: xpto/)).toBeInTheDocument()
    await waitFor(() => expect(service.fetchUsabilityTab).toHaveBeenCalledWith("overview", { period: "LAST_30_DAYS" }))
  })

  it("quem vê só agregados não recebe lista de pessoas nem botão de exportar pessoas", async () => {
    navigation.params = new URLSearchParams("tab=people")
    session.user = userWith({ canViewUsabilityPeople: false, canExportUsability: false })
    service.fetchUsabilityContext.mockResolvedValue(withCan(fixtures.context, { people: false, export: false }))
    service.fetchUsabilityTab.mockResolvedValue(withCan(fixtures.peopleAggregate, { people: false, export: false }))
    renderWithQuery(<UsabilityPage />)
    expect(await screen.findByText(/Você vê só os totais deste segmento/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Exportar pessoas/ })).not.toBeInTheDocument()
    expect(screen.getAllByText(/Você vê totais agregados/).length).toBeGreaterThan(0)
  })

  it("sem permissão para o recorte: estado próprio com a mensagem do servidor (nunca números de exemplo)", async () => {
    service.fetchUsabilityTab.mockRejectedValue(new AdminApiError("Você não tem permissão para este recurso.", "FORBIDDEN"))
    renderWithQuery(<UsabilityPage />)
    expect(await screen.findByText("Sem permissão para este recorte")).toBeInTheDocument()
    expect(screen.queryByText("33,3%")).not.toBeInTheDocument()
  })

  it("painel desligado no ambiente ou conta sem a capacidade: nada é consultado", async () => {
    session.user = userWith({ canViewUsability: false })
    renderWithQuery(<UsabilityPage />)
    expect(screen.getByText("Você não tem acesso à monitoria de usabilidade.")).toBeInTheDocument()
    session.user = userWith({}, false)
    cleanup()
    renderWithQuery(<UsabilityPage />)
    expect(screen.getByText("A monitoria de usabilidade está desligada neste ambiente.")).toBeInTheDocument()
  })

  it("jornadas: cada etapa mostra o alcance e a conversão da etapa anterior", async () => {
    navigation.params = new URLSearchParams("tab=journeys")
    renderWithQuery(<UsabilityPage />)
    expect(await screen.findByText("Entrada → Acompanhamento → feedback aberto → avaliação")).toBeInTheDocument()
    expect(screen.getAllByText(/da etapa anterior/).length).toBeGreaterThan(0)
  })
})

describe("contrato com a API", () => {
  it("cada resposta REAL da API (massa de prova) passa no schema da tela", () => {
    const checks: [string, { safeParse: (value: unknown) => { success: boolean } }, unknown][] = [
      ["context", schemas.contextSchema, fixtures.context],
      ["overview", schemas.overviewSchema, fixtures.overview],
      ["people", schemas.peopleSchema, fixtures.people],
      ["peopleAggregate", schemas.peopleSchema, fixtures.peopleAggregate],
      ["screens", schemas.screensSchema, fixtures.screens],
      ["feedbacks", schemas.feedbacksSchema, fixtures.feedbacks],
      ["conversations", schemas.conversationsSchema, fixtures.conversations],
      ["workflows", schemas.workflowsSchema, fixtures.workflows],
      ["journeys", schemas.journeysSchema, fixtures.journeys],
      ["quality", schemas.qualitySchema, fixtures.quality],
      ["person", schemas.personDetailSchema, fixtures.person],
      ["timeline", schemas.timelineSchema, fixtures.timeline],
    ]
    expect(checks.filter(([, schema, value]) => !schema.safeParse(value).success).map(([name]) => name)).toEqual([])
  })
})

describe("abas sobre a massa de prova", () => {
  it("Pessoas e acessos: lista identificada; demonstração fica fora por padrão", async () => {
    navigation.params = new URLSearchParams("tab=people")
    renderWithQuery(<UsabilityPage />)
    expect(await screen.findByText("Gabi Prova")).toBeInTheDocument()
    expect(screen.getByText("Ana Prova")).toBeInTheDocument()
    expect(screen.queryByText("Fábio Demonstração")).not.toBeInTheDocument()
  })

  it("Telas e cliques: visualizações canônicas por tela", async () => {
    navigation.params = new URLSearchParams("tab=screens")
    renderWithQuery(<UsabilityPage />)
    expect(await screen.findAllByText("Meu perfil › Acompanhamento")).not.toHaveLength(0)
    expect(screen.getByText("Elementos: exposição × acionamento")).toBeInTheDocument()
  })

  it("Feedbacks e ciência: coorte e confirmação com login e senha", async () => {
    navigation.params = new URLSearchParams("tab=feedbacks")
    renderWithQuery(<UsabilityPage />)
    expect(await screen.findByText("Coorte de feedbacks disponibilizados")).toBeInTheDocument()
    expect(screen.getByText("Confirmação de ciência (login e senha)")).toBeInTheDocument()
  })

  it("INIA voz e texto: voz, resposta e uso da tela da conversa", async () => {
    navigation.params = new URLSearchParams("tab=conversations")
    renderWithQuery(<UsabilityPage />)
    expect(await screen.findByText("A INIA respondeu?")).toBeInTheDocument()
    expect(screen.getAllByText("Voz").length).toBeGreaterThan(0)
  })

  it("Workflows: ranking por execução raiz", async () => {
    navigation.params = new URLSearchParams("tab=workflows")
    renderWithQuery(<UsabilityPage />)
    expect((await screen.findAllByText("Ranking de workflows")).length).toBeGreaterThan(0)
    expect(screen.getAllByText("Prova · Monitoria manual").length).toBeGreaterThan(0)
  })

  it("Qualidade da medição: recebimento, processamento e catálogo", async () => {
    navigation.params = new URLSearchParams("tab=quality")
    renderWithQuery(<UsabilityPage />)
    expect(await screen.findByText("Recebimento dos eventos")).toBeInTheDocument()
    expect(screen.getByText("Dicionário de métricas")).toBeInTheDocument()
  })
})

describe("estado da URL", () => {
  it("trocar de aba mantém os filtros e zera segmento, página e ordenação", () => {
    const next = withTab(new URLSearchParams("teamId=t1&segment=ACTIVE&page=3&sort=name"), "screens")
    expect(Object.fromEntries(next)).toEqual({ teamId: "t1", tab: "screens" })
  })

  it("mudar um filtro volta para a página 1; trocar o Grupo limpa o Subgrupo; preset limpa datas", () => {
    expect(Object.fromEntries(withFilter(new URLSearchParams("page=4&device=MOBILE"), "device", "DESKTOP"))).toEqual({ device: "DESKTOP" })
    expect(Object.fromEntries(withFilter(new URLSearchParams("teamId=a&subteamId=b"), "teamId", "c"))).toEqual({ teamId: "c" })
    expect(Object.fromEntries(withFilter(new URLSearchParams("period=CUSTOM&from=2026-10-01&to=2026-10-02"), "period", "TODAY"))).toEqual({ period: "TODAY" })
  })

  it("intervalo personalizado incompleto não é consultado; limpar filtros mantém aba e período", () => {
    expect(queryForTab({ period: "CUSTOM", from: "2026-10-01" }, ["period", "from", "to"]).query).toEqual({})
    expect(Object.fromEntries(withoutFilters(new URLSearchParams("tab=people&period=TODAY&teamId=x")))).toEqual({ tab: "people", period: "TODAY" })
  })

  it("nome/e-mail nunca entram na URL: só chaves conhecidas; o resto é listado como desconhecido", () => {
    const state = readUsabilityUrl(new URLSearchParams("tab=people&personId=11111111-1111-4111-8111-111111111111&nome=Ana"))
    expect(state.values).toEqual({ personId: "11111111-1111-4111-8111-111111111111" })
    expect(state.unknownKeys).toEqual(["nome"])
    expect(activeFilterKeys(state.values)).toEqual(["personId"])
  })
})
