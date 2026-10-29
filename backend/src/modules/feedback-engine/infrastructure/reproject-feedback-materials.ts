import type { Database } from "../../../infrastructure/database/pool.js"
import type { Clock } from "../../../shared/domain/clock.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import type { FeedbackBrief } from "../domain/feedback-brief.js"
import { viewMaterialsOf, type FeedbackView } from "../domain/feedback-view.js"
import { COMPOSITION_VERSION } from "../domain/versions.js"

/**
 * "MATERIAIS UTILIZADOS" dos feedbacks do MOTOR alinhados à regra atual (`RECOGNITION_MATERIALS_V1`, composição V28): retorno sem ponto
 * a ajustar mostra os documentos da base dos acertos confirmados. Só o campo `materials` da view muda — no feedback PUBLICADO
 * (`context_snapshot.feedbackEngine.feedbackView`) e na view da mensagem do motor (a que Chat/Avatar e uma publicação futura usam);
 * mensagem publicável ainda não entregue também é alinhada. Com ponto a ajustar a regra não mudou: nada é tocado. Não regenera análise,
 * não reescreve texto, card, recomendação, ciência nem notifica; o valor anterior fica em `presentationRevisions` e a ação vai para
 * `audit_logs`. Material RECOMENDADO (liderança) e `feedback_support_materials` não mudam. Padrão = ensaio (nada gravado); `apply: true`
 * grava, idempotente (uma segunda rodada não muda nada).
 */
export type MaterialsReprojectionRow = {
  kind: "FEEDBACK" | "PENDING_MESSAGE"
  feedbackId: string | null
  messageId: string
  before: string[]
  after: string[]
  outcome: "UPDATED" | "UNCHANGED_SAME_MATERIALS" | "UNCHANGED_HAS_DEVELOPMENTS" | "SKIPPED_NO_MESSAGE" | "SKIPPED_CHANGED_DURING_RUN"
}
export type MaterialsReprojectionResult = { version: typeof COMPOSITION_VERSION; apply: boolean; rows: MaterialsReprojectionRow[]; changed: number; applied: number }

type Materials = FeedbackView["materials"]
type MessageJson = { view?: { materials?: Materials }; communicatedRefs?: string[] }

// jsonb não guarda a ordem das chaves: compara pelo conteúdo.
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, inner]) => [key, canonical(inner)])) : value
const sameMaterials = (a: Materials, b: Materials) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
const titlesOf = (materials: Materials) => materials.map((material) => material.title)

