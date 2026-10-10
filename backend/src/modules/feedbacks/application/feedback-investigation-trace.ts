import type { Database } from "../../../infrastructure/database/pool.js"
import type { InvestigationSummary, ToolInvocationTrace } from "../../investigation/domain/tool-trace.js"

export type FeedbackInvestigationFields = {
  /** Trace SEGURO das ferramentas de investigação (investigation/domain/tool-trace.ts) usadas
   * pelo Agent/especialistas que produziram este Feedback — auditoria no `context_snapshot`. */
  toolTrace?: ToolInvocationTrace[] | undefined
  investigation?: InvestigationSummary | undefined
}

/** Grava o trace no `context_snapshot` do Feedback (metadata existente — nenhuma coluna nova). */
export async function persistInvestigationSnapshot(client: { query: Database["query"] }, feedbackId: string, fields: FeedbackInvestigationFields): Promise<void> {
  if (!fields.toolTrace || fields.toolTrace.length === 0) return
  await client.query(`update feedbacks set context_snapshot = coalesce(context_snapshot, '{}'::jsonb) || $2::jsonb where id = $1`, [
    feedbackId,
    JSON.stringify({ toolTrace: fields.toolTrace, ...(fields.investigation ? { investigation: fields.investigation } : {}) }),
  ])
}
