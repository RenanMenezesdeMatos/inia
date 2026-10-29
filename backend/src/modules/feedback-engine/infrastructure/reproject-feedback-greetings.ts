import type { Database } from "../../../infrastructure/database/pool.js"
import type { Clock } from "../../../shared/domain/clock.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { loadPersonPresentations } from "../../profile-preferences/application/person-presentation-loader.js"
import { FEEDBACK_GREETING_VERSION, greetingOf } from "../domain/feedback-view.js"

/**
 * SAUDAÇÃO dos feedbacks do MOTOR já publicados alinhada à regra atual (`FEEDBACK_GREETING_V1`: só o primeiro nome do tratamento).
 * O motor publicava o view model com a saudação vazia; a publicação passou a montá-la. Aqui só o campo
 * `context_snapshot.feedbackEngine.feedbackView.greeting` dos feedbacks PUBLICADOS cuja saudação falta ou difere da que a publicação
 * montaria hoje, com o tratamento ATUAL da pessoa. Não regenera análise, não
 * reescreve a mensagem, não muda card, ciência nem notifica; o valor anterior fica em `presentationRevisions` e a ação vai para
 * `audit_logs`. Padrão = ensaio (nada gravado); `apply: true` grava, idempotente (uma segunda rodada não muda nada).
 */
export type GreetingReprojectionRow = {
  feedbackId: string
  operatorId: string
  before: string | null
  after: string | null
  outcome: "ADDED" | "UPDATED" | "UNCHANGED_SAME_GREETING" | "SKIPPED_CHANGED_DURING_RUN"
}
export type GreetingReprojectionResult = { version: typeof FEEDBACK_GREETING_VERSION; apply: boolean; rows: GreetingReprojectionRow[]; changed: number; applied: number }

export async function reprojectFeedbackGreetings(db: Database, input: { organizationId: string; apply: boolean; actorId: string | null; clock: Clock; feedbackIds?: readonly string[] | null }): Promise<GreetingReprojectionResult> {
  const feedbacks = await db.query<{ id: string; operator_id: string; context_snapshot: Record<string, unknown> }>(
    `select f.id, f.operator_id, f.context_snapshot
       from feedbacks f
      where f.organization_id = $1 and f.status = 'PUBLISHED'
        and f.context_snapshot #> '{feedbackEngine,feedbackView}' is not null
        and ($2::uuid[] is null or f.id = any($2::uuid[]))
      order by coalesce(f.published_at, f.created_at), f.id`,
    [input.organizationId, input.feedbackIds && input.feedbackIds.length > 0 ? [...input.feedbackIds] : null],
  )
  const presentations = await loadPersonPresentations(db, input.organizationId, feedbacks.rows.map((row) => row.operator_id))

  const rows: GreetingReprojectionRow[] = []
  let applied = 0
  for (const feedback of feedbacks.rows) {
    const container = (feedback.context_snapshot.feedbackEngine ?? {}) as Record<string, unknown>
    const view = (container.feedbackView ?? {}) as Record<string, unknown>
    const before = typeof view.greeting === "string" && view.greeting.trim().length > 0 ? view.greeting : null
    const after = greetingOf(presentations.get(feedback.operator_id)?.addressName)
    if (before === after) {
      rows.push({ feedbackId: feedback.id, operatorId: feedback.operator_id, before, after: null, outcome: "UNCHANGED_SAME_GREETING" })
      continue
    }
    const row: GreetingReprojectionRow = { feedbackId: feedback.id, operatorId: feedback.operator_id, before, after, outcome: before ? "UPDATED" : "ADDED" }
    rows.push(row)
    if (!input.apply) continue
    const at = input.clock.now()
    const revisions = Array.isArray(container.presentationRevisions) ? container.presentationRevisions : []
    const snapshot = { ...feedback.context_snapshot, feedbackEngine: { ...container, feedbackView: { ...view, greeting: after }, presentationRevisions: [...revisions, { replacedAt: at.toISOString(), reason: FEEDBACK_GREETING_VERSION, previous: { greeting: before } }] } }
    const written = await inTransaction(db, async (client) => {
      // Só grava se o snapshot ainda é o lido (outra escrita no meio = nada é sobrescrito; relatado).
      const updated = await client.query(`update feedbacks set context_snapshot = $2::jsonb, updated_at = $3 where id = $1 and organization_id = $4 and context_snapshot = $5::jsonb`, [feedback.id, JSON.stringify(snapshot), at, input.organizationId, JSON.stringify(feedback.context_snapshot)])
      if (updated.rowCount !== 1) return false
      await client.query(
        `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload, created_at) values ($1, $2, 'FEEDBACK_GREETING_REPROJECTED', 'FEEDBACK', $3, $4, $5)`,
        [input.organizationId, input.actorId, feedback.id, JSON.stringify({ version: FEEDBACK_GREETING_VERSION, before, after, revision: revisions.length + 1 }), at],
      )
      return true
    })
    if (!written) {
      row.outcome = "SKIPPED_CHANGED_DURING_RUN"
      continue
    }
    applied += 1
  }
  return { version: FEEDBACK_GREETING_VERSION, apply: input.apply, rows, changed: rows.filter((row) => row.outcome === "ADDED" || row.outcome === "UPDATED").length, applied }
}
