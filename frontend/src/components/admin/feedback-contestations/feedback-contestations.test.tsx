/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { ApiError } from "@/lib/api/api-client"
import type { ContestationDetail, ContestationItem } from "@/schemas/admin/feedback-contestation.schema"

import { ContestationDetailPanel } from "./contestation-detail"
import { FeedbackContestationsPage } from "./feedback-contestations-page"

const service = vi.hoisted(() => ({ fetchContestations: vi.fn(), fetchContestation: vi.fn(), reviewContestation: vi.fn() }))
vi.mock("@/services/admin/feedback-contestation-service", async (original) => ({ ...(await original<object>()), ...service }))
const navigation = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/feedback-contestations", useSearchParams: () => navigation.params, useRouter: () => ({ replace: navigation.replace, push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const ITEM: ContestationItem = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "PENDING",
  reason: "INACCURATE",
  comment: "Eu informei o protocolo no fim da ligação.",
  contestedAt: "2026-10-20T12:00:00.000Z",
  collaborator: { personId: "p-joana", name: "Joana Lima", teamName: "B2C", subteamName: "Voz" },
  feedback: { kind: "PUBLISHED_FEEDBACK", id: "f-1", feedbackKind: "MONITORING", impactedIndicator: "TMA", publishedAt: "2026-10-19T15:00:00.000Z" },
  review: null,
}
const DETAIL: ContestationDetail = { ...ITEM, content: { observedBehavior: "Não confirmou o protocolo.", evidenceFound: "“vou verificar aqui”", relatedProcedure: "Procedimento 35", recommendation: "Informe o protocolo." } }

beforeAll(installJsdomStubs)
beforeEach(() => {
  navigation.params = new URLSearchParams()
  navigation.replace.mockReset()
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.localStorage.clear()
})

describe("Contestações de feedback — fila", () => {
  it("abre filtrando as que aguardam resposta; mostra colaborador, motivo, situação e o que ele escreveu; selecionar abre a contestação", async () => {
    service.fetchContestations.mockResolvedValue({ items: [ITEM, { ...ITEM, id: "22222222-2222-4222-8222-222222222222", status: "ANSWERED", reason: "WRONG_PROCESS", review: { decision: "REJECTED", response: "Mantido.", reviewerName: "Ana", respondedAt: "2026-10-20T13:00:00.000Z" } }], total: 2, pendingCount: 1 })
    renderWithQuery(<FeedbackContestationsPage />)
    const rows = await screen.findAllByTestId("feedback-contestation")
    expect(service.fetchContestations).toHaveBeenCalledWith(expect.objectContaining({ status: "PENDING" }))
    expect(within(rows[0]!).getByText("Joana Lima")).toBeInTheDocument()
    expect(within(rows[0]!).getByText("Não condiz com o que aconteceu")).toBeInTheDocument()
    expect(within(rows[0]!).getByText("Aguardando resposta")).toBeInTheDocument()
    expect(within(rows[0]!).getByText("“Eu informei o protocolo no fim da ligação.”")).toBeInTheDocument()
    expect(within(rows[1]!).getByText("Respondida")).toBeInTheDocument()
    expect(screen.getByText("1 aguardando resposta")).toBeInTheDocument()
    fireEvent.click(rows[0]!)
    expect(navigation.replace).toHaveBeenCalledWith(`/admin/feedback-contestations?contestation=${ITEM.id}`, { scroll: false })
  })

  it("sem o papel: explica qual papel pedir", async () => {
    service.fetchContestations.mockRejectedValue(new ApiError("Sem permissão", 403, "FORBIDDEN"))
    renderWithQuery(<FeedbackContestationsPage />)
    expect(await screen.findByText("Sem acesso às contestações de feedback")).toBeInTheDocument()
    expect(screen.getByText(/Revisor de contestações de feedback/)).toBeInTheDocument()
  })
})

describe("Contestações de feedback — responder", () => {
  it("mostra o que o colaborador disse e o que a INIA disse; só envia com conclusão e resposta", async () => {
    const answered: ContestationDetail = { ...DETAIL, status: "ANSWERED", review: { decision: "ACCEPTED", response: "Você tem razão.", reviewerName: "Ana", respondedAt: "2026-10-20T13:00:00.000Z" } }
    // Depois de responder, a tela relê a contestação: o servidor já devolve a resposta.
    service.fetchContestation.mockResolvedValueOnce(DETAIL).mockResolvedValue(answered)
    service.reviewContestation.mockResolvedValue(answered)
    renderWithQuery(<ContestationDetailPanel contestationId={ITEM.id} onBack={() => {}} />)
    expect(await screen.findByText("Eu informei o protocolo no fim da ligação.")).toBeInTheDocument()
    expect(screen.getByText("Não confirmou o protocolo.")).toBeInTheDocument()
    expect(screen.getByText("Informe o protocolo.")).toBeInTheDocument()
    const send = screen.getByRole("button", { name: "Enviar resposta" })
    expect(send).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/Contestação procedente/))
    expect(send).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Resposta"), { target: { value: "Você tem razão." } })
    expect(send).toBeEnabled()
    fireEvent.click(send)
    await waitFor(() => expect(service.reviewContestation).toHaveBeenCalledWith(ITEM.id, { decision: "ACCEPTED", response: "Você tem razão." }))
    expect(await screen.findByText("Resposta enviada")).toBeInTheDocument()
  })

  it("já respondida: mostra a resposta, quem respondeu e não oferece o formulário", async () => {
    service.fetchContestation.mockResolvedValue({ ...DETAIL, status: "ANSWERED", review: { decision: "PARTIALLY_ACCEPTED", response: "Em parte.", reviewerName: "Ana Souza", respondedAt: "2026-10-20T13:00:00.000Z" } })
    renderWithQuery(<ContestationDetailPanel contestationId={ITEM.id} onBack={() => {}} />)
    expect(await screen.findByText("Procedente em parte")).toBeInTheDocument()
    expect(screen.getByText(/Ana Souza/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Enviar resposta" })).not.toBeInTheDocument()
  })
})
