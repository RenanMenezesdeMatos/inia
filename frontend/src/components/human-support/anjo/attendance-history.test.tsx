/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import type { AnjoAttendanceHistory } from "@/schemas/human-support/state.schema"

import { AttendanceHistory } from "./attendance-history"

/** Histórico dos próprios atendimentos do Anjo (D5): somente leitura. */
const service = vi.hoisted(() => ({ fetchAnjoAttendanceHistory: vi.fn(), fetchSupportMessages: vi.fn() }))
vi.mock("@/services/human-support/human-support-service", () => service)

beforeAll(installJsdomStubs)
afterEach(() => cleanup())
beforeEach(() => {
  for (const mock of Object.values(service)) mock.mockReset()
})

const item = (n: number, overrides: Partial<AnjoAttendanceHistory["items"][number]> = {}): AnjoAttendanceHistory["items"][number] => ({
  attendanceId: `att-${n}`,
  requestId: `req-${n}`,
  protocol: `AP-00000${n}`,
  operatorName: `Operador ${n}`,
  startedAt: "2026-11-09T14:00:00.000Z",
  firstAnjoMessageAt: "2026-11-09T14:01:00.000Z",
  endedAt: "2026-11-09T14:20:00.000Z",
  endCause: "ANJO_CLOSED",
  classified: true,
  classification: { reason: "NO_PROCESS", outcome: "GUIDED", referenceTitle: null },
  ...overrides,
})

describe("AttendanceHistory", () => {
  it("\"Carregar mais\" segue o cursor do servidor", async () => {
    service.fetchAnjoAttendanceHistory.mockResolvedValueOnce({ items: [item(1)], nextCursor: "c-1" }).mockResolvedValueOnce({ items: [item(2, { classified: false, classification: null })], nextCursor: null })
    render(<AttendanceHistory reloadKey="a" />)
    expect(await screen.findByText("Operador 1")).toBeInTheDocument()
    expect(screen.getByText("Classificado")).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }))
    })
    expect(service.fetchAnjoAttendanceHistory).toHaveBeenLastCalledWith("c-1")
    expect(screen.getByText("Operador 2")).toBeInTheDocument()
    expect(screen.getByText("Classificação pendente")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument()
  })

  it("abre a conversa somente para leitura, sem campo de mensagem", async () => {
    service.fetchAnjoAttendanceHistory.mockResolvedValue({ items: [item(1)], nextCursor: null })
    service.fetchSupportMessages.mockResolvedValue({
      messages: [
        { id: "m1", seq: 1, authorKind: "OPERATOR", authorName: "Operador 1", body: "Preciso de ajuda", systemCode: null, occurredAt: "2026-11-09T13:59:00.000Z" },
        { id: "m2", seq: 2, authorKind: "ANJO", authorName: "Ana", body: "Claro!", systemCode: null, occurredAt: "2026-11-09T14:01:00.000Z" },
      ],
      hasMore: false,
    })
    render(<AttendanceHistory reloadKey="a" />)
    fireEvent.click(await screen.findByRole("button", { name: "Ver a conversa de AP-000001" }))
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText("Claro!")).toBeInTheDocument()
    expect(service.fetchSupportMessages).toHaveBeenCalledWith("req-1")
    expect(within(dialog).getByText("Você")).toBeInTheDocument()
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: /Enviar/ })).not.toBeInTheDocument()
  })

  it("lê a primeira página de novo quando um atendimento começa ou termina", async () => {
    service.fetchAnjoAttendanceHistory.mockResolvedValue({ items: [], nextCursor: null })
    const { rerender } = render(<AttendanceHistory reloadKey="a" />)
    expect(await screen.findByText("Você ainda não fez nenhum atendimento.")).toBeInTheDocument()
    service.fetchAnjoAttendanceHistory.mockResolvedValue({ items: [item(3)], nextCursor: null })
    rerender(<AttendanceHistory reloadKey="b" />)
    expect(await screen.findByText("Operador 3")).toBeInTheDocument()
    expect(service.fetchAnjoAttendanceHistory).toHaveBeenCalledTimes(2)
  })

  it("mostra a duração final e, classificado, o motivo, o resultado e a ferramenta — inclusive os motivos novos de impedimento", async () => {
    service.fetchAnjoAttendanceHistory.mockResolvedValueOnce({
      items: [
        item(1, { classification: { reason: "NO_TOOL_ACCESS", outcome: "FORWARDED", referenceTitle: "Siebel" } }),
        item(2, { classification: { reason: "TOOL_UNAVAILABLE", outcome: "GUIDED", referenceTitle: null } }),
        item(3, { classification: { reason: "FOUND_IN_PROCESS", outcome: "RESOLVED", referenceTitle: "Cancelamento PJ" } }),
        item(4, { endedAt: null, endCause: null, classified: false, classification: null }),
      ],
      nextCursor: null,
    })
    render(<AttendanceHistory reloadKey="a" />)
    const rows = await screen.findAllByRole("listitem")
    expect(rows[0]).toHaveTextContent("durou 20 min 0 s")
    expect(rows[0]).toHaveTextContent("Sem acesso à ferramenta ou ao sistema · Encaminhado à liderança ou a outra área · Siebel")
    expect(rows[1]).toHaveTextContent("Ferramenta ou sistema indisponível · Orientado, depende de ação do operador")
    expect(rows[2]).toHaveTextContent("Informação existente em processo que poderia ter sido encontrada · Resolvido no atendimento · Cancelamento PJ")
    expect(rows[3]).toHaveTextContent("em andamento")
    expect(rows[3]).not.toHaveTextContent("durou")
  })
})
