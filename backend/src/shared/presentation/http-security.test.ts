import jwt from "jsonwebtoken"
import request from "supertest"
import { beforeAll, describe, expect, it } from "vitest"
import { env, envSchema, parseAllowedOrigins } from "../../config/env.js"
import type { Database } from "../../infrastructure/database/pool.js"
import { createApp, parseTrustProxy } from "../../main/app.js"
import { legacyAccessQuery } from "../../modules/access/testing/legacy-admin-fixture.js"
import { hashPassword } from "../../modules/auth/infrastructure/password-hasher.js"
import { createRateLimiter } from "./rate-limit.js"

/**
 * Controles HTTP transversais da auditoria de segurança (docs/security/relatorio-de-achados.md): conferência de origem das
 * escritas com cookie (CSRF), limites de requisições, revogação da sessão no logout, algoritmo fixo do JWT, erros de entrada
 * como 4xx e respostas da API sem cache. Banco falso: só as consultas que o caminho usa.
 */
const ACCOUNT = { id: "11111111-1111-4111-8111-111111111111", organization_id: "00000000-0000-4000-8000-000000000001", person_id: "00000000-0000-4000-8000-000000000032", name: "Carla Nunes", role: "ADMIN", email: "carla.nunes@inia.com", avatar_url: null, job_title: null, team_id: null, team_name: null }
const ALLOWED_ORIGIN = env.allowedOrigins[0]!

let passwordHash: string
beforeAll(async () => {
  passwordHash = await hashPassword("Inia@123")
})

