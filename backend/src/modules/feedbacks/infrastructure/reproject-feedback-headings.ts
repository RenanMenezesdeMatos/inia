import type { Database } from "../../../infrastructure/database/pool.js"
import type { Clock } from "../../../shared/domain/clock.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { FEEDBACK_HEADING_VERSION, legacyHeadingCorrectionOf, type InteractionHeading } from "../domain/feedback-heading.js"

/**
 * CORREÇÃO DA PROJEÇÃO DO TÍTULO dos feedbacks de atendimento JÁ PUBLICADOS (`FEEDBACK_HEADING_V1`).
 *
 * Só o cabeçalho do view model publicado (`context_snapshot.<reliableFeedback|feedbackEngine>.feedbackView.heading`) — quando ele não
 * tem assunto (a data virou o título). Fonte: a interação VINCULADA ao feedback (`context_snapshot.interactionId`, mesma organização
 * e mesmo colaborador) — o assunto bruto gravado com ela e a data dela. Não regenera análise, não reescreve a mensagem, não muda
 * card, destinatário, ciência nem notifica; o cabeçalho anterior fica em `presentationRevisions` e a ação vai para `audit_logs`.
 * Padrão = ensaio (nada gravado); `apply: true` grava, idempotente (uma segunda rodada não muda nada).
 * Feedback publicado SEM view model (pipelines anteriores) não tem projeção a corrigir: o título dele é o campo publicado
 * "indicador impactado" — fica de fora (contado no resultado).
 */
type ViewPath = "reliableFeedback" | "feedbackEngine"
type Heading = { title?: string | null; subtitle?: string | null; subjectSource?: string | null }
export type HeadingReprojectionRow = {
  feedbackId: string
  operatorId: string
  path: ViewPath
  interactionId: string | null
  before: Heading | null
  after: InteractionHeading | null
  outcome: "CORRECTED" | "UNCHANGED_HAS_SUBJECT" | "UNCHANGED_SAME_HEADING" | "SKIPPED_NO_LINKED_INTERACTION" | "SKIPPED_CHANGED_DURING_RUN"
}
export type HeadingReprojectionResult = { version: typeof FEEDBACK_HEADING_VERSION; apply: boolean; rows: HeadingReprojectionRow[]; corrected: number; applied: number; withoutViewModel: number }

