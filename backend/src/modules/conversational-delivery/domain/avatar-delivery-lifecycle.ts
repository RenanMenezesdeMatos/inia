/**
 * CICLO DE VIDA DA ENTREGA DE VOZ (Workflow Output → AVATAR), regras puras.
 *
 *   PENDING      entrega criada pelo nó Output (nada foi mostrado ainda)
 *   OFFERED      o convite "Tenho um recado para você" apareceu na tela do destinatário
 *   ACCEPTED     a pessoa clicou em "Ouvir agora" — autorização para FALAR; ainda não é entrega
 *   PLAYING      a fala começou de fato (o navegador confirmou o início do áudio)
 *   DELIVERED    a fala terminou — o ÚNICO estado que significa "o recado foi entregue"
 *   SNOOZED      "Depois": a entrega continua disponível, sem áudio
 *   FAILED       a fala não pôde começar/terminar (sem voz no navegador, erro de áudio) — pode tentar de novo
 *   INTERRUPTED  a pessoa parou a fala no meio — nunca conta como ouvida; pode ouvir de novo
 *
 * Nenhuma transição produz áudio: o áudio só existe no navegador, disparado pelo clique. O servidor registra o que
 * aconteceu e recusa o que não faz sentido (ex.: "terminou de tocar" sem ter começado).
 */
export const AVATAR_DELIVERY_STATUSES = ["PENDING", "OFFERED", "ACCEPTED", "PLAYING", "DELIVERED", "SNOOZED", "FAILED", "INTERRUPTED"] as const
export type AvatarDeliveryStatus = (typeof AVATAR_DELIVERY_STATUSES)[number]

export const AVATAR_DELIVERY_EVENTS = ["OFFER", "ACCEPT", "PLAYBACK_STARTED", "PLAYBACK_COMPLETED", "PLAYBACK_FAILED", "PLAYBACK_INTERRUPTED", "SNOOZE"] as const
export type AvatarDeliveryEvent = (typeof AVATAR_DELIVERY_EVENTS)[number]

export type AvatarTransition =
  /** `changed = false`: repetição idempotente (mesmo evento de novo) — nada a gravar. */
  | { ok: true; next: AvatarDeliveryStatus; changed: boolean }
  | { ok: false; reason: "ALREADY_DELIVERED" | "NOT_ACCEPTED" | "NOT_PLAYING" | "INVALID_TRANSITION" }

export function transitionAvatarDelivery(current: AvatarDeliveryStatus, event: AvatarDeliveryEvent): AvatarTransition {
  const to = (next: AvatarDeliveryStatus): AvatarTransition => ({ ok: true, next, changed: next !== current })
  switch (event) {
    case "OFFER":
      // Mostrar o convite de novo nunca rebaixa um estado mais avançado (adiado continua adiado; falha continua falha).
      return current === "PENDING" ? to("OFFERED") : { ok: true, next: current, changed: false }
    case "ACCEPT":
      if (current === "DELIVERED") return { ok: false, reason: "ALREADY_DELIVERED" }
      // Aceitar de novo (recarregou no meio da fala, tentativa após falha/interrupção/adiamento) é permitido.
      return to("ACCEPTED")
    case "PLAYBACK_STARTED":
      if (current === "ACCEPTED" || current === "PLAYING") return to("PLAYING")
      if (current === "DELIVERED") return { ok: false, reason: "ALREADY_DELIVERED" }
      return { ok: false, reason: "NOT_ACCEPTED" }
    case "PLAYBACK_COMPLETED":
      if (current === "PLAYING" || current === "DELIVERED") return to("DELIVERED")
      return { ok: false, reason: "NOT_PLAYING" }
    case "PLAYBACK_FAILED":
      if (current === "ACCEPTED" || current === "PLAYING" || current === "FAILED") return to("FAILED")
      if (current === "DELIVERED") return { ok: false, reason: "ALREADY_DELIVERED" }
      return { ok: false, reason: "NOT_ACCEPTED" }
    case "PLAYBACK_INTERRUPTED":
      if (current === "ACCEPTED" || current === "PLAYING" || current === "INTERRUPTED") return to("INTERRUPTED")
      if (current === "DELIVERED") return { ok: false, reason: "ALREADY_DELIVERED" }
      return { ok: false, reason: "NOT_ACCEPTED" }
    case "SNOOZE":
      if (current === "PENDING" || current === "OFFERED" || current === "FAILED" || current === "INTERRUPTED" || current === "SNOOZED") return to("SNOOZED")
      if (current === "DELIVERED") return { ok: false, reason: "ALREADY_DELIVERED" }
      return { ok: false, reason: "INVALID_TRANSITION" }
  }
}

/** Ação de auditoria (audit_logs.action) de cada evento — nunca com o conteúdo do recado. */
export const AVATAR_AUDIT_ACTIONS: Record<AvatarDeliveryEvent, string> = {
  OFFER: "WORKFLOW_AVATAR_DELIVERY_OFFERED",
  ACCEPT: "WORKFLOW_AVATAR_DELIVERY_ACCEPTED",
  PLAYBACK_STARTED: "WORKFLOW_AVATAR_DELIVERY_PLAY_STARTED",
  PLAYBACK_COMPLETED: "WORKFLOW_AVATAR_DELIVERY_DELIVERED",
  PLAYBACK_FAILED: "WORKFLOW_AVATAR_DELIVERY_FAILED",
  PLAYBACK_INTERRUPTED: "WORKFLOW_AVATAR_DELIVERY_INTERRUPTED",
  SNOOZE: "WORKFLOW_AVATAR_DELIVERY_SNOOZED",
}

/** Motivo técnico de falha informado pelo navegador: código curto, sem texto livre (nada de conteúdo em log). */
export const AVATAR_FAILURE_REASONS = ["SPEECH_UNAVAILABLE", "SPEECH_ERROR", "AUDIO_BLOCKED", "NO_VOICE", "UNKNOWN"] as const
export type AvatarFailureReason = (typeof AVATAR_FAILURE_REASONS)[number]
