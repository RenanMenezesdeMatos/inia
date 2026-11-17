/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { KnowledgeDocument } from "@/schemas/admin/knowledge.schema"

import { NewAgentPage } from "./agent-detail-page"

/**
 * Hierarquia universo → Grupo → bases/domínio no cadastro de agente: escolhido o universo, só se oferecem Grupos, bases e domínios dele
 * (ou ainda sem universo); trocar o universo limpa o que deixou de caber. O backend continua recusando (OPERATING_UNIVERSE_LINK_CONFLICT).
 */
vi.mock("@/services/admin/agent-service", () => ({ fetchAgent: vi.fn(), createAgent: vi.fn(), fetchAgents: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function doc(id: string, title: string, operatingUniverse: KnowledgeDocument["operatingUniverse"]): KnowledgeDocument {
  return {
    id, title, operatingUniverse, documentType: "PROCEDURE", sourceType: "TEXT", originalFilename: null, mimeType: null, fileSizeBytes: null, createdAt: "2026-11-01", updatedAt: null,
    authorName: null, status: "ACTIVE", inUseVersion: 1, draftVersion: null, updateVersion: null, updateStatus: null, excerpt: null, orgScopes: [], subjectScopes: [],
  } as unknown as KnowledgeDocument
}

// Resultados estáveis entre renderizações, como os do React Query.
const lookups = vi.hoisted(() => ({
  teams: {
    data: {
      unrestricted: true,
      teams: [
        { id: "team-b2b", name: "Grandes Contas", operationId: "op", operatingUniverse: "B2B", subteams: [] },
        { id: "team-b2c", name: "Varejo", operationId: "op", operatingUniverse: "B2C", subteams: [] },
      ],
    },
  },
  knowledge: { data: [] as KnowledgeDocument[] },
  domains: { data: [], isPending: false },
}))
lookups.knowledge.data = [doc("kb-b2b", "Base Empresas", "B2B"), doc("kb-b2c", "Base Consumidor", "B2C"), doc("kb-pending", "Base Pendente", null)]
vi.mock("@/queries/admin/use-org-structure-queries", () => ({ useManageableTeamsQuery: () => lookups.teams }))
vi.mock("@/queries/admin/use-knowledge-queries", () => ({ useKnowledgeDocumentsQuery: () => lookups.knowledge }))
vi.mock("@/queries/admin/use-business-domain-queries", () => ({ useBusinessDomainsQuery: () => lookups.domains }))

beforeAll(() => installJsdomStubs())
afterEach(cleanup)

async function chooseUniverse(name: RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: "Universo de atuação" }))
  fireEvent.click(await screen.findByRole("option", { name }))
}

describe("Agente — universo encadeia Grupo e bases", () => {
  it("escolhido B2B, a base B2C não é oferecida; trocar para B2C tira a base B2B já escolhida", async () => {
    renderWithQuery(<NewAgentPage />)
    await chooseUniverse(/^B2B/)
    expect(screen.getByRole("button", { name: /Base Empresas/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Base Pendente/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Base Consumidor/ })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /Base Empresas/ }))
    await chooseUniverse(/^B2C/)
    expect(screen.queryByRole("button", { name: /Base Empresas/ })).toBeNull()
    expect(screen.getByRole("button", { name: /Base Consumidor/ })).toBeInTheDocument()
  })

  it("o Grupo de outro universo some do alcance e a troca de universo limpa o Grupo escolhido", async () => {
    renderWithQuery(<NewAgentPage />)
    await chooseUniverse(/^B2B/)
    fireEvent.click(screen.getByRole("combobox", { name: "Alcance por grupo" }))
    fireEvent.click(await screen.findByRole("option", { name: "Um grupo específico" }))
    fireEvent.click(screen.getByRole("combobox", { name: "Grupo" }))
    expect(await screen.findByRole("option", { name: "Grandes Contas" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Varejo" })).toBeNull()
    fireEvent.click(screen.getByRole("option", { name: "Grandes Contas" }))
    expect(screen.getByRole("combobox", { name: "Grupo" })).toHaveTextContent("Grandes Contas")

    await chooseUniverse(/^B2C/)
    expect(screen.getByRole("combobox", { name: "Grupo" })).toHaveTextContent("Selecione o grupo")
  })
})
