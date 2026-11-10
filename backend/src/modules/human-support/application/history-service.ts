import { loadPersonPresentations } from "../../profile-preferences/application/person-presentation-loader.js"
import type { AttendanceEndCause, ClassificationOutcome, ClassificationReason, EvaluationResolved, RequestOrigin, RequestStatus } from "../domain/catalogs.js"
import { evaluationOpenUntil } from "../domain/evaluation.js"
import type { AnjoAttendanceHistoryItem, MyRequestItem } from "../domain/views.js"
import { decodeListCursor, encodeListCursor } from "./coverage.js"
import type { Queryable } from "./locks.js"
import type { Viewer } from "./request-service.js"

/**
 * HISTÓRICO: os pedidos do próprio operador ("Conversas anteriores › Apoio com Anjo", somente leitura) e os atendimentos do próprio
 * Anjo (D5: ele relê o que atendeu enquanto tiver o papel). Listas por cursor, 30 por página (até 50).
 */
const pageSize = (limit: number | undefined) => Math.min(Math.max(limit ?? 30, 1), 50)

export async function myRequests(db: Queryable, viewer: Viewer, query: { cursor?: string | undefined; limit?: number | undefined }): Promise<{ items: MyRequestItem[]; nextCursor: string | null }> {
  const params: unknown[] = [viewer.organizationId, viewer.personId]
  const cursor = decodeListCursor(query.cursor)
  const where = cursor ? `and (r.created_at, r.id) < ($${params.push(cursor.at)}::timestamptz, $${params.push(cursor.id)}::uuid)` : ""
  const limit = pageSize(query.limit)
  const rows = (
    await db.query<{ id: string; protocol: string; status: RequestStatus; origin: RequestOrigin; created_at: Date; ended_at: Date | null; anjo_person_id: string | null; attendance_ended_at: Date | null; end_cause: AttendanceEndCause | null; resolved: EvaluationResolved | null; stars: number | null }>(
      `select r.id, r.protocol, r.status, r.origin, r.created_at, r.ended_at, last.anjo_person_id, last.ended_at attendance_ended_at, last.end_cause, last.resolved, last.stars
         from human_support_requests r
         left join lateral (
           select a.anjo_person_id, a.ended_at, a.end_cause, e.resolved, e.stars
             from human_support_attendances a left join human_support_evaluations e on e.attendance_id = a.id and e.superseded_at is null
            where a.request_id = r.id order by a.started_at desc limit 1
         ) last on true
        where r.organization_id = $1 and r.operator_person_id = $2 ${where}
        order by r.created_at desc, r.id desc limit ${limit + 1}`,
      params,
    )
  ).rows
  const page = rows.slice(0, limit)
  const names = await loadPersonPresentations(db, viewer.organizationId, page.flatMap((row) => (row.anjo_person_id ? [row.anjo_person_id] : [])))
  const last = page.at(-1)
  return {
    items: page.map((row) => {
      const until = evaluationOpenUntil({ endedAt: row.attendance_ended_at, endCause: row.end_cause })
      return {
        id: row.id,
        protocol: row.protocol,
        status: row.status,
        origin: row.origin,
        createdAt: row.created_at.toISOString(),
        endedAt: row.ended_at?.toISOString() ?? null,
        anjoName: row.anjo_person_id ? (names.get(row.anjo_person_id)?.displayName ?? "Anjo") : null,
        evaluation: row.resolved || row.stars !== null ? { resolved: row.resolved, stars: row.stars === null ? null : Number(row.stars) } : null,
        evaluationOpenUntil: until && until.getTime() > Date.now() ? until.toISOString() : null,
      }
    }),
    nextCursor: rows.length > limit && last ? encodeListCursor(last.created_at, last.id) : null,
  }
}

export async function anjoAttendanceHistory(db: Queryable, viewer: Viewer, query: { cursor?: string | undefined; limit?: number | undefined }): Promise<{ items: AnjoAttendanceHistoryItem[]; nextCursor: string | null }> {
  const params: unknown[] = [viewer.organizationId, viewer.personId]
  const cursor = decodeListCursor(query.cursor)
  const where = cursor ? `and (a.started_at, a.id) < ($${params.push(cursor.at)}::timestamptz, $${params.push(cursor.id)}::uuid)` : ""
  const limit = pageSize(query.limit)
  const rows = (
    await db.query<{ id: string; request_id: string; protocol: string; operator_person_id: string; started_at: Date; first_anjo_message_at: Date | null; ended_at: Date | null; end_cause: AttendanceEndCause | null; reason: ClassificationReason | null; outcome: ClassificationOutcome | null; reference_title: string | null }>(
      `select a.id, a.request_id, r.protocol, a.operator_person_id, a.started_at, a.first_anjo_message_at, a.ended_at, a.end_cause,
              c.reason, c.outcome, c.reference_title
         from human_support_attendances a join human_support_requests r on r.id = a.request_id
         left join human_support_classifications c on c.attendance_id = a.id
        where a.organization_id = $1 and a.anjo_person_id = $2 ${where}
        order by a.started_at desc, a.id desc limit ${limit + 1}`,
      params,
    )
  ).rows
  const page = rows.slice(0, limit)
  const names = await loadPersonPresentations(db, viewer.organizationId, page.map((row) => row.operator_person_id))
  const last = page.at(-1)
  return {
    items: page.map((row) => ({
      attendanceId: row.id,
      requestId: row.request_id,
      protocol: row.protocol,
      operatorName: names.get(row.operator_person_id)?.displayName ?? "Operador",
      startedAt: row.started_at.toISOString(),
      firstAnjoMessageAt: row.first_anjo_message_at?.toISOString() ?? null,
      endedAt: row.ended_at?.toISOString() ?? null,
      endCause: row.end_cause,
      classified: row.reason !== null,
      classification: row.reason && row.outcome ? { reason: row.reason, outcome: row.outcome, referenceTitle: row.reference_title } : null,
    })),
    nextCursor: rows.length > limit && last ? encodeListCursor(last.started_at, last.id) : null,
  }
}
