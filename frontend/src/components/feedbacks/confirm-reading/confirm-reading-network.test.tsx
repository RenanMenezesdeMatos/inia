/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { ApiError } from "@/lib/api/api-client"

import { ConfirmReadingControl } from "./confirm-reading-control"

/**
 * Ciência pela rede (achado QA-03 da run-9): a conta confirma com a matrícula e a senha de rede, e a tela nunca mostra o
 * "restam N tentativas" do contador da ciência — a trava que vale é a da matrícula (3, somando o login). Vale a mensagem do backend.
 */
const service = vi.hoisted(() => ({ confirmFeedbackReading: vi.fn(), recordReadConfirmationEvent: vi.fn(async () => undefined) }))
vi.mock("@/services/feedback-read-confirmations/feedback-read-confirmations-service", () => service)
vi.mock("@/services/feedback-applications/feedback-applications-service", () => ({ fetchFeedbackApplications: vi.fn(async () => []), fetchFeedbackInvite: vi.fn(async () => null) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock("@/queries/auth/use-current-user", () => ({ useCurrentUserQuery: () => ({ data: { credentialMode: "NETWORK" } }) }))

const SOURCE = { kind: "PUBLISHED_FEEDBACK" as const, id: "11111111-1111-4111-8111-111111111111" }

beforeAll(() => installJsdomStubs())
beforeEach(() => {
  service.confirmFeedbackReading.mockReset()
})
afterEach(() => cleanup())

async function networkDialog() {
  renderWithQuery(<ConfirmReadingControl source={SOURCE} entryPoint="FOLLOW_UP_FEED" acknowledgedAt={null} />)
  fireEvent.click(screen.getByRole("button", { name: /Confirmar ciência/ }))
  const choice = await screen.findByRole("dialog", { name: "Você concorda com este feedback?" })
  fireEvent.click(within(choice).getByRole("radio", { name: "Concordo com o feedback" }))
  fireEvent.click(within(choice).getByRole("button", { name: "Continuar" }))
  const dialog = await screen.findByRole("dialog", { name: "Confirmar ciência" })
  fireEvent.change(within(dialog).getByLabelText("Matrícula de rede"), { target: { value: "G0055350" } })
  fireEvent.change(within(dialog).getByLabelText("Senha"), { target: { value: "errada" } })
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar ciência" }))
  return dialog
}

describe("Confirmar ciência pela rede", () => {
  it("senha de rede errada: a mensagem do backend, sem 'restam N tentativas' (mesmo que viesse a contagem)", async () => {
    const message = "Matrícula ou senha de rede não conferem com a sua conta. Atenção: várias senhas erradas bloqueiam a sua conta de rede."
    service.confirmFeedbackReading.mockImplementation(async () => { throw new ApiError(message, 422, "READ_CONFIRMATION_INVALID_CREDENTIALS", { remainingAttempts: 4 }) })
    const dialog = await networkDialog()
    const alert = await within(dialog).findByRole("alert")
    expect(alert).toHaveTextContent(message)
    expect(alert).not.toHaveTextContent(/Resta/)
  })

  it("trava da matrícula: a mensagem do backend que avisa sobre o bloqueio da conta de rede", async () => {
    const message = "Muitas tentativas com a senha de rede errada. Aguarde alguns minutos — insistir pode bloquear a sua conta de rede."
    service.confirmFeedbackReading.mockImplementation(async () => { throw new ApiError(message, 429, "READ_CONFIRMATION_TOO_MANY_ATTEMPTS") })
    const dialog = await networkDialog()
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(message)
  })
})
