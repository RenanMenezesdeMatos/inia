import { directoryLimits, NETWORK_LOGIN_LOOKBACK_HOURS, NETWORK_LOGIN_LOOKBACK_LIMIT, networkLoginThrottle, type DirectoryLimit, type DirectoryVerdict } from "../domain/network-login.js"
import type { CredentialStore, LoginAttemptOutcome } from "./credential-store.js"
import type { DirectoryAuthenticator, IdentityCheck } from "./directory-authenticator.js"

export type DirectoryGateDeps = { store: CredentialStore; directory: DirectoryAuthenticator; identifierHash: (login: string) => string; now: () => Date }
/** `reached`: alguma senha já tinha ido ao AD neste envio (o login inteiro) quando o teto barrou a segunda conferência. */
export type GuardedVerdict = DirectoryVerdict | { kind: "THROTTLED"; retryAt: Date; reached: boolean }

/** Contador de UMA conta do AD (separado da trava da matrícula digitada e da do navegador). */
export const directoryAccountIdentifier = (login: string) => `ad:${login}`

/** `ACCESS_DISABLED` = chegou ao AD e não é senha errada (não conta); `LOCKED` = não saiu da INIA. Aceita NUNCA é `SUCCEEDED` aqui: ver abaixo. */
const OUTCOMES: Record<DirectoryVerdict["kind"], LoginAttemptOutcome> = { OK: "ACCESS_DISABLED", INVALID: "INVALID_CREDENTIALS", ACCOUNT_LOCKED: "INVALID_CREDENTIALS", PASSWORD_EXPIRED: "ACCESS_DISABLED", ACCOUNT_DISABLED: "ACCESS_DISABLED", UNAVAILABLE: "INVALID_CREDENTIALS" }

/**
 * ÚNICO caminho até o AD: toda senha passa pelo teto da conta de destino, reservado ANTES de enviar (envios simultâneos se enxergam).
 * Sem conseguir gravar a reserva, nada é enviado. Uma senha certa NÃO zera este contador: no AD ela zera o do servidor que atendeu, e o
 * bloqueio é decidido por outro (PDC) — assim o teto vale mesmo alternando erros e acertos. Só 16 minutos sem erro zeram.
 *  - `limits`: os da conta de destino (`directoryLimits`, os mesmos que a tela de Acessos mostra);
 *  - a falha passa a valer de quando a resposta chegou: o AD só viu a senha depois da reserva.
 */
async function verifyWithinCap(deps: DirectoryGateDeps, input: { login: string; password: string; limits: readonly DirectoryLimit[]; accountId: string | null; identity?: IdentityCheck }): Promise<GuardedVerdict> {
  const at = deps.now()
  const hashOf = (login: string) => deps.identifierHash(directoryAccountIdentifier(login))
  const identifierHash = hashOf(input.login)
  const attemptId = await deps.store.reserveAttempt({ identifierHash, at })
  const settle = (outcome: LoginAttemptOutcome) => deps.store.resolveAttempt({ attemptId, identifierHash, accountId: input.accountId, outcome, at, redatedTo: outcome === "INVALID_CREDENTIALS" ? deps.now() : null })
  const since = new Date(at.getTime() - NETWORK_LOGIN_LOOKBACK_HOURS * 3_600_000)
  const failures = new Map<string, Date[]>()
  for (const login of new Set(input.limits.flatMap((limit) => limit.logins))) {
    failures.set(login, await deps.store.recentFailures(hashOf(login), since, login === input.login ? attemptId : null, { limit: NETWORK_LOGIN_LOOKBACK_LIMIT }))
  }
  const locks = input.limits.flatMap((limit) => {
    const throttle = networkLoginThrottle(limit.logins.flatMap((login) => failures.get(login)!), at, limit.max)
    return throttle.locked ? [throttle.retryAt.getTime()] : []
  })
  if (locks.length > 0) {
    await settle("LOCKED")
    return { kind: "THROTTLED", retryAt: new Date(Math.max(...locks)), reached: false }
  }
  let verdict: DirectoryVerdict
  try {
    verdict = await deps.directory.verify(input.login, input.password, input.identity)
  } catch (error) {
    // Erro inesperado do adaptador: não dá para saber se a senha chegou ao AD — conta como se tivesse chegado.
    verdict = { kind: "UNAVAILABLE", reason: error instanceof Error ? error.message : String(error), passwordSent: true }
  }
  // Senha que nem saiu, ou aceita com a ID de outra matrícula/ilegível: o AD não contou erro.
  if (verdict.kind === "UNAVAILABLE" && !verdict.passwordSent) await settle("LOCKED")
  else if (verdict.kind === "INVALID" && verdict.identityMismatch) await settle("ACCESS_DISABLED")
  else await settle(OUTCOMES[verdict.kind])
  return verdict
}

