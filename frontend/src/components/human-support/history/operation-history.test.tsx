/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { AnjoHistory, AttendanceIndicators, OperationHistory } from "@/schemas/human-support/monitoring.schema"

import { MyAnjoHistory } from "./my-anjo-history"
import { OperationHistoryTab } from "./operation-history"

const service = vi.hoisted(() => ({ fetchOperationHistory: vi.fn(), fetchMyAnjoHistory: vi.fn(), fetchSupportFunnel: vi.fn(), fetchAnjoPresenceTimeline: vi.fn() }))
vi.mock("@/services/human-support/human-support-service", () => service)
vi.mock("@/services/view-layouts/view-layout-service", () => ({ fetchViewLayout: vi.fn().mockResolvedValue({ layout: null, updatedAt: null }), saveViewLayout: vi.fn(), resetViewLayout: vi.fn() }))

const H = 3_600_000
const M = 60_000
const ratio = (numerator: number, denominator: number) => ({ numerator, denominator, value: denominator >= 5 ? numerator / denominator : null, status: denominator === 0 ? ("NO_DATA" as const) : denominator < 5 ? ("SMALL_SAMPLE" as const) : ("OK" as const) })
const ATTENDANCE: AttendanceIndicators = {
  acolhimentos: 1,
  operatorWait: { averageSeconds: 35, count: 1 },
  firstResponse: { averageSeconds: 5, count: 1 },
  handling: { averageSeconds: 240, count: 1, normal: { averageSeconds: 240, count: 1 }, other: { averageSeconds: null, count: 0 }, otherByCause: {} },
  reasons: { total: 2, items: [{ key: "NO_PROCESS", label: "Falta de processo cadastrado", count: 1, share: 0.5 }, { key: "NO_CLASSIFICATION", label: "Sem classificação", count: 1, share: 0.5 }] },
  pertinence: { pertinent: 1, notPertinent: 0, notEvaluated: 1, rate: ratio(1, 1) },
  noReply: { rate: ratio(0, 1), anjoSide: 0, operatorSide: 0 },
  abandonedAfterAcolhimento: 0,
  anjoAbandonment: { total: 1, noReply: 1, loggedOut: 0, rate: ratio(1, 2) },
  interruptedBySystem: { connection: 0, session: 0, roleRevoked: 0, unknown: 0 },
  stars: { average: 4.2, count: 6 },
}
// 8 h online — 3 h disponível, 3 h atendendo, 1 h 30 em pausa "Lanche", 30 min pessoal; 16 h Indisponível (= offline, fora da base).
const total = { availableMs: 3 * H, attendanceMs: 3 * H, pausedMs: { LUNCH: 1.5 * H, PERSONAL: 30 * M, PROCESS_ACTIVITY: 0, MEETING: 0, DISCONNECTION: 0 }, unavailableMs: 16 * H }
const shares = { available: 37.5, attendance: 37.5, pausedTotal: 25, paused: { LUNCH: 18.75, PERSONAL: 6.25, PROCESS_ACTIVITY: 0, MEETING: 0, DISCONNECTION: 0 }, productive: 75 }
const structure = (supervisor: string, subteam: string) => ({
  team: { id: "g1", name: "B2C" },
  subteam: { id: subteam, name: subteam === "s1" ? "Atendimento" : "Retenção" },
  leaders: { SUPERVISOR: { id: supervisor, name: supervisor === "sup1" ? "Paula Reis" : "Caio Dias" }, COORDINATOR: { id: "co1", name: "Rita Nunes" }, MANAGER: { id: "ma1", name: "Davi Lopes" }, SENIOR_MANAGER: null },
})
const ANA: AnjoHistory = {
  personId: "ana",
  name: "Ana Souza",
  avatarUrl: null,
  structure: structure("sup1", "s1"),
  journey: { days: [{ day: "2026-11-10", ...total, baseMs: 8 * H }], summary: { total, baseMs: 8 * H, shares, daysWithOnline: 1, dailyAverage: { availableMs: 3 * H, attendanceMs: 3 * H } } },
  attendance: ATTENDANCE,
}
const empty = { availableMs: 0, attendanceMs: 0, pausedMs: { LUNCH: 0, PERSONAL: 0, PROCESS_ACTIVITY: 0, MEETING: 0, DISCONNECTION: 0 }, unavailableMs: 24 * H }
const nullShares = { available: null, attendance: null, pausedTotal: null, paused: { LUNCH: null, PERSONAL: null, PROCESS_ACTIVITY: null, MEETING: null, DISCONNECTION: null }, productive: null }
const BRUNO: AnjoHistory = { ...ANA, personId: "bruno", name: "Bruno Lima", structure: structure("sup2", "s2"), journey: { days: [{ day: "2026-11-10", ...empty, baseMs: 0 }], summary: { total: empty, baseMs: 0, shares: nullShares, daysWithOnline: 0, dailyAverage: null } } }
const HISTORY: OperationHistory = {
  period: { from: "2026-11-10", to: "2026-11-10" },
  serverTime: "2026-11-11T12:00:00.000Z",
  coverage: { baseSince: "2026-11-09T12:00:00.000Z", connectionSince: "2026-11-11T20:00:00.000Z" },
  days: ["2026-11-10"],
  anjos: [ANA, BRUNO],
  consolidated: {
    journey: ANA.journey.summary,
    attendance: ATTENDANCE,
    operation: { requests: 6, acolhidos: 1, waiting: 1, inProgress: 0, endedWithoutAcolhimento: 4, noAnjoLogged: { count: 2, withAnjos: 1, unrecorded: 1 }, abandonedBeforeAcolhimento: { abandoned: 1, cancelled: 1 }, expired: 2, endedInQueueAfterAcolhimento: 0 },
  },
}

