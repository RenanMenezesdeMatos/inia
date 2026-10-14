import { createHash } from "node:crypto"
import type { Database } from "../../../infrastructure/database/pool.js"
import { validatePublishableFeedback } from "../../feedbacks/domain/feedback.js"
import { persistSupportMaterialsWithSnapshot } from "../../feedbacks/application/feedback-support-materials.js"
import type { ProjectionSource } from "../../conversational-delivery/domain/surface-projection.js"
import { loadPersonPresentation } from "../../profile-preferences/application/person-presentation-loader.js"
import type { MessageRecord } from "../application/ports.js"
import type { FeedbackBrief } from "../domain/feedback-brief.js"
import { withRecipientGreeting, type FeedbackView } from "../domain/feedback-view.js"
import type { DeliverySkip } from "../domain/delivery-guards.js"
import { deliverySkipOfMessage } from "./delivery-guards-sql.js"

/**
 * PUBLICAÇÃO da mensagem do motor no ACOMPANHAMENTO (Output FOLLOW_UP + O próprio operador).
 *
 * Reaproveita a publicação real do feedback (supervision_cases + evidences + feedbacks PUBLISHED + timeline) — o feed,
 * a CIÊNCIA, o chat e os analytics leem o mesmo registro de sempre — numa transação só e IDEMPOTENTE por nó Output
 * (`workflow_output_emissions`). O conteúdo vem SÓ da mensagem gravada (a fonte da verdade), nunca do Execution Context; o
 * destinatário precisa ser o colaborador da mensagem. No snapshot: o view model (o que a tela renderiza), proveniência segura
 * (mensagem, análises, domínio) — nunca prompt nem veredito interno. Material recomendado → `feedback_support_materials`
 * (revalidado contra o acesso do colaborador) e a recomendação do motor marcada como ENTREGUE.
 */
export type PublishEngineInput = { organizationId: string; enrollmentId: string; nodeId: string; recipientId: string; messageId: string }

export async function loadPublishableMessage(db: Pick<Database, "query">, input: { organizationId: string; recipientId: string; messageId: string }): Promise<MessageRecord & { brief: FeedbackBrief; message: NonNullable<MessageRecord["message"]> }> {
  const row = (await db.query<{ id: string; organization_id: string; message_key: string; person_id: string; domain: "MONITORING" | "INDICATOR"; status: string; analysis_run_ids: string[]; brief: FeedbackBrief | null; message: MessageRecord["message"]; finding_keys: string[] }>(
    `select id, organization_id, message_key, person_id, domain, status, analysis_run_ids, brief, message, finding_keys from feedback_engine_messages where id = $1 and organization_id = $2`,
    [input.messageId, input.organizationId],
  )).rows[0]
  if (!row || row.status !== "PUBLISHABLE" || !row.brief || !row.message) throw new Error("Mensagem do motor de feedback não está publicável nesta organização — nada publicado.")
  if (row.person_id !== input.recipientId) throw new Error("O destinatário do Output não é o colaborador da mensagem — nada publicado.")
  return {
    id: row.id, organizationId: row.organization_id, messageKey: row.message_key, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: null, sourceNodeId: null, personId: row.person_id, domain: row.domain,
    status: "PUBLISHABLE", analysisRunIds: row.analysis_run_ids ?? [], abstainReason: null, findingKeys: row.finding_keys ?? [], brief: row.brief, message: row.message, composition: null, suppressed: [], metrics: {}, completedAt: null,
  }
}

/** O view model ENTREGUE ao destinatário: o da mensagem + a saudação montada pelo sistema com o tratamento atual da pessoa. */
export async function deliveredViewOf(db: Pick<Database, "query">, organizationId: string, recipientId: string, view: FeedbackView): Promise<FeedbackView> {
  const presentation = await loadPersonPresentation(db, organizationId, recipientId)
  return withRecipientGreeting(view, presentation?.addressName)
}

/** A MESMA mensagem para Chat/Avatar (uma verdade, várias superfícies). */
export async function engineProjectionSource(db: Pick<Database, "query">, input: { organizationId: string; recipientId: string; messageId: string }): Promise<ProjectionSource> {
  const message = await loadPublishableMessage(db, input)
  return { kind: "FEEDBACK_VIEW", domain: message.domain, label: message.brief.label, view: await deliveredViewOf(db, input.organizationId, input.recipientId, message.message.view), fullText: message.message.text }
}

