/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { ApiError } from "@/lib/api/api-client"
import type { AnjoActivity, FunnelResponse, Measure, RequestDetail, RequestListItem } from "@/schemas/human-support/monitoring.schema"

import { HumanSupportMonitoringPage } from "./human-support-monitoring-page"

const service = vi.hoisted(() => ({
  fetchSupportFunnel: vi.fn(),
  fetchSupportRequests: vi.fn(),
  fetchSupportRequestDetail: vi.fn(),
  fetchUnavailableAttempts: vi.fn(),
  fetchAnjosActivity: vi.fn(),
  fetchAnjosNow: vi.fn(),
  fetchAnjoPresenceTimeline: vi.fn(),
  fetchSupportScopes: vi.fn(),
  fetchSupportSettings: vi.fn(),
  fetchSupportAnjos: vi.fn(),
}))
vi.mock("@/services/human-support/human-support-service", () => service)

const PERIOD = { from: "2026-10-11", to: "2026-11-09" }
const count = (value: number) => ({ numerator: value, denominator: null, value, status: "OK" as const })
const rate = (numerator: number, denominator: number) => ({ numerator, denominator, value: denominator >= 5 ? numerator / denominator : null, status: denominator === 0 ? ("NO_DATA" as const) : denominator < 5 ? ("SMALL_SAMPLE" as const) : ("OK" as const) })
const MEASURES: Measure[] = [
  { id: "M1", kind: "COUNT", main: count(120) },
  { id: "M2", kind: "RATE", main: rate(40, 100) },
  // Só 4 avaliadas: a taxa fica oculta.
  { id: "M3", kind: "RATE", main: rate(3, 4) },
  { id: "M4", kind: "DISTRIBUTION", main: { numerator: 6, denominator: null, value: 6, status: "OK" }, breakdown: [{ key: "NOT_FOUND", label: "Não encontrou", count: 3, value: 0.5 }, { key: "NOT_COLLECTED", label: "Motivo não coletado", count: 3, value: 0.5 }] },
  // Denominador zero: "Sem dados", nunca 0%.
  { id: "M5", kind: "RATE", main: rate(0, 0) },
  { id: "M8", kind: "COUNT", main: count(4), conversion: rate(2, 3), breakdown: [{ key: "BUTTON", label: "Botão “Falar com um Anjo”", count: 2 }] },
  { id: "M12", kind: "PERCENTILE", main: count(8), percentiles: { p50: 90, p90: 400, estimate: null }, noResponse: rate(1, 9) },
  { id: "M17", kind: "AVERAGE", main: { numerator: 25, denominator: 6, value: 4.17, status: "OK" }, coverage: rate(6, 10), breakdown: [{ key: "5", label: "5 estrelas", count: 3, value: 0.5 }] },
]
const FUNNEL: FunnelResponse = { period: PERIOD, cutoffs: { dislikeDetailsSince: "2026-10-20T12:00:00.000Z", signalsSince: null, disabledPeriods: [{ from: "2026-10-11T03:00:00.000Z", to: "2026-10-15T15:00:00.000Z" }] }, measures: MEASURES }

