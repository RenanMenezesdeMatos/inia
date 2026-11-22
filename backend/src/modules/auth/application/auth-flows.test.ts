import { describe, expect, it } from "vitest"
import { authenticate, type AuthenticateDeps } from "./authenticate.js"
import type { CredentialStore, LoginAccount, LoginAttemptOutcome } from "./credential-store.js"
import { defineFirstPassword } from "./define-first-password.js"
import { authenticateNetwork, type NetworkAuthenticateDeps } from "./authenticate-network.js"
import type { DirectoryAuthenticator } from "./directory-authenticator.js"
import type { DirectoryVerdict } from "../domain/network-login.js"

const NOW = new Date("2026-10-06T12:00:00Z")
const ORG = "00000000-0000-4000-8000-000000000001"

/** Credencial em memória: hash = "hash:<senha>"; tentativas registradas com o resultado. */
function memoryStore(account: Partial<LoginAccount> | null) {
  const attempts: { id: string; identifierHash: string; accountId: string | null; outcome: LoginAttemptOutcome; at: Date }[] = []
  const events: string[] = []
  let current: LoginAccount | null = account
    ? { id: "acc-1", organizationId: ORG, personId: "p-1", name: "Larissa", role: "OPERATOR", email: "larissa@inia.local", passwordHash: "hash:Kq7m-Pz4x-Wn9r", active: true, sessionVersion: 2, passwordChangeRequired: true, temporaryPasswordExpiresAt: new Date(NOW.getTime() + 3_600_000), avatarUrl: null, jobTitle: null, teamId: null, teamName: null, matricula: null, networkLoginEnabled: false, emergencyLocalAccess: false, ...account }
    : null
  const store: CredentialStore = {
    async findByLogin(login) { return current && login.trim().toLowerCase() === current.email ? current : null },
    async sessionState() { return current },
    async reserveAttempt({ identifierHash, at }) {
      const id = String(attempts.length + 1)
      attempts.push({ id, identifierHash, accountId: null, outcome: "INVALID_CREDENTIALS", at })
      return id
    },
    async recentFailures(identifierHash, since, excludeAttemptId, options) {
      const lastSuccess = Math.max(-Infinity, ...attempts.filter((entry) => entry.identifierHash === identifierHash && entry.outcome === "SUCCEEDED").map((entry) => entry.at.getTime()))
      const found = attempts.filter((entry) => entry.identifierHash === identifierHash && entry.id !== excludeAttemptId && entry.outcome === "INVALID_CREDENTIALS" && entry.at > since && entry.at.getTime() > lastSuccess).map((entry) => entry.at).sort((x, y) => x.getTime() - y.getTime())
      return options?.limit === undefined ? found : found.slice(-options.limit)
    },
    async resolveAttempt({ attemptId, accountId, outcome }) {
      const entry = attempts.find((candidate) => candidate.id === attemptId)!
      entry.accountId = accountId
      entry.outcome = outcome
    },
    async markLoggedIn() {},
    async findByNetworkLogin(networkLogin) { return current && current.networkLoginEnabled && current.matricula?.toUpperCase() === networkLogin ? current : null },
    async completeNetworkLogin({ retiredPasswordHash }) {
      events.push("NETWORK_LOGIN")
      if (current && current.passwordChangeRequired && !current.emergencyLocalAccess) current = { ...current, passwordHash: retiredPasswordHash, passwordChangeRequired: false, temporaryPasswordExpiresAt: null }
    },
    async recordEmergencyLocalLogin() { events.push("EMERGENCY") },
    async revokeSession() {},
    async recordSessionActivity() {},
    async endAllSessions() { return current !== null },
    async passwordState() { return current },
    async completePasswordChange(input) {
      if (!current || !current.active || !current.passwordChangeRequired || current.sessionVersion !== input.expectedSessionVersion) return null
      current = { ...current, passwordHash: input.passwordHash, passwordChangeRequired: false, temporaryPasswordExpiresAt: null, sessionVersion: current.sessionVersion + 1 }
      return { sessionVersion: current.sessionVersion }
    },
  }
  return { store, attempts, events, get account() { return current } }
}
const verifyPassword = async (plain: string, hash: string) => hash === `hash:${plain}`
const deps = (store: CredentialStore, now = NOW): AuthenticateDeps => ({ store, verifyPassword, identifierHash: (login) => `id:${login.trim().toLowerCase()}`, now: () => now })

