import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { linkKey, type ScopeLink } from "../../../shared/domain/scope-links/scope-links.js"
import { ineligibleScopeUnits } from "./scope-unit-options.js"

/**
 * ADMISSÃO DE VÍNCULOS NOVOS num alcance (a mesma regra do seletor, no servidor — a API não aceita o que a tela não ofereceria):
 *
 *  1. universo: com o registro classificado num universo, o Grupo inteiro precisa ser daquele universo e o Subgrupo precisa ter
 *     aquele universo efetivo (o dele ou o do Grupo-pai). Grupo/Subgrupo sem universo não entra num registro classificado.
 *     "Todos" de um registro classificado = todos os Grupos e Subgrupos do universo dele, nunca de outro (decisão de 23/11/2026).
 *  2. elegibilidade: ao menos um operador ativo "Em produção" (`ineligibleScopeUnits`).
 *
 * Só os vínculos que o registro ainda NÃO tinha passam por aqui: o vínculo já salvo continua aceito (a edição preserva o que existe,
 * mesmo sem operador em produção ou depois de uma reclassificação), e removido volta a obedecer às regras.
 */
export async function assertNewScopeLinksAdmissible(
  db: Pick<Database, "query">,
  organizationId: string,
  links: readonly ScopeLink[],
  options: { previous?: readonly ScopeLink[]; universe?: string | null } = {},
): Promise<void> {
  const previous = new Set((options.previous ?? []).map(linkKey))
  const added = links.filter((link) => !previous.has(linkKey(link)))
  if (added.length === 0) return
  const universe = options.universe ?? null
  if (universe) await assertScopeLinksInUniverse(db, organizationId, added, universe)
  const ineligible = await ineligibleScopeUnits(db, organizationId, added, { universes: universe ? [universe] : null })
  if (ineligible.length > 0) {
    const names = ineligible.map((unit) => unit.name)
    throw new DomainError(`Sem operadores em produção: ${names.join(", ")}. Só Grupos e Subgrupos com ao menos um operador em produção podem ser escolhidos.`, "SCOPE_UNIT_WITHOUT_PRODUCTION_OPERATORS", 422, { units: names })
  }
}

/**
 * Todos os `links` são do universo `universe` (Grupo inteiro: o dele; Subgrupo: o efetivo). Usado nos vínculos novos e, ao TROCAR o
 * universo de um registro, em todos os vínculos já salvos (run-10 SEA-04): reclassificar nunca deixa vínculo de outro universo para trás.
 */
export async function assertScopeLinksInUniverse(db: Pick<Database, "query">, organizationId: string, links: readonly ScopeLink[], universe: string): Promise<void> {
  if (links.length === 0) return
  const teamIds = [...new Set(links.filter((link) => link.subteamId === null).map((link) => link.teamId))]
  const subteamIds = [...new Set(links.flatMap((link) => (link.subteamId ? [link.subteamId] : [])))]
  const outside = await db.query<{ name: string }>(
    `select t.name from teams t where t.organization_id = $1 and t.id = any($2::uuid[]) and t.operating_universe is distinct from $4
     union all
     select t.name || ' › ' || s.name from subteams s join teams t on t.id = s.team_id
      where s.organization_id = $1 and s.id = any($3::uuid[]) and coalesce(s.operating_universe, t.operating_universe) is distinct from $4`,
    [organizationId, teamIds, subteamIds, universe],
  )
  if (outside.rows.length > 0) {
    const names = outside.rows.map((row) => row.name)
    throw new DomainError(`Fora do universo ${universe} deste cadastro: ${names.join(", ")}. Escolha Grupos e Subgrupos do mesmo universo.`, "SCOPE_UNIT_OUTSIDE_UNIVERSE", 422, { units: names })
  }
}
