import { z } from "zod"

/**
 * Domínio de negócio — catálogo ADMINISTRÁVEL (`/admin/business-domains`). Classifica Agents
 * "Especialista de domínio" (QUAL assunto) e restringe Orquestradores "Domínios específicos".
 * A UI nunca conhece um domínio concreto: Faturamento, Logística… são registros deste catálogo.
 * Domínio ≠ Grupo (estrutura), ≠ Base de Conhecimento (fonte do Agent), ≠ Agent (um domínio
 * pode ter N Agents).
 */
export const BUSINESS_DOMAIN_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/

/** Mesma normalização do backend (business-domain.ts): maiúsculas, sem acento, `_` nos separadores. */
export function normalizeBusinessDomainCode(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

/** Referência a um domínio como Agent/Orquestrador a carregam (id null = só o código legado). */
export const businessDomainRefSchema = z.object({
  id: z.string().nullable().catch(null),
  code: z.string(),
  name: z.string(),
  active: z.boolean().catch(true),
})
export type BusinessDomainRef = z.infer<typeof businessDomainRefSchema>

export const businessDomainSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable().catch(null),
  active: z.boolean(),
  createdAt: z.coerce.string(),
  updatedAt: z.coerce.string().catch(""),
  agentCount: z.number().catch(0),
  orchestratorCount: z.number().catch(0),
})
export type BusinessDomain = z.infer<typeof businessDomainSchema>

const dependencyItemSchema = z.object({ id: z.string(), name: z.string(), active: z.boolean().catch(true) })

export const businessDomainDependenciesSchema = z.object({
  agents: z.array(dependencyItemSchema),
  orchestrators: z.array(dependencyItemSchema),
  total: z.number(),
})
export type BusinessDomainDependencies = z.infer<typeof businessDomainDependenciesSchema>

export function domainRefFromCode(code: string): BusinessDomainRef {
  return { id: null, code, name: code, active: true }
}

/** "Cadastro e Titularidade" ou "Cadastro e Titularidade (desativado)". */
export function describeBusinessDomain(ref: BusinessDomainRef): string {
  return ref.active ? ref.name : `${ref.name} (desativado)`
}

export function describeBusinessDomains(refs: BusinessDomainRef[]): string {
  return refs.map(describeBusinessDomain).join(", ")
}

/** Dual-read (espelho do backend): a relação/FK nova (`businessDomain(s)`) prevalece; sem ela, os códigos legados. */
export function resolveDomainRefs(row: { businessDomains?: unknown; routingDomains?: string[] | null; policyDomains?: string[] | null }, legacyKey: "routingDomains" | "policyDomains" = "routingDomains"): BusinessDomainRef[] {
  const relation = z.array(businessDomainRefSchema).safeParse(row.businessDomains ?? [])
  const fromRelation = relation.success ? relation.data.filter((ref) => ref.id) : []
  const fromLegacy = (row[legacyKey] ?? []).filter((code) => BUSINESS_DOMAIN_CODE_PATTERN.test(code)).map(domainRefFromCode)
  if (fromRelation.length === 0) return fromLegacy
  const seen = new Set(fromRelation.map((ref) => ref.code))
  return [...fromRelation, ...fromLegacy.filter((ref) => !seen.has(ref.code))]
}

export function resolveDomainRef(row: { businessDomain?: unknown; businessDomainId?: string | null; domain?: string | null }): BusinessDomainRef | null {
  const relation = businessDomainRefSchema.safeParse(row.businessDomain)
  if (relation.success && relation.data.id) return relation.data
  if (row.domain && BUSINESS_DOMAIN_CODE_PATTERN.test(row.domain)) return { ...domainRefFromCode(row.domain), id: row.businessDomainId ?? null }
  return null
}
