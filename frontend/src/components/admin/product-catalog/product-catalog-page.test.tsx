/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { AdminApiError } from "@/lib/admin/admin-api"
import type { IdentificationCriterion, ProductNode, ProductScopeSource } from "@/schemas/admin/product-catalog.schema"

import { ProductCatalogPage } from "./product-catalog-page"

const service = vi.hoisted(() => ({
  fetchProductNodes: vi.fn(),
  createProductNode: vi.fn(),
  updateProductNode: vi.fn(),
  setProductNodeActive: vi.fn(),
  deleteProductNode: vi.fn(),
  fetchIdentificationCriteria: vi.fn(),
  fetchIdentificationCriterion: vi.fn(),
  createIdentificationCriterion: vi.fn(),
  updateIdentificationCriterion: vi.fn(),
  approveIdentificationCriterion: vi.fn(),
  discardIdentificationDraft: vi.fn(),
  archiveIdentificationCriterion: vi.fn(),
  reactivateIdentificationCriterion: vi.fn(),
  deleteIdentificationCriterion: vi.fn(),
  fetchProductScopeSources: vi.fn(),
  fetchProductScopeHistory: vi.fn(),
  setProductScope: vi.fn(),
}))
vi.mock("@/services/admin/product-catalog-service", () => service)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// Exemplos FICTÍCIOS de teste: produtos são dados do cadastro, nunca constantes da tela.
const node = (overrides: Partial<ProductNode> & Pick<ProductNode, "id" | "kind" | "code" | "name">): ProductNode => ({ description: null, parentId: null, active: true, archivedAt: null, createdAt: "2026-10-21T00:00:00.000Z", updatedAt: "", criteriaCount: 0, scopeCount: 0, childCount: 0, inUse: false, ...overrides })
const CATEGORY = node({ id: "f1", kind: "FAMILY", code: "VOZ_CORPORATIVA", name: "Voz corporativa", childCount: 2 })
const TRUNK = node({ id: "p1", kind: "PRODUCT", code: "TRONCO_VOZ", name: "Tronco de voz", parentId: "f1", criteriaCount: 1, scopeCount: 2, inUse: true })
const EXTENSION = node({ id: "p2", kind: "PRODUCT", code: "RAMAL_DIRETO", name: "Ramal direto", parentId: "f1" })
const DRAFT_CRITERION: IdentificationCriterion = {
  id: "c1",
  title: "Conta iniciada em 7000",
  status: "ACTIVE",
  updatedAt: "",
  usedByAnalyses: false,
  versions: [{ id: "v1", version: 1, status: "DRAFT", situation: "DRAFT", content: { statement: "Conta iniciada em 7000 identifica o tronco de voz.", targetNodeIds: ["p1"], context: null, limitations: null, strength: "CONCLUSIVE", conclusiveWhen: null, sourceDocumentId: null, sourceReference: null }, sourceDocumentTitle: null, contentHash: "h", effectiveFrom: null, effectiveUntil: null, approvedAt: null, approvedByName: null, updatedAt: "" }],
}
const scope = (nodeIds: string[]) => ({ assignmentId: `a-${nodeIds.join("-")}`, nodeIds, since: "2026-10-21T00:00:00.000Z" })
const SOURCES: ProductScopeSource[] = [
  { sourceKind: "KNOWLEDGE_DOCUMENT", sourceId: "d1", title: "Segunda via — tronco de voz", status: null, scope: scope(["p1"]) },
  { sourceKind: "KNOWLEDGE_DOCUMENT", sourceId: "d2", title: "Portabilidade — tronco e ramal", status: null, scope: scope(["p1", "p2"]) },
  { sourceKind: "KNOWLEDGE_DOCUMENT", sourceId: "d3", title: "Cancelamento — voz corporativa", status: null, scope: scope(["f1"]) },
  { sourceKind: "ARGUMENT_SCRIPT", sourceId: "s1", title: "Segunda via (argumentário)", status: "ACTIVE", scope: null },
]

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
function arrange() {
  service.fetchProductNodes.mockResolvedValue([CATEGORY, TRUNK, EXTENSION])
  service.fetchIdentificationCriteria.mockResolvedValue([{ id: "c1", title: DRAFT_CRITERION.title, status: "ACTIVE", updatedAt: "", current: null, draft: DRAFT_CRITERION.versions[0] }])
  service.fetchIdentificationCriterion.mockResolvedValue(DRAFT_CRITERION)
  service.fetchProductScopeSources.mockResolvedValue(SOURCES)
  service.fetchProductScopeHistory.mockResolvedValue({ sourceKind: "ARGUMENT_SCRIPT", sourceId: "s1", title: "Segunda via (argumentário)", history: [] })
  service.setProductScope.mockResolvedValue({ sourceKind: "ARGUMENT_SCRIPT", sourceId: "s1", title: "Segunda via (argumentário)", history: [] })
}
async function openProduct(code: string) {
  renderWithQuery(<ProductCatalogPage />)
  fireEvent.click(await screen.findByTestId(`product-node-${code}`))
  return screen.findByTestId(`product-detail-${code}`)
}

