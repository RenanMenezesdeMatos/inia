import { DomainError } from "../../../shared/domain/domain-error.js"
import type { TransactionSource } from "../../../shared/infrastructure/database/transaction.js"
import type { AttendanceEndCause } from "../domain/catalogs.js"
import { evaluationOpen, mergeEvaluation, type EvaluationCurrent, type EvaluationInput } from "../domain/evaluation.js"
import { bumpInboxVersions } from "./inbox-versions.js"
import { inSupportTransaction } from "./locks.js"
import type { Viewer } from "./request-service.js"

/**
 * AVALIAÇÃO do atendimento pelo operador dono (seção 12): cada mudança grava nova linha e encerra a vigente (`superseded_at`), até
 * 24 h depois do fim (o relógio é o do banco). Interrompido não é avaliado. As notas não vão para o Anjo (OQ2).
 */
export async function evaluateAttendance(db: TransactionSource, viewer: Viewer, attendanceId: string, input: EvaluationInput): Promise<EvaluationCurrent> {
  return inSupportTransaction(db, async (client) => {
    const attendance = (await client.query<{ ended_at: Date | null; end_cause: AttendanceEndCause | null; now: Date }>(`select ended_at, end_cause, statement_timestamp() now from human_support_attendances where id = $1 and organization_id = $2 and operator_person_id = $3 for update`, [attendanceId, viewer.organizationId, viewer.personId])).rows[0]
    if (!attendance) throw new DomainError("Atendimento não encontrado.", "HUMAN_SUPPORT_ATTENDANCE_NOT_FOUND", 404)
    if (!evaluationOpen({ endedAt: attendance.ended_at, endCause: attendance.end_cause }, attendance.now)) throw new DomainError("A avaliação deste atendimento não está mais aberta.", "HUMAN_SUPPORT_EVALUATION_CLOSED", 409)
    const current = (await client.query<{ resolved: EvaluationCurrent["resolved"]; stars: number | null }>(`select resolved, stars from human_support_evaluations where attendance_id = $1 and superseded_at is null`, [attendanceId])).rows[0]
    const previous: EvaluationCurrent | null = current ? { resolved: current.resolved, stars: current.stars === null ? null : Number(current.stars) } : null
    const next = mergeEvaluation(previous, input)
    if (previous && previous.resolved === next.resolved && previous.stars === next.stars) return next
    await client.query(`update human_support_evaluations set superseded_at = statement_timestamp() where attendance_id = $1 and superseded_at is null`, [attendanceId])
    await client.query(
      `insert into human_support_evaluations (organization_id, attendance_id, operator_person_id, resolved, stars, created_at) values ($1, $2, $3, $4, $5, statement_timestamp())`,
      [viewer.organizationId, attendanceId, viewer.personId, next.resolved, next.stars],
    )
    await bumpInboxVersions(client, viewer.organizationId, [viewer.personId])
    return next
  })
}
