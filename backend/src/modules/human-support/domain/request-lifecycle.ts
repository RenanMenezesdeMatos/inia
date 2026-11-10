import { HUMAN_SUPPORT_LIMITS, type RequestEndCause, type RequestStatus } from "./catalogs.js"

/**
 * CICLO DE VIDA DO PEDIDO E DO ATENDIMENTO (design_draft.md seção 7). Decisões puras; a gravação (transição condicional
 * `update … where status = <esperado>` sob a trava da organização) fica na aplicação. Estados finais nunca reabrem: nova
 * necessidade = novo pedido.
 *
 *   — → Na fila (operador pede) → Em atendimento (distribuição atribui, sem aceite — D2)
 *   Na fila → Cancelado (operador; escopo desligado) | Expirado (prazo da fila) | Abandonado (operador sem chamar há 2 min)
 *   Em atendimento → Na fila (Interrompido: Anjo sem conexão 3 min além do prazo, ou papel revogado; volta para a frente)
 *   Em atendimento → Encerrado (operador, Anjo, operador ausente, 15 min sem mensagem)
 */
export type LifecycleRefusal = "HUMAN_SUPPORT_REQUEST_ENDED" | "HUMAN_SUPPORT_OPERATOR_PRESENT" | "HUMAN_SUPPORT_NOT_YOUR_ATTENDANCE"

export type CancelDecision = { ok: true; status: "CANCELLED"; cause: "OPERATOR_CANCELLED" } | { ok: false; code: LifecycleRefusal }

/** "Cancelar pedido" só vale Na fila; em atendimento o caminho é "Encerrar atendimento". */
export function cancelDecision(status: RequestStatus): CancelDecision {
  return status === "WAITING" ? { ok: true, status: "CANCELLED", cause: "OPERATOR_CANCELLED" } : { ok: false, code: "HUMAN_SUPPORT_REQUEST_ENDED" }
}

export type CloseInput = {
  status: RequestStatus
  actor: "OPERATOR" | "ANJO"
  /** Só o Anjo: "Encerrar: operador sem a INIA aberta". */
  cause?: "OPERATOR_ABSENT" | undefined
  /** O Anjo que pede é o do atendimento em andamento. */
  isActiveAnjo?: boolean
  operatorSeenAt: Date
  now: Date
}
export type CloseDecision = { ok: true; kind: "CLOSE"; cause: Extract<RequestEndCause, "OPERATOR_CLOSED" | "ANJO_CLOSED" | "OPERATOR_ABSENT"> } | { ok: true; kind: "CANCEL"; cause: "OPERATOR_CANCELLED" } | { ok: false; code: LifecycleRefusal }

/**
 * Encerrar: o operador encerra o atendimento em andamento (também antes da primeira resposta); com o pedido de volta à fila (o
 * atendimento foi interrompido enquanto ele clicava), encerrar vira cancelar. O Anjo encerra o PRÓPRIO atendimento; "operador sem a
 * INIA aberta" só com o operador sem chamar o servidor há mais de 5 min.
 */
export function closeDecision(input: CloseInput): CloseDecision {
  if (input.actor === "OPERATOR") {
    if (input.status === "IN_PROGRESS") return { ok: true, kind: "CLOSE", cause: "OPERATOR_CLOSED" }
    if (input.status === "WAITING") return { ok: true, kind: "CANCEL", cause: "OPERATOR_CANCELLED" }
    return { ok: false, code: "HUMAN_SUPPORT_REQUEST_ENDED" }
  }
  if (input.status !== "IN_PROGRESS") return { ok: false, code: "HUMAN_SUPPORT_REQUEST_ENDED" }
  if (!input.isActiveAnjo) return { ok: false, code: "HUMAN_SUPPORT_NOT_YOUR_ATTENDANCE" }
  if (input.cause === "OPERATOR_ABSENT") {
    return input.now.getTime() - input.operatorSeenAt.getTime() > HUMAN_SUPPORT_LIMITS.operatorAbsentCloseMs ? { ok: true, kind: "CLOSE", cause: "OPERATOR_ABSENT" } : { ok: false, code: "HUMAN_SUPPORT_OPERATOR_PRESENT" }
  }
  return { ok: true, kind: "CLOSE", cause: "ANJO_CLOSED" }
}

/** O operador pode escrever na fila e no atendimento; o Anjo só no próprio atendimento em andamento. */
export function canWriteMessage(input: { status: RequestStatus; author: "OPERATOR" | "ANJO"; isActiveAnjo: boolean }): { ok: true } | { ok: false; code: "HUMAN_SUPPORT_REQUEST_ENDED" | "NOT_FOUND" } {
  if (input.status !== "WAITING" && input.status !== "IN_PROGRESS") return { ok: false, code: "HUMAN_SUPPORT_REQUEST_ENDED" }
  if (input.author === "ANJO" && (input.status !== "IN_PROGRESS" || !input.isActiveAnjo)) return { ok: false, code: "NOT_FOUND" }
  return { ok: true }
}

/** Prazos vencidos (sempre contra o relógio do banco na aplicação; aqui, para os testes e para a visão). */
export const queueExpired = (queueExpiresAt: Date, now: Date) => queueExpiresAt.getTime() <= now.getTime()
export const operatorAbandoned = (operatorSeenAt: Date, now: Date) => now.getTime() - operatorSeenAt.getTime() > HUMAN_SUPPORT_LIMITS.operatorAbandonMs
export const attendanceInactive = (lastHumanMessageAt: Date, now: Date) => now.getTime() - lastHumanMessageAt.getTime() > HUMAN_SUPPORT_LIMITS.inactivityMs
/** O Anjo perdeu o atendimento: sem conexão por mais de 3 min DEPOIS do fim do prazo da conexão (75 s). */
export const anjoLost = (leaseUntil: Date | null, now: Date) => leaseUntil === null || now.getTime() - leaseUntil.getTime() > HUMAN_SUPPORT_LIMITS.graceMs
