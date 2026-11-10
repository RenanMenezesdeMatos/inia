/**
 * DISPONIBILIDADE mostrada ao operador antes de pedir e na fila (design_draft.md seção 9), pela primeira regra que valer:
 *  1. escopo desligado → DISABLED (botão desabilitado);
 *  2. ninguém em serviço → NONE_IN_SERVICE (botão desabilitado; a prévia registra a tentativa, D4);
 *  3. alguém pode receber atribuição agora → AVAILABLE_NOW;
 *  4. algum Anjo Disponível, sem vaga → ALL_BUSY;
 *  5. senão (todos em pausa) → NONE_AVAILABLE (D3).
 * O operador nunca recebe quantos Anjos estão em pausa, nem por quê: só o status.
 */
export const AVAILABILITY_STATUSES = ["DISABLED", "NONE_IN_SERVICE", "AVAILABLE_NOW", "ALL_BUSY", "NONE_AVAILABLE"] as const
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number]

export type AvailabilityCounts = { enabled: boolean; inService: number; canReceiveNow: number; availableInService: number }

export function availabilityOf(counts: AvailabilityCounts): AvailabilityStatus {
  if (!counts.enabled) return "DISABLED"
  if (counts.inService === 0) return "NONE_IN_SERVICE"
  if (counts.canReceiveNow > 0) return "AVAILABLE_NOW"
  if (counts.availableInService > 0) return "ALL_BUSY"
  return "NONE_AVAILABLE"
}

/** Pedir ajuda só é possível com algum Anjo em serviço (os dois primeiros estados desabilitam o botão). */
export const canRequestWith = (status: AvailabilityStatus) => status !== "DISABLED" && status !== "NONE_IN_SERVICE"
