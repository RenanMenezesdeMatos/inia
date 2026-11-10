/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { HumanSupportStateValueProvider } from "@/queries/human-support/use-human-support-state"
import type { OperatorView } from "@/schemas/human-support/state.schema"
import { DislikeControl, DislikeForm } from "./dislike-form"

/** Formulário da descurtida no chat livre (Apoio com Anjo, Parte A — design_draft.md seção 2). */
beforeAll(installJsdomStubs)
afterEach(() => cleanup())

const fill = (reason: string, help: "Sim" | "Não") => {
  fireEvent.click(screen.getByRole("radio", { name: reason }))
  fireEvent.click(screen.getByRole("radio", { name: help }))
}

describe("DislikeForm", () => {
  it("com \"Sim\" e o apoio ligado: \"Falar com um Anjo\" abre o pedido com a versão gravada e fecha o formulário", async () => {
    const onRequestSupport = vi.fn()
    const onClose = vi.fn()
    render(<DislikeForm initial={null} removable={false} onSubmit={async () => ({ ratingId: "rating-9" })} onRemove={async () => {}} onClose={onClose} onRequestSupport={onRequestSupport} />)
    fill("Informação errada", "Sim")
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar" })) })
    fireEvent.click(await screen.findByRole("button", { name: "Falar com um Anjo" }))
    expect(onRequestSupport).toHaveBeenCalledWith("rating-9")
    expect(onClose).toHaveBeenCalled()
  })

  it("com \"Sim\" e um pedido já aberto: mostra \"Ver pedido\" (um pedido por vez), nunca um segundo \"Falar com um Anjo\"", async () => {
    const onRequestSupport = vi.fn()
    const operator = { enabled: true, openRequest: { id: "req-1" }, pendingEvaluations: [] } as unknown as OperatorView
    render(
      <HumanSupportStateValueProvider value={{ operator }}>
        <DislikeForm initial={null} removable={false} onSubmit={async () => ({ ratingId: "rating-9" })} onRemove={async () => {}} onClose={vi.fn()} onRequestSupport={onRequestSupport} />
      </HumanSupportStateValueProvider>,
    )
    fill("Informação errada", "Sim")
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar" })) })
    expect(await screen.findByText("Você já tem um pedido de apoio.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Falar com um Anjo" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Ver pedido" }))
    expect(onRequestSupport).toHaveBeenCalledWith("rating-9")
  })

  it("com \"Não\": fecha depois de gravar, sem caminho para o apoio", async () => {
    const onClose = vi.fn()
    const onSubmit = vi.fn(async () => ({ ratingId: "rating-1" }))
    render(<DislikeForm initial={null} removable={false} onSubmit={onSubmit} onRemove={async () => {}} onClose={onClose} onRequestSupport={vi.fn()} />)
    fill("Difícil de entender", "Não")
    fireEvent.change(screen.getByLabelText("Comentário (opcional)"), { target: { value: "  Muito longo.  " } })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar" })) })
    expect(onSubmit).toHaveBeenCalledWith({ reason: "HARD_TO_UNDERSTAND", comment: "  Muito longo.  ", stillNeedsHelp: false })
    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "Falar com um Anjo" })).not.toBeInTheDocument()
  })

  it("enquanto grava, o botão mostra o andamento e não envia de novo", async () => {
    let resolve!: (value: { ratingId: string | null }) => void
    const onSubmit = vi.fn(() => new Promise<{ ratingId: string | null }>((done) => { resolve = done }))
    render(<DislikeForm initial={null} removable={false} onSubmit={onSubmit} onRemove={async () => {}} onClose={vi.fn()} />)
    fill("Resposta incompleta", "Não")
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar" })) })
    expect(screen.getByRole("button", { name: "Enviando…" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Enviando…" }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    await act(async () => { resolve({ ratingId: "r" }) })
  })

  it("falha ao retirar a avaliação aparece no formulário", async () => {
    render(<DislikeForm initial={{ reason: "OTHER", comment: "Faltou o passo.", stillNeedsHelp: true }} removable onSubmit={async () => ({ ratingId: null })} onRemove={async () => { throw new Error("Sem conexão.") }} onClose={vi.fn()} />)
    expect(screen.getByLabelText("Conte o que aconteceu")).toHaveValue("Faltou o passo.")
    expect(screen.getByRole("radio", { name: "Sim" })).toBeChecked()
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retirar avaliação" })) })
    expect(await screen.findByRole("alert")).toHaveTextContent("Sem conexão.")
  })
})

describe("DislikeControl", () => {
  it("o polegar marcado reflete a descurtida; abrir e fechar não chama nada", async () => {
    const onSubmit = vi.fn(async () => ({ ratingId: "r" }))
    const onRemove = vi.fn(async () => {})
    render(<DislikeControl interactionId="a-1" disliked initial={null} onSubmit={onSubmit} onRemove={onRemove} />)
    const thumb = screen.getByRole("button", { name: "Resposta não foi útil" })
    expect(thumb).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(thumb)
    const dialog = await screen.findByRole("dialog", { name: "Por que esta resposta não foi útil?" })
    expect(within(dialog).getByRole("button", { name: "Retirar avaliação" })).toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onRemove).not.toHaveBeenCalled()
  })
})
