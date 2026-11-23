import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { RESOURCE_SCOPE_LINK_TABLES, resourceScopeOf, type ResourceScope, type ResourceScopeLinksTable } from "../../../shared/domain/scope-links/resource-scope.js"
import { sortLinks, type ScopeLink } from "../../../shared/domain/scope-links/scope-links.js"
import { coversOrganization, resolveScopeLinksForWrite, SCOPE_LINK_FAILURE_MESSAGE, type ManageableScopes, type ScopedTarget } from "../../auth/application/manageable-scopes.js"
import { assertNewScopeLinksAdmissible } from "./scope-unit-admission.js"

type Queryable = Pick<Database, "query">

/** Vínculos gravados de vários recursos de uma vez (uma consulta). Recurso sem vínculo = lista vazia. */
export async function loadResourceScopeLinks(db: Queryable, kind: ResourceScopeLinksTable, ids: readonly string[]): Promise<Map<string, ScopeLink[]>> {
  const result = new Map<string, ScopeLink[]>(ids.map((id) => [id, []]))
  if (ids.length === 0) return result
  const { table, ownerColumn } = RESOURCE_SCOPE_LINK_TABLES[kind]
  const rows = await db.query<{ owner_id: string; team_id: string; subteam_id: string | null }>(`select ${ownerColumn} owner_id, team_id, subteam_id from ${table} where ${ownerColumn} = any($1::uuid[])`, [[...new Set(ids)]])
  for (const row of rows.rows) result.get(row.owner_id)?.push({ teamId: row.team_id, subteamId: row.subteam_id })
  for (const [id, links] of result) result.set(id, sortLinks(links))
  return result
}

/** Alcance gravado de um recurso (coluna `scope_type` + vínculos). */
export async function loadResourceScope(db: Queryable, kind: ResourceScopeLinksTable, id: string, scopeType: string): Promise<ResourceScope> {
  if (scopeType === "ALL_TEAMS") return { scopeType: "ALL_TEAMS", links: [] }
  return { scopeType: "GROUPS", links: (await loadResourceScopeLinks(db, kind, [id])).get(id) ?? [] }
}

/** Substitui os vínculos gravados (na transação de quem chama). ALL_TEAMS = nenhum vínculo. */
export async function replaceResourceScopeLinks(db: Queryable, kind: ResourceScopeLinksTable, organizationId: string, ownerId: string, scope: ResourceScope): Promise<void> {
  const { table, ownerColumn } = RESOURCE_SCOPE_LINK_TABLES[kind]
  await db.query(`delete from ${table} where ${ownerColumn} = $1`, [ownerId])
  if (scope.scopeType === "GROUPS" && scope.links.length > 0) {
    await db.query(
      `insert into ${table} (${ownerColumn}, organization_id, team_id, subteam_id) select $1, $2, t, s from unnest($3::uuid[], $4::uuid[]) as u(t, s)`,
      [ownerId, organizationId, scope.links.map((link) => link.teamId), scope.links.map((link) => link.subteamId)],
    )
  }
}

/** Alcance → `ScopedTarget` (gestão e compatibilidade entre recursos: `canManageScope`, `scopesAreCompatible`). */
export const scopedTargetOf = (scope: ResourceScope): ScopedTarget => (scope.scopeType === "ALL_TEAMS" ? { scopeType: "ALL_TEAMS", teamId: null, subteamId: null } : { scopeType: "GROUPS", teamId: null, subteamId: null, links: scope.links })

export type ResourceScopeInput = { scopeType?: string | null | undefined; teamId?: string | null | undefined; subteamId?: string | null | undefined; scopeLinks?: readonly { teamId?: string | null; subteamId?: string | null }[] | null | undefined }

/**
 * Alcance pedido numa ESCRITA de Agente/Orquestrador/Workflow/Indicador/Produto, pronto para gravar (backend é a autoridade):
 *   - ALL_TEAMS só com escopo de organização na permissão da tela;
 *   - GROUPS: Grupo-pai real de cada Subgrupo, sem duplicata nem Subgrupo junto do próprio Grupo inteiro, ao menos um vínculo, TODOS
 *     no escopo de quem edita; e os vínculos NOVOS (fora de `previous`) do universo do recurso e com operador em produção;
 *   - o formato legado (TEAM/SUBTEAM + ids) continua aceito e vira um vínculo.
 * `codePrefix` dá os códigos do módulo: `<PREFIX>_SCOPE_FORBIDDEN` (403) e `<PREFIX>_SCOPE_INVALID` (422).
 */
