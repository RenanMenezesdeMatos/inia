import type { RequestStatus } from "./catalogs.js"
import { canReceiveAssignment, notEligibleReason, type AnjoSituation, type NotEligibleReason } from "./presence.js"

/**
 * TRANSFERÊNCIA DE ATENDIMENTO PELA COORDENAÇÃO (migration 190; decisão do responsável em 2026-11-11). Só com o pedido EM ATENDIMENTO.
 * Destino: um Anjo que pode receber AGORA (o papel cobre o Grupo/Subgrupo do pedido, Disponível, com a área aberta, sem pausa ou
 * indisponibilidade programada e com vaga — a mesma regra da distribuição), que não seja o Anjo atual nem o próprio operador; ou a
 * FRENTE da fila, quando nenhum puder. O motivo é obrigatório e curto, e nunca chega ao operador.
 */
export type TransferTarget = { kind: "ANJO"; anjoPersonId: string } | { kind: "QUEUE" }
export type TransferRefusal = "HUMAN_SUPPORT_TRANSFER_NOT_IN_PROGRESS" | "HUMAN_SUPPORT_TRANSFER_SAME_ANJO" | "HUMAN_SUPPORT_TRANSFER_TARGET_UNAVAILABLE"
export type TransferDecision = { ok: true } | { ok: false; code: TransferRefusal; notEligible?: NotEligibleReason | "NOT_AN_ANJO" }

export function transferDecision(input: { requestStatus: RequestStatus; currentAnjoPersonId: string | null; target: TransferTarget; targetSituation: AnjoSituation | null }): TransferDecision {
  if (input.requestStatus !== "IN_PROGRESS" || !input.currentAnjoPersonId) return { ok: false, code: "HUMAN_SUPPORT_TRANSFER_NOT_IN_PROGRESS" }
  if (input.target.kind === "QUEUE") return { ok: true }
  if (input.target.anjoPersonId === input.currentAnjoPersonId) return { ok: false, code: "HUMAN_SUPPORT_TRANSFER_SAME_ANJO" }
  if (!input.targetSituation) return { ok: false, code: "HUMAN_SUPPORT_TRANSFER_TARGET_UNAVAILABLE", notEligible: "NOT_AN_ANJO" }
  if (!canReceiveAssignment(input.targetSituation)) return { ok: false, code: "HUMAN_SUPPORT_TRANSFER_TARGET_UNAVAILABLE", notEligible: notEligibleReason(input.targetSituation) ?? "NO_CAPACITY" }
  return { ok: true }
}

/** Por que um Anjo não aparece como destino possível (texto da tela e da recusa). */
export const TRANSFER_NOT_ELIGIBLE_TEXT: Record<NotEligibleReason | "NOT_AN_ANJO" | "CURRENT_ANJO", string> = {
  SCOPE_NOT_COVERED: "Não atende o Grupo/Subgrupo deste pedido",
  OFFLINE: "Indisponível",
  NOT_CONNECTED: "Sem a área do Anjo aberta",
  PAUSED: "Em pausa",
  SCHEDULED_CHANGE: "Com pausa ou indisponibilidade programada",
  NO_CAPACITY: "Sem vaga",
  NOT_AN_ANJO: "Não é Anjo deste pedido",
  CURRENT_ANJO: "Atende este pedido agora",
}
