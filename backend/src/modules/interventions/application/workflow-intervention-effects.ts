import type { Database } from "../../../infrastructure/database/pool.js"
import { applyEvaluation, loadRecordedEvaluation, type ApplyEvaluationInput, type ApplyEvaluationResult } from "./apply-evaluation.js"
import { generateReportNarrative, type NarrativeResult } from "./report-narrative.js"

/**
 * Efeitos do nó "Avaliar política de acompanhamento" atrás do `WorkflowEffectSink` — produção grava (avaliação, caso, relatório,
 * intervenções, avisos) numa transação; o QA Lab só registra o que teria acontecido. A avaliação em si (leitura) é a mesma.
 */
export type InterventionEffects = {
  /** Avaliação já gravada para esta execução/nó (retry e retomada reaproveitam — nunca reavaliam nem trocam a versão). */
  recorded(db: Database, organizationId: string, idempotencyKey: string): Promise<ApplyEvaluationResult | null>
  apply(db: Database, input: ApplyEvaluationInput): Promise<ApplyEvaluationResult>
  /** Narrativa do relatório (melhor esforço: a falha fica registrada; o fundamento estruturado já está gravado). */
  generateNarrative(db: Database, input: { organizationId: string; reportId: string }): Promise<NarrativeResult>
}

export const productionInterventionEffects: InterventionEffects = {
  recorded: (db, organizationId, idempotencyKey) => loadRecordedEvaluation(db, organizationId, idempotencyKey),
  apply: (db, input) => applyEvaluation(db, input),
  generateNarrative: (db, input) => generateReportNarrative(db, input),
}
