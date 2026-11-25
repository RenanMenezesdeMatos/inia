import { describe, expect, it } from "vitest"
import { DIRECTORY_ACCOUNT_MAX_FAILURES, fullLoginsBehind, identityVerdict, shortNetworkLoginOf, SHORT_LOGIN_MAX_FAILURES, type DirectoryVerdict } from "../domain/network-login.js"
import { authenticateNetwork, createNetworkPasswordVerifier } from "./authenticate-network.js"
import type { CredentialStore, LoginAccount, LoginAttemptOutcome } from "./credential-store.js"
import type { DirectoryAuthenticator } from "./directory-authenticator.js"

/**
 * VARREDURA (25/11/2026): milhares de sequências sorteadas tentam BLOQUEAR contas no AD e ENTRAR na conta de outra pessoa pela INIA — várias
 * matrículas que viram o mesmo login, vários navegadores conhecidos, ciência, envios simultâneos, AD lento/fora do ar, relógio do AD
 * adiantado em relação ao da INIA e tentativas coladas no instante em que a INIA libera. O AD de mentira bloqueia como o da empresa
 * (10 erros; zera após 15 min sem erro). Invariantes: nenhuma conta passa do teto da INIA, e ninguém entra como outra pessoa.
 */
type DirectoryAccount = { login: string; password: string; employeeId: string; count: number; max: number; lastBad: number }
const FORMATS = [{ prefix: "R", length: 8 }]
const random = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }

