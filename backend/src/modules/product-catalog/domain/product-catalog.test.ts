import { describe, expect, it } from "vitest"
import { approvalIssuesOf, catalogFingerprintOf, criterionContentHashOf, criterionContentInputSchema, criterionVersionSituation, leavesOf, productNodeInputSchema, treeIssuesOf } from "./product-catalog.js"

/** Domínio do cadastro de produtos — exemplos fictícios de teste. */
const nodes = [
  { id: "fam", kind: "FAMILY" as const, parentId: null },
  { id: "sub", kind: "FAMILY" as const, parentId: "fam" },
  { id: "p1", kind: "PRODUCT" as const, parentId: "sub" },
  { id: "p2", kind: "PRODUCT" as const, parentId: "fam" },
  { id: "empty", kind: "FAMILY" as const, parentId: null },
]

describe("catálogo de produtos — domínio", () => {
  it("código no formato do catálogo; produto só dentro de família; sem ciclo", () => {
    expect(productNodeInputSchema.parse({ kind: "PRODUCT", code: "voz_ip", name: "Voz IP" }).code).toBe("VOZ_IP")
    expect(() => productNodeInputSchema.parse({ kind: "PRODUCT", code: "1X", name: "Inválido" })).toThrow()
    expect(treeIssuesOf({ id: null, kind: "PRODUCT", parentId: "p1" }, nodes)).toEqual(["Um item só pode ficar dentro de uma categoria."])
    expect(treeIssuesOf({ id: "fam", kind: "FAMILY", parentId: "sub" }, nodes)).toEqual(["A categoria não pode ficar dentro dela mesma."])
    expect(treeIssuesOf({ id: null, kind: "PRODUCT", parentId: "fam" }, nodes)).toEqual([])
  })

  it("família representa os produtos abaixo dela (inclusive subfamílias); família vazia representa a si mesma", () => {
    expect(leavesOf("fam", nodes)).toEqual(["p1", "p2"])
    expect(leavesOf("empty", nodes)).toEqual(["empty"])
    expect(leavesOf("p1", nodes)).toEqual(["p1"])
  })

  it("aprovação exige texto, alvo ativo, condição de conclusividade e fonte — nunca corrige sozinha", () => {
    const content = criterionContentInputSchema.parse({ statement: "Conta iniciada em 7000 identifica o produto.", targetNodeIds: ["00000000-0000-4000-8000-000000000001"], strength: "CONCLUSIVE" })
    expect(approvalIssuesOf(content, new Set(["00000000-0000-4000-8000-000000000001"]))).toEqual([
      "Diga quando o indício confirma o produto — sem isso ele apenas sugere.",
      "Diga de onde vem o indício: um documento da base ou uma referência (norma, comunicado, planilha).",
    ])
    expect(approvalIssuesOf({ ...content, conclusiveWhen: "conta completa", sourceReference: "Comunicado X" }, new Set())).toEqual(["Um dos produtos indicados está desativado."])
    expect(approvalIssuesOf({ ...content, conclusiveWhen: "conta completa", sourceReference: "Comunicado X" }, new Set(["00000000-0000-4000-8000-000000000001"]))).toEqual([])
  })

  it("identidade do conteúdo independe da ordem dos alvos; a condição só conta quando é conclusivo", () => {
    const base = criterionContentInputSchema.parse({ statement: "x", targetNodeIds: ["00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000001"], strength: "INDICATIVE", conclusiveWhen: "ignorada" })
    const reordered = { ...base, targetNodeIds: [...base.targetNodeIds].reverse(), conclusiveWhen: null }
    expect(criterionContentHashOf(base)).toBe(criterionContentHashOf(reordered))
    expect(criterionContentHashOf({ ...base, strength: "CONCLUSIVE" })).not.toBe(criterionContentHashOf(base))
  })

  it("situação da versão e fotografia do cadastro", () => {
    const now = new Date("2026-10-21T12:00:00Z")
    expect(criterionVersionSituation({ status: "APPROVED", effectiveFrom: "2026-10-22T00:00:00Z", effectiveUntil: null }, now)).toBe("SCHEDULED")
    expect(criterionVersionSituation({ status: "SUPERSEDED", effectiveFrom: "2026-10-01T00:00:00Z", effectiveUntil: "2026-10-10T00:00:00Z" }, now)).toBe("ENDED")
    expect(criterionVersionSituation({ status: "DRAFT", effectiveFrom: null, effectiveUntil: null }, now)).toBe("DRAFT")
    const catalog = { nodes: [{ id: "a", code: "A", kind: "PRODUCT" as const, name: "A", description: null, parentId: null }], criteria: [], scopes: [] }
    expect(catalogFingerprintOf(catalog)).toBe(catalogFingerprintOf({ ...catalog }))
    expect(catalogFingerprintOf({ ...catalog, nodes: [{ ...catalog.nodes[0]!, name: "Outro nome" }] })).not.toBe(catalogFingerprintOf(catalog))
  })
})