export async function reprojectFeedbackHeadings(db: Database, input: { organizationId: string; apply: boolean; actorId: string | null; clock: Clock; feedbackIds?: readonly string[] | null }): Promise<HeadingReprojectionResult> {
  const feedbacks = await db.query<{ id: string; operator_id: string; context_snapshot: Record<string, unknown> }>(
    `select f.id, f.operator_id, f.context_snapshot
       from feedbacks f
      where f.organization_id = $1 and f.status = 'PUBLISHED' and f.feedback_kind = 'MONITORING'
        and (f.context_snapshot #> '{reliableFeedback,feedbackView}' is not null or f.context_snapshot #> '{feedbackEngine,feedbackView}' is not null)
        and ($2::uuid[] is null or f.id = any($2::uuid[]))
      order by coalesce(f.published_at, f.created_at), f.id`,
    [input.organizationId, input.feedbackIds && input.feedbackIds.length > 0 ? [...input.feedbackIds] : null],
  )
  const withoutViewModel = Number((await db.query<{ n: string }>(
    `select count(*) n from feedbacks f where f.organization_id = $1 and f.status = 'PUBLISHED' and f.feedback_kind = 'MONITORING'
       and f.context_snapshot #> '{reliableFeedback,feedbackView}' is null and f.context_snapshot #> '{feedbackEngine,feedbackView}' is null
       and ($2::uuid[] is null or f.id = any($2::uuid[]))`,
    [input.organizationId, input.feedbackIds && input.feedbackIds.length > 0 ? [...input.feedbackIds] : null],
  )).rows[0]?.n ?? 0)
  const interactionIds = [...new Set(feedbacks.rows.map((row) => row.context_snapshot.interactionId).filter((id): id is string => typeof id === "string"))]
  const interactions = new Map((await db.query<{ id: string; operator_id: string; reason: string | null; started_at: Date }>(
    `select id, operator_id, coalesce(nullif(btrim(sub_reason), ''), reason) reason, started_at from interactions where organization_id = $1 and id = any($2::uuid[])`,
    [input.organizationId, interactionIds],
  )).rows.map((row) => [row.id, row]))
  const codeNames = new Map((await db.query<{ code: string; name: string }>(`select code, name from interaction_subject_definitions where organization_id = $1`, [input.organizationId])).rows.map((row) => [row.code, row.name]))
  const timeZone = await resolveOrganizationTimezone(db, input.organizationId)

  const rows: HeadingReprojectionRow[] = []
  let applied = 0
  for (const feedback of feedbacks.rows) {
    const path: ViewPath = (feedback.context_snapshot.feedbackEngine as { feedbackView?: unknown } | undefined)?.feedbackView ? "feedbackEngine" : "reliableFeedback"
    const container = (feedback.context_snapshot[path] ?? {}) as Record<string, unknown>
    const view = (container.feedbackView ?? {}) as Record<string, unknown>
    const before = (view.heading ?? null) as Heading | null
    const interactionId = typeof feedback.context_snapshot.interactionId === "string" ? feedback.context_snapshot.interactionId : null
    const interaction = interactionId ? interactions.get(interactionId) : undefined
    if (!interaction || interaction.operator_id !== feedback.operator_id) {
      rows.push({ feedbackId: feedback.id, operatorId: feedback.operator_id, path, interactionId, before, after: null, outcome: "SKIPPED_NO_LINKED_INTERACTION" })
      continue
    }
    const raw = interaction.reason?.trim() ?? null
    const [year, month, day] = localDateOf(new Date(interaction.started_at), timeZone).split("-")
    const correction = legacyHeadingCorrectionOf({ current: before, recordedSubject: raw, exactCodeName: raw ? codeNames.get(raw) ?? null : null, dateLabel: `${day}/${month}/${year}` })
    if (correction.kind === "UNCHANGED") {
      rows.push({ feedbackId: feedback.id, operatorId: feedback.operator_id, path, interactionId, before, after: null, outcome: correction.reason === "HAS_SUBJECT" ? "UNCHANGED_HAS_SUBJECT" : "UNCHANGED_SAME_HEADING" })
      continue
    }
    const row: HeadingReprojectionRow = { feedbackId: feedback.id, operatorId: feedback.operator_id, path, interactionId, before, after: correction.heading, outcome: "CORRECTED" }
    rows.push(row)
    if (!input.apply) continue
    const at = input.clock.now()
    const revisions = Array.isArray(container.presentationRevisions) ? container.presentationRevisions : []
    const snapshot = { ...feedback.context_snapshot, [path]: { ...container, feedbackView: { ...view, heading: correction.heading }, presentationRevisions: [...revisions, { replacedAt: at.toISOString(), reason: FEEDBACK_HEADING_VERSION, previous: { heading: before } }] } }
    const written = await inTransaction(db, async (client) => {
      // Só grava se o snapshot ainda é o lido (outra escrita no meio = nada é sobrescrito; relatado).
      const updated = await client.query(`update feedbacks set context_snapshot = $2::jsonb, updated_at = $3 where id = $1 and organization_id = $4 and context_snapshot = $5::jsonb`, [feedback.id, JSON.stringify(snapshot), at, input.organizationId, JSON.stringify(feedback.context_snapshot)])
      if (updated.rowCount !== 1) return false
      await client.query(
        `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload, created_at) values ($1, $2, 'FEEDBACK_HEADING_REPROJECTED', 'FEEDBACK', $3, $4, $5)`,
        [input.organizationId, input.actorId, feedback.id, JSON.stringify({ version: FEEDBACK_HEADING_VERSION, interactionId, before, after: correction.heading, revision: revisions.length + 1 }), at],
      )
      return true
    })
    if (!written) {
      row.outcome = "SKIPPED_CHANGED_DURING_RUN"
      continue
    }
    applied += 1
  }
  return { version: FEEDBACK_HEADING_VERSION, apply: input.apply, rows, corrected: rows.filter((row) => row.outcome === "CORRECTED").length, applied, withoutViewModel }
}