describe("login", () => {
  it("senha temporária válida entra e marca a troca obrigatória", async () => {
    const memory = memoryStore({})
    expect(await authenticate(deps(memory.store), { login: " Larissa@INIA.local", password: "Kq7m-Pz4x-Wn9r" })).toMatchObject({ kind: "SUCCEEDED", account: { passwordChangeRequired: true, sessionVersion: 2 } })
    expect(memory.attempts.map((entry) => entry.outcome)).toEqual(["SUCCEEDED"])
  })
  it("senha temporária vencida não entra (só revelado depois de provar a senha)", async () => {
    const memory = memoryStore({ temporaryPasswordExpiresAt: NOW })
    expect(await authenticate(deps(memory.store), { login: "larissa@inia.local", password: "Kq7m-Pz4x-Wn9r" })).toEqual({ kind: "TEMPORARY_PASSWORD_EXPIRED" })
    expect(await authenticate(deps(memory.store), { login: "larissa@inia.local", password: "errada" })).toEqual({ kind: "INVALID_CREDENTIALS" })
  })
  it("acesso desabilitado: senha certa = ACCESS_DISABLED; senha errada = credencial inválida", async () => {
    const memory = memoryStore({ active: false })
    expect(await authenticate(deps(memory.store), { login: "larissa@inia.local", password: "Kq7m-Pz4x-Wn9r" })).toEqual({ kind: "ACCESS_DISABLED" })
    expect(await authenticate(deps(memory.store), { login: "larissa@inia.local", password: "x" })).toEqual({ kind: "INVALID_CREDENTIALS" })
  })
  it("5 falhas travam o identificador (a 5ª já responde bloqueado), existindo ou não a conta; senha certa não fura a trava", async () => {
    for (const login of ["larissa@inia.local", "ninguem@inia.local"]) {
      const memory = memoryStore({})
      const results = []
      for (let index = 0; index < 5; index += 1) results.push((await authenticate(deps(memory.store, new Date(NOW.getTime() + index * 1000)), { login, password: "errada" })).kind)
      expect(results).toEqual(["INVALID_CREDENTIALS", "INVALID_CREDENTIALS", "INVALID_CREDENTIALS", "INVALID_CREDENTIALS", "LOCKED"])
      expect(await authenticate(deps(memory.store, new Date(NOW.getTime() + 10_000)), { login, password: "Kq7m-Pz4x-Wn9r" })).toMatchObject({ kind: "LOCKED" })
      // 15 minutos depois da 1ª falha, a trava solta.
      expect((await authenticate(deps(memory.store, new Date(NOW.getTime() + 15 * 60_000 + 1000)), { login, password: "errada" })).kind).toBe("INVALID_CREDENTIALS")
    }
  })
  it("tentativas SIMULTÂNEAS do mesmo e-mail: no máximo 5 chegam à conferência da senha (a trava não depende da ordem)", async () => {
    const memory = memoryStore({})
    let verifications = 0
    const slowVerify = async (plain: string, hash: string) => {
      verifications += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      return verifyPassword(plain, hash)
    }
    const results = await Promise.all(Array.from({ length: 20 }, () => authenticate({ ...deps(memory.store), verifyPassword: slowVerify }, { login: "larissa@inia.local", password: "errada" })))
    expect(verifications).toBeLessThanOrEqual(5)
    expect(results.filter((result) => result.kind === "LOCKED").length).toBeGreaterThanOrEqual(15)
    // Nenhuma reserva fica pendurada como falha além das que de fato conferiram a senha.
    expect(memory.attempts.filter((entry) => entry.outcome === "INVALID_CREDENTIALS").length).toBe(verifications)
  })
  it("trava provocada por outra pessoa não barra o DONO no navegador onde ele já entrou; o dispositivo tem a própria trava", async () => {
    const memory = memoryStore({ passwordChangeRequired: false, temporaryPasswordExpiresAt: null })
    const login = "larissa@inia.local"
    // Alguém trava o e-mail da Larissa com senhas erradas.
    for (let index = 0; index < 5; index += 1) await authenticate(deps(memory.store, new Date(NOW.getTime() + index * 1000)), { login, password: "errada" })
    const at = new Date(NOW.getTime() + 10_000)
    expect(await authenticate(deps(memory.store, at), { login, password: "Kq7m-Pz4x-Wn9r" })).toMatchObject({ kind: "LOCKED" })
    // A própria Larissa, com o cookie do navegador dela, entra.
    const device = { accountId: "acc-1", identifierHash: "device:larissa-notebook" }
    expect(await authenticate(deps(memory.store, at), { login, password: "Kq7m-Pz4x-Wn9r", device })).toMatchObject({ kind: "SUCCEEDED" })
    // Cookie de OUTRA conta não fura a trava deste e-mail.
    expect(await authenticate(deps(memory.store, at), { login, password: "Kq7m-Pz4x-Wn9r", device: { accountId: "acc-outra", identifierHash: "device:x" } })).toMatchObject({ kind: "LOCKED" })
    // Pelo dispositivo, as falhas contam só nele: 5 erradas travam o dispositivo também.
    const results = []
    for (let index = 0; index < 5; index += 1) results.push((await authenticate(deps(memory.store, new Date(at.getTime() + (index + 1) * 1000)), { login, password: "errada", device })).kind)
    expect(results).toEqual(["INVALID_CREDENTIALS", "INVALID_CREDENTIALS", "INVALID_CREDENTIALS", "INVALID_CREDENTIALS", "LOCKED"])
    expect(await authenticate(deps(memory.store, new Date(at.getTime() + 7000)), { login, password: "Kq7m-Pz4x-Wn9r", device })).toMatchObject({ kind: "LOCKED" })
  })

  it("login bem-sucedido zera a contagem", async () => {
    const memory = memoryStore({ passwordChangeRequired: false, temporaryPasswordExpiresAt: null, passwordHash: "hash:Cajueiro2026" })
    for (let index = 0; index < 4; index += 1) await authenticate(deps(memory.store), { login: "larissa@inia.local", password: "errada" })
    expect((await authenticate(deps(memory.store), { login: "larissa@inia.local", password: "Cajueiro2026" })).kind).toBe("SUCCEEDED")
    expect((await authenticate(deps(memory.store), { login: "larissa@inia.local", password: "errada" })).kind).toBe("INVALID_CREDENTIALS")
  })
})

