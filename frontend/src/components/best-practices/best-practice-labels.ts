import type { EvidenceStrength, ReviewStatus } from "@/schemas/best-practices/best-practices.schema"

/** Rótulos de apresentação da base de boas práticas (os números e os textos explicativos vêm prontos do backend). */
export const REVIEW_LABELS: Record<ReviewStatus, string> = { PENDING_REVIEW: "Pendente de revisão", APPROVED: "Aprovado", REJECTED: "Rejeitado", INACTIVE: "Desativado" }
export const STRENGTH_LABELS: Record<EvidenceStrength, string> = { STRONG: "Forte", MODERATE: "Moderada", WEAK: "Fraca", INSUFFICIENT: "Insuficiente" }
export const OBLIGATION_LABELS: Record<string, string> = {
  OPTIONAL: "Comportamento opcional",
  DIFFERENTIATED_EXECUTION: "Execução diferenciada de etapa obrigatória",
  UNDETERMINED: "Pendente: pode ser obrigação",
  OBLIGATION: "Obrigação do processo (descartado)",
  CONFLICT: "Contraria o processo (descartado)",
}
export const OUTCOME_LABELS: Record<string, string> = {
  SUPPORTED: "Associação sustentada",
  WEAK_ASSOCIATION: "Associação fraca",
  NO_DIFFERENCE: "Sem diferença",
  MORE_FREQUENT_IN_REFERENCE: "Mais frequente na referência",
  COMMON_TO_BOTH: "Comum aos dois grupos",
  ISOLATED: "Ocorrência isolada",
  CONCENTRATED: "Concentrado em um operador",
  INSUFFICIENT_DATA: "Dados insuficientes",
}
export const DECISION_LABELS: Record<string, string> = {
  PATTERN_CREATED: "Padrão criado",
  PATTERN_UPDATED: "Padrão atualizado",
  PATTERN_WEAKENED: "Padrão enfraquecido",
  DISCARDED_OBLIGATION: "Descartado: obrigação",
  DISCARDED_CONFLICT: "Descartado: contraria o processo",
  NOT_SUPPORTED: "Sem sustentação",
}
export const ANALYSIS_STATUS_LABELS: Record<string, string> = { QUEUED: "Na fila", RUNNING: "Em andamento", COMPLETED: "Concluída", FAILED: "Falhou" }
export const ANALYSIS_OUTCOME_LABELS: Record<string, string> = { PATTERNS_FOUND: "Padrões encontrados", NO_PATTERN: "Nenhum padrão sustentado", INSUFFICIENT_DATA: "Dados insuficientes", PARTIAL: "Parcial" }
export const DISCOVERY_REJECTION_LABELS: Record<string, string> = { REQUIRES_AUDIO: "exige áudio", INVALID_SHAPE: "resposta incompleta", DUPLICATE: "duplicado", UNKNOWN_EXAMPLE_REFS: "exemplo inexistente", OVER_LIMIT: "acima do limite" }
export const REVIEW_ACTION_LABELS: Record<string, string> = { APPROVE: "Aprovado", REJECT: "Rejeitado", DEACTIVATE: "Desativado", REACTIVATE: "Reativado", CONFIRM_NOT_OBLIGATION: "Confirmado: não é obrigação", EDIT: "Texto editado", ANALYSIS_UPDATE: "Atualizado por análise" }

export const reviewBadgeVariant = (status: ReviewStatus) => (status === "APPROVED" ? "default" : status === "PENDING_REVIEW" ? "secondary" : "outline") as "default" | "secondary" | "outline"
export const percentLabel = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${Math.round(value)}%`)
