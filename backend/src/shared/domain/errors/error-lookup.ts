import { DEFAULT_FAMILY_ID, ERROR_CATALOG, ERROR_CATALOG_VERSION, ERROR_FAMILIES } from "./error-catalog.js"
import type { ErrorCatalogEntry, ErrorFamily, InventoriedDomainCode } from "./error-catalog-types.js"
import { DOMAIN_ERROR_CODES } from "./domain-error-codes.generated.js"

/**
 * Resolução de um código digitado/copiado para a explicação: entrada própria do catálogo → alias → código de módulo inventariado
 * (com a família do status). Usada pela Administração, pela CLI da VM e pelos documentos gerados — a mesma resposta nos três.
 */
export type CodeExplanation =
  | { kind: "ENTRY"; requested: string; entry: ErrorCatalogEntry; viaAlias: boolean; catalogVersion: string }
  | { kind: "DOMAIN"; requested: string; domain: InventoriedDomainCode; family: ErrorFamily; catalogVersion: string }

const byCode = new Map(ERROR_CATALOG.map((entry) => [entry.code, entry]))
const byAlias = new Map(ERROR_CATALOG.flatMap((entry) => (entry.aliases ?? []).map((alias) => [alias, entry] as const)))
const domainByCode = new Map(DOMAIN_ERROR_CODES.map((domain) => [domain.code, domain]))

export function normalizeCode(input: string): string {
  return input.trim().toUpperCase()
}

export function familyForStatus(status: number | null | undefined): ErrorFamily {
  const found = typeof status === "number" ? ERROR_FAMILIES.find((family) => family.statuses.includes(status)) : undefined
  return found ?? ERROR_FAMILIES.find((family) => family.id === DEFAULT_FAMILY_ID)!
}

export function explainCode(input: string): CodeExplanation | null {
  const code = normalizeCode(input)
  if (!code) return null
  const entry = byCode.get(code)
  if (entry) return { kind: "ENTRY", requested: code, entry, viaAlias: false, catalogVersion: ERROR_CATALOG_VERSION }
  const alias = byAlias.get(code)
  if (alias) return { kind: "ENTRY", requested: code, entry: alias, viaAlias: true, catalogVersion: ERROR_CATALOG_VERSION }
  const domain = domainByCode.get(code)
  if (domain) return { kind: "DOMAIN", requested: code, domain, family: familyForStatus(domain.statuses[0]), catalogVersion: ERROR_CATALOG_VERSION }
  return null
}

/** Severidade para o log/ocorrência de uma resposta: a da entrada do catálogo, senão a da família do status. */
export function severityFor(code: string | null, status: number | null): ErrorCatalogEntry["severity"] {
  const explained = code ? explainCode(code) : null
  if (explained?.kind === "ENTRY") return explained.entry.severity
  if (typeof status === "number" && status >= 500) return "error"
  return familyForStatus(status).severity
}

/** Busca por prefixo/trecho (lista da Administração). */
export function searchCodes(query: string, limit = 30): { code: string; module: string; title: string; kind: "ENTRY" | "ALIAS" | "DOMAIN" }[] {
  const needle = normalizeCode(query)
  const results: { code: string; module: string; title: string; kind: "ENTRY" | "ALIAS" | "DOMAIN" }[] = []
  const push = (item: (typeof results)[number]) => {
    if (results.length < limit && (!needle || item.code.includes(needle))) results.push(item)
  }
  for (const entry of ERROR_CATALOG) push({ code: entry.code, module: entry.module, title: entry.publicMessage, kind: "ENTRY" })
  for (const entry of ERROR_CATALOG) for (const alias of entry.aliases ?? []) push({ code: alias, module: entry.module, title: `Ver ${entry.code}`, kind: "ALIAS" })
  for (const domain of DOMAIN_ERROR_CODES) push({ code: domain.code, module: domain.module, title: domain.messages[0] ?? "", kind: "DOMAIN" })
  return results
}

export { ERROR_CATALOG_VERSION }
