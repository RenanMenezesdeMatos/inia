import { z } from "zod"

/**
 * Espelho de backend/src/modules/human-support/domain/catalogs.ts (Apoio com Anjo, migration 182): códigos e rótulos. Os textos das
 * mensagens de sistema vêm prontos do servidor (dependem de quem lê); aqui ficam só os rótulos de tela.
 */
export const REQUEST_STATUSES = ["WAITING", "IN_PROGRESS", "CLOSED", "CANCELLED", "EXPIRED", "ABANDONED"] as const
export const requestStatusSchema = z.enum(REQUEST_STATUSES)
export type RequestStatus = z.infer<typeof requestStatusSchema>
export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = { WAITING: "Na fila", IN_PROGRESS: "Em atendimento", CLOSED: "Encerrado", CANCELLED: "Cancelado", EXPIRED: "Expirado", ABANDONED: "Abandonado" }

export const REQUEST_ORIGINS = ["BUTTON", "DISLIKE", "SIGNAL"] as const
export const requestOriginSchema = z.enum(REQUEST_ORIGINS)
export type RequestOrigin = z.infer<typeof requestOriginSchema>
export const REQUEST_ORIGIN_LABELS: Record<RequestOrigin, string> = { BUTTON: "Botão “Falar com um Anjo”", DISLIKE: "Descurtida com pedido de ajuda", SIGNAL: "Sugestão da INIA" }

export const END_CAUSE_LABELS: Record<string, string> = {
  OPERATOR_CANCELLED: "Cancelado pelo operador",
  SCOPE_DISABLED: "Apoio desligado para a equipe",
  QUEUE_EXPIRED: "Expirou na fila",
  OPERATOR_ABANDONED: "INIA fechada pelo operador",
  OPERATOR_CLOSED: "Encerrado pelo operador",
  ANJO_CLOSED: "Encerrado pelo Anjo",
  OPERATOR_ABSENT: "Operador sem a INIA aberta",
  INACTIVITY: "Falta de mensagens",
  ANJO_LOST: "Interrompido (Anjo sem conexão)",
}

export const PRESENCE_STATUSES = ["AVAILABLE", "PAUSED", "OFFLINE"] as const
export const presenceStatusSchema = z.enum(PRESENCE_STATUSES)
export type PresenceStatus = z.infer<typeof presenceStatusSchema>
export const PRESENCE_STATUS_LABELS: Record<PresenceStatus, string> = { AVAILABLE: "Disponível", PAUSED: "Em pausa", OFFLINE: "Indisponível" }

export const PAUSE_REASONS = ["LUNCH", "PERSONAL", "PROCESS_ACTIVITY", "MEETING"] as const
export const pauseReasonSchema = z.enum(PAUSE_REASONS)
export type PauseReason = z.infer<typeof pauseReasonSchema>
export const PAUSE_REASON_LABELS: Record<PauseReason, string> = { LUNCH: "Lanche", PERSONAL: "Pessoal", PROCESS_ACTIVITY: "Atividade de processo", MEETING: "Reunião" }

/**
 * Motivo do encaminhamento (`CLASSIFICATION_CATALOG_V2`, migration 185): os seis da V1 (falta de informação) e os dois impedimentos
 * operacionais — sem acesso à ferramenta/sistema e ferramenta/sistema indisponível, separados por serem problemas diferentes. Os
 * códigos da V1 não mudaram: registros antigos continuam com o mesmo rótulo. O motivo nunca define o resultado.
 */
