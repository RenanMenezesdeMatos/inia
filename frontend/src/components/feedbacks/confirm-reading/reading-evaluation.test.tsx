/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { FeedbackEvaluation } from "@/schemas/feedback-ratings/feedback-rating.schema"

import { ReadingEvaluation } from "./reading-evaluation"

const service = vi.hoisted(() => ({ confirmFeedbackReading: vi.fn(), recordReadConfirmationEvent: vi.fn(async () => undefined) }))
vi.mock("@/services/feedback-read-confirmations/feedback-read-confirmations-service", () => service)
vi.mock("@/services/feedback-applications/feedback-applications-service", () => ({ fetchFeedbackApplications: vi.fn(async () => []), fetchFeedbackInvite: vi.fn(async () => null) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }))

const SOURCE = { kind: "PUBLISHED_FEEDBACK" as const, id: "11111111-1111-4111-8111-111111111111" }
const REVIEW = { decision: "PARTIALLY_ACCEPTED" as const, response: "O procedimento mudou em outubro;\no restante vale.", respondedAt: "2026-10-21T10:00:00.000Z" }
const evaluation = (overrides: Partial<FeedbackEvaluation>): FeedbackEvaluation => ({ agreement: null, legacyContestation: null, ...overrides })

beforeAll(() => installJsdomStubs())
beforeEach(() => service.confirmFeedbackReading.mockReset())
afterEach(() => cleanup())

