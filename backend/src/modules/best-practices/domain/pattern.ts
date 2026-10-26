import { DomainError } from "../../../shared/domain/domain-error.js"
import { isRecommendableStrength, type EvidenceStrength } from "./evidence-criteria.js"

/**
 * PADRÃO da base: estado de revisão (humano) × disponibilidade para recomendação (DERIVADA, nunca gravada). Um padrão só orienta
 * operadores quando: foi APROVADO por uma pessoa, não pode ser obrigação (verificação OPTIONAL/DIFFERENTIATED_EXECUTION, ou
 * UNDETERMINED confirmado pela revisão), a versão vigente ainda sustenta a associação (força moderada ou forte) e os dados são REAIS.
 * Se uma análise nova enfraquece a evidência, o padrão aprovado deixa de orientar sozinho — sem mudar o estado escolhido pela pessoa.
 */
export type DataOrigin = "REAL" | "SYNTHETIC"
export type ReviewStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "INACTIVE"
export type StoredObligationStatus = "OPTIONAL" | "DIFFERENTIATED_EXECUTION" | "UNDETERMINED"
export type ReviewAction = "APPROVE" | "REJECT" | "DEACTIVATE" | "REACTIVATE" | "CONFIRM_NOT_OBLIGATION" | "EDIT"

export type PatternState = {
  reviewStatus: ReviewStatus
  obligationStatus: StoredObligationStatus
  obligationConfirmedByReview: boolean
  currentStrength: EvidenceStrength
  dataOrigin: DataOrigin
}

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = { PENDING_REVIEW: "Pendente de revisão", APPROVED: "Aprovado", REJECTED: "Rejeitado", INACTIVE: "Desativado" }

/** Motivos (em ordem) pelos quais o padrão não orienta agora; vazio = disponível. `allowSynthetic` só na pré-visualização de teste. */
export function unavailabilityReasonsOf(pattern: PatternState, options: { allowSynthetic?: boolean } = {}): string[] {
  const reasons: string[] = []
  if (pattern.dataOrigin === "SYNTHETIC" && !options.allowSynthetic) reasons.push("Dado sintético: nunca usado em recomendações de produção.")
  if (pattern.reviewStatus === "PENDING_REVIEW") reasons.push("Ainda não foi aprovado por uma pessoa.")
  if (pattern.reviewStatus === "REJECTED") reasons.push("Rejeitado na revisão.")
  if (pattern.reviewStatus === "INACTIVE") reasons.push("Desativado.")
  if (pattern.obligationStatus === "UNDETERMINED" && !pattern.obligationConfirmedByReview) reasons.push("Pode ser uma obrigação do processo: falta a validação.")
  if (!isRecommendableStrength(pattern.currentStrength)) reasons.push("A análise mais recente não sustenta mais a associação (força insuficiente).")
  return reasons
}

export const isAvailable = (pattern: PatternState, options: { allowSynthetic?: boolean } = {}) => unavailabilityReasonsOf(pattern, options).length === 0

export type EditableFields = { name?: string; description?: string; guidance?: string; suggestedPhrasing?: string | null; notApplicableWhen?: string | null }

/**
 * Transição de revisão (pura). Aprovar e reativar exigem evidência sustentada e obrigação resolvida; rejeitar e desativar exigem
 * motivo; editar o texto de um padrão aprovado o devolve para revisão (o que orienta operadores sempre passou por uma pessoa).
 */
export function nextReviewState(pattern: PatternState, action: ReviewAction, reason: string | null): { reviewStatus: ReviewStatus; obligationConfirmedByReview: boolean } {
  const needReason = () => {
    if (!reason || reason.trim().length < 3) throw new DomainError("Informe o motivo desta decisão.", "BEST_PRACTICE_REVIEW_REASON_REQUIRED", 422)
  }
  const approvable = () => {
    if (pattern.obligationStatus === "UNDETERMINED" && !pattern.obligationConfirmedByReview) throw new DomainError("Antes de aprovar, confirme que o comportamento não é uma obrigação do processo.", "BEST_PRACTICE_OBLIGATION_PENDING", 409)
    if (!isRecommendableStrength(pattern.currentStrength)) throw new DomainError("A análise mais recente não sustenta este padrão: não dá para aprová-lo.", "BEST_PRACTICE_EVIDENCE_INSUFFICIENT", 409)
  }
  const invalid = () => new DomainError("Esta ação não vale para o estado atual do padrão.", "BEST_PRACTICE_REVIEW_INVALID_TRANSITION", 409)
  switch (action) {
    case "APPROVE":
      if (pattern.reviewStatus !== "PENDING_REVIEW" && pattern.reviewStatus !== "REJECTED") throw invalid()
      approvable()
      return { reviewStatus: "APPROVED", obligationConfirmedByReview: pattern.obligationConfirmedByReview }
    case "REJECT":
      if (pattern.reviewStatus !== "PENDING_REVIEW" && pattern.reviewStatus !== "APPROVED") throw invalid()
      needReason()
      return { reviewStatus: "REJECTED", obligationConfirmedByReview: pattern.obligationConfirmedByReview }
    case "DEACTIVATE":
      if (pattern.reviewStatus !== "APPROVED") throw invalid()
      needReason()
      return { reviewStatus: "INACTIVE", obligationConfirmedByReview: pattern.obligationConfirmedByReview }
    case "REACTIVATE":
      if (pattern.reviewStatus !== "INACTIVE") throw invalid()
      approvable()
      return { reviewStatus: "APPROVED", obligationConfirmedByReview: pattern.obligationConfirmedByReview }
    case "CONFIRM_NOT_OBLIGATION":
      if (pattern.obligationStatus !== "UNDETERMINED" || pattern.obligationConfirmedByReview) throw invalid()
      needReason()
      return { reviewStatus: pattern.reviewStatus, obligationConfirmedByReview: true }
    case "EDIT":
      if (pattern.reviewStatus === "INACTIVE" || pattern.reviewStatus === "REJECTED") throw invalid()
      return { reviewStatus: "PENDING_REVIEW", obligationConfirmedByReview: pattern.obligationConfirmedByReview }
  }
}
