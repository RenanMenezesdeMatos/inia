import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { DELIVERY_COLUMNS, toDelivery } from "./report-store.js"

/**
 * O que a pessoa RECEBEU (lista "Recebidos", detalhe e histórico) — sempre pelo vínculo de destinatário: quem criou um report
 * distribuído não vê o conteúdo entregue a outros; cada um vê só as próprias entregas e avisos.
 */
export async function listReceivedDeliveries(db: Database, input: { organizationId: string; personId: string; reportId?: string | null; limit: number }) {
  const result = await db.query<{ id: string; report_id: string; report_name: string; kind: "DELIVERY" | "NOT_FORWARDED"; reason: string | null; period_label: string | null; structure_label: string | null; analysis_status: string; empty: boolean; occurrences: number; created_at: Date; last_checked_at: Date; read_at: Date | null }>(
    `select d.id, d.report_id, rp.name report_name, d.kind, d.reason, d.period_label, d.structure_label, d.analysis_status, d.empty, d.occurrences, d.created_at, d.last_checked_at, r.read_at
       from report_delivery_recipients r
       join report_deliveries d on d.id = r.delivery_id
       join reports rp on rp.id = d.report_id
      where r.organization_id = $1 and r.recipient_person_id = $2 and ($3::uuid is null or d.report_id = $3)
      order by r.created_at desc, d.id desc limit $4`,
    [input.organizationId, input.personId, input.reportId ?? null, Math.min(100, Math.max(1, input.limit))],
  )
  return result.rows.map((row) => ({ id: row.id, reportId: row.report_id, reportName: row.report_name, kind: row.kind, reason: row.reason, periodLabel: row.period_label, structureLabel: row.structure_label, analysisStatus: row.analysis_status, empty: row.empty, occurrences: row.occurrences, createdAt: row.created_at.toISOString(), lastCheckedAt: row.last_checked_at.toISOString(), readAt: row.read_at?.toISOString() ?? null }))
}

export async function loadDeliveryDetail(db: Database, input: { organizationId: string; personId: string; accountId: string; deliveryId: string }) {
  const result = await db.query<Parameters<typeof toDelivery>[0] & { report_name: string; report_description: string | null; owner_account_id: string; report_status: string; report_deleted: boolean; config_version_now: number; read_at: Date | null }>(
    `select ${DELIVERY_COLUMNS.split(", ").map((column) => `d.${column}`).join(", ")}, rp.name report_name, rp.description report_description, rp.owner_account_id, rp.status report_status, rp.deleted_at is not null report_deleted, rp.config_version config_version_now, r.read_at
       from report_delivery_recipients r join report_deliveries d on d.id = r.delivery_id join reports rp on rp.id = d.report_id
      where r.organization_id = $1 and r.recipient_person_id = $2 and d.id = $3`,
    [input.organizationId, input.personId, input.deliveryId],
  )
  const row = result.rows[0]
  if (!row) throw new DomainError("Entrega não encontrada.", "REPORT_DELIVERY_NOT_FOUND", 404)
  const delivery = toDelivery(row)
  // Histórico permitido: as outras entregas/avisos do MESMO report que esta pessoa recebeu.
  const history = await listReceivedDeliveries(db, { organizationId: input.organizationId, personId: input.personId, reportId: delivery.reportId, limit: 24 })
  return {
    delivery: { ...delivery, readAt: row.read_at?.toISOString() ?? null },
    report: { id: delivery.reportId, name: row.report_name, description: row.report_description, status: row.report_status, deleted: row.report_deleted, isOwner: row.owner_account_id === input.accountId, configChangedSince: row.config_version_now !== delivery.configVersion },
    history,
  }
}

export async function markDeliveryRead(db: Database, input: { organizationId: string; personId: string; deliveryId: string }) {
  await db.query(`update report_delivery_recipients set read_at = coalesce(read_at, now()) where organization_id = $1 and recipient_person_id = $2 and delivery_id = $3`, [input.organizationId, input.personId, input.deliveryId])
}