function world(next: () => number, options: { successResets: boolean }) {
  const accounts = new Map<string, DirectoryAccount>()
  const employee = (login: string, employeeId: string) => accounts.set(login, { login, password: `senha-${login}`, employeeId, count: 0, max: 0, lastBad: -Infinity })
  // R456789x: nove matrículas para um login só, de quem tem a ID 4567891. R1111111 existe inteira; R222222 e R2222221 existem as DUAS, de pessoas
  // diferentes (caso que hoje não há nos dados). A e G: formato comum.
  employee("R456789", "04567891"); employee("R1111111", "01111111"); employee("R222222", "09999999"); employee("R2222221", "02222221"); employee("A0000001", "00000001"); employee("G0000002", "03500002")
  // R555555 tem o nome completo explícito R5555551: os dois logins são a MESMA conta no AD.
  employee("R555555", "05555551"); accounts.set("R5555551", accounts.get("R555555")!)
  // Z1, de outra pessoa, tem o nome completo explícito R6666661 — a matrícula de quem no AD é R666666 (CFA-01 da run-12).
  employee("R666666", "06666661"); employee("R6666661", "00000099"); accounts.get("R6666661")!.login = "Z1"
  const people = ["R4567891", "R4567892", "R4567893", "R4567894", "R4567895", "R1111111", "R2222221", "A0000001", "G0000002", "R333333", "R5555551", "R555555", "R456789", "R222222", "R6666661"]
  const owner: Record<string, string> = { R4567891: "R456789", R1111111: "R1111111", R2222221: "R2222221", A0000001: "A0000001", G0000002: "G0000002", R5555551: "R555555", R555555: "", R222222: "R222222", R6666661: "R666666" }
  // Relógio do AD (verdadeiro) e o da INIA: atrasa, adianta e é corrigido para trás.
  let clock = Date.parse("2026-11-25T12:00:00Z")
  let skew = 0
  const down = { value: false }
  const directory: DirectoryAuthenticator = {
    configured: true, domain: "empresa.local", shortLoginOf: (login) => shortNetworkLoginOf(login, FORMATS), fullLoginsBehind: (login) => fullLoginsBehind(login, FORMATS), async probe() { return [] },
    async verify(login, password, identity): Promise<DirectoryVerdict> {
      await Promise.resolve()
      if (down.value && next() < 0.5) return { kind: "UNAVAILABLE", reason: "ECONNREFUSED" }
      const account = accounts.get(login)
      if (!account) return { kind: "INVALID", code: "52e" }
      // O AD data o erro depois da INIA (rede, fila, relógio): até 40 s.
      const delay = Math.floor(next() * 40_000)
      const at = clock + delay
      await Promise.resolve()
      if (at - account.lastBad >= 15 * 60_000) account.count = 0
      if (account.count >= 10) return { kind: "ACCOUNT_LOCKED", code: "775" }
      if (account.password !== password) {
        account.count += 1
        account.max = Math.max(account.max, account.count)
        account.lastBad = Math.max(account.lastBad, at)
        return down.value && next() < 0.5 ? { kind: "UNAVAILABLE", reason: "BindRequest timed out", passwordSent: true } : { kind: "INVALID", code: "52e" }
      }
      if (options.successResets) account.count = 0
      if (!identity) return { kind: "OK" }
      // Às vezes a ID não pode ser lida ou vem mais de uma ficha (comum quando a conta entrou pelo nome completo). Com a ficha de outro login a
      // ID é sempre legível: ilegível ali entra, por decisão.
      const chance = next()
      const ownLogin = account.login === login
      return identityVerdict(identity, chance < 0.02 && ownLogin ? { kind: "UNREADABLE" } : chance > (ownLogin ? 0.98 : 0.6) ? { kind: "NOT_PROVABLE" } : { kind: "READ", employeeId: account.employeeId, ownLogin })
    },
  }
  const attempts = new Map<string, { id: string; identifierHash: string; outcome: LoginAttemptOutcome; at: number }>()
  const known = new Map<string, string>()
  let sequence = 0
  const accountOf = (matricula: string) => ({ id: `acc-${matricula}`, organizationId: "o", personId: `p-${matricula}`, name: matricula, role: "OPERATOR", email: "x", passwordHash: "x", active: true, sessionVersion: 0, passwordChangeRequired: false, temporaryPasswordExpiresAt: null, avatarUrl: null, jobTitle: null, teamId: null, teamName: null, matricula, networkLoginEnabled: true, emergencyLocalAccess: false }) as LoginAccount
  const store = {
    async findByNetworkLogin(login: string) { return people.includes(login) ? accountOf(login) : null },
    async reserveAttempt({ identifierHash, at }: { identifierHash: string; at: Date }) { const id = String((sequence += 1)); attempts.set(id, { id, identifierHash, outcome: "INVALID_CREDENTIALS", at: at.getTime() }); return id },
    async recentFailures(identifierHash: string, since: Date, exclude: string | null | undefined, limit?: { limit?: number }) {
      const mine = [...attempts.values()].filter((entry) => entry.identifierHash === identifierHash)
      const lastSuccess = Math.max(-Infinity, ...mine.filter((entry) => entry.outcome === "SUCCEEDED").map((entry) => entry.at))
      return mine.filter((entry) => entry.id !== exclude && entry.outcome === "INVALID_CREDENTIALS" && entry.at > since.getTime() && entry.at > lastSuccess).sort((a, b) => a.at - b.at).slice(-(limit?.limit ?? 1000)).map((entry) => new Date(entry.at))
    },
    async resolveAttempt({ attemptId, outcome, redatedTo }: { attemptId: string | null; outcome: LoginAttemptOutcome; redatedTo?: Date | null }) { const entry = attempts.get(attemptId!)!; entry.outcome = outcome; if (redatedTo) entry.at = redatedTo.getTime() },
    async registeredMatriculas(normalized: readonly string[]) { return normalized.filter((matricula) => people.includes(matricula)) },
    async directoryLoginOf(accountId: string) { return known.get(accountId) ?? null },
    async rememberDirectoryLogin(accountId: string, login: string) { known.set(accountId, login) },
    async completeNetworkLogin() {},
  } as unknown as CredentialStore
  const deps = { store, directory, identifierHash: (login: string) => login, now: () => new Date(clock + skew), retiredPasswordHash: async () => "x", minimumDurationMs: 0 }
  return { accounts, people, owner, deps, down, known, advance: (ms: number) => { clock += ms; if (next() < 0.2) skew = -Math.floor(next() * 20_000); for (const [id, entry] of attempts) if (clock - entry.at > 26 * 3_600_000) attempts.delete(id) } }
}

