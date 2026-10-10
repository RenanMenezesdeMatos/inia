/**
 * TRAVA CONTRA TENTATIVAS EXCESSIVAS DE LOGIN — regra pura. Conta as falhas de CREDENCIAL do mesmo identificador (e-mail
 * normalizado) desde o último login bem-sucedido; o identificador existir ou não é indiferente, então a trava não revela quem
 * tem conta. Bloqueada com `LOGIN_MAX_FAILURES` falhas na janela; libera quando a falha que completou o limite sai da janela.
 */
export const LOGIN_MAX_FAILURES = 5
export const LOGIN_FAILURE_WINDOW_MINUTES = 15

export type LoginThrottle = { locked: false } | { locked: true; retryAt: Date }

export function loginThrottle(failures: readonly Date[], now: Date): LoginThrottle {
  const windowMs = LOGIN_FAILURE_WINDOW_MINUTES * 60_000
  const recent = failures.filter((at) => now.getTime() - at.getTime() < windowMs).sort((a, b) => a.getTime() - b.getTime())
  if (recent.length < LOGIN_MAX_FAILURES) return { locked: false }
  return { locked: true, retryAt: new Date(recent[recent.length - LOGIN_MAX_FAILURES]!.getTime() + windowMs) }
}
