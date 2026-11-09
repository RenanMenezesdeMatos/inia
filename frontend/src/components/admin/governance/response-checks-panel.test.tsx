/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { AdminApiError } from "@/lib/admin/admin-api"
import type { ResponseCheckEvent } from "@/schemas/admin/governance.schema"

import { ResponseChecksPanel } from "./response-checks-panel"

const service = vi.hoisted(() => ({ fetchResponseCheckSummary: vi.fn(), fetchResponseChecksPage: vi.fn() }))
vi.mock("@/services/admin/governance-service", () => service)

// Exemplos FICTÍCIOS de teste.
const event = (id: string, over: Partial<ResponseCheckEvent>): ResponseCheckEvent => ({ id, surface: "CHAT", control: "PREVENTIVE", outcome: "VIOLATION", action: "BLOCKED", rules: [{ kind: "PROHIBITED_TOPIC", name: "Política" }], reason: "Opinou sobre política.", errorCode: null, flaggedContent: "Vote no candidato X.", conversationId: "c1", agentId: null, agentName: null, createdAt: "2026-11-04T12:00:00.000Z", ...over })

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("registro da conferência das respostas", () => {
  it("prevenção e detecção nunca se confundem; a falha da conferência aparece como falha; a fala vem marcada como já falada", async () => {
    service.fetchResponseCheckSummary.mockResolvedValue({ days: 30, mode: "ENFORCE", checked: 120, delivered: 116, blocked: 2, detected: 1, failed: 1 })
    service.fetchResponseChecksPage.mockResolvedValue({
      items: [
        event("a", {}),
        event("b", { surface: "VOICE_SPOKEN", control: "DETECTIVE", action: "RECORDED", flaggedContent: "Falei demais." }),
        event("c", { surface: "AGENT_RUN", outcome: "CHECK_FAILED", rules: [], reason: "O provedor não concluiu.", agentName: "Agente de Prova" }),
      ],
      total: 3,
      page: 1,
      pageSize: 20,
    })
    renderWithQuery(<ResponseChecksPanel />)
    const rows = await screen.findAllByTestId("response-check-row")
    expect(within(rows[0]!).getByText("Bloqueada antes da entrega")).toBeInTheDocument()
    expect(within(rows[0]!).getByText("Política")).toBeInTheDocument()
    expect(within(rows[1]!).getByText("Detectada depois da entrega")).toBeInTheDocument()
    expect(within(rows[1]!).getByText("Voz, depois de falada")).toBeInTheDocument()
    expect(within(rows[2]!).getByText("Conferência falhou: não entregue")).toBeInTheDocument()
    expect(within(rows[2]!).getByText("Agente de Prova")).toBeInTheDocument()
    expect(screen.getByText("Bloqueadas antes da entrega").nextSibling).toHaveTextContent("2")
    expect(await screen.findByText(/só é conferido depois de falado/)).toBeInTheDocument()
    expect(screen.getByText(/não cobre o motor de feedback, os reports, as intervenções, o treino nem as boas práticas/)).toBeInTheDocument()
    expect(screen.queryByText("Vote no candidato X.")).not.toBeInTheDocument()
    fireEvent.click(within(rows[0]!).getByRole("button", { name: "Ver texto" }))
    expect(screen.getByText("Vote no candidato X.")).toBeInTheDocument()
  })

  it("AUDIT e OFF nunca aparecem como prevenção, e a tela continua dizendo o que não é coberto", async () => {
    service.fetchResponseChecksPage.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    service.fetchResponseCheckSummary.mockResolvedValue({ days: 30, mode: "AUDIT", checked: 5, delivered: 5, blocked: 0, detected: 0, failed: 0 })
    const { unmount } = renderWithQuery(<ResponseChecksPanel />)
    expect(await screen.findByText(/nada é impedido antes da entrega/)).toBeInTheDocument()
    expect(screen.queryByText(/Antes de entregar, a INIA confere/)).not.toBeInTheDocument()
    expect(screen.getByText(/não cobre o motor de feedback/)).toBeInTheDocument()
    unmount()
    service.fetchResponseCheckSummary.mockResolvedValue({ days: 30, mode: "OFF", checked: 0, delivered: 0, blocked: 0, detected: 0, failed: 0 })
    renderWithQuery(<ResponseChecksPanel />)
    expect(await screen.findByText(/A conferência está desligada/)).toBeInTheDocument()
    expect(screen.queryByText(/Antes de entregar, a INIA confere/)).not.toBeInTheDocument()
  })

  it("sem ocorrências, diz isso; sem alcance da organização, mostra o motivo do servidor", async () => {
    service.fetchResponseCheckSummary.mockResolvedValue({ days: 30, mode: "ENFORCE", checked: 5, delivered: 5, blocked: 0, detected: 0, failed: 0 })
    service.fetchResponseChecksPage.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    const { unmount } = renderWithQuery(<ResponseChecksPanel />)
    expect(await screen.findByText("Nenhuma resposta bloqueada, detectada ou sem conferência.")).toBeInTheDocument()
    unmount()
    const denied = new AdminApiError("Este registro vale para a organização inteira.", "ORGANIZATION_SCOPE_REQUIRED")
    service.fetchResponseCheckSummary.mockRejectedValue(denied)
    service.fetchResponseChecksPage.mockRejectedValue(denied)
    renderWithQuery(<ResponseChecksPanel />)
    await waitFor(() => expect(screen.getAllByText("Este registro vale para a organização inteira.").length).toBeGreaterThan(0))
  })
})
