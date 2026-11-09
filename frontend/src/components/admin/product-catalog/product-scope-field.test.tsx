/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { ProductNode, ProductScopeSource } from "@/schemas/admin/product-catalog.schema"

import { ProductScopeCard } from "./product-scope-field"

const service = vi.hoisted(() => ({ fetchProductNodes: vi.fn(), fetchProductScopeSources: vi.fn(), setProductScope: vi.fn() }))
vi.mock("@/services/admin/product-catalog-service", () => service)
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

// Exemplos FICTÍCIOS de teste.
const node = (id: string, name: string, kind: ProductNode["kind"] = "PRODUCT", parentId: string | null = null): ProductNode => ({ id, kind, code: id.toUpperCase(), name, description: null, parentId, active: true, archivedAt: null, createdAt: "", updatedAt: "", criteriaCount: 0, scopeCount: 0, childCount: 0, inUse: false, blocksDeletion: false })
const NODES = [node("f1", "Voz corporativa", "FAMILY"), node("p1", "Tronco de voz", "PRODUCT", "f1"), node("p2", "Ramal direto", "PRODUCT", "f1")]
const source = (sourceId: string, nodeIds: string[] | null): ProductScopeSource => ({ sourceKind: "ARGUMENT_SCRIPT", sourceId, title: sourceId, status: "ACTIVE", scope: nodeIds ? { assignmentId: `a-${sourceId}`, nodeIds, since: "2026-10-21T00:00:00.000Z" } : null })

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("\"Vale para\" no editor da base e do argumentário", () => {
  it("base geral: mostra \"Todos os produtos\"; passar a valer só para alguns grava a partir de agora", async () => {
    service.fetchProductNodes.mockResolvedValue(NODES)
    service.fetchProductScopeSources.mockResolvedValue([source("s1", null)])
    service.setProductScope.mockResolvedValue({ sourceKind: "ARGUMENT_SCRIPT", sourceId: "s1", title: "s1", history: [] })
    renderWithQuery(<ProductScopeCard kind="ARGUMENT_SCRIPT" sourceId="s1" canEdit />)
    const card = await screen.findByTestId("product-scope-card")
    expect(card).toHaveTextContent("Todos os produtos")
    fireEvent.click(within(card).getByRole("button", { name: "Alterar" }))
    fireEvent.click(within(card).getByRole("radio", { name: "Só para alguns produtos" }))
    expect(within(card).getByRole("button", { name: "Salvar" })).toBeDisabled()
    fireEvent.click(within(card).getByLabelText(/Tronco de voz/))
    fireEvent.click(within(card).getByLabelText(/Ramal direto/))
    fireEvent.click(within(card).getByRole("button", { name: "Salvar" }))
    await waitFor(() => expect(service.setProductScope.mock.calls[0]?.[0]).toEqual({ kind: "ARGUMENT_SCRIPT", id: "s1", nodeIds: ["p1", "p2"] }))
  })

  it("base de um produto: mostra o produto; voltar para todos grava a lista vazia (geral)", async () => {
    service.fetchProductNodes.mockResolvedValue(NODES)
    service.fetchProductScopeSources.mockResolvedValue([source("s1", ["p1"])])
    service.setProductScope.mockResolvedValue({ sourceKind: "ARGUMENT_SCRIPT", sourceId: "s1", title: "s1", history: [] })
    renderWithQuery(<ProductScopeCard kind="ARGUMENT_SCRIPT" sourceId="s1" canEdit />)
    const card = await screen.findByTestId("product-scope-card")
    expect(card).toHaveTextContent("Tronco de voz")
    fireEvent.click(within(card).getByRole("button", { name: "Alterar" }))
    fireEvent.click(within(card).getByRole("radio", { name: "Todos os produtos" }))
    fireEvent.click(within(card).getByRole("button", { name: "Salvar" }))
    await waitFor(() => expect(service.setProductScope.mock.calls[0]?.[0]).toEqual({ kind: "ARGUMENT_SCRIPT", id: "s1", nodeIds: [] }))
  })

  it("base de conhecimento: salvar fica no rascunho, o valor em uso não muda na tela e a mensagem diz quando vale", async () => {
    const base = (pendingScope: ProductScopeSource["pendingScope"]): ProductScopeSource => ({ ...source("b1", ["p1"]), sourceKind: "KNOWLEDGE_DOCUMENT", pendingScope })
    service.fetchProductNodes.mockResolvedValue(NODES)
    service.fetchProductScopeSources.mockResolvedValue([base({ version: 3, status: "DRAFT", nodeIds: ["p2"] })])
    service.setProductScope.mockResolvedValue({ sourceKind: "KNOWLEDGE_DOCUMENT", sourceId: "b1", title: "b1", history: [], pending: { version: 3, nodeIds: [] } })
    renderWithQuery(<ProductScopeCard kind="KNOWLEDGE_DOCUMENT" sourceId="b1" canEdit />)
    const card = await screen.findByTestId("product-scope-card")
    // Em uso e rascunho nunca se misturam: o selo é o que vale; a escolha pendente fica à parte, dita como sem efeito.
    expect(within(card).getByText("Tronco de voz")).toBeInTheDocument()
    expect(within(card).getByTestId("product-scope-pending")).toHaveTextContent("Rascunho V3, ainda sem efeito: Ramal direto.")
    // A edição parte do rascunho, e o aviso é o da versão, não "a partir de agora".
    fireEvent.click(within(card).getByRole("button", { name: "Alterar" }))
    expect(within(card).getByText(/Fica no rascunho e só passa a valer quando a versão entrar em uso/)).toBeInTheDocument()
    expect(within(card).queryByText(/Vale a partir de agora/)).not.toBeInTheDocument()
    fireEvent.click(within(card).getByRole("radio", { name: "Todos os produtos" }))
    fireEvent.click(within(card).getByRole("button", { name: "Salvar" }))
    await waitFor(() => expect(service.setProductScope.mock.calls[0]?.[0]).toEqual({ kind: "KNOWLEDGE_DOCUMENT", id: "b1", nodeIds: [] }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Produtos salvos no rascunho V3. Só valem quando a versão entrar em uso."))
  })

  it("argumentário: continua valendo a partir de agora", async () => {
    service.fetchProductNodes.mockResolvedValue(NODES)
    service.fetchProductScopeSources.mockResolvedValue([source("s1", ["p1"])])
    service.setProductScope.mockResolvedValue({ sourceKind: "ARGUMENT_SCRIPT", sourceId: "s1", title: "s1", history: [] })
    renderWithQuery(<ProductScopeCard kind="ARGUMENT_SCRIPT" sourceId="s1" canEdit />)
    const card = await screen.findByTestId("product-scope-card")
    fireEvent.click(within(card).getByRole("button", { name: "Alterar" }))
    expect(within(card).getByText(/Vale a partir de agora/)).toBeInTheDocument()
    fireEvent.click(within(card).getByRole("radio", { name: "Todos os produtos" }))
    fireEvent.click(within(card).getByRole("button", { name: "Salvar" }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Produtos da base atualizados."))
  })

  it("sem produto cadastrado (ou sem acesso ao cadastro) o campo não aparece; sem permissão de editar, só mostra", async () => {
    service.fetchProductNodes.mockResolvedValue([])
    service.fetchProductScopeSources.mockResolvedValue([])
    const { unmount } = renderWithQuery(<ProductScopeCard kind="ARGUMENT_SCRIPT" sourceId="s1" canEdit />)
    await waitFor(() => expect(service.fetchProductNodes).toHaveBeenCalled())
    expect(screen.queryByTestId("product-scope-card")).not.toBeInTheDocument()
    unmount()
    service.fetchProductNodes.mockResolvedValue(NODES)
    service.fetchProductScopeSources.mockResolvedValue([source("s1", ["p2"])])
    renderWithQuery(<ProductScopeCard kind="ARGUMENT_SCRIPT" sourceId="s1" canEdit={false} />)
    const card = await screen.findByTestId("product-scope-card")
    expect(card).toHaveTextContent("Ramal direto")
    expect(within(card).queryByRole("button", { name: "Alterar" })).not.toBeInTheDocument()
  })
})
