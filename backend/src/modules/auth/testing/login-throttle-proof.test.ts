/**
 * PROVA contra o banco de TESTE real: a trava de login por e-mail vale para tentativas SIMULTÂNEAS (achado AUTH-1 da auditoria
 * de 17/10/2026). Cada tentativa é reservada (gravada) antes do bcrypt, com o pool de verdade — várias conexões ao mesmo tempo,
 * cada instrução em autocommit, como no servidor. Só usa um identificador aleatório (e-mail inexistente) e apaga as linhas dele.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run login-throttle-proof
 */
import { randomUUID } from "node:crypto"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { authenticate } from "../application/authenticate.js"
import { createPostgresCredentialStore, purgeOldLoginAttempts } from "../infrastructure/postgres-credential-store.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool
const identifier = `proof-login-throttle-${randomUUID()}`

describe.skipIf(!ENABLED)("Trava de login com tentativas simultâneas — prova Postgres", () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 12 })
  })
  afterAll(async () => {
    if (!pool) return
    await pool.query("delete from auth_login_attempts where identifier_hash = $1", [identifier])
    await pool.end()
  })

  it("30 tentativas erradas em paralelo: no máximo 5 conferem a senha; as reservas viram o resultado de cada uma", async () => {
    const store = createPostgresCredentialStore(pool)
    let verifications = 0
    const slowVerify = async () => {
      verifications += 1
      await new Promise((resolve) => setTimeout(resolve, 40))
      return false
    }
    const now = new Date()
    const results = await Promise.all(
      Array.from({ length: 30 }, () => authenticate({ store, verifyPassword: slowVerify, identifierHash: () => identifier, now: () => now }, { login: `${identifier}@proof.inia.local`, password: "errada" })),
    )
    expect(verifications).toBeLessThanOrEqual(5)
    expect(results.filter((result) => result.kind === "LOCKED").length).toBeGreaterThanOrEqual(25)
    const rows = (await pool.query<{ outcome: string; n: number }>("select outcome, count(*)::int n from auth_login_attempts where identifier_hash = $1 group by outcome", [identifier])).rows
    const count = (outcome: string) => rows.find((row) => row.outcome === outcome)?.n ?? 0
    expect(count("INVALID_CREDENTIALS")).toBe(verifications)
    expect(count("INVALID_CREDENTIALS") + count("LOCKED")).toBe(30)
  })

  it("retenção: tentativas com mais de 30 dias saem na limpeza periódica; as recentes (as que a trava usa) ficam", async () => {
    const old = `${identifier}-retencao`
    await pool.query(`insert into auth_login_attempts (identifier_hash, outcome, attempted_at) values ($1, 'INVALID_CREDENTIALS', now() - interval '31 days'), ($1, 'INVALID_CREDENTIALS', now() - interval '10 minutes')`, [old])
    expect(await purgeOldLoginAttempts(pool)).toBeGreaterThanOrEqual(1)
    const left = await pool.query<{ recent: boolean }>(`select attempted_at > now() - interval '1 day' recent from auth_login_attempts where identifier_hash = $1`, [old])
    expect(left.rows).toEqual([{ recent: true }])
    await pool.query("delete from auth_login_attempts where identifier_hash = $1", [old])
  })
})
