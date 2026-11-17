/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { ApiError } from "@/lib/api/api-client"
import type { Abandonment, FunnelResponse, Measure, RequestDetail, RequestListItem } from "@/schemas/human-support/monitoring.schema"

import { HumanSupportMonitoringPage } from "./human-support-monitoring-page"

const service = vi.hoisted(() => ({
  fetchSupportFunnel: vi.fn(),
  fetchSupportRequests: vi.fn(),
  fetchSupportRequestDetail: vi.fn(),
  fetchUnavailableAttempts: vi.fn(),
  fetchSupportAbandonment: vi.fn(),
  fetchSupportAbandonmentList: vi.fn(),
  fetchAnjosNow: vi.fn(),
  fetchAnjoPresenceTimeline: vi.fn(),
  fetchSupportScopes: vi.fn(),
  fetchSupportSettings: vi.fn(),
  fetchSupportAnjos: vi.fn(),
  fetchSupportDemand: vi.fn(),
  fetchQueueWaiting: vi.fn(),
  fetchOperationHistory: vi.fn(),
  fetchResponseTimes: vi.fn(),
  saveResponseTimes: vi.fn(),
}))
vi.mock("@/services/human-support/human-support-service", () => service)
vi.mock("@/services/view-layouts/view-layout-service", () => ({ fetchViewLayout: vi.fn().mockResolvedValue({ layout: null, updatedAt: null }), saveViewLayout: vi.fn(), resetViewLayout: vi.fn() }))

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
  // Motivos na ordem do catálogo, de propósito fora da ordem de quantidade: a tela mostra do maior para o menor.
  {
    id: "M14",
    kind: "DISTRIBUTION",
    main: { numerator: 10, denominator: null, value: 10, status: "OK" },
    coverage: rate(10, 12),
    breakdown: [
      { key: "NO_PROCESS", label: "Falta de processo cadastrado", count: 1, value: 0.1 },
      { key: "QUESTION_UNCLEAR", label: "Pergunta mal formulada", count: 0, value: 0 },
      { key: "NO_TOOL_ACCESS", label: "Sem acesso à ferramenta ou ao sistema", count: 6, value: 0.6 },
      { key: "TOOL_UNAVAILABLE", label: "Ferramenta ou sistema indisponível", count: 3, value: 0.3 },
    ],
    extra: [{ key: "Siebel", label: "Siebel", count: 2 }, { key: "Portal de documentos", label: "Portal de documentos", count: 4 }],
  },
]
const FUNNEL: FunnelResponse = { period: PERIOD, cutoffs: { dislikeDetailsSince: "2026-10-20T12:00:00.000Z", signalsSince: null, disabledPeriods: [{ from: "2026-10-11T03:00:00.000Z", to: "2026-10-15T15:00:00.000Z" }] }, measures: MEASURES }

const item = (id: string, patch: Partial<RequestListItem> = {}): RequestListItem => ({
  id, protocol: `AP-${id.toUpperCase()}`, operatorName: "Larissa Monteiro", operatorAvatarUrl: null, teamName: "Grupo X", subteamName: "X1", origin: "DISLIKE", status: "CLOSED", endCause: "ANJO_CLOSED", createdAt: "2026-11-02T13:00:00.000Z", endedAt: "2026-11-02T13:20:00.000Z",
  anjoNames: ["Ana Souza"], firstResponseSeconds: 75, messageCount: 2, classificationReason: "FOUND_IN_PROCESS", outcome: "RESOLVED", resolved: "YES", stars: 4, ...patch,
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
const ABANDONMENT = (patch: Partial<Abandonment["waiting"]> = {}): Abandonment => ({
  period: PERIOD,
  waiting: { requests: 10, closedInia: 2, cancelled: 1, abandoned: 3, rate: { numerator: 3, denominator: 10, value: 0.3, status: "OK" }, expired: 1, ...patch },
  attendance: { ended: 8, byOperator: { leftInia: 1, noReply: 1, total: 2, rate: { numerator: 2, denominator: 8, value: 0.25, status: "OK" } }, byAnjo: { connection: 1, session: 1, roleRevoked: 0, unknownDrop: 0, noReply: 0, total: 1, rate: { numerator: 1, denominator: 8, value: 0.125, status: "OK" } }, abandoned: 4, rate: { numerator: 4, denominator: 8, value: 0.5, status: "OK" } },
})

function openTab(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 })
}

