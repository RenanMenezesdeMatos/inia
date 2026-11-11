import { randomInt } from "node:crypto"

/**
 * APOIO COM ANJO — catálogos e parâmetros (migration 182; docs/designs/apoio-com-anjo/design_draft.md, seções 5–13 e Apêndice A).
 * Contratos versionados: listas novas entram com versão nova, nunca editando uma publicada. Os mesmos códigos estão nos `check` da
 * migration; os textos para quem lê ficam aqui (o banco grava só o código das mensagens de sistema).
 */
export const HUMAN_SUPPORT_CATALOG_VERSION = "HUMAN_SUPPORT_V1" as const
/** Versão do formato da cópia da troca gravada no pedido (`shared_context`). */
export const SUPPORT_CONTEXT_VERSION = "SUPPORT_CONTEXT_V1" as const

export const REQUEST_STATUSES = ["WAITING", "IN_PROGRESS", "CLOSED", "CANCELLED", "EXPIRED", "ABANDONED"] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]
export const OPEN_REQUEST_STATUSES: readonly RequestStatus[] = ["WAITING", "IN_PROGRESS"]
export const isFinalStatus = (status: RequestStatus) => !OPEN_REQUEST_STATUSES.includes(status)

export const REQUEST_END_CAUSES = ["OPERATOR_CANCELLED", "SCOPE_DISABLED", "QUEUE_EXPIRED", "OPERATOR_ABANDONED", "OPERATOR_CLOSED", "ANJO_CLOSED", "OPERATOR_ABSENT", "INACTIVITY"] as const
export type RequestEndCause = (typeof REQUEST_END_CAUSES)[number]
export const ATTENDANCE_END_CAUSES = ["OPERATOR_CLOSED", "ANJO_CLOSED", "OPERATOR_ABSENT", "INACTIVITY", "ANJO_LOST"] as const
export type AttendanceEndCause = (typeof ATTENDANCE_END_CAUSES)[number]

/** Causas gravadas em `human_support_request_events` (`REQUEST_EVENT_CAUSES_V1`). */
export const REQUEST_EVENT_CAUSES_V1 = ["CREATED", "ASSIGNED", "ANJO_LOST", "REQUEUED", ...REQUEST_END_CAUSES] as const
export type RequestEventCause = (typeof REQUEST_EVENT_CAUSES_V1)[number]

export const REQUEST_ORIGINS = ["BUTTON", "DISLIKE", "SIGNAL"] as const
export type RequestOrigin = (typeof REQUEST_ORIGINS)[number]
export const REQUEST_ORIGIN_LABELS: Record<RequestOrigin, string> = { BUTTON: "Botão “Falar com um Anjo”", DISLIKE: "Descurtida com pedido de ajuda", SIGNAL: "Sugestão da INIA" }

export const PRESENCE_STATUSES = ["AVAILABLE", "PAUSED", "OFFLINE"] as const
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number]
export const PRESENCE_STATUS_LABELS: Record<PresenceStatus, string> = { AVAILABLE: "Disponível", PAUSED: "Em pausa", OFFLINE: "Indisponível" }

/** Motivos de pausa (`PAUSE_REASONS_V1`): só nas tabelas de presença; nenhuma rota do operador os lê. */
export const PAUSE_REASONS_V1 = ["LUNCH", "PERSONAL", "PROCESS_ACTIVITY", "MEETING"] as const
export type PauseReason = (typeof PAUSE_REASONS_V1)[number]
export const PAUSE_REASON_LABELS: Record<PauseReason, string> = { LUNCH: "Lanche", PERSONAL: "Pessoal", PROCESS_ACTIVITY: "Atividade de processo", MEETING: "Reunião" }

/** `ANJO_SCHEDULED` = a pausa ou indisponibilidade que o Anjo programou entrou ao terminar o último atendimento (migration 188). */
export const PRESENCE_EVENT_CAUSES = ["ANJO", "ANJO_SCHEDULED", "LEASE_EXPIRED", "ROLE_REVOKED", "CONNECTION_LOST", "CONNECTION_RESTORED"] as const
/** Causas que mudam o estado declarado (as outras só falam da conexão). */
export const PRESENCE_STATUS_CAUSES = ["ANJO", "ANJO_SCHEDULED", "LEASE_EXPIRED", "ROLE_REVOKED"] as const satisfies readonly PresenceEventCause[]
export type PresenceEventCause = (typeof PRESENCE_EVENT_CAUSES)[number]

