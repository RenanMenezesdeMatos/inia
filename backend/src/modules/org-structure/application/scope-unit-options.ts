import type { Database } from "../../../infrastructure/database/pool.js"
import { LEGACY_EMPLOYMENT_STATUSES, EMPLOYMENT_STATUSES, isOperationallyEligibleStatus } from "../../people/domain/employment-status.js"
import type { OperatingUniverse } from "../../operating-universe/domain/operating-universe.js"
import type { ManageableScopes } from "../../auth/application/manageable-scopes.js"

/**
 * OPÇÕES DE GRUPO E SUBGRUPO para os seletores de alcance (busca + paginação no servidor).
 *
 * Elegibilidade para uma NOVA escolha: o Grupo/Subgrupo precisa ter ao menos um OPERADOR ativo com a situação funcional
 * "Em produção" (`isOperationallyEligibleStatus`: `EM_PRODUCAO` e o legado `ACTIVE`). No Grupo contam os operadores ligados a ele
 * diretamente ou por qualquer Subgrupo dele; no Subgrupo, só os daquele Subgrupo. Com universo escolhido, só contam os operadores
 * daquele universo (o universo resolvido da pessoa). Universo, permissão de quem edita e elegibilidade são aplicados no SQL,
 * ANTES da paginação, e a mesma regra vale na validação de vínculos novos (`ineligibleScopeUnits`) — a API nunca aceita uma opção
 * que a tela não ofereceria.
 *
 * `ids` resolve itens já escolhidos (inclusive os que perderam a elegibilidade), para a edição mostrá-los marcados "Sem operadores em
 * produção" e deixar salvar ou remover; fora dessa lista nada inelegível volta.
 */
export type ScopeUnitKind = "TEAM" | "SUBTEAM"
export type ScopeUnitOption = {
  kind: ScopeUnitKind
  id: string
  name: string
  /** Grupo-pai (só no Subgrupo) — mostrado para diferenciar nomes iguais. */
  teamId: string | null
  teamName: string | null
  /** No Grupo, o dele; no Subgrupo, o efetivo (o dele ou o do Grupo-pai). */
  operatingUniverse: string | null
  productionOperators: number
  eligible: boolean
  /** Quem pede pode escolher este item no escopo da permissão (Grupo inteiro: precisa administrar o Grupo). */
  manageable: boolean
}

export const PRODUCTION_STATUSES: readonly string[] = [...EMPLOYMENT_STATUSES, ...LEGACY_EMPLOYMENT_STATUSES].filter((status) => isOperationallyEligibleStatus(status))

/** Comparação sem maiúsculas nem acentos (o mesmo nos dois lados), sem depender da extensão `unaccent`. */
const FROM = "ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ"
const TO = "AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn"
export const foldSql = (expression: string) => `lower(translate(${expression}, '${FROM}', '${TO}'))`
export const foldText = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR")

/**
 * Operadores em produção de um Grupo (direto ou pelos Subgrupos dele) ou de um Subgrupo, opcionalmente só de alguns universos.
 * No Grupo são DOIS ramos indexados (`people.team_id`; Subgrupos do Grupo → `people.subteam_id`), o segundo sem quem já contou pelo
 * `team_id` — nunca um `or` entre os dois, que virava uma varredura de `people` por Grupo antes do LIMIT (run-10 DADOS-01: 14,6 s →
 * 25 ms com 2.000 Grupos × 100 mil pessoas). `productionExistsSql` (filtro) para no primeiro; `productionCountSql` só roda no SELECT.
 */
const productionFilterSql = (statusesParam: string, universesParam: string) => `p.active and p.role = 'OPERATOR'
     and p.current_employment_status = any(${statusesParam}::text[])
     and (${universesParam}::text[] is null or p.operating_universe = any(${universesParam}::text[]))`
