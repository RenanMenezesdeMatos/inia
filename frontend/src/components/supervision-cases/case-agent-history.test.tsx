/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"

import { CaseAgentHistory } from "./case-agent-history"

const service = vi.hoisted(() => ({ fetchCaseAgentRecords: vi.fn() }))
vi.mock("@/services/supervision-cases/case-agent-records-service", () => service)

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Ver histórico deste caso (PEN-071)", () => {
  it("lista a execução que gerou o caso com a versão, a origem e 'Agente inativo' — sem link para o cadastro", async () => {
    service.fetchCaseAgentRecords.mockResolvedValue([
      { id: "run-1", agentId: "a-mon", agentName: "Monitoria de rechamada", agentActive: false, status: "COMPLETED", source: "WORKFLOW", createdAt: "2026-11-03T12:00:00.000Z", completedAt: "2026-11-03T12:00:05.000Z", agentVersionNumber: 2, runTarget: "VERSION" },
    ])
    renderWithQuery(<CaseAgentHistory caseId="case-1" />)
    expect(service.fetchCaseAgentRecords).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Ver histórico deste caso" }))
    const [record] = await screen.findAllByTestId("case-agent-record")
    expect(service.fetchCaseAgentRecords).toHaveBeenCalledWith("case-1")
    expect(within(record!).getByText("Monitoria de rechamada")).toBeInTheDocument()
    expect(within(record!).getByText("Versão 2 · Workflow de automação")).toBeInTheDocument()
    expect(within(record!).getByText("Concluída")).toBeInTheDocument()
    expect(within(record!).getByText("Agente inativo")).toBeInTheDocument()
    expect(within(record!).queryByRole("link")).toBeNull()
  })

  it("sem execução de agente ligada ao caso, diz isso", async () => {
    service.fetchCaseAgentRecords.mockResolvedValue([])
    renderWithQuery(<CaseAgentHistory caseId="case-2" />)
    fireEvent.click(screen.getByRole("button", { name: "Ver histórico deste caso" }))
    expect(await screen.findByText("Nenhuma execução de agente registrada para este caso.")).toBeInTheDocument()
  })
})