const item = (id: string, patch: Partial<RequestListItem> = {}): RequestListItem => ({
  id, protocol: `AP-${id.toUpperCase()}`, operatorName: "Larissa Monteiro", teamName: "Grupo X", subteamName: "X1", origin: "DISLIKE", status: "CLOSED", endCause: "ANJO_CLOSED", createdAt: "2026-11-02T13:00:00.000Z", endedAt: "2026-11-02T13:20:00.000Z",
  anjoNames: ["Ana Souza"], firstResponseSeconds: 75, classificationReason: "FOUND_IN_PROCESS", outcome: "RESOLVED", resolved: "YES", stars: 4, ...patch,
})
const DETAIL: RequestDetail = {
  ...item("k2qx9"),
  sharedContext: { question: "Como faço a troca de titularidade?", answer: "Não encontrei esse **procedimento** nas bases.", dislike: { reason: "NOT_FOUND", reasonLabel: "Não encontrou", comment: "Faltou o passo do contrato" }, note: "Cliente na linha" },
  messages: [
    { id: "m1", seq: 1, authorKind: "SYSTEM", authorName: null, body: "Ana Souza recebeu o pedido", systemCode: "ASSIGNED", occurredAt: "2026-11-02T13:00:05.000Z" },
    { id: "m2", seq: 2, authorKind: "ANJO", authorName: "Ana Souza", body: "Oi! Está no processo de titularidade, item 3.", systemCode: null, occurredAt: "2026-11-02T13:01:20.000Z" },
    { id: "m3", seq: 3, authorKind: "OPERATOR", authorName: "Larissa Monteiro", body: "Achei, obrigada!", systemCode: null, occurredAt: "2026-11-02T13:02:00.000Z" },
  ],
  attendances: [{ id: "at1", anjoName: "Ana Souza", startedAt: "2026-11-02T13:00:05.000Z", firstAnjoMessageAt: "2026-11-02T13:01:20.000Z", endedAt: "2026-11-02T13:20:00.000Z", endCause: "ANJO_CLOSED" }],
  classification: { reason: "FOUND_IN_PROCESS", referenceTitle: "Processo de titularidade", referenceUrl: "https://intranet.exemplo/processos/titularidade", otherDescription: null, outcome: "RESOLVED" },
}
const ACTIVITY: AnjoActivity[] = [
  { personId: "p-ana", name: "Ana Souza", hoursAvailable: 32.5, hoursPaused: { LUNCH: 4, PERSONAL: 0, PROCESS_ACTIVITY: 0, MEETING: 1.5 }, hoursDisconnected: 2, attendances: 14, firstResponse: { p50Seconds: 60, p90Seconds: 240, withoutResponse: 1 }, averageStars: null },
]

function openTab(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 })
}

