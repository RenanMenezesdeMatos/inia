import { hashPassword } from "../infrastructure/password-hasher.js"
import { LOGIN_FAILURE_WINDOW_MINUTES, loginThrottle } from "../domain/login-throttle.js"
import type { CredentialStore, LoginAccount, LoginAttemptOutcome } from "./credential-store.js"

export type AuthenticateDeps = {
  store: CredentialStore
  verifyPassword: (plain: string, hash: string) => Promise<boolean>
  identifierHash: (login: string) => string
  now: () => Date
}

/** Navegador onde a conta já entrou (cookie assinado conferido pela rota): conta + identificador próprio da trava dele. */
export type KnownDevice = { accountId: string; identifierHash: string }

export type AuthenticateResult =
  | { kind: "SUCCEEDED"; account: LoginAccount }
  | { kind: "INVALID_CREDENTIALS" }
  | { kind: "LOCKED"; retryAt: Date }
  | { kind: "ACCESS_DISABLED" }
  | { kind: "TEMPORARY_PASSWORD_EXPIRED" }

// Hash de uma senha que ninguém conhece: e-mail inexistente custa o mesmo bcrypt que um existente (o tempo da resposta não
// revela quem tem conta). Calculado uma vez, na primeira vez que for preciso.
let dummyHash: Promise<string> | null = null
const unknownAccountHash = () => (dummyHash ??= hashPassword(`inia-no-account-${Math.random()}`))

/**
 * LOGIN — o identificador continua sendo o e-mail da conta. Ordem deliberada:
 *  0. a tentativa é RESERVADA como falha antes de tudo: N tentativas simultâneas do mesmo e-mail se enxergam e no máximo
 *     `LOGIN_MAX_FAILURES` chegam ao bcrypt (a última a contar vê as reservas de todas as outras);
 *  1. trava por identificador (antes de qualquer bcrypt);
 *  2. senha conferida SEMPRE (inclusive para conta inexistente, contra hash fictício);
 *  3. só depois de provar a senha: acesso desabilitado ou senha temporária vencida (revelar isso a quem já sabe a senha não
 *     ajuda um atacante — e evita que a pessoa fique sem entender por que não entra).
 * Falha de credencial conta para a trava; a 5ª já responde "bloqueado". Senha nunca é registrada em lugar nenhum.
 */
export async function authenticate(deps: AuthenticateDeps, input: { login: string; password: string; device?: KnownDevice | null }): Promise<AuthenticateResult> {
  const now = deps.now()
  const since = new Date(now.getTime() - LOGIN_FAILURE_WINDOW_MINUTES * 60_000)
  let identifierHash = deps.identifierHash(input.login)
  let attemptId = await deps.store.reserveAttempt({ identifierHash, at: now })
  const settle = (accountId: string | null, outcome: LoginAttemptOutcome) => deps.store.resolveAttempt({ attemptId, identifierHash, accountId, outcome, at: now })
  let failures = await deps.store.recentFailures(identifierHash, since, attemptId)
  let throttle = loginThrottle(failures, now)
  let account: LoginAccount | null | undefined
  if (throttle.locked) {
    // DISPOSITIVO CONHECIDO (achado AUTH-3 da auditoria de 17/10/2026): a trava do e-mail é provocada por qualquer um que digite
    // senhas erradas; o navegador onde ESTA conta já entrou passa por ela, com um contador de falhas só dele — quem não tem o
    // cookie assinado continua barrado, e o dono não fica de fora da própria conta.
    account = input.device ? await deps.store.findByLogin(input.login) : null
    if (!input.device || !account || account.id !== input.device.accountId) {
      await settle(null, "LOCKED")
      return { kind: "LOCKED", retryAt: throttle.retryAt }
    }
    await settle(account.id, "LOCKED")
    identifierHash = input.device.identifierHash
    attemptId = await deps.store.reserveAttempt({ identifierHash, at: now })
    failures = await deps.store.recentFailures(identifierHash, since, attemptId)
    throttle = loginThrottle(failures, now)
    if (throttle.locked) {
      await settle(account.id, "LOCKED")
      return { kind: "LOCKED", retryAt: throttle.retryAt }
    }
  }

  account ??= await deps.store.findByLogin(input.login)
  let matches: boolean
  try {
    matches = await deps.verifyPassword(input.password, account?.passwordHash ?? (await unknownAccountHash()))
  } catch (error) {
    // Senha NÃO conferida (fila cheia, falha da thread): a reserva não pode ficar contando como falha de quem tentou.
    await settle(account?.id ?? null, "LOCKED")
    throw error
  }
  if (!account || !matches) {
    await settle(account?.id ?? null, "INVALID_CREDENTIALS")
    const after = loginThrottle([...failures, now], now)
    return after.locked ? { kind: "LOCKED", retryAt: after.retryAt } : { kind: "INVALID_CREDENTIALS" }
  }
  if (!account.active) {
    await settle(account.id, "ACCESS_DISABLED")
    return { kind: "ACCESS_DISABLED" }
  }
  if (account.passwordChangeRequired && (!account.temporaryPasswordExpiresAt || account.temporaryPasswordExpiresAt.getTime() <= now.getTime())) {
    await settle(account.id, "TEMPORARY_PASSWORD_EXPIRED")
    return { kind: "TEMPORARY_PASSWORD_EXPIRED" }
  }
  await settle(account.id, "SUCCEEDED")
  await deps.store.markLoggedIn({ accountId: account.id, identifierHash, at: now })
  return { kind: "SUCCEEDED", account }
}
