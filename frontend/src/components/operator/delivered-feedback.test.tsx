/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { ApiError } from "@/lib/api/api-client"
import type { DeliveredFeedback } from "@/schemas/feedback-delivery/feedback-delivery.schema"

import { OperatorDailyFeedbackFeed } from "./operator-daily-feedback-feed"
import { feedbackViewSchema } from "@/schemas/feedbacks/feedback-view.schema"
import larissaView from "@/components/feedbacks/__fixtures__/larissa-feedback-view.json"

const service = vi.hoisted(() => ({ fetchMyDeliveredFeedback: vi.fn() }))
vi.mock("@/services/feedback-delivery/feedback-delivery-service", () => service)
const confirmation = vi.hoisted(() => ({ confirmFeedbackReading: vi.fn(), recordReadConfirmationEvent: vi.fn(async () => undefined) }))
vi.mock("@/services/feedback-read-confirmations/feedback-read-confirmations-service", () => confirmation)
const ratings = vi.hoisted(() => ({ fetchMyFeedbackRatings: vi.fn(async () => []), rateFeedback: vi.fn() }))
vi.mock("@/services/feedback-ratings/feedback-ratings-service", () => ratings)

const POSITIVE: DeliveredFeedback = {
  id: "d-1",
  kind: "INTERACTION_FEEDBACK",
  title: "Feedback de atendimento",
  section: "STRENGTH",
  sectionLabel: "Ponto positivo",
  interactionLabel: "14/03/2026",
  interactionAt: "2026-03-14T12:00:00.000Z",
  deliveredAt: "2026-09-24T12:00:00.000Z",
  acknowledgedAt: null,
  blocks: [
    { key: "observed", label: "O que foi observado", text: "Você informou ao cliente o prazo de até cinco dias úteis." },
    { key: "whyItMatters", label: "Por que isso importa", text: "Isso pode ajudar o cliente a se organizar." },
    { key: "whatYouCanDo", label: "O que você pode continuar fazendo", text: "Manter essa prática em conversas parecidas." },
  ],
  evidence: [{ speakerLabel: "Você", text: "O prazo é de até cinco dias úteis, protocolo [PROTOCOLO].", truncated: false }],
}
const ATTENTION: DeliveredFeedback = { ...POSITIVE, id: "d-2", section: "OPPORTUNITY", sectionLabel: "Ponto de atenção", blocks: [{ key: "observed", label: "O que foi observado", text: "O cliente disse que não entendeu o termo usado." }, { key: "whyItMatters", label: "Por que isso importa", text: "Palavras do dia a dia facilitam." }, { key: "whatYouCanDo", label: "O que você pode fazer", text: "Explique o termo com um exemplo." }], evidence: [] }
const EMPTY_HISTORY = { current: [], history: [] }

const renderFeed = () => renderWithQuery(<OperatorDailyFeedbackFeed indicators={EMPTY_HISTORY} />)

