/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { NotificationSummary } from "@/schemas/notifications/notifications.schema"

import { NotificationBell, NotificationPanel, notificationHref } from "./notification-bell"

const service = vi.hoisted(() => ({ fetchNotifications: vi.fn(), markNotificationRead: vi.fn(), markAllNotificationsRead: vi.fn() }))
vi.mock("@/services/notifications/notifications-service", () => service)
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }))

const SUMMARY: NotificationSummary = {
  unreadCount: 2,
  pendingActionCount: 1,
  items: [
    { id: "a1", kind: "HUMAN_REVIEW", title: "Revisão pendente: Karoline", description: "Um workflow está aguardando sua decisão.", severity: "HIGH", createdAt: "2026-09-14T10:00:00.000Z", readAt: null, resolved: false, operator: { personId: "op-1", name: "Karoline" }, actionable: true, target: { type: "PENDING_ACTION", actionId: "enr-1:review" } },
    { id: "a2", kind: "WORKFLOW_OUTPUT", title: "Novo output de workflow: Karoline", description: "Um workflow gerou uma saída.", severity: "MEDIUM", createdAt: "2026-09-14T09:00:00.000Z", readAt: null, resolved: false, operator: { personId: "op-1", name: "Karoline" }, actionable: false, target: { type: "FOLLOW_UP", itemId: "a2", operatorId: "op-1" } },
    { id: "a3", kind: "ESCALATION", title: "Escalonamento: Karoline", description: "Caso escalado.", severity: "HIGH", createdAt: "2026-09-13T09:00:00.000Z", readAt: "2026-09-13T10:00:00.000Z", resolved: false, operator: { personId: "op-1", name: "Karoline" }, actionable: false, target: { type: "FOLLOW_UP", itemId: "a3", operatorId: "op-1" } },
  ],
}

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Sino — dados reais, badge e destinos", () => {
  it("badge do sino = não lidos reais (some quando zera)", async () => {
    service.fetchNotifications.mockResolvedValue(SUMMARY)
    renderWithQuery(<NotificationBell profileHref="/supervisor" />)
    expect(await screen.findByLabelText("Notificações: 2 não lidas")).toHaveTextContent("2")
    cleanup()
    service.fetchNotifications.mockResolvedValue({ ...SUMMARY, unreadCount: 0 })
    renderWithQuery(<NotificationBell profileHref="/supervisor" />)
    expect(await screen.findByLabelText("Notificações")).not.toHaveTextContent("2")
  })

  // O painel é testado fora do Popover do Radix (abrir o popover no jsdom leva segundos e não
  // exercita nada do domínio); a composição Popover+painel é coberta pelo smoke no navegador.
  it("painel lista revisão, output e escalonamento com atalho para Pendências", async () => {
    service.fetchNotifications.mockResolvedValue(SUMMARY)
    const onNavigate = vi.fn()
    renderWithQuery(<NotificationPanel profileHref="/supervisor" onNavigate={onNavigate} />)
    expect(await screen.findByText("1 pendência aguarda você · abrir Pendências")).toBeInTheDocument()
    expect(screen.getByText("Revisão pendente")).toBeInTheDocument()
    expect(screen.getByText("Novo acompanhamento")).toBeInTheDocument()
    expect(screen.getByText("Escalonamento")).toBeInTheDocument()
    fireEvent.click(screen.getByText("1 pendência aguarda você · abrir Pendências"))
    expect(onNavigate).toHaveBeenCalledWith("/supervisor?tab=pending")
  })

  it("abrir uma revisão marca como lida (read state) e leva a Pendências com a revisão — nunca decide", async () => {
    service.fetchNotifications.mockResolvedValue(SUMMARY)
    service.markNotificationRead.mockResolvedValue(undefined)
    const onNavigate = vi.fn()
    renderWithQuery(<NotificationPanel profileHref="/supervisor" onNavigate={onNavigate} />)
    fireEvent.click(await screen.findByText("Revisão pendente"))
    await waitFor(() => expect(service.markNotificationRead).toHaveBeenCalledWith("a1"))
    expect(onNavigate).toHaveBeenCalledWith("/supervisor?tab=pending&review=enr-1%3Areview")
  })

  it("output/escalonamento vão para o Acompanhamento com o item; notificação já lida não dispara nova leitura", async () => {
    service.fetchNotifications.mockResolvedValue(SUMMARY)
    const onNavigate = vi.fn()
    renderWithQuery(<NotificationPanel profileHref="/supervisor" onNavigate={onNavigate} />)
    fireEvent.click(await screen.findByText("Escalonamento"))
    expect(service.markNotificationRead).not.toHaveBeenCalled()
    expect(onNavigate).toHaveBeenCalledWith("/supervisor?tab=followup&item=a3")
  })

  it("'Lidas' marca todas como lidas e recarrega o resumo", async () => {
    service.fetchNotifications.mockResolvedValueOnce(SUMMARY).mockResolvedValue({ ...SUMMARY, unreadCount: 0 })
    service.markAllNotificationsRead.mockResolvedValue({ updated: 2 })
    renderWithQuery(<NotificationPanel profileHref="/supervisor" onNavigate={() => {}} />)
    fireEvent.click(await screen.findByRole("button", { name: "Marcar todas como lidas" }))
    await waitFor(() => expect(service.markAllNotificationsRead).toHaveBeenCalled())
    await waitFor(() => expect(service.fetchNotifications).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Marcar todas como lidas" })).not.toBeInTheDocument())
  })

  it("destinos por papel: operador abre /operator, gestor /supervisor; sem destino → null", () => {
    expect(notificationHref({ type: "PENDING_ACTION", actionId: "e:n" }, "/supervisor")).toBe("/supervisor?tab=pending&review=e%3An")
    expect(notificationHref({ type: "FOLLOW_UP", itemId: "x", operatorId: null }, "/operator")).toBe("/operator?tab=followup&item=x")
    expect(notificationHref({ type: "NONE" }, "/supervisor")).toBeNull()
    // Intervenção: o sino abre o CONTEXTO dela no caso de supervisão, nunca uma tela própria.
    expect(notificationHref({ type: "INTERVENTION", interventionId: "int-1", caseId: "case-1" }, "/supervisor")).toBe("/supervisor/cases/case-1?intervention=int-1")
  })
})
