import { createHash } from "node:crypto"
import type { Database } from "../../../infrastructure/database/pool.js"
import { PublishFeedback } from "./publish-feedback.js"
import { persistSupportMaterialsWithSnapshot } from "./feedback-support-materials.js"
import { persistInvestigationSnapshot, type FeedbackInvestigationFields } from "./feedback-investigation-trace.js"
import type { SupportMaterialRecommendation, SupportMaterialRejection } from "../domain/support-material.js"

/** O que o Output entrega junto do feedback — já escolhido e validado na execução do Agent/Orquestrador. */
export type FeedbackDeliveryExtras = {
  /** Materiais de apoio que o Output decidiu INCLUIR nesta entrega (`includeSupportMaterials`); a
   * persistência revalida contra o banco e o destinatário. Ausente = a entrega não apresenta materiais. */
  supportMaterials?: SupportMaterialRecommendation[] | undefined
  supportMaterialsRejected?: SupportMaterialRejection[] | undefined
} & FeedbackInvestigationFields

/** Registro completo de um feedback aprovado do caminho Agent/Orquestrador → Output. */
export type ApprovedFeedbackRecord = {
  organizationId: string
  operatorId: string
  teamId: string
  /** `indicator_code/value/target` são NOT NULL para todo caso (migration 001) — quem chama sempre identifica a origem. */
  supervisionCase: { title: string; summary: string; indicatorCode: string; indicatorValue: string; indicatorTarget: string }
  evidence: { type: "TRANSCRIPT" | "INDICATOR" | "FEEDBACK"; title: string; description: string; sourceType: string; sourceId: string; occurredAt: string }
  feedback: {
    kind: "MONITORING" | "INDICATOR"
    impactedIndicator: string
    evidenceFound: string
    observedBehavior: string
    relatedProcedure: string
    recommendation: string
    contextSnapshot: unknown
  }
} & FeedbackDeliveryExtras

/**
 * Sequência única dos criadores de feedback (monitoria, indicador e Orquestrador): numa transação,
 * caso DIAGNOSED → evidência (checksum da descrição) → feedback APPROVED → materiais de apoio →
 * rastro da investigação; depois do commit, publica. Os criadores só decidem os VALORES.
 */
export async function createApprovedFeedback(db: Database, record: ApprovedFeedbackRecord): Promise<{ caseId: string; feedbackId: string }> {
  const client = await db.connect()
  try {
    await client.query("begin")

    // Colaborador e grupo sempre da organização do registro: quem chama nunca publica em nome de pessoa/grupo de outra.
    const owned = await client.query(
      `select 1 as owned from people p join teams t on t.id = $3 and t.organization_id = $1 where p.id = $2 and p.organization_id = $1`,
      [record.organizationId, record.operatorId, record.teamId],
    )
    if (owned.rows.length !== 1) throw new Error("O colaborador ou o grupo do feedback não pertence a esta organização.")

    const createdCase = await client.query<{ id: string }>(
      `insert into supervision_cases(
         organization_id, operator_id, team_id, title, summary, status, priority,
         indicator_code, indicator_value, indicator_target
       ) values ($1,$2,$3,$4,$5,'DIAGNOSED','P2',$6,$7,$8)
       returning id`,
      [
        record.organizationId,
        record.operatorId,
        record.teamId,
        record.supervisionCase.title,
        record.supervisionCase.summary,
        record.supervisionCase.indicatorCode,
        record.supervisionCase.indicatorValue,
        record.supervisionCase.indicatorTarget,
      ],
    )
    const caseId = createdCase.rows[0]!.id

    const evidenceChecksum = createHash("sha256").update(record.evidence.description).digest("hex")
    await client.query(
      `insert into evidences(organization_id, case_id, evidence_type, title, description, source_type, source_id, occurred_at, checksum)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        record.organizationId,
        caseId,
        record.evidence.type,
        record.evidence.title,
        record.evidence.description,
        record.evidence.sourceType,
        record.evidence.sourceId,
        record.evidence.occurredAt,
        evidenceChecksum,
      ],
    )

    const createdFeedback = await client.query<{ id: string }>(
      `insert into feedbacks(
         organization_id, case_id, operator_id, status, feedback_kind,
         impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation,
         context_snapshot
       ) values ($1,$2,$3,'APPROVED',$4,$5,$6,$7,$8,$9,$10)
       returning id`,
      [
        record.organizationId,
        caseId,
        record.operatorId,
        record.feedback.kind,
        record.feedback.impactedIndicator,
        record.feedback.evidenceFound,
        record.feedback.observedBehavior,
        record.feedback.relatedProcedure,
        record.feedback.recommendation,
        JSON.stringify(record.feedback.contextSnapshot),
      ],
    )
    const feedbackId = createdFeedback.rows[0]!.id

    await persistSupportMaterialsWithSnapshot(client, {
      organizationId: record.organizationId,
      feedbackId,
      operatorId: record.operatorId,
      supportMaterials: record.supportMaterials,
      supportMaterialsRejected: record.supportMaterialsRejected,
    })
    await persistInvestigationSnapshot(client, feedbackId, { toolTrace: record.toolTrace, investigation: record.investigation })

    await client.query("commit")

    await new PublishFeedback(db).execute(feedbackId, { organizationId: record.organizationId })

    return { caseId, feedbackId }
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}
