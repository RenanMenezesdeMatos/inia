import { z } from "zod"

import { adminGet, adminSend } from "@/lib/admin/admin-api"
import { pageResultSchema, toQueryString, type ListParams, type PageResult } from "@/lib/admin/list-query"
import { businessDomainDependenciesSchema, businessDomainSchema, type BusinessDomain, type BusinessDomainDependencies } from "@/schemas/admin/business-domain.schema"

/** Seletores (Agent/Orquestrador): só ATIVOS por padrão; `includeInactive` para mostrar um legado "(desativado)". */
export async function fetchBusinessDomains(options: { includeInactive?: boolean } = {}): Promise<BusinessDomain[]> {
  return z.array(businessDomainSchema).parse(await adminGet(`/api/v1/admin/business-domains${options.includeInactive ? "?includeInactive=true" : ""}`))
}

export type BusinessDomainListParams = ListParams & { active?: boolean }

export async function fetchBusinessDomainsPage(params: BusinessDomainListParams): Promise<PageResult<BusinessDomain>> {
  return pageResultSchema(businessDomainSchema).parse(await adminGet(`/api/v1/admin/business-domains${toQueryString({ ...params, includeInactive: params.active === undefined ? true : undefined })}`))
}

export async function fetchBusinessDomainDependencies(id: string): Promise<BusinessDomainDependencies> {
  return businessDomainDependenciesSchema.parse(await adminGet(`/api/v1/admin/business-domains/${id}/dependencies`))
}

export type CreateBusinessDomainInput = { name: string; code: string; description?: string | null; active?: boolean }

export async function createBusinessDomain(input: CreateBusinessDomainInput): Promise<BusinessDomain> {
  return businessDomainSchema.parse(await adminSend("/api/v1/admin/business-domains", "POST", input))
}

export type UpdateBusinessDomainInput = { id: string; name?: string; code?: string; description?: string | null; active?: boolean }

export async function updateBusinessDomain({ id, ...input }: UpdateBusinessDomainInput): Promise<BusinessDomain> {
  return businessDomainSchema.parse(await adminSend(`/api/v1/admin/business-domains/${id}`, "PATCH", input))
}

export async function setBusinessDomainActive(id: string, active: boolean): Promise<BusinessDomain> {
  return businessDomainSchema.parse(await adminSend(`/api/v1/admin/business-domains/${id}/${active ? "activate" : "deactivate"}`, "POST"))
}

export async function deleteBusinessDomain(id: string): Promise<void> {
  await adminSend(`/api/v1/admin/business-domains/${id}`, "DELETE")
}