const productionBranchesSql = (kind: ScopeUnitKind, unitAlias: string, statusesParam: string, universesParam: string, projection: "1" | "count(*)") => {
  const filter = productionFilterSql(statusesParam, universesParam)
  if (kind === "SUBTEAM") return [`select ${projection} from people p where p.organization_id = ${unitAlias}.organization_id and p.subteam_id = ${unitAlias}.id and ${filter}`]
  return [
    `select ${projection} from people p where p.organization_id = ${unitAlias}.organization_id and p.team_id = ${unitAlias}.id and ${filter}`,
    `select ${projection} from subteams s2 join people p on p.organization_id = s2.organization_id and p.subteam_id = s2.id
      where s2.organization_id = ${unitAlias}.organization_id and s2.team_id = ${unitAlias}.id and p.team_id is distinct from ${unitAlias}.id and ${filter}`,
  ]
}
const productionExistsSql = (kind: ScopeUnitKind, unitAlias: string, statusesParam: string, universesParam: string) =>
  `(${productionBranchesSql(kind, unitAlias, statusesParam, universesParam, "1").map((branch) => `exists (${branch})`).join(" or ")})`
const productionCountSql = (kind: ScopeUnitKind, unitAlias: string, statusesParam: string, universesParam: string) =>
  `(${productionBranchesSql(kind, unitAlias, statusesParam, universesParam, "count(*)").map((branch) => `(${branch})`).join(" + ")})::int`

export type ScopeUnitQuery = {
  organizationId: string
  kind: ScopeUnitKind
  search?: string | undefined
  universes?: readonly OperatingUniverse[] | undefined
  /** Só Subgrupos deste Grupo. */
  teamId?: string | undefined
  /** Só os elegíveis (padrão nas novas escolhas). */
  eligibleOnly: boolean
  /** Só o que a conta administra no escopo da permissão pedida. */
  scopes: ManageableScopes
  cursor?: { name: string; id: string } | undefined
  limit: number
  ids?: readonly string[] | undefined
}

type Row = { id: string; name: string; team_id: string | null; team_name: string | null; operating_universe: string | null; production_operators: number; sort_name: string }

export async function listScopeUnitOptions(db: Pick<Database, "query">, query: ScopeUnitQuery): Promise<{ items: ScopeUnitOption[]; nextCursor: { name: string; id: string } | null }> {
  const params: unknown[] = [query.organizationId, PRODUCTION_STATUSES, query.universes?.length ? [...query.universes] : null]
  const where: string[] = []
  const restricted = !(query.scopes.unrestricted || query.scopes.allTeams)
  const teamIds = query.scopes.unrestricted ? [] : [...query.scopes.teamIds]
  const subteamIds = query.scopes.unrestricted ? [] : [...query.scopes.subteamIds]
  const isTeam = query.kind === "TEAM"
  const unit = isTeam ? "t" : "s"
  const universeExpr = isTeam ? "t.operating_universe" : "coalesce(s.operating_universe, t.operating_universe)"
  const countExpr = productionCountSql(query.kind, unit, "$2", "$3")

  // Escopo de quem pede vale também na consulta por `ids` (run-10 SEA-03): fora dele nada volta — nem nome, nem universo, nem a
  // contagem de operadores. Quem edita um registro precisa administrar todos os vínculos dele, então a edição não perde nada.
  if (restricted) {
    params.push(teamIds)
    const teamsParam = `$${params.length}::uuid[]`
    if (isTeam) where.push(`t.id = any(${teamsParam})`)
    else {
      params.push(subteamIds)
      where.push(`(s.id = any($${params.length}::uuid[]) or s.team_id = any(${teamsParam}))`)
    }
  }
  if (query.ids) {
    // Escolhas já salvas: o nome e a elegibilidade, sem os filtros de universo e de elegibilidade (a edição mostra o que o registro tem).
    params.push([...query.ids])
    where.push(`${unit}.id = any($${params.length}::uuid[])`)
  } else {
    // Universo escolhido: só Grupo/Subgrupo classificados nele (Grupo/Subgrupo sem universo não aparece — regra da hierarquia).
    where.push(`($3::text[] is null or ${universeExpr} = any($3::text[]))`)
    if (query.eligibleOnly) where.push(productionExistsSql(query.kind, unit, "$2", "$3"))
    if (!isTeam && query.teamId) { params.push(query.teamId); where.push(`s.team_id = $${params.length}::uuid`) }
    // Cada palavra da busca precisa aparecer no nome (no Subgrupo, no dele ou no do Grupo-pai): "cobranca tarde" acha "Cobrança › Tarde".
    const words = foldText(query.search?.trim() ?? "").split(/\s+/).filter(Boolean).slice(0, 8)
    for (const word of words) {
      params.push(`%${word.replace(/[\\%_]/g, (match) => `\\${match}`)}%`)
      where.push(`${foldSql(isTeam ? "t.name" : "t.name || ' ' || s.name")} like $${params.length}`)
    }
    if (query.cursor) {
      params.push(query.cursor.name, query.cursor.id)
      where.push(`(${foldSql(`${unit}.name`)}, ${unit}.id) > ($${params.length - 1}::text, $${params.length}::uuid)`)
    }
  }
  params.push(query.ids ? query.ids.length : query.limit + 1)
  const sql = isTeam
    ? `select t.id, t.name, null::uuid team_id, null::text team_name, t.operating_universe, ${countExpr} production_operators, ${foldSql("t.name")} sort_name
         from teams t where t.organization_id = $1 and ${where.join(" and ")}
        order by ${foldSql("t.name")}, t.id limit $${params.length}`
    : `select s.id, s.name, t.id team_id, t.name team_name, ${universeExpr} operating_universe, ${countExpr} production_operators, ${foldSql("s.name")} sort_name
         from subteams s join teams t on t.id = s.team_id and t.organization_id = s.organization_id
        where s.organization_id = $1 and ${where.join(" and ")}
        order by ${foldSql("s.name")}, s.id limit $${params.length}`
  const result = await db.query<Row>(sql, params)
  const rows = query.ids ? result.rows : result.rows.slice(0, query.limit)
  const items = rows.map((row): ScopeUnitOption => ({
    kind: query.kind,
    id: row.id,
    name: row.name,
    teamId: row.team_id,
    teamName: row.team_name,
    operatingUniverse: row.operating_universe,
    productionOperators: row.production_operators,
    eligible: row.production_operators > 0,
    manageable: query.scopes.unrestricted || query.scopes.allTeams || (isTeam ? query.scopes.teamIds.has(row.id) : query.scopes.subteamIds.has(row.id) || (row.team_id !== null && query.scopes.teamIds.has(row.team_id))),
  }))
  const last = rows[rows.length - 1]
  const hasMore = !query.ids && result.rows.length > query.limit
  return { items, nextCursor: hasMore && last ? { name: last.sort_name, id: last.id } : null }
}

