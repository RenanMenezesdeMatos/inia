import type { PauseReason, PresenceStatus } from "./catalogs.js"

/**
 * PRESENÇA DO ANJO (design_draft.md seção 6). O estado DECLARADO (Disponível, Em pausa, Indisponível) é do Anjo; a CONEXÃO é
 * calculada: conectado = `lease_until` no futuro (renovado só pela chamada de estado da área do Anjo, nunca por POST).
 */
export const isConnected = (leaseUntil: Date | null, now: Date) => leaseUntil !== null && leaseUntil.getTime() > now.getTime()

export type PresenceRequest = { status: "AVAILABLE" } | { status: "PAUSED"; pauseReason: PauseReason } | { status: "OFFLINE" }
/** Mudança programada (migration 188): só pausa com motivo ou Indisponível; entra ao terminar o último atendimento em andamento. */
export type ScheduledPresence = { status: "PAUSED"; pauseReason: PauseReason } | { status: "OFFLINE"; pauseReason: null }
export type PresenceChangeContext = { connected: boolean; hasEnabledScope: boolean; activeAttendances: number }
export type PresenceChangeRefusal = "HUMAN_SUPPORT_NOT_CONNECTED" | "HUMAN_SUPPORT_NO_ENABLED_SCOPE" | "HUMAN_SUPPORT_PRESENCE_INVALID"
export type PresenceCurrent = { status: PresenceStatus; pauseReason: PauseReason | null; scheduled: ScheduledPresence | null }
/**
 *  - `NONE`: nada muda;
 *  - `APPLY`: o estado muda agora (e qualquer programação some);
 *  - `SCHEDULE`: o estado atual fica; grava (ou troca) a programação;
 *  - `CANCEL_SCHEDULE`: o estado atual fica; a programação some.
 */
export type PresenceChange =
  | { ok: true; kind: "NONE" }
  | { ok: true; kind: "APPLY"; status: PresenceStatus; pauseReason: PauseReason | null }
  | { ok: true; kind: "SCHEDULE"; scheduled: ScheduledPresence }
  | { ok: true; kind: "CANCEL_SCHEDULE" }
  | { ok: false; code: PresenceChangeRefusal }

const sameState = (a: { status: PresenceStatus; pauseReason: PauseReason | null }, b: { status: PresenceStatus; pauseReason: PauseReason | null }) => a.status === b.status && a.pauseReason === b.pauseReason

/**
 * Transições declaradas pelo Anjo:
 *  - Indisponível → Disponível: exige a área aberta (conectado) e o papel cobrindo algum escopo ligado; Indisponível → pausa: recusado;
 *  - Em pausa → Disponível ("Voltar") e Em pausa → outro motivo: na hora (em pausa ele já não recebe chamados);
 *  - Disponível → pausa e Disponível/Em pausa → Indisponível: na hora SEM atendimento em andamento; COM atendimento, viram
 *    programação (o estado atual fica até terminar o último);
 *  - pedir o estado em que já está desfaz a programação (se houver); pedir o que já está programado não muda nada;
 *  - qualquer mudança aplicada na hora apaga a programação.
 * As transições do SISTEMA (sem conexão além da carência, papel revogado, aplicação da programação) não passam por aqui.
 */
export function presenceChange(current: PresenceCurrent, requested: PresenceRequest, context: PresenceChangeContext): PresenceChange {
  const wanted = { status: requested.status, pauseReason: requested.status === "PAUSED" ? requested.pauseReason : null }
  if (sameState(current, wanted)) return current.scheduled ? { ok: true, kind: "CANCEL_SCHEDULE" } : { ok: true, kind: "NONE" }
  if (current.scheduled && sameState(current.scheduled, wanted)) return { ok: true, kind: "NONE" }
  switch (requested.status) {
    case "AVAILABLE":
      if (current.status === "OFFLINE") {
        if (!context.connected) return { ok: false, code: "HUMAN_SUPPORT_NOT_CONNECTED" }
        if (!context.hasEnabledScope) return { ok: false, code: "HUMAN_SUPPORT_NO_ENABLED_SCOPE" }
      }
      return { ok: true, kind: "APPLY", status: "AVAILABLE", pauseReason: null }
    case "PAUSED":
      if (current.status === "OFFLINE") return { ok: false, code: "HUMAN_SUPPORT_PRESENCE_INVALID" }
      if (current.status === "AVAILABLE" && context.activeAttendances > 0) return { ok: true, kind: "SCHEDULE", scheduled: { status: "PAUSED", pauseReason: requested.pauseReason } }
      return { ok: true, kind: "APPLY", status: "PAUSED", pauseReason: requested.pauseReason }
    case "OFFLINE":
      if (context.activeAttendances > 0) return { ok: true, kind: "SCHEDULE", scheduled: { status: "OFFLINE", pauseReason: null } }
      return { ok: true, kind: "APPLY", status: "OFFLINE", pauseReason: null }
  }
}

/** A programação entra quando não sobra atendimento em andamento (chamado ao terminar cada atendimento). */
export const scheduledToApply = (scheduled: ScheduledPresence | null, activeAttendances: number): ScheduledPresence | null => (scheduled && activeAttendances === 0 ? scheduled : null)

/** Linha do banco → programação (colunas da migration 188). */
export function scheduledFromRow(row: { scheduled_status: string | null; scheduled_pause_reason: string | null }): ScheduledPresence | null {
  if (row.scheduled_status === "OFFLINE") return { status: "OFFLINE", pauseReason: null }
  if (row.scheduled_status === "PAUSED" && row.scheduled_pause_reason) return { status: "PAUSED", pauseReason: row.scheduled_pause_reason as PauseReason }
  return null
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
  /** Tem pausa ou indisponibilidade programada: continua os atendimentos, mas não recebe novos. */
  scheduledChange: boolean
}

/** Em serviço = papel cobre o escopo ∧ ativo ∧ Disponível ou Em pausa ∧ conectado. */
export const inService = (anjo: AnjoSituation) => anjo.coversScope && anjo.active && anjo.status !== "OFFLINE" && anjo.connected && !anjo.isOperator

/** Pode receber atribuição = em serviço ∧ Disponível ∧ sem mudança programada ∧ atendimentos em andamento < capacidade ∧ não é o operador. */
export const canReceiveAssignment = (anjo: AnjoSituation) => inService(anjo) && anjo.status === "AVAILABLE" && !anjo.scheduledChange && anjo.activeAttendances < anjo.capacity

/** Por que um Anjo não pode receber atribuição agora (tela do Administrador geral, com filtro de escopo). */
export type NotEligibleReason = "SCOPE_NOT_COVERED" | "OFFLINE" | "NOT_CONNECTED" | "PAUSED" | "SCHEDULED_CHANGE" | "NO_CAPACITY"
export function notEligibleReason(anjo: AnjoSituation): NotEligibleReason | null {
  if (!anjo.coversScope) return "SCOPE_NOT_COVERED"
  if (anjo.status === "OFFLINE") return "OFFLINE"
  if (!anjo.connected) return "NOT_CONNECTED"
  if (anjo.status === "PAUSED") return "PAUSED"
  if (anjo.scheduledChange) return "SCHEDULED_CHANGE"
  if (anjo.activeAttendances >= anjo.capacity) return "NO_CAPACITY"
  return null
}

/** Capacidade efetiva: a do Anjo, quando definida; senão a padrão da organização. */
export const effectiveCapacity = (own: number | null, organizationDefault: number) => own ?? organizationDefault
