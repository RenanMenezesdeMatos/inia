/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { ApiError } from "@/lib/api/api-client"
import type { FeedbackData, RepliesData, ResponseTimeData, SuccessContext, SuccessPeriod } from "@/schemas/inia-success/inia-success.schema"

import { IniaSuccessPage } from "./inia-success-page"

const service = vi.hoisted(() => ({
  fetchSuccessContext: vi.fn(),
  fetchResponseTime: vi.fn(),
  fetchRoutes: vi.fn(),
  fetchReplies: vi.fn(),
  fetchSupport: vi.fn(),
  fetchFeedback: vi.fn(),
  fetchCompliance: vi.fn(),
}))
vi.mock("@/services/inia-success/inia-success-service", () => service)

const rate = (numerator: number, denominator: number) => ({ numerator, denominator, value: denominator >= 5 ? numerator / denominator : null, status: denominator === 0 ? ("NO_DATA" as const) : denominator < 5 ? ("SMALL_SAMPLE" as const) : ("OK" as const) })
const count = (value: number) => ({ numerator: value, denominator: null, value, status: "OK" as const })
const bucket = { key: "2026-11-10", from: "2026-11-10", to: "2026-11-10", days: 1, partial: false }
const PERIOD: SuccessPeriod = { from: "2026-11-10", to: "2026-11-10", days: 1, granularity: "DAY", buckets: [bucket] }
const ALL = { responseTime: true, routes: true, replies: true, support: true, feedback: true, compliance: true }
const context = (sections: Partial<SuccessContext["sections"]>): SuccessContext => ({ sections: { ...Object.fromEntries(Object.keys(ALL).map((key) => [key, false])), ...sections } as SuccessContext["sections"], teams: [{ id: "t1", name: "Grupo Prova" }], subteams: [] })

const FEEDBACK: FeedbackData = {
  period: PERIOD,
  counts: { delivered: 8, acknowledged: 1, up: 3, down: 3, withdrawn: 1, changed: 3, contested: 4, pending: 1, accepted: 1, partial: 1, rejected: 1 },
  acknowledgement: rate(1, 8),
  ratingRate: rate(6, 8),
  positive: rate(3, 6),
  negative: rate(3, 6),
  contestation: rate(4, 8),
  reviewed: 3,
  procedence: { accepted: rate(1, 3), partial: rate(1, 3), rejected: rate(1, 3) },
  reasons: [{ reason: "INACCURATE", label: "Impreciso", count: 2, share: rate(2, 4) }],
  decisionLabels: { ACCEPTED: "Contestação procedente", PARTIALLY_ACCEPTED: "Procedente em parte", REJECTED: "Feedback mantido" },
  byKind: [
    { kind: "INDICATOR", counts: { delivered: 4, acknowledged: 0, up: 1, down: 1, withdrawn: 0, changed: 0, contested: 1, pending: 0, accepted: 0, partial: 0, rejected: 1 }, contestation: rate(1, 4), positive: rate(1, 2) },
    { kind: "MONITORING", counts: { delivered: 4, acknowledged: 1, up: 2, down: 2, withdrawn: 1, changed: 3, contested: 3, pending: 1, accepted: 1, partial: 1, rejected: 0 }, contestation: rate(3, 4), positive: rate(2, 4) },
  ],
  agreement: { status: "NOT_COLLECTED" },
  series: [{ bucket, delivered: 8, contested: 4, up: 3, down: 3, contestation: rate(4, 8), positive: rate(3, 6) }],
}
const REPLIES: RepliesData = {
  period: PERIOD,
  funnel: {
    period: { from: PERIOD.from, to: PERIOD.to },
    cutoffs: { dislikeDetailsSince: null, signalsSince: null },
    measures: [
      { id: "M1", kind: "COUNT", main: count(12) },
      { id: "M2", kind: "RATE", main: rate(0, 12) },
      // Ninguém avaliou: "Sem base para cálculo", nunca 0%.
      { id: "M3", kind: "RATE", main: rate(0, 0) },
      { id: "M4", kind: "DISTRIBUTION", main: { numerator: 0, denominator: null, value: 0, status: "NO_DATA" }, breakdown: [] },
      { id: "M5", kind: "RATE", main: rate(0, 0) },
      { id: "M6", kind: "RATE", main: rate(2, 3), breakdown: [{ key: "KNOWLEDGE_NOT_FOUND", label: "Não encontrou nas bases", count: 2, value: null }, { key: "NO_REPLY", label: "Pergunta sem resposta", count: 1, value: null }] },
    ],
  },
  byChannel: [
    { channel: "chat", answers: 10, up: 0, down: 0, positive: rate(0, 0), rated: rate(0, 10) },
    { channel: "voice", answers: 2, up: 0, down: 0, positive: rate(0, 0), rated: rate(0, 2) },
  ],
  series: [{ bucket, answers: 12, up: 0, down: 0, positive: rate(0, 0), withSignalRow: 3, withSignal: 2, signalRate: rate(2, 3) }],
}
const RESPONSE_TIME: ResponseTimeData = {
  period: PERIOD,
  text: { average: { sum: 200, count: 5, value: 40, status: "OK" }, medianSeconds: 30, p90Seconds: 100, questions: 8, measured: 5, coverage: rate(5, 8), noKey: 1, noReply: 1, unpaired: 1, invalid: 0, replacedByCheck: 0 },
  voice: { status: "NOT_MEASURED", answers: 1, typedQuestions: 1 },
  series: [{ bucket, questions: 8, measured: 5, average: { sum: 200, count: 5, value: 40, status: "OK" } }],
}

