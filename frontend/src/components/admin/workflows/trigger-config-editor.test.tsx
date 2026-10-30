/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { WorkflowTrigger } from "@/schemas/admin/workflow.schema"

import { TriggerConfigEditor } from "./trigger-fields"

/**
 * Incidente de 2026-10-05: trocar o tipo do gatilho de um Workflow ativo (Manual → Por agenda) reabria o diálogo
 * "Alterar tipo de gatilho" a cada campo preenchido (comparava com o tipo SALVO) e cada confirmação gravava. Aqui:
 * a troca é confirmada UMA vez, os campos do tipo novo não perguntam de novo, e só um gatilho completo é gravado
 * (no rascunho — o backend nunca muda o que roda antes de Publicar).
 */
const mutate = vi.hoisted(() => vi.fn())
vi.mock("@/queries/admin/use-workflow-queries", () => ({
  useUpdateWorkflowTriggerMutation: () => ({ mutate, isPending: false }),
  useSchedulePreviewQuery: () => ({ isLoading: false, data: { mode: "CALENDAR", occurrences: ["2026-11-05T21:30:00.000Z"], catchUpToday: ["2026-10-05T21:30:00.000Z"], timezone: "America/Fortaleza" } }),
}))
vi.mock("@/queries/admin/use-channel-flag-queries", () => ({ useChannelFlagsQuery: () => ({ data: [] }) }))
vi.mock("@/queries/admin/use-indicator-rule-queries", () => ({ useIndicatorsWithRulesQuery: () => ({ data: [] }) }))

const MANUAL: WorkflowTrigger = { kind: "manual", context: "COLLABORATOR" }
const GRAPH = { nodes: [{ id: "trigger", type: "trigger" as const, label: "Gatilho", position: { x: 0, y: 0 }, config: {} }], edges: [] }

beforeAll(() => installJsdomStubs())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderEditor(trigger: WorkflowTrigger = MANUAL) {
  return renderWithQuery(<TriggerConfigEditor trigger={trigger} workflowId="wf-1" graph={GRAPH} consolidatedStructure={null} populationFilter={null} />)
}

describe("TriggerConfigEditor — troca de tipo", () => {
  it("confirma a troca UMA vez; completar os campos da Agenda não reabre o diálogo; só o gatilho completo é gravado", async () => {
    const view = renderEditor()
    fireEvent.click(screen.getByRole("button", { name: /Por agenda/ }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("Manual → Por agenda")
    expect(dialog).toHaveTextContent("A troca fica no rascunho: o workflow publicado continua com o gatilho atual até você Publicar.")
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar troca" }))
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(mutate).not.toHaveBeenCalled() // Agenda sem horário ainda está incompleta

    // Um refetch devolve o MESMO gatilho salvo (outro objeto): a troca em andamento não volta para Manual.
    view.rerender(<TriggerConfigEditor trigger={{ ...MANUAL }} workflowId="wf-1" graph={GRAPH} consolidatedStructure={null} populationFilter={null} />)
    expect(screen.getByText("Nenhum horário adicionado ainda.")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Adicionar horário/ }))
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ kind: "schedule", times: ["09:00"] }))
  })

  it("Cancelar mantém o tipo atual e não grava nada", async () => {
    renderEditor()
    fireEvent.click(screen.getByRole("button", { name: /Por agenda/ }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }))
    expect(screen.queryByText("Modo da agenda")).not.toBeInTheDocument()
    expect(mutate).not.toHaveBeenCalled()
  })

  it("acessibilidade: o tipo de gatilho é um grupo com nome e diz qual está escolhido; os dias da semana também têm nome", () => {
    const view = renderEditor()
    const kinds = screen.getByRole("group", { name: "Tipo de gatilho" })
    expect(within(kinds).getByRole("button", { name: /Manual/ })).toHaveAttribute("aria-pressed", "true")
    expect(within(kinds).getByRole("button", { name: /Por agenda/ })).toHaveAttribute("aria-pressed", "false")
    view.unmount()
    renderEditor({ kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1, frequency: { type: "WEEKLY", weekdays: ["MON"] } })
    // ToggleGroup de múltipla escolha = toolbar do Radix (cada dia já diz se está marcado); agora com o nome do rótulo.
    const weekdays = screen.getByRole("toolbar", { name: "Dias da semana" })
    expect(within(weekdays).getByRole("button", { name: "Seg" })).toHaveAttribute("aria-pressed", "true")
  })

  it("a prévia da Agenda avisa quando o horário de hoje já passou (entrar no ar hoje dispara na hora)", () => {
    renderEditor({ kind: "schedule", mode: "CALENDAR", times: ["18:30"], intervalDays: 1, frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 5 } })
    expect(screen.getByTestId("schedule-preview-catch-up")).toHaveTextContent("já passou: se este gatilho entrar no ar hoje (ao publicar ou ativar), essa execução começa em até 1 minuto")
  })
})
