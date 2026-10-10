import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { BUSINESS_DOMAIN_CODE_PATTERN, describeBusinessDomain, domainRefFromRecord, type BusinessDomainRef } from "../domain/business-domain.js"

/**
 * O ÚNICO jeito de os consumidores (Agents, Orquestradores) lerem e resolverem domínios de
 * negócio — fragmentos SQL e validações centralizados para que ninguém consulte
 * `business_domains` de um jeito diferente (Parte F/33 do pedido).
 */
type Queryable = { query: Database["query"] }

/** Colunas do domínio de um Agent (dual-read em `resolveAgentSpecialty`): usa `left join` abaixo. */
export function agentBusinessDomainColumns(domainAlias = "bd"): string {
  return `${domainAlias}.id "business_domain_id", ${domainAlias}.code "business_domain_code", ${domainAlias}.name "business_domain_name", ${domainAlias}.active "business_domain_active"`
}

export function agentBusinessDomainJoin(agentAlias: string, domainAlias = "bd"): string {
  return `left join business_domains ${domainAlias} on ${domainAlias}.id = ${agentAlias}.business_domain_id`
}

/** Objeto JSON `{id, code, name, active}` (ou null) do domínio de um Agent — pra respostas de API. */
export function agentBusinessDomainJson(domainAlias = "bd"): string {
  return `case when ${domainAlias}.id is null then null else json_build_object('id', ${domainAlias}.id, 'code', ${domainAlias}.code, 'name', ${domainAlias}.name, 'active', ${domainAlias}.active) end`
}

/** Array JSON dos domínios de um Orquestrador (relação nova) — dual-read em `resolveRoutingPolicy`. */
export function orchestratorBusinessDomainsJson(orchestratorAlias: string): string {
  return `coalesce((
      select json_agg(json_build_object('id', bd.id, 'code', bd.code, 'name', bd.name, 'active', bd.active) order by bd.name)
      from assistant_orchestrator_domains od
      join business_domains bd on bd.id = od.business_domain_id
      where od.orchestrator_id = ${orchestratorAlias}.id
    ), '[]')`
}

export type BusinessDomainSelector = { ids?: readonly string[] | undefined; codes?: readonly string[] | undefined }

/**
 * Ids (forma nova) e/ou códigos (forma legada da API) → referências do catálogo da organização.
 * Id ou código inexistente ⇒ 422 BUSINESS_DOMAIN_NOT_FOUND (nunca criado implicitamente).
 */
export async function resolveBusinessDomainRefs(db: Queryable, organizationId: string, selector: BusinessDomainSelector): Promise<BusinessDomainRef[]> {
  const ids = [...new Set((selector.ids ?? []).filter(Boolean))]
  const codes = [...new Set((selector.codes ?? []).filter((code) => typeof code === "string" && BUSINESS_DOMAIN_CODE_PATTERN.test(code)))]
  const invalidCode = (selector.codes ?? []).find((code) => !BUSINESS_DOMAIN_CODE_PATTERN.test(code))
  if (invalidCode !== undefined) throw new DomainError(`Código de domínio inválido: "${invalidCode}".`, "BUSINESS_DOMAIN_NOT_FOUND", 422)
  if (ids.length === 0 && codes.length === 0) return []
  const result = await db.query<{ id: string; code: string; name: string; active: boolean }>(
    `select id, code, name, active from business_domains where organization_id = $1 and (id = any($2::uuid[]) or code = any($3::text[])) order by name`,
    [organizationId, ids, codes],
  )
  const byId = new Map(result.rows.map((row) => [row.id, row]))
  const byCode = new Map(result.rows.map((row) => [row.code, row]))
  const missingId = ids.find((id) => !byId.has(id))
  if (missingId) throw new DomainError("Um dos domínios de negócio selecionados não existe mais.", "BUSINESS_DOMAIN_NOT_FOUND", 422, { businessDomainId: missingId })
  const missingCode = codes.find((code) => !byCode.has(code))
  if (missingCode) throw new DomainError(`O domínio de negócio "${missingCode}" não existe no catálogo.`, "BUSINESS_DOMAIN_NOT_FOUND", 422, { code: missingCode })
  // Ordem estável: pela ordem em que ids/códigos chegaram (a UI escolhe a ordem de exibição depois).
  const ordered: BusinessDomainRef[] = []
  const seen = new Set<string>()
  for (const row of [...ids.map((id) => byId.get(id)!), ...codes.map((code) => byCode.get(code)!)]) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    ordered.push(domainRefFromRecord(row))
  }
  return ordered
}

/**
 * Domínio INATIVO não entra em configuração NOVA (Agent novo, domínio recém-adicionado a um
 * Orquestrador). O que já estava vinculado antes continua válido — desativar nunca quebra o que
 * existe. `previouslyLinkedCodes` = o que o registro já tinha antes desta edição.
 */
export function assertBusinessDomainsSelectable(refs: readonly BusinessDomainRef[], previouslyLinkedCodes: readonly string[] = []): void {
  const inactive = refs.find((ref) => !ref.active && !previouslyLinkedCodes.includes(ref.code))
  if (inactive) {
    throw new DomainError(`O domínio de negócio "${describeBusinessDomain(inactive)}" está desativado e não pode entrar em novas configurações. Reative-o em Domínios de negócio ou escolha outro.`, "BUSINESS_DOMAIN_INACTIVE", 422, { businessDomainId: inactive.id, code: inactive.code })
  }
}

/** Grava a relação N:N de um Orquestrador (substitui o conjunto inteiro; idempotente). */
export async function syncOrchestratorBusinessDomains(db: Queryable, orchestratorId: string, refs: readonly BusinessDomainRef[]): Promise<void> {
  await db.query(`delete from assistant_orchestrator_domains where orchestrator_id = $1`, [orchestratorId])
  const ids = [...new Set(refs.map((ref) => ref.id).filter((id): id is string => Boolean(id)))]
  if (ids.length === 0) return
  await db.query(`insert into assistant_orchestrator_domains (orchestrator_id, business_domain_id) select $1, unnest($2::uuid[]) on conflict do nothing`, [orchestratorId, ids])
}
