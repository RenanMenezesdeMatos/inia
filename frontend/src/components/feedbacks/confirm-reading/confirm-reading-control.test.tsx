/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { ApiError } from "@/lib/api/api-client"

import { ConfirmReadingControl } from "./confirm-reading-control"

const service = vi.hoisted(() => ({ confirmFeedbackReading: vi.fn(), recordReadConfirmationEvent: vi.fn(async (_input: { event: string; attemptId: string }) => { void _input }) }))
vi.mock("@/services/feedback-read-confirmations/feedback-read-confirmations-service", () => service)
const applications = vi.hoisted(() => ({ list: [] as unknown[] }))
vi.mock("@/services/feedback-applications/feedback-applications-service", () => ({ fetchFeedbackApplications: vi.fn(async () => applications.list), fetchFeedbackInvite: vi.fn(async () => null) }))

const SOURCE = { kind: "PUBLISHED_FEEDBACK" as const, id: "11111111-1111-4111-8111-111111111111" }

beforeAll(() => installJsdomStubs())
beforeEach(() => {
  service.confirmFeedbackReading.mockReset()
  service.recordReadConfirmationEvent.mockClear()
  applications.list = []
})
afterEach(() => cleanup())

function fill(dialog: HTMLElement, login: string, password: string) {
  fireEvent.change(within(dialog).getByLabelText("Login"), { target: { value: login } })
  fireEvent.change(within(dialog).getByLabelText("Senha"), { target: { value: password } })
}

describe("Confirmar ciência com login e senha", () => {
  it("abre um diálogo central (nunca painel lateral) com login e senha; confirmar só com os dois; registra abrir e confirmar", async () => {
    service.confirmFeedbackReading.mockResolvedValue({ source: SOURCE, acknowledgedAt: "2026-10-06T15:00:00.000Z", alreadyConfirmed: false, application: null })
    const onConfirmed = vi.fn()
    renderWithQuery(<ConfirmReadingControl source={SOURCE} entryPoint="FOLLOW_UP_FEED" title="Rechamada" acknowledgedAt={null} onConfirmed={onConfirmed} />)
    fireEvent.click(screen.getByRole("button", { name: /Confirmar ciência/ }))
    const dialog = await screen.findByRole("dialog", { name: "Confirmar ciência" })
    expect(dialog).toHaveAttribute("data-testid", "confirm-reading-dialog")
    expect(document.querySelector("[data-slot='sheet-content']")).toBeNull()
    expect(within(dialog).getByText(/“Rechamada”/)).toBeInTheDocument()
    expect(service.recordReadConfirmationEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "OPENED", entryPoint: "FOLLOW_UP_FEED", source: SOURCE }))

    const submit = within(dialog).getByRole("button", { name: "Confirmar ciência" })
    expect(submit).toBeDisabled()
    fill(dialog, "joana@empresa.com", "")
    expect(submit).toBeDisabled()
    fill(dialog, "joana@empresa.com", "segredo")
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    await waitFor(() => expect(service.confirmFeedbackReading).toHaveBeenCalledTimes(1))
    const sent = service.confirmFeedbackReading.mock.calls[0]![0]
    expect(sent).toMatchObject({ source: SOURCE, entryPoint: "FOLLOW_UP_FEED", login: "joana@empresa.com", password: "segredo", device: "DESKTOP" })
    expect(sent.attemptId).toBe(service.recordReadConfirmationEvent.mock.calls[0]![0].attemptId)
    expect(typeof sent.elapsedMs).toBe("number")
    expect(await screen.findByTestId("reading-confirmed")).toHaveTextContent(/Ciência confirmada em/)
    expect(onConfirmed).toHaveBeenCalledWith(expect.objectContaining({ acknowledgedAt: "2026-10-06T15:00:00.000Z" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    // Confirmar não é cancelar.
    expect(service.recordReadConfirmationEvent).toHaveBeenCalledTimes(1)
  })

  it("login ou senha errados: mensagem com as tentativas que restam, senha apagada, diálogo continua aberto", async () => {
    service.confirmFeedbackReading.mockRejectedValue(new ApiError("Login ou senha não conferem com a sua conta.", 422, "READ_CONFIRMATION_INVALID_CREDENTIALS", { remainingAttempts: 2 }))
    renderWithQuery(<ConfirmReadingControl source={SOURCE} entryPoint="FEEDBACK_SESSION" acknowledgedAt={null} applicationInProgress />)
    fireEvent.click(screen.getByRole("button", { name: /Confirmar ciência/ }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/A conversa com a INIA sobre este feedback será concluída/)).toBeInTheDocument()
    fill(dialog, "joana@empresa.com", "errada")
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar ciência" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Login ou senha não conferem com a sua conta. Restam 2 tentativas antes de um bloqueio temporário.")
    expect(within(dialog).getByLabelText("Senha")).toHaveValue("")
    expect(within(dialog).getByLabelText("Login")).toHaveValue("joana@empresa.com")
    expect(screen.queryByTestId("reading-confirmed")).not.toBeInTheDocument()
  })

  it("bloqueio temporário mostra a partir de que horas tentar de novo", async () => {
    const retryAt = new Date("2026-10-06T15:20:00.000Z")
    service.confirmFeedbackReading.mockRejectedValue(new ApiError("Muitas tentativas.", 429, "READ_CONFIRMATION_TOO_MANY_ATTEMPTS", { retryAt: retryAt.toISOString() }))
    renderWithQuery(<ConfirmReadingControl source={SOURCE} entryPoint="FOLLOW_UP_FEED" acknowledgedAt={null} />)
    fireEvent.click(screen.getByRole("button", { name: /Confirmar ciência/ }))
    const dialog = await screen.findByRole("dialog")
    fill(dialog, "joana@empresa.com", "certa")
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar ciência" }))
    const time = retryAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(`Tente de novo a partir das ${time}.`)
  })

  it("cancelar registra o abandono e não confirma; em andamento pelo cache da aplicação, o diálogo avisa que a conversa será concluída", async () => {
    applications.list = [{ id: "a1", source: SOURCE, status: "IN_PROGRESS" }]
    renderWithQuery(<ConfirmReadingControl source={SOURCE} entryPoint="FOLLOW_UP_FEED" acknowledgedAt={null} />)
    fireEvent.click(screen.getByRole("button", { name: /Confirmar ciência/ }))
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText(/A conversa com a INIA sobre este feedback será concluída/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(service.recordReadConfirmationEvent.mock.calls.map((call) => call[0].event)).toEqual(["OPENED", "CANCELLED"])
    expect(service.confirmFeedbackReading).not.toHaveBeenCalled()
  })

  it("já confirmada: mostra a data e nenhum botão", () => {
    renderWithQuery(<ConfirmReadingControl source={SOURCE} entryPoint="FOLLOW_UP_FEED" acknowledgedAt="2026-10-05T12:00:00.000Z" />)
    expect(screen.getByTestId("reading-confirmed")).toHaveTextContent(/Ciência confirmada em/)
    expect(screen.queryByRole("button", { name: /Confirmar ciência/ })).not.toBeInTheDocument()
  })
})
