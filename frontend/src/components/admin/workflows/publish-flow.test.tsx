/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { AdminApiError } from "@/lib/admin/admin-api"
import type { GoLiveImpact, Workflow } from "@/schemas/admin/workflow.schema"

import { GoLiveImpactDialog } from "./go-live-impact-dialog"
import { publishNeedsDialog, usePublishFlow } from "./use-publish-flow"
import { describeConfigurationChanges } from "./workflow-configuration-summary"

/**
 * Publicar com a configuração do rascunho: a prévia do impacto decide se abre o diálogo; quando a Agenda dispararia
 * na hora (o incidente de 2026-10-05: 2.264 execuções em 1 minuto) o diálogo mostra a contagem e o primeiro disparo e
 * só publica com o "entendi" marcado — mandando o fingerprint do impacto mostrado.
 */
const service = vi.hoisted(() => ({ fetchPublishImpact: vi.fn(), publishWorkflow: vi.fn() }))
vi.mock("@/services/admin/workflow-service", () => service)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const PUBLISHED_MANUAL: Workflow = {
  id: "wf-1",
  name: "Feedback de indicador",
  description: null,
  scopeType: "ALL_TEAMS",
  teamId: null,
  teamName: null,
  subteamId: null,
  subteamName: null,
  active: true,
  createdAt: "2026-10-01T10:00:00Z",
  published: true,
  trigger: { kind: "manual", context: "COLLABORATOR" },
  activeEnrollments: 0,
  consolidatedStructure: null,
  populationFilter: null,
  draftConfiguration: {
    trigger: { kind: "schedule", mode: "CALENDAR", times: ["18:30"], intervalDays: 1, frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 5 } },
    scopeType: "ALL_TEAMS",
    teamId: null,
    teamName: null,
    subteamId: null,
    subteamName: null,
    consolidatedStructure: null,
    populationFilter: null,
  },
  configurationChanges: ["TRIGGER"],
}

const INCIDENT_IMPACT: GoLiveImpact = {
  reason: "PUBLISH",
  triggerKind: "schedule",
  goesLive: true,
  firstPublication: false,
  configurationChanges: ["TRIGGER"],
  schedule: {
    mode: "CALENDAR",
    evaluation: "INDIVIDUAL",
    population: 2264,
    enrollmentsPerOccurrence: 2264,
    immediate: { enrollments: 2264, alreadyEnrolled: 0, scheduledFor: ["2026-10-05T21:30:00.000Z"] },
    firstFireAt: "2026-10-05T21:30:00.000Z",
    firesImmediately: true,
    timezone: "America/Fortaleza",
  },
  requiresConfirmation: true,
  reasons: ["IMMEDIATE_CATCH_UP", "LARGE_POPULATION"],
  threshold: 50,
  fingerprint: "f1f1f1f1f1f1f1f1",
}

beforeAll(() => installJsdomStubs())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** O mesmo arranjo do rodapé do editor: botão Publicar + diálogo do fluxo. */
function PublishHarness({ workflow }: { workflow: Workflow }) {
  const flow = usePublishFlow(workflow.id)
  return (
    <>
      <button type="button" onClick={() => void flow.start()}>
        Publicar workflow
      </button>
      <GoLiveImpactDialog
        key={flow.dialog?.impact.fingerprint ?? "none"}
        open={flow.dialog !== null}
        onOpenChange={(open) => !open && flow.close()}
        impact={flow.dialog?.impact ?? null}
        impactChanged={flow.dialog?.impactChanged ?? false}
        changes={flow.dialog ? describeConfigurationChanges(workflow, flow.dialog.impact.configurationChanges) : []}
        pending={flow.isPending}
        onConfirm={(fingerprint) => void flow.confirm(fingerprint)}
      />
    </>
  )
}

