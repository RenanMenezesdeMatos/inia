import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * FILTRO DE GRUPO E SUBGRUPO (vários de cada) das listas e dos painéis — uma regra só, para toda tela responder igual:
 *
 *   entra quem está em algum Subgrupo escolhido, ou em algum Grupo escolhido que não tenha Subgrupo escolhido.
 *
 * O Subgrupo REFINA o Grupo dele: "Vendas" + "Vendas › Manhã" = só a Manhã; "Vendas" + "Suporte › Noite" = Vendas inteiro e a Noite.
 * A seleção só estreita o que o leitor já alcança — o escopo é sempre outra cláusula da consulta.
 */
export type OrgUnitFilter = { teamId?: readonly string[] | null | undefined; subteamId?: readonly string[] | null | undefined }

export const hasUnitFilter = (filter: OrgUnitFilter): boolean => Boolean(filter.teamId?.length || filter.subteamId?.length)

/** Grupos escolhidos que nenhum Subgrupo escolhido refina (aceita os dois parâmetros nulos). */
const wholeTeamsSql = (teams: string, subteams: string) => `array(select unnest(${teams}::uuid[]) except select st_f.team_id from subteams st_f where st_f.id = any(${subteams}::uuid[]))`

export type UnitColumns = {
  /** Coluna(s) do Grupo: mais de uma quando o Grupo da pessoa também vem do Subgrupo dela. */
  team: string | readonly string[]
  subteam: string
  /** Alcance de cadastro: o vínculo do Grupo inteiro (sem Subgrupo) também alcança o Subgrupo escolhido dele. */
  wholeParent?: boolean
}

/** A regra em SQL, com os parâmetros já posicionados (nulo = sem escolha daquele tipo). */
export function unitMatchSql(columns: UnitColumns, teams: string, subteams: string): string {
  const teamColumns = typeof columns.team === "string" ? [columns.team] : columns.team
  const parts = [`${columns.subteam} = any(${subteams}::uuid[])`, ...teamColumns.map((column) => `${column} = any(${wholeTeamsSql(teams, subteams)})`)]
  if (columns.wholeParent) parts.push(...teamColumns.map((column) => `(${columns.subteam} is null and ${column} in (select st_p.team_id from subteams st_p where st_p.id = any(${subteams}::uuid[])))`))
  return `(${parts.join(" or ")})`
}

/** O mesmo com os parâmetros fixos da consulta: sem nenhuma escolha, não filtra. */
export const optionalUnitMatchSql = (columns: UnitColumns, teams: string, subteams: string): string =>
  `((${teams}::uuid[] is null and ${subteams}::uuid[] is null) or ${unitMatchSql(columns, teams, subteams)})`

/** Cláusula do filtro, ou `null` sem escolha. `add` registra o valor e devolve o marcador do parâmetro. */
export function unitFilterSql(filter: OrgUnitFilter, add: (value: unknown) => string, columns: UnitColumns): string | null {
  if (!hasUnitFilter(filter)) return null
  return unitMatchSql(columns, add(filter.teamId?.length ? [...filter.teamId] : null), add(filter.subteamId?.length ? [...filter.subteamId] : null))
}

/** Escolha sem os Grupos que um Subgrupo escolhido já refina: vem ANTES de `unitMatcher` (a lista em memória não conhece a estrutura). */
export async function refinedUnits(db: Pick<Database, "query">, filter: OrgUnitFilter): Promise<{ teamId: string[]; subteamId: string[] }> {
  const teamId = [...(filter.teamId ?? [])]
  const subteamId = [...(filter.subteamId ?? [])]
  if (teamId.length === 0 || subteamId.length === 0) return { teamId, subteamId }
  const parents = new Set((await db.query<{ team_id: string }>("select team_id from subteams where id = any($1::uuid[])", [subteamId])).rows.map((row) => row.team_id))
  return { teamId: teamId.filter((id) => !parents.has(id)), subteamId }
}

/**
 * A mesma regra para listas já em memória, com a escolha JÁ refinada (`refinedUnits`). O Grupo de um Subgrupo nunca é deduzido das
 * pessoas da lista: sem ninguém naquele Subgrupo, o Grupo entraria inteiro (run-13 CFQ-01).
 */
export function unitMatcher(filter: OrgUnitFilter): (unit: { teamId: string | null; subteamId: string | null }) => boolean {
  if (!hasUnitFilter(filter)) return () => true
  const subteams = new Set(filter.subteamId ?? [])
  const wholeTeams = new Set(filter.teamId ?? [])
  return (unit) => (unit.subteamId !== null && subteams.has(unit.subteamId)) || (unit.teamId !== null && wholeTeams.has(unit.teamId))
}
