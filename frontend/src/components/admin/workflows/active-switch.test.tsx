/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { AdminApiError } from "@/lib/admin/admin-api"
import type { GoLiveImpact, Workflow } from "@/schemas/admin/workflow.schema"

import { ActiveSwitch } from "./workflows-page"

/** Ativar uma Agenda publicada põe a configuração no ar na hora: a mesma confirmação de impacto da publicação. */
const service = vi.hoisted(() => ({ updateWorkflow: vi.fn() }))
vi.mock("@/services/admin/workflow-service", () => service)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const toast = await import("sonner")

const WORKFLOW: Workflow = {
  id: "wf-1",
  name: "Feedback de indicador",
  description: null,
  scopeType: "ALL_TEAMS",
  teamId: null,
  teamName: null,
  subteamId: null,
  subteamName: null,
  active: false,
  createdAt: "2026-10-01T10:00:00Z",
  published: true,
  trigger: { kind: "schedule", mode: "CALENDAR", times: ["08:00"], intervalDays: 1, frequency: { type: "DAILY" } },
  activeEnrollments: 0,
  blockedEnrollments: 0,
  configurationChanges: [],
}

const IMPACT: GoLiveImpact = {
  reason: "ACTIVATE",
  triggerKind: "schedule",
  goesLive: true,
  firstPublication: false,
  configurationChanges: [],
  schedule: {
    mode: "CALENDAR",
    evaluation: "INDIVIDUAL",
    population: 120,
    enrollmentsPerOccurrence: 120,
    immediate: { enrollments: 0, alreadyEnrolled: 120, scheduledFor: [] },
    firstFireAt: "2026-10-06T11:00:00.000Z",
    firesImmediately: false,
    timezone: "America/Fortaleza",
  },
  requiresConfirmation: true,
  reasons: ["LARGE_POPULATION"],
  threshold: 50,
  fingerprint: "c3c3c3c3c3c3c3c3",
}

beforeAll(() => installJsdomStubs())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("ActiveSwitch — ativar com impacto", () => {
  it("o 409 vira diálogo (sem toast de erro); confirmado, ativa levando o fingerprint", async () => {
    service.updateWorkflow.mockRejectedValueOnce(new AdminApiError("Confirme o impacto para ativar.", "WORKFLOW_ACTIVATION_CONFIRMATION_REQUIRED", { impact: IMPACT }))
    service.updateWorkflow.mockResolvedValueOnce({ ...WORKFLOW, active: true })
    renderWithQuery(<ActiveSwitch workflow={WORKFLOW} />)

    fireEvent.click(screen.getByRole("switch", { name: "Ativar workflow" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("Ativar workflow")
    expect(within(dialog).getByTestId("go-live-impact-schedule")).toHaveTextContent("120 colaboradores elegíveis")
    expect(within(dialog).getByTestId("go-live-impact-first-fire")).toHaveTextContent("Primeira execução: 06/10/2026, 08:00")
    expect(toast.toast.error).not.toHaveBeenCalled()

    const confirm = within(dialog).getByRole("button", { name: "Ativar" })
    expect(confirm).toBeDisabled()
    fireEvent.click(within(dialog).getByRole("checkbox"))
    fireEvent.click(confirm)
    await waitFor(() => expect(service.updateWorkflow.mock.calls.at(-1)?.[0]).toEqual({ id: "wf-1", active: true, confirmation: "c3c3c3c3c3c3c3c3" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  })

  it("desativar nunca pede confirmação", async () => {
    service.updateWorkflow.mockResolvedValueOnce({ ...WORKFLOW, active: false })
    renderWithQuery(<ActiveSwitch workflow={{ ...WORKFLOW, active: true }} />)
    fireEvent.click(screen.getByRole("switch", { name: "Desativar workflow" }))
    await waitFor(() => expect(service.updateWorkflow.mock.calls[0]?.[0]).toEqual({ id: "wf-1", active: false, confirmation: undefined }))
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })
})