beforeAll(installJsdomStubs)
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 10, 9, 10, 0, 0))
  service.fetchSupportFunnel.mockResolvedValue(FUNNEL)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe("Painel do apoio › Funil", () => {
  it("indicadores em linguagem de operação: sem códigos nem p50/p90, unidade explícita, poucos dados e sem dados nunca viram 0%", async () => {
    renderWithQuery(<HumanSupportMonitoringPage />)
    const m2 = await screen.findByTestId("measure-M2")
    expect(m2).toHaveTextContent("Respostas avaliadas")
    expect(m2).toHaveTextContent("40%")
    expect(m2).toHaveTextContent("40 de 100 respostas")
    // Padrão: últimos 30 dias, incluindo hoje.
    expect(service.fetchSupportFunnel).toHaveBeenCalledWith({ ...PERIOD, teamId: null, subteamId: null })
    expect(screen.getByTestId("measure-M1")).toHaveTextContent("120respostas")
    const m3 = screen.getByTestId("measure-M3")
    expect(m3).toHaveTextContent("Curtidas entre as avaliadas")
    expect(m3).toHaveTextContent("Poucos dados")
    expect(m3).toHaveTextContent("3 de 4 avaliadas")
    expect(m3).toHaveTextContent("Com menos de 5, a porcentagem não é calculada.")
    expect(m3).not.toHaveTextContent("%")
    const m5 = screen.getByTestId("measure-M5")
    expect(m5).toHaveTextContent("Sem dados no período")
    expect(m5).not.toHaveTextContent("0%")
    // Distribuição: contagem e parcela por motivo.
    const notCollected = within(screen.getByTestId("measure-M4")).getByText("Motivo não coletado").closest("li")!
    expect(within(notCollected).getByText("3")).toBeInTheDocument()
    expect(within(notCollected).getByText("50%")).toBeInTheDocument()
    // Conversão com denominador 3: sem porcentagem. Tempos com o nome do evento e legíveis. Estrelas: média só com 5 notas ou mais.
    expect(screen.getByTestId("measure-M8")).toHaveTextContent("Sugestões que viraram pedido2 de 3 · poucos dados")
    const m12 = screen.getByTestId("measure-M12")
    expect(m12).toHaveTextContent("Tempo mediano de primeira resposta1 min 30 s")
    expect(m12).toHaveTextContent("Metade dos atendimentos teve a primeira resposta do Anjo em até esse tempo.")
    expect(m12).toHaveTextContent("Primeira resposta de 90% dos atendimentos6 min 40 s")
    expect(m12).toHaveTextContent("Encerrados sem nenhuma resposta do Anjo1 de 9 · 11,1%")
    expect(screen.getByTestId("measure-M17")).toHaveTextContent("4,17de 5 · 6 notas")
    expect(screen.getByTestId("measure-M17")).toHaveTextContent("Atendimentos com estrelas6 de 10 · 60%")
    // Resumo: o que existe e "Sem dados no período" para o que não há (a espera não veio nesta resposta).
    const summary = screen.getByRole("region", { name: "Resumo do período" })
    expect(within(summary).getByRole("article", { name: "Pedidos de apoio" })).toHaveTextContent("4pedidos")
    expect(within(summary).getByRole("article", { name: "Primeira resposta do Anjo" })).toHaveTextContent("1 min 30 s")
    expect(within(summary).getByRole("article", { name: "Espera de 90% dos pedidos" })).toHaveTextContent("Sem dados no período")
    // Avaliação da resposta da INIA e do atendimento do Anjo em seções separadas.
    expect(within(screen.getByRole("region", { name: "Respostas da INIA" })).getByTestId("measure-M3")).toBeInTheDocument()
    expect(within(screen.getByRole("region", { name: "Avaliação do atendimento do Anjo" })).getByTestId("measure-M17")).toBeInTheDocument()
    // Nenhum código interno nem termo estatístico no texto da tela; e nunca "assertividade".
    expect(document.body).not.toHaveTextContent(/\bM1?[0-9]\b/)
    expect(document.body).not.toHaveTextContent(/p50|p90/)
    expect(document.body).not.toHaveTextContent(/assertividade/i)
  })

  it("sem o bloco técnico de datas de corte: a observação curta fica só no indicador afetado", async () => {
    renderWithQuery(<HumanSupportMonitoringPage />)
    await screen.findByTestId("measure-M1")
    expect(screen.queryByLabelText("Datas de corte")).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent("Sinais desde")
    expect(document.body).not.toHaveTextContent("Apoio desligado (chave geral) no período")
    expect(screen.getByTestId("measure-M4")).toHaveTextContent("não tinham motivo e aparecem como “Motivo não coletado”")
    expect(screen.getByTestId("measure-M5")).toHaveTextContent("Conta só a partir de")
    expect(screen.getByTestId("measure-M8")).toHaveTextContent("O apoio esteve desligado de")
    expect(screen.getByTestId("measure-M1")).not.toHaveTextContent("desligado")
  })

  it("período no calendário do app com Aplicar: acima de 92 dias não aplica nem consulta; o 422 do servidor também aparece", async () => {
    renderWithQuery(<HumanSupportMonitoringPage />)
    await screen.findByTestId("measure-M1")
    const trigger = screen.getByRole("button", { name: "Período" })
    expect(trigger).toHaveTextContent("11/10/2026 – 09/11/2026")
    fireEvent.click(trigger)
    for (let index = 0; index < 3; index += 1) fireEvent.click(await screen.findByRole("button", { name: "Ir para o mês anterior" }))
    fireEvent.click(await screen.findByRole("button", { name: /, 1 de julho de 2026/ }))
    expect(await screen.findByText("Escolha um período de até 92 dias.")).toHaveAttribute("role", "alert")
    expect(screen.getByRole("button", { name: "Aplicar" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(service.fetchSupportFunnel).not.toHaveBeenCalledWith(expect.objectContaining({ from: "2026-07-01" }))

    service.fetchSupportFunnel.mockRejectedValue(new ApiError("Escolha um período de até 92 dias.", 422, "PERIOD_TOO_LONG"))
    fireEvent.click(screen.getByRole("button", { name: "Período" }))
    fireEvent.click(await screen.findByRole("button", { name: "Ir para o mês anterior" }))
    fireEvent.click(await screen.findByRole("button", { name: /, 1 de setembro de 2026/ }))
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }))
    await waitFor(() => expect(service.fetchSupportFunnel).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-09-01", to: "2026-11-09" })))
    expect(await screen.findByText("Escolha um período de até 92 dias.")).toHaveAttribute("role", "alert")
  })

  it("o Coordenador não tem filtro de Grupo e a tela nunca chama a rota de escopos do Administrador geral", async () => {
    renderWithQuery(<HumanSupportMonitoringPage />)
    await screen.findByTestId("measure-M1")
    expect(screen.queryByRole("combobox", { name: "Filtrar por Grupo ou Subgrupo" })).not.toBeInTheDocument()
    expect(service.fetchSupportScopes).not.toHaveBeenCalled()
  })

  it("quem configura o apoio filtra por Grupo/Subgrupo (a árvore da configuração)", async () => {
    service.fetchSupportScopes.mockResolvedValue([{ type: "GROUP", id: "gx", name: "Grupo X", state: "ON", effective: true, effectiveSource: "OWN", anjoCount: 1, warnings: [], children: [{ type: "SUBGROUP", id: "x1", name: "X1", state: "INHERIT", effective: true, effectiveSource: "GROUP", anjoCount: 1, warnings: [] }] }])
    renderWithQuery(<HumanSupportMonitoringPage canFilterByScope />)
    fireEvent.click(await screen.findByRole("combobox", { name: "Filtrar por Grupo ou Subgrupo" }))
    fireEvent.click(await screen.findByRole("option", { name: "Grupo X › X1" }))
    await waitFor(() => expect(service.fetchSupportFunnel).toHaveBeenCalledWith({ ...PERIOD, teamId: "gx", subteamId: "x1" }))
  })
})

describe("Painel do apoio › Pedidos", () => {
  it("lista com filtros e 'Carregar mais' pelo cursor", async () => {
    service.fetchSupportRequests.mockImplementation(async (filter: { cursor?: string | null }) => (filter.cursor === "c2" ? { items: [item("b")], nextCursor: null } : { items: [item("a")], nextCursor: "c2" }))
    renderWithQuery(<HumanSupportMonitoringPage />)
    openTab("Pedidos")
    expect(await screen.findByText("AP-A")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }))
    expect(await screen.findByText("AP-B")).toBeInTheDocument()
    expect(service.fetchSupportRequests).toHaveBeenCalledWith(expect.objectContaining({ ...PERIOD, cursor: "c2" }))
    expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("combobox", { name: "Filtrar por estado" }))
    fireEvent.click(await screen.findByRole("option", { name: "Na fila" }))
    await waitFor(() => expect(service.fetchSupportRequests).toHaveBeenCalledWith(expect.objectContaining({ status: "WAITING", cursor: null })))
  })

  it("abrir um pedido mostra o que foi compartilhado, a conversa com os três autores, atendimentos, classificação e avaliação", async () => {
    service.fetchSupportRequests.mockResolvedValue({ items: [item("k2qx9")], nextCursor: null })
    service.fetchSupportRequestDetail.mockResolvedValue(DETAIL)
    renderWithQuery(<HumanSupportMonitoringPage />)
    openTab("Pedidos")
    fireEvent.click(await screen.findByTestId("support-request"))
    const detail = await screen.findByRole("article", { name: "Pedido AP-K2QX9" })
    expect(service.fetchSupportRequestDetail).toHaveBeenCalledWith("k2qx9")
    expect(within(detail).getByText(/Abrir este pedido fica registrado/)).toBeInTheDocument()

    const shared = within(detail).getByRole("region", { name: "O que o operador compartilhou" })
    expect(within(shared).getByText("Como faço a troca de titularidade?")).toBeInTheDocument()
    // A resposta da INIA é texto de IA (Markdown seguro); pergunta, comentário e nota são texto puro.
    expect(within(shared).getByText("procedimento").tagName).toBe("STRONG")
    expect(within(shared).getByText("Faltou o passo do contrato")).toBeInTheDocument()
    expect(within(shared).getByText("Cliente na linha")).toBeInTheDocument()

    const messages = within(detail).getByRole("list", { name: "Mensagens do apoio" })
    const authors = [...messages.querySelectorAll("li")].map((li) => li.getAttribute("data-author"))
    expect(authors).toEqual(["SYSTEM", "ANJO", "OPERATOR"])
    expect(messages.querySelector('[data-author="OPERATOR"]')).toHaveClass("justify-end")
    expect(messages.querySelector('[data-author="ANJO"]')).toHaveClass("justify-start")
    expect(messages.querySelector('[data-author="SYSTEM"]')).toHaveClass("justify-center")

    expect(within(detail).getByRole("region", { name: "Atendimentos" })).toHaveTextContent("Primeira resposta: 1 min")
    const classification = within(detail).getByRole("region", { name: "Classificação do Anjo" })
    expect(classification).toHaveTextContent("Informação existente em processo que poderia ter sido encontrada")
    // Endereço digitado pelo Anjo: texto com aviso, nunca um link clicável.
    expect(within(classification).getByText("https://intranet.exemplo/processos/titularidade")).toBeInTheDocument()
    expect(within(detail).queryByRole("link")).not.toBeInTheDocument()
    expect(within(detail).getByRole("region", { name: "Avaliação do operador" })).toHaveTextContent("Sim")
    expect(within(detail).getByLabelText("4 de 5 estrelas")).toBeInTheDocument()
  })
})

