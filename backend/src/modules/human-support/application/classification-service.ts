import { DomainError } from "../../../shared/domain/domain-error.js"
import type { TransactionSource } from "../../../shared/infrastructure/database/transaction.js"
import { CLASSIFICATION_CATALOG_VERSION } from "../domain/catalogs.js"
import type { Classification } from "../domain/classification.js"
import { recordHumanSupportAudit } from "./audit.js"
import { bumpInboxVersions } from "./inbox-versions.js"
import { inSupportTransaction } from "./locks.js"
import type { Viewer } from "./request-service.js"

/**
 * CLASSIFICAÇÃO pelo Anjo do PRÓPRIO atendimento, depois que ele termina (encerrado ou interrompido; seção 12). Uma só, definitiva
 * (a chave primária é o atendimento). Vai para a exportação do operador e do Anjo (D6). Auditoria `HUMAN_SUPPORT_ATTENDANCE_CLASSIFIED`.
 */
export async function classifyAttendance(db: TransactionSource, viewer: Viewer, attendanceId: string, classification: Classification): Promise<Classification> {
  return inSupportTransaction(db, async (client) => {
    const attendance = (await client.query<{ status: string; operator_person_id: string }>(`select status, operator_person_id from human_support_attendances where id = $1 and organization_id = $2 and anjo_person_id = $3 for update`, [attendanceId, viewer.organizationId, viewer.personId])).rows[0]
    if (!attendance) throw new DomainError("Atendimento não encontrado.", "HUMAN_SUPPORT_ATTENDANCE_NOT_FOUND", 404)
    if (attendance.status !== "ENDED") throw new DomainError("Classifique o atendimento depois de encerrá-lo.", "HUMAN_SUPPORT_ATTENDANCE_ACTIVE", 409)
    const inserted = await client.query(
      `insert into human_support_classifications (attendance_id, organization_id, anjo_person_id, operator_person_id, reason, reference_title, reference_url, other_description, outcome, catalog_version, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, statement_timestamp())
       on conflict (attendance_id) do nothing`,
      [attendanceId, viewer.organizationId, viewer.personId, attendance.operator_person_id, classification.reason, classification.referenceTitle, classification.referenceUrl, classification.otherDescription, classification.outcome, CLASSIFICATION_CATALOG_VERSION],
    )
    if (inserted.rowCount !== 1) throw new DomainError("Este atendimento já foi classificado.", "HUMAN_SUPPORT_ALREADY_CLASSIFIED", 409)
    await recordHumanSupportAudit(client, { organizationId: viewer.organizationId, actorPersonId: viewer.personId, action: "HUMAN_SUPPORT_ATTENDANCE_CLASSIFIED", entityType: "human_support_attendance", entityId: attendanceId, payload: { reason: classification.reason, outcome: classification.outcome, catalogVersion: CLASSIFICATION_CATALOG_VERSION } })
    await bumpInboxVersions(client, viewer.organizationId, [viewer.personId])
    return classification
  })
}
