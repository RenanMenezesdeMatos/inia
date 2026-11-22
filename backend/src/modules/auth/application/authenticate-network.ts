import { NETWORK_LOGIN_LOOKBACK_HOURS, NETWORK_LOGIN_LOOKBACK_LIMIT, NETWORK_LOGIN_MAX_FAILURES, networkLoginThrottle, normalizeNetworkLogin, type DirectoryVerdict } from "../domain/network-login.js"
import type { KnownDevice } from "./authenticate.js"
import type { CredentialStore, LoginAccount } from "./credential-store.js"
import type { DirectoryAuthenticator } from "./directory-authenticator.js"

export type NetworkAuthenticateDeps = {
  store: CredentialStore
  directory: DirectoryAuthenticator
  identifierHash: (login: string) => string
  now: () => Date
  /** Hash de uma senha que ninguém conhece — aposenta a senha temporária de quem entra pela rede. */
  retiredPasswordHash: () => Promise<string>
  /**
   * Tempo mínimo da resposta (relógio real): matrícula sem conta na INIA não chega ao AD, e sem este piso a resposta mais rápida
   * revelaria quem tem conta. Testes passam 0.
   */
  minimumDurationMs?: number
  sleep?: (ms: number) => Promise<void>
}

export type NetworkAuthenticateResult =
  | { kind: "SUCCEEDED"; account: LoginAccount }
  | { kind: "INVALID_CREDENTIALS" }
  | { kind: "LOCKED"; retryAt: Date }
  | { kind: "ACCESS_DISABLED" }
  | { kind: "NETWORK_PASSWORD_EXPIRED" }
  | { kind: "NETWORK_ACCOUNT_LOCKED" }
  | { kind: "NETWORK_ACCOUNT_DISABLED" }
  | { kind: "NETWORK_UNAVAILABLE" }

/** Identificador da trava do login pela rede (separado do e-mail; o mesmo da confirmação de ciência pela rede). */
export const networkIdentifier = (normalized: string) => `matricula:${normalized}`

const DEFAULT_MINIMUM_MS = 900
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Confere a senha de rede pelo PORTÃO ÚNICO da matrícula — usado pelo login e pela confirmação de ciência, para que os dois
 * somem as mesmas falhas e nunca passem de `NETWORK_LOGIN_MAX_FAILURES` (abaixo do bloqueio da conta de rede). A tentativa é
 * RESERVADA antes, como no login por e-mail (N tentativas simultâneas se enxergam). Sem `allowAd` (matrícula sem conta na INIA),
 * a tentativa conta como falha e o AD não é chamado.
 *
 * A trava segue o contador do AD (`networkLoginThrottle`): lê as falhas das últimas 24 h (com LIMIT) e trava pela CADEIA de
 * falhas a até 15 minutos umas das outras — nunca pela janela deslizante do login por e-mail. Vale também para o contador do
 * dispositivo conhecido.
 */