describe("primeiro acesso — criar a própria senha", () => {
  const define = (memory: ReturnType<typeof memoryStore>, newPassword: string, confirmPassword = newPassword, now = NOW) =>
    defineFirstPassword({ store: memory.store, hashPassword: async (plain) => `hash:${plain}`, verifyPassword, now: () => now }, { organizationId: ORG, accountId: "acc-1", personId: "p-1", newPassword, confirmPassword })

  it("confirmação diferente, política, igual à temporária: recusa sem gravar nada", async () => {
    const memory = memoryStore({})
    await expect(define(memory, "Cajueiro2026", "Cajueiro2027")).rejects.toMatchObject({ code: "PASSWORD_CONFIRMATION_MISMATCH", statusCode: 422 })
    await expect(define(memory, "curta1")).rejects.toMatchObject({ code: "PASSWORD_POLICY_VIOLATION", details: { violations: [{ code: "TOO_SHORT" }] } })
    await expect(define(memory, "larissa2026")).rejects.toMatchObject({ code: "PASSWORD_POLICY_VIOLATION", details: { violations: [{ code: "CONTAINS_LOGIN" }] } })
    await expect(define(memory, "Kq7m-Pz4x-Wn9r")).rejects.toMatchObject({ code: "PASSWORD_SAME_AS_TEMPORARY" })
    expect(memory.account).toMatchObject({ passwordHash: "hash:Kq7m-Pz4x-Wn9r", passwordChangeRequired: true, sessionVersion: 2 })
  })
  it("sucesso: grava a nova senha, apaga a temporária, conta ATIVA e revoga as outras sessões (versão +1)", async () => {
    const memory = memoryStore({})
    expect(await define(memory, "Cajueiro2026")).toEqual({ sessionVersion: 3 })
    expect(memory.account).toMatchObject({ passwordHash: "hash:Cajueiro2026", passwordChangeRequired: false, temporaryPasswordExpiresAt: null })
    await expect(define(memory, "Outra2026x")).rejects.toMatchObject({ code: "PASSWORD_CHANGE_NOT_REQUIRED", statusCode: 409 })
  })
  it("temporária vencida ou acesso desabilitado no meio do caminho: nada é gravado", async () => {
    await expect(define(memoryStore({ temporaryPasswordExpiresAt: NOW }), "Cajueiro2026")).rejects.toMatchObject({ code: "TEMPORARY_PASSWORD_EXPIRED", statusCode: 401 })
    await expect(define(memoryStore({ active: false }), "Cajueiro2026")).rejects.toMatchObject({ code: "SESSION_REVOKED", statusCode: 401 })
  })
})