/**
 * CONFERE A SENHA COMO O LOGIN DIGITADO PEDE. Formato comum: só o login inteiro. Formato da instalação (login do AD talvez sem o último
 * dígito):
 *  - conta que já entrou: SÓ o login por que ela entrou (memorizado) — o outro pode ser de outra pessoa e nunca mais recebe senha;
 *  - primeira vez: o inteiro e, só se o AD o RECUSAR, o sem o último dígito. Bloqueada, vencida, desativada ou sem resposta para ali.
 * IDENTIDADE (nunca só a senha): o login sem o último dígito exige a ID funcional da matrícula digitada; o inteiro deste formato recusa ID
 * de outra matrícula e conta que não dá para provar; e um login que pode ser o CORTADO de outra pessoa do cadastro recusa se a ID for a
 * dela. É UMA tentativa para a trava da matrícula.
 * O inteiro com a ID ilegível entra como antes E fica memorizado, de propósito: sem memória, toda senha errada dessa pessoa iria também ao
 * login cortado, que pode ser a conta de outra (se o AD não deixa ler a ID, isso valeria para todos, sempre). O que a memória custa — um
 * dono que só entra pelo cortado ficar de fora — exige nome completo de outra conta igual à matrícula E ID ilegível, e "Desabilitar" desfaz.
 */
export async function verifyNetworkPassword(deps: DirectoryGateDeps, input: { networkLogin: string; password: string; accountId: string | null }): Promise<GuardedVerdict> {
  const { networkLogin, password, accountId } = input
  const short = deps.directory.shortLoginOf?.(networkLogin) ?? null
  const fullLogins = deps.directory.fullLoginsBehind?.(networkLogin) ?? []
  // Memorizado de outra matrícula (o cadastro mudou) não vale (`directoryLimits`).
  const known = short && accountId ? await deps.store.directoryLoginOf(accountId) : null
  const { whole, cut } = directoryLimits({ networkLogin, shortLogin: short, fullLogins, provenLogin: known })
  if (!short) {
    // `R456789` digitado: se o cadastro também tem `R4567891`, esse login no AD pode ser dela — a ID decide.
    const others = await deps.store.registeredMatriculas(fullLogins)
    const identity: IdentityCheck | undefined = others.length > 0 ? { notEmployeeIdOf: others, whenUnreadable: "REFUSE" } : undefined
    return verifyWithinCap(deps, { login: networkLogin, password, limits: whole!, accountId, ...(identity ? { identity } : {}) })
  }
  const remember = async (verdict: GuardedVerdict, login: string) => {
    if (verdict.kind === "OK" && accountId && known !== login) await deps.store.rememberDirectoryLogin(accountId, login)
    return verdict
  }
  const tryShort = (limits: readonly DirectoryLimit[]) => verifyWithinCap(deps, { login: short, password, limits, accountId, identity: { employeeIdOf: networkLogin, whenUnreadable: "REFUSE" } })
  if (!whole) return tryShort(cut!)
  const full = await remember(await verifyWithinCap(deps, { login: networkLogin, password, limits: whole, accountId, identity: { employeeIdOf: networkLogin, whenUnreadable: "ALLOW" } }), networkLogin)
  if (full.kind !== "INVALID" || full.identityMismatch || !cut) return full
  const verdict = await remember(await tryShort(cut), short)
  if (verdict.kind === "THROTTLED") return { ...verdict, reached: true }
  // O login inteiro já foi recusado pelo AD: a tentativa conta na trava mesmo que o servidor tenha caído antes da segunda.
  if (verdict.kind === "UNAVAILABLE" && !verdict.identityUnreadable) return { ...verdict, passwordSent: true }
  // Recusada nas duas: o código que fica registrado é o do login inteiro (diz se o AD distingue login inexistente de senha errada).
  return verdict.kind === "INVALID" && !verdict.identityMismatch ? full : verdict
}
