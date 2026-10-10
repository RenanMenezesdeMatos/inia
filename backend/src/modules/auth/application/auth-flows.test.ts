import { describe, expect, it } from "vitest"
import { authenticate, type AuthenticateDeps } from "./authenticate.js"
import type { CredentialStore, LoginAccount, LoginAttemptOutcome } from "./credential-store.js"
import { defineFirstPassword } from "./define-first-password.js"

const NOW = new Date("2026-10-06T12:00:00Z")
const ORG = "00000000-0000-4000-8000-000000000001"

/** Credencial em memória: hash = "hash:<senha>"; tentativas registradas com o resultado. */
function memoryStore(account: Partial<LoginAccount> | null) {
  const attempts: { identifierHash: string; accountId: string | null; outcome: LoginAttemptOutcome; at: Date }[] = []
  let current: LoginAccount | null = account
    ? { id: "acc-1", organizationId: ORG, personId: "p-1", name: "Larissa", role: "OPERATOR", email: "larissa@inia.local", passwordHash: "hash:Kq7m-Pz4x-Wn9r", active: true, sessionVersion: 2, passwordChangeRequired: true, temporaryPasswordExpiresAt: new Date(NOW.getTime() + 3_600_000), avatarUrl: null, jobTitle: null, teamId: null, teamName: null, ...account }
    : null
  const store: CredentialStore = {
    async findByLogin(login) { return current && login.trim().toLowerCase() === current.email ? current : null },
    async sessionState() { return current },
    async recentFailures(identifierHash, since) {
      const lastSuccess = Math.max(-Infinity, ...attempts.filter((entry) => entry.identifierHash === identifierHash && entry.outcome === "SUCCEEDED").map((entry) => entry.at.getTime()))
      return attempts.filter((entry) => entry.identifierHash === identifierHash && entry.outcome === "INVALID_CREDENTIALS" && entry.at > since && entry.at.getTime() > lastSuccess).map((entry) => entry.at)
    },
    async recordAttempt(input) { attempts.push(input) },
    async markLoggedIn() {},
    async revokeSession() {},
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
  it("login bem-sucedido zera a contagem", async () => {
    const memory = memoryStore({ passwordChangeRequired: false, temporaryPasswordExpiresAt: null, passwordHash: "hash:Primavera2026" })
    for (let index = 0; index < 4; index += 1) await authenticate(deps(memory.store), { login: "larissa@inia.local", password: "errada" })
    expect((await authenticate(deps(memory.store), { login: "larissa@inia.local", password: "Primavera2026" })).kind).toBe("SUCCEEDED")
    expect((await authenticate(deps(memory.store), { login: "larissa@inia.local", password: "errada" })).kind).toBe("INVALID_CREDENTIALS")
  })
})

describe("primeiro acesso — criar a própria senha", () => {
  const define = (memory: ReturnType<typeof memoryStore>, newPassword: string, confirmPassword = newPassword, now = NOW) =>
    defineFirstPassword({ store: memory.store, hashPassword: async (plain) => `hash:${plain}`, verifyPassword, now: () => now }, { organizationId: ORG, accountId: "acc-1", personId: "p-1", newPassword, confirmPassword })

  it("confirmação diferente, política, igual à temporária: recusa sem gravar nada", async () => {
    const memory = memoryStore({})
    await expect(define(memory, "Primavera2026", "Primavera2027")).rejects.toMatchObject({ code: "PASSWORD_CONFIRMATION_MISMATCH", statusCode: 422 })
    await expect(define(memory, "curta1")).rejects.toMatchObject({ code: "PASSWORD_POLICY_VIOLATION", details: { violations: [{ code: "TOO_SHORT" }] } })
    await expect(define(memory, "larissa2026")).rejects.toMatchObject({ code: "PASSWORD_POLICY_VIOLATION", details: { violations: [{ code: "CONTAINS_LOGIN" }] } })
    await expect(define(memory, "Kq7m-Pz4x-Wn9r")).rejects.toMatchObject({ code: "PASSWORD_SAME_AS_TEMPORARY" })
    expect(memory.account).toMatchObject({ passwordHash: "hash:Kq7m-Pz4x-Wn9r", passwordChangeRequired: true, sessionVersion: 2 })
  })
  it("sucesso: grava a nova senha, apaga a temporária, conta ATIVA e revoga as outras sessões (versão +1)", async () => {
    const memory = memoryStore({})
    expect(await define(memory, "Primavera2026")).toEqual({ sessionVersion: 3 })
    expect(memory.account).toMatchObject({ passwordHash: "hash:Primavera2026", passwordChangeRequired: false, temporaryPasswordExpiresAt: null })
    await expect(define(memory, "Outra2026x")).rejects.toMatchObject({ code: "PASSWORD_CHANGE_NOT_REQUIRED", statusCode: 409 })
  })
  it("temporária vencida ou acesso desabilitado no meio do caminho: nada é gravado", async () => {
    await expect(define(memoryStore({ temporaryPasswordExpiresAt: NOW }), "Primavera2026")).rejects.toMatchObject({ code: "TEMPORARY_PASSWORD_EXPIRED", statusCode: 401 })
    await expect(define(memoryStore({ active: false }), "Primavera2026")).rejects.toMatchObject({ code: "SESSION_REVOKED", statusCode: 401 })
  })
})