/** Banco falso com a tabela de revogações em memória (o que o logout grava, o guard de sessão lê). */
function fakeDatabase(person: { active?: boolean; role?: string } = {}) {
  const revoked = new Set<string>()
  const database = {
    query: async (sql: string, params: unknown[] = []) => {
      const access = legacyAccessQuery(sql, ACCOUNT.role, [])
      if (access) return access
      if (sql.includes("insert into auth_revoked_sessions")) {
        revoked.add(String(params[0]))
        return { rows: [], rowCount: 1 }
      }
      if (sql.includes("from user_accounts ua")) {
        const sessionRevoked = sql.includes("auth_revoked_sessions") && revoked.has(String(params[2]))
        return { rows: [{ ...ACCOUNT, password_hash: passwordHash, active: true, session_revoked: sessionRevoked, person_active: person.active ?? true, person_role: person.role ?? ACCOUNT.role }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    },
    connect: async () => {
      throw new Error("not needed")
    },
  } as unknown as Database
  return { database, revoked }
}

async function loggedInCookie(app: ReturnType<typeof createApp>) {
  const login = await request(app).post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
  expect(login.status).toBe(200)
  const cookie = (login.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!
  return cookie
}

describe("CSRF — conferência de origem das escritas autenticadas por cookie", () => {
  it("recusa escrita com cookie vinda de outra origem e aceita a origem autorizada", async () => {
    const app = createApp(fakeDatabase().database)
    const cookie = await loggedInCookie(app)
    const forged = await request(app).post("/api/v1/supervision-cases").set("Cookie", cookie).set("Origin", "https://atacante.example").send({})
    expect(forged.status).toBe(403)
    expect(forged.body.error.code).toBe("CROSS_SITE_REQUEST_BLOCKED")
    // Subdomínio irmão (mesmo SITE, outra ORIGEM) também não passa — é o caso que o SameSite=Lax sozinho não cobre.
    const sibling = await request(app).post("/api/v1/supervision-cases").set("Cookie", cookie).set("Origin", "http://outro.localhost:3000").send({})
    expect(sibling.status).toBe(403)
    const nullOrigin = await request(app).post("/api/v1/supervision-cases").set("Cookie", cookie).set("Origin", "null").send({})
    expect(nullOrigin.status).toBe(403)
    // Origem legítima: passa pela guarda (a rota responde o que responderia — aqui, validação do corpo).
    const legit = await request(app).post("/api/v1/supervision-cases").set("Cookie", cookie).set("Origin", ALLOWED_ORIGIN).send({})
    expect(legit.status).not.toBe(403)
  })

  it("sem Origin, usa Sec-Fetch-Site: cross-site/same-site recusados; same-origin e clientes fora do navegador passam", async () => {
    const app = createApp(fakeDatabase().database)
    const cookie = await loggedInCookie(app)
    for (const site of ["cross-site", "same-site"]) {
      const response = await request(app).delete("/api/v1/notifications/00000000-0000-4000-8000-000000000099").set("Cookie", cookie).set("Sec-Fetch-Site", site)
      expect(response.status).toBe(403)
    }
    const sameOrigin = await request(app).post("/api/v1/auth/logout").set("Cookie", cookie).set("Sec-Fetch-Site", "same-origin")
    expect(sameOrigin.status).toBe(204)
    const script = await request(app).get("/api/v1/auth/me").set("Cookie", await loggedInCookie(app))
    expect(script.status).toBe(200)
  })

  it("leitura (GET) e requisições sem cookie de sessão não são afetadas", async () => {
    const app = createApp(fakeDatabase().database)
    const cookie = await loggedInCookie(app)
    const read = await request(app).get("/api/v1/auth/me").set("Cookie", cookie).set("Origin", "https://atacante.example")
    expect(read.status).toBe(200)
    // Login não tem sessão a abusar; o CORS continua sendo quem decide se o navegador da outra origem lê a resposta.
    const login = await request(app).post("/api/v1/auth/login").set("Origin", "https://atacante.example").send({ email: ACCOUNT.email, password: "errada-123" })
    expect(login.status).toBe(401)
  })

  it("CORS só reflete origens autorizadas", async () => {
    const app = createApp(fakeDatabase().database)
    const allowed = await request(app).options("/api/v1/auth/login").set("Origin", ALLOWED_ORIGIN).set("Access-Control-Request-Method", "POST")
    expect(allowed.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN)
    const denied = await request(app).options("/api/v1/auth/login").set("Origin", "https://atacante.example").set("Access-Control-Request-Method", "POST")
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined()
  })
})

describe("sessão — logout revoga a sessão no servidor e o JWT só aceita HS256", () => {
  it("o token copiado antes do logout deixa de valer; outra sessão da mesma conta continua", async () => {
    const { database, revoked } = fakeDatabase()
    const app = createApp(database)
    const stolen = await loggedInCookie(app)
    const otherDevice = await loggedInCookie(app)
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", stolen)).status).toBe(200)
    const logout = await request(app).post("/api/v1/auth/logout").set("Cookie", stolen)
    expect(logout.status).toBe(204)
    expect(revoked.size).toBe(1)
    const replay = await request(app).get("/api/v1/auth/me").set("Cookie", stolen)
    expect(replay.status).toBe(401)
    expect(replay.body.error.code).toBe("SESSION_REVOKED")
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", otherDevice)).status).toBe(200)
  })

  it("/me não devolve metadados do token (iat, exp, jti, versão de sessão)", async () => {
    const app = createApp(fakeDatabase().database)
    const me = await request(app).get("/api/v1/auth/me").set("Cookie", await loggedInCookie(app))
    expect(me.status).toBe(200)
    for (const key of ["iat", "exp", "jti", "sv", "pc"]) expect(me.body.data).not.toHaveProperty(key)
  })

  it("pessoa inativa no cadastro (ex.: desligada pela Central) não entra nem mantém a sessão", async () => {
    const active = fakeDatabase()
    const cookie = await loggedInCookie(createApp(active.database))
    const inactive = createApp(fakeDatabase({ active: false }).database)
    const login = await request(inactive).post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
    expect(login.status).toBe(403)
    expect(login.body.error.code).toBe("ACCESS_DISABLED")
    expect((await request(inactive).get("/api/v1/auth/me").set("Cookie", cookie)).status).toBe(401)
  })

  it("o nível hierárquico vale o do cadastro AGORA, não a foto do login", async () => {
    const cookie = await loggedInCookie(createApp(fakeDatabase({ role: "DIRECTOR" }).database))
    const demoted = await request(createApp(fakeDatabase({ role: "OPERATOR" }).database)).get("/api/v1/auth/me").set("Cookie", cookie)
    expect(demoted.status).toBe(200)
    expect(demoted.body.data.role).toBe("OPERATOR")
  })

  it("recusa token com outro algoritmo, sem assinatura ou sem a forma de uma sessão", async () => {
    const app = createApp(fakeDatabase().database)
    const payload = { sub: ACCOUNT.id, personId: ACCOUNT.person_id, organizationId: ACCOUNT.organization_id, role: "ADMIN", name: "x", email: ACCOUNT.email, sv: 0 }
    const otherAlgorithm = jwt.sign(payload, env.JWT_SECRET, { algorithm: "HS512" })
    const unsigned = jwt.sign(payload, "", { algorithm: "none" } as jwt.SignOptions)
    const notASession = jwt.sign({ sub: ACCOUNT.id }, env.JWT_SECRET, { algorithm: "HS256" })
    const wrongSecret = jwt.sign(payload, "outro-segredo-qualquer-com-32-caracteres!", { algorithm: "HS256" })
    for (const token of [otherAlgorithm, unsigned, notASession, wrongSecret]) {
      const response = await request(app).get("/api/v1/auth/me").set("Cookie", `inia_session=${token}`)
      expect(response.status).toBe(401)
    }
    const valid = jwt.sign(payload, env.JWT_SECRET, { algorithm: "HS256", expiresIn: "1h" })
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", `inia_session=${valid}`)).status).toBe(200)
  })
})

describe("limites de requisições", () => {
  it("login: limite por IP além da trava por e-mail; IPs diferentes (via proxy confiável) têm contadores separados", async () => {
    const app = createApp(fakeDatabase().database, { rateLimits: { loginPerIp: 3 } })
    const attempt = (ip: string) => request(app).post("/api/v1/auth/login").set("X-Forwarded-For", ip).send({ email: `pessoa-${Math.random()}@inia.com`, password: "errada-123" })
    for (let index = 0; index < 3; index += 1) expect((await attempt("203.0.113.10")).status).toBe(401)
    const blocked = await attempt("203.0.113.10")
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.code).toBe("RATE_LIMITED")
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0)
    expect((await attempt("203.0.113.11")).status).toBe(401)
  })

  it("confirmação de ciência com senha: só as FALHAS contam, por conta", async () => {
    const app = createApp(fakeDatabase().database, { rateLimits: { readConfirmationFailuresPerAccount: 2 } })
    const cookie = await loggedInCookie(app)
    const confirm = () => request(app).post("/api/v1/feedback-read-confirmations").set("Cookie", cookie).send({})
    expect((await confirm()).status).toBe(400)
    expect((await confirm()).status).toBe(400)
    expect((await confirm()).status).toBe(429)
  })

  it("IA conversacional: teto por conta", async () => {
    const app = createApp(fakeDatabase().database, { rateLimits: { aiInteractivePerAccount: 2 } })
    const cookie = await loggedInCookie(app)
    const send = () => request(app).post("/api/v1/realtime/messages").set("Cookie", cookie).send({})
    expect((await send()).status).not.toBe(429)
    expect((await send()).status).not.toBe(429)
    expect((await send()).status).toBe(429)
  })

  it("API Push: requisições recusadas por IP esgotam o limite de falhas", async () => {
    const app = createApp(fakeDatabase().database, { rateLimits: { pushIngestionFailuresPerIp: 2 } })
    const push = () => request(app).post("/api/v1/data-ingestion/src_inexistente/feed").set("Authorization", "Bearer token-invalido").send({ records: [] })
    expect((await push()).status).toBeGreaterThanOrEqual(400)
    expect((await push()).status).toBeGreaterThanOrEqual(400)
    expect((await push()).status).toBe(429)
  })

  it("janela deslizante: libera depois da janela e despreza a anterior com o tempo", () => {
    let now = 0
    const limiter = createRateLimiter({ name: "t", windowMs: 1000, max: 2, key: () => "k" }, () => now)
    const run = () => {
      let status = 200
      limiter({} as never, { set: () => undefined, status: (code: number) => ({ json: () => (status = code) }), on: () => undefined } as never, () => undefined)
      return status
    }
    expect([run(), run(), run()]).toEqual([200, 200, 429])
    now = 2500
    expect([run(), run(), run()]).toEqual([200, 200, 429])
  })
})

describe("entrada inválida e cabeçalhos", () => {
  it("JSON malformado → 400 e corpo grande demais → 413 (nunca 500)", async () => {
    const app = createApp(fakeDatabase().database)
    const malformed = await request(app).post("/api/v1/auth/login").set("Content-Type", "application/json").send("{\"email\":")
    expect(malformed.status).toBe(400)
    expect(malformed.body.error.code).toBe("INVALID_JSON")
    const huge = await request(app).post("/api/v1/auth/login").set("Content-Type", "application/json").send(JSON.stringify({ email: "a@b.com", password: "x".repeat(1_100_000) }))
    expect(huge.status).toBe(413)
  })

  it("respostas da API não ficam em cache e a API não se identifica", async () => {
    const app = createApp(fakeDatabase().database)
    const me = await request(app).get("/api/v1/auth/me").set("Cookie", await loggedInCookie(app))
    expect(me.headers["cache-control"]).toBe("no-store")
    expect(me.headers["x-powered-by"]).toBeUndefined()
    expect(me.headers["x-content-type-options"]).toBe("nosniff")
  })

  it("configuração: lista de origens, proxy confiável e TRUST_PROXY=true recusado", () => {
    expect(parseAllowedOrigins("https://inia.empresa.local/, http://localhost:3000")).toEqual(["https://inia.empresa.local", "http://localhost:3000"])
    expect(parseTrustProxy("false")).toBe(false)
    expect(parseTrustProxy("1")).toBe(1)
    expect(parseTrustProxy("loopback, 10.0.0.0/8")).toBe("loopback, 10.0.0.0/8")
    expect(envSchema.shape.TRUST_PROXY.safeParse("true").success).toBe(false)
    expect(envSchema.shape.TRUST_PROXY.parse(undefined)).toBe("loopback")
    expect(envSchema.shape.SESSION_COOKIE_SECURE.parse(undefined)).toBe("auto")
  })
})