export async function verifyNetworkPasswordThroughGate(
  deps: Pick<NetworkAuthenticateDeps, "store" | "directory" | "identifierHash" | "now">,
  input: { normalized: string; password: string; allowAd: boolean; accountId: string | null; device?: KnownDevice | null; deviceAccountId?: string | null },
): Promise<{ verdict: DirectoryVerdict | { kind: "LOCKED"; retryAt: Date }; identifierHash: string; settle: (outcome: "SUCCEEDED" | "ACCESS_DISABLED") => Promise<void> }> {
  const now = deps.now()
  const since = new Date(now.getTime() - NETWORK_LOGIN_LOOKBACK_HOURS * 3_600_000)
  const failuresOf = (hash: string, exclude: string | null) => deps.store.recentFailures(hash, since, exclude, { limit: NETWORK_LOGIN_LOOKBACK_LIMIT })
  let identifierHash = deps.identifierHash(networkIdentifier(input.normalized))
  let attemptId = await deps.store.reserveAttempt({ identifierHash, at: now })
  let failures = await failuresOf(identifierHash, attemptId)
  let throttle = networkLoginThrottle(failures, now, NETWORK_LOGIN_MAX_FAILURES)
  const settleWith = (outcome: "SUCCEEDED" | "INVALID_CREDENTIALS" | "ACCESS_DISABLED" | "LOCKED") => deps.store.resolveAttempt({ attemptId, identifierHash, accountId: input.accountId, outcome, at: now })
  const noop = { settle: async () => undefined }
  if (throttle.locked) {
    // Navegador onde ESTA conta já entrou passa pela trava da matrícula com um contador só dele, também de no máximo
    // NETWORK_LOGIN_MAX_FAILURES — pior caso somado (trava + dispositivo) continua abaixo do bloqueio do AD.
    if (!input.device || !input.deviceAccountId || input.device.accountId !== input.deviceAccountId) {
      await settleWith("LOCKED")
      return { verdict: { kind: "LOCKED", retryAt: throttle.retryAt }, identifierHash, ...noop }
    }
    await settleWith("LOCKED")
    identifierHash = input.device.identifierHash
    attemptId = await deps.store.reserveAttempt({ identifierHash, at: now })
    failures = await failuresOf(identifierHash, attemptId)
    throttle = networkLoginThrottle(failures, now, NETWORK_LOGIN_MAX_FAILURES)
    if (throttle.locked) {
      await settleWith("LOCKED")
      return { verdict: { kind: "LOCKED", retryAt: throttle.retryAt }, identifierHash, ...noop }
    }
  }
  if (!input.allowAd) {
    await settleWith("INVALID_CREDENTIALS")
    const after = networkLoginThrottle([...failures, now], now, NETWORK_LOGIN_MAX_FAILURES)
    return { verdict: after.locked ? { kind: "LOCKED", retryAt: after.retryAt } : { kind: "INVALID" }, identifierHash, ...noop }
  }
  let verdict: DirectoryVerdict
  try {
    verdict = await deps.directory.verify(input.normalized, input.password)
  } catch (error) {
    // Erro inesperado do adaptador: não dá para saber se a senha chegou ao AD — conta como se tivesse chegado.
    verdict = { kind: "UNAVAILABLE", reason: error instanceof Error ? error.message : String(error), passwordSent: true }
  }
  switch (verdict.kind) {
    case "OK":
      return { verdict, identifierHash, settle: (outcome) => settleWith(outcome) }
    case "INVALID":
    case "ACCOUNT_LOCKED": {
      // Senha recusada (ou conta já bloqueada na rede): conta para a trava — insistir só pioraria o bloqueio.
      await settleWith("INVALID_CREDENTIALS")
      const after = networkLoginThrottle([...failures, now], now, NETWORK_LOGIN_MAX_FAILURES)
      return { verdict: verdict.kind === "INVALID" && after.locked ? { kind: "LOCKED", retryAt: after.retryAt } : verdict, identifierHash, ...noop }
    }
    case "PASSWORD_EXPIRED":
    case "ACCOUNT_DISABLED":
      // A senha estava certa; o problema é da conta de rede. Não conta como falha.
      await settleWith("ACCESS_DISABLED")
      return { verdict, identifierHash, ...noop }
    case "UNAVAILABLE": {
      if (!verdict.passwordSent) {
        // A senha nem chegou ao AD (servidores fora do ar): a reserva não conta como falha de quem tentou.
        await settleWith("LOCKED")
        return { verdict, identifierHash, ...noop }
      }
      // A senha chegou e a resposta não veio: o AD pode ter contado uma senha errada. Conta na trava (na dúvida, a favor da conta
      // de rede) — senão, com o AD lento, as tentativas passariam sem limite pela INIA e somariam no contador do AD.
      await settleWith("INVALID_CREDENTIALS")
      const after = networkLoginThrottle([...failures, now], now, NETWORK_LOGIN_MAX_FAILURES)
      return { verdict: after.locked ? { kind: "LOCKED", retryAt: after.retryAt } : verdict, identifierHash, ...noop }
    }
  }
}

/**
 * LOGIN PELA REDE — matrícula + senha de rede conferidas no AD (domain/network-login.ts). Ordem:
 *  1. matrícula normalizada (fora do formato = senha recusada, sem AD);
 *  2. portão da matrícula: trava de 3 falhas ANTES de qualquer chamada ao AD;
 *  3. a matrícula precisa achar UMA conta numa organização com o login pela rede ligado — senão o AD nem é chamado;
 *  4. AD confere a senha; recusa nunca tenta outro servidor;
 *  5. só depois: conta habilitada na INIA e pessoa ativa.
 * Senha nunca é registrada em lugar nenhum.
 */