describe("Painel do apoio › Sem Anjo em serviço e Anjos", () => {
  it("lista as tentativas sem Anjo em serviço com cursor", async () => {
    service.fetchUnavailableAttempts.mockImplementation(async (filter: { cursor?: string | null }) =>
      filter.cursor === "n2"
        ? { items: [{ occurredAt: "2026-11-01T12:00:00.000Z", personName: "Rui Prado", teamName: null, subteamName: null, origin: null }], nextCursor: null }
        : { items: [{ occurredAt: "2026-11-03T12:00:00.000Z", personName: "Larissa Monteiro", teamName: "Grupo X", subteamName: "X1", origin: "BUTTON" }], nextCursor: "n2" },
    )
    renderWithQuery(<HumanSupportMonitoringPage />)
    openTab("Sem Anjo em serviço")
    const table = await screen.findByRole("table", { name: "Tentativas sem Anjo em serviço" })
    expect(within(table).getByText("Larissa Monteiro").closest("tr")).toHaveTextContent("Grupo X › X1")
    fireEvent.click(within(table).getByRole("button", { name: "Carregar mais" }))
    expect(await within(table).findByText("Rui Prado")).toBeInTheDocument()
    expect(within(table).getByText("Rui Prado").closest("tr")).toHaveTextContent("Sem Grupo")
  })

  it("situação dos Anjos agora: cadastro separado do status, ícone e texto, pausa com motivo, tempo desde a transição real, indisponível sem contador; resumo e filtro", async () => {
    service.fetchAnjosActivity.mockResolvedValue([])
    const base = { scopes: [{ type: "GROUP" as const, id: "gx", name: "Grupo X" }], pauseReason: null, connected: true, connectionLostSince: null, attendances: { active: 0, capacity: 2 } }
    service.fetchAnjosNow.mockResolvedValue({
      // Relógio do servidor = relógio da tela (10:00 em São Paulo): os tempos contam a partir de cada transição.
      serverTime: new Date(2026, 10, 9, 10, 0, 0).toISOString(),
      items: [
        { ...base, personId: "a1", name: "Ana Souza", active: true, status: "AVAILABLE", since: new Date(2026, 10, 9, 9, 48).toISOString() },
        { ...base, personId: "a2", name: "Bruno Lima", active: true, status: "IN_ATTENDANCE", since: new Date(2026, 10, 9, 9, 52).toISOString(), attendances: { active: 1, capacity: 2 } },
        { ...base, personId: "a3", name: "Carla Dias", active: true, status: "PAUSED", pauseReason: "LUNCH", since: new Date(2026, 10, 9, 9, 37).toISOString(), connected: false, connectionLostSince: new Date(2026, 10, 9, 9, 58).toISOString() },
        { ...base, personId: "a4", name: "Davi Rocha Albuquerque de Souza Filho", active: false, status: "UNAVAILABLE", since: null, connected: false },
      ],
    })
    renderWithQuery(<HumanSupportMonitoringPage />)
    openTab("Anjos")
    const ana = await screen.findByTestId("anjo-now-a1")
    expect(ana).toHaveTextContent("Ativo")
    expect(ana).toHaveTextContent("Disponível")
    expect(ana).toHaveTextContent("há 12 min")
    expect(ana).toHaveTextContent("Atende: Grupo X")
    expect(screen.getByTestId("anjo-now-a2")).toHaveTextContent("Em atendimentohá 8 min1 de 2")
    const carla = screen.getByTestId("anjo-now-a3")
    expect(carla).toHaveTextContent("Em pausa — Lanche")
    expect(carla).toHaveTextContent("há 23 min")
    expect(carla).toHaveTextContent("Sem conexão há 2 min")
    const davi = screen.getByTestId("anjo-now-a4")
    expect(davi).toHaveTextContent("Inativo")
    expect(davi).toHaveTextContent("Indisponível")
    expect(within(davi).getByTestId("anjo-now-since")).toHaveTextContent("—")
    expect(within(davi).getByTestId("anjo-now-since")).not.toHaveTextContent("há")
    // Resumo só com os ativos; o inativo aparece à parte.
    const summary = screen.getByRole("group", { name: /Quantos Anjos ativos em cada status/ })
    expect(within(summary).getByRole("button", { name: /Indisponível/ })).toHaveTextContent("0")
    expect(screen.getByText(/1 Anjo inativo no cadastro/)).toBeInTheDocument()
    // Clicar num status filtra a lista.
    fireEvent.click(within(summary).getByRole("button", { name: /Em pausa/ }))
    expect(screen.queryByTestId("anjo-now-a1")).not.toBeInTheDocument()
    expect(screen.getByTestId("anjo-now-a3")).toBeInTheDocument()
    // A situação agora não depende do período: a chamada não leva datas.
    expect(service.fetchAnjosNow).toHaveBeenCalledWith({ teamId: null, subteamId: null })
  })

  it("M18 por Anjo: horas, pausas por motivo, primeira resposta e estrelas '—' abaixo de 5 notas; 'Ver presença' carrega a linha do tempo", async () => {
    service.fetchAnjosActivity.mockResolvedValue(ACTIVITY)
    service.fetchAnjoPresenceTimeline.mockResolvedValue({ events: [{ occurredAt: "2026-11-03T12:00:00.000Z", fromStatus: "AVAILABLE", toStatus: "PAUSED", pauseReason: "LUNCH", cause: "ANJO" }] })
    renderWithQuery(<HumanSupportMonitoringPage />)
    openTab("Anjos")
    const row = await screen.findByTestId("anjo-activity-p-ana")
    expect(row).toHaveTextContent("32,5 h")
    expect(row).toHaveTextContent("Lanche 4 h · Reunião 1,5 h")
    expect(row).toHaveTextContent("1 min")
    expect(row).toHaveTextContent("4 min")
    expect(within(row).getByText("—")).toBeInTheDocument()
    expect(screen.getByText(/Abrir esta aba e a presença de um Anjo fica registrado/)).toBeInTheDocument()
    expect(service.fetchAnjoPresenceTimeline).not.toHaveBeenCalled()

    fireEvent.click(within(row).getByRole("button", { name: "Ver presença" }))
    const timeline = await screen.findByRole("list", { name: "Presença de Ana Souza" })
    expect(service.fetchAnjoPresenceTimeline).toHaveBeenCalledWith("p-ana", PERIOD)
    expect(timeline).toHaveTextContent("Disponível → Em pausa (Lanche)")
    expect(timeline).toHaveTextContent("pelo Anjo")
  })
})
