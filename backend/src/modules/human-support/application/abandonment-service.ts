import { abandonmentOf, type Abandonment } from "../domain/abandonment.js"
import type { AttendanceEndCause, LostCause, RequestEndCause, RequestStatus } from "../domain/catalogs.js"
import { assertPanelPeriod, coordinatorScopesOf, coverageClause, periodBounds } from "./coverage.js"
import type { Queryable } from "./locks.js"
import type { Viewer } from "./request-service.js"

/**
 * ABANDONOS (regra em `domain/abandonment.ts`) no alcance de quem lê (Coordenador de Anjos e Administrador geral) e no filtro de
 * Grupo/Subgrupo: pedidos que ENTRARAM na fila no recorte e atendimentos ACOLHIDOS no recorte, pelo dia civil da organização. A
 * Monitoria Online pede o dia de hoje; Indicadores, o período escolhido.
 */
export type AbandonmentQuery = { from: string; to: string; teamId?: string | undefined; subteamId?: string | undefined }

export async function supportAbandonment(db: Queryable, viewer: Viewer, query: AbandonmentQuery): Promise<Abandonment & { period: { from: string; to: string } }> {
  assertPanelPeriod(query)
  const coverage = await coordinatorScopesOf(db, viewer.organizationId, viewer.personId)
  const params: unknown[] = [viewer.organizationId, query.from, query.to]
  const bounds = periodBounds("$1", "$2", "$3")
  const where = coverageClause(coverage, "r", params, { teamId: query.teamId, subteamId: query.subteamId }, "operator_person_id")
  const [requests, attendances] = await Promise.all([
    db.query<{ status: RequestStatus; end_cause: RequestEndCause | null }>(
      `select r.status, r.end_cause from human_support_requests r where r.organization_id = $1 and r.created_at >= ${bounds.start} and r.created_at < ${bounds.end} and ${where}`,
      params,
    ),
    db.query<{ end_cause: AttendanceEndCause | null; lost_cause: LostCause | null; responded: boolean; last_author: "ANJO" | "OPERATOR" | null }>(
      `select a.end_cause, a.lost_cause, a.first_anjo_message_at is not null responded,
              (select m.author_kind from human_support_messages m where m.request_id = a.request_id and m.attendance_id = a.id and m.author_kind in ('ANJO', 'OPERATOR') order by m.seq desc limit 1) last_author
         from human_support_attendances a join human_support_requests r on r.id = a.request_id
        where a.organization_id = $1 and a.started_at >= ${bounds.start} and a.started_at < ${bounds.end} and ${where}`,
      params,
    ),
  ])
  return {
    period: { from: query.from, to: query.to },
    ...abandonmentOf(
      requests.rows.map((row) => ({ status: row.status, endCause: row.end_cause })),
      attendances.rows.map((row) => ({ endCause: row.end_cause, lostCause: row.lost_cause, anjoResponded: row.responded, lastHumanAuthor: row.last_author })),
    ),
  }
}