/**
 * Vínculos NOVOS (que o registro ainda não tinha) sem operador em produção: a API recusa, com a lista, o que a tela não ofereceria.
 * Vínculo já salvo continua aceito mesmo sem elegibilidade (a edição preserva o que existe).
 */
export async function ineligibleScopeUnits(
  db: Pick<Database, "query">,
  organizationId: string,
  links: readonly { teamId: string; subteamId: string | null }[],
  options: { previous?: readonly { teamId: string; subteamId: string | null }[]; universes?: readonly string[] | null } = {},
): Promise<{ teamId: string; subteamId: string | null; name: string }[]> {
  const previous = new Set((options.previous ?? []).map((link) => `${link.teamId}:${link.subteamId ?? "*"}`))
  const added = links.filter((link) => !previous.has(`${link.teamId}:${link.subteamId ?? "*"}`))
  if (added.length === 0) return []
  const teamIds = [...new Set(added.filter((link) => link.subteamId === null).map((link) => link.teamId))]
  const subteamIds = [...new Set(added.flatMap((link) => (link.subteamId ? [link.subteamId] : [])))]
  const universes = options.universes?.length ? [...options.universes] : null
  const result = await db.query<{ kind: ScopeUnitKind; id: string; name: string; team_id: string }>(
    `select 'TEAM' kind, t.id, t.name, t.id team_id from teams t where t.organization_id = $1 and t.id = any($3::uuid[]) and not ${productionExistsSql("TEAM", "t", "$2", "$5")}
     union all
     select 'SUBTEAM' kind, s.id, t.name || ' › ' || s.name, s.team_id from subteams s join teams t on t.id = s.team_id where s.organization_id = $1 and s.id = any($4::uuid[]) and not ${productionExistsSql("SUBTEAM", "s", "$2", "$5")}`,
    [organizationId, PRODUCTION_STATUSES, teamIds, subteamIds, universes],
  )
  return result.rows.map((row) => ({ teamId: row.team_id, subteamId: row.kind === "SUBTEAM" ? row.id : null, name: row.name }))
}
