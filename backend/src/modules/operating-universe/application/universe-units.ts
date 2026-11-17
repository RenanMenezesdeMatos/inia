import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { isUniverseEnforced } from "./universe-access.js"
import type { OperatingUniverse } from "../domain/operating-universe.js"

/**
 * UNIVERSO DE GRUPOS E SUBGRUPOS (migration 204) — a fonte normal do universo do operador: declarado no Grupo (carga de Grupos), no
 * Subgrupo só quando difere do Grupo-pai, e herdado pelos operadores (o banco recalcula; exceção da pessoa continua valendo). Catálogo
 * da organização: classificar exige `configuration.manage` na organização inteira (checado na rota). Campo que a carga da Central
 * manda (feed vigente com `operatingUniverse` mapeado que já aplicou o Grupo) é da base: corrige-se na origem.
 */
type Queryable = Pick<Database, "query">
type UnitKind = "TEAM" | "SUBTEAM"
type Actor = { organizationId: string; sub: string; personId: string }

const LIVE_FEED = `f.status in ('ACTIVE', 'DEGRADED') and f.deleted_at is null and s.status in ('ACTIVE', 'ERROR') and s.deleted_at is null`

export type UniverseUnit = {
  kind: UnitKind
  id: string
  name: string
  parentName: string | null
  operatingUniverse: OperatingUniverse | null
  /** Operadores ativos que herdam deste Grupo/Subgrupo (sem exceção própria) e, deles, quantos estão sem universo resolvido. */
  operators: number
  operatorsPending: number
  /** Feed da Central que manda no universo deste Grupo/Subgrupo (null = editável na INIA). */
  managedBy: { sourceName: string; feedName: string } | null
}

async function sourceManagers(db: Queryable, organizationId: string, kind: UnitKind): Promise<Map<string, { sourceName: string; feedName: string }>> {
  const rows = (await db.query<{ entity_id: string; source_name: string; feed_name: string }>(
    `select distinct on (l.entity_id) l.entity_id, s.name source_name, f.name feed_name
       from data_lineage l join data_feeds f on f.id = l.feed_id join data_sources s on s.id = f.source_id
      where l.organization_id = $1 and l.entity_type = $2 and f.contract_key = $3 and ${LIVE_FEED}
        and exists (select 1 from jsonb_array_elements(coalesce(f.mapping -> 'fields', '[]'::jsonb)) m where m ->> 'target' = 'operatingUniverse')
      order by l.entity_id, f.authoritative desc, l.created_at desc`,
    [organizationId, kind === "TEAM" ? "teams" : "subteams", kind === "TEAM" ? "GROUPS" : "SUBGROUPS"],
  )).rows
  return new Map(rows.map((row) => [row.entity_id, { sourceName: row.source_name, feedName: row.feed_name }]))
}

export async function listUniverseUnits(db: Queryable, organizationId: string): Promise<UniverseUnit[]> {
  const [teams, subteams, teamSources, subteamSources] = await Promise.all([
    db.query<{ id: string; name: string; operating_universe: OperatingUniverse | null; operators: string; pending: string }>(
      `select t.id, t.name, t.operating_universe,
              count(p.id) filter (where p.subteam_id is null or st.operating_universe is null)::text operators,
              count(p.id) filter (where p.operating_universe is null)::text pending
         from teams t
         left join people p on p.team_id = t.id and p.active and p.role = 'OPERATOR' and p.operating_universe_override is null
         left join subteams st on st.id = p.subteam_id
        where t.organization_id = $1
        group by t.id order by (t.operating_universe is null) desc, t.name`,
      [organizationId],
    ),
    db.query<{ id: string; name: string; parent_name: string; operating_universe: OperatingUniverse | null; operators: string; pending: string }>(
      `select st.id, st.name, t.name parent_name, st.operating_universe,
              count(p.id)::text operators, count(p.id) filter (where p.operating_universe is null)::text pending
         from subteams st join teams t on t.id = st.team_id
         left join people p on p.subteam_id = st.id and p.active and p.role = 'OPERATOR' and p.operating_universe_override is null
        where st.organization_id = $1
        group by st.id, t.name order by t.name, st.name`,
      [organizationId],
    ),
    sourceManagers(db, organizationId, "TEAM"),
    sourceManagers(db, organizationId, "SUBTEAM"),
  ])
  return [
    ...teams.rows.map((row) => ({ kind: "TEAM" as const, id: row.id, name: row.name, parentName: null, operatingUniverse: row.operating_universe, operators: Number(row.operators), operatorsPending: Number(row.pending), managedBy: teamSources.get(row.id) ?? null })),
    ...subteams.rows.map((row) => ({ kind: "SUBTEAM" as const, id: row.id, name: row.name, parentName: row.parent_name, operatingUniverse: row.operating_universe, operators: Number(row.operators), operatorsPending: Number(row.pending), managedBy: subteamSources.get(row.id) ?? null })),
  ]
}

