import type { Database } from "../../../infrastructure/database/pool.js"
import { instantOf, type Clock } from "../../../shared/domain/clock.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import type { ApplicabilityResolution } from "../domain/applicability-resolution.js"
import { effectClaimsInContent } from "../domain/effect-claims.js"
import { feedbackViewOf, isFeedbackView, type FeedbackView } from "../domain/feedback-view.js"
import { NATURAL_FEEDBACK_VERSION } from "../domain/feedback-presentation.js"
import { confirmedProductsOf, nodeOutputOf, renderPublishedNarrative } from "../domain/reliable-feedback-artifact.js"
import type { ReliableFeedbackStore } from "../application/ports.js"
import { unsupportedSuggestedContentOf } from "./publish-reliable-feedback.js"

/**
 * REPROJEÇÃO DA APRESENTAÇÃO de um feedback confiável JÁ PUBLICADO (sem IA, sem Workflow, sem nova emissão).
 *
 * O feedback V2 guarda o view model no snapshot (estratégia B: o que foi publicado não muda sozinho). Quando uma correção de
 * APRESENTAÇÃO precisa valer para um feedback já publicado (ex.: exemplo de condução com dado sem fonte tipada), o view model e
 * o texto derivado são recalculados pelas MESMAS funções da publicação, a partir do artefato e das revisões GRAVADOS — o
 * diagnóstico, os itens, as observações, o caso e a emissão não mudam. O que estava publicado vai para
 * `context_snapshot.reliableFeedback.presentationRevisions` (nada é perdido) e a ação vai para `audit_logs`.
 * Recusa: feedback que não é V2, artefato de outro colaborador, conjunto de itens diferente do publicado, conteúdo sem base.
 */
const sortKeys = (value: unknown): unknown => (Array.isArray(value) ? value.map(sortKeys) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys((value as Record<string, unknown>)[key])])) : value)
const canonical = (value: unknown) => JSON.stringify(sortKeys(value))

export type ReprojectInput = { organizationId: string; feedbackId: string; reason: string; actorId: string | null; clock: Clock | Date; dryRun?: boolean }
export type ReprojectResult = { feedbackId: string; changed: boolean; before: { view: FeedbackView; recommendation: string; card: string }; after: { view: FeedbackView; recommendation: string; card: string } }

export async function reprojectPublishedFeedbackPresentation(db: Database, store: ReliableFeedbackStore, input: ReprojectInput): Promise<ReprojectResult> {
  if (!input.reason.trim()) throw new Error("Informe o motivo da reprojeção.")
  const row = (await db.query<{ id: string; operator_id: string; case_id: string; recommendation: string; context_snapshot: Record<string, unknown>; summary: string }>(
    `select f.id, f.operator_id, f.case_id, f.recommendation, f.context_snapshot, c.summary from feedbacks f join supervision_cases c on c.id = f.case_id where f.id = $1 and f.organization_id = $2`,
    [input.feedbackId, input.organizationId],
  )).rows[0]
  if (!row) throw new Error("Feedback não encontrado nesta organização.")
  const reliable = (row.context_snapshot.reliableFeedback ?? null) as (Record<string, unknown> & { artifactId?: string; feedbackView?: unknown; items?: unknown[] }) | null
  if (!reliable?.artifactId || !isFeedbackView(reliable.feedbackView)) throw new Error("Só feedback confiável publicado no formato V2 pode ter a apresentação reprojetada.")
  const record = await store.get(input.organizationId, reliable.artifactId)
  if (!record?.artifact || record.status !== "COMPLETED") throw new Error("Artefato do feedback não encontrado.")
  if (record.collaboratorId !== row.operator_id) throw new Error("O artefato não é do colaborador deste feedback.")
  const output = nodeOutputOf(record.id, record.artifact, (await store.listReviews(input.organizationId, record.id)).map((review) => ({ itemIndex: review.itemIndex, status: review.reviewStatus, finalWording: review.finalWording })))
  if (output.disposition !== "READY" || output.presentation?.version !== NATURAL_FEEDBACK_VERSION) throw new Error(`O artefato não está pronto para emissão (${output.disposition}).`)
  if (Array.isArray(reliable.items) && reliable.items.length !== output.items.length) throw new Error("O conjunto de pontos mudou desde a publicação — reprojeção recusada (não é só apresentação).")
  // As MESMAS defesas finais da publicação.
  if (output.items.some((item) => effectClaimsInContent(item.wording, [item.knowledge?.quote, item.knowledge?.leadIn, item.knowledge?.detail?.quote]).length > 0)) throw new Error("Conteúdo com efeito garantido sem base — reprojeção recusada.")
  if (unsupportedSuggestedContentOf(output.items).length > 0) throw new Error("Exemplo de condução sem base — reprojeção recusada.")

  const confirmedProducts = confirmedProductsOf(record.artifact.processAssessment?.applicability as ApplicabilityResolution[] | undefined)
  const view = feedbackViewOf(output.items, output.presentation, { confirmedProducts, label: record.artifact.label })!
  const recommendation = renderPublishedNarrative(output.items, output.limitations, { presentation: output.presentation, confirmedProducts })
  const before = { view: reliable.feedbackView, recommendation: row.recommendation, card: row.summary }
  const after = { view, recommendation, card: view.card }
  // jsonb não preserva a ordem das chaves: a comparação é canônica (chaves ordenadas).
  const changed = canonical(before) !== canonical(after)
  if (!changed || input.dryRun) return { feedbackId: row.id, changed, before, after }

  const at = instantOf(input.clock).toISOString()
  const revisions = Array.isArray(reliable.presentationRevisions) ? reliable.presentationRevisions : []
  const snapshot = { ...row.context_snapshot, reliableFeedback: { ...reliable, feedbackView: view, presentationRevisions: [...revisions, { replacedAt: at, reason: input.reason.trim(), previous: before }] } }
  await inTransaction(db, async (client) => {
    await client.query(`update feedbacks set context_snapshot = $2, recommendation = $3, updated_at = $4 where id = $1`, [row.id, JSON.stringify(snapshot), recommendation, at])
    await client.query(`update supervision_cases set summary = $2, updated_at = $3 where id = $1`, [row.case_id, view.card, at])
    await client.query(
      `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload, created_at) values ($1, $2, 'FEEDBACK_PRESENTATION_REPROJECTED', 'FEEDBACK', $3, $4, $5)`,
      [input.organizationId, input.actorId, row.id, JSON.stringify({ reason: input.reason.trim(), artifactId: record.id, revision: revisions.length + 1 }), at],
    )
  })
  return { feedbackId: row.id, changed, before, after }
}
