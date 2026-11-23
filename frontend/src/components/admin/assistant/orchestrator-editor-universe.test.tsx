/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import type { ReactNode } from "react"
import { cleanup, fireEvent, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import type { Agent } from "@/schemas/admin/agent.schema"

import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { NewOrchestratorPage } from "./orchestrator-editor-page"

/**
 * Hierarquia universo → agentes no Orquestrador: escolhido o universo, só agentes dele (ou ainda sem universo) são oferecidos;
 * trocar o universo limpa o agente orquestrador que deixou de caber. O backend recusa a mistura (OPERATING_UNIVERSE_LINK_CONFLICT).
 */
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
vi.mock("@/services/scope-units/scope-units-service", async () => (await import("@/components/admin/shared/testing/scope-units-fake")).scopeUnitsServiceFrom([]))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }))
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ReactFlowProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
}))

const COORDINATOR: Agent = {
  id: "agent-orch",
  name: "Coordenação · Contas",
  agentType: "ORCHESTRATOR",
  objective: "Coordenar",
  description: "Coordena especialistas",
  contextPrompt: "Você coordena.",
  active: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  createdByName: "Admin",
  usageCount: 3,
  scopeType: "ALL_TEAMS",
  teamId: null,
  teamName: null,
  subteamId: null,
  subteamName: null,
  knowledgeDocuments: [],
  actionLimitsEnabled: false,
  actionLimits: null,
  specialty: null,
  specialtyKind: null,
  domain: null,
  businessDomainId: null,
  businessDomain: null,
  capability: null,
  consolidatedInput: false,
  recommendSupportMaterials: false,
  investigationCapabilities: [],
  currentVersionId: "v1",
  currentVersionNumber: 1,
  currentVersionPublishedAt: null,
  published: true,
  hasDraft: false,
  draftRevision: 0,
  draftUpdatedAt: null,
  draftUpdatedByName: null,
  draft: null,
}
const B2B_COORDINATOR: Agent = { ...COORDINATOR, id: "agent-b2b", name: "Coordenação Empresas", operatingUniverse: "B2B" }
const B2C_COORDINATOR: Agent = { ...COORDINATOR, id: "agent-b2c", name: "Coordenação Consumidor", operatingUniverse: "B2C" }
const PENDING_COORDINATOR: Agent = { ...COORDINATOR, id: "agent-pending", name: "Coordenação Pendente", operatingUniverse: null }

// Dados ESTÁVEIS entre renders, como os do React Query.
const AGENTS = [B2B_COORDINATOR, B2C_COORDINATOR, PENDING_COORDINATOR]
const MANAGEABLE_TEAMS = { teams: [], unrestricted: true }
const DOMAINS: never[] = []
vi.mock("@/queries/admin/use-agent-queries", () => ({ useAgentsQuery: () => ({ data: AGENTS }) }))
vi.mock("@/queries/admin/use-org-structure-queries", () => ({ useManageableTeamsQuery: () => ({ data: MANAGEABLE_TEAMS }) }))
vi.mock("@/queries/admin/use-business-domain-queries", () => ({ useBusinessDomainsQuery: () => ({ data: DOMAINS, isPending: false }) }))
vi.mock("@/queries/admin/use-assistant-queries", () => ({
  useCreateOrchestratorMutation: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  useUpdateOrchestratorMutation: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  useToggleOrchestratorActiveMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteOrchestratorMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOrchestratorQuery: () => ({ data: null, isLoading: false, isError: true, refetch: vi.fn() }),
  useStructuredOutputUsageQuery: () => ({ data: undefined, refetch: vi.fn() }),
  useOrchestratorVersionsQuery: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}))

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(cleanup)

async function chooseUniverse(name: RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: "Universo de atuação" }))
  fireEvent.click(await screen.findByRole("option", { name }))
}

describe("Orquestrador — universo encadeia os agentes", () => {
  it("escolhido B2B, o agente B2C não é oferecido; trocar para B2C limpa o agente B2B escolhido", async () => {
    renderWithQuery(<NewOrchestratorPage />)
    await chooseUniverse(/^B2B/)
    expect(screen.getByRole("button", { name: /Coordenação Empresas/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Coordenação Pendente/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Coordenação Consumidor/ })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /Coordenação Empresas/ }))
    await chooseUniverse(/^B2C/)
    expect(screen.queryByRole("button", { name: /Coordenação Empresas/ })).toBeNull()
    expect(screen.getByRole("button", { name: /Coordenação Consumidor/ })).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Buscar agente...")).toBeInTheDocument()
  })
})
