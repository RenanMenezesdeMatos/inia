import type { PauseReason, PresenceStatus } from "./catalogs.js"

/**
 * PRESENÇA DO ANJO (design_draft.md seção 6). O estado DECLARADO (Disponível, Em pausa, Indisponível) é do Anjo; a CONEXÃO é
 * calculada: conectado = `lease_until` no futuro (renovado só pela chamada de estado da área do Anjo, nunca por POST).
 */
export const isConnected = (leaseUntil: Date | null, now: Date) => leaseUntil !== null && leaseUntil.getTime() > now.getTime()

export type PresenceRequest = { status: "AVAILABLE" } | { status: "PAUSED"; pauseReason: PauseReason } | { status: "OFFLINE" }
export type PresenceChangeContext = { connected: boolean; hasEnabledScope: boolean; activeAttendances: number }
export type PresenceChangeRefusal = "HUMAN_SUPPORT_NOT_CONNECTED" | "HUMAN_SUPPORT_NO_ENABLED_SCOPE" | "HUMAN_SUPPORT_ACTIVE_ATTENDANCES" | "HUMAN_SUPPORT_PRESENCE_INVALID"
export type PresenceChange = { ok: true; changed: boolean; status: PresenceStatus; pauseReason: PauseReason | null } | { ok: false; code: PresenceChangeRefusal }

/**
 * Transições declaradas pelo Anjo:
 *  - Indisponível → Disponível: exige a área aberta (conectado) e o papel cobrindo algum escopo ligado;
 *  - Disponível → Em pausa (com motivo); Em pausa → outro motivo; Em pausa → Disponível ("Voltar");
 *  - Disponível/Em pausa → Indisponível: recusado com atendimento em andamento;
 *  - pedir o estado em que já está não muda nada.
 * As transições do SISTEMA (sem conexão há 3 min, papel revogado) são da distribuição, não daqui.
 */
export function presenceChange(current: { status: PresenceStatus; pauseReason: PauseReason | null }, requested: PresenceRequest, context: PresenceChangeContext): PresenceChange {
  const requestedReason = requested.status === "PAUSED" ? requested.pauseReason : null
  if (current.status === requested.status && current.pauseReason === requestedReason) return { ok: true, changed: false, status: current.status, pauseReason: current.pauseReason }
  switch (requested.status) {
    case "AVAILABLE":
      if (current.status === "OFFLINE") {
        if (!context.connected) return { ok: false, code: "HUMAN_SUPPORT_NOT_CONNECTED" }
        if (!context.hasEnabledScope) return { ok: false, code: "HUMAN_SUPPORT_NO_ENABLED_SCOPE" }
      }
      return { ok: true, changed: true, status: "AVAILABLE", pauseReason: null }
    case "PAUSED":
      if (current.status === "OFFLINE") return { ok: false, code: "HUMAN_SUPPORT_PRESENCE_INVALID" }
      return { ok: true, changed: true, status: "PAUSED", pauseReason: requested.pauseReason }
    case "OFFLINE":
      if (context.activeAttendances > 0) return { ok: false, code: "HUMAN_SUPPORT_ACTIVE_ATTENDANCES" }
      return { ok: true, changed: true, status: "OFFLINE", pauseReason: null }
  }
}

export type AnjoSituation = {
  /** O papel de Anjo cobre o escopo do pedido (Grupo/Subgrupo congelado). */
  coversScope: boolean
  /** Conta e pessoa ativas (a consulta de quem tem o papel já filtra). */
  active: boolean
  status: PresenceStatus
  connected: boolean
  activeAttendances: number
  capacity: number
  isOperator: boolean
}

/** Em serviço = papel cobre o escopo ∧ ativo ∧ Disponível ou Em pausa ∧ conectado. */
export const inService = (anjo: AnjoSituation) => anjo.coversScope && anjo.active && anjo.status !== "OFFLINE" && anjo.connected && !anjo.isOperator

/** Pode receber atribuição = em serviço ∧ Disponível ∧ atendimentos em andamento < capacidade ∧ não é o operador. */
export const canReceiveAssignment = (anjo: AnjoSituation) => inService(anjo) && anjo.status === "AVAILABLE" && anjo.activeAttendances < anjo.capacity

/** Por que um Anjo não pode receber atribuição agora (tela do Administrador geral, com filtro de escopo). */
export type NotEligibleReason = "SCOPE_NOT_COVERED" | "OFFLINE" | "NOT_CONNECTED" | "PAUSED" | "NO_CAPACITY"
export function notEligibleReason(anjo: AnjoSituation): NotEligibleReason | null {
  if (!anjo.coversScope) return "SCOPE_NOT_COVERED"
  if (anjo.status === "OFFLINE") return "OFFLINE"
  if (!anjo.connected) return "NOT_CONNECTED"
  if (anjo.status === "PAUSED") return "PAUSED"
  if (anjo.activeAttendances >= anjo.capacity) return "NO_CAPACITY"
  return null
}

/** Capacidade efetiva: a do Anjo, quando definida; senão a padrão da organização. */
export const effectiveCapacity = (own: number | null, organizationDefault: number) => own ?? organizationDefault
