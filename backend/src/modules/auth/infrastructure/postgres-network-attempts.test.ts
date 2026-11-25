import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { CredentialStore } from "../application/credential-store.js"
import type { DirectoryAuthenticator } from "../application/directory-authenticator.js"
import { verifyNetworkPassword } from "../application/directory-gate.js"
import { fullLoginsBehind, shortNetworkLoginOf } from "../domain/network-login.js"
import { loginIdentifierHash } from "./postgres-credential-store.js"
import { createPostgresNetworkAttempts } from "./postgres-network-attempts.js"

/** A tela de Acessos e o portão barram a MESMA coisa (ARQ12-01 da run-12): mesmas falhas, mesma memória, mesma resposta. */
const FORMATS = [{ prefix: "R", length: 8 }]
const NOW = new Date("2026-11-25T12:00:00Z")
type Failures = Record<string, number>
const minutesAgo = (count: number) => Array.from({ length: count }, (_, index) => new Date(NOW.getTime() - (index + 1) * 60_000))
const failuresOf = (failures: Failures) => new Map(Object.entries(failures).map(([login, count]) => [loginIdentifierHash(`ad:${login}`), minutesAgo(count)]))

async function gate(networkLogin: string, memorized: string | null, failures: Failures) {
  const known = failuresOf(failures)
  const store = {
    reserveAttempt: async () => "1", resolveAttempt: async () => undefined, rememberDirectoryLogin: async () => undefined, registeredMatriculas: async () => [],
    directoryLoginOf: async () => memorized, recentFailures: async (hash: string) => known.get(hash) ?? [],
  } as unknown as CredentialStore
  const sent: string[] = []
  const directory = {
    configured: true, shortLoginOf: (login: string) => shortNetworkLoginOf(login, FORMATS), fullLoginsBehind: (login: string) => fullLoginsBehind(login, FORMATS),
    verify: async (login: string) => { sent.push(login); return { kind: "INVALID", code: "52e" } },
  } as unknown as DirectoryAuthenticator
  const verdict = await verifyNetworkPassword({ store, directory, identifierHash: loginIdentifierHash, now: () => NOW }, { networkLogin, password: "x", accountId: "acc" })
  return { locked: verdict.kind === "THROTTLED", sent }
}

async function summary(networkLogin: string, memorized: { matricula: string; directory_login: string }[], failures: Failures) {
  const known = failuresOf(failures)
  const statements: string[] = []
  const db = {
    query: async (sql: string, params: unknown[]) => {
      statements.push(sql)
      if (sql.includes("directory_login")) return { rows: memorized }
      return { rows: (params[0] as string[]).map((hash) => ({ identifier_hash: hash, failures: known.get(hash) ?? null, last_at: null, last_outcome: null, last_reason: null, last_code: null })) }
    },
  } as unknown as Database
  const result = await createPostgresNetworkAttempts(db, FORMATS).summaries([networkLogin], NOW)
  return { locked: (result.get(networkLogin)?.lockedUntil ?? null) !== null, statements }
}

describe("resumo da tela × portão", () => {
  it.each<[string, string, string | null, Failures, boolean]>([
    ["memória de OUTRA matrícula não solta o teto menor", "R5000001", "R456789", { R500000: 3 }, true],
    ["sem memória, o cortado trava em 3", "R5000001", null, { R500000: 3 }, true],
    ["sem memória, dois erros no cortado não travam", "R5000001", null, { R500000: 2 }, false],
    ["provado pelo cortado: teto cheio", "R5000001", "R500000", { R500000: 4 }, false],
    ["provado pelo cortado: soma os dois logins", "R5000001", "R500000", { R500000: 3, R5000001: 2 }, true],
    ["provado pelo inteiro: o cortado não recebe senha nem trava sozinho", "R5000001", "R5000001", { R500000: 3 }, false],
    ["formato comum: só o próprio login", "G0055350", null, { G0055350: 5 }, true],
    ["cortado digitado direto soma as matrículas inteiras por trás dele", "R500000", null, { R5000001: 3, R5000007: 2 }, true],
    ["cortado digitado direto: abaixo do teto", "R500000", null, { R5000001: 2, R500000: 2 }, false],
  ])("%s", async (_name, login, memorized, failures, locked) => {
    expect((await gate(login, memorized, failures)).locked).toBe(locked)
    expect((await summary(login, memorized === null ? [] : [{ matricula: login, directory_login: memorized }], failures)).locked).toBe(locked)
  })
  it("a memória vem só de conta e pessoa ativas, e um valor de outra matrícula não encobre o válido", async () => {
    const { locked, statements } = await summary("R5000001", [{ matricula: "R5000001", directory_login: "R500000" }, { matricula: "R5000001", directory_login: "R456789" }], { R500000: 4 })
    expect(locked).toBe(false)
    const sql = statements.find((statement) => statement.includes("directory_login"))!
    expect(sql).toMatch(/ua\.active/)
    expect(sql).toMatch(/p\.active/)
  })
})