beforeAll(installJsdomStubs)
const ZERO_AVG = { averageSeconds: null, count: 0 }
const HISTORY_FIXTURE = {
  period: PERIOD,
  serverTime: "2026-11-09T13:00:00.000Z",
  coverage: { baseSince: null, connectionSince: null },
  days: [],
  anjos: [],
  consolidated: {
    journey: { total: { availableMs: 0, attendanceMs: 0, pausedMs: { LUNCH: 0, PERSONAL: 0, PROCESS_ACTIVITY: 0, MEETING: 0 }, unavailableMs: 0 }, baseMs: 0, shares: { available: null, attendance: null, pausedTotal: null, paused: { LUNCH: null, PERSONAL: null, PROCESS_ACTIVITY: null, MEETING: null }, productive: null }, daysWithOnline: 0, dailyAverage: null },
    attendance: {
      acolhimentos: 0,
      operatorWait: ZERO_AVG,
      firstResponse: ZERO_AVG,
      handling: { ...ZERO_AVG, normal: ZERO_AVG, other: ZERO_AVG, otherByCause: {} },
      reasons: { total: 0, items: [] },
      pertinence: { pertinent: 0, notPertinent: 0, notEvaluated: 0, rate: rate(0, 0) },
      noReply: { rate: rate(0, 0), anjoSide: 0, operatorSide: 0 },
      abandonedAfterAcolhimento: 0,
      anjoAbandonment: { total: 0, noReply: 0, drops: 0, rate: rate(0, 0) },
      interruptedBySystem: { connection: 0, session: 0, roleRevoked: 0, unknown: 0 },
      stars: { average: null, count: 0 },
    },
    operation: { requests: 0, acolhidos: 0, waiting: 0, inProgress: 0, endedWithoutAcolhimento: 0, noAnjoLogged: { count: 0, withAnjos: 0, unrecorded: 0 }, abandonedBeforeAcolhimento: { abandoned: 0, cancelled: 0 }, expired: 0, endedInQueueAfterAcolhimento: 0 },
  },
}
const OPERATION = { requests: 9, acolhidos: 6, waiting: 0, inProgress: 0, endedWithoutAcolhimento: 3, noAnjoLogged: { count: 1, withAnjos: 2, unrecorded: 0 }, abandonedBeforeAcolhimento: { abandoned: 1, cancelled: 1 }, expired: 1, endedInQueueAfterAcolhimento: 0 }
const demand = (patch: Record<string, unknown> = {}) => ({
  period: PERIOD,
  productivity: { PRODUCTIVE: 5, NOT_PRODUCTIVE: 2, NOT_EVALUATED: 2 },
  filter: null,
  total: 9,
  byHour: Array.from({ length: 24 }, (_, hour) => (hour === 10 ? 5 : hour === 14 ? 4 : 0)),
  wait: { averageSeconds: 75, p50Seconds: 60, p90Seconds: 180, count: 6, byDay: [{ day: "2026-11-08", averageSeconds: 60, count: 3 }, { day: "2026-11-09", averageSeconds: 90, count: 3 }] },
  top: { operators: [{ key: "o1", label: "Larissa Monteiro", count: 4, share: 4 / 9 }], groups: [{ key: "g1", label: "Grupo X", count: 9, share: 1 }], subgroups: [{ key: "s1", label: "X1", count: 7, share: 7 / 9 }] },
  operation: OPERATION,
  ...patch,
})