export async function authenticateNetwork(deps: NetworkAuthenticateDeps, input: { login: string; password: string; device?: KnownDevice | null }): Promise<NetworkAuthenticateResult> {
  const startedAt = Date.now()
  try {
    return await authenticateNetworkUnpadded(deps, input)
  } finally {
    const remaining = (deps.minimumDurationMs ?? DEFAULT_MINIMUM_MS) - (Date.now() - startedAt)
    if (remaining > 0) await (deps.sleep ?? realSleep)(remaining)
  }
}

async function authenticateNetworkUnpadded(deps: NetworkAuthenticateDeps, input: { login: string; password: string; device?: KnownDevice | null }): Promise<NetworkAuthenticateResult> {
  const normalized = normalizeNetworkLogin(input.login)
  if (!normalized) {
    // Fora do formato: conta na trava do texto digitado (normalizado o possível), sem AD.
    const gate = await verifyNetworkPasswordThroughGate(deps, { normalized: input.login.trim().toUpperCase().slice(0, 64), password: "", allowAd: false, accountId: null })
    return gate.verdict.kind === "LOCKED" ? { kind: "LOCKED", retryAt: gate.verdict.retryAt } : { kind: "INVALID_CREDENTIALS" }
  }
  if (!deps.directory.configured) return { kind: "NETWORK_UNAVAILABLE" }
  const account = await deps.store.findByNetworkLogin(normalized)
  const gate = await verifyNetworkPasswordThroughGate(deps, { normalized, password: input.password, allowAd: account !== null, accountId: account?.id ?? null, device: input.device ?? null, deviceAccountId: account?.id ?? null })
  switch (gate.verdict.kind) {
    case "LOCKED":
      return { kind: "LOCKED", retryAt: gate.verdict.retryAt }
    case "INVALID":
      return { kind: "INVALID_CREDENTIALS" }
    case "ACCOUNT_LOCKED":
      return { kind: "NETWORK_ACCOUNT_LOCKED" }
    case "PASSWORD_EXPIRED":
      return { kind: "NETWORK_PASSWORD_EXPIRED" }
    case "ACCOUNT_DISABLED":
      return { kind: "NETWORK_ACCOUNT_DISABLED" }
    case "UNAVAILABLE":
      return { kind: "NETWORK_UNAVAILABLE" }
    case "OK":
      break
  }
  if (!account || !account.active) {
    await gate.settle("ACCESS_DISABLED")
    return { kind: "ACCESS_DISABLED" }
  }
  const now = deps.now()
  await gate.settle("SUCCEEDED")
  await deps.store.completeNetworkLogin({ accountId: account.id, identifierHash: gate.identifierHash, at: now, retiredPasswordHash: await deps.retiredPasswordHash() })
  return { kind: "SUCCEEDED", account: account.emergencyLocalAccess ? account : { ...account, passwordChangeRequired: false, temporaryPasswordExpiresAt: null } }
}

/** Resultado da conferência da senha de rede fora do login (ciência): só o veredito, nunca a senha. */
export type NetworkPasswordCheck = "OK" | "INVALID" | "LOCKED" | "ACCOUNT_LOCKED" | "PASSWORD_EXPIRED" | "ACCOUNT_DISABLED" | "UNAVAILABLE"

/**
 * Verificador da senha de rede para quem não é o login (a confirmação de ciência): o MESMO portão da matrícula, então as falhas
 * dos dois somam. Só deve ser chamado com a matrícula da PRÓPRIA pessoa, já normalizada, e FORA de qualquer transação (chama o
 * AD; o portão grava em autocommit e já é à prova de tentativas simultâneas pela reserva).
 */
export function createNetworkPasswordVerifier(deps: Pick<NetworkAuthenticateDeps, "store" | "directory" | "identifierHash" | "now">) {
  return async (input: { normalized: string; password: string; accountId: string }): Promise<NetworkPasswordCheck> => {
    if (!deps.directory.configured) return "UNAVAILABLE"
    const gate = await verifyNetworkPasswordThroughGate(deps, { normalized: input.normalized, password: input.password, allowAd: true, accountId: input.accountId })
    if (gate.verdict.kind === "OK") await gate.settle("SUCCEEDED")
    return gate.verdict.kind
  }
}
