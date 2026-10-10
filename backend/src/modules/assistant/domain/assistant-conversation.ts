/**
 * CONVERSA COM A INIA — regras puras (sem banco). Uma conversa é a unidade de leitura do diálogo do colaborador com a
 * INIA; a sessão técnica de voz (conexão Gemini Live) é outra coisa e nunca decide início/fim de conversa.
 *
 * Decisão da escrita (`decideConversationForWrite`), aplicada no backend a CADA mensagem nova:
 *   * o cliente informa a conversa que está exibindo (ou `null` = "a conversa atual / uma nova");
 *   * conversa pedida e ativa, dentro da janela de inatividade → continua nela;
 *   * conversa pedida e ativa, mas inativa há mais que a janela → é encerrada (INACTIVITY) e a mensagem abre outra;
 *   * conversa pedida já ENCERRADA (outra aba iniciou nova conversa, ou foi encerrada por inatividade) → recusa: o cliente
 *     troca para a conversa atual em vez de misturar mensagens;
 *   * sem conversa pedida → a ativa (se dentro da janela) ou uma nova.
 * Conversa só nasce com mensagem: nada aqui cria conversa vazia.
 */
export const DEFAULT_CONVERSATION_INACTIVITY_HOURS = 24

export type ConversationStatus = "ACTIVE" | "CLOSED"
export type ConversationKind = "CONVERSATION" | "LEGACY_HISTORY"
export type ConversationCloseReason = "MANUAL" | "INACTIVITY" | "LEGACY" | "COMPLETED"
/** USER = iniciada pela pessoa (a conversa "atual" é sempre uma destas); WORKFLOW = criada por um nó Output (Chat), com a
 * primeira mensagem da INIA — nunca disputa a conversa atual e não é trocada por inatividade (o assunto é o artefato);
 * FEEDBACK = a conversa de uma APLICAÇÃO de feedback (feedback-application): mesma regra do WORKFLOW enquanto a aplicação está
 * em andamento; concluída (COMPLETED) não recebe mensagem nova — só a resposta que já estava em processamento. */
export type ConversationOrigin = "USER" | "WORKFLOW" | "FEEDBACK"

export type ConversationRecord = {
  id: string
  organizationId: string
  ownerPersonId: string
  kind: ConversationKind
  status: ConversationStatus
  startedAt: Date
  lastActivityAt: Date
  closedAt: Date | null
  closeReason: ConversationCloseReason | null
  /** Ausente em registros montados antes dos Workflow Outputs V1 = USER. */
  origin?: ConversationOrigin
}

export type ConversationWriteDecision =
  | { action: "USE"; conversationId: string; closed?: boolean }
  | { action: "CREATE"; closeFirst: { conversationId: string; reason: "INACTIVITY" } | null }
  | { action: "REJECT_CLOSED"; activeConversationId: string | null }
  | { action: "REJECT_NOT_FOUND" }

/** Conversa de aplicação concluída: só aceita o turno de voz que já estava em processamento (fechado há no máximo isto). */
export const FEEDBACK_LATE_REPLY_GRACE_MS = 2 * 60 * 1000

export const isInactive = (conversation: Pick<ConversationRecord, "lastActivityAt">, now: Date, inactivityMs: number) =>
  now.getTime() - conversation.lastActivityAt.getTime() >= inactivityMs

export function decideConversationForWrite(input: {
  requested: ConversationRecord | null
  requestedId: string | null
  active: ConversationRecord | null
  now: Date
  inactivityMs: number
  /** Turno de voz já em andamento (resposta de especialista / transcrição do turno): pertence à conversa em que a
   * sessão de voz foi aberta, mesmo que ela tenha sido encerrada nesse meio-tempo — nunca migra para outra. */
  allowClosed?: boolean
}): ConversationWriteDecision {
  const { requested, requestedId, active, now, inactivityMs } = input
  if (requestedId) {
    // Conversa de outro dono/organização ou histórico legado nunca recebe mensagem nova.
    if (!requested || requested.kind !== "CONVERSATION") return { action: "REJECT_NOT_FOUND" }
    if (requested.status === "CLOSED") {
      // Aplicação de feedback concluída: só a resposta que já estava em processamento (dentro da janela curta) entra — nunca
      // uma pergunta nova, e a conversa continua encerrada (nada reabre em silêncio).
      const lateReplyAllowed = input.allowClosed && (requested.origin !== "FEEDBACK" || (requested.closedAt !== null && now.getTime() - requested.closedAt.getTime() <= FEEDBACK_LATE_REPLY_GRACE_MS))
      if (lateReplyAllowed) return { action: "USE", conversationId: requested.id, closed: true }
      const current = active && !isInactive(active, now, inactivityMs) ? active.id : null
      return { action: "REJECT_CLOSED", activeConversationId: current }
    }
    // Conversa criada por um Workflow continua sendo a conversa daquele recado — responder dias depois segue nela.
    // O mesmo para a conversa de uma aplicação de feedback: retomar dias depois continua nela.
    if (requested.origin === "WORKFLOW" || requested.origin === "FEEDBACK") return { action: "USE", conversationId: requested.id }
    if (isInactive(requested, now, inactivityMs)) return { action: "CREATE", closeFirst: { conversationId: requested.id, reason: "INACTIVITY" } }
    return { action: "USE", conversationId: requested.id }
  }
  if (active && !isInactive(active, now, inactivityMs)) return { action: "USE", conversationId: active.id }
  return { action: "CREATE", closeFirst: active ? { conversationId: active.id, reason: "INACTIVITY" } : null }
}

/** Instante de uma fala do usuário informado pelo cliente (voz): aceito só dentro de [agora − 10 min, agora]. */
export const MAX_CLIENT_OCCURRED_AT_SKEW_MS = 10 * 60 * 1000
export function clampOccurredAt(clientValue: Date | null | undefined, now: Date): Date {
  if (!clientValue || Number.isNaN(clientValue.getTime())) return now
  const min = now.getTime() - MAX_CLIENT_OCCURRED_AT_SKEW_MS
  return new Date(Math.min(now.getTime(), Math.max(min, clientValue.getTime())))
}

/** Prévia legível de uma mensagem (lista de conversas): texto puro, sem marcação, cortado com reticências. */
export function previewOf(content: string, maxLength = 120): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`|~]+/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1).trimEnd()}…` : plain
}

/** Cursor estável de mensagem: (occurred_at, seq). Opaco para o cliente. */
export type MessageCursor = { occurredAt: string; seq: string }
export const encodeCursor = (cursor: MessageCursor) => Buffer.from(`${cursor.occurredAt}|${cursor.seq}`, "utf8").toString("base64url")
export function decodeCursor(value: string | undefined | null): MessageCursor | null {
  if (!value) return null
  const decoded = Buffer.from(value, "base64url").toString("utf8")
  const [occurredAt, seq] = decoded.split("|")
  if (!occurredAt || !seq || !/^\d+$/.test(seq) || Number.isNaN(new Date(occurredAt).getTime())) return null
  return { occurredAt, seq }
}