describe("publicação com impacto", () => {
  it("o incidente: mostra Manual → Agenda, as 2.264 execuções imediatas e o horário; só publica com o 'entendi', levando o fingerprint", async () => {
    service.fetchPublishImpact.mockResolvedValue(INCIDENT_IMPACT)
    service.publishWorkflow.mockResolvedValue({ ...PUBLISHED_MANUAL, trigger: PUBLISHED_MANUAL.draftConfiguration!.trigger, configurationChanges: [] })
    renderWithQuery(<PublishHarness workflow={PUBLISHED_MANUAL} />)

    fireEvent.click(screen.getByRole("button", { name: "Publicar workflow" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(service.publishWorkflow).not.toHaveBeenCalled()
    expect(within(dialog).getByTestId("go-live-impact-changes")).toHaveTextContent("Gatilho: Manual · Colaborador → Agenda · Todo dia 5 às 18:30")
    expect(within(dialog).getByTestId("go-live-impact-schedule")).toHaveTextContent("2.264 colaboradores elegíveis")
    expect(within(dialog).getByTestId("go-live-impact-immediate")).toHaveTextContent("Dispara agora: 2.264 execuções começam em até 1 minuto. O horário de hoje (18:30) já passou")

    const confirm = within(dialog).getByRole("button", { name: "Publicar" })
    expect(confirm).toBeDisabled()
    fireEvent.click(within(dialog).getByRole("checkbox"))
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(service.publishWorkflow).toHaveBeenCalledWith("wf-1", "f1f1f1f1f1f1f1f1"))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  })

  it("impacto mudou entre a prévia e o clique: o 409 reabre o diálogo com os números novos e pede o 'entendi' de novo", async () => {
    service.fetchPublishImpact.mockResolvedValue(INCIDENT_IMPACT)
    const changed: GoLiveImpact = { ...INCIDENT_IMPACT, schedule: { ...INCIDENT_IMPACT.schedule!, population: 2265, immediate: { ...INCIDENT_IMPACT.schedule!.immediate, enrollments: 2265 } }, fingerprint: "a2a2a2a2a2a2a2a2" }
    service.publishWorkflow.mockRejectedValueOnce(new AdminApiError("O impacto mudou desde a confirmação.", "WORKFLOW_PUBLISH_CONFIRMATION_REQUIRED", { impact: changed }))
    renderWithQuery(<PublishHarness workflow={PUBLISHED_MANUAL} />)

    fireEvent.click(screen.getByRole("button", { name: "Publicar workflow" }))
    let dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("checkbox"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Publicar" }))

    await waitFor(() => expect(screen.getByRole("alertdialog")).toHaveTextContent("O impacto mudou desde a prévia"))
    dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByTestId("go-live-impact-immediate")).toHaveTextContent("2.265 execuções")
    expect(within(dialog).getByRole("button", { name: "Publicar" })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole("checkbox"))
    service.publishWorkflow.mockResolvedValueOnce(PUBLISHED_MANUAL)
    fireEvent.click(within(dialog).getByRole("button", { name: "Publicar" }))
    await waitFor(() => expect(service.publishWorkflow).toHaveBeenLastCalledWith("wf-1", "a2a2a2a2a2a2a2a2"))
  })

  it("republicar só o fluxo (sem mudança de configuração nem impacto) publica direto, sem diálogo", async () => {
    service.fetchPublishImpact.mockResolvedValue({ ...INCIDENT_IMPACT, triggerKind: "manual", configurationChanges: [], schedule: null, requiresConfirmation: false, reasons: [] })
    service.publishWorkflow.mockResolvedValue(PUBLISHED_MANUAL)
    renderWithQuery(<PublishHarness workflow={{ ...PUBLISHED_MANUAL, draftConfiguration: undefined, configurationChanges: [] }} />)
    fireEvent.click(screen.getByRole("button", { name: "Publicar workflow" }))
    await waitFor(() => expect(service.publishWorkflow).toHaveBeenCalledWith("wf-1", undefined))
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })

  it("quando abrir o diálogo", () => {
    const quiet: GoLiveImpact = { ...INCIDENT_IMPACT, configurationChanges: [], schedule: null, requiresConfirmation: false, reasons: [] }
    expect(publishNeedsDialog(quiet)).toBe(false)
    expect(publishNeedsDialog({ ...quiet, configurationChanges: ["SCOPE"] })).toBe(true) // configuração vai mudar: mostra o que muda
    expect(publishNeedsDialog({ ...quiet, firstPublication: true, schedule: { ...INCIDENT_IMPACT.schedule!, firesImmediately: false } })).toBe(true) // 1ª Agenda: quando dispara
    expect(publishNeedsDialog({ ...quiet, requiresConfirmation: true })).toBe(true)
  })

  it("Workflow inativo: publicar uma Agenda não põe nada no ar e o diálogo diz isso", async () => {
    service.fetchPublishImpact.mockResolvedValue({ ...INCIDENT_IMPACT, goesLive: false, schedule: null, requiresConfirmation: false, reasons: [] })
    renderWithQuery(<PublishHarness workflow={{ ...PUBLISHED_MANUAL, active: false }} />)
    fireEvent.click(screen.getByRole("button", { name: "Publicar workflow" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("O workflow está desativado: nada roda ao publicar")
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Publicar" })).toBeEnabled()
  })
})
