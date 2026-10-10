import type { Database } from "../../../infrastructure/database/pool.js"
import { createApprovedFeedback } from "./create-approved-feedback.js"
import type { RawProcessAssessment } from "../../agents/domain/process-assessment-contract.js"
import type { VerifiedProcessAudit } from "../../agents/domain/process-audit.js"
import type { SupportMaterialRecommendation, SupportMaterialRejection } from "../domain/support-material.js"
import type { FeedbackInvestigationFields } from "./feedback-investigation-trace.js"

export type StructuredMonitoringFeedback = {
  title: string
  summary: string
  impactedIndicator: string
  evidenceFound: string
  observedBehavior: string
  relatedProcedure: string
  recommendation: string
  /** Presente só quando o Workflow pediu o contrato PROCESS_AUDIT (ver run-agent.ts) — etapas
   * esperadas × evidência literal × status, já verificadas por código. Persistido no
   * context_snapshot do Feedback para ficar auditável junto do caso. */
  processAudit?: VerifiedProcessAudit
  /** V1.6.0 — presente só com o contrato PROCESS_ASSESSMENT: o que o modelo AFIRMA sobre os processos aplicáveis (não
   * verificado aqui — quem verifica e decide o que vira feedback é a camada de confiabilidade). */
  processAssessment?: RawProcessAssessment
}

export async function createMonitoringFeedback(
  db: Database,
  input: {
    organizationId: string
    operatorId: string
    teamId: string
    interactionId: string
    interactionOccurredAt: string
    flagName: string
    matchedValueText: string
    thresholdText: string
    structured: StructuredMonitoringFeedback
    /** Materiais de apoio que o Output decidiu INCLUIR nesta entrega (`includeSupportMaterials`)
     * — já escolhidos e validados na execução do Agent/Orquestrador (feedbacks/domain/
     * support-material.ts); a persistência revalida contra o banco e o destinatário. Ausente =
     * a entrega não apresenta materiais, mesmo que a IA tenha recomendado. */
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
      indicatorCode: input.flagName,
      indicatorValue: input.matchedValueText,
      indicatorTarget: input.thresholdText,
    },
    evidence: {
      type: "TRANSCRIPT",
      title: `Trecho da transcrição — ${input.flagName}`,
      description: input.structured.evidenceFound,
      sourceType: "interaction",
      sourceId: input.interactionId,
      occurredAt: input.interactionOccurredAt,
    },
    feedback: {
      kind: "MONITORING",
      impactedIndicator: input.structured.impactedIndicator,
      evidenceFound: input.structured.evidenceFound,
      observedBehavior: input.structured.observedBehavior,
      relatedProcedure: input.structured.relatedProcedure,
      recommendation: input.structured.recommendation,
      contextSnapshot: { interactionId: input.interactionId, ...(input.structured.processAudit ? { processAudit: input.structured.processAudit } : {}) },
    },
    supportMaterials: input.supportMaterials,
    supportMaterialsRejected: input.supportMaterialsRejected,
    toolTrace: input.toolTrace,
    investigation: input.investigation,
  })
}