export async function resolveResourceScopeForWrite(
  db: Queryable,
  organizationId: string,
  scopes: ManageableScopes,
  input: ResourceScopeInput,
  options: { codePrefix: string; previous?: ResourceScope | null; universe?: string | null; allTeamsMessage?: string },
): Promise<ResourceScope> {
  if (input.scopeType === "ALL_TEAMS") {
    // Manter "todos" num registro que já era "todos" não exige mais do que antes (quem edita já passou pela gestão do registro).
    if (!coversOrganization(scopes) && options.previous?.scopeType !== "ALL_TEAMS") {
      throw new DomainError(options.allTeamsMessage ?? "Só quem administra a organização inteira escolhe “Todos os Grupos e Subgrupos”.", `${options.codePrefix}_SCOPE_FORBIDDEN`, 403)
    }
    return { scopeType: "ALL_TEAMS", links: [] }
  }
  const requested = resourceScopeOf({ scopeType: input.scopeType ?? "GROUPS", teamId: input.teamId ?? null, subteamId: input.subteamId ?? null, scopeLinks: input.scopeLinks ?? [] })
  // SUBTEAM legado sem teamId: o Grupo-pai real vem de `normalizeScopeLinks` (aqui o vínculo vai sem o Grupo).
  const raw = input.scopeType === "SUBTEAM" && input.subteamId && !input.teamId ? [{ teamId: null, subteamId: input.subteamId }] : requested.links
  const resolved = await resolveScopeLinksForWrite(db, organizationId, scopes, raw)
  if (!resolved.ok) {
    throw new DomainError(
      resolved.reason === "EMPTY" ? "Escolha ao menos um Grupo ou Subgrupo — ou “Todos os Grupos e Subgrupos”." : SCOPE_LINK_FAILURE_MESSAGE[resolved.reason],
      resolved.reason === "FORBIDDEN" ? `${options.codePrefix}_SCOPE_FORBIDDEN` : `${options.codePrefix}_SCOPE_INVALID`,
      resolved.reason === "FORBIDDEN" ? 403 : 422,
    )
  }
  await assertNewScopeLinksAdmissible(db, organizationId, resolved.links, { previous: options.previous?.links ?? [], universe: options.universe ?? null })
  return { scopeType: "GROUPS", links: resolved.links }
}

/**
 * Códigos que `resolveResourceScopeForWrite` monta pelo `codePrefix` de cada cadastro, escritos por extenso para o catálogo de erros
 * (`errors:catalog` só inventaria códigos literais). Mudou um prefixo? Atualize aqui.
 */
export const RESOURCE_SCOPE_ERROR_CODES = [
  { status: 403, code: "AGENT_SCOPE_FORBIDDEN", message: "Seu escopo de administração não cobre o alcance escolhido para o agente." },
  { status: 422, code: "AGENT_SCOPE_INVALID", message: "Alcance do agente inválido: Grupo ou Subgrupo inexistente, repetido, junto do próprio Grupo inteiro ou nenhum escolhido." },
  { status: 403, code: "ORCHESTRATOR_SCOPE_FORBIDDEN", message: "Seu escopo de administração não cobre o alcance escolhido para o Orquestrador." },
  { status: 422, code: "ORCHESTRATOR_SCOPE_INVALID", message: "Alcance do Orquestrador inválido: Grupo ou Subgrupo inexistente, repetido, junto do próprio Grupo inteiro ou nenhum escolhido." },
  { status: 403, code: "WORKFLOW_SCOPE_FORBIDDEN", message: "Seu escopo de administração não cobre a Abrangência escolhida para o Workflow." },
  { status: 422, code: "WORKFLOW_SCOPE_INVALID", message: "Abrangência do Workflow inválida: Grupo ou Subgrupo inexistente, repetido, junto do próprio Grupo inteiro ou nenhum escolhido." },
  { status: 403, code: "INDICATOR_SCOPE_FORBIDDEN", message: "Só quem administra a organização inteira escolhe “Todos os Grupos e Subgrupos” para o indicador." },
  { status: 422, code: "INDICATOR_SCOPE_INVALID", message: "Alcance do indicador inválido: Grupo ou Subgrupo inexistente, repetido, junto do próprio Grupo inteiro ou nenhum escolhido." },
  { status: 403, code: "PRODUCT_SCOPE_FORBIDDEN", message: "Só quem administra a organização inteira altera o alcance de um produto." },
  { status: 422, code: "PRODUCT_SCOPE_INVALID", message: "Alcance do produto inválido: Grupo ou Subgrupo inexistente, repetido, junto do próprio Grupo inteiro ou nenhum escolhido." },
] as const
