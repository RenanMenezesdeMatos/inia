import type { Database } from "../../../infrastructure/database/pool.js"
import type { SqlParams } from "../../../shared/infrastructure/sql-params.js"
import { assertFunnelPeriod } from "../../assistant/application/reply-funnel.js"

/**
 * Filtros comuns a todos os blocos da tela (os MESMOS em cards, gráficos e detalhamentos): período em datas civis no fuso da
 * organização (1 a 92 dias, a regra do funil e do painel do apoio) e Grupo/Subgrupo. Quem lê é sempre a pessoa da sessão; o alcance
 * de cada bloco é o da permissão daquele bloco, decidido no servidor.
 */
export type Queryable = Pick<Database, "query">
export type SuccessViewer = { organizationId: string; personId: string }
export type SuccessQuery = { from: string; to: string; teamId?: string | null | undefined; subteamId?: string | null | undefined }

export function assertSuccessPeriod(query: SuccessQuery) {
  assertFunnelPeriod({ from: query.from, to: query.to })
}

/** Início e fim do período (instantes) no fuso da organização. */
export function boundsCte(p: SqlParams, organizationId: string, query: SuccessQuery): string {
  const org = p.typed(organizationId, "uuid")
  return `bounds as (
    select (${p.typed(query.from, "date")})::timestamp at time zone analytics_org_timezone(${org}) starts,
           (${p.typed(query.to, "date")} + 1)::timestamp at time zone analytics_org_timezone(${org}) ends,
           analytics_org_timezone(${org}) tz
  )`
}

/**
 * Grupo/Subgrupo ATUAL da pessoa `person` (com `subteam` = o Subgrupo dela): quem está num Subgrupo pertence ao Grupo dele — a
 * mesma regra do funil das respostas. Sem filtro = `true`.
 */
export function placementFilter(p: SqlParams, query: SuccessQuery, person = "p", subteam = "st"): string {
  const clauses: string[] = []
  if (query.teamId) {
    const team = p.typed(query.teamId, "uuid")
    clauses.push(`(${person}.team_id = ${team} or ${subteam}.team_id = ${team})`)
  }
  if (query.subteamId) clauses.push(`${person}.subteam_id = ${p.typed(query.subteamId, "uuid")}`)
  return clauses.length > 0 ? clauses.join(" and ") : "true"
}

/** Dia civil local de um instante (texto AAAA-MM-DD), com o fuso de `bounds`. */
export const localDay = (column: string) => `to_char((${column} at time zone b.tz)::date, 'YYYY-MM-DD')`
