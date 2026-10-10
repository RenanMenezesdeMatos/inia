/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { FeedbackRating as Rating, FeedbackRatingInput } from "@/schemas/feedback-ratings/feedback-rating.schema"

import { FeedbackDislikeForm, FeedbackRating } from "./feedback-rating"

const service = vi.hoisted(() => ({ fetchMyFeedbackRatings: vi.fn(), rateFeedback: vi.fn() }))
vi.mock("@/services/feedback-ratings/feedback-ratings-service", () => service)

const SOURCE = { kind: "PUBLISHED_FEEDBACK" as const, id: "fb-1" }
const saved = (input: FeedbackRatingInput): Rating | null =>
  input.value === "NONE" ? null : { source: input.source, value: input.value, reason: input.value === "DOWN" ? input.reason : null, comment: input.value === "DOWN" ? input.comment : null, ratedAt: "2026-10-06T12:00:00.000Z" }

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const like = () => screen.getByRole("button", { name: "Conteúdo útil" })
const dislike = () => screen.getByRole("button", { name: "Conteúdo não foi útil" })

describe("Este conteúdo foi útil? — avaliação persistida", () => {
  it("curtir grava na hora e mostra o agradecimento; clicar de novo retira", async () => {
    service.fetchMyFeedbackRatings.mockResolvedValue([])
    service.rateFeedback.mockImplementation(async (input: FeedbackRatingInput) => saved(input))
    renderWithQuery(<FeedbackRating source={SOURCE} />)
    await waitFor(() => expect(service.fetchMyFeedbackRatings).toHaveBeenCalled())
    fireEvent.click(like())
    await waitFor(() => expect(like()).toHaveAttribute("aria-pressed", "true"))
    expect(service.rateFeedback).toHaveBeenLastCalledWith({ source: SOURCE, value: "UP" }, expect.anything())
    expect(screen.getByText("Obrigado pelo retorno!")).toBeInTheDocument()
    // Curtir não abre nada — só registra.
    expect(screen.queryByText("Por que este feedback não foi útil?")).not.toBeInTheDocument()
    fireEvent.click(like())
    await waitFor(() => expect(like()).toHaveAttribute("aria-pressed", "false"))
    expect(service.rateFeedback).toHaveBeenLastCalledWith({ source: SOURCE, value: "NONE" }, expect.anything())
    expect(screen.getByText("Este conteúdo foi útil?")).toBeInTheDocument()
  })

  it("descurtir abre o questionário (popover ancorado no botão, nunca Sheet)", async () => {
    service.fetchMyFeedbackRatings.mockResolvedValue([])
    renderWithQuery(<FeedbackRating source={SOURCE} />)
    expect(dislike()).toHaveAttribute("aria-haspopup", "dialog")
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull()
  })
})

// O questionário é testado fora do Popover do Radix (abrir o popover no jsdom leva segundos e não exercita nada do domínio);
// a composição Popover + questionário é conferida no navegador.
describe("Questionário de 'não foi útil'", () => {
  const props = () => ({ initial: null, pending: false, onCancel: vi.fn(), onRemove: vi.fn(), onSubmit: vi.fn() })

  it("etapa 1: escolher o motivo; etapa 2: descrever o que está errado (pergunta muda com o motivo)", () => {
    const handlers = props()
    renderWithQuery(<FeedbackDislikeForm {...handlers} />)
    expect(screen.getByText("Etapa 1 de 2")).toBeInTheDocument()
    expect(screen.getAllByRole("radio").map((radio) => radio.closest("label")?.textContent)).toEqual([
      "A escrita está ruim",
      "O processo citado está errado",
      "O feedback não ficou claro",
      "A INIA não soube responder minha dúvida",
      "Não condiz com o que aconteceu",
      "Não me ajudou a melhorar",
      "Outro motivo",
    ])
    const next = screen.getByRole("button", { name: "Continuar" })
    expect(next).toBeDisabled()
    expect(screen.queryByRole("button", { name: "Retirar avaliação" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("radio", { name: "O processo citado está errado" }))
    fireEvent.click(next)
    const comment = screen.getByRole("textbox", { name: "O que está errado?" })
    expect(screen.getByText(/Etapa 2 de 2 · O processo citado está errado/)).toBeInTheDocument()
    expect(comment).toHaveAttribute("placeholder", "Qual orientação está errada e qual seria a correta?")
    const send = screen.getByRole("button", { name: "Enviar" })
    expect(send).toBeDisabled()
    fireEvent.change(comment, { target: { value: "  O prazo da análise é de 7 dias úteis, não 5.  " } })
    fireEvent.click(send)
    expect(handlers.onSubmit).toHaveBeenCalledWith("WRONG_PROCESS", "O prazo da análise é de 7 dias úteis, não 5.", expect.any(Function))
  })

  it("falha ao enviar: o texto fica e o aviso aparece", () => {
    const handlers = props()
    handlers.onSubmit.mockImplementation((_reason: string, _comment: string, onError: () => void) => onError())
    renderWithQuery(<FeedbackDislikeForm {...handlers} />)
    fireEvent.click(screen.getByRole("radio", { name: "Outro motivo" }))
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Texto que não pode sumir" } })
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }))
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível enviar")
    expect(screen.getByRole("textbox")).toHaveValue("Texto que não pode sumir")
  })

  it("com avaliação gravada: começa preenchido, Voltar preserva a escolha e dá para retirar", () => {
    const handlers = props()
    renderWithQuery(<FeedbackDislikeForm {...handlers} initial={{ source: SOURCE, value: "DOWN", reason: "UNCLEAR", comment: "Não entendi o segundo ponto.", ratedAt: "2026-10-06T12:00:00.000Z" }} />)
    expect(screen.getByRole("radio", { name: "O feedback não ficou claro" })).toBeChecked()
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
    expect(screen.getByRole("textbox")).toHaveValue("Não entendi o segundo ponto.")
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }))
    expect(screen.getByRole("radio", { name: "O feedback não ficou claro" })).toBeChecked()
    fireEvent.click(screen.getByRole("button", { name: "Retirar avaliação" }))
    expect(handlers.onRemove).toHaveBeenCalled()
  })
})
