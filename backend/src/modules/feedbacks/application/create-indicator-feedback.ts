import type { Database } from "../../../infrastructure/database/pool.js"
import { createApprovedFeedback } from "./create-approved-feedback.js"
import type { FeedbackInvestigationFields } from "./feedback-investigation-trace.js"
import type { SupportMaterialRecommendation, SupportMaterialRejection } from "../domain/support-material.js"

export type StructuredIndicatorFeedback = {
  title: string
  summary: string
  relatedProcedure: string
  recommendation: string
}

/**
 * Irmã de create-monitoring-feedback.ts, para o caso em que o gatilho é uma medição
 * de indicador (ou um resumo agregado de período), não uma interação. A evidência não é
 * gerada pela IA — é montada aqui a partir do(s) valor(es) medido(s) e da meta vigente,
 * ambos já verificados no banco. `evidenceSourceType`/`evidenceSourceId` identificam de onde
 * vieram esses números: uma medição específica (`'indicator_measurement'` + seu id) ou um
 * resumo agregado de N medições num período (`'indicator_period_summary'` + os ids
 * separados por vírgula) — nos dois casos é um fato de banco, nunca texto da IA.
 */
export async function createIndicatorFeedback(
  db: Database,
  input: {
    organizationId: string
    operatorId: string
    teamId: string
    evidenceSourceType: string
    evidenceSourceId: string
    contextSnapshot: Record<string, unknown>
    measuredAt: string
    indicatorCode: string
    indicatorName: string
    evidenceFound: string
    impactedIndicator: string
    observedBehavior: string
    structured: StructuredIndicatorFeedback
    /** Ver createMonitoringFeedback — materiais que o Output decidiu incluir nesta entrega. */
    supportMaterials?: SupportMaterialRecommendation[] | undefined
    supportMaterialsRejected?: SupportMaterialRejection[] | undefined
  } & FeedbackInvestigationFields,
): Promise<{ caseId: string; feedbackId: string }> {
  return createApprovedFeedback(db, {
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    teamId: input.teamId,
    supervisionCase: {
      title: input.structured.title,
      summary: input.structured.summary,
      indicatorCode: input.indicatorCode,
      indicatorValue: input.evidenceFound,
      indicatorTarget: input.impactedIndicator,
    },
    evidence: {
      type: "INDICATOR",
      title: `Medição — ${input.indicatorName}`,
      description: input.evidenceFound,
      sourceType: input.evidenceSourceType,
      sourceId: input.evidenceSourceId,
      occurredAt: input.measuredAt,
    },
    feedback: {
      kind: "INDICATOR",
      impactedIndicator: input.impactedIndicator,
      evidenceFound: input.evidenceFound,
      observedBehavior: input.observedBehavior,
      relatedProcedure: input.structured.relatedProcedure,
      recommendation: input.structured.recommendation,
      contextSnapshot: input.contextSnapshot,
    },
    supportMaterials: input.supportMaterials,
    supportMaterialsRejected: input.supportMaterialsRejected,
    toolTrace: input.toolTrace,
    investigation: input.investigation,
  })
}
