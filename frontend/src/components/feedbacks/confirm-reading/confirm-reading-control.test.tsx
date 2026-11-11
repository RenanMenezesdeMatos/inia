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
const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const SOURCE = { kind: "PUBLISHED_FEEDBACK" as const, id: "11111111-1111-4111-8111-111111111111" }
const AGREED = { value: "AGREE" as const, reason: null, justification: null, recordedAt: "2026-10-06T15:00:00.000Z", review: null }
const confirmed = (agreement: unknown = AGREED, extra: Record<string, unknown> = {}) => ({ source: SOURCE, acknowledgedAt: "2026-10-06T15:00:00.000Z", alreadyConfirmed: false, agreement, agreementDiffered: false, application: null, ...extra })

beforeAll(() => installJsdomStubs())
beforeEach(() => {
  service.confirmFeedbackReading.mockReset()
  service.recordReadConfirmationEvent.mockClear()
  toast.success.mockClear()
  toast.info.mockClear()
  applications.list = []
})
afterEach(() => cleanup())

async function openChoice() {
  fireEvent.click(screen.getByRole("button", { name: /Confirmar ciência/ }))
  return screen.findByRole("dialog", { name: "Você concorda com este feedback?" })
}
function fill(dialog: HTMLElement, login: string, password: string) {
  fireEvent.change(within(dialog).getByLabelText("Login"), { target: { value: login } })
  fireEvent.change(within(dialog).getByLabelText("Senha"), { target: { value: password } })
}
async function agreeAndContinue(choice: HTMLElement) {
  fireEvent.click(within(choice).getByRole("radio", { name: "Concordo com o feedback" }))
  fireEvent.click(within(choice).getByRole("button", { name: "Continuar" }))
  return screen.findByRole("dialog", { name: "Confirmar ciência" })
}