/**
 * Classifica um Grupo ou Subgrupo (null = sem universo; no Subgrupo, volta a herdar do Grupo). Recusa: campo da base (422), vigência
 * futura (422), unidade de onde quem pede herda o próprio universo (403), Grupo/Subgrupo com operadores ficando sem universo depois da
 * ativação (422). O banco recalcula os operadores e grava a vigência.
 */
export async function classifyUniverseUnit(db: Database, actor: Actor, kind: UnitKind, id: string, universe: OperatingUniverse | null, effectiveFrom: string | null) {
  // Vigência futura não acontece (o banco aplicaria agora e a tela mostraria uma data que não houve): recusa. Compara com a data de
  // hoje em UTC — no Brasil (UTC−3/−5) o "hoje" local nunca é posterior a ela.
  if (effectiveFrom !== null && effectiveFrom > new Date().toISOString().slice(0, 10)) {
    throw new DomainError("A data de vigência do universo não pode ser futura.", "OPERATING_UNIVERSE_EFFECTIVE_FROM_FUTURE", 422)
  }
  const table = kind === "TEAM" ? "teams" : "subteams"
  const current = (await db.query<{ operating_universe: string | null }>(`select operating_universe from ${table} where id = $1 and organization_id = $2`, [id, actor.organizationId])).rows[0]
  if (!current) throw new DomainError(kind === "TEAM" ? "Grupo não encontrado." : "Subgrupo não encontrado.", "OPERATING_UNIVERSE_UNIT_NOT_FOUND", 404)
  const managed = (await sourceManagers(db, actor.organizationId, kind)).get(id)
  if (managed) throw new DomainError(`O universo deste ${kind === "TEAM" ? "Grupo" : "Subgrupo"} vem da base ${managed.sourceName} · ${managed.feedName} — altere na origem.`, "OPERATING_UNIVERSE_MANAGED_BY_SOURCE", 422, { managedBy: managed })
  if (current.operating_universe === universe) return { kind, id, operatingUniverse: universe, changed: false }
  // Ninguém muda o próprio universo (mesma regra da ficha e do lote): reclassificar o Grupo/Subgrupo de onde a pessoa herda também
  // mudaria o dela — outra pessoa autorizada precisa fazer isso. Com exceção própria (ou, no Grupo, Subgrupo com universo próprio), o
  // universo dela não depende desta unidade.
  const self = (await db.query<{ n: string }>(
    `select count(*)::text n from people where id = $1 and organization_id = $2 and operating_universe_override is null and ${kind === "TEAM" ? "team_id = $3 and resolve_person_operating_universe(null, null, subteam_id) is null" : "subteam_id = $3"}`,
    [actor.personId, actor.organizationId, id],
  )).rows[0]!.n
  if (Number(self) > 0) {
    throw new DomainError(`Você herda o universo deste ${kind === "TEAM" ? "Grupo" : "Subgrupo"}: reclassificá-lo mudaria o seu próprio universo — outra pessoa autorizada precisa fazer isso.`, "PEOPLE_SELF_CHANGE_FORBIDDEN", 403)
  }
  if (universe === null && (await isUniverseEnforced(db, actor.organizationId))) {
    // Operadores sem exceção que ficariam sem universo: no Grupo, os que não têm Subgrupo com universo próprio; no Subgrupo, os que
    // voltariam a herdar de um Grupo sem universo.
    const orphanSql = kind === "TEAM"
      ? `select count(*)::text n from people where organization_id = $2 and team_id = $1 and active and role = 'OPERATOR' and operating_universe_override is null and resolve_person_operating_universe(null, null, subteam_id) is null`
      : `select count(*)::text n from people where organization_id = $2 and subteam_id = $1 and active and role = 'OPERATOR' and operating_universe_override is null and resolve_person_operating_universe(null, team_id, null) is null`
    const orphaned = (await db.query<{ n: string }>(orphanSql, [id, actor.organizationId])).rows[0]!.n
    if (Number(orphaned) > 0) throw new DomainError(`Com a exigência ativa, ${orphaned} operador(es) deste ${kind === "TEAM" ? "Grupo" : "Subgrupo"} ficariam sem universo.`, "OPERATING_UNIVERSE_REQUIRED", 422)
  }
  return inTransaction(db, async (client) => {
    await client.query(`update ${table} set operating_universe = $3, operating_universe_effective_from = $4 where id = $1 and organization_id = $2`, [id, actor.organizationId, universe, effectiveFrom])
    await client.query(
      `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'OPERATING_UNIVERSE_UNIT_CLASSIFIED', $3, $4, $5::jsonb)`,
      [actor.organizationId, actor.personId, table, id, JSON.stringify({ kind, from: current.operating_universe, to: universe, effectiveFrom, actorAccountId: actor.sub })],
    )
    return { kind, id, operatingUniverse: universe, changed: true }
  })
}
