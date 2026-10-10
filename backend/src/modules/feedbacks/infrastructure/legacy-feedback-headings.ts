import type { Database } from "../../../infrastructure/database/pool.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { legacyFeedbackHeadingOf, linkedInteractionIdOf, type InteractionHeading } from "../domain/feedback-heading.js"

/**
 * Cabeçalho, NA LEITURA, dos feedbacks de atendimento publicados sem view model (`legacyFeedbackHeadingOf`). Só os de MONITORIA sem
 * `feedbackView`; os demais não entram no mapa (quem lê mantém o que já mostrava). Quantidade FIXA de consultas por leitura
 * (feedbacks, evidências, interações, nomes de assunto, fuso), nunca uma por feedback. Nenhuma escrita.
 */
export type LegacyHeading = InteractionHeading & { linkedInteractionId: string | null }
export async function loadLegacyFeedbackHeadings(db: Database, input: { organizationId: string; feedbackIds: readonly string[] }): Promise<Map<string, LegacyHeading>> {
  const out = new Map<string, LegacyHeading>()
  if (input.feedbackIds.length === 0) return out
  const feedbacks = (await db.query<{ id: string; operator_id: string; case_id: string; snapshot_interaction_id: string | null }>(
    `select f.id, f.operator_id, f.case_id, f.context_snapshot->>'interactionId' snapshot_interaction_id
       from feedbacks f
      where f.organization_id = $1 and f.id = any($2::uuid[]) and f.feedback_kind = 'MONITORING'
        and f.context_snapshot #> '{reliableFeedback,feedbackView}' is null and f.context_snapshot #> '{feedbackEngine,feedbackView}' is null`,
    [input.organizationId, [...input.feedbackIds]],
  )).rows
  if (feedbacks.length === 0) return out
  const evidences = (await db.query<{ case_id: string; source_id: string }>(
    `select e.case_id, e.source_id from evidences e where e.organization_id = $1 and e.case_id = any($2::uuid[]) and e.source_type = 'interaction'`,
    [input.organizationId, [...new Set(feedbacks.map((row) => row.case_id))]],
  )).rows
  const evidenceByCase = new Map<string, string[]>()
  for (const row of evidences) evidenceByCase.set(row.case_id, [...(evidenceByCase.get(row.case_id) ?? []), row.source_id])
  const links = new Map(feedbacks.map((row) => [row.id, linkedInteractionIdOf({ snapshotInteractionId: row.snapshot_interaction_id, evidenceInteractionIds: evidenceByCase.get(row.case_id) ?? [] })]))
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const interactionIds = [...new Set([...links.values()].filter((id): id is string => Boolean(id && uuid.test(id))))]
  const interactions = new Map((await db.query<{ id: string; operator_id: string; reason: string | null; started_at: Date }>(
    `select id, operator_id, reason, started_at from interactions where organization_id = $1 and id = any($2::uuid[])`,
    [input.organizationId, interactionIds],
  )).rows.map((row) => [row.id, row]))
  const codeNames = new Map((await db.query<{ code: string; name: string }>(`select code, name from interaction_subject_definitions where organization_id = $1`, [input.organizationId])).rows.map((row) => [row.code, row.name]))
  const timeZone = await resolveOrganizationTimezone(db, input.organizationId)
  for (const feedback of feedbacks) {
    const linkedId = links.get(feedback.id) ?? null
    const interaction = linkedId ? interactions.get(linkedId) : undefined
    // Interação de outra pessoa ou inexistente = sem vínculo confiável.
    if (!interaction || interaction.operator_id !== feedback.operator_id) {
      out.set(feedback.id, { ...legacyFeedbackHeadingOf(null), linkedInteractionId: null })
      continue
    }
    const raw = interaction.reason?.trim() || null
    const [year, month, day] = localDateOf(new Date(interaction.started_at), timeZone).split("-")
    out.set(feedback.id, { ...legacyFeedbackHeadingOf({ recordedSubject: raw, exactCodeName: raw ? codeNames.get(raw) ?? null : null, dateLabel: `${day}/${month}/${year}` }), linkedInteractionId: interaction.id })
  }
  return out
}
