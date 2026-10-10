import type { Database } from "../../../infrastructure/database/pool.js"
import { createApprovedFeedback } from "./create-approved-feedback.js"
import type { FeedbackInvestigationFields } from "./feedback-investigation-trace.js"
import type { SupportMaterialRecommendation, SupportMaterialRejection } from "../domain/support-material.js"

export type OrchestratorFeedbackSource = { text: string; structuredResult?: Record<string, unknown> | null }

/**
 * Irmã mais simples de create-monitoring-feedback.ts/create-indicator-feedback.ts, para quando
 * a origem do conteúdo é um node Orchestrator, não um Agent analisando uma transcrição
 * específica. Diferença importante: NÃO há checagem verbatim de evidência aqui (a que
 * `run-agent.ts` faz para o caminho `channel_flag`) — o Orchestrator combina a síntese de
 * vários especialistas, não um único trecho-fonte citável. Isso é uma característica conhecida
 * desse caminho, não um bug: ver a seção sobre isso no relatório de validação do motor.
 */
export async function createOrchestratorFeedback(
  db: Database,
  input: {
    organizationId: string
    operatorId: string
    teamId: string
    sourceType: string
    sourceId: string
    occurredAt: string
    orchestratorName: string
    reply: OrchestratorFeedbackSource
    /** Ver createMonitoringFeedback — materiais que o Output decidiu incluir nesta entrega
     * (recomendados pelo Orquestrador na síntese final, validados na execução). */
    supportMaterials?: SupportMaterialRecommendation[] | undefined
    supportMaterialsRejected?: SupportMaterialRejection[] | undefined
  } & FeedbackInvestigationFields,
): Promise<{ caseId: string; feedbackId: string }> {
  const feedbackText = extractFeedbackText(input.reply)
  const title = `Análise de ${input.orchestratorName}`.slice(0, 80)
  const summary = feedbackText.slice(0, 240)

  // Um Orchestrator sintetiza vários especialistas — não há um único indicador/valor/meta
  // comparado, ao contrário do caminho de Agent (create-monitoring-feedback.ts/
  // create-indicator-feedback.ts). indicator_code/value/target são NOT NULL na tabela pra
  // todo case (não só os de Agent), então preenchemos com o nome do Orchestrator como
  // identificação da origem, nunca um indicador/meta inventados.
  return createApprovedFeedback(db, {
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    teamId: input.teamId,
    supervisionCase: { title, summary, indicatorCode: input.orchestratorName, indicatorValue: "—", indicatorTarget: "Síntese de Orchestrator — sem indicador único" },
    evidence: {
      type: "FEEDBACK",
      title: `Síntese — ${input.orchestratorName}`,
      description: feedbackText,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      occurredAt: input.occurredAt,
    },
    feedback: {
      kind: "MONITORING",
      impactedIndicator: input.orchestratorName,
      evidenceFound: feedbackText,
      observedBehavior: "Ver recomendação.",
      relatedProcedure: `Síntese de ${input.orchestratorName}`,
      recommendation: feedbackText,
      contextSnapshot: { orchestratorName: input.orchestratorName, structuredResult: input.reply.structuredResult ?? null },
    },
    supportMaterials: input.supportMaterials,
    supportMaterialsRejected: input.supportMaterialsRejected,
    toolTrace: input.toolTrace,
    investigation: input.investigation,
  })
}

function extractFeedbackText(reply: OrchestratorFeedbackSource): string {
  const structured = reply.structuredResult
  if (structured && typeof structured === "object") {
    const feedback = (structured as Record<string, unknown>).feedback
    if (feedback && typeof feedback === "object" && typeof (feedback as Record<string, unknown>).text === "string") {
      const text = (feedback as Record<string, unknown>).text as string
      if (text.trim()) return text
    }
  }
  return reply.text
}
