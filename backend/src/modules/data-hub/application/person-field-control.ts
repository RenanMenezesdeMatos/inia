import type { Database } from "../../../infrastructure/database/pool.js"
import { emptyPersonFieldControl, PERSON_CONTRACT_KEYS, resolvePersonFieldControl, type PersonFeedApplication, type PersonFieldControl, type SourceManager } from "../domain/person-field-control.js"

/** Feed que ainda escreve: ativo (ou degradado — continua rodando), não excluído, de fonte não pausada nem excluída. */
const LIVE_FEED = `f.status in ('ACTIVE', 'DEGRADED') and f.deleted_at is null and s.status in ('ACTIVE', 'ERROR') and s.deleted_at is null`

/**
 * Quem controla cada campo de cada pessoa (ver `domain/person-field-control.ts`). Conta só o feed que ainda escreve: ativo
 * (ou degradado — continua rodando), não excluído, de uma fonte que não está pausada nem excluída. "Já aplicou a pessoa" =
 * há linhagem `people` desse feed para ela (inserção ou alteração numa carga). Uma consulta para a página inteira.
 */
export async function loadPersonFieldControl(db: Database, organizationId: string, personIds: readonly string[]): Promise<Map<string, PersonFieldControl>> {
  const ids = [...new Set(personIds)]
  const control = new Map<string, PersonFieldControl>()
  if (ids.length === 0) return control
  const result = await db.query<{ person_id: string; feed_id: string; feed_name: string; source_name: string; contract_key: string; authoritative: boolean; mapping: unknown; last_applied_at: Date | string }>(
    `select l.entity_id person_id, f.id feed_id, f.name feed_name, s.name source_name, f.contract_key, f.authoritative, f.mapping, max(l.created_at) last_applied_at
       from data_lineage l
       join data_feeds f on f.id = l.feed_id
       join data_sources s on s.id = f.source_id
      where l.organization_id = $1 and l.entity_type = 'people' and l.entity_id = any($2::uuid[])
        and f.contract_key = any($3::text[]) and ${LIVE_FEED}
      group by l.entity_id, f.id, s.name`,
    [organizationId, ids, PERSON_CONTRACT_KEYS],
  )
  const byPerson = new Map<string, PersonFeedApplication[]>()
  for (const row of result.rows) {
    const applications = byPerson.get(row.person_id) ?? []
    applications.push({ feedId: row.feed_id, feedName: row.feed_name, sourceName: row.source_name, contractKey: row.contract_key, authoritative: row.authoritative, mapping: row.mapping, lastAppliedAt: new Date(row.last_applied_at).toISOString() })
    byPerson.set(row.person_id, applications)
  }
  for (const id of ids) control.set(id, byPerson.has(id) ? resolvePersonFieldControl(byPerson.get(id)!) : emptyPersonFieldControl())
  return control
}

/**
 * Feeds vigentes de um contrato de pessoa (ex.: Colaboradores) na organização — o autoritativo primeiro. Com Colaboradores
 * vigente, quem é da hierarquia entra pela base: o cadastro manual sem matrícula fica só para quem está fora dela.
 */
export async function loadLivePersonFeeds(db: Database, organizationId: string, contractKey: string): Promise<SourceManager[]> {
  const result = await db.query<{ source_name: string; feed_name: string }>(
    `select s.name source_name, f.name feed_name
       from data_feeds f join data_sources s on s.id = f.source_id
      where f.organization_id = $1 and f.contract_key = $2 and ${LIVE_FEED}
      order by f.authoritative desc, f.name, f.id`,
    [organizationId, contractKey],
  )
  return result.rows.map((row) => ({ sourceName: row.source_name, feedName: row.feed_name }))
}
