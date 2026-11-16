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
const event = (id: string, over: Partial<ResponseCheckEvent>): ResponseCheckEvent => ({ id, surface: "CHAT", control: "PREVENTIVE", outcome: "VIOLATION", action: "BLOCKED", rules: [{ kind: "PROHIBITED_TOPIC", name: "Política" }], reason: "Opinou sobre política.", errorCode: null, sourceRef: null, flaggedContent: "Vote no candidato X.", conversationId: "c1", agentId: null, agentName: null, createdAt: "2026-11-04T12:00:00.000Z", ...over })

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("registro da conferência das respostas", () => {
  it("prevenção e detecção nunca se confundem; a falha da conferência aparece como falha; a fala vem marcada como já falada", async () => {
    service.fetchResponseCheckSummary.mockResolvedValue({ days: 30, mode: "ENFORCE", modes: { conversation: "ENFORCE", content: "ENFORCE", feedback: "AUDIT" }, checked: 120, delivered: 116, blocked: 2, detected: 1, failed: 1 })
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
    const coverage = screen.getByTestId("response-check-coverage")
    expect(coverage).toHaveTextContent("Reports, intervenções e boas práticas: conferidos antes de ficarem disponíveis")
    expect(coverage).toHaveTextContent("Mensagens de feedback: modo de auditoria: nada é impedido antes da entrega")
    expect(coverage).toHaveTextContent("Sem cobertura: a análise interna do motor de feedback, o Diagnóstico da liderança")
    expect(screen.queryByText("Vote no candidato X.")).not.toBeInTheDocument()
    fireEvent.click(within(rows[0]!).getByRole("button", { name: "Ver texto" }))
    expect(screen.getByText("Vote no candidato X.")).toBeInTheDocument()
  })

  it("AUDIT e OFF nunca aparecem como prevenção, e a tela continua dizendo o que não é coberto", async () => {
    service.fetchResponseChecksPage.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    service.fetchResponseCheckSummary.mockResolvedValue({ days: 30, mode: "AUDIT", modes: { conversation: "AUDIT", content: "AUDIT", feedback: "AUDIT" }, checked: 5, delivered: 5, blocked: 0, detected: 0, failed: 0 })
    const { unmount } = renderWithQuery(<ResponseChecksPanel />)
    const audit = await screen.findByTestId("response-check-coverage")
    expect(audit).toHaveTextContent("nada é impedido antes da entrega")
    expect(audit).not.toHaveTextContent("conferidos antes")
    expect(audit).not.toHaveTextContent("conferidas antes")
    expect(audit).toHaveTextContent("Sem cobertura")
    unmount()
    service.fetchResponseCheckSummary.mockResolvedValue({ days: 30, mode: "OFF", modes: { conversation: "OFF", content: "OFF", feedback: "OFF" }, checked: 0, delivered: 0, blocked: 0, detected: 0, failed: 0 })
    renderWithQuery(<ResponseChecksPanel />)
    const off = await screen.findByTestId("response-check-coverage")
    expect(off).toHaveTextContent("conferência desligada")
    expect(off).not.toHaveTextContent("conferidos antes")
  })

  it("nos fluxos restritos, o registro não traz o texto e diz que ele fica na origem", async () => {
    service.fetchResponseCheckSummary.mockResolvedValue({ days: 30, mode: "ENFORCE", modes: { conversation: "ENFORCE", content: "ENFORCE", feedback: "ENFORCE" }, checked: 1, delivered: 0, blocked: 1, detected: 0, failed: 0 })
    service.fetchResponseChecksPage.mockResolvedValue({ items: [event("f", { surface: "FEEDBACK_MESSAGE", reason: null, flaggedContent: null, sourceRef: "m1", conversationId: null })], total: 1, page: 1, pageSize: 20 })
    renderWithQuery(<ResponseChecksPanel />)
    const row = (await screen.findAllByTestId("response-check-row"))[0]!
    expect(within(row).getByText("Mensagem de feedback")).toBeInTheDocument()
    expect(within(row).getByText("O conteúdo fica na origem, com quem já pode lê-la.")).toBeInTheDocument()
    expect(within(row).queryByRole("button", { name: "Ver texto" })).toBeNull()
  })

  it("sem ocorrências, diz isso; sem alcance da organização, mostra o motivo do servidor", async () => {
    service.fetchResponseCheckSummary.mockResolvedValue({ days: 30, mode: "ENFORCE", modes: { conversation: "ENFORCE", content: "ENFORCE", feedback: "AUDIT" }, checked: 5, delivered: 5, blocked: 0, detected: 0, failed: 0 })
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