/**
 * Classificação do atendimento pelo Anjo. `CLASSIFICATION_CATALOG_V1` (migration 182) tinha os seis motivos de falta de informação;
 * `CLASSIFICATION_CATALOG_V2` (migration 185) acrescenta os dois impedimentos operacionais — o operador precisou do Anjo porque não
 * tem acesso a uma ferramenta ou sistema, ou porque ela está fora do ar — sem mudar os códigos da V1 (registros antigos continuam
 * lidos com o mesmo rótulo; a linha guarda a versão com que foi gravada). O motivo diz POR QUE o operador precisou do Anjo; o
 * resultado (`CLASSIFICATION_OUTCOMES`) é escolhido à parte e nunca é deduzido do motivo.
 */
export const CLASSIFICATION_CATALOG_VERSION = "CLASSIFICATION_CATALOG_V2" as const
export const CLASSIFICATION_REASONS_V1 = ["NO_PROCESS", "NO_GUIDANCE", "QUESTION_UNCLEAR", "FOUND_IN_PROCESS", "AVAILABLE_ELSEWHERE", "OTHER"] as const
export const CLASSIFICATION_REASONS = ["NO_PROCESS", "NO_GUIDANCE", "QUESTION_UNCLEAR", "FOUND_IN_PROCESS", "AVAILABLE_ELSEWHERE", "NO_TOOL_ACCESS", "TOOL_UNAVAILABLE", "OTHER"] as const
export type ClassificationReason = (typeof CLASSIFICATION_REASONS)[number]
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
/** Impedimentos operacionais (V2): o título vira "ferramenta ou sistema afetado" e a descrição, "detalhes" — os dois opcionais. */
export const TOOL_IMPEDIMENT_REASONS: readonly ClassificationReason[] = ["NO_TOOL_ACCESS", "TOOL_UNAVAILABLE"]
export const CLASSIFICATION_OUTCOMES = ["RESOLVED", "GUIDED", "FORWARDED", "NOT_RESOLVED"] as const
export type ClassificationOutcome = (typeof CLASSIFICATION_OUTCOMES)[number]
export const CLASSIFICATION_OUTCOME_LABELS: Record<ClassificationOutcome, string> = {
  RESOLVED: "Resolvido no atendimento",
  GUIDED: "Orientado, depende de ação do operador",
  FORWARDED: "Encaminhado à liderança ou a outra área",
  NOT_RESOLVED: "Não resolvido",
}

export const EVALUATION_RESOLVED = ["YES", "PARTIAL", "NO"] as const
export type EvaluationResolved = (typeof EVALUATION_RESOLVED)[number]
export const EVALUATION_RESOLVED_LABELS: Record<EvaluationResolved, string> = { YES: "Sim", PARTIAL: "Em parte", NO: "Não" }

/** Mensagens de sistema (`SYSTEM_MESSAGE_CODES_V1`): o banco grava só o código; o texto depende de quem lê. */
export const SYSTEM_MESSAGE_CODES_V1 = [
  "QUEUED",
  "ANJO_ASSIGNED",
  "ANJO_CONNECTION_LOST",
  "ANJO_CONNECTION_RESTORED",
  "ANJO_LEFT",
  "ENDED_BY_OPERATOR",
  "ENDED_BY_ANJO",
  "ENDED_OPERATOR_ABSENT",
  "ENDED_INACTIVITY",
  "CANCELLED_BY_OPERATOR",
  "CANCELLED_SCOPE_DISABLED",
  "EXPIRED",
  "ABANDONED",
] as const
export type SystemMessageCode = (typeof SYSTEM_MESSAGE_CODES_V1)[number]
/** Quem lê a conversa: o operador, o Anjo do atendimento ou quem acompanha (Coordenador de Anjos, Administrador geral). */
export type MessageReader = "OPERATOR" | "ANJO" | "OBSERVER"

const anjoOr = (name: string | null | undefined) => (name && name.trim() ? name.trim() : "O Anjo")

