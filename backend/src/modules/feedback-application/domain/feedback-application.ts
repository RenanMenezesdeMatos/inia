/**
 * APLICAÇÃO DE FEEDBACK — regras puras (sem banco).
 *
 * A INIA apresenta ao colaborador UM feedback já publicado e conversa com ele sobre esse feedback. Cada feedback tem UMA
 * aplicação, ligada ao feedback de origem e ao próprio destinatário:
 *
 *   NOT_STARTED ──iniciar──► IN_PROGRESS ──concluir (ação explícita)──► COMPLETED (somente consulta)
 *                             │   ▲
 *                             └───┘ sair por agora / reduzir / recarregar / outra aba = a MESMA aplicação, retomável
 *
 * Três estados que nunca se misturam: a APLICAÇÃO (acima), a REPRODUÇÃO do áudio da apresentação (fatos: começou,
 * terminou, foi interrompida — nenhum deles conclui nada) e a CIÊNCIA (confirmação formal do colaborador, em outra tabela).
 * Terminar o áudio, fechar a página, trocar de aba, perder conexão, negar microfone ou ficar inativo NÃO concluem.
 *
 * Duas fontes do Acompanhamento com identidades diferentes — nunca se presume que os ids pertencem à mesma entidade.
 */
export const FEEDBACK_SOURCE_KINDS = ["PUBLISHED_FEEDBACK", "INTERACTION_FEEDBACK_DELIVERY"] as const
export type FeedbackSourceKind = (typeof FEEDBACK_SOURCE_KINDS)[number]
export type FeedbackSourceRef = { kind: FeedbackSourceKind; id: string }

export const FEEDBACK_APPLICATION_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"] as const
export type FeedbackApplicationStatus = (typeof FEEDBACK_APPLICATION_STATUSES)[number]

export const PRESENTATION_EVENTS = ["STARTED", "COMPLETED", "INTERRUPTED", "FAILED"] as const
export type PresentationEvent = (typeof PRESENTATION_EVENTS)[number]

export const INVITE_EVENTS = ["OFFER", "ACCEPT", "READ", "SNOOZE"] as const
export type InviteEvent = (typeof INVITE_EVENTS)[number]
export type InviteResolution = "ACCEPTED" | "READ" | "SNOOZED"

/** Chave estável de uma fonte (a mesma no backend e na tela): o tipo faz parte da identidade. */
export const sourceKey = (source: FeedbackSourceRef) => `${source.kind}:${source.id}`

export type ApplicationTransition = { ok: true; changed: boolean; next: FeedbackApplicationStatus } | { ok: false; reason: "COMPLETED" | "NOT_STARTED" }

/** Iniciar: idempotente (em andamento continua; concluída nunca reabre — a tela abre em modo consulta). */
export function startTransition(current: FeedbackApplicationStatus): ApplicationTransition {
  if (current === "NOT_STARTED") return { ok: true, changed: true, next: "IN_PROGRESS" }
  return { ok: true, changed: false, next: current }
}

/** Concluir: só a partir de IN_PROGRESS; repetir é idempotente; não iniciada não conclui (nada a encerrar). */
export function completeTransition(current: FeedbackApplicationStatus): ApplicationTransition {
  if (current === "IN_PROGRESS") return { ok: true, changed: true, next: "COMPLETED" }
  if (current === "COMPLETED") return { ok: true, changed: false, next: "COMPLETED" }
  return { ok: false, reason: "NOT_STARTED" }
}

/** "Sair por agora": registra a pausa e mantém a aplicação em andamento. Concluída não muda. */
export function pauseTransition(current: FeedbackApplicationStatus): ApplicationTransition {
  if (current === "IN_PROGRESS") return { ok: true, changed: true, next: "IN_PROGRESS" }
  if (current === "COMPLETED") return { ok: false, reason: "COMPLETED" }
  return { ok: false, reason: "NOT_STARTED" }
}

/** Eventos do áudio só existem numa aplicação iniciada e NUNCA mudam o estado da aplicação. Concluída não registra mais
 * (o modo consulta não toca apresentação). */
export function presentationEventAccepted(current: FeedbackApplicationStatus): boolean {
  return current === "IN_PROGRESS"
}

export const INVITE_RESOLUTION: Record<Exclude<InviteEvent, "OFFER">, InviteResolution> = { ACCEPT: "ACCEPTED", READ: "READ", SNOOZE: "SNOOZED" }

/**
 * Convite proativo: só para feedback NOVO (publicado/entregue na janela), ainda não aplicado, sem ciência e sem decisão
 * anterior do colaborador sobre o convite. Um por vez (o mais recente). O histórico antigo nunca vira chamado novo.
 */
export const FEEDBACK_INVITE_WINDOW_DAYS = 7

export type InviteCandidate = {
  source: FeedbackSourceRef
  publishedAt: Date
  acknowledged: boolean
  status: FeedbackApplicationStatus
  inviteResolved: boolean
}

export function isInviteEligible(candidate: InviteCandidate, now: Date, windowDays = FEEDBACK_INVITE_WINDOW_DAYS): boolean {
  if (candidate.status !== "NOT_STARTED" || candidate.inviteResolved || candidate.acknowledged) return false
  const age = now.getTime() - candidate.publishedAt.getTime()
  return age >= 0 && age <= windowDays * 24 * 3_600_000
}

export function pickInvite<T extends InviteCandidate>(candidates: readonly T[], now: Date): T | null {
  const eligible = candidates.filter((candidate) => isInviteEligible(candidate, now))
  eligible.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime() || (sourceKey(b.source) < sourceKey(a.source) ? -1 : 1))
  return eligible[0] ?? null
}
