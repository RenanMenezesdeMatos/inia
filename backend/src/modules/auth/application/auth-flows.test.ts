import { describe, expect, it } from "vitest"
import { authenticate, type AuthenticateDeps } from "./authenticate.js"
import type { CredentialStore, LoginAccount, LoginAttemptOutcome } from "./credential-store.js"
import { defineFirstPassword } from "./define-first-password.js"

const NOW = new Date("2026-10-06T12:00:00Z")
const ORG = "00000000-0000-4000-8000-000000000001"

/** Credencial em memória: hash = "hash:<senha>"; tentativas registradas com o resultado. */
function memoryStore(account: Partial<LoginAccount> | null) {
  const attempts: { id: string; identifierHash: string; accountId: string | null; outcome: LoginAttemptOutcome; at: Date }[] = []
  let current: LoginAccount | null = account
    ? { id: "acc-1", organizationId: ORG, personId: "p-1", name: "Larissa", role: "OPERATOR", email: "larissa@inia.local", passwordHash: "hash:Kq7m-Pz4x-Wn9r", active: true, sessionVersion: 2, passwordChangeRequired: true, temporaryPasswordExpiresAt: new Date(NOW.getTime() + 3_600_000), avatarUrl: null, jobTitle: null, teamId: null, teamName: null, ...account }
    : null
  const store: CredentialStore = {
    async findByLogin(login) { return current && login.trim().toLowerCase() === current.email ? current : null },
    async sessionState() { return current },
    async reserveAttempt({ identifierHash, at }) {
      const id = String(attempts.length + 1)
      attempts.push({ id, identifierHash, accountId: null, outcome: "INVALID_CREDENTIALS", at })
      return id
    },
    async recentFailures(identifierHash, since, excludeAttemptId) {
      const lastSuccess = Math.max(-Infinity, ...attempts.filter((entry) => entry.identifierHash === identifierHash && entry.outcome === "SUCCEEDED").map((entry) => entry.at.getTime()))
      return attempts.filter((entry) => entry.identifierHash === identifierHash && entry.id !== excludeAttemptId && entry.outcome === "INVALID_CREDENTIALS" && entry.at > since && entry.at.getTime() > lastSuccess).map((entry) => entry.at)
    },
    async resolveAttempt({ attemptId, accountId, outcome }) {
      const entry = attempts.find((candidate) => candidate.id === attemptId)!
      entry.accountId = accountId
      entry.outcome = outcome
    },
    async markLoggedIn() {},
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
  return { store, attempts, get account() { return current } }
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