/** `skipped` = não publicado por uma REGRA DE ENTREGA ÚNICA (chamada já monitorada; indicador × período já entregue) — não é falha. */
export type PublishEngineResult = { caseId: string; feedbackId: string; reused: boolean; skipped?: undefined } | { caseId: null; feedbackId: null; reused: false; skipped: DeliverySkip }

export async function publishEngineFeedbackToFollowUp(db: Database, input: PublishEngineInput): Promise<PublishEngineResult> {
  const record = await loadPublishableMessage(db, input)
  const { brief, message } = record
  const team = (await db.query<{ team_id: string | null }>(`select team_id from people where id = $1 and organization_id = $2`, [record.personId, input.organizationId])).rows[0]
  if (!team?.team_id) throw new Error("O colaborador não está associado a um grupo — não é possível publicar no Acompanhamento.")
  const feedbackView = await deliveredViewOf(db, input.organizationId, record.personId, message.view)
  const findings = [...brief.developments, ...brief.strengths]
  const quotes = findings.flatMap((finding) => finding.quotes.map((quote) => `${quote.speaker === "OPERATOR" ? "Operador" : quote.speaker === "CUSTOMER" ? "Cliente" : "Chamada"}: “${quote.text}”`))
  const officialFacts = brief.officialLines.map((line) => `${line.label}: ${line.value}`)
  const procedures = [...new Set(findings.flatMap((finding) => finding.rules.map((rule) => rule.documentTitle)))]
  const content = validatePublishableFeedback({
    impactedIndicator: brief.domain === "INDICATOR" ? (brief.indicatorName ?? brief.label) : brief.label,
    evidenceFound: [...officialFacts, ...quotes].join(" · ") || brief.context.join(" · ") || brief.label,
    observedBehavior: findings.map((finding) => `${finding.title}: ${finding.observed}`).join("\n\n") || brief.context.join("\n"),
    relatedProcedure: procedures.length > 0 ? procedures.join("; ") : "Sem procedimento da base associado a este retorno.",
    recommendation: message.text,
  })
  const client = await db.connect()
  try {
    await client.query("begin")
    const emission = await client.query<{ id: string }>(
      `insert into workflow_output_emissions (organization_id, enrollment_id, node_id, surface, recipient_id, engine_message_id, created_at)
       values ($1,$2,$3,'FOLLOW_UP',$4,$5,now())
       on conflict (enrollment_id, node_id, surface, recipient_id) do nothing
       returning id`,
      [input.organizationId, input.enrollmentId, input.nodeId, input.recipientId, record.id],
    )
    if (!emission.rows[0]) {
      await client.query("rollback")
      const existing = (await db.query<{ case_id: string | null; feedback_id: string | null }>(`select case_id, feedback_id from workflow_output_emissions where enrollment_id = $1 and node_id = $2 and surface = 'FOLLOW_UP' and recipient_id = $3`, [input.enrollmentId, input.nodeId, input.recipientId])).rows[0]
      if (!existing?.case_id || !existing.feedback_id) throw new Error("Emissão deste Output já registrada sem feedback — estado inconsistente, nada publicado de novo.")
      return { caseId: existing.case_id, feedbackId: existing.feedback_id, reused: true }
    }
    // REGRAS DE ENTREGA ÚNICA (`domain/delivery-guards.ts`), com trava por chave nesta transação: outra execução que entregou a mesma
    // chamada (monitoria) ou o mesmo indicador × período antes desta — nada é publicado e a emissão não fica registrada.
    const skipped = await deliverySkipOfMessage(client, { organizationId: input.organizationId, id: record.id, domain: record.domain, personId: record.personId, analysisRunIds: record.analysisRunIds }, { lock: true })
    if (skipped) {
      await client.query("rollback")
      return { caseId: null, feedbackId: null, reused: false, skipped }
    }
    const firstRun = record.analysisRunIds[0] ?? null
    const origin = firstRun ? (await client.query<{ interaction_id: string | null; occurred_at: Date | null; period_end: string | null }>(
      `select r.interaction_id, (select occurred_at from call_assessments where analysis_run_id = r.id limit 1) occurred_at, r.period_end::text period_end from feedback_analysis_runs r where r.id = $1 and r.organization_id = $2`,
      [firstRun, input.organizationId],
    )).rows[0] : undefined
    const occurredAt = origin?.occurred_at ? new Date(origin.occurred_at) : origin?.period_end ? new Date(`${origin.period_end}T23:59:59Z`) : new Date()
    const title = brief.domain === "MONITORING" ? "Feedback de atendimento" : `Feedback de indicador · ${brief.indicatorName ?? brief.label}`
    const createdCase = await client.query<{ id: string }>(
      `insert into supervision_cases(organization_id, operator_id, team_id, title, summary, status, priority, indicator_code, indicator_value, indicator_target)
       values ($1,$2,$3,$4,$5,'DIAGNOSED','P2',$6,$7,$8) returning id`,
      [input.organizationId, record.personId, team.team_id, title, message.card, brief.domain === "MONITORING" ? "MONITORIA" : (brief.indicatorName ?? "INDICADOR"), brief.label, "FEEDBACK_ENGINE_V1"],
    )
    const caseId = createdCase.rows[0]!.id
    const evidenceText = [...officialFacts, ...quotes].join("\n") || brief.context.join("\n") || brief.label
    await client.query(
      `insert into evidences(organization_id, case_id, evidence_type, title, description, source_type, source_id, occurred_at, checksum)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [input.organizationId, caseId, brief.domain === "MONITORING" ? "TRANSCRIPT" : "INDICATOR", brief.domain === "MONITORING" ? "Trechos da transcrição (verificados)" : "Resultado oficial e análise das chamadas", evidenceText, brief.domain === "MONITORING" ? "interaction" : "feedback_analysis_run", brief.domain === "MONITORING" ? origin?.interaction_id ?? null : firstRun, occurredAt, createHash("sha256").update(evidenceText).digest("hex")],
    )
    const snapshot = {
      feedbackEngine: {
        messageId: record.id,
        analysisRunIds: record.analysisRunIds,
        domain: brief.domain,
        tone: brief.tone,
        limited: brief.tone === "INFORMATIVE",
        findings: findings.map((finding) => ({ kind: finding.kind, origin: finding.origin, title: finding.title, materiality: finding.materiality, criterionKeys: finding.criterionKeys })),
        suppressed: brief.suppressed,
        source: message.source,
        feedbackView,
      },
      ...(origin?.interaction_id ? { interactionId: origin.interaction_id } : {}),
    }
    const feedback = await client.query<{ id: string }>(
      `insert into feedbacks(organization_id, case_id, operator_id, status, feedback_kind, impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation, context_snapshot, published_at, updated_at)
       values ($1,$2,$3,'PUBLISHED',$4,$5,$6,$7,$8,$9,$10,now(),now()) returning id`,
      [input.organizationId, caseId, record.personId, brief.domain, content.impactedIndicator, content.evidenceFound, content.observedBehavior, content.relatedProcedure, content.recommendation, JSON.stringify(snapshot)],
    )
    const feedbackId = feedback.rows[0]!.id
    await persistSupportMaterialsWithSnapshot(client, { organizationId: input.organizationId, feedbackId, operatorId: record.personId, supportMaterials: brief.materials.map((material) => ({ materialId: material.documentId, title: material.title, reason: material.reason.slice(0, 280) })) })
    await client.query(`update feedback_material_recommendations set delivered_feedback_id = $2, delivered_at = now() where message_id = $1 and delivered_feedback_id is null`, [record.id, feedbackId])
    await client.query(`update feedback_engine_messages set delivered_at = coalesce(delivered_at, now()) where id = $1`, [record.id])
    await client.query(`insert into case_timeline_events (organization_id, case_id, event_type, payload) values ($1, $2, 'FEEDBACK_PUBLISHED', $3)`, [input.organizationId, caseId, { feedbackId }])
    await client.query(`update workflow_output_emissions set case_id = $2, feedback_id = $3 where id = $1`, [emission.rows[0].id, caseId, feedbackId])
    await client.query("commit")
    return { caseId, feedbackId, reused: false }
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
