import { describe, expect, it } from "vitest"

import type { CriterionVersion, IdentificationCriterionSummary, ProductNode, ProductScopeSource } from "@/schemas/admin/product-catalog.schema"

import { ancestorsOf, basesOf, cluesOf, codeFromName, scopeKindOf, shownVersionOf } from "./catalog-relations"

// Exemplos FICTÍCIOS de teste.
const node = (id: string, kind: ProductNode["kind"], parentId: string | null = null): ProductNode => ({ id, kind, code: id.toUpperCase(), name: id, description: null, parentId, active: true, archivedAt: null, createdAt: "", updatedAt: "", criteriaCount: 0, scopeCount: 0, childCount: 0, inUse: false, blocksDeletion: false })
const NODES = [node("grupo", "FAMILY"), node("sub", "FAMILY", "grupo"), node("a", "PRODUCT", "sub"), node("b", "PRODUCT", "grupo"), node("solto", "PRODUCT")]
const source = (sourceId: string, nodeIds: string[] | null): ProductScopeSource => ({ sourceKind: "KNOWLEDGE_DOCUMENT", sourceId, title: sourceId, status: null, scope: nodeIds ? { assignmentId: sourceId, nodeIds, since: "" } : null })
const version = (targetNodeIds: string[], status: CriterionVersion["status"] = "APPROVED"): CriterionVersion => ({ id: `v-${targetNodeIds.join("")}`, version: 1, status, situation: status === "DRAFT" ? "DRAFT" : "IN_FORCE", content: { statement: "x", targetNodeIds, context: null, limitations: null, strength: "INDICATIVE", conclusiveWhen: null, sourceDocumentId: null, sourceReference: null }, sourceDocumentTitle: null, contentHash: "", effectiveFrom: null, effectiveUntil: null, approvedAt: null, approvedByName: null, updatedAt: "" })
const clue = (id: string, current: CriterionVersion | null, draft: CriterionVersion | null = null): IdentificationCriterionSummary => ({ id, title: id, status: "ACTIVE", updatedAt: "", current, draft })

describe("relações do cadastro de produtos (não é 1×1)", () => {
  it("categorias acima de um produto, da mais próxima para a mais distante", () => {
    expect(ancestorsOf(NODES, "a").map((entry) => entry.id)).toEqual(["sub", "grupo"])
    expect(ancestorsOf(NODES, "solto")).toEqual([])
  })

  it("base geral (sem produto ou lista vazia), de um produto ou de vários", () => {
    expect(scopeKindOf(source("x", null))).toBe("GENERAL")
    expect(scopeKindOf(source("x", []))).toBe("GENERAL")
    expect(scopeKindOf(source("x", ["a"]))).toBe("SPECIFIC")
    expect(scopeKindOf(source("x", ["a", "b"]))).toBe("SHARED")
  })

  it("bases do produto: direta, compartilhada e pela categoria (a mais próxima); geral e de outro produto ficam de fora", () => {
    const sources = [source("geral", null), source("so-a", ["a"]), source("a-e-b", ["a", "b"]), source("do-grupo", ["grupo"]), source("do-sub-e-grupo", ["grupo", "sub"]), source("so-b", ["b"])]
    const bases = basesOf(NODES, sources, "a")
    expect(bases.map(({ source: entry, via, others }) => [entry.sourceId, via?.id ?? null, others])).toEqual([
      ["so-a", null, []],
      ["a-e-b", null, ["b"]],
      ["do-grupo", "grupo", []],
      ["do-sub-e-grupo", "sub", ["grupo"]],
    ])
    expect(basesOf(NODES, sources, "solto")).toEqual([])
  })

  it("indícios do produto pela versão valendo; sem versão aprovada, pelo rascunho; indício da categoria só confirma a categoria", () => {
    const criteria = [clue("valendo", version(["a"]), version(["b"], "DRAFT")), clue("rascunho", null, version(["a", "b"], "DRAFT")), clue("categoria", version(["grupo"])), clue("outro", version(["solto"]))]
    expect(shownVersionOf(criteria[0]!)?.content.targetNodeIds).toEqual(["a"])
    expect(cluesOf(NODES, criteria, "a").map(({ criterion, via, others }) => [criterion.id, via?.id ?? null, others])).toEqual([
      ["valendo", null, []],
      ["rascunho", null, ["b"]],
      ["categoria", "grupo", []],
    ])
    expect(cluesOf(NODES, criteria, "b").map(({ criterion }) => criterion.id)).toEqual(["rascunho", "categoria"])
  })

  it("código técnico gerado pelo nome: sem acento, começa por letra e não repete um código existente", () => {
    expect(codeFromName("Linha analógica", [])).toBe("LINHA_ANALOGICA")
    expect(codeFromName("0800", [])).toBe("P_0800")
    expect(codeFromName("Linha analógica", [{ code: "LINHA_ANALOGICA" }, { code: "LINHA_ANALOGICA_2" }])).toBe("LINHA_ANALOGICA_3")
    expect(codeFromName("x".repeat(60), [{ code: "X".repeat(40) }])).toBe(`${"X".repeat(38)}_2`)
    expect(codeFromName("é", [])).toBe("PRODUTO")
  })
})