describe("Rodapé do item — o que o colaborador registrou sobre o feedback", () => {
  it("sem ciência, sem escolha e sem contestação antiga: nada", () => {
    const { container } = renderWithQuery(<ReadingEvaluation source={SOURCE} acknowledgedAt={null} evaluation={evaluation({})} />)
    expect(container.querySelector("[data-slot='reading-evaluation']")).toBeNull()
  })

  it("concordou: uma linha, sem polegar nem detalhes", () => {
    renderWithQuery(<ReadingEvaluation source={SOURCE} acknowledgedAt="2026-10-20T12:00:00.000Z" evaluation={evaluation({ agreement: { value: "AGREE", reason: null, justification: null, recordedAt: "2026-10-20T12:00:00.000Z", review: null } })} />)
    expect(screen.getByTestId("agreement-line")).toHaveTextContent("Você concordou com o feedback.")
    expect(screen.queryByRole("button", { name: /útil|Ver detalhes/ })).not.toBeInTheDocument()
  })

  it("discordou e aguarda: situação na linha; detalhes em linha com motivo e a justificativa como texto puro", () => {
    renderWithQuery(
      <ReadingEvaluation source={SOURCE} acknowledgedAt="2026-10-20T12:00:00.000Z" evaluation={evaluation({ agreement: { value: "DISAGREE", reason: "WRONG_PROCESS", justification: "**O prazo** é de 7 dias.", recordedAt: "2026-10-20T12:00:00.000Z", review: null } })} />,
    )
    const line = screen.getByTestId("agreement-line")
    expect(line).toHaveTextContent("Você não concordou com o feedback.")
    expect(line).toHaveTextContent("Aguardando resposta da revisão")
    const toggle = within(line).getByRole("button", { name: /Ver detalhes/ })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(within(line).getByText("O processo citado está errado")).toBeInTheDocument()
    // Texto do colaborador nunca passa por Markdown.
    expect(within(line).getByText("**O prazo** é de 7 dias.")).toBeInTheDocument()
    expect(within(line).getByText(/vai responder aqui/)).toBeInTheDocument()
  })

  it("discordou e foi respondido: a resposta da revisão (decisão, texto e data) aparece nos detalhes", () => {
    renderWithQuery(
      <ReadingEvaluation source={SOURCE} acknowledgedAt="2026-10-20T12:00:00.000Z" evaluation={evaluation({ agreement: { value: "DISAGREE", reason: "INACCURATE", justification: "Eu informei o protocolo.", recordedAt: "2026-10-20T12:00:00.000Z", review: REVIEW } })} />,
    )
    const line = screen.getByTestId("agreement-line")
    expect(line).toHaveTextContent("Resposta da revisão disponível")
    fireEvent.click(within(line).getByRole("button", { name: /Ver detalhes/ }))
    expect(within(line).getByTestId("contestation-review")).toHaveTextContent("Resposta da revisão · Procedente em parte")
    expect(within(line).getByTestId("contestation-review")).toHaveTextContent("O procedimento mudou em outubro;")
  })

  it("avaliação 'não foi útil' antiga continua visível, com a resposta, mesmo sem ciência", () => {
    renderWithQuery(<ReadingEvaluation source={SOURCE} acknowledgedAt={null} evaluation={evaluation({ legacyContestation: { reason: "UNCLEAR", comment: "Não entendi.", contestedAt: "2026-10-01T12:00:00.000Z", review: REVIEW } })} />)
    const legacy = screen.getByTestId("legacy-contestation")
    expect(legacy).toHaveTextContent("Avaliação anterior: não foi útil.")
    expect(legacy).toHaveTextContent("Resposta da revisão disponível")
    fireEvent.click(within(legacy).getByRole("button", { name: /Ver detalhes/ }))
    expect(within(legacy).getByText("Não entendi.")).toBeInTheDocument()
    expect(within(legacy).getByTestId("contestation-review")).toHaveTextContent("Procedente em parte")
    expect(screen.queryByTestId("agreement-missing")).not.toBeInTheDocument()
  })

  it("ciência anterior sem escolha: nada presumido; 'Dizer se concorda' abre o mesmo diálogo e registra a escolha uma vez", async () => {
    service.confirmFeedbackReading.mockResolvedValue({ source: SOURCE, acknowledgedAt: "2026-09-01T12:00:00.000Z", alreadyConfirmed: true, agreement: { value: "DISAGREE", reason: "OTHER", justification: "Não era o meu atendimento.", recordedAt: "2026-11-10T12:00:00.000Z", review: null }, agreementDiffered: false, application: null })
    renderWithQuery(<ReadingEvaluation source={SOURCE} title="Rechamada" acknowledgedAt="2026-09-01T12:00:00.000Z" evaluation={evaluation({})} />)
    expect(screen.getByTestId("agreement-missing")).toHaveTextContent("Você ainda não disse se concorda com este feedback.")
    expect(screen.queryByText(/Você concordou/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Dizer se concorda" }))
    const choice = await screen.findByRole("dialog", { name: "Você concorda com este feedback?" })
    expect(within(choice).getByText(/Você já confirmou que leu/)).toBeInTheDocument()
    fireEvent.click(within(choice).getByRole("radio", { name: "Não concordo com o feedback" }))
    fireEvent.click(within(choice).getByRole("radio", { name: "Outro motivo" }))
    fireEvent.change(within(choice).getByLabelText("Conte por que você não concorda com este feedback."), { target: { value: "Não era o meu atendimento." } })
    fireEvent.click(within(choice).getByRole("button", { name: "Continuar" }))
    const dialog = await screen.findByRole("dialog", { name: "Confirmar sua escolha" })
    fireEvent.change(within(dialog).getByLabelText("Login"), { target: { value: "joana@empresa.com" } })
    fireEvent.change(within(dialog).getByLabelText("Senha"), { target: { value: "segredo" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar escolha" }))
    await waitFor(() => expect(service.confirmFeedbackReading).toHaveBeenCalledWith(expect.objectContaining({ entryPoint: "FOLLOW_UP_FEED", agreement: { value: "DISAGREE", reason: "OTHER", justification: "Não era o meu atendimento." } })))
    // Até o próximo carregamento, a escolha vem do que esta sessão do navegador registrou.
    expect(await screen.findByText("Você não concordou com o feedback.")).toBeInTheDocument()
    expect(screen.queryByTestId("agreement-missing")).not.toBeInTheDocument()
  })
})
