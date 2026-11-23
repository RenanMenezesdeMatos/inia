/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { offeredScopeUnits, pickScopeUnit } from "@/components/admin/shared/testing/scope-units-fake"

import { ArgumentScriptCreateForm } from "./argument-script-editor"

// Hierarquia no argumentário novo: universo → área (domínio), escopo (Grupo → Subgrupo) e base de origem.
const fixtures = vi.hoisted(() => ({
  teams: [
    { id: "t1", name: "Atendimento", operationId: "op-1", operatingUniverse: "B2C", subteams: [{ id: "st1", teamId: "t1", name: "Contas", operatingUniverse: "B2C" }] },
    { id: "t2", name: "Grandes Contas", operationId: "op-1", operatingUniverse: "B2B", subteams: [{ id: "st2", teamId: "t2", name: "Corporativo", operatingUniverse: "B2B" }] },
  ],
  domains: [
    { id: "d1", code: "FATURAMENTO", name: "Faturamento", description: null, active: true, operatingUniverse: "B2C", createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z", agentCount: 0, orchestratorCount: 0 },
    { id: "d2", code: "CONTRATOS", name: "Contratos", description: null, active: true, operatingUniverse: "B2B", createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z", agentCount: 0, orchestratorCount: 0 },
  ],
}))

vi.mock("@/services/admin/argument-script-service", () => ({
  fetchArgumentScriptScopeOptions: vi.fn(async () => ({ allTeams: true, teamIds: [], subteamIds: [] })),
  createArgumentScript: vi.fn(),
}))
vi.mock("@/services/scope-units/scope-units-service", async () => (await import("@/components/admin/shared/testing/scope-units-fake")).scopeUnitsServiceFrom(fixtures.teams))
vi.mock("@/services/admin/org-structure-service", () => ({ fetchTeams: vi.fn(async () => fixtures.teams), fetchManageableTeams: vi.fn(), fetchSubjects: vi.fn(async () => []) }))
vi.mock("@/services/admin/business-domain-service", () => ({ fetchBusinessDomains: vi.fn(async () => fixtures.domains) }))
vi.mock("@/services/admin/knowledge-service", () => ({ fetchKnowledgeDocuments: vi.fn(async () => []) }))
vi.mock("@/components/admin/product-catalog/product-scope-field", () => ({
  ProductScopeCard: () => null,
  ProductScopeField: () => null,
  productsCompatibleWith: () => [],
  useSourceProductScope: () => ({ available: false, nodes: [], value: [], setValue: vi.fn(), save: vi.fn(async () => undefined) }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const optionTexts = () => screen.getAllByRole("option").map((option) => option.textContent)

async function chooseUniverse(label: RegExp) {
  fireEvent.click(await screen.findByRole("combobox", { name: /Universo de atuação/ }))
  fireEvent.click(screen.getByRole("option", { name: label }))
}

describe("Novo argumentário — universo encadeia área e escopo", () => {
  it("área e Grupos só do universo escolhido; trocar o universo limpa os dois", async () => {
    renderWithQuery(<ArgumentScriptCreateForm onCreated={vi.fn()} onCancel={vi.fn()} />)
    await chooseUniverse(/^B2B/)

    const area = screen.getByRole("combobox", { name: /Área responsável/ })
    fireEvent.click(area)
    expect(optionTexts()).toEqual(["Contratos"])
    fireEvent.click(screen.getByRole("option", { name: "Contratos" }))

    const scope = screen.getByTestId("argument-script-scope")
    fireEvent.click(within(scope).getByRole("radio", { name: /Grupos e Subgrupos específicos/ }))
    expect(await offeredScopeUnits()).toEqual(["Grandes Contas"])
    await pickScopeUnit("Grandes Contas")
    expect(await within(scope).findByText("Vale para:", { exact: false })).toBeInTheDocument()
    await waitFor(() => expect(within(scope).getByTestId("scope-reach-summary")).toHaveTextContent("Vale para: Grandes Contas (Grupo inteiro)"))

    await chooseUniverse(/^B2C/)
    expect(screen.getByRole("combobox", { name: /Área responsável/ })).toHaveTextContent("Selecione a área")
    // O Grupo de B2B sai do escopo; no B2C só o Grupo do B2C é oferecido.
    await waitFor(() => expect(within(scope).getByTestId("scope-reach-summary")).toHaveTextContent("Vale para: Nenhum Grupo ou Subgrupo escolhido"))
    expect(await offeredScopeUnits()).toEqual(["Atendimento"])
    fireEvent.click(screen.getByRole("combobox", { name: /Área responsável/ }))
    expect(optionTexts()).toEqual(["Faturamento"])
  })
})