describe("Produtos — lista e detalhe por produto", () => {
  it("lista mostra categorias e produtos com quantas bases e indícios valem para cada um (diretos e pela categoria)", async () => {
    arrange()
    renderWithQuery(<ProductCatalogPage />)
    expect(await screen.findByTestId("product-node-TRONCO_VOZ")).toHaveTextContent("3 bases · 1 indício")
    expect(screen.getByTestId("product-node-RAMAL_DIRETO")).toHaveTextContent("2 bases · 0 indícios")
    expect(screen.getByTestId("product-node-VOZ_CORPORATIVA")).toHaveTextContent("2 produtos")
  })

  it("categoria recolhe e mostra os produtos de dentro; o código técnico não aparece na tela", async () => {
    arrange()
    renderWithQuery(<ProductCatalogPage />)
    await screen.findByTestId("product-node-TRONCO_VOZ")
    expect(screen.queryByText("VOZ_CORPORATIVA")).not.toBeInTheDocument()
    expect(screen.queryByText("TRONCO_VOZ")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Recolher Voz corporativa" }))
    expect(screen.queryByTestId("product-node-TRONCO_VOZ")).not.toBeInTheDocument()
    expect(screen.getByTestId("product-node-VOZ_CORPORATIVA")).toHaveTextContent("2 produtos")
    fireEvent.click(screen.getByRole("button", { name: "Mostrar os produtos de Voz corporativa" }))
    expect(screen.getByTestId("product-node-RAMAL_DIRETO")).toBeInTheDocument()
    // Na busca, o achado aparece com a categoria acima dele, mesmo recolhida.
    fireEvent.click(screen.getByRole("button", { name: "Recolher Voz corporativa" }))
    fireEvent.change(screen.getByLabelText("Buscar produto"), { target: { value: "ramal" } })
    expect(screen.getByTestId("product-node-RAMAL_DIRETO")).toBeInTheDocument()
    expect(screen.getByTestId("product-node-VOZ_CORPORATIVA")).toBeInTheDocument()
    expect(screen.queryByTestId("product-node-TRONCO_VOZ")).not.toBeInTheDocument()
  })

  it("detalhe do produto: base só dele, base compartilhada com outro produto e base que vem da categoria; as gerais aparecem contadas", async () => {
    arrange()
    const detail = await openProduct("TRONCO_VOZ")
    const bases = within(detail).getByTestId("product-bases")
    expect(within(bases).getByTestId("product-base-d1")).toHaveTextContent("Só deste produto")
    expect(within(bases).getByTestId("product-base-d2")).toHaveTextContent("Também vale para: Ramal direto")
    expect(within(bases).getByTestId("product-base-d3")).toHaveTextContent("Pela categoria")
    expect(within(bases).queryByTestId("product-base-s1")).not.toBeInTheDocument()
    expect(bases).toHaveTextContent("1 base geral vale para todos os produtos")
    expect(within(detail).getByText("Voz corporativa")).toBeInTheDocument()
  })

  it("adicionar base ao produto acrescenta o produto aos que ela já tinha (base geral passa a ser do produto)", async () => {
    arrange()
    const detail = await openProduct("RAMAL_DIRETO")
    fireEvent.click(within(detail).getByRole("button", { name: /Adicionar base/ }))
    const panel = await screen.findByTestId("add-base-panel")
    expect(within(panel).queryByText("Portabilidade — tronco e ramal")).not.toBeInTheDocument()
    expect(within(panel).getByText(/hoje: Geral — vale para todos os produtos/)).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole("button", { name: "Adicionar Segunda via — tronco de voz" }))
    await waitFor(() => expect(service.setProductScope.mock.calls[0]?.[0]).toEqual({ kind: "KNOWLEDGE_DOCUMENT", id: "d1", nodeIds: ["p1", "p2"] }))
    fireEvent.click(within(panel).getByRole("button", { name: "Adicionar Segunda via (argumentário)" }))
    await waitFor(() => expect(service.setProductScope.mock.calls[1]?.[0]).toEqual({ kind: "ARGUMENT_SCRIPT", id: "s1", nodeIds: ["p2"] }))
  })

  it("tirar a base do produto: compartilhada sai só deste; a única vira geral depois de confirmar", async () => {
    arrange()
    const detail = await openProduct("TRONCO_VOZ")
    fireEvent.click(within(detail).getByRole("button", { name: "Tirar Portabilidade — tronco e ramal deste item" }))
    await waitFor(() => expect(service.setProductScope.mock.calls[0]?.[0]).toEqual({ kind: "KNOWLEDGE_DOCUMENT", id: "d2", nodeIds: ["p2"] }))
    expect(within(detail).queryByRole("button", { name: /Tirar Cancelamento/ })).not.toBeInTheDocument()
    fireEvent.click(within(detail).getByRole("button", { name: "Tirar Segunda via — tronco de voz deste item" }))
    expect(await screen.findByText(/ela volta a ser geral/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Tirar e deixar geral" }))
    await waitFor(() => expect(service.setProductScope.mock.calls[1]?.[0]).toEqual({ kind: "KNOWLEDGE_DOCUMENT", id: "d1", nodeIds: [] }))
  })

  it("produto em uso não é excluído — desativar em vez disso", async () => {
    arrange()
    const detail = await openProduct("TRONCO_VOZ")
    fireEvent.keyDown(within(detail).getByRole("button", { name: "Mais ações de Tronco de voz" }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Excluir" }))
    expect(await screen.findByText(/Desative em vez de excluir/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Excluir" })).toBeDisabled()
  })

  it("novo produto: só o nome — o código técnico é gerado por ele e não aparece; depois de criado, o detalhe dele abre", async () => {
    arrange()
    const created = node({ id: "p3", kind: "PRODUCT", code: "LINHA_IP", name: "Linha IP" })
    service.createProductNode.mockResolvedValue(created)
    renderWithQuery(<ProductCatalogPage />)
    fireEvent.click(await screen.findByRole("button", { name: "Novo produto" }))
    const form = screen.getByTestId("product-node-form")
    expect(within(form).queryByLabelText(/Código/)).not.toBeInTheDocument()
    fireEvent.change(within(form).getByLabelText("Nome *"), { target: { value: "Linha IP" } })
    service.fetchProductNodes.mockResolvedValue([CATEGORY, TRUNK, EXTENSION, created])
    fireEvent.click(within(form).getByRole("button", { name: "Criar produto" }))
    await waitFor(() => expect(service.createProductNode.mock.calls[0]?.[0]).toEqual({ kind: "PRODUCT", name: "Linha IP", code: "LINHA_IP", description: null, parentId: null }))
    expect(await screen.findByTestId("product-detail-LINHA_IP")).toBeInTheDocument()
  })

  it("novo produto a partir da categoria já vem com ela; o cadastro pede só nome e como chamam", async () => {
    arrange()
    service.createProductNode.mockResolvedValue(node({ id: "p9", kind: "PRODUCT", code: "LINHA_IP", name: "Linha IP", parentId: "f1" }))
    const detail = await openProduct("VOZ_CORPORATIVA")
    fireEvent.click(within(detail).getByRole("button", { name: /Novo produto nesta categoria/ }))
    const form = screen.getByTestId("product-node-form")
    fireEvent.change(within(form).getByLabelText("Nome *"), { target: { value: "Linha IP" } })
    fireEvent.change(within(form).getByLabelText("Como o cliente e a operação chamam"), { target: { value: "linha IP, voz pela internet" } })
    fireEvent.click(within(form).getByRole("button", { name: "Criar produto" }))
    await waitFor(() => expect(service.createProductNode.mock.calls[0]?.[0]).toEqual({ kind: "PRODUCT", code: "LINHA_IP", name: "Linha IP", description: "linha IP, voz pela internet", parentId: "f1" }))
  })

  it("catálogo vazio explica que a análise segue como antes e oferece cadastrar", async () => {
    arrange()
    service.fetchProductNodes.mockResolvedValue([])
    renderWithQuery(<ProductCatalogPage />)
    expect(await screen.findByText(/a INIA analisa as chamadas como antes/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Novo produto/ })).toBeInTheDocument()
    // Categoria não tem botão próprio: nasce no seletor do produto.
    expect(screen.queryByRole("button", { name: /Nova categoria/ })).not.toBeInTheDocument()
  })
})

describe("Como reconhecer o produto na chamada — indícios", () => {
  it("novo indício em um passo: já vem marcado para o produto, o nome sai do texto e \"Salvar e usar\" cria e põe em uso", async () => {
    arrange()
    service.createIdentificationCriterion.mockResolvedValue({ ...DRAFT_CRITERION, id: "c2" })
    service.approveIdentificationCriterion.mockResolvedValue({ ...DRAFT_CRITERION, id: "c2" })
    const detail = await openProduct("RAMAL_DIRETO")
    fireEvent.click(within(detail).getByRole("button", { name: /Novo indício/ }))
    const form = await screen.findByTestId("clue-new")
    expect(form).toHaveTextContent("Indica: Ramal direto")
    expect(within(form).getByRole("button", { name: "Salvar e usar" })).toBeDisabled()
    fireEvent.change(within(form).getByLabelText("O que aparece na chamada *"), { target: { value: "Cliente cita um ramal de 4 dígitos da própria empresa. Vale para chamadas da matriz." } })
    expect(form).toHaveTextContent("Para usar, falta: de onde vem.")
    fireEvent.change(within(form).getByLabelText("De onde vem *"), { target: { value: "Comunicado de teste" } })
    fireEvent.click(within(form).getByRole("button", { name: "Salvar e usar" }))
    await waitFor(() => expect(service.approveIdentificationCriterion.mock.calls[0]?.[0]).toEqual({ id: "c2", effectiveFrom: null }))
    expect(service.createIdentificationCriterion.mock.calls[0]?.[0]).toMatchObject({ title: "Cliente cita um ramal de 4 dígitos da própria empresa", content: { targetNodeIds: ["p2"], strength: "INDICATIVE", sourceReference: "Comunicado de teste" } })
  })

  it("salvar como rascunho só cria — não põe em uso", async () => {
    arrange()
    service.createIdentificationCriterion.mockResolvedValue({ ...DRAFT_CRITERION, id: "c3" })
    const detail = await openProduct("RAMAL_DIRETO")
    fireEvent.click(within(detail).getByRole("button", { name: /Novo indício/ }))
    const form = await screen.findByTestId("clue-new")
    fireEvent.change(within(form).getByLabelText("O que aparece na chamada *"), { target: { value: "Ramal com 4 dígitos" } })
    fireEvent.click(within(form).getByRole("button", { name: "Salvar como rascunho" }))
    await waitFor(() => expect(service.createIdentificationCriterion).toHaveBeenCalledTimes(1))
    expect(service.approveIdentificationCriterion).not.toHaveBeenCalled()
  })

  it("indício existente: diz o que falta antes do clique; o que o backend recusar também aparece; sem data = a partir de agora", async () => {
    arrange()
    service.approveIdentificationCriterion.mockRejectedValueOnce(new AdminApiError("O rascunho ainda não pode ser aprovado.", "PRODUCT_CRITERION_NOT_READY", { issues: ["Um dos produtos indicados está desativado."] }))
    service.updateIdentificationCriterion.mockResolvedValue(DRAFT_CRITERION)
    const detail = await openProduct("TRONCO_VOZ")
    fireEvent.click(within(detail).getByTestId("clue-row-c1"))
    const editor = await screen.findByTestId("clue-editor")
    expect(within(editor).getByLabelText("O que aparece na chamada *")).toHaveValue("Conta iniciada em 7000 identifica o tronco de voz.")
    expect(editor).toHaveTextContent("Para usar, falta: quando ele confirma, de onde vem.")
    expect(within(editor).getByRole("button", { name: "Salvar e usar" })).toBeDisabled()
    fireEvent.change(within(editor).getByLabelText("Confirma quando *"), { target: { value: "a conta é a do pedido" } })
    fireEvent.change(within(editor).getByLabelText("De onde vem *"), { target: { value: "Comunicado X" } })
    fireEvent.click(within(editor).getByRole("button", { name: "Salvar e usar" }))
    expect(await within(editor).findByText("Um dos produtos indicados está desativado.")).toBeInTheDocument()
    expect(service.updateIdentificationCriterion.mock.calls[0]?.[0]).toMatchObject({ id: "c1", content: { conclusiveWhen: "a conta é a do pedido", sourceReference: "Comunicado X" } })
    expect(service.approveIdentificationCriterion.mock.calls[0]?.[0]).toEqual({ id: "c1", effectiveFrom: null })
  })

  it("indício da categoria aparece no produto avisando que só confirma a categoria", async () => {
    arrange()
    service.fetchIdentificationCriteria.mockResolvedValue([{ id: "c9", title: "Pedido de voz corporativa", status: "ACTIVE", updatedAt: "", current: null, draft: { ...DRAFT_CRITERION.versions[0]!, content: { ...DRAFT_CRITERION.versions[0]!.content, targetNodeIds: ["f1"] } } }])
    const detail = await openProduct("RAMAL_DIRETO")
    expect(within(detail).getByTestId("clue-row-c9")).toHaveTextContent("Indica a categoria Voz corporativa (não o produto exato).")
  })
})
