/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"

import { CreateKnowledgePage } from "./knowledge-form-page"

// Hierarquia universo → Grupo → Subgrupo no formulário da base (lib/operating-universe/hierarchy.ts).
vi.mock("@/services/admin/knowledge-service", () => ({
  fetchKnowledgeDocument: vi.fn(),
  fetchKnowledgeDocuments: vi.fn(async () => []),
  createKnowledgeDocument: vi.fn(),
  updateKnowledgeDocument: vi.fn(),
}))
vi.mock("@/services/admin/org-structure-service", () => ({
  fetchTeams: vi.fn(async () => [
    { id: "t1", name: "Atendimento", operationId: "op-1", operatingUniverse: "B2C", subteams: [{ id: "st1", teamId: "t1", name: "Contas", operatingUniverse: "B2C" }] },
    { id: "t2", name: "Grandes Contas", operationId: "op-1", operatingUniverse: "B2B", subteams: [{ id: "st2", teamId: "t2", name: "Corporativo", operatingUniverse: "B2B" }] },
    { id: "t3", name: "Sem classificação", operationId: "op-1", operatingUniverse: null, subteams: [] },
  ]),
  fetchManageableTeams: vi.fn(async () => ({ teams: [], unrestricted: true })),
  fetchSubjects: vi.fn(async () => []),
}))
vi.mock("@/components/admin/product-catalog/product-scope-field", () => ({
  ProductScopeField: () => null,
  productsCompatibleWith: () => [],
  useSourceProductScope: () => ({ available: false, nodes: [], value: [], setValue: vi.fn(), save: vi.fn(async () => undefined) }),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/admin/knowledge/new", useSearchParams: () => new URLSearchParams() }))
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

describe("Nova base — universo encadeia o alcance", () => {
  it("só oferece Grupos classificados no universo escolhido (o sem universo some) e trocar o universo limpa o Grupo que deixou de caber", async () => {
    renderWithQuery(<CreateKnowledgePage />)
    await chooseUniverse(/^B2B/)

    fireEvent.click(await screen.findByRole("combobox", { name: "Alcance por grupo" }))
    fireEvent.click(screen.getByRole("option", { name: "Um grupo específico" }))
    const team = screen.getByRole("combobox", { name: "Grupo" })
    fireEvent.click(team)
    expect(optionTexts()).toEqual(["Grandes Contas"])
    fireEvent.click(screen.getByRole("option", { name: "Grandes Contas" }))
    expect(team).toHaveTextContent("Grandes Contas")

    await chooseUniverse(/^B2C/)
    expect(screen.getByRole("combobox", { name: "Grupo" })).toHaveTextContent("Selecione o grupo")
    fireEvent.click(screen.getByRole("combobox", { name: "Grupo" }))
    expect(optionTexts()).toEqual(["Atendimento"])
  })

  it("o Subgrupo também segue o universo", async () => {
    renderWithQuery(<CreateKnowledgePage />)
    await chooseUniverse(/^B2C/)
    fireEvent.click(await screen.findByRole("combobox", { name: "Alcance por grupo" }))
    fireEvent.click(screen.getByRole("option", { name: "Um subgrupo específico" }))
    fireEvent.click(screen.getByRole("combobox", { name: "Grupo" }))
    expect(optionTexts()).not.toContain("Grandes Contas")
    fireEvent.click(screen.getByRole("option", { name: "Atendimento" }))
    fireEvent.click(screen.getByRole("combobox", { name: "Subgrupo" }))
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((option) => option.textContent)).toEqual(["Contas"])
  })
})