describe("varredura: a INIA nunca bloqueia uma conta do AD nem deixa entrar como outra pessoa", () => {
  it.each([["o AD zera o contador na senha certa", true], ["o AD NÃO zera na senha certa (outro servidor)", false]])("%s", async (_name, successResets) => {
    let sent = 0
    let entered = 0
    const highest = new Map<string, number>()
    for (let seed = 1; seed <= 80; seed += 1) {
      const next = random(seed * 7919)
      const pick = <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)]!
      const w = world(next, { successResets })
      const verifyCiencia = createNetworkPasswordVerifier(w.deps)
      for (let step = 0; step < 250; step += 1) {
        w.down.value = next() < 0.08
        // Tempo: rajadas, e muitos saltos colados nos limites de 15 e 16 minutos.
        w.advance(pick([0, 0, 1_000, 5_000, 30_000, 4 * 60_000, 14.9 * 60_000, 15 * 60_000 + 1, 15.5 * 60_000, 16 * 60_000 + 1, 16 * 60_000 + 1]))
        const burst = next() < 0.15 ? 2 + Math.floor(next() * 8) : 1
        await Promise.all(Array.from({ length: burst }, async () => {
          const typed = pick(w.people)
          const password = next() < 0.25 ? `senha-${pick([...w.accounts.keys()])}` : "errada"
          sent += 1
          if (next() < 0.2) {
            const check = await verifyCiencia({ normalized: typed, password, accountId: `acc-${typed}` })
            if (check === "OK") expect(password, typed).toBe(`senha-${w.owner[typed]}`)
            return
          }
          // Até 8 navegadores conhecidos por pessoa (cada um com a própria trava).
          const device = next() < 0.7 ? { accountId: `acc-${typed}`, identifierHash: `device-${typed}-${Math.floor(next() * 8)}` } : null
          const result = await authenticateNetwork(w.deps, { login: typed, password, device })
          if (result.kind === "SUCCEEDED") {
            entered += 1
            // Só o dono da conta do AD daquela matrícula entra, e entra na própria conta.
            expect(result.account.id).toBe(`acc-${typed}`)
            expect(password, typed).toBe(`senha-${w.owner[typed]}`)
          }
        }))
      }
      for (const [login, account] of w.accounts) highest.set(login, Math.max(highest.get(login) ?? 0, account.max))
      // O login memorizado leva à conta do AD da própria pessoa (o nome completo explícito pode ser outro texto para a mesma conta).
      for (const [accountId, login] of w.known) expect(w.accounts.get(login), accountId).toBe(w.accounts.get(w.owner[accountId.slice(4)]!))
    }
    expect(sent).toBeGreaterThan(20_000)
    expect(entered).toBeGreaterThan(200)
    for (const [login, max] of highest) expect(max, login).toBeLessThanOrEqual(DIRECTORY_ACCOUNT_MAX_FAILURES)
    // Nove matrículas para o mesmo login, muitos navegadores e ciência: nunca mais que o teto do login sem o último dígito.
    // R222222 (de ninguém do formato) e R555555 (que também é R5555551) são digitadas direto: vale o teto da conta.
    expect(highest.get("R555555")).toBeLessThanOrEqual(DIRECTORY_ACCOUNT_MAX_FAILURES)
    expect(SHORT_LOGIN_MAX_FAILURES).toBeLessThan(DIRECTORY_ACCOUNT_MAX_FAILURES)
    console.info(JSON.stringify({ event: "directory_lockout_sweep", successResets, sent, entered, highest: Object.fromEntries(highest) }))
  }, 120_000)
})
