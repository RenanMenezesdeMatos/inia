/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { ProductNode, ProductScopeSource } from "@/schemas/admin/product-catalog.schema"

import { ProductBases } from "./product-bases"

const service = vi.hoisted(() => ({ setProductScope: vi.fn() }))
vi.mock("@/services/admin/product-catalog-service", () => service)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

// Exemplos FICTÍCIOS de teste.
const node = (id: string, name: string): ProductNode => ({ id, kind: "PRODUCT", code: id.toUpperCase(), name, description: null, parentId: null, active: true, archivedAt: null, inUse: false, blocksDeletion: false, scopeCount: 0, activeScopeCount: 0, criterionCount: 0 }) as unknown as ProductNode
const NODES = [node("p1", "Tronco de voz"), node("p2", "Ramal direto")]
const base = (sourceId: string, inUse: string[] | null, pendingScope: ProductScopeSource["pendingScope"] = null): ProductScopeSource => ({
  sourceKind: "KNOWLEDGE_DOCUMENT",
  sourceId,
  title: `Base ${sourceId}`,
  status: null,
  scope: inUse ? { assignmentId: `a-${sourceId}`, nodeIds: inUse, since: "2026-11-01T10:00:00.000Z" } : null,
  pendingScope,
})

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("bases de um produto: o que vale e o que ainda não vale (PEN-008)", () => {
  it("base que sai no rascunho continua listada, com o aviso de que ainda vale", () => {
    renderWithQuery(<ProductBases node={NODES[0]!} nodes={NODES} sources={[base("b1", ["p1"], { version: 3, status: "DRAFT", nodeIds: [] })]} />)
    expect(within(screen.getByTestId("product-base-b1")).getByText("Rascunho V3: sai deste item, mas ainda vale até a versão entrar em uso.")).toBeInTheDocument()
    expect(screen.queryByTestId("product-bases-upcoming")).not.toBeInTheDocument()
  })

  it("base que entra no rascunho aparece à parte, como ainda sem efeito, e dá para tirá-la do rascunho", async () => {
    service.setProductScope.mockResolvedValue({ sourceKind: "KNOWLEDGE_DOCUMENT", sourceId: "b2", title: "Base b2", history: [], pending: { version: 2, nodeIds: ["p2"] } })
    renderWithQuery(<ProductBases node={NODES[0]!} nodes={NODES} sources={[base("b2", null, { version: 2, status: "DRAFT", nodeIds: ["p1", "p2"] })]} />)
    expect(screen.queryByTestId("product-base-b2")).not.toBeInTheDocument()
    const upcoming = screen.getByTestId("product-bases-upcoming")
    expect(upcoming).toHaveTextContent("Ainda sem efeito: entram quando a versão entrar em uso")
    expect(upcoming).toHaveTextContent("Rascunho V2")
    fireEvent.click(within(upcoming).getByRole("button", { name: "Tirar Base b2 do rascunho deste item" }))
    await waitFor(() => expect(service.setProductScope.mock.calls[0]?.[0]).toEqual({ kind: "KNOWLEDGE_DOCUMENT", id: "b2", nodeIds: ["p2"] }))
  })

  it("mudanças seguidas se somam no rascunho: tirar parte da escolha em andamento, não do que está valendo", async () => {
    service.setProductScope.mockResolvedValue({ sourceKind: "KNOWLEDGE_DOCUMENT", sourceId: "b3", title: "Base b3", history: [], pending: { version: 4, nodeIds: ["p2"] } })
    renderWithQuery(<ProductBases node={NODES[0]!} nodes={NODES} sources={[base("b3", ["p1"], { version: 4, status: "DRAFT", nodeIds: ["p1", "p2"] })]} />)
    fireEvent.click(screen.getByRole("button", { name: "Tirar Base b3 deste item" }))
    await waitFor(() => expect(service.setProductScope.mock.calls[0]?.[0]).toEqual({ kind: "KNOWLEDGE_DOCUMENT", id: "b3", nodeIds: ["p2"] }))
  })

  it("tirar a última de uma base avisa que a mudança fica no rascunho; num argumentário, vale a partir de agora", async () => {
    renderWithQuery(<ProductBases node={NODES[0]!} nodes={NODES} sources={[base("b4", ["p1"]), { ...base("s1", ["p1"]), sourceKind: "ARGUMENT_SCRIPT" }]} />)
    fireEvent.click(screen.getByRole("button", { name: "Tirar Base b4 deste item" }))
    expect(within(await screen.findByRole("alertdialog")).getByText(/quando a versão entrar em uso\. Até lá, fica no rascunho, e nada muda/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "Tirar Base s1 deste item" }))
    expect(within(await screen.findByRole("alertdialog")).getByText(/a partir de agora/)).toBeInTheDocument()
  })
})
