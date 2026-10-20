import type { Database } from "../../../infrastructure/database/pool.js"
import { createApprovedFeedback } from "./create-approved-feedback.js"
import type { FeedbackInvestigationFields } from "./feedback-investigation-trace.js"
import type { SupportMaterialRecommendation, SupportMaterialRejection } from "../domain/support-material.js"

export type OrchestratorFeedbackSource = {
  text: string
  structuredResult?: Record<string, unknown> | null
  /** Resultados dos especialistas: os de contrato FEEDBACK trazem `evidenceFound` já conferido como citação literal. */
  results?: { contract?: "FEEDBACK" | "TEXT"; structured?: { evidenceFound?: unknown } | undefined }[]
}

/** Marca, no `context_snapshot`, de um feedback cuja "evidência" não é citação conferida — nunca conta como evidência verificável. */
export const UNVERIFIED_EVIDENCE_SNAPSHOT_KEY = "evidenceVerified"

/**
 * Irmã mais simples de create-monitoring-feedback.ts/create-indicator-feedback.ts, para quando a origem do conteúdo é um node
 * Orchestrator, não um Agent analisando uma transcrição específica. Texto gerado por IA nunca é evidência (achado AI-02 da
 * auditoria de 17/10/2026 — antes a síntese inteira virava "evidência encontrada"): a evidência é a citação LITERAL que um
 * especialista de contrato FEEDBACK já conferiu contra a fonte; sem nenhuma, o feedback sai dizendo que não há trecho verificado
 * (apontando a interação de origem), marcado `evidenceVerified: false` — e não conta como evidência nas políticas de acompanhamento.
 * A síntese do Orquestrador continua sendo a recomendação.
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
  const quotes = verifiedQuotes(input.reply)
  const evidenceFound = quotes.length > 0 ? quotes.map((quote) => `"${quote}"`).join("\n") : `Sem trecho literal verificado: a análise é uma síntese de ${input.orchestratorName} gerada por IA. Confira a interação de origem antes de tratar como evidência.`
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
      description: evidenceFound,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      occurredAt: input.occurredAt,
    },
    feedback: {
      kind: "MONITORING",
      impactedIndicator: input.orchestratorName,
      evidenceFound,
      observedBehavior: "Ver recomendação.",
      relatedProcedure: `Síntese de ${input.orchestratorName}`,
      recommendation: feedbackText,
      contextSnapshot: { orchestratorName: input.orchestratorName, structuredResult: input.reply.structuredResult ?? null, [UNVERIFIED_EVIDENCE_SNAPSHOT_KEY]: quotes.length > 0 },
    },
    supportMaterials: input.supportMaterials,
    supportMaterialsRejected: input.supportMaterialsRejected,
    toolTrace: input.toolTrace,
    investigation: input.investigation,
  })
}

/** Citações literais já conferidas pelos especialistas de contrato FEEDBACK (sem repetição, na ordem em que vieram). */
function verifiedQuotes(reply: OrchestratorFeedbackSource): string[] {
  const quotes = (reply.results ?? []).flatMap((result) => (result.contract === "FEEDBACK" && typeof result.structured?.evidenceFound === "string" && result.structured.evidenceFound.trim() ? [result.structured.evidenceFound.trim()] : []))
  return [...new Set(quotes)]
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
