import jwt from "jsonwebtoken"
import request from "supertest"
import { beforeAll, describe, expect, it } from "vitest"
import { env, envSchema, parseAllowedOrigins, productionOriginProblems, productionSecretProblems } from "../../config/env.js"
import type { Database } from "../../infrastructure/database/pool.js"
import { createApp, describeClientError, parseTrustProxy } from "../../main/app.js"
import { legacyAccessQuery } from "../../modules/access/testing/legacy-admin-fixture.js"
import { hashPassword } from "../../modules/auth/infrastructure/password-hasher.js"
import { createMemoryRateLimitStore } from "../application/rate-limit/rate-limit-store.js"
import { createRateLimiter, normalizeClientIp, rateLimitBucket } from "./rate-limit.js"

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
function fakeDatabase(person: { active?: boolean; role?: string } = {}, failure?: (sql: string, params: unknown[]) => object | undefined) {
  const revoked = new Set<string>()
  const database = {
    query: async (sql: string, params: unknown[] = []) => {
      const access = legacyAccessQuery(sql, ACCOUNT.role, [])
      if (access) return access
      const error = failure?.(sql, params)
      if (error) throw Object.assign(new Error("erro do banco (simulado)"), error)
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

  it("login certo marca o navegador como dispositivo conhecido da conta (cookie httpOnly só para as rotas de login)", async () => {
    const app = createApp(fakeDatabase().database)
    const login = await request(app).post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
    const cookies = login.headers["set-cookie"] as unknown as string[]
    expect(cookies[0]).toMatch(/^inia_session=/)
    const device = cookies.find((cookie) => cookie.startsWith("inia_device="))!
    expect(device).toMatch(/Path=\/api\/v1\/auth/)
    expect(device).toMatch(/HttpOnly/)
    // Mesmo navegador entrando de novo na mesma conta: o cookie não é trocado.
    const again = await request(app).post("/api/v1/auth/login").set("Cookie", device.split(";")[0]!).send({ email: ACCOUNT.email, password: "Inia@123" })
    expect((again.headers["set-cookie"] as unknown as string[]).some((cookie) => cookie.startsWith("inia_device="))).toBe(false)
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

  it("login: rajada PARALELA de e-mails diferentes não passa inteira pelo teto de recusas do IP (vaga reservada antes)", async () => {
    const app = createApp(fakeDatabase().database, { rateLimits: { loginPerIp: 3 } })
    const statuses = (await Promise.all(Array.from({ length: 12 }, () => request(app).post("/api/v1/auth/login").set("X-Forwarded-For", "203.0.113.40").send({ email: `pessoa-${Math.random()}@inia.com`, password: "errada-123" })))).map((response) => response.status)
    expect(statuses.filter((status) => status === 401)).toHaveLength(3)
    expect(statuses.filter((status) => status === 429)).toHaveLength(9)
  })

  it("login: cada e-mail tem o seu contador no mesmo IP (Citrix/NAT); logins certos não esgotam o teto de recusas do IP", async () => {
    const app = createApp(fakeDatabase().database, { rateLimits: { loginPerIpAndEmail: 2, loginPerIp: 2 } })
    const attempt = (email: string, password: string) => request(app).post("/api/v1/auth/login").set("X-Forwarded-For", "203.0.113.20").send({ email, password })
    // Muitas pessoas entrando certo pelo mesmo IP (o banco falso aceita qualquer e-mail com a senha certa): ninguém é barrado.
    for (let index = 0; index < 5; index += 1) expect((await attempt(`pessoa${index}@inia.com`, "Inia@123")).status).toBe(200)
    // O mesmo e-mail (com outra caixa e espaços) atinge o próprio teto; outro e-mail no mesmo IP continua.
    expect((await attempt(ACCOUNT.email, "Inia@123")).status).toBe(200)
    expect((await attempt(ACCOUNT.email, "Inia@123")).status).toBe(200)
    const sameEmail = await attempt(" Carla.Nunes@inia.com ", "Inia@123")
    expect(sameEmail.status).toBe(429)
    expect(sameEmail.body.error.message).toContain("este e-mail")
    expect((await attempt("outra.pessoa@inia.com", "errada-123")).status).toBe(401)
  })

  it("IP com a porta (padrão do ARR no IIS: X-Forwarded-For 203.0.113.5:54321) conta como o mesmo IP", async () => {
    expect(normalizeClientIp("203.0.113.5:54321")).toBe("203.0.113.5")
    expect(normalizeClientIp("[2001:db8::1]:443")).toBe("2001:db8::1")
    expect(normalizeClientIp("::ffff:127.0.0.1")).toBe("127.0.0.1")
    expect(normalizeClientIp("2001:db8::1")).toBe("2001:db8::1")
    const app = createApp(fakeDatabase().database, { rateLimits: { loginPerIp: 2 } })
    const attempt = (port: number) => request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `203.0.113.30:${port}`).send({ email: `pessoa-${Math.random()}@inia.com`, password: "errada-123" })
    expect((await attempt(50001)).status).toBe(401)
    expect((await attempt(50002)).status).toBe(401)
    expect((await attempt(50003)).status).toBe(429)
  })

  it("balde do limite: regra + hash da chave — nunca IP ou e-mail em claro", () => {
    const bucket = rateLimitBucket("login-ip-email", "203.0.113.20|carla.nunes@inia.com")
    expect(bucket).toMatch(/^login-ip-email:[0-9a-f]{32}$/)
    expect(bucket).not.toContain("carla")
    expect(rateLimitBucket("login-ip-email", "203.0.113.20|carla.nunes@inia.com")).toBe(bucket)
  })

  it("loja indisponível: a requisição passa (o limite nunca derruba o produto) e o aviso vai para o log", async () => {
    const failing = { consume: () => Promise.reject(new Error("banco fora")), check: () => Promise.reject(new Error("banco fora")), record: () => Promise.reject(new Error("banco fora")), release: () => Promise.reject(new Error("banco fora")) }
    const app = createApp(fakeDatabase().database, { rateLimits: { loginPerIpAndEmail: 1, loginPerIp: 1 }, rateLimitStore: failing })
    const login = () => request(app).post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
    expect((await login()).status).toBe(200)
    expect((await login()).status).toBe(200)
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

  it("prévia de documento: teto por conta, nas duas telas (material e administração) e sem contornar pela grafia do caminho", async () => {
    const app = createApp(fakeDatabase().database, { rateLimits: { knowledgePreviewsPerAccount: 2 } })
    const cookie = await loggedInCookie(app)
    const id = "33333333-3333-4333-8333-333333333333"
    expect((await request(app).get(`/api/v1/knowledge-materials/${id}/preview`).set("Cookie", cookie)).status).not.toBe(429)
    expect((await request(app).get(`/api/v1/KNOWLEDGE-MATERIALS/${id}/Preview/`).set("Cookie", cookie)).status).not.toBe(429)
    expect((await request(app).get(`/api/v1/knowledge-materials/${id}/preview`).set("Cookie", cookie)).status).toBe(429)
    expect((await request(app).get(`/api/v1/knowledge-materials/${id}`).set("Cookie", cookie)).status).not.toBe(429)
  })

  it("leituras pesadas fora do chat (liderança e exportação do diagnóstico): um teto por conta para as duas, e o resto da área não conta", async () => {
    const app = createApp(fakeDatabase().database, { rateLimits: { heavyReadsPerAccount: 3 } })
    const cookie = await loggedInCookie(app)
    expect((await request(app).post("/api/v1/leadership/query").set("Cookie", cookie).send({})).status).not.toBe(429)
    expect((await request(app).post("/api/v1/LEADERSHIP/tools/leadership_people/").set("Cookie", cookie).send({})).status).not.toBe(429)
    expect((await request(app).get("/api/v1/diagnostics/memory/export.csv").set("Cookie", cookie)).status).not.toBe(429)
    expect((await request(app).get("/api/v1/diagnostics/memory/export.csv").set("Cookie", cookie)).status).toBe(429)
    expect((await request(app).post("/api/v1/leadership/query").set("Cookie", cookie).send({})).status).toBe(429)
    expect((await request(app).get("/api/v1/leadership/home").set("Cookie", cookie)).status).not.toBe(429)
    expect((await request(app).get("/api/v1/diagnostics/memory/summary").set("Cookie", cookie)).status).not.toBe(429)
  })

  it("limites por caminho não se contornam com maiúsculas nem barra final (o Express casa a mesma rota)", async () => {
    const app = createApp(fakeDatabase().database, { rateLimits: { adminCostlyActionsPerAccount: 1, voiceSessionsPerAccount: 1, aiInteractivePerAccount: 1000 } })
    const cookie = await loggedInCookie(app)
    const agentId = "22222222-2222-4222-8222-222222222222"
    expect((await request(app).post(`/api/v1/admin/agents/${agentId}/test`).set("Cookie", cookie).send({})).status).not.toBe(429)
    for (const variant of [`/api/v1/admin/agents/${agentId}/TEST`, `/api/v1/admin/agents/${agentId}/test/`, `/API/V1/ADMIN/AGENTS/${agentId}/Test`]) {
      expect((await request(app).post(variant).set("Cookie", cookie).send({})).status).toBe(429)
    }
    expect((await request(app).post("/api/v1/realtime/sessions").set("Cookie", cookie).send({})).status).not.toBe(429)
    expect((await request(app).post("/api/v1/realtime/SESSIONS/").set("Cookie", cookie).send({})).status).toBe(429)
  })

  it("voz: além do teto por minuto, um teto de sessões por meia hora limita as sessões Live vivas da mesma conta", async () => {
    const app = createApp(fakeDatabase().database, { rateLimits: { voiceSessionsPerAccount: 100, voiceSessionsPerAccountHalfHour: 2, aiInteractivePerAccount: 1000 } })
    const cookie = await loggedInCookie(app)
    const open = () => request(app).post("/api/v1/realtime/sessions").set("Cookie", cookie).send({})
    expect((await open()).status).not.toBe(429)
    expect((await open()).status).not.toBe(429)
    const blocked = await open()
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.message).toContain("meia hora")
  })

  it("reports: nova tentativa da análise de IA e \"Executar agora\" entram no teto das ações caras por conta", async () => {
    const app = createApp(fakeDatabase().database, { rateLimits: { adminCostlyActionsPerAccount: 2 } })
    const cookie = await loggedInCookie(app)
    const delivery = "44444444-4444-4444-8444-444444444444"
    const retry = () => request(app).post(`/api/v1/reports/deliveries/${delivery}/analysis/retry`).set("Cookie", cookie).send({})
    expect((await retry()).status).not.toBe(429)
    expect((await request(app).post(`/api/v1/reports/${delivery}/run`).set("Cookie", cookie).send({})).status).not.toBe(429)
    expect((await retry()).status).toBe(429)
  })

  it("áudio de recado/apresentação conta no teto de IA por conta mesmo com o caminho em maiúsculas", async () => {
    const app = createApp(fakeDatabase().database, { rateLimits: { aiInteractivePerAccount: 1 } })
    const cookie = await loggedInCookie(app)
    const deliveryId = "33333333-3333-4333-8333-333333333333"
    expect((await request(app).get(`/api/v1/inia-deliveries/avatar/${deliveryId}/audio`).set("Cookie", cookie)).status).not.toBe(429)
    expect((await request(app).get(`/api/v1/inia-deliveries/Avatar/${deliveryId}/AUDIO/`).set("Cookie", cookie)).status).toBe(429)
  })

  it("primeiro acesso: o teto é por sessão (centenas de pessoas atrás do mesmo IP criam a senha); sem cookie não gasta o de ninguém", async () => {
    const app = createApp(fakeDatabase().database, { rateLimits: { firstPasswordPerSession: 2, firstPasswordPerIp: 1000 } })
    const first = await loggedInCookie(app)
    const second = await loggedInCookie(app)
    const create = (cookie?: string) => {
      const call = request(app).post("/api/v1/auth/password").set("X-Forwarded-For", "203.0.113.50")
      return (cookie ? call.set("Cookie", cookie) : call).send({ newPassword: "Nova-Senha-2026", confirmPassword: "Nova-Senha-2026" })
    }
    for (let index = 0; index < 5; index += 1) expect((await create()).status).not.toBe(429)
    expect((await create(first)).status).not.toBe(429)
    expect((await create(first)).status).not.toBe(429)
    expect((await create(first)).status).toBe(429)
    expect((await create(second)).status).not.toBe(429)
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
    const limiter = createRateLimiter({ name: "t", windowMs: 1000, max: 2, key: () => "k" }, createMemoryRateLimitStore(() => now))
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
    for (const everyone of ["0.0.0.0/0", "loopback, ::/0", " 0.0.0.0/0 "]) expect(envSchema.shape.TRUST_PROXY.safeParse(everyone).success, everyone).toBe(false)
    expect(envSchema.shape.TRUST_PROXY.safeParse("loopback, 10.20.0.0/16").success).toBe(true)
    expect(envSchema.shape.TRUST_PROXY.parse(undefined)).toBe("loopback")
    expect(envSchema.shape.SESSION_COOKIE_SECURE.parse(undefined)).toBe("auto")
  })

  it("segredos de produção: valor de exemplo/curto/repetitivo do JWT recusa a subida; chave de cifra fraca só avisa", () => {
    const generated = { JWT_SECRET: "9f".repeat(4) + "0123456789abcdef".repeat(5), DATA_HUB_SECRET_KEY: "ab12cd34".repeat(8) }
    expect(productionSecretProblems({ NODE_ENV: "production", ...generated })).toEqual({ fatal: [], warnings: [] })
    expect(productionSecretProblems({ NODE_ENV: "development", JWT_SECRET: "inia-dev-secret-change-me", DATA_HUB_SECRET_KEY: undefined }).fatal).toEqual([])
    for (const JWT_SECRET of ["troque-por-um-valor-aleatorio-longo", "inia-dev-secret-change-me", "curto-demais", "a".repeat(64), "abababababababababababababababab12"]) {
      expect(productionSecretProblems({ NODE_ENV: "production", JWT_SECRET, DATA_HUB_SECRET_KEY: generated.DATA_HUB_SECRET_KEY }).fatal, JWT_SECRET).toHaveLength(1)
    }
    expect(productionSecretProblems({ NODE_ENV: "production", JWT_SECRET: generated.JWT_SECRET, DATA_HUB_SECRET_KEY: undefined }).fatal).toHaveLength(1)
    const weakKey = productionSecretProblems({ NODE_ENV: "production", JWT_SECRET: generated.JWT_SECRET, DATA_HUB_SECRET_KEY: "inia" })
    expect(weakKey.fatal).toEqual([])
    expect(weakKey.warnings).toHaveLength(1)
  })

  it("origens em produção (R-33): sem CORS_ORIGIN, com curinga ou com caminho a API não sobe; fora de produção vale o padrão de desenvolvimento", () => {
    expect(productionOriginProblems({ NODE_ENV: "development", CORS_ORIGIN: undefined })).toEqual([])
    expect(productionOriginProblems({ NODE_ENV: "production", CORS_ORIGIN: undefined })).toHaveLength(1)
    for (const valid of ["https://inia.empresa.com.br", "https://inia.empresa.com.br/", "http://10.0.0.5:8080", "https://a.empresa.com, https://b.empresa.com"]) {
      expect(productionOriginProblems({ NODE_ENV: "production", CORS_ORIGIN: valid }), valid).toEqual([])
    }
    for (const invalid of ["*", "https://*.empresa.com", "https://inia.empresa.com/app", "inia.empresa.com", "ftp://inia.empresa.com", "https://ok.empresa.com, *"]) {
      expect(productionOriginProblems({ NODE_ENV: "production", CORS_ORIGIN: invalid }), invalid).toHaveLength(1)
    }
    expect(envSchema.shape.SESSION_IDLE_TIMEOUT_MINUTES.parse(undefined)).toBe(30)
  })
})

describe("erros do banco provocados pela entrada viram 4xx (ZAP, auditoria AppSec 29/10/2026)", () => {
  // O PostgreSQL recusa byte nulo em texto (22021) — o fake reproduz isso para qualquer parâmetro.
  const nulRejected = (_sql: string, params: unknown[]) => (params.some((value) => typeof value === "string" && value.includes("\u0000")) ? { severity: "ERROR", code: "22021" } : undefined)

  it("byte nulo num parâmetro de caminho: 400 genérico, sem a mensagem do banco", async () => {
    const app = createApp(fakeDatabase({}, nulRejected).database)
    const cookie = await loggedInCookie(app)
    const response = await request(app).get("/api/v1/admin/agents/x%00y").set("Cookie", cookie)
    expect(response.status).toBe(400)
    expect(response.body.error).toEqual({ code: "INVALID_CHARACTER", message: "Valor com caractere inválido.", reference: response.headers["x-request-id"] })
  })

  it("assunto com nome repetido: 409 com a mensagem do catálogo (antes 500)", async () => {
    const duplicate = (sql: string) => (sql.includes("insert into subjects") ? { severity: "ERROR", code: "23505" } : undefined)
    const app = createApp(fakeDatabase({}, duplicate).database)
    const cookie = await loggedInCookie(app)
    const response = await request(app).post("/api/v1/admin/org-structure/subjects").set("Cookie", cookie).set("Origin", ALLOWED_ORIGIN).send({ name: "Fatura" })
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe("SUBJECT_NAME_TAKEN")
  })

  it("nova base de conhecimento sem corpo multipart/JSON: 400 de validação (antes TypeError e 500)", async () => {
    const app = createApp(fakeDatabase().database)
    const cookie = await loggedInCookie(app)
    const response = await request(app).post("/api/v1/admin/knowledge").set("Cookie", cookie).set("Origin", ALLOWED_ORIGIN).set("Content-Type", "text/plain").send("zap")
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe("VALIDATION_ERROR")
  })

  it("mapeamento: 22021/22P05 → 400, 23505 → 409; erro sem `severity` (não veio do PostgreSQL) continua 500", () => {
    expect(describeClientError({ severity: "ERROR", code: "22021" })?.status).toBe(400)
    expect(describeClientError({ severity: "ERROR", code: "22P05" })?.status).toBe(400)
    expect(describeClientError({ severity: "ERROR", code: "23505" })).toEqual({ status: 409, code: "DUPLICATE_RECORD", message: "Já existe um registro com esses dados." })
    expect(describeClientError({ code: "23505" })).toBeNull()
  })
})