beforeAll(installJsdomStubs)
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("Acompanhamento — feedback de atendimento (V1.5.6)", () => {
  it("sem feedback → mensagem clara", async () => {
    service.fetchMyDeliveredFeedback.mockResolvedValue([])
    renderFeed()
    expect(await screen.findByText("Nenhum feedback por enquanto.")).toBeInTheDocument()
  })

  it("carregando → indicador de carregamento; erro → aviso com tentar de novo", async () => {
    service.fetchMyDeliveredFeedback.mockReturnValue(new Promise(() => {}))
    const first = renderFeed()
    expect(screen.getByLabelText("Carregando feedbacks de atendimento")).toBeInTheDocument()
    first.unmount()
    service.fetchMyDeliveredFeedback.mockRejectedValue(new ApiError("Falha", 500, null))
    renderFeed()
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar os feedbacks de atendimento")
  })

  it("ponto positivo: tipo, data do atendimento, blocos só existentes e trecho mascarado ao abrir", async () => {
    service.fetchMyDeliveredFeedback.mockResolvedValue([POSITIVE])
    renderFeed()
    const entry = await screen.findByTestId("delivered-feedback")
    expect(within(entry).getByText("Feedback de atendimento")).toBeInTheDocument()
    expect(within(entry).getByText("Ponto positivo")).toBeInTheDocument()
    expect(within(entry).getByText("Atendimento de 14/03/2026")).toBeInTheDocument()
    // Feedback sobre uma chamada = selo Monitoria; a avaliação "foi útil?" aparece UMA vez, no rodapé do item.
    expect(within(entry).getByText("Monitoria").closest("[data-family]")).toHaveAttribute("data-family", "MONITORING")
    expect(within(entry).getAllByRole("button", { name: "Conteúdo útil" })).toHaveLength(1)
    expect(within(entry).getByText(POSITIVE.blocks[0]!.text)).toBeInTheDocument()
    fireEvent.click(within(entry).getByRole("button", { name: "Ver feedback completo" }))
    expect(await within(entry).findByText("O que você pode continuar fazendo")).toBeInTheDocument()
    expect(within(entry).getByText("Por que isso importa")).toBeInTheDocument()
    expect(within(entry).getByText(/protocolo \[PROTOCOLO\]/)).toBeInTheDocument()
  })

  it("ponto de atenção e positivo como registros separados; nenhuma informação técnica na tela", async () => {
    service.fetchMyDeliveredFeedback.mockResolvedValue([ATTENTION, POSITIVE])
    renderFeed()
    const entries = await screen.findAllByTestId("delivered-feedback")
    expect(entries).toHaveLength(2)
    expect(within(entries[0]!).getByText("Ponto de atenção")).toBeInTheDocument()
    fireEvent.click(within(entries[0]!).getByRole("button", { name: "Ver feedback completo" }))
    expect(await within(entries[0]!).findByText("O que você pode fazer")).toBeInTheDocument()
    expect(within(entries[0]!).queryByText("Trechos do atendimento")).not.toBeInTheDocument()
    const text = entries.map((entry) => entry.textContent).join(" ")
    expect(text).not.toMatch(/\bQA\b|Gemini|\bIA\b|fallback|revis|valida|prompt|política|incerteza/i)
  })

  it("ciência: o próprio colaborador confirma com login e senha (diálogo central); depois mostra a confirmação", async () => {
    service.fetchMyDeliveredFeedback.mockResolvedValue([POSITIVE])
    confirmation.confirmFeedbackReading.mockResolvedValue({ source: { kind: "INTERACTION_FEEDBACK_DELIVERY", id: "d-1" }, acknowledgedAt: "2026-09-25T09:00:00.000Z", alreadyConfirmed: false, application: null })
    renderFeed()
    const entry = await screen.findByTestId("delivered-feedback")
    fireEvent.click(within(entry).getByRole("button", { name: "Ver feedback completo" }))
    fireEvent.click(await within(entry).findByRole("button", { name: /Confirmar ciência/ }))
    const dialog = await screen.findByRole("dialog", { name: "Confirmar ciência" })
    fireEvent.change(within(dialog).getByLabelText("Login"), { target: { value: "joana@empresa.com" } })
    fireEvent.change(within(dialog).getByLabelText("Senha"), { target: { value: "segredo" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar ciência" }))
    await waitFor(() => expect(confirmation.confirmFeedbackReading).toHaveBeenCalledWith(expect.objectContaining({ source: { kind: "INTERACTION_FEEDBACK_DELIVERY", id: "d-1" }, entryPoint: "FOLLOW_UP_FEED", login: "joana@empresa.com", password: "segredo" })))
    expect(await within(entry).findByText(/Ciência confirmada em/)).toBeInTheDocument()
  })
})

describe("Feedback por Flag V2 — hierarquia no Acompanhamento (A–D, H)", () => {
  const view = feedbackViewSchema.parse(larissaView)
  const item = (overrides: Record<string, unknown> = {}) => ({
    id: "fb-1", title: "Atendimento de 28/09/2026 · Contestação de cobrança", message: "RESUMO-ANTIGO-DO-CARD", timestamp: "28/09, 15:30", kind: "monitoria_feedback" as const,
    presentation: { label: "Monitoria", iconKey: "clipboard-check" as const, tone: "warning" as const },
    feedback: { recommendation: "Texto publicado legado", supportMaterials: [], view }, acknowledgedAt: null,
    origin: { family: "MONITORING" as const, reason: "FLAG" as const, label: "Rechamada", iconKey: "phone-incoming" }, ...overrides,
  })
  it("A/B/C/D) V2: origem + título, a narrativa já visível; sem resumo antes dela e sem 'Ver feedback completo'; detalhes fechados", async () => {
    service.fetchMyDeliveredFeedback.mockResolvedValue([])
    renderWithQuery(<OperatorDailyFeedbackFeed indicators={{ current: [], history: [item()] }} />)
    // Topo do cartão: ícone do MOTIVO, "Monitoria · Rechamada" e o título = ASSUNTO (h3, cor da marca) — duas linhas, nunca
    // concatenados; a data do atendimento fica FORA do cartão, à direita da linha "INIA · publicação".
    const card = document.querySelector('[data-slot="feedback-card"]')! as HTMLElement
    const header = within(card).getByRole("banner")
    expect(header).toHaveAttribute("data-family", "MONITORING")
    const origin = within(header).getByText("Monitoria · Rechamada")
    expect(origin).toHaveAttribute("data-slot", "feedback-origin")
    const title = within(header).getByRole("heading", { level: 3, name: "Contestação de cobrança" })
    expect(title).toHaveClass("text-primary", "font-semibold")
    expect(origin.parentElement!.nextElementSibling).toBe(title)
    expect(header.querySelector('[data-slot="feedback-origin-icon"] svg')).not.toBeNull()
    expect(within(card).queryByText("Atendimento de 28/09/2026")).not.toBeInTheDocument()
    const when = screen.getByText("Atendimento de 28/09/2026").closest('[data-slot="feedback-entry-when"]')!
    expect(when.closest('[data-slot="message-header"]')).not.toBeNull()
    expect(screen.queryByText(/Atendimento de 28\/09\/2026 · Contestação/)).not.toBeInTheDocument()
    expect(screen.getByText(/^Larissa, você conduziu bem a investigação do caso e a tratativa/)).toBeVisible()
    expect(screen.queryByText("RESUMO-ANTIGO-DO-CARD")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Ver feedback completo/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Entenda este feedback/ })).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByRole("region", { name: "Materiais utilizados" })).toBeInTheDocument()
  })
  it("H) feedback legado (sem view V2) continua como antes: resumo + 'Ver feedback completo' + texto publicado", async () => {
    service.fetchMyDeliveredFeedback.mockResolvedValue([])
    renderWithQuery(<OperatorDailyFeedbackFeed indicators={{ current: [], history: [item({ feedback: { recommendation: "Texto publicado legado", supportMaterials: [] } })] }} />)
    expect(screen.getByText("RESUMO-ANTIGO-DO-CARD")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Ver feedback completo/ }))
    expect(await screen.findByText("Texto publicado legado")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Entenda este feedback/ })).not.toBeInTheDocument()
  })
})