beforeAll(() => installJsdomStubs())
beforeEach(() => {
  vi.clearAllMocks()
  service.fetchAnjoPresenceTimeline.mockResolvedValue({
    events: [
      { occurredAt: "2026-11-10T12:00:00.000Z", fromStatus: "AVAILABLE", toStatus: "PAUSED", pauseReason: "LUNCH", cause: "ANJO" },
      // Migration 195: o motivo de o sistema tê-lo tirado de serviço fica na presença.
      { occurredAt: "2026-11-10T14:00:00.000Z", fromStatus: "AVAILABLE", toStatus: "PAUSED", pauseReason: "DISCONNECTION", cause: "UNRESPONSIVE" },
      { occurredAt: "2026-11-10T14:10:00.000Z", fromStatus: "PAUSED", toStatus: "OFFLINE", pauseReason: null, cause: "UNRESPONSIVE_TIMEOUT" },
    ],
  })
  service.fetchSupportFunnel.mockResolvedValue({ period: { from: "2026-11-10", to: "2026-11-10" }, cutoffs: { dislikeDetailsSince: null, signalsSince: null, disabledPeriods: [] }, measures: [] })
})
afterEach(() => cleanup())

describe("Jornada e atendimentos", () => {
  it("coordenação: tempo online em horas como base, percentuais, ⓘ nos termos e 'Sem tempo online'; sem repetir o que está em Indicadores", async () => {
    service.fetchOperationHistory.mockResolvedValue(HISTORY)
    renderWithQuery(<OperationHistoryTab filter={{ from: "2026-11-10", to: "2026-11-10" }} />)
    const table = await screen.findByRole("table", { name: "Jornada e atendimentos por Anjo" })
    const ana = within(table).getByText("Ana Souza").closest("tr")!
    expect(ana).toHaveTextContent("8 h")
    expect(ana).toHaveTextContent("37,5%")
    expect(ana).toHaveTextContent("25%")
    expect(ana).toHaveTextContent("75%")
    // Tempo médio de acolhimento (até a 1ª resposta) e de atendimento, separados.
    expect(ana).toHaveTextContent("5 s")
    expect(ana).toHaveTextContent("4 min")
    for (const term of ["Online", "Disponível", "Em atendimento", "Dia produtivo", "Tempo médio de acolhimento", "Tempo médio de atendimento"]) expect(within(table).getByRole("button", { name: `O que é ${term}` })).toBeInTheDocument()
    expect(within(table).getByText("Bruno Lima").closest("tr")).toHaveTextContent("Sem tempo online")
    // Visão geral de todos os Anjos: os cartões de atendimento somados; a operação (sem Anjo logado, abandonos) fica em Indicadores.
    const overview = screen.getByRole("region", { name: "Atendimentos — todos os Anjos" })
    expect(within(overview).getByTestId("metric-handling")).toHaveTextContent("4 min")
    expect(within(overview).getByText("Espera dos operadores")).toBeInTheDocument()
    expect(screen.queryByTestId("operation-block")).not.toBeInTheDocument()
    expect(screen.getAllByTestId("online-chart").length).toBeGreaterThan(0)

    fireEvent.click(within(table).getByRole("button", { name: /Ana Souza/ }))
    const detail = screen.getByTestId("anjo-history-ana")
    expect(within(detail).getByLabelText("Pausas por tipo")).toHaveTextContent("Lanche: 1 h 30 min · 18,8%")
    expect(within(detail).getByText("3 h aguardando + 3 h atendendo").parentElement).toHaveTextContent("Dia produtivo75%")
    // A tabela por dia fica recolhida abaixo do gráfico.
    expect(within(detail).queryByRole("table", { name: "Jornada por dia" })).not.toBeInTheDocument()
    fireEvent.click(within(detail).getByRole("button", { name: /Ver por dia em tabela/ }))
    expect(within(detail).getByRole("table", { name: "Jornada por dia" })).toHaveTextContent("16 h")
    expect(within(detail).getByRole("button", { name: "O que é Indisponível" })).toBeInTheDocument()
    expect(within(detail).getByTestId("metric-welcome")).toHaveTextContent("5 s")
    expect(within(detail).getByTestId("metric-handling")).toHaveTextContent("4 min")
    expect(within(detail).getByTestId("reasons-ranking")).toHaveTextContent("Sem classificação")
    // Veio da antiga tabela "No período": estrelas e a linha do tempo da presença, no detalhe do Anjo.
    expect(within(detail).getByTestId("metric-stars")).toHaveTextContent("4,2 de 5")
    // Abandonos do Anjo (194): número e taxa próprios, na linha e no detalhe.
    expect(within(ana).getByTestId("anjo-abandonment-cell")).toHaveTextContent("11 de 2 (amostra pequena)")
    expect(within(detail).getByTestId("metric-anjo-abandonment")).toHaveTextContent("Parou de responder 1 · saiu e derrubou o operador 0 · queda de rede não conta")
    expect(ana).toHaveTextContent("4,2")
    expect(await within(detail).findByRole("list", { name: "Presença de Ana Souza" })).toHaveTextContent("Disponível → Em pausa (Lanche)")
    const presence = within(detail).getByRole("list", { name: "Presença de Ana Souza" })
    expect(presence).toHaveTextContent("Disponível → Em pausa (Desconexão)· pelo sistema: ficou sem responder ninguém")
    expect(presence).toHaveTextContent("Em pausa → Indisponível· pelo sistema: não voltou da pausa Desconexão")
    expect(service.fetchAnjoPresenceTimeline).toHaveBeenCalledWith("ana", { from: "2026-11-10", to: "2026-11-10" })

    fireEvent.click(within(table).getByRole("button", { name: /Bruno Lima/ }))
    expect(within(screen.getByTestId("anjo-history-bruno")).getByTestId("journey-empty")).toHaveTextContent("Sem tempo online no período")
  })

  it("filtros de Por Anjo: nome, grupo, subgrupo e a linha de chefia; sem resultado oferece limpar", async () => {
    service.fetchOperationHistory.mockResolvedValue(HISTORY)
    renderWithQuery(<OperationHistoryTab filter={{ from: "2026-11-10", to: "2026-11-10" }} />)
    const table = await screen.findByRole("table", { name: "Jornada e atendimentos por Anjo" })
    for (const label of ["Grupo", "Subgrupo", "Supervisor", "Coordenador", "Gerente", "Gerente sênior"]) expect(screen.getByRole("combobox", { name: label })).toBeInTheDocument()
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar Anjo" }), { target: { value: "bruno" } })
    expect(within(table).queryByText("Ana Souza")).not.toBeInTheDocument()
    expect(within(table).getByText("Bruno Lima")).toBeInTheDocument()
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar Anjo" }), { target: { value: "zzz" } })
    expect(await screen.findByText("Nenhum Anjo com esses filtros")).toBeInTheDocument()
  })

  it("o Anjo vê só o próprio histórico, pela rota dele", async () => {
    service.fetchMyAnjoHistory.mockResolvedValue({ ...HISTORY, anjos: [ANA], consolidated: null })
    renderWithQuery(<MyAnjoHistory />)
    expect(await screen.findByTestId("anjo-history-ana")).toBeInTheDocument()
    expect(service.fetchMyAnjoHistory).toHaveBeenCalledTimes(1)
    expect(service.fetchOperationHistory).not.toHaveBeenCalled()
  })
})
