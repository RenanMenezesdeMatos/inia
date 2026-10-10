import { z } from "zod"

/**
 * Domínio de negócio como CATÁLOGO ADMINISTRÁVEL (migration 060).
 *
 * Regra arquitetural: a aplicação conhece TIPOS de especialidade (DOMAIN/CROSS_CUTTING/
 * PERFORMANCE/SYNTHESIS) e políticas de roteamento (DOMAINS/OPEN) — nunca domínios concretos.
 * "Faturamento", "Retenção e Cancelamento", "Logística" são DADOS deste catálogo: um domínio novo
 * é um registro, não um enum + migration + deploy. Nenhum módulo funcional pode ter
 * `switch (domainCode)` ou lista de códigos; códigos só aparecem em seed/backfill, fixtures de
 * teste, Wiki e comentários.
 *
 * Domínio ≠ Grupo (posição na estrutura organizacional), ≠ Base de Conhecimento (fonte autorizada
 * de um Agent) e ≠ Agent (um domínio pode ter N Agents especialistas).
 */
export const BUSINESS_DOMAIN_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/

/** Mesma família de normalização do catálogo de indicadores: maiúsculas, sem acento, `_` no lugar de
 * espaços/separadores. "Logística e Entregas" → "LOGISTICA_E_ENTREGAS". */
export function normalizeBusinessDomainCode(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

export const businessDomainCodeSchema = z
  .string()
  .trim()
  .min(1, "Informe o código do domínio.")
  .transform(normalizeBusinessDomainCode)
  .pipe(z.string().regex(BUSINESS_DOMAIN_CODE_PATTERN, "Código inválido: use letras maiúsculas, números e _ (2 a 40 caracteres, começando por letra)."))

export const businessDomainInputSchema = z.object({
  code: businessDomainCodeSchema,
  name: z.string().trim().min(2, "O nome precisa ter pelo menos 2 caracteres.").max(120),
  description: z.string().trim().max(500).nullable().optional().transform((value) => (value ? value : null)),
  active: z.boolean().default(true),
})
export type BusinessDomainInput = z.infer<typeof businessDomainInputSchema>

export const businessDomainPatchSchema = z.object({
  code: businessDomainCodeSchema.optional(),
  name: z.string().trim().min(2, "O nome precisa ter pelo menos 2 caracteres.").max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().optional(),
})

export type BusinessDomainRecord = {
  id: string
  code: string
  name: string
  description: string | null
  active: boolean
  createdAt: string
  updatedAt: string
}

/**
 * REFERÊNCIA a um domínio, como Agent (DOMAIN) e Orquestrador (DOMAINS) a carregam depois do
 * dual-read: `id` vem da FK/relação nova; quando só existe o código legado (`agents.domain`,
 * `routing_domains`), `id` é null e o nome cai para o próprio código — legível, nunca inventado.
 * A comparação de fronteira (política) é sempre por CÓDIGO: é o que as duas formas têm em comum.
 */
export type BusinessDomainRef = {
  id: string | null
  code: string
  name: string
  active: boolean
}

export function domainRefFromCode(code: string): BusinessDomainRef {
  return { id: null, code, name: code, active: true }
}

export function domainRefFromRecord(record: Pick<BusinessDomainRecord, "id" | "code" | "name" | "active">): BusinessDomainRef {
  return { id: record.id, code: record.code, name: record.name, active: record.active }
}

/** Forma JSON que o SQL devolve (json_build_object) → referência tipada; qualquer coisa fora do
 * formato vira "não informado" em vez de quebrar um registro legado. */
const domainRefJsonSchema = z.object({ id: z.string().uuid(), code: z.string(), name: z.string(), active: z.boolean().default(true) })

export function parseDomainRef(value: unknown): BusinessDomainRef | null {
  const parsed = domainRefJsonSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseDomainRefs(value: unknown): BusinessDomainRef[] {
  if (!Array.isArray(value)) return []
  return value.map(parseDomainRef).filter((ref): ref is BusinessDomainRef => ref !== null)
}

/** Códigos legados (`routing_domains`/`policy_domains`) → referências sem id (nome = código). */
export function domainRefsFromCodes(value: unknown): BusinessDomainRef[] {
  if (!Array.isArray(value)) return []
  return value.filter((code): code is string => typeof code === "string" && BUSINESS_DOMAIN_CODE_PATTERN.test(code)).map(domainRefFromCode)
}

/**
 * Dual-read de UMA referência (Agent DOMAIN): a FK/relação nova (id + código + nome do catálogo)
 * tem precedência; sem ela, o código legado. Nunca os dois em desacordo: se o catálogo diz um
 * código e a coluna legada outro, vale o catálogo (a coluna legada é espelho, não fonte).
 */
export function resolveDomainRef(row: { business_domain_id?: string | null | undefined; business_domain_code?: string | null | undefined; business_domain_name?: string | null | undefined; business_domain_active?: boolean | null | undefined; domain?: string | null | undefined }): BusinessDomainRef | null {
  if (row.business_domain_id) {
    const code = row.business_domain_code ?? row.domain ?? null
    if (code) return { id: row.business_domain_id, code, name: row.business_domain_name ?? code, active: row.business_domain_active ?? true }
  }
  if (row.domain && BUSINESS_DOMAIN_CODE_PATTERN.test(row.domain)) return domainRefFromCode(row.domain)
  return null
}

/**
 * Dual-read de N referências (Orquestrador DOMAINS): a relação nova (json do catálogo) quando
 * existe; senão os códigos legados. Referência da relação sem código legado correspondente (ou
 * vice-versa) é unida por código — a relação manda no nome/id, o legado só completa o que faltou.
 */
export function resolveDomainRefs(row: { business_domains?: unknown; routing_domains?: unknown; policy_domains?: unknown }, legacyKey: "routing_domains" | "policy_domains" = "routing_domains"): BusinessDomainRef[] {
  const fromRelation = parseDomainRefs(row.business_domains)
  const fromLegacy = domainRefsFromCodes(row[legacyKey])
  if (fromRelation.length === 0) return fromLegacy
  const seen = new Set(fromRelation.map((ref) => ref.code))
  return [...fromRelation, ...fromLegacy.filter((ref) => !seen.has(ref.code))]
}

/** Texto de apresentação: "Cadastro e Titularidade" ou "Cadastro e Titularidade (desativado)". */
export function describeBusinessDomain(ref: BusinessDomainRef): string {
  return ref.active ? ref.name : `${ref.name} (desativado)`
}

export function describeBusinessDomains(refs: BusinessDomainRef[]): string {
  return refs.map(describeBusinessDomain).join(", ")
}