beforeEach(() => {
  service.fetchQueueWaiting.mockResolvedValue([])
  service.fetchResponseTimes.mockResolvedValue({ organization: { times: { operatorRequeueMinutes: 15, operatorCloseMinutes: 20, anjoRequeueMinutes: 15 }, version: 3, canEdit: true }, groups: [] })
  service.fetchSupportAbandonment.mockResolvedValue(ABANDONMENT())
  service.fetchSupportDemand.mockImplementation(async (filter: { productivity?: string | null }) => (filter.productivity === "NOT_PRODUCTIVE" ? demand({ filter: "NOT_PRODUCTIVE", total: 2, top: { operators: [{ key: "o2", label: "Rui Prado", count: 2, share: 1 }], groups: [], subgroups: [] } }) : demand()))
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 10, 9, 10, 0, 0))
  service.fetchSupportFunnel.mockResolvedValue(FUNNEL)
  service.fetchSupportRequests.mockResolvedValue({ items: [], nextCursor: null, total: 0 })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe("Painel do apoio › Funil", () => {
  it("acionamentos do período: produtivos × não produtivos (clicar filtra), pico por horário, espera e quem mais aciona", async () => {
    renderWithQuery(<HumanSupportMonitoringPage />)
    openTab("Indicadores")
    expect(await screen.findByTestId("productivity-PRODUCTIVE")).toHaveTextContent("5Produtivos · 55,6%")
    expect(screen.getByTestId("hourly-chart")).toHaveTextContent("Horário com mais acionamentos: 10h (5).")
    expect(screen.getByTestId("wait-summary")).toHaveTextContent("Média 1 min 15 s · metade em até 1 min · 90% em até 3 min · 6 acolhidos")
    expect(screen.getByTestId("top-operators")).toHaveTextContent("Larissa Monteiro")
    expect(screen.getByTestId("top-subgroups")).toHaveTextContent("X1")
    expect(screen.getByTestId("metric-no-anjo")).toHaveTextContent("1")
    fireEvent.click(screen.getByTestId("productivity-NOT_PRODUCTIVE"))
    expect(await within(screen.getByTestId("top-operators")).findByText("Rui Prado")).toBeInTheDocument()
    expect(screen.getByTestId("productivity-NOT_PRODUCTIVE")).toHaveAttribute("aria-pressed", "true")
    expect(service.fetchSupportDemand).toHaveBeenLastCalledWith(expect.objectContaining({ productivity: "NOT_PRODUCTIVE" }))
  })

  it("motivos de acionamento na visão geral da Jornada (do maior para o menor, zero por último); fora de Indicadores", async () => {
    service.fetchOperationHistory.mockResolvedValue(HISTORY_FIXTURE)
    renderWithQuery(<HumanSupportMonitoringPage />)
    openTab("Indicadores")
    await screen.findByTestId("measure-M2")
    expect(screen.queryByTestId("measure-M14")).not.toBeInTheDocument()
    expect(screen.queryByTestId("measure-M12")).not.toBeInTheDocument()
    openTab("Jornada e atendimentos")
    const overview = await screen.findByRole("region", { name: "Atendimentos — todos os Anjos" })
    expect(await within(overview).findByTestId("metric-welcome")).toBeInTheDocument()
    expect(within(overview).getByText("Espera dos operadores")).toBeInTheDocument()
    const card = await within(await screen.findByRole("region", { name: "Principais motivos de acionamento" })).findByTestId("measure-M14")
    const lists = within(card).getAllByRole("list")
    expect(within(lists[0]!).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual([
      "Sem acesso à ferramenta ou ao sistema660%",
      "Ferramenta ou sistema indisponível330%",
      "Falta de processo cadastrado110%",
      "Pergunta mal formulada00%",
    ])
    expect(within(lists[1]!).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual(["Portal de documentos4", "Siebel2"])
  })

  it("indicadores em linguagem de operação: sem códigos nem p50/p90, unidade explícita, poucos dados e sem dados nunca viram 0%", async () => {
    renderWithQuery(<HumanSupportMonitoringPage />)
    openTab("Indicadores")
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
    openTab("Indicadores")
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
    openTab("Indicadores")
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
    openTab("Indicadores")
    await screen.findByTestId("measure-M1")
    expect(screen.queryByRole("combobox", { name: "Filtrar por grupo" })).not.toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Filtrar por subgrupo" })).not.toBeInTheDocument()
    expect(service.fetchSupportScopes).not.toHaveBeenCalled()
  })

  it("quem configura o apoio filtra por Grupo/Subgrupo (a árvore da configuração)", async () => {
    service.fetchSupportScopes.mockResolvedValue([{ type: "GROUP", id: "gx", name: "Grupo X", state: "ON", effective: true, effectiveSource: "OWN", anjoCount: 1, warnings: [], children: [{ type: "SUBGROUP", id: "x1", name: "X1", state: "INHERIT", effective: true, effectiveSource: "GROUP", anjoCount: 1, warnings: [] }] }])
    renderWithQuery(<HumanSupportMonitoringPage canFilterByScope />)
    openTab("Indicadores")
    fireEvent.click(await screen.findByRole("combobox", { name: "Filtrar por subgrupo" }))
    fireEvent.click(await screen.findByRole("option", { name: "Grupo X › X1" }))
    await waitFor(() => expect(service.fetchSupportFunnel).toHaveBeenCalledWith({ ...PERIOD, teamId: "gx", subteamId: "x1" }))
  })
})

describe("Painel do apoio › Pedidos", () => {
  it("lista com filtros e 'Carregar mais' pelo cursor", async () => {
    service.fetchSupportRequests.mockImplementation(async (filter: { cursor?: string | null }) => (filter.cursor === "c2" ? { items: [item("b")], nextCursor: null, total: null } : { items: [item("a")], nextCursor: "c2", total: 2 }))
    renderWithQuery(<HumanSupportMonitoringPage />)
    openTab("Pedidos")
    expect(await screen.findByText("AP-A")).toBeInTheDocument()
    expect(screen.getByText("1 de 2")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }))
    expect(await screen.findByText("AP-B")).toBeInTheDocument()
    expect(service.fetchSupportRequests).toHaveBeenCalledWith(expect.objectContaining({ ...PERIOD, cursor: "c2" }))
    expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("combobox", { name: "Filtrar por estado" }))
    fireEvent.click(await screen.findByRole("option", { name: "Na fila" }))
    await waitFor(() => expect(service.fetchSupportRequests).toHaveBeenCalledWith(expect.objectContaining({ status: "WAITING", cursor: null })))
  })

  it("abrir um pedido mostra o que foi compartilhado, a conversa com os três autores, atendimentos, classificação e avaliação", async () => {
    service.fetchSupportRequests.mockResolvedValue({ items: [item("k2qx9")], nextCursor: null, total: 1 })
    service.fetchSupportRequestDetail.mockResolvedValue(DETAIL)
    renderWithQuery(<HumanSupportMonitoringPage />)
    openTab("Pedidos")
    fireEvent.click(await screen.findByTestId("support-request"))
    const detail = await screen.findByRole("article", { name: "Pedido AP-K2QX9" })
    expect(service.fetchSupportRequestDetail).toHaveBeenCalledWith("k2qx9")
    expect(within(detail).getByText(/abrir este pedido fica registrado/i)).toBeInTheDocument()

    const shared = within(detail).getByRole("region", { name: "O que o operador compartilhou" })
    expect(within(shared).getByText("Como faço a troca de titularidade?")).toBeInTheDocument()
    // A resposta da INIA é texto de IA (Markdown seguro); pergunta, comentário e nota são texto puro.
    expect(within(shared).getByText("procedimento").tagName).toBe("STRONG")
    expect(within(shared).getByText("Faltou o passo do contrato")).toBeInTheDocument()
    expect(within(shared).getByText("Cliente na linha")).toBeInTheDocument()

    const messages = within(detail).getByRole("list", { name: "Mensagens do apoio" })
    const authors = [...messages.querySelectorAll("li")].map((li) => li.getAttribute("data-author"))
    expect(authors).toEqual(["SYSTEM", "ANJO", "OPERATOR"])
    // Como numa conversa de "Conversas com a INIA": operador à direita, Anjo à esquerda, sistema ao centro; separador de data.
    expect(messages.querySelector('[data-author="OPERATOR"] [data-slot="message"]')).toHaveAttribute("data-align", "end")
    expect(messages.querySelector('[data-author="ANJO"] [data-slot="message"]')).toHaveAttribute("data-align", "start")
    expect(messages.querySelector('[data-author="SYSTEM"] [data-slot="message"]')).toBeNull()
    expect(within(messages).getByRole("separator", { name: "2 de novembro de 2026" })).toBeInTheDocument()
    expect(within(detail).getByRole("heading", { name: "Pedido AP-K2QX9" })).toBeInTheDocument()
    expect(within(detail).getByText("Larissa Monteiro", { selector: "span" })).toBeInTheDocument()

    expect(within(detail).getByRole("region", { name: "Atendimentos" })).toHaveTextContent("Primeira resposta: 1 min")
    const classification = within(detail).getByRole("region", { name: "Classificação do Anjo" })
    expect(classification).toHaveTextContent("Informação existente em processo que poderia ter sido encontrada")
    // Endereço digitado pelo Anjo: texto com aviso, nunca um link clicável.
    expect(within(classification).getByText("https://intranet.exemplo/processos/titularidade")).toBeInTheDocument()
    expect(within(detail).queryByRole("link")).not.toBeInTheDocument()
    expect(within(detail).getByRole("region", { name: "Avaliação do operador" })).toHaveTextContent("Sim")
    expect(within(detail).getByLabelText("4 de 5 estrelas")).toBeInTheDocument()
  })

  it("abre em Pedidos no formato de Conversas com a INIA: total no título, busca, lista por dia com foto, estado e mensagens — sem conteúdo da conversa", async () => {
    service.fetchSupportRequests.mockResolvedValue({
      items: [item("k2qx9"), item("w8", { createdAt: "2026-11-01T15:00:00.000Z", status: "WAITING", endCause: null, endedAt: null, anjoNames: [], firstResponseSeconds: null, messageCount: 0, stars: null })],
      nextCursor: null,
      total: 2,
    })
    renderWithQuery(<HumanSupportMonitoringPage />)
    expect(screen.getByRole("heading", { level: 1, name: "Painel dos Anjos" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Pedidos" })).toHaveAttribute("aria-selected", "true")
    expect(await screen.findByText("2 pedidos no período")).toBeInTheDocument()

    const days = screen.getAllByRole("region").filter((region) => region.closest('[aria-label="Pedidos"]'))
    expect(days.map((day) => day.getAttribute("aria-label"))).toEqual(["2 de novembro de 2026", "1 de novembro de 2026"])
    const [closed, waiting] = screen.getAllByTestId("support-request")
    expect(closed).toHaveTextContent("Anjo: Ana Souza · 1ª resposta em 1 min 15 s")
    expect(closed).toHaveTextContent("Encerrado")
    expect(closed).toHaveTextContent("2 mensagens")
    expect(within(closed!).getByLabelText("4 de 5 estrelas")).toBeInTheDocument()
    expect(waiting).toHaveTextContent("Aguardando um Anjo")
    expect(waiting).toHaveTextContent("Na fila")
    // A lista nunca mostra o que foi conversado: isso só aparece ao abrir o pedido (registro LGPD).
    expect(screen.queryByText(/titularidade/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar pedido por operador ou protocolo" }), { target: { value: "  larissa " } })
    await waitFor(() => expect(service.fetchSupportRequests).toHaveBeenCalledWith(expect.objectContaining({ search: "larissa", cursor: null })))
    expect(await screen.findByText("2 pedidos com esses filtros")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Limpar filtros/ }))
    expect(screen.getByRole("searchbox", { name: "Buscar pedido por operador ou protocolo" })).toHaveValue("")
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
    openTab("Monitoria Online")
    const ana = await screen.findByTestId("anjo-now-a1")
    expect(ana).toHaveTextContent("Ativo")
    expect(ana).toHaveTextContent("Disponível")
    expect(ana).toHaveTextContent("12:00")
    expect(ana).toHaveTextContent("Atende: Grupo X")
    expect(screen.getByTestId("anjo-now-a2")).toHaveTextContent("Em atendimento08:001 de 2")
    const carla = screen.getByTestId("anjo-now-a3")
    expect(carla).toHaveTextContent("Em pausa — Lanche")
    expect(carla).toHaveTextContent("23:00")
    expect(carla).toHaveTextContent("Sem conexão · 02:00")
    const davi = screen.getByTestId("anjo-now-a4")
    expect(davi).toHaveTextContent("Inativo")
    // Indisponível e offline são o mesmo estado: um rótulo só.
    expect(davi).toHaveTextContent("Indisponível")
    expect(within(davi).getByTestId("anjo-now-since")).toHaveTextContent("—")
    expect(within(davi).getByTestId("anjo-now-since")).not.toHaveTextContent("há")
    // Resumo só com os ativos; o inativo aparece à parte.
    const summary = screen.getByRole("group", { name: /Quantos Anjos ativos em cada status/ })
    expect(within(summary).getByRole("button", { name: /^\d+\s*Indisponível$/ })).toHaveTextContent("0")
    expect(within(summary).getByRole("button", { name: "O que é Indisponível" })).toBeInTheDocument()
    expect(screen.getByText(/1 Anjo inativo no cadastro/)).toBeInTheDocument()
    // Clicar num status filtra a lista.
    fireEvent.click(within(summary).getByRole("button", { name: /Em pausa/ }))
    expect(screen.queryByTestId("anjo-now-a1")).not.toBeInTheDocument()
    expect(screen.getByTestId("anjo-now-a3")).toBeInTheDocument()
    // A situação agora não depende do período: a chamada não leva datas.
    expect(service.fetchAnjosNow).toHaveBeenCalledWith({ teamId: null, subteamId: null })
  })

  it("operação agora: fila com a maior espera e, sempre à vista, quem aguarda e há quanto tempo, 1ª resposta pendente, Indisponível = offline, sessão encerrada e mudança programada", async () => {
    const base = { scopes: [{ type: "GROUP" as const, id: "gx", name: "Grupo X" }], pauseReason: null, connected: true, connectionLostSince: null, attendances: { active: 0, capacity: 2 }, active: true, since: null }
    service.fetchAnjosNow.mockResolvedValue({
      serverTime: new Date(2026, 10, 9, 10, 0, 0).toISOString(),
      items: [
        { ...base, personId: "v1", name: "Vera", status: "UNAVAILABLE", connection: "CONNECTED", scheduled: null },
        { ...base, personId: "o1", name: "Otto", status: "UNAVAILABLE", connected: false, connection: "CLOSED", scheduled: null },
        { ...base, personId: "s1", name: "Sara", status: "AVAILABLE", connected: false, connection: "SESSION_ENDED", connectionLostSince: new Date(2026, 10, 9, 9, 55).toISOString(), scheduled: null },
        { ...base, personId: "b1", name: "Beto", status: "IN_ATTENDANCE", connection: "CONNECTED", scheduled: { status: "PAUSED", pauseReason: "MEETING" }, attendances: { active: 1, capacity: 2 } },
        // Migration 195: em pausa "Desconexão" pelo sistema, e Indisponível porque não voltou dela.
        { ...base, personId: "d1", name: "Davi", status: "PAUSED", pauseReason: "DISCONNECTION", connection: "CONNECTED", scheduled: null, unresponsive: { kind: "PAUSED", since: new Date(2026, 10, 9, 9, 57).toISOString(), offlineAt: new Date(2026, 10, 9, 10, 7).toISOString() } },
        { ...base, personId: "d2", name: "Dora", status: "UNAVAILABLE", connection: "CONNECTED", scheduled: null, unresponsive: { kind: "OFFLINE", since: new Date(2026, 10, 9, 9, 40).toISOString(), offlineAt: null } },
      ],
      queue: { waiting: 3, oldestWaitingSince: new Date(2026, 10, 9, 9, 46).toISOString(), awaitingFirstResponse: 1, oldestAwaitingSince: new Date(2026, 10, 9, 9, 58).toISOString(), awaitingOperator: 2 },
    })
    // A tabela de quem está na fila fica sempre à vista (sem clicar): quem aguarda e há quanto tempo, desde a entrada original.
    service.fetchQueueWaiting.mockResolvedValue([
      { requestId: "r1", protocol: "AP-AAA222", operatorName: "Larissa Monteiro", operatorAvatarUrl: null, teamName: "Grupo X", subteamName: "X1", origin: "BUTTON", waitingSince: new Date(2026, 10, 9, 9, 46).toISOString(), requeued: false },
      { requestId: "r2", protocol: "AP-BBB333", operatorName: "Rui Prado", operatorAvatarUrl: null, teamName: "Grupo X", subteamName: null, origin: "DISLIKE", waitingSince: new Date(2026, 10, 9, 9, 55).toISOString(), requeued: true },
    ])
    renderWithQuery(<HumanSupportMonitoringPage />)
    openTab("Monitoria Online")
    expect(await screen.findByTestId("queue-waiting")).toHaveTextContent("3 operadores aguardam um Anjo")
    expect(screen.getByTestId("queue-waiting")).toHaveTextContent("Maior espera: 14:00")
    expect(screen.getByTestId("queue-awaiting")).toHaveTextContent("1 atendimento aguarda a 1ª resposta")
    expect(screen.getByTestId("queue-awaiting-operator")).toHaveTextContent("2 pedidos aguardam o operador")
    expect(screen.getByTestId("anjo-now-v1")).toHaveTextContent("Indisponível")
    expect(screen.getByTestId("anjo-now-o1")).toHaveTextContent("Indisponível")
    expect(screen.getByTestId("anjo-now-o1")).not.toHaveTextContent("Offline")
    expect(screen.getByTestId("anjo-now-s1")).toHaveTextContent("Sessão encerrada · 05:00")
    expect(screen.getByTestId("anjo-now-b1")).toHaveTextContent("Em atendimento")
    expect(screen.getByTestId("anjo-now-b1")).toHaveTextContent("Pausa programada — Reunião")
    expect(screen.getByTestId("anjo-now-d1")).toHaveTextContent("Em pausa — Desconexão")
    expect(within(screen.getByTestId("anjo-now-d1")).getByTestId("anjo-now-unresponsive")).toHaveTextContent("Sem responder ninguém · Indisponível às 10:07")
    expect(within(screen.getByTestId("anjo-now-d2")).getByTestId("anjo-now-unresponsive")).toHaveTextContent("Indisponível pelo sistema: não respondia ninguém (09:40)")
    const summary = screen.getByRole("group", { name: /Quantos Anjos ativos em cada status/ })
    expect(within(summary).getByRole("button", { name: /^\d+\s*Indisponível$/ })).toHaveTextContent("3")
    expect(within(summary).queryByRole("button", { name: /Offline/ })).not.toBeInTheDocument()
    expect(screen.getByText(/1 com a sessão encerrada/)).toBeInTheDocument()
    expect(screen.getByText(/1 com pausa ou indisponibilidade programada/)).toBeInTheDocument()
    const queueTable = await screen.findByRole("table", { name: "Operadores na fila" })
    expect(within(queueTable).getByTestId("queue-row-r1")).toHaveTextContent("Larissa MonteiroGrupo X › X1AP-AAA22214:00")
    expect(within(queueTable).getByTestId("queue-row-r2")).toHaveTextContent("(voltou à fila)")
    expect(within(queueTable).getByTestId("queue-row-r2")).toHaveTextContent("05:00")
  })

  it("Monitoria Online: só o agora — Operação agora e os abandonos de HOJE (sem período); Indicadores: os abandonos do período", async () => {
    service.fetchAnjosNow.mockResolvedValue({ serverTime: new Date(2026, 10, 9, 10, 0, 0).toISOString(), items: [], queue: { waiting: 0, oldestWaitingSince: null, awaitingFirstResponse: 0, oldestAwaitingSince: null, awaitingOperator: 0 } })
    service.fetchSupportAbandonment.mockResolvedValue(ABANDONMENT())
    renderWithQuery(<HumanSupportMonitoringPage />)
    openTab("Monitoria Online")
    const waiting = await screen.findByTestId("abandon-waiting")
    expect(waiting).toHaveTextContent("Abandonos na espera3")
    expect(waiting).toHaveTextContent("3 de 10 (30%)")
    expect(waiting).toHaveTextContent("Fechou a INIA antes de ser atendido2")
    expect(waiting).toHaveTextContent("Cancelou o pedido1")
    // Abandono do Anjo com número e taxa próprios, separado do operador (194).
    const anjo = screen.getByTestId("abandon-anjo")
    // Saiu (deslogou) conta; queda de rede fica à parte, sem contar (195).
    expect(anjo).toHaveTextContent("Abandonos do Anjo1")
    expect(anjo).toHaveTextContent("1 de 8 (12,5%)")
    expect(anjo).toHaveTextContent("Saiu (deslogou) e derrubou o operador1")
    expect(anjo).toHaveTextContent("Queda de rede (não conta como abandono)1")
    expect(screen.getByTestId("abandon-operator")).toHaveTextContent("Abandonos do operador no atendimento2")
    expect(screen.getByText("Abandonos de hoje")).toBeInTheDocument()
    // Hoje no fuso de quem vê, sem o período do painel; nada de seletor de período nesta aba.
    expect(service.fetchSupportAbandonment).toHaveBeenCalledWith({ from: "2026-11-09", to: "2026-11-09", teamId: null, subteamId: null })
    expect(screen.queryByRole("button", { name: /Período/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Abrir esta aba fica registrado/)).toBeInTheDocument()

    openTab("Indicadores")
    expect(await screen.findByText("Abandonos no período")).toBeInTheDocument()
    expect(service.fetchSupportAbandonment).toHaveBeenLastCalledWith({ ...PERIOD, teamId: null, subteamId: null })
  })

  it("quem abandonou: o número do card abre a lista do MESMO recorte (servidor, paginada), com data/hora, motivo, o outro lado e o pedido de origem; zero não abre", async () => {
    service.fetchSupportAbandonment.mockResolvedValue({ ...ABANDONMENT(), attendance: { ...ABANDONMENT().attendance, byAnjo: { ...ABANDONMENT().attendance.byAnjo, session: 0, total: 0 } } })
    const person = (personId: string, name: string) => ({ personId, name, avatarUrl: null })
    service.fetchSupportAbandonmentList.mockResolvedValue({
      kind: "OPERATOR",
      total: 12,
      page: 1,
      pageSize: 10,
      items: [
        { at: "2026-11-09T12:40:00.000Z", reason: "LEFT_INIA", person: person("o1", "Larissa Monteiro"), counterpart: person("a1", "Ana Anjo"), request: { id: "req-1", protocol: "AP-000123", createdAt: "2026-11-09T12:30:00.000Z", teamName: "Grupo X", subteamName: "X1" }, attendanceStartedAt: "2026-11-09T12:31:00.000Z" },
        { at: "2026-11-08T15:00:00.000Z", reason: "NO_REPLY", person: person("o2", "Rui Prado"), counterpart: person("a1", "Ana Anjo"), request: { id: "req-2", protocol: "AP-000120", createdAt: "2026-11-08T14:30:00.000Z", teamName: "Grupo X", subteamName: null }, attendanceStartedAt: "2026-11-08T14:31:00.000Z" },
      ],
    })
    service.fetchSupportRequestDetail.mockResolvedValue(DETAIL)
    renderWithQuery(<HumanSupportMonitoringPage />)
    openTab("Indicadores")
    await screen.findByTestId("abandon-operator")
    // Zero (Abandonos do Anjo) não abre lista.
    expect(within(screen.getByTestId("abandon-anjo")).queryByRole("button", { name: /ver quem/ })).not.toBeInTheDocument()
    expect(service.fetchSupportAbandonmentList).not.toHaveBeenCalled()

    fireEvent.click(within(screen.getByTestId("abandon-operator")).getByRole("button", { name: /ver quem: Abandonos do operador no atendimento/ }))
    const list = await screen.findByRole("region", { name: "Operadores que abandonaram no atendimento" })
    expect(service.fetchSupportAbandonmentList).toHaveBeenCalledWith({ ...PERIOD, teamId: null, subteamId: null, kind: "OPERATOR", page: 1, pageSize: 10 })
    const rows = await within(list).findAllByTestId("abandon-person")
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent("Larissa Monteiro")
    expect(rows[0]).toHaveTextContent("Saiu da INIA no meio")
    expect(rows[0]).toHaveTextContent("Anjo: Ana Anjo")
    expect(rows[0]).toHaveTextContent("Grupo X › X1")
    expect(rows[0]).toHaveTextContent("AP-000123")
    expect(rows[1]).toHaveTextContent("Parou de responder (Anjo liberado)")
    expect(list).toHaveTextContent("1–10 de 12 abandonos · página 1 de 2")
    // Próxima página: pedida ao servidor, nunca cortada na tela.
    fireEvent.click(within(list).getByRole("button", { name: /próxima/i }))
    await waitFor(() => expect(service.fetchSupportAbandonmentList).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "OPERATOR", page: 2, pageSize: 10 })))

    // O protocolo abre a conversa do pedido de origem.
    fireEvent.click(within(rows[0]!).getByRole("button", { name: "Abrir o pedido AP-000123" }))
    await waitFor(() => expect(service.fetchSupportRequestDetail).toHaveBeenCalledWith("req-1"))
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
  })
})
