/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"

import { CreateKnowledgePage } from "./knowledge-form-page"

// Hierarquia universo → Grupo → Subgrupo no formulário da base (lib/operating-universe/hierarchy.ts).
const knowledgeService = vi.hoisted(() => ({
  fetchKnowledgeDocument: vi.fn(),
  fetchKnowledgeDocuments: vi.fn(async () => []),
  createKnowledgeDocument: vi.fn(),
  updateKnowledgeDocument: vi.fn(),
  fetchKnowledgeSubjects: vi.fn(async () => ({ items: [{ id: "s1", code: "segunda_via", name: "Segunda via", active: true }], canCreate: true })),
  createKnowledgeSubject: vi.fn(),
  fetchKnowledgeUploadRun: vi.fn(async () => null),
  fetchRecentKnowledgeUploads: vi.fn(async () => []),
}))
vi.mock("@/services/admin/knowledge-service", () => knowledgeService)
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
  useProductScopeLabels: () => ({ available: false, labelsOf: () => [], pendingOf: () => null }),
  useSourceProductScope: () => ({ available: false, nodes: [], value: [], setValue: vi.fn(), changed: false, saving: false, save: vi.fn(async () => undefined) }),
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

async function chooseSpecificGroups() {
  fireEvent.click(await screen.findByRole("radio", { name: "Grupos específicos" }))
}

async function addGroup(name: string) {
  fireEvent.click(await screen.findByRole("combobox", { name: "Adicionar Grupo" }))
  fireEvent.click(screen.getByRole("option", { name }))
}

describe("Nova base — universo encadeia o alcance", () => {
  it("só oferece Grupos classificados no universo escolhido (o sem universo some) e trocar o universo limpa o Grupo que deixou de caber", async () => {
    renderWithQuery(<CreateKnowledgePage />)
    await chooseUniverse(/^B2B/)

    await chooseSpecificGroups()
    fireEvent.click(screen.getByRole("combobox", { name: "Adicionar Grupo" }))
    expect(optionTexts()).toEqual(["Grandes Contas"])
    fireEvent.click(screen.getByRole("option", { name: "Grandes Contas" }))
    expect(screen.getByTestId("scope-reach-summary")).toHaveTextContent("Vale para: Grandes Contas (Grupo inteiro)")

    await chooseUniverse(/^B2C/)
    expect(screen.queryByTestId("scope-group-t2")).toBeNull()
    expect(screen.getByTestId("scope-reach-summary")).toHaveTextContent("Vale para: Nenhum Grupo escolhido")
    fireEvent.click(screen.getByRole("combobox", { name: "Adicionar Grupo" }))
    expect(optionTexts()).toEqual(["Atendimento"])
  })

  it("o Subgrupo também segue o universo", async () => {
    renderWithQuery(<CreateKnowledgePage />)
    await chooseUniverse(/^B2C/)
    await chooseSpecificGroups()
    fireEvent.click(screen.getByRole("combobox", { name: "Adicionar Grupo" }))
    expect(optionTexts()).not.toContain("Grandes Contas")
    fireEvent.click(screen.getByRole("option", { name: "Atendimento" }))
    fireEvent.click(within(screen.getByTestId("scope-group-t1")).getByRole("radio", { name: "Só alguns Subgrupos" }))
    expect(within(screen.getByTestId("scope-group-t1")).getAllByRole("checkbox").map((box) => box.closest("label")?.textContent)).toEqual(["Contas"])
  })

  it("vários Grupos: um inteiro e outro só com um Subgrupo viram um alcance por vínculo no envio", async () => {
    knowledgeService.createKnowledgeDocument.mockResolvedValue({ id: "k-1" })
    renderWithQuery(<CreateKnowledgePage />)
    fireEvent.change(await screen.findByLabelText("Título da base"), { target: { value: "Segunda via" } })
    fireEvent.change(screen.getByLabelText("Conteúdo"), { target: { value: "Procedimento completo de segunda via." } })
    await chooseSpecificGroups()
    await addGroup("Atendimento")
    await addGroup("Grandes Contas")
    fireEvent.click(within(screen.getByTestId("scope-group-t2")).getByRole("radio", { name: "Só alguns Subgrupos" }))
    // Recorte por Subgrupo sem nenhum marcado: salvar mostra o que falta e não envia nada.
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/Marque ao menos um Subgrupo/)
    expect(knowledgeService.createKnowledgeDocument).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("checkbox", { name: "Corporativo" }))
    expect(screen.getByTestId("scope-reach-summary")).toHaveTextContent("Vale para: Atendimento (Grupo inteiro) · Grandes Contas: só Corporativo")
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }))
    await waitFor(() => expect(knowledgeService.createKnowledgeDocument).toHaveBeenCalledTimes(1))
    expect(knowledgeService.createKnowledgeDocument.mock.calls[0]![0].orgScopes).toEqual([
      { scopeType: "TEAM", teamId: "t1" },
      { scopeType: "SUBTEAM", teamId: "t2", subteamId: "st2" },
    ])
    expect(knowledgeService.createKnowledgeDocument.mock.calls[0]![0].subjectScopes).toEqual([{ scopeType: "ALL_SUBJECTS" }])
  })
})
