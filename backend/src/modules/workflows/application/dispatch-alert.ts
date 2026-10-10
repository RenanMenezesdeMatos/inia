import type { Database } from "../../../infrastructure/database/pool.js"

/** Único ponto que insere na tabela `alerts` a partir do motor de workflow — ESCALATE, o node
 * Output (superfícies FOLLOW_UP-pra-terceiro/NOTIFICATION) e o node Human Review chegam aqui
 * via `WorkflowEffectSink.dispatchAlert` (effect-sink.ts), nunca importando este helper direto. */
export type AlertInput = {
  organizationId: string
  caseId: string | null
  recipientId: string
  title: string
  description: string
  severity: "INFO" | "MEDIUM" | "HIGH" | "CRITICAL"
  alertType: string
  dedupeKey: string
}

export async function dispatchAlert(db: Database, input: AlertInput): Promise<void> {
  await db.query(
    `insert into alerts(organization_id, case_id, recipient_id, title, description, severity, alert_type, dedupe_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (dedupe_key) do nothing`,
    [input.organizationId, input.caseId, input.recipientId, input.title, input.description, input.severity, input.alertType, input.dedupeKey],
  )
}