describe("Confirmar ciência — escolha (concordo / não concordo) + login e senha", () => {
  it("etapa 1: nenhuma opção marcada e Continuar desabilitado; concordar → etapa 2 com o resumo; confirmar envia a escolha; registra abrir e confirmar", async () => {
    service.confirmFeedbackReading.mockResolvedValue(confirmed())
    const onConfirmed = vi.fn()
    renderWithQuery(<ConfirmReadingControl source={SOURCE} entryPoint="FOLLOW_UP_FEED" title="Rechamada" acknowledgedAt={null} onConfirmed={onConfirmed} />)
    const choice = await openChoice()
    expect(choice).toHaveAttribute("data-testid", "confirm-reading-dialog")
    expect(document.querySelector("[data-slot='sheet-content']")).toBeNull()
    expect(within(choice).getByText(/“Rechamada”/)).toBeInTheDocument()
    expect(within(choice).getByText("Etapa 1 de 2")).toBeInTheDocument()
    const radios = within(choice).getAllByRole("radio")
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "false"])
    expect(within(choice).getByRole("button", { name: "Continuar" })).toBeDisabled()
    expect(within(choice).queryByLabelText("Login")).not.toBeInTheDocument()
    expect(service.recordReadConfirmationEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "OPENED", entryPoint: "FOLLOW_UP_FEED", source: SOURCE }))

    const dialog = await agreeAndContinue(choice)
    expect(within(dialog).getByTestId("agreement-summary")).toHaveTextContent("Você concorda com o feedback.")
    const submit = within(dialog).getByRole("button", { name: "Confirmar ciência" })
    expect(submit).toBeDisabled()
    fill(dialog, "joana@empresa.com", "")
    expect(submit).toBeDisabled()
    fill(dialog, "joana@empresa.com", "segredo")
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    await waitFor(() => expect(service.confirmFeedbackReading).toHaveBeenCalledTimes(1))
    const sent = service.confirmFeedbackReading.mock.calls[0]![0]
    expect(sent).toMatchObject({ source: SOURCE, entryPoint: "FOLLOW_UP_FEED", login: "joana@empresa.com", password: "segredo", device: "DESKTOP", agreement: { value: "AGREE" } })
    expect(sent.attemptId).toBe(service.recordReadConfirmationEvent.mock.calls[0]![0].attemptId)
    expect(typeof sent.elapsedMs).toBe("number")
    expect(await screen.findByTestId("reading-confirmed")).toHaveTextContent(/Ciência confirmada em/)
    expect(onConfirmed).toHaveBeenCalledWith(expect.objectContaining({ acknowledgedAt: "2026-10-06T15:00:00.000Z" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    // Confirmar não é cancelar.
    expect(service.recordReadConfirmationEvent).toHaveBeenCalledTimes(1)
  })

  it("discordar: motivos aparecem; justificativa só depois do motivo, com a pergunta do motivo e os limites; trocar o motivo mantém o texto; a escolha vai no corpo", async () => {
    service.confirmFeedbackReading.mockResolvedValue(confirmed({ value: "DISAGREE", reason: "INACCURATE", justification: "Eu informei o protocolo.", recordedAt: "2026-10-06T15:00:00.000Z", review: null }))
    renderWithQuery(<ConfirmReadingControl source={SOURCE} entryPoint="FOLLOW_UP_FEED" acknowledgedAt={null} />)
    const choice = await openChoice()
    fireEvent.click(within(choice).getByRole("radio", { name: "Não concordo com o feedback" }))
    expect(within(choice).getByText("Por que você não concorda?")).toBeInTheDocument()
    expect(within(choice).getByText(/Não concordar não impede a ciência/)).toBeInTheDocument()
    expect(within(choice).getAllByRole("radio")).toHaveLength(2 + 7)
    expect(within(choice).queryByRole("textbox")).not.toBeInTheDocument()
    const proceed = within(choice).getByRole("button", { name: "Continuar" })
    expect(proceed).toBeDisabled()

    fireEvent.click(within(choice).getByRole("radio", { name: "O processo citado está errado" }))
    const justification = within(choice).getByLabelText("Qual orientação está errada e qual seria a correta?")
    expect(justification).toHaveAttribute("maxLength", "1000")
    fireEvent.change(justification, { target: { value: "  oi " } })
    expect(proceed).toBeDisabled()
    expect(within(choice).getByText("Escreva pelo menos 3 caracteres.")).toBeInTheDocument()
    fireEvent.change(justification, { target: { value: "Eu informei o protocolo." } })
    // Trocar o motivo troca a pergunta e mantém o texto.
    fireEvent.click(within(choice).getByRole("radio", { name: "Não condiz com o que aconteceu" }))
    expect(within(choice).getByLabelText("O que está diferente do que aconteceu na chamada ou nos seus resultados?")).toHaveValue("Eu informei o protocolo.")
    expect(proceed).toBeEnabled()
    fireEvent.click(proceed)

    const dialog = await screen.findByRole("dialog", { name: "Confirmar ciência" })
    expect(within(dialog).getByTestId("agreement-summary")).toHaveTextContent("Você não concorda com o feedback. Motivo: Não condiz com o que aconteceu")
    fill(dialog, "joana@empresa.com", "segredo")
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar ciência" }))
    await waitFor(() => expect(service.confirmFeedbackReading).toHaveBeenCalledTimes(1))
    expect(service.confirmFeedbackReading.mock.calls[0]![0].agreement).toEqual({ value: "DISAGREE", reason: "INACCURATE", justification: "Eu informei o protocolo." })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ciência confirmada. Sua discordância foi enviada para revisão."))
  })

  it("'Alterar' volta à escolha com tudo preenchido; voltar a concordar não envia motivo nem justificativa", async () => {
    service.confirmFeedbackReading.mockResolvedValue(confirmed())
    renderWithQuery(<ConfirmReadingControl source={SOURCE} entryPoint="FOLLOW_UP_FEED" acknowledgedAt={null} />)
    const choice = await openChoice()
    fireEvent.click(within(choice).getByRole("radio", { name: "Não concordo com o feedback" }))
    fireEvent.click(within(choice).getByRole("radio", { name: "Outro motivo" }))
    fireEvent.change(within(choice).getByRole("textbox"), { target: { value: "Texto de teste." } })
    fireEvent.click(within(choice).getByRole("button", { name: "Continuar" }))
    const dialog = await screen.findByRole("dialog", { name: "Confirmar ciência" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Alterar" }))
    const back = await screen.findByRole("dialog", { name: "Você concorda com este feedback?" })
    expect(within(back).getByRole("radio", { name: "Não concordo com o feedback" })).toHaveAttribute("aria-checked", "true")
    expect(within(back).getByRole("textbox")).toHaveValue("Texto de teste.")
    const dialog2 = await agreeAndContinue(back)
    fill(dialog2, "joana@empresa.com", "segredo")
    fireEvent.click(within(dialog2).getByRole("button", { name: "Confirmar ciência" }))
    await waitFor(() => expect(service.confirmFeedbackReading.mock.calls[0]![0].agreement).toEqual({ value: "AGREE" }))
  })

  it("login ou senha errados: mensagem com as tentativas que restam, senha apagada, escolha mantida, diálogo continua aberto", async () => {
    service.confirmFeedbackReading.mockRejectedValue(new ApiError("Login ou senha não conferem com a sua conta.", 422, "READ_CONFIRMATION_INVALID_CREDENTIALS", { remainingAttempts: 2 }))
    renderWithQuery(<ConfirmReadingControl source={SOURCE} entryPoint="FEEDBACK_SESSION" acknowledgedAt={null} applicationInProgress />)
    const dialog = await agreeAndContinue(await openChoice())
    expect(within(dialog).getByText(/A conversa com a INIA sobre este feedback será concluída/)).toBeInTheDocument()
    fill(dialog, "joana@empresa.com", "errada")
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar ciência" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Login ou senha não conferem com a sua conta. Restam 2 tentativas antes de um bloqueio temporário.")
    expect(within(dialog).getByLabelText("Senha")).toHaveValue("")
    expect(within(dialog).getByLabelText("Login")).toHaveValue("joana@empresa.com")
    expect(within(dialog).getByTestId("agreement-summary")).toHaveTextContent("Você concorda com o feedback.")
    expect(screen.queryByTestId("reading-confirmed")).not.toBeInTheDocument()
  })

  it("bloqueio temporário mostra a partir de que horas tentar de novo", async () => {
    const retryAt = new Date("2026-10-06T15:20:00.000Z")
    service.confirmFeedbackReading.mockRejectedValue(new ApiError("Muitas tentativas.", 429, "READ_CONFIRMATION_TOO_MANY_ATTEMPTS", { retryAt: retryAt.toISOString() }))
    renderWithQuery(<ConfirmReadingControl source={SOURCE} entryPoint="FOLLOW_UP_FEED" acknowledgedAt={null} />)
    const dialog = await agreeAndContinue(await openChoice())
    fill(dialog, "joana@empresa.com", "certa")
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar ciência" }))
    const time = retryAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(`Tente de novo a partir das ${time}.`)
  })

  it("cancelar registra o abandono e não confirma; reabrir mantém a escolha e a justificativa; em andamento pelo cache da aplicação, o diálogo avisa que a conversa será concluída", async () => {
    applications.list = [{ id: "a1", source: SOURCE, status: "IN_PROGRESS" }]
    renderWithQuery(<ConfirmReadingControl source={SOURCE} entryPoint="FOLLOW_UP_FEED" acknowledgedAt={null} />)
    const choice = await openChoice()
    fireEvent.click(within(choice).getByRole("radio", { name: "Não concordo com o feedback" }))
    fireEvent.click(within(choice).getByRole("radio", { name: "O feedback não ficou claro" }))
    fireEvent.change(within(choice).getByLabelText("Qual parte você não entendeu?"), { target: { value: "O segundo parágrafo." } })
    fireEvent.click(within(choice).getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(service.recordReadConfirmationEvent.mock.calls.map((call) => call[0].event)).toEqual(["OPENED", "CANCELLED"])
    expect(service.confirmFeedbackReading).not.toHaveBeenCalled()

    const reopened = await openChoice()
    expect(within(reopened).getByLabelText("Qual parte você não entendeu?")).toHaveValue("O segundo parágrafo.")
    fireEvent.click(within(reopened).getByRole("button", { name: "Continuar" }))
    const dialog = await screen.findByRole("dialog", { name: "Confirmar ciência" })
    expect(await within(dialog).findByText(/A conversa com a INIA sobre este feedback será concluída/)).toBeInTheDocument()
  })

  it("outra aba já tinha confirmado com outra escolha: avisa que vale a registrada", async () => {
    service.confirmFeedbackReading.mockResolvedValue(confirmed(AGREED, { alreadyConfirmed: true, agreementDiffered: true }))
    renderWithQuery(<ConfirmReadingControl source={SOURCE} entryPoint="FOLLOW_UP_FEED" acknowledgedAt={null} />)
    const choice = await openChoice()
    fireEvent.click(within(choice).getByRole("radio", { name: "Não concordo com o feedback" }))
    fireEvent.click(within(choice).getByRole("radio", { name: "Outro motivo" }))
    fireEvent.change(within(choice).getByRole("textbox"), { target: { value: "Discordo por outro motivo." } })
    fireEvent.click(within(choice).getByRole("button", { name: "Continuar" }))
    const dialog = await screen.findByRole("dialog", { name: "Confirmar ciência" })
    fill(dialog, "joana@empresa.com", "segredo")
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar ciência" }))
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("Este feedback já tinha ciência confirmada. Vale a escolha registrada na primeira confirmação."))
  })

  it("já confirmada: mostra a data e nenhum botão", () => {
    renderWithQuery(<ConfirmReadingControl source={SOURCE} entryPoint="FOLLOW_UP_FEED" acknowledgedAt="2026-10-05T12:00:00.000Z" />)
    expect(screen.getByTestId("reading-confirmed")).toHaveTextContent(/Ciência confirmada em/)
    expect(screen.queryByRole("button", { name: /Confirmar ciência/ })).not.toBeInTheDocument()
  })
})
