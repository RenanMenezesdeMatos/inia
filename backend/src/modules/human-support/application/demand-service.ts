import { loadPersonPresentations } from "../../profile-preferences/application/person-presentation-loader.js"
import { demandOf, type Demand, type DemandRecord, type Productivity } from "../domain/demand.js"
import type { RequestEndCause, RequestStatus } from "../domain/catalogs.js"
import { assertPanelPeriod, coordinatorScopesOf, coverageClause, periodBounds } from "./coverage.js"
import type { Queryable } from "./locks.js"
import type { Viewer } from "./request-service.js"

/**
 * ACIONAMENTOS DO PERÍODO (regra em `domain/demand.ts`): os pedidos criados no período, no alcance de quem lê (Coordenador de Anjos e
 * Administrador geral) e no filtro de Grupo/Subgrupo; hora e dia na hora local da organização; espera até o PRIMEIRO acolhimento.
 */
export type DemandQuery = { from: string; to: string; teamId?: string | undefined; subteamId?: string | undefined; productivity?: Productivity | undefined }

export async function supportDemand(db: Queryable, viewer: Viewer, query: DemandQuery): Promise<Demand & { period: { from: string; to: string } }> {
  assertPanelPeriod(query)
  const coverage = await coordinatorScopesOf(db, viewer.organizationId, viewer.personId)
  const params: unknown[] = [viewer.organizationId, query.from, query.to]
  const bounds = periodBounds("$1", "$2", "$3")
  const where = coverageClause(coverage, "r", params, { teamId: query.teamId, subteamId: query.subteamId })
  const [rows, days] = await Promise.all([
    db.query<{ status: RequestStatus; end_cause: RequestEndCause | null; anjos_in_service_at_end: number | null; operator_person_id: string; team_id: string | null; team_name: string | null; subteam_id: string | null; subteam_name: string | null; hour: number; day: string; wait_seconds: number | null; productivity: Productivity; had_attendance: boolean }>(
      `select r.status, r.end_cause, r.anjos_in_service_at_end, r.operator_person_id, r.team_id, t.name team_name, r.subteam_id, st.name subteam_name,
              extract(hour from r.created_at at time zone analytics_org_timezone($1))::int "hour",
              to_char((r.created_at at time zone analytics_org_timezone($1))::date, 'YYYY-MM-DD') "day",
              extract(epoch from (select min(a.started_at) from human_support_attendances a where a.request_id = r.id) - r.created_at)::float8 wait_seconds,
              exists (select 1 from human_support_attendances a where a.request_id = r.id) had_attendance,
              case when exists (select 1 from human_support_classifications c join human_support_attendances a on a.id = c.attendance_id where a.request_id = r.id and c.pertinence = 'PERTINENT') then 'PRODUCTIVE'
                   when exists (select 1 from human_support_classifications c join human_support_attendances a on a.id = c.attendance_id where a.request_id = r.id and c.pertinence = 'NOT_PERTINENT') then 'NOT_PRODUCTIVE'
                   else 'NOT_EVALUATED' end productivity
         from human_support_requests r
         left join teams t on t.id = r.team_id
         left join subteams st on st.id = r.subteam_id
        where r.organization_id = $1 and r.created_at >= ${bounds.start} and r.created_at < ${bounds.end} and ${where}`,
      params,
    ),
    db.query<{ day: string }>(`select to_char(g::date, 'YYYY-MM-DD') "day" from generate_series($1::date, $2::date, interval '1 day') g order by g`, [query.from, query.to]),
  ])
  const records: DemandRecord[] = rows.rows.map((row) => ({
    status: row.status,
    endCause: row.end_cause,
    hadAttendance: row.had_attendance,
    anjosInServiceAtEnd: row.anjos_in_service_at_end === null ? null : Number(row.anjos_in_service_at_end),
    operatorPersonId: row.operator_person_id,
    teamId: row.team_id,
    teamName: row.team_name,
    subteamId: row.subteam_id,
    subteamName: row.subteam_name,
    hour: Number(row.hour),
    day: row.day,
    waitSeconds: row.wait_seconds === null ? null : Math.max(0, Number(row.wait_seconds)),
    productivity: row.productivity,
  }))
  const names = await loadPersonPresentations(db, viewer.organizationId, [...new Set(records.map((record) => record.operatorPersonId))])
  return { period: { from: query.from, to: query.to }, ...demandOf(records, days.rows.map((row) => row.day), query.productivity ?? null, (personId) => names.get(personId)?.displayName ?? "Operador") }
}
