/**
 * PROVA contra o banco de TESTE real: encerramento da sessão por inatividade e "sair de todos os aparelhos" (liberação na Vivo,
 * migration 149). Cria uma organização própria, uma pessoa e uma conta, entra pela rota de login de verdade e apaga tudo no fim.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run session-activity-proof
 */
import { randomUUID } from "node:crypto"
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../infrastructure/password-hasher.js"
import { SESSION_COOKIE_NAME } from "../presentation/session-cookie.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = randomUUID()
const PERSON = randomUUID()
const ACCOUNT = randomUUID()
const EMAIL = `proof-session-${ORG.slice(0, 8)}@proof.inia.local`
const PASSWORD = "Cajueiro-Prova-2026"
const ORIGIN = env.allowedOrigins[0]!
let pool: pg.Pool

async function loginCookie(app: ReturnType<typeof createApp>): Promise<string> {
  const response = await request(app).post("/api/v1/auth/login").set("Origin", ORIGIN).send({ email: EMAIL, password: PASSWORD })
  expect(response.status).toBe(200)
  const cookie = ([] as string[]).concat(response.headers["set-cookie"] ?? []).find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`))
  expect(cookie).toBeDefined()
  return cookie!.split(";")[0]!
}

const jtiOf = (cookie: string) => JSON.parse(Buffer.from(cookie.split("=")[1]!.split(".")[1]!, "base64url").toString()).jti as string

describe.skipIf(!ENABLED)("Sessão — inatividade e sair de todos os aparelhos — prova Postgres", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 6 })
    await pool.query(`insert into organizations (id, name, slug) values ($1, 'Prova sessão', $2)`, [ORG, `prova-sessao-${ORG.slice(0, 8)}`])
    await pool.query(`insert into people (id, organization_id, name, role, active) values ($1, $2, 'Pessoa da prova de sessão', 'OPERATOR', true)`, [PERSON, ORG])
    await pool.query(
      `insert into user_accounts (id, organization_id, person_id, email, password_hash, active, password_change_required) values ($1, $2, $3, $4, $5, true, false)`,
      [ACCOUNT, ORG, PERSON, EMAIL, await hashPassword(PASSWORD)],
    )
  })
  afterAll(async () => {
    if (!pool) return
    await pool.query(`delete from audit_logs where organization_id = $1`, [ORG])
    await pool.query(`delete from auth_login_attempts where account_id = $1`, [ACCOUNT])
    await pool.query(`delete from user_accounts where id = $1`, [ACCOUNT])
    await pool.query(`delete from people where id = $1`, [PERSON])
    await pool.query(`delete from organizations where id = $1`, [ORG])
    await pool.end()
  })

  it("login registra a atividade da sessão; leitura não renova; sessão parada além do limite cai com SESSION_IDLE", async () => {
    const app = createApp(pool, { rateLimits: false })
    const cookie = await loginCookie(app)
    const jti = jtiOf(cookie)
    const row = await pool.query<{ account_id: string }>(`select account_id from auth_session_activity where jti = $1`, [jti])
    expect(row.rows).toEqual([{ account_id: ACCOUNT }])

    // Última atividade há 10 minutos: GET passa e NÃO renova (o sino e os avisos consultam sozinhos).
    await pool.query(`update auth_session_activity set last_activity_at = now() - interval '10 minutes' where jti = $1`, [jti])
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", cookie)).status).toBe(200)
    const afterRead = await pool.query<{ minutes: number }>(`select extract(epoch from now() - last_activity_at)::int / 60 minutes from auth_session_activity where jti = $1`, [jti])
    expect(afterRead.rows[0]!.minutes).toBeGreaterThanOrEqual(9)

    // Aviso de interação da tela: renova.
    expect((await request(app).post("/api/v1/auth/activity").set("Cookie", cookie).set("Origin", ORIGIN)).status).toBe(204)
    const afterActivity = await pool.query<{ seconds: number }>(`select extract(epoch from now() - last_activity_at)::int seconds from auth_session_activity where jti = $1`, [jti])
    expect(afterActivity.rows[0]!.seconds).toBeLessThan(30)

    // Parada além do limite: encerrada, mesmo com o JWT válido; o cookie é apagado.
    await pool.query(`update auth_session_activity set last_activity_at = now() - make_interval(mins => $2::int + 1) where jti = $1`, [jti, env.SESSION_IDLE_TIMEOUT_MINUTES])
    const idle = await request(app).get("/api/v1/auth/me").set("Cookie", cookie)
    expect(idle.status).toBe(401)
    expect(idle.body.error.code).toBe("SESSION_IDLE")
    expect(([] as string[]).concat(idle.headers["set-cookie"] ?? []).some((value) => value.startsWith(`${SESSION_COOKIE_NAME}=;`))).toBe(true)
  })

  it("sair de todos os aparelhos: todas as sessões da conta caem (inclusive a atual) e fica na auditoria", async () => {
    const app = createApp(pool, { rateLimits: false })
    const notebook = await loginCookie(app)
    const phone = await loginCookie(app)
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", phone)).status).toBe(200)

    expect((await request(app).post("/api/v1/auth/logout-all").set("Cookie", notebook).set("Origin", ORIGIN)).status).toBe(204)
    for (const cookie of [notebook, phone]) {
      const me = await request(app).get("/api/v1/auth/me").set("Cookie", cookie)
      expect(me.status).toBe(401)
      expect(me.body.error.code).toBe("SESSION_REVOKED")
    }
    const audit = await pool.query(`select 1 from audit_logs where organization_id = $1 and action = 'ACCESS_SESSIONS_ENDED_BY_OWNER' and entity_id = $2`, [ORG, ACCOUNT])
    expect(audit.rowCount).toBe(1)
    // Entrar de novo funciona normalmente.
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", await loginCookie(app))).status).toBe(200)
  })

  it("sem sessão, os dois endpoints novos respondem 401", async () => {
    const app = createApp(pool, { rateLimits: false })
    expect((await request(app).post("/api/v1/auth/activity").set("Origin", ORIGIN)).status).toBe(401)
    expect((await request(app).post("/api/v1/auth/logout-all").set("Origin", ORIGIN)).status).toBe(401)
  })
})
