/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { DeliveredFeedback } from "@/schemas/feedback-delivery/feedback-delivery.schema"
import type { OperatorIndicatorHistory } from "@/schemas/operator"

import { buildFollowUpTimeline, followUpDayLabel } from "./follow-up-timeline"
import { OperatorDailyFeedbackFeed } from "./operator-daily-feedback-feed"

const service = vi.hoisted(() => ({ fetchMyDeliveredFeedback: vi.fn() }))
vi.mock("@/services/feedback-delivery/feedback-delivery-service", () => service)
const confirmation = vi.hoisted(() => ({ confirmFeedbackReading: vi.fn(), recordReadConfirmationEvent: vi.fn(async () => undefined) }))
vi.mock("@/services/feedback-read-confirmations/feedback-read-confirmations-service", () => confirmation)

let intersect: (() => void) | null = null
class IntersectionObserverStub {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe() { intersect = () => this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
  disconnect() {}
  unobserve() {}
}

beforeAll(() => {
  installJsdomStubs()
  global.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); intersect = null })

const history = (id: string, occurredAt: string, title = `Feedback ${id}`): OperatorIndicatorHistory => ({
  id, title, message: `Resumo ${id}`, timestamp: occurredAt, occurredAt, kind: "monitoria_feedback",
  presentation: { label: "Monitoria", iconKey: "clipboard-check", tone: "warning" },
  feedback: { recommendation: `Texto ${id}`, supportMaterials: [] }, acknowledgedAt: null,
})
const delivered = (id: string, deliveredAt: string): DeliveredFeedback => ({
  id, kind: "INTERACTION_FEEDBACK", title: "Feedback de atendimento", section: "STRENGTH", sectionLabel: "Ponto positivo",
  interactionLabel: "28/09/2026", interactionAt: null, deliveredAt, acknowledgedAt: null,
  blocks: [{ key: "observed", label: "O que foi observado", text: `Entrega ${id}` }], evidence: [],
})

describe("Timeline do Acompanhamento — mais recente primeiro", () => {
  it("ordena as duas fontes numa lista só pelo instante canônico; empate → desempate determinístico pelo id", () => {
    const timeline = buildFollowUpTimeline(
      [history("a", "2026-09-25T12:00:00.000Z"), history("c", "2026-09-29T12:32:00.000Z"), history("b", "2026-09-29T12:32:00.000Z")],
      [delivered("d", "2026-09-28T19:40:00.000Z")],
    )
    expect(timeline.map((entry) => entry.key)).toEqual(["history:c", "history:b", "delivered:d", "history:a"])
    // Mesma entrada em outra ordem → mesma saída (nada depende da ordem de chegada).
    const again = buildFollowUpTimeline([history("b", "2026-09-29T12:32:00.000Z"), history("a", "2026-09-25T12:00:00.000Z"), history("c", "2026-09-29T12:32:00.000Z")], [delivered("d", "2026-09-28T19:40:00.000Z")])
    expect(again.map((entry) => entry.key)).toEqual(timeline.map((entry) => entry.key))
  })

  it("item sem data vai para o fim; o conteúdo de cada item não é tocado", () => {
    const undated = { ...history("x", ""), occurredAt: undefined }
    const timeline = buildFollowUpTimeline([undated, history("y", "2026-09-01T12:00:00.000Z")], [])
    expect(timeline.map((entry) => entry.key)).toEqual(["history:y", "history:x"])
    expect(timeline[1]!.item).toBe(undated)
  })

  it("rótulo do dia: Hoje, Ontem ou dia da semana + data (ano só fora do ano corrente)", () => {
    const now = new Date(2026, 8, 29, 10, 0)
    expect(followUpDayLabel(new Date(2026, 8, 29, 8, 32).getTime(), now)).toBe("Hoje")
    expect(followUpDayLabel(new Date(2026, 8, 28, 16, 40).getTime(), now)).toBe("Ontem")
    expect(followUpDayLabel(new Date(2026, 8, 25, 9, 0).getTime(), now)).toBe("Sexta-feira, 25/09")
    expect(followUpDayLabel(new Date(2025, 11, 31, 9, 0).getTime(), now)).toMatch(/31\/12\/2025$/)
  })

  it("feed: página 1 = os mais recentes, com separador por dia; carregar mais = progressivamente mais antigos", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const now = new Date()
    const at = (daysAgo: number, hour: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, 0).toISOString()
    service.fetchMyDeliveredFeedback.mockResolvedValue([delivered("entrega", at(1, 16))])
    const items = [history("h1", at(5, 9)), history("h2", at(0, 7)), history("h3", at(0, 8)), history("h4", at(2, 10)), history("h5", at(3, 11))]
    renderWithQuery(<OperatorDailyFeedbackFeed indicators={{ current: [], history: items }} />)
    await screen.findByText("Entrega entrega")
    const order = () => screen.getAllByTestId("follow-up-entry").map((entry) => entry.textContent?.match(/Feedback h\d|Entrega entrega/)?.[0])
    expect(order()).toEqual(["Feedback h3", "Feedback h2", "Entrega entrega", "Feedback h4"])
    expect(screen.getAllByTestId("follow-up-day").map((day) => day.textContent)).toEqual(["Hoje", "Ontem", followUpDayLabel(Date.parse(at(2, 10)))])
    await act(async () => { intersect?.(); await vi.advanceTimersByTimeAsync(700) })
    expect(order()).toEqual(["Feedback h3", "Feedback h2", "Entrega entrega", "Feedback h4", "Feedback h5", "Feedback h1"])
    expect(screen.getByText("Fim dos feedbacks deste período.")).toBeInTheDocument()
  })

  it("feedback anterior sem view model: o título é o assunto que o backend resolveu na leitura e a data do atendimento vira subtítulo", async () => {
    service.fetchMyDeliveredFeedback.mockResolvedValue([])
    const now = new Date().toISOString()
    const legacy = { ...history("legado", now, "Segunda via de fatura"), subtitle: "Atendimento de 14/09/2026" }
    renderWithQuery(<OperatorDailyFeedbackFeed indicators={{ current: [], history: [legacy] }} />)
    expect(await screen.findByRole("heading", { name: "Segunda via de fatura" })).toBeInTheDocument()
    expect(screen.getByText("Atendimento de 14/09/2026")).toBeInTheDocument()
  })
})