export async function reprojectFeedbackMaterials(db: Database, input: { organizationId: string; apply: boolean; actorId: string | null; clock: Clock; feedbackIds?: readonly string[] | null }): Promise<MaterialsReprojectionResult> {
  const feedbackIds = input.feedbackIds && input.feedbackIds.length > 0 ? [...input.feedbackIds] : null
  const feedbacks = await db.query<{ id: string; context_snapshot: Record<string, unknown>; message_id: string | null; brief: FeedbackBrief | null; message: MessageJson | null }>(
    `select f.id, f.context_snapshot, m.id as message_id, m.brief, m.message
       from feedbacks f
       left join feedback_engine_messages m on m.organization_id = f.organization_id and m.id::text = f.context_snapshot #>> '{feedbackEngine,messageId}'
      where f.organization_id = $1 and f.status = 'PUBLISHED'
        and f.context_snapshot #> '{feedbackEngine,feedbackView}' is not null
        and ($2::uuid[] is null or f.id = any($2::uuid[]))
      order by coalesce(f.published_at, f.created_at), f.id`,
    [input.organizationId, feedbackIds],
  )
  // Publicável ainda não entregue: a publicação usa a view da mensagem como está. Com `feedbackIds`, só o que foi pedido.
  const pending = feedbackIds ? { rows: [] } : await db.query<{ id: string; brief: FeedbackBrief; message: MessageJson }>(
    `select id, brief, message from feedback_engine_messages
      where organization_id = $1 and status = 'PUBLISHABLE' and delivered_at is null and message #> '{view}' is not null
      order by created_at, id`,
    [input.organizationId],
  )

  const rows: MaterialsReprojectionRow[] = []
  let applied = 0
  for (const feedback of feedbacks.rows) {
    const container = (feedback.context_snapshot.feedbackEngine ?? {}) as Record<string, unknown>
    const view = (container.feedbackView ?? {}) as { materials?: Materials }
    const before = view.materials ?? []
    if (!feedback.message_id || !feedback.brief || !feedback.message) {
      rows.push({ kind: "FEEDBACK", feedbackId: feedback.id, messageId: feedback.message_id ?? "", before: titlesOf(before), after: [], outcome: "SKIPPED_NO_MESSAGE" })
      continue
    }
    const row: MaterialsReprojectionRow = { kind: "FEEDBACK", feedbackId: feedback.id, messageId: feedback.message_id, before: titlesOf(before), after: [], outcome: "UNCHANGED_HAS_DEVELOPMENTS" }
    rows.push(row)
    if (feedback.brief.developments.length > 0) continue
    const after = viewMaterialsOf(feedback.brief, feedback.message.communicatedRefs)
    row.after = titlesOf(after)
    if (sameMaterials(before, after)) {
      row.outcome = "UNCHANGED_SAME_MATERIALS"
      continue
    }
    row.outcome = "UPDATED"
    if (!input.apply) continue
    const at = input.clock.now()
    const revisions = Array.isArray(container.presentationRevisions) ? container.presentationRevisions : []
    const snapshot = { ...feedback.context_snapshot, feedbackEngine: { ...container, feedbackView: { ...view, materials: after }, presentationRevisions: [...revisions, { replacedAt: at.toISOString(), reason: `MATERIALS_REPROJECTED:${COMPOSITION_VERSION}`, previous: { materials: before } }] } }
    const written = await inTransaction(db, async (client) => {
      // Só grava se o snapshot ainda é o lido (outra escrita no meio = nada é sobrescrito; relatado).
      const updated = await client.query(`update feedbacks set context_snapshot = $2::jsonb, updated_at = $3 where id = $1 and organization_id = $4 and context_snapshot = $5::jsonb`, [feedback.id, JSON.stringify(snapshot), at, input.organizationId, JSON.stringify(feedback.context_snapshot)])
      if (updated.rowCount !== 1) return false
      await client.query(`update feedback_engine_messages set message = jsonb_set(message, '{view,materials}', $3::jsonb) where id = $1 and organization_id = $2 and message #> '{view}' is not null`, [feedback.message_id, input.organizationId, JSON.stringify(after)])
      await client.query(
        `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload, created_at) values ($1, $2, 'FEEDBACK_MATERIALS_REPROJECTED', 'FEEDBACK', $3, $4, $5)`,
        [input.organizationId, input.actorId, feedback.id, JSON.stringify({ version: COMPOSITION_VERSION, messageId: feedback.message_id, before, after, revision: revisions.length + 1 }), at],
      )
      return true
    })
    if (!written) {
      row.outcome = "SKIPPED_CHANGED_DURING_RUN"
      continue
    }
    applied += 1
  }

  for (const message of pending.rows) {
    const before = message.message.view?.materials ?? []
    const row: MaterialsReprojectionRow = { kind: "PENDING_MESSAGE", feedbackId: null, messageId: message.id, before: titlesOf(before), after: [], outcome: "UNCHANGED_HAS_DEVELOPMENTS" }
    rows.push(row)
    if (message.brief.developments.length > 0) continue
    const after = viewMaterialsOf(message.brief, message.message.communicatedRefs)
    row.after = titlesOf(after)
    if (sameMaterials(before, after)) {
      row.outcome = "UNCHANGED_SAME_MATERIALS"
      continue
    }
    row.outcome = "UPDATED"
    if (!input.apply) continue
    const written = await inTransaction(db, async (client) => {
      // Só enquanto continua não entregue e com a mesma view (publicada no meio = a próxima rodada alinha o feedback).
      const updated = await client.query(
        `update feedback_engine_messages set message = jsonb_set(message, '{view,materials}', $3::jsonb)
          where id = $1 and organization_id = $2 and status = 'PUBLISHABLE' and delivered_at is null and message = $4::jsonb`,
        [message.id, input.organizationId, JSON.stringify(after), JSON.stringify(message.message)],
      )
      if (updated.rowCount !== 1) return false
      await client.query(
        `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload, created_at) values ($1, $2, 'FEEDBACK_MATERIALS_REPROJECTED', 'FEEDBACK_ENGINE_MESSAGE', $3, $4, $5)`,
        [input.organizationId, input.actorId, message.id, JSON.stringify({ version: COMPOSITION_VERSION, before, after }), input.clock.now()],
      )
      return true
    })
    if (!written) {
      row.outcome = "SKIPPED_CHANGED_DURING_RUN"
      continue
    }
    applied += 1
  }
  return { version: COMPOSITION_VERSION, apply: input.apply, rows, changed: rows.filter((row) => row.outcome === "UPDATED").length, applied }
}
