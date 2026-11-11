import { coordinatorScopesOf, coverageClause, periodBounds } from "./coverage.js"
import type { Queryable } from "./locks.js"
import type { Viewer } from "./request-service.js"
import type { PanelQuery } from "./coordination-service.js"

/**
 * CONTAGENS DO APOIO POR DIA (data civil no fuso da organização), no MESMO alcance e com o MESMO filtro do painel (`supportFunnel`): pedidos
 * criados por origem e atendimentos classificados por motivo (data de início do atendimento). É a evolução que os Indicadores de sucesso
 * da INIA desenham; a soma dos dias bate com M8 e M14 (prova `inia-success-proof`). Fica neste módulo porque só ele cita as tabelas
 * `human_support_*` (teste de isolamento).
 */
export type SupportDayRow = { day: string; kind: "REQUEST" | "CLASSIFICATION"; key: string; total: number }

export async function supportDailyCounts(db: Queryable, viewer: Viewer, query: PanelQuery): Promise<SupportDayRow[]> {
  const coverage = await coordinatorScopesOf(db, viewer.organizationId, viewer.personId)
  const filter = { teamId: query.teamId ?? null, subteamId: query.subteamId ?? null }
  const requestParams: unknown[] = [viewer.organizationId, query.from, query.to]
  const requestClause = coverageClause(coverage, "r", requestParams, filter)
  const bounds = periodBounds("$1", "$2", "$3")
  const tz = "analytics_org_timezone($1)"
  const [requests, classifications] = await Promise.all([
    db.query<SupportDayRow>(
      `select to_char((r.created_at at time zone ${tz})::date, 'YYYY-MM-DD') as day, 'REQUEST' kind, r.origin key, count(*)::int total
         from human_support_requests r
        where r.organization_id = $1 and r.created_at >= ${bounds.start} and r.created_at < ${bounds.end} and ${requestClause}
        group by 1, 3`,
      requestParams,
    ),
    (() => {
      const params: unknown[] = [viewer.organizationId, query.from, query.to]
      const clause = coverageClause(coverage, "r", params, filter)
      return db.query<SupportDayRow>(
        `select to_char((a.started_at at time zone ${tz})::date, 'YYYY-MM-DD') as day, 'CLASSIFICATION' kind, c.reason key, count(*)::int total
           from human_support_attendances a
           join human_support_requests r on r.id = a.request_id
           join human_support_classifications c on c.attendance_id = a.id
          where a.organization_id = $1 and a.started_at >= ${bounds.start} and a.started_at < ${bounds.end} and ${clause}
          group by 1, 3`,
        params,
      )
    })(),
  ])
  return [...requests.rows, ...classifications.rows]
}