export const CLASSIFICATION_REASONS = ["NO_PROCESS", "NO_GUIDANCE", "QUESTION_UNCLEAR", "FOUND_IN_PROCESS", "AVAILABLE_ELSEWHERE", "NO_TOOL_ACCESS", "TOOL_UNAVAILABLE", "OTHER"] as const
export const classificationReasonSchema = z.enum(CLASSIFICATION_REASONS)
export type ClassificationReason = z.infer<typeof classificationReasonSchema>
export const CLASSIFICATION_REASON_LABELS: Record<ClassificationReason, string> = {
  NO_PROCESS: "Falta de processo cadastrado",
  NO_GUIDANCE: "Falta de alinhamento ou orientação disponível",
  QUESTION_UNCLEAR: "Pergunta mal formulada",
  FOUND_IN_PROCESS: "Informação existente em processo que poderia ter sido encontrada",
  AVAILABLE_ELSEWHERE: "Informação que poderia ter sido obtida pelo sistema ou por outra IA",
  NO_TOOL_ACCESS: "Sem acesso à ferramenta ou ao sistema",
  TOOL_UNAVAILABLE: "Ferramenta ou sistema indisponível",
  OTHER: "Outro",
}
/** Explicação curta de cada motivo, mostrada junto da opção no formulário. */
export const CLASSIFICATION_REASON_HINTS: Partial<Record<ClassificationReason, string>> = {
  NO_TOOL_ACCESS: "O operador não tem acesso ou permissão para executar a ação.",
  TOOL_UNAVAILABLE: "Serviço fora do ar, com falha ou instável, que impede a execução.",
}
/** Impedimentos operacionais: o título vira "ferramenta ou sistema afetado" e a descrição, "detalhes" — os dois opcionais. */
export const CLASSIFICATION_TOOL_REASONS: readonly ClassificationReason[] = ["NO_TOOL_ACCESS", "TOOL_UNAVAILABLE"]
/** Título obrigatório quando a informação existia; opcional em pergunta mal formulada e nos impedimentos; não pedido nos demais. */
export const CLASSIFICATION_TITLE_REQUIRED: readonly ClassificationReason[] = ["FOUND_IN_PROCESS", "AVAILABLE_ELSEWHERE"]
export const CLASSIFICATION_TITLE_OPTIONAL: readonly ClassificationReason[] = ["QUESTION_UNCLEAR", ...CLASSIFICATION_TOOL_REASONS]
/** Descrição obrigatória em "Outro"; opcional (detalhes) nos impedimentos; não pedida nos demais. */
export const CLASSIFICATION_DESCRIPTION_OPTIONAL: readonly ClassificationReason[] = CLASSIFICATION_TOOL_REASONS

/** Rótulos dos campos complementares da classificação, pelo motivo (formulário do Anjo e detalhe do painel). */
export function classificationFieldLabels(reason: ClassificationReason | null): { section: string; title: string; description: string } {
  if (reason && CLASSIFICATION_TOOL_REASONS.includes(reason)) return { section: "Ferramenta ou sistema", title: "Ferramenta ou sistema afetado", description: "Detalhes" }
  return { section: "Onde estava a informação", title: "Título do processo, sistema ou IA", description: "Descrição do motivo" }
}

export const CLASSIFICATION_OUTCOMES = ["RESOLVED", "GUIDED", "FORWARDED", "NOT_RESOLVED"] as const
export const classificationOutcomeSchema = z.enum(CLASSIFICATION_OUTCOMES)
export type ClassificationOutcome = z.infer<typeof classificationOutcomeSchema>
export const CLASSIFICATION_OUTCOME_LABELS: Record<ClassificationOutcome, string> = { RESOLVED: "Resolvido no atendimento", GUIDED: "Orientado, depende de ação do operador", FORWARDED: "Encaminhado à liderança ou a outra área", NOT_RESOLVED: "Não resolvido" }

export const EVALUATION_RESOLVED = ["YES", "PARTIAL", "NO"] as const
export const evaluationResolvedSchema = z.enum(EVALUATION_RESOLVED)
export type EvaluationResolved = z.infer<typeof evaluationResolvedSchema>
export const EVALUATION_RESOLVED_LABELS: Record<EvaluationResolved, string> = { YES: "Sim", PARTIAL: "Em parte", NO: "Não" }

export const HUMAN_SUPPORT_TEXT_LIMITS = { message: 4000, note: 2000, classificationTitle: { min: 3, max: 200 }, classificationDescription: { min: 3, max: 1000 }, url: 500 } as const

/** Aviso fixo na sala de apoio (design_draft.md seção 10). */
export const SUPPORT_ROOM_NOTICE = "A INIA não lê esta conversa. Coordenadores de Anjos e o Administrador geral podem ler."
/** Rótulo e dica do botão permanente e das sugestões (OQ4). */
export const SUPPORT_BUTTON_LABEL = "Falar com um Anjo"
export const SUPPORT_BUTTON_HINT = "Pedir ajuda a uma pessoa da equipe de apoio"
