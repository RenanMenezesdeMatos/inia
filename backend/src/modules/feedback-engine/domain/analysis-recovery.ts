/**
 * RECUPERAÇÃO DA ANÁLISE DE CHAMADA (`CALL_ANALYSIS_CHECKPOINT_V1`, domínio puro).
 *
 * Quatro estados que nunca se confundem:
 *   - INSUFICIÊNCIA REAL: sem transcrição, sem procedimento, nada verificável — execução CONCLUÍDA, reutilizável, sem retentativa;
 *   - INCONCLUSIVA APÓS REVISÃO: a revisão aconteceu e não confirmou nada — CONCLUÍDA, reutilizável (é uma resposta);
 *   - REVISÃO PENDENTE POR FALHA TÉCNICA (timeout, provedor, resposta fora do contrato): a execução NÃO é concluída — fica
 *     SUSPENSA com as propostas da análise e a proveniência (`checkpoint`), nada vai para a memória, e a próxima execução
 *     autorizada retoma SÓ a revisão (a análise paga não é refeita);
 *   - INTERROMPIDA PELO ORÇAMENTO: igual à pendência técnica, com o motivo BUDGET (outra execução, com orçamento, retoma).
 *
 * Compatibilidade entre execuções por ETAPA:
 *   - chave da PROPOSTA = versão do contrato da análise + extração dos critérios + o que o analisador VIU (transcrição, bases com
 *     versão/hash, configuração do especialista, contexto da chamada) — sem o motivo de seleção, que não é evidência; mesma chave =
 *     a resposta da análise já paga vale;
 *   - REVISÃO = a assinatura do pedido de revisão (transcrição + propostas + regras + versão do contrato); mesma assinatura = a
 *     resposta já paga vale; mudou a lógica de verificação ou o contrato da revisão = só a revisão é refeita.
 * Execuções gravadas antes desta versão como "concluídas" com `REVIEW_UNAVAILABLE` (pendência técnica guardada como resultado)
 * são tratadas como PENDENTES: as propostas delas são reaproveitadas e só a revisão é refeita.
 */
export const CALL_ANALYSIS_CHECKPOINT_VERSION = "CALL_ANALYSIS_CHECKPOINT_V1" as const
export type PendingReason = "TECHNICAL" | "BUDGET" | "CONTRACT"
export type CallAnalysisCheckpoint = {
  version: typeof CALL_ANALYSIS_CHECKPOINT_VERSION
  stage: "REVIEW_PENDING"
  proposalKey: string
  reason: PendingReason
  /** Código/nome do erro (nunca prompt nem resposta). */
  error: string
  /** Tentativas de revisão já feitas para estas propostas (somadas entre execuções). */
  reviewAttempts: number
  since: string
  lastAttemptAt: string
}

/** Motivo antigo (pré-correção) de uma revisão que não aconteceu e foi gravada como resultado. */
export const LEGACY_REVIEW_UNAVAILABLE = "REVIEW_UNAVAILABLE"
export const isLegacyPendingOutcome = (reasons: readonly string[] | null | undefined) => (reasons ?? []).includes(LEGACY_REVIEW_UNAVAILABLE)

export function checkpointOf(result: unknown): CallAnalysisCheckpoint | null {
  const checkpoint = result && typeof result === "object" ? (result as { checkpoint?: unknown }).checkpoint : null
  if (!checkpoint || typeof checkpoint !== "object") return null
  const value = checkpoint as Partial<CallAnalysisCheckpoint>
  return value.version === CALL_ANALYSIS_CHECKPOINT_VERSION && value.stage === "REVIEW_PENDING" && typeof value.proposalKey === "string" ? (value as CallAnalysisCheckpoint) : null
}

/** Resposta bruta de uma etapa já paga, com a assinatura do pedido que a produziu. */
export type StageResponse = { requestSha256: string; text: string }
export type StageResponses = { runId: string; status: "RUNNING" | "COMPLETED" | "FAILED"; analysis: StageResponse | null; review: StageResponse | null; /** Confirmação focal dos achados da revisão (quando houve). */ confirmation?: StageResponse | null; at: Date }

export function stageResponsesOf(provenance: unknown): { analysis: StageResponse | null; review: StageResponse | null; confirmation: StageResponse | null } {
  const responses = provenance && typeof provenance === "object" ? (provenance as { modelResponses?: { analysis?: unknown; review?: unknown; confirmation?: unknown } }).modelResponses : null
  const valid = (value: unknown): StageResponse | null => (value && typeof value === "object" && typeof (value as StageResponse).requestSha256 === "string" && typeof (value as StageResponse).text === "string" ? (value as StageResponse) : null)
  return { analysis: valid(responses?.analysis), review: valid(responses?.review), confirmation: valid(responses?.confirmation) }
}
