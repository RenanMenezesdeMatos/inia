import { unitFilterSql } from "../../../shared/infrastructure/database/unit-filter.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { foldedLikeWords, foldSql } from "../../../shared/infrastructure/database/text-search.js"

/**
 * OPÇÕES DE GRUPO, SUBGRUPO E PESSOA das telas de acompanhamento (Equipe, Calendário, Conversas, Diagnóstico, Monitoria…), em lotes.
 * Cada tela diz QUEM o leitor alcança por uma subconsulta (`reach`: `person_id`, `team_id`, `subteam_id`) com a própria regra de acesso;
 * aqui ficam a busca (sem maiúsculas nem acentos, palavra a palavra), o encadeamento Grupo → Subgrupo → pessoa, a ordenação estável
 * (nome + id) e o cursor, tudo no SQL e ANTES do limite. Fora do alcance nada volta, nem por `ids`.
 */
export type ScopedOptionKind = "TEAM" | "SUBTEAM" | "PERSON"
export type OptionsCursor = { name: string; id: string }
export type ScopedOption = {
  kind: ScopedOptionKind
  id: string
  name: string
  /** No Subgrupo e na pessoa: o Grupo — mostrado para diferenciar nomes iguais. */
  teamId: string | null
  teamName: string | null
  subteamId: string | null
  subteamName: string | null
  operatingUniverse: string | null
  /** Só na pessoa, e só nas telas que pedem (`matricula: true`): matrícula é o login de rede (run-13 CFA-03). */
  matricula: string | null
  /** Só na pessoa. */
  role: string | null
  jobTitle: string | null
}

/**
 * Quem o leitor alcança: `select` com `person_id`, `team_id`, `subteam_id` e, se a tela precisar, as CTEs dela em `with` (a cláusula
 * inteira, "with …"). Os parâmetros da tela começam em $1.
 */
export type OptionsReach = { with?: string; select: string; params: readonly unknown[] }

export type ScopedOptionsRequest = {
  kind: ScopedOptionKind
  search?: string | undefined
  /** Subgrupos e pessoas destes Grupos; pessoas destes Subgrupos (a regra de `unit-filter.ts`). */
  teamId?: readonly string[] | undefined
  subteamId?: readonly string[] | undefined
  cursor?: OptionsCursor | undefined
  limit: number
  ids?: readonly string[] | undefined
}

/** Alcance a partir de pessoas já conhecidas (telas que carregam a estrutura visível em memória). */
export function reachOfPeople(personIds: readonly string[]): OptionsReach {
  return { select: "select rp.id person_id, rp.team_id, rp.subteam_id from people rp where rp.id = any($1::uuid[])", params: [[...personIds]] }
}

type Row = { id: string; name: string; team_id: string | null; team_name: string | null; subteam_id: string | null; subteam_name: string | null; operating_universe: string | null; matricula: string | null; role: string | null; job_title: string | null; sort_name: string }

const PERSON_FROM = "people p left join teams t on t.id = p.team_id left join subteams st on st.id = p.subteam_id"
const shapeOf = (kind: ScopedOptionKind, matricula: boolean) => SHAPE[kind === "PERSON" && matricula ? "PERSON_WITH_MATRICULA" : kind]
const SHAPE: Record<ScopedOptionKind | "PERSON_WITH_MATRICULA", { alias: string; column: string; haystack: string; columns: string; from: string }> = {
  TEAM: {
    alias: "t", column: "team_id", haystack: "t.name",
    columns: "t.id, t.name, null::uuid team_id, null::text team_name, null::uuid subteam_id, null::text subteam_name, t.operating_universe, null::text matricula, null::text role, null::text job_title",
    from: "teams t",
  },
  SUBTEAM: {
    alias: "s", column: "subteam_id", haystack: "t.name || ' ' || s.name",
    columns: "s.id, s.name, t.id team_id, t.name team_name, null::uuid subteam_id, null::text subteam_name, coalesce(s.operating_universe, t.operating_universe) operating_universe, null::text matricula, null::text role, null::text job_title",
    from: "subteams s join teams t on t.id = s.team_id",
  },
  PERSON: {
    alias: "p", column: "person_id", haystack: "p.name",
    columns: "p.id, p.name, t.id team_id, t.name team_name, st.id subteam_id, st.name subteam_name, p.operating_universe, null::text matricula, p.role, p.job_title",
    from: PERSON_FROM,
  },
  PERSON_WITH_MATRICULA: {
    alias: "p", column: "person_id", haystack: "p.name || ' ' || coalesce(p.matricula, '')",
    columns: "p.id, p.name, t.id team_id, t.name team_name, st.id subteam_id, st.name subteam_name, p.operating_universe, p.matricula, p.role, p.job_title",
    from: PERSON_FROM,
  },
}

export async function listScopedOptions(db: Pick<Database, "query">, organizationId: string, reach: OptionsReach, request: ScopedOptionsRequest, options: { matricula?: boolean | undefined } = {}): Promise<{ items: ScopedOption[]; nextCursor: OptionsCursor | null }> {
  const params: unknown[] = [...reach.params]
  const add = (value: unknown) => `$${params.push(value)}`
  const { alias, column, haystack, columns, from } = shapeOf(request.kind, options.matricula === true)
  // Entre Subgrupos de nome igual, o Grupo ordena (o id só desempata).
  const sortName = foldSql(request.kind === "SUBTEAM" ? "s.name || ' ' || t.name" : `${alias}.name`)
  const where = [`${alias}.organization_id = ${add(organizationId)}::uuid`]
  const reachWhere = [`r.${column} is not null`]
  if (request.ids) {
    where.push(`${alias}.id = any(${add([...request.ids])}::uuid[])`)
  } else {
    if (request.kind === "SUBTEAM" && request.teamId?.length) where.push(`s.team_id = any(${add([...request.teamId])}::uuid[])`)
    const units = request.kind === "PERSON" ? unitFilterSql(request, add, { team: "r.team_id", subteam: "r.subteam_id" }) : null
    if (units) reachWhere.push(units)
    for (const word of foldedLikeWords(request.search)) where.push(`${foldSql(haystack)} like ${add(word)}`)
    if (request.cursor) where.push(`(${sortName}, ${alias}.id) > (${add(request.cursor.name)}::text, ${add(request.cursor.id)}::uuid)`)
  }
  where.push(`${alias}.id in (select r.${column} from reach r where ${reachWhere.join(" and ")})`)
  const limit = add(request.ids ? Math.max(request.ids.length, 1) : request.limit + 1)
  const result = await db.query<Row>(
    `${reach.with ? `${reach.with},` : "with"} reach as (${reach.select})
     select ${columns}, ${sortName} sort_name from ${from} where ${where.join(" and ")} order by ${sortName}, ${alias}.id limit ${limit}`,
    params,
  )
  const rows = request.ids ? result.rows : result.rows.slice(0, request.limit)
  const last = rows[rows.length - 1]
  return {
    items: rows.map((row): ScopedOption => ({ kind: request.kind, id: row.id, name: row.name, teamId: row.team_id, teamName: row.team_name, subteamId: row.subteam_id, subteamName: row.subteam_name, operatingUniverse: row.operating_universe, matricula: row.matricula, role: row.role, jobTitle: row.job_title })),
    nextCursor: !request.ids && result.rows.length > request.limit && last ? { name: last.sort_name, id: last.id } : null,
  }
}