// ── LOGIN PELA REDE (AD) ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** AD falso: senha da rede = "Rede#2026"; registra cada bind (para provar quando o AD NÃO foi chamado). */
function fakeDirectory(verdict?: DirectoryVerdict) {
  const binds: string[] = []
  const directory: DirectoryAuthenticator = {
    configured: true,
    domain: "empresa.local",
    async verify(login, password) {
      binds.push(login)
      return verdict ?? (password === "Rede#2026" ? { kind: "OK" } : { kind: "INVALID" })
    },
    async probe() { return [] },
  }
  return { directory, binds }
}
const networkDeps = (store: CredentialStore, directory: DirectoryAuthenticator, now = NOW): NetworkAuthenticateDeps => ({
  store, directory, identifierHash: (login) => `id:${login}`, now: () => now, retiredPasswordHash: async () => "retired", minimumDurationMs: 0,
})
const networkAccount = { matricula: "G0055350", networkLoginEnabled: true, passwordChangeRequired: false, temporaryPasswordExpiresAt: null }

describe("login pela rede", () => {
  it("matrícula + senha de rede entram; a matrícula é normalizada (minúsculas, prefixo de domínio)", async () => {
    for (const login of ["G0055350", " g0055350 ", "EMPRESA\\g0055350"]) {
      const memory = memoryStore(networkAccount)
      const ad = fakeDirectory()
      expect(await authenticateNetwork(networkDeps(memory.store, ad.directory), { login, password: "Rede#2026" })).toMatchObject({ kind: "SUCCEEDED", account: { id: "acc-1" } })
      expect(ad.binds).toEqual(["G0055350"])
      expect(memory.events).toEqual(["NETWORK_LOGIN"])
    }
  })
  it("matrícula SEM conta na INIA nunca chega ao AD (não bloqueia a conta de rede de quem não usa a INIA)", async () => {
    const memory = memoryStore(networkAccount)
    const ad = fakeDirectory()
    expect(await authenticateNetwork(networkDeps(memory.store, ad.directory), { login: "R0099999", password: "Rede#2026" })).toEqual({ kind: "INVALID_CREDENTIALS" })
    expect(ad.binds).toEqual([])
  })
  it("organização com o login pela rede DESLIGADO: a matrícula não acha conta e o AD não é chamado", async () => {
    const memory = memoryStore({ ...networkAccount, networkLoginEnabled: false })
    const ad = fakeDirectory()
    expect((await authenticateNetwork(networkDeps(memory.store, ad.directory), { login: "G0055350", password: "Rede#2026" })).kind).toBe("INVALID_CREDENTIALS")
    expect(ad.binds).toEqual([])
  })
  it("formato inválido (@, espaço, vírgula) é recusado sem AD", async () => {
    const memory = memoryStore(networkAccount)
    const ad = fakeDirectory()
    for (const login of ["g0055350@empresa.local", "G00 55350", "cn=admin,dc=x", "*"]) {
      expect((await authenticateNetwork(networkDeps(memory.store, ad.directory), { login, password: "Rede#2026" })).kind).toBe("INVALID_CREDENTIALS")
    }
    expect(ad.binds).toEqual([])
  })
  it("3 senhas erradas travam a matrícula ANTES do AD (bem abaixo do bloqueio da conta de rede); senha certa não fura", async () => {
    const memory = memoryStore(networkAccount)
    const ad = fakeDirectory()
    const results = []
    for (let index = 0; index < 3; index += 1) results.push((await authenticateNetwork(networkDeps(memory.store, ad.directory, new Date(NOW.getTime() + index * 1000)), { login: "G0055350", password: "errada" })).kind)
    expect(results).toEqual(["INVALID_CREDENTIALS", "INVALID_CREDENTIALS", "LOCKED"])
    expect((await authenticateNetwork(networkDeps(memory.store, ad.directory, new Date(NOW.getTime() + 5000)), { login: "G0055350", password: "Rede#2026" })).kind).toBe("LOCKED")
    expect(ad.binds).toHaveLength(3)
  })
  it("uma tentativa a cada 5 min (achado SLR-01): trava na 3ª e o contador do AD nunca passa de 3 (longe dos 10 que bloqueiam)", async () => {
    const memory = memoryStore(networkAccount)
    const ad = fakeDirectory()
    // Contador do AD simulado: zera só depois de 15 min SEM falha ("Redefinir contador de bloqueios após 15 minutos").
    let adCount = 0
    let adLast = -Infinity
    let adMax = 0
    const results: string[] = []
    const bindMinutes: number[] = []
    for (let minute = 0; minute <= 180; minute += 5) {
      const at = new Date(NOW.getTime() + minute * 60_000)
      const bindsBefore = ad.binds.length
      results.push((await authenticateNetwork(networkDeps(memory.store, ad.directory, at), { login: "G0055350", password: "errada" })).kind)
      if (ad.binds.length > bindsBefore) {
        bindMinutes.push(minute)
        adCount = at.getTime() - adLast > 15 * 60_000 ? 1 : adCount + 1
        adLast = at.getTime()
        adMax = Math.max(adMax, adCount)
      }
    }
    expect(results.slice(0, 4)).toEqual(["INVALID_CREDENTIALS", "INVALID_CREDENTIALS", "LOCKED", "LOCKED"])
    // Aos 15 e 20 min a cadeia (0, 5, 10) ainda vale: nada chega ao AD. A janela deslizante deixava passar a 4ª aos 15 min.
    expect(bindMinutes.slice(0, 4)).toEqual([0, 5, 10, 30])
    expect(adMax).toBeLessThanOrEqual(3)
    expect(adMax).toBeLessThan(10)
  })
  it("falhas espaçadas por mais de 15 min nunca formam cadeia: cada tentativa segue liberada", async () => {
    const memory = memoryStore(networkAccount)
    const ad = fakeDirectory()
    const results = []
    for (let index = 0; index < 5; index += 1) results.push((await authenticateNetwork(networkDeps(memory.store, ad.directory, new Date(NOW.getTime() + index * 16 * 60_000)), { login: "G0055350", password: "errada" })).kind)
    expect(results).toEqual(Array(5).fill("INVALID_CREDENTIALS"))
    expect(ad.binds).toHaveLength(5)
  })
  it("um login certo zera a cadeia", async () => {
    const memory = memoryStore(networkAccount)
    const ad = fakeDirectory()
    const at = (minute: number) => new Date(NOW.getTime() + minute * 60_000)
    await authenticateNetwork(networkDeps(memory.store, ad.directory, at(0)), { login: "G0055350", password: "errada" })
    await authenticateNetwork(networkDeps(memory.store, ad.directory, at(1)), { login: "G0055350", password: "errada" })
    expect((await authenticateNetwork(networkDeps(memory.store, ad.directory, at(2)), { login: "G0055350", password: "Rede#2026" })).kind).toBe("SUCCEEDED")
    expect((await authenticateNetwork(networkDeps(memory.store, ad.directory, at(3)), { login: "G0055350", password: "errada" })).kind).toBe("INVALID_CREDENTIALS")
    expect((await authenticateNetwork(networkDeps(memory.store, ad.directory, at(4)), { login: "G0055350", password: "errada" })).kind).toBe("INVALID_CREDENTIALS")
  })
  it("AD fora do ar: indisponível, e a tentativa NÃO conta como senha errada", async () => {
    const memory = memoryStore(networkAccount)
    const ad = fakeDirectory({ kind: "UNAVAILABLE", reason: "timeout" })
    for (let index = 0; index < 4; index += 1) expect((await authenticateNetwork(networkDeps(memory.store, ad.directory), { login: "G0055350", password: "Rede#2026" })).kind).toBe("NETWORK_UNAVAILABLE")
    expect(memory.attempts.every((entry) => entry.outcome !== "INVALID_CREDENTIALS")).toBe(true)
  })
  it("senha enviada e o AD não respondeu: conta na trava (o AD pode ter contado) e para em 3", async () => {
    const memory = memoryStore(networkAccount)
    const ad = fakeDirectory({ kind: "UNAVAILABLE", reason: "BindRequest: Operation timed out", passwordSent: true })
    const results = []
    for (let index = 0; index < 5; index += 1) results.push((await authenticateNetwork(networkDeps(memory.store, ad.directory, new Date(NOW.getTime() + index * 1000)), { login: "G0055350", password: "errada" })).kind)
    expect(results).toEqual(["NETWORK_UNAVAILABLE", "NETWORK_UNAVAILABLE", "LOCKED", "LOCKED", "LOCKED"])
    expect(ad.binds).toHaveLength(3)
  })
  it("adaptador do AD lançou erro: na dúvida conta como senha enviada", async () => {
    const memory = memoryStore(networkAccount)
    const directory: DirectoryAuthenticator = { configured: true, domain: "empresa.local", verify: async () => { throw new Error("inesperado") }, probe: async () => [] }
    expect((await authenticateNetwork(networkDeps(memory.store, directory), { login: "G0055350", password: "x" })).kind).toBe("NETWORK_UNAVAILABLE")
    expect(memory.attempts.some((entry) => entry.outcome === "INVALID_CREDENTIALS")).toBe(true)
  })
  it("situações da conta de rede viram mensagens próprias", async () => {
    const cases: [DirectoryVerdict, string][] = [[{ kind: "PASSWORD_EXPIRED" }, "NETWORK_PASSWORD_EXPIRED"], [{ kind: "ACCOUNT_LOCKED" }, "NETWORK_ACCOUNT_LOCKED"], [{ kind: "ACCOUNT_DISABLED" }, "NETWORK_ACCOUNT_DISABLED"]]
    for (const [verdict, kind] of cases) {
      const memory = memoryStore(networkAccount)
      expect((await authenticateNetwork(networkDeps(memory.store, fakeDirectory(verdict).directory), { login: "G0055350", password: "Rede#2026" })).kind).toBe(kind)
    }
  })
  it("conta desabilitada na INIA: senha de rede certa não entra", async () => {
    const memory = memoryStore({ ...networkAccount, active: false })
    expect((await authenticateNetwork(networkDeps(memory.store, fakeDirectory().directory), { login: "G0055350", password: "Rede#2026" })).kind).toBe("ACCESS_DISABLED")
    expect(memory.events).toEqual([])
  })
  it("senha temporária pendente é aposentada no primeiro login pela rede (nunca vira senha permanente)", async () => {
    const memory = memoryStore({ ...networkAccount, passwordChangeRequired: true, temporaryPasswordExpiresAt: new Date(NOW.getTime() + 3_600_000) })
    expect(await authenticateNetwork(networkDeps(memory.store, fakeDirectory().directory), { login: "G0055350", password: "Rede#2026" })).toMatchObject({ kind: "SUCCEEDED", account: { passwordChangeRequired: false } })
    expect(memory.account).toMatchObject({ passwordHash: "retired", passwordChangeRequired: false })
    expect(await authenticate(deps(memory.store), { login: "larissa@inia.local", password: "Kq7m-Pz4x-Wn9r" })).toEqual({ kind: "INVALID_CREDENTIALS" })
  })
  it("AD não configurado na instalação: indisponível, sem tocar na trava", async () => {
    const memory = memoryStore(networkAccount)
    const directory: DirectoryAuthenticator = { ...fakeDirectory().directory, configured: false }
    expect((await authenticateNetwork(networkDeps(memory.store, directory), { login: "G0055350", password: "Rede#2026" })).kind).toBe("NETWORK_UNAVAILABLE")
    expect(memory.attempts).toEqual([])
  })
})