/** Texto de uma mensagem de sistema para quem lê. `anjoName` = o Anjo do atendimento a que a mensagem pertence. */
export function systemMessageText(code: SystemMessageCode, reader: MessageReader, names: { anjoName?: string | null } = {}): string {
  const anjo = anjoOr(names.anjoName)
  switch (code) {
    case "QUEUED":
      return reader === "OPERATOR" ? "Pedido criado. Procurando um Anjo…" : "Pedido criado pelo operador."
    case "ANJO_ASSIGNED":
      return reader === "ANJO" ? "Você recebeu este pedido." : reader === "OPERATOR" ? `${anjo} (Anjo) recebeu seu pedido. Aguardando a primeira resposta.` : `${anjo} recebeu o pedido.`
    case "ANJO_CONNECTION_LOST":
      return reader === "ANJO" ? "Você ficou sem conexão. O operador foi avisado." : reader === "OPERATOR" ? "O Anjo está sem conexão. Aguardando…" : `${anjo} ficou sem conexão.`
    case "ANJO_CONNECTION_RESTORED":
      return reader === "ANJO" ? "Sua conexão voltou." : reader === "OPERATOR" ? "O Anjo voltou." : `${anjo} voltou.`
    case "ANJO_LEFT":
      return reader === "ANJO" ? "O atendimento foi interrompido: você ficou sem conexão por mais de 3 minutos ou deixou de ter o papel de Anjo." : reader === "OPERATOR" ? "O Anjo saiu do atendimento. Seu pedido voltou para a fila." : `${anjo} saiu do atendimento. O pedido voltou para a fila.`
    case "ENDED_BY_OPERATOR":
      return reader === "OPERATOR" ? "Atendimento encerrado por você." : "Atendimento encerrado pelo operador."
    case "ENDED_BY_ANJO":
      return reader === "ANJO" ? "Atendimento encerrado por você." : reader === "OPERATOR" ? "Atendimento encerrado pelo Anjo." : `Atendimento encerrado por ${anjo}.`
    case "ENDED_OPERATOR_ABSENT":
      return reader === "OPERATOR" ? "Atendimento encerrado: a INIA estava fechada." : "Atendimento encerrado: operador sem a INIA aberta."
    case "ENDED_INACTIVITY":
      return "Atendimento encerrado por falta de mensagens."
    case "CANCELLED_BY_OPERATOR":
      return reader === "OPERATOR" ? "Você cancelou o pedido." : "Pedido cancelado pelo operador."
    case "CANCELLED_SCOPE_DISABLED":
      return reader === "OPERATOR" ? "O apoio com Anjo foi desativado para sua equipe." : "Pedido cancelado: o apoio com Anjo foi desativado para a equipe."
    case "EXPIRED":
      return reader === "OPERATOR" ? "Nenhum Anjo pôde atender a tempo. O pedido expirou — você pode pedir de novo." : "O pedido expirou na fila."
    case "ABANDONED":
      return reader === "OPERATOR" ? "O pedido foi encerrado porque a INIA ficou fechada." : "Pedido encerrado: o operador fechou a INIA."
  }
}

/** Código de sistema gravado quando o pedido ou o atendimento termina por esta causa. */
export const END_SYSTEM_CODE: Record<RequestEndCause | "ANJO_LOST", SystemMessageCode> = {
  OPERATOR_CANCELLED: "CANCELLED_BY_OPERATOR",
  SCOPE_DISABLED: "CANCELLED_SCOPE_DISABLED",
  QUEUE_EXPIRED: "EXPIRED",
  OPERATOR_ABANDONED: "ABANDONED",
  OPERATOR_CLOSED: "ENDED_BY_OPERATOR",
  ANJO_CLOSED: "ENDED_BY_ANJO",
  OPERATOR_ABSENT: "ENDED_OPERATOR_ABSENT",
  INACTIVITY: "ENDED_INACTIVITY",
  ANJO_LOST: "ANJO_LEFT",
}

/** Parâmetros (Apêndice A). Constantes: nada aqui é configurável pela tela, salvo a capacidade (organização e por Anjo, 1–5). */
export const HUMAN_SUPPORT_LIMITS = {
  defaultCapacity: 2,
  capacityMin: 1,
  capacityMax: 5,
  leaseSeconds: 75,
  graceMs: 3 * 60_000,
  operatorAbandonMs: 2 * 60_000,
  operatorAbsentCloseMs: 5 * 60_000,
  inactivityMs: 15 * 60_000,
  evaluationWindowMs: 24 * 60 * 60_000,
  longPollMaxSeconds: 20,
  waiterTickMs: 1_000,
  dispatchIntervalMs: 3_000,
  maxWaitsPerPersonPerProcess: 4,
  queueHistoryDays: 14,
  queueHistoryMinAssigned: 10,
  queueDeadlineDefaultMinutes: 20,
  queueDeadlineMinMinutes: 10,
  queueDeadlineMaxMinutes: 25,
  noAnjoAttemptWindowMs: 10 * 60_000,
  messageMaxChars: 4_000,
  noteMaxChars: 2_000,
  messagesPageMax: 50,
  stateMessages: 50,
  /** "Digitando" vale por este prazo depois do último sinal da tela (que renova a cada 4 s enquanto a pessoa escreve). */
  typingTtlSeconds: 8,
} as const

/** Protocolo legível do pedido: `AP-` + 6 símbolos sem 0/O/1/I (mesmo padrão do `check` da migration). */
export const PROTOCOL_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
export const PROTOCOL_PATTERN = /^AP-[2-9A-HJ-NP-Z]{6}$/
export function generateProtocol(random: (max: number) => number = (max) => randomInt(max)): string {
  let code = "AP-"
  for (let index = 0; index < 6; index += 1) code += PROTOCOL_ALPHABET[random(PROTOCOL_ALPHABET.length)]
  return code
}
