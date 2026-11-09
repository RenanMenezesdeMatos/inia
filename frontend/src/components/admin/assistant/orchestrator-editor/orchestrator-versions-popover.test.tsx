/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { OrchestratorVersion } from "@/schemas/admin/assistant.schema"

import { OrchestratorVersionsPopover } from "./orchestrator-versions-popover"

/**
 * Versões do orquestrador (PEN-076, revisão de 03/11/2026): guardam a configuração; os agentes rodam sempre na versão vigente. A
 * versão de agente gravada nas versões antigas aparece só como registro da época.
 */
const service = vi.hoisted(() => ({ fetchOrchestratorVersions: vi.fn() }))
vi.mock("@/services/admin/assistant-service", () => service)

const VERSIONS: OrchestratorVersion[] = [
  {
    id: "ov-3",
    number: 3,
    origin: "PUBLISH",
    publishedAt: "2026-11-03T12:00:00.000Z",
    publishedByName: "Bruna Lima",
    current: true,
    orchestratorAgentVersionNumber: null,
    specialists: [{ agentId: "a-fat", agentName: "Especialista de Faturamento", agentVersionId: null, agentVersionNumber: null }],
  },
  {
    id: "ov-2",
    number: 2,
    origin: "PUBLISH",
    publishedAt: "2026-10-30T12:00:00.000Z",
    publishedByName: "Bruna Lima",
    current: false,
    orchestratorAgentVersionNumber: 4,
    specialists: [{ agentId: "a-fat", agentName: "Especialista de Faturamento", agentVersionId: "av-2", agentVersionNumber: 2 }],
  },
]

beforeAll(() => installJsdomStubs())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Versões do orquestrador", () => {
  it("explica que a versão guarda a configuração e que os agentes rodam na vigente; versão de agente antiga é só registro da época", async () => {
    service.fetchOrchestratorVersions.mockResolvedValue(VERSIONS)
    renderWithQuery(<OrchestratorVersionsPopover orchestratorId="orq-1" />)
    fireEvent.click(screen.getByRole("button", { name: /Versões/ }))

    expect(await screen.findByTestId("orchestrator-versions-explanation")).toHaveTextContent(
      "O agente orquestrador e os especialistas rodam sempre na versão vigente de cada um.",
    )
    const [current, previous] = await screen.findAllByTestId("orchestrator-version-specialists")
    expect(current).toHaveTextContent("Especialista de Faturamento")
    expect(current).not.toHaveTextContent(/versão/)
    expect(previous).toHaveTextContent("Agente orquestrador · versão 4 registrada na época")
    expect(previous).toHaveTextContent("Especialista de Faturamento · versão 2 registrada na época")
    expect(screen.queryByText(/fixou/)).toBeNull()
  })
})
