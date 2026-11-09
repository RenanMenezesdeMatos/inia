import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { dateParam, listParam, respondList, searchParam, SqlFilter } from "../../../shared/presentation/list-query.js"

/**
 * REGISTRO DA CENTRAL: quem fez o quê, a partir de `audit_logs`. A exclusão de fonte e de conjunto é lógica, então os nomes continuam
 * disponíveis depois de excluídos. Ficam de fora os eventos que os writers gravam sobre dados de pessoas (ex.: ausência cancelada).
 * `previous` saiu do registro em 05/11/2026 (posição de leitura com valor do cliente): a projeção esconde o que já estava gravado.
 */
export const auditEventsQuerySchema = z.object({
  search: searchParam,
  sourceId: z.string().uuid().optional(),
  feedId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  action: listParam(z.string().regex(/^DATA_HUB_[A-Z_]+$/)),
  createdFrom: dateParam,
  createdTo: dateParam,
})

const UUID_PATTERN = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"

const SELECT_AUDIT_EVENTS = `
  select a.id, a.action, a.actor_id "actorId", p.name "actorName", a.entity_type "entityType", a.entity_id "entityId", a.payload - 'previous' payload, a.created_at "createdAt",
         s.id "sourceId", s.name "sourceName", s.kind "sourceKind", s.deleted_at "sourceDeletedAt", f.id "feedId", f.name "feedName", f.deleted_at "feedDeletedAt"
    from audit_logs a
    left join people p on p.id = a.actor_id
    left join data_ingestion_runs run on a.entity_type = 'data_ingestion_run' and run.id = a.entity_id
    left join data_feeds f on f.id = case when a.entity_type = 'data_feed' then a.entity_id else run.feed_id end
    left join data_sources s on s.organization_id = a.organization_id and s.id = coalesce(
      case when a.entity_type = 'data_source' then a.entity_id end,
      f.source_id,
      run.source_id,
      case when a.payload->>'sourceId' ~ '${UUID_PATTERN}' then (a.payload->>'sourceId')::uuid end)
   where a.organization_id = $1 and a.action like 'DATA_HUB_%' and a.entity_type in ('data_source', 'data_feed', 'data_push_token', 'data_ingestion_run', 'data_explorer')`

/** Consultas somam muitas linhas a cada sessão de uso: ficam fora da lista padrão e aparecem quando a pessoa filtra por essa ação. Exportação e tentativa negada sempre aparecem. */
const EXPLORER_READ_ACTIONS = ["DATA_HUB_EXPLORER_QUERY", "DATA_HUB_EXPLORER_COUNT", "DATA_HUB_EXPLORER_EXPORT_STARTED", "DATA_HUB_RECORDS_CANCEL_PREVIEW", "DATA_HUB_RECORDS_CANCEL_LIST", "DATA_HUB_DELETED_ITEMS_LIST", "DATA_HUB_DELETED_ITEM_RESTORE_PREVIEW", "DATA_HUB_RECORDS_REACTIVATION_PREVIEW"]

export async function listAuditEvents(db: Database, organizationId: string, rawQuery: Record<string, unknown>) {
  const query = auditEventsQuerySchema.parse(rawQuery)
  const filter = new SqlFilter([organizationId])
    .search(query.search, ['q."actorName"', 'q."sourceName"', 'q."feedName"', "q.action"])
    .equals('q."sourceId"', query.sourceId)
    .equals('q."feedId"', query.feedId)
    .equals('q."actorId"', query.actorId)
    .in("q.action", query.action)
    .dateRange('q."createdAt"', query.createdFrom, query.createdTo)
  if (!query.action?.length) filter.add(`q.action <> all(${filter.param(EXPLORER_READ_ACTIONS)}::text[])`)
  return respondList(db, { page: rawQuery.page ?? 1, pageSize: rawQuery.pageSize ?? 20 }, { select: SELECT_AUDIT_EVENTS, filter, orderBy: 'q."createdAt" desc, q.id' })
}

/** Quem cadastrou a fonte e quem mudou por último o que ela é (teste de conexão e carga não contam como alteração). */
const SOURCE_CHANGE_ACTIONS = ["DATA_HUB_SOURCE_CREATED", "DATA_HUB_SOURCE_UPDATED", "DATA_HUB_SECRET_ROTATED", "DATA_HUB_SOURCE_ACTIVATED", "DATA_HUB_SOURCE_PAUSED", "DATA_HUB_SOURCE_RESUMED"]

export type SourceAuthorship = { createdByName: string | null; updatedByName: string | null; lastChangedAt: string | null }

export async function loadSourceAuthorship(db: Pick<Database, "query">, organizationId: string, sourceId: string): Promise<SourceAuthorship> {
  const result = await db.query<{ created_by_name: string | null; updated_by_name: string | null; last_changed_at: Date | null }>(
    `select creator.name created_by_name, updater.name updated_by_name, last_change.created_at last_changed_at
       from data_sources s
       left join people creator on creator.id = s.created_by
       left join people updater on updater.id = s.updated_by
       left join lateral (
         select a.created_at from audit_logs a
          where a.organization_id = s.organization_id and a.entity_type = 'data_source' and a.entity_id = s.id and a.action = any($3::text[])
          order by a.created_at desc limit 1
       ) last_change on true
      where s.organization_id = $1 and s.id = $2`,
    [organizationId, sourceId, SOURCE_CHANGE_ACTIONS],
  )
  const row = result.rows[0]
  return { createdByName: row?.created_by_name ?? null, updatedByName: row?.updated_by_name ?? null, lastChangedAt: row?.last_changed_at?.toISOString() ?? null }
}
