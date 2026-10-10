/**
 * CONFIRMAÇÃO DE CIÊNCIA COM LOGIN E SENHA — regras puras (sem banco). Migration 114.
 *
 * Ciência = o PRÓPRIO destinatário confirma, com o login (e-mail corporativo) e a senha da SUA conta, que leu o feedback. É a
 * conclusão ÚNICA do feedback, venha de onde vier: do Acompanhamento ("Confirmar ciência") ou de dentro da sessão com a INIA
 * (antes "Concluir aplicação"). Confirmar grava a ciência na fonte e, se a aplicação estiver em andamento, conclui a aplicação
 * (a conversa dela fica só para consulta; dúvidas depois vão para a conversa complementar). Não encerra caso de supervisão nem
 * marca orientação como cumprida.
 *
 * Cada abertura do elemento de confirmação é uma TENTATIVA (attemptId gerado na tela) e cada fato vira um evento:
 * OPENED → (FAILED…) → CONFIRMED | CANCELLED — matéria-prima da visão de usabilidade. Nunca se grava o login digitado nem a senha.
 */
export const READ_CONFIRMATION_ENTRY_POINTS = ["FOLLOW_UP_FEED", "FEEDBACK_SESSION"] as const
export type ReadConfirmationEntryPoint = (typeof READ_CONFIRMATION_ENTRY_POINTS)[number]

/** Eventos que a TELA informa (abrir/fechar o elemento). FAILED e CONFIRMED só o backend grava, ao conferir as credenciais. */
export const READ_CONFIRMATION_CLIENT_EVENTS = ["OPENED", "CANCELLED"] as const
export type ReadConfirmationClientEvent = (typeof READ_CONFIRMATION_CLIENT_EVENTS)[number]
export type ReadConfirmationEvent = ReadConfirmationClientEvent | "FAILED" | "CONFIRMED"

export type ReadConfirmationFailure = "WRONG_LOGIN" | "WRONG_PASSWORD" | "TOO_MANY_ATTEMPTS"

export const READ_CONFIRMATION_DEVICES = ["DESKTOP", "MOBILE"] as const
export type ReadConfirmationDevice = (typeof READ_CONFIRMATION_DEVICES)[number]

/** Trava contra tentativa e erro: a sessão já está aberta, então sem trava o elemento viraria um oráculo de senha. */
export const READ_CONFIRMATION_MAX_FAILURES = 5
export const READ_CONFIRMATION_FAILURE_WINDOW_MINUTES = 15

export type ReadConfirmationThrottle = { blocked: false; remaining: number } | { blocked: true; retryAt: Date }

/**
 * Situação da trava a partir das falhas de CREDENCIAL da própria conta (nunca as recusas por trava, senão ela nunca soltaria).
 * Bloqueada com `MAX` falhas na janela; libera quando a falha que completou o limite sai da janela. `remaining` = tentativas
 * que ainda cabem antes de travar.
 */
export function readConfirmationThrottle(failures: readonly Date[], now: Date): ReadConfirmationThrottle {
  const windowMs = READ_CONFIRMATION_FAILURE_WINDOW_MINUTES * 60_000
  const recent = failures.filter((at) => now.getTime() - at.getTime() < windowMs).sort((a, b) => a.getTime() - b.getTime())
  if (recent.length < READ_CONFIRMATION_MAX_FAILURES) return { blocked: false, remaining: READ_CONFIRMATION_MAX_FAILURES - recent.length }
  return { blocked: true, retryAt: new Date(recent[recent.length - READ_CONFIRMATION_MAX_FAILURES]!.getTime() + windowMs) }
}

/** O login digitado é o e-mail da PRÓPRIA conta (sem diferenciar maiúsculas e espaços nas pontas). */
export function loginMatchesAccount(typed: string, accountEmail: string): boolean {
  return typed.trim().toLowerCase() === accountEmail.trim().toLowerCase()
}

/** Motivo da falha de credencial (login errado tem precedência: a senha nem é de quem foi digitado). */
export function credentialFailureOf(input: { loginMatches: boolean; passwordMatches: boolean; accountActive: boolean }): Exclude<ReadConfirmationFailure, "TOO_MANY_ATTEMPTS"> | null {
  if (!input.accountActive || !input.loginMatches) return "WRONG_LOGIN"
  if (!input.passwordMatches) return "WRONG_PASSWORD"
  return null
}
