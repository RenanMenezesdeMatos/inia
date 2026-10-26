import { z } from "zod"

import { adminGet, adminSend } from "@/lib/admin/admin-api"
import {
  identificationCriterionSchema,
  identificationCriterionSummarySchema,
  productNodeSchema,
  productScopeHistorySchema,
  productScopeSourceSchema,
  type CriterionContent,
  type IdentificationCriterion,
  type IdentificationCriterionSummary,
  type ProductNode,
  type ProductScopeHistory,
  type ProductScopeSource,
} from "@/schemas/admin/product-catalog.schema"

const BASE = "/api/v1/admin/product-catalog"

export async function fetchProductNodes(): Promise<ProductNode[]> {
  return z.array(productNodeSchema).parse(await adminGet(`${BASE}/nodes`))
}
export type ProductNodeInput = { kind: ProductNode["kind"]; code: string; name: string; description: string | null; parentId: string | null }
export async function createProductNode(input: ProductNodeInput): Promise<ProductNode> {
  return productNodeSchema.parse(await adminSend(`${BASE}/nodes`, "POST", input))
}
export async function updateProductNode({ id, ...input }: Partial<Omit<ProductNodeInput, "kind">> & { id: string }): Promise<ProductNode> {
  return productNodeSchema.parse(await adminSend(`${BASE}/nodes/${id}`, "PATCH", input))
}
export async function setProductNodeActive(id: string, active: boolean): Promise<ProductNode> {
  return productNodeSchema.parse(await adminSend(`${BASE}/nodes/${id}/${active ? "activate" : "deactivate"}`, "POST"))
}
export async function deleteProductNode(id: string): Promise<void> {
  await adminSend(`${BASE}/nodes/${id}`, "DELETE")
}

export async function fetchIdentificationCriteria(): Promise<IdentificationCriterionSummary[]> {
  return z.array(identificationCriterionSummarySchema).parse(await adminGet(`${BASE}/criteria`))
}
export async function fetchIdentificationCriterion(id: string): Promise<IdentificationCriterion> {
  return identificationCriterionSchema.parse(await adminGet(`${BASE}/criteria/${id}`))
}
export async function createIdentificationCriterion(input: { title: string; content: CriterionContent }): Promise<IdentificationCriterion> {
  return identificationCriterionSchema.parse(await adminSend(`${BASE}/criteria`, "POST", input))
}
export async function updateIdentificationCriterion({ id, ...input }: { id: string; title?: string; content?: CriterionContent }): Promise<IdentificationCriterion> {
  return identificationCriterionSchema.parse(await adminSend(`${BASE}/criteria/${id}`, "PATCH", input))
}
export async function approveIdentificationCriterion({ id, effectiveFrom }: { id: string; effectiveFrom?: string | null }): Promise<IdentificationCriterion> {
  return identificationCriterionSchema.parse(await adminSend(`${BASE}/criteria/${id}/approve`, "POST", effectiveFrom ? { effectiveFrom } : {}))
}
export async function discardIdentificationDraft(id: string): Promise<IdentificationCriterion> {
  return identificationCriterionSchema.parse(await adminSend(`${BASE}/criteria/${id}/draft`, "DELETE"))
}
export async function archiveIdentificationCriterion(id: string): Promise<IdentificationCriterion> {
  return identificationCriterionSchema.parse(await adminSend(`${BASE}/criteria/${id}/archive`, "POST"))
}
export async function reactivateIdentificationCriterion(id: string): Promise<IdentificationCriterion> {
  return identificationCriterionSchema.parse(await adminSend(`${BASE}/criteria/${id}/reactivate`, "POST"))
}
export async function deleteIdentificationCriterion(id: string): Promise<void> {
  await adminSend(`${BASE}/criteria/${id}`, "DELETE")
}

export async function fetchProductScopeSources(): Promise<ProductScopeSource[]> {
  return z.array(productScopeSourceSchema).parse(await adminGet(`${BASE}/sources`))
}
export async function fetchProductScopeHistory(kind: ProductScopeSource["sourceKind"], id: string): Promise<ProductScopeHistory> {
  return productScopeHistorySchema.parse(await adminGet(`${BASE}/sources/${kind}/${id}/scope`))
}
export async function setProductScope({ kind, id, nodeIds }: { kind: ProductScopeSource["sourceKind"]; id: string; nodeIds: string[] }): Promise<ProductScopeHistory> {
  return productScopeHistorySchema.parse(await adminSend(`${BASE}/sources/${kind}/${id}/scope`, "PUT", { nodeIds }))
}