describe("e-mail e senha com o login pela rede ligado", () => {
  it("conta comum: senha certa é recusada com NETWORK_LOGIN_REQUIRED (senha errada continua inválida)", async () => {
    const memory = memoryStore({ networkLoginEnabled: true, passwordChangeRequired: false })
    expect(await authenticate(deps(memory.store), { login: "larissa@inia.local", password: "Kq7m-Pz4x-Wn9r" })).toEqual({ kind: "NETWORK_LOGIN_REQUIRED" })
    expect(await authenticate(deps(memory.store), { login: "larissa@inia.local", password: "x" })).toEqual({ kind: "INVALID_CREDENTIALS" })
  })
  it("conta de emergência entra e a entrada é registrada (auditoria + aviso)", async () => {
    const memory = memoryStore({ networkLoginEnabled: true, emergencyLocalAccess: true, passwordChangeRequired: false })
    expect((await authenticate(deps(memory.store), { login: "larissa@inia.local", password: "Kq7m-Pz4x-Wn9r" })).kind).toBe("SUCCEEDED")
    expect(memory.events).toEqual(["EMERGENCY"])
  })
  it("login pela rede desligado: conta de emergência entra sem registro de emergência", async () => {
    const memory = memoryStore({ emergencyLocalAccess: true, passwordChangeRequired: false })
    expect((await authenticate(deps(memory.store), { login: "larissa@inia.local", password: "Kq7m-Pz4x-Wn9r" })).kind).toBe("SUCCEEDED")
    expect(memory.events).toEqual([])
  })
})