beforeAll(installJsdomStubs)
beforeEach(() => {
  for (const fn of Object.values(service)) fn.mockReset()
  service.fetchFeedback.mockResolvedValue(FEEDBACK)
  service.fetchReplies.mockResolvedValue(REPLIES)
  service.fetchResponseTime.mockResolvedValue(RESPONSE_TIME)
  service.fetchRoutes.mockResolvedValue({ period: PERIOD, answers: 0, routes: [], others: null, withoutRoute: { answers: 0, share: rate(0, 0) }, multiRoute: 0, byChannel: { chat: 0, voice: 0 } })
  service.fetchSupport.mockResolvedValue({ period: PERIOD, measures: [], disabledPeriods: [], catalogs: { reasons: [], outcomes: [], origins: [] }, series: [] })
  service.fetchCompliance.mockResolvedValue({ period: PERIOD, mode: "AUDIT", counts: { checks: 0, allowed: 0, violations: 0, blocked: 0, recorded: 0, failed: 0 }, conformity: rate(0, 0), violation: rate(0, 0), inconclusive: rate(0, 0), bySurface: [], series: [] })
})
afterEach(cleanup)

describe("Indicadores de sucesso da INIA", () => {
  it("só com Contestações: os outros blocos ficam 'fora do seu acesso' e as rotas deles nem são chamadas", async () => {
    service.fetchSuccessContext.mockResolvedValue(context({ feedback: true }))
    renderWithQuery(<IniaSuccessPage />)
    await screen.findByText("Ciência confirmada", undefined, { timeout: 5000 })
    expect(screen.getAllByText("Fora do seu acesso").length).toBeGreaterThan(3)
    expect(service.fetchReplies).not.toHaveBeenCalled()
    expect(service.fetchResponseTime).not.toHaveBeenCalled()
    expect(service.fetchCompliance).not.toHaveBeenCalled()
    // Toda taxa com a base; o mesmo filtro (período) em todos os blocos chamados.
    expect(screen.getAllByText("4 de 8 feedbacks disponibilizados").length).toBeGreaterThan(0)
    expect(service.fetchFeedback).toHaveBeenCalledWith(expect.objectContaining({ teamId: null, subteamId: null }))
    expect(screen.getByRole("link", { name: /Contestações de feedback/ })).toHaveAttribute("href", "/admin/feedback-contestations")
    expect(screen.queryByRole("link", { name: /Conversas com a INIA/ })).toBeNull()
  })

  it("denominador zero = 'Sem base para cálculo' (nunca 0%); base pequena = contagem; assertividade do Anjo = coleta indisponível", async () => {
    service.fetchSuccessContext.mockResolvedValue(context(ALL))
    renderWithQuery(<IniaSuccessPage />)
    const summary = await screen.findByRole("region", { name: "Os números principais do período" }, { timeout: 5000 })
    const replies = within(summary).getByText("Respostas úteis no chat").closest("div.rounded-2xl") as HTMLElement
    await within(replies).findByText("Sem base para cálculo", undefined, { timeout: 5000 })
    expect(within(replies).queryByText("0%")).toBeNull()
    expect(within(replies).getByText("Nenhuma resposta avaliada no período")).toBeInTheDocument()
    expect(within(summary).getByText("40 s")).toBeInTheDocument()
    expect(within(summary).getByText("média de 5 respostas medidas")).toBeInTheDocument()
    expect(within(summary).getByText("Coleta ainda indisponível")).toBeInTheDocument()
    // Falha na consulta com 3 respostas: amostra pequena, mostra a contagem.
    expect(screen.getByText("2 de 3 respostas com registro de sinais (menos de 5: sem porcentagem)")).toBeInTheDocument()
    // Revisão: pendentes à parte, fora do denominador da procedência.
    expect(screen.getByText("Fora do denominador da procedência")).toBeInTheDocument()
  })

  it("um bloco com erro não apaga os outros e tem 'tentar de novo'", async () => {
    service.fetchSuccessContext.mockResolvedValue(context(ALL))
    service.fetchResponseTime.mockRejectedValueOnce(new ApiError("Erro 500", 500, null))
    renderWithQuery(<IniaSuccessPage />)
    const errors = await screen.findAllByText("Não foi possível carregar", undefined, { timeout: 5000 })
    expect(errors.length).toBeGreaterThan(0)
    expect(await screen.findByText("Ciência confirmada", undefined, { timeout: 5000 })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole("button", { name: /Tentar de novo/ })[0]!)
    await waitFor(() => expect(service.fetchResponseTime).toHaveBeenCalledTimes(2))
  })

  it("a dica do indicador explica definição, fórmula, base e o que fica fora", async () => {
    service.fetchSuccessContext.mockResolvedValue(context({ feedback: true }))
    renderWithQuery(<IniaSuccessPage />)
    await screen.findByText("Ciência confirmada", undefined, { timeout: 5000 })
    fireEvent.click(screen.getAllByRole("button", { name: "Como é calculado: Procedência entre contestações revisadas" })[0]!)
    const tip = await screen.findAllByText(/Contestações procedentes ÷ contestações revisadas/)
    expect(tip.length).toBeGreaterThan(0)
  })
})
