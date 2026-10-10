import { hashPassword } from "../infrastructure/password-hasher.js"
import { LOGIN_FAILURE_WINDOW_MINUTES, loginThrottle } from "../domain/login-throttle.js"
import type { CredentialStore, LoginAccount } from "./credential-store.js"

export type AuthenticateDeps = {
  store: CredentialStore
  verifyPassword: (plain: string, hash: string) => Promise<boolean>
  identifierHash: (login: string) => string
  now: () => Date
}

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
 *  1. trava por identificador (antes de qualquer bcrypt);
 *  2. senha conferida SEMPRE (inclusive para conta inexistente, contra hash fictício);
 *  3. só depois de provar a senha: acesso desabilitado ou senha temporária vencida (revelar isso a quem já sabe a senha não
 *     ajuda um atacante — e evita que a pessoa fique sem entender por que não entra).
 * Falha de credencial conta para a trava; a 5ª já responde "bloqueado". Senha nunca é registrada em lugar nenhum.
 */
export async function authenticate(deps: AuthenticateDeps, input: { login: string; password: string }): Promise<AuthenticateResult> {
  const now = deps.now()
  const identifierHash = deps.identifierHash(input.login)
  const failures = await deps.store.recentFailures(identifierHash, new Date(now.getTime() - LOGIN_FAILURE_WINDOW_MINUTES * 60_000))
  const throttle = loginThrottle(failures, now)
  if (throttle.locked) {
    await deps.store.recordAttempt({ identifierHash, accountId: null, outcome: "LOCKED", at: now })
    return { kind: "LOCKED", retryAt: throttle.retryAt }
  }

  const account = await deps.store.findByLogin(input.login)
  const matches = await deps.verifyPassword(input.password, account?.passwordHash ?? (await unknownAccountHash()))
  if (!account || !matches) {
    await deps.store.recordAttempt({ identifierHash, accountId: account?.id ?? null, outcome: "INVALID_CREDENTIALS", at: now })
    const after = loginThrottle([...failures, now], now)
    return after.locked ? { kind: "LOCKED", retryAt: after.retryAt } : { kind: "INVALID_CREDENTIALS" }
  }
  if (!account.active) {
    await deps.store.recordAttempt({ identifierHash, accountId: account.id, outcome: "ACCESS_DISABLED", at: now })
    return { kind: "ACCESS_DISABLED" }
  }
  if (account.passwordChangeRequired && (!account.temporaryPasswordExpiresAt || account.temporaryPasswordExpiresAt.getTime() <= now.getTime())) {
    await deps.store.recordAttempt({ identifierHash, accountId: account.id, outcome: "TEMPORARY_PASSWORD_EXPIRED", at: now })
    return { kind: "TEMPORARY_PASSWORD_EXPIRED" }
  }
  await deps.store.recordAttempt({ identifierHash, accountId: account.id, outcome: "SUCCEEDED", at: now })
  await deps.store.markLoggedIn({ accountId: account.id, identifierHash, at: now })
  return { kind: "SUCCEEDED", account }
}
