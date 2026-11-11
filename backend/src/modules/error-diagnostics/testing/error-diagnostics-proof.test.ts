/**
 * Diagnóstico de erros — prova contra o banco de teste real (migration 187):
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run error-diagnostics-proof
 *
 * Prova: (1) usuário comum chamando a API direto recebe 403 (catálogo e ocorrência), com a mensagem pública e a referência;
 * (2) o Administrador geral lê o código e a ocorrência pela referência que a tela mostraria; (3) ocorrência de OUTRA organização
 * nunca aparece; (4) o navegador registra uma falha sem sessão (201 = confirmado) e o administrador a encontra; (5) nada de dado
 * pessoal no que fica gravado.
 */
import { randomUUID } from "node:crypto"
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { createOccurrenceRecorder, registerOccurrenceRecorder } from "../application/occurrence-recorder.js"
import { insertOccurrence } from "../infrastructure/pg-error-occurrence-store.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = randomUUID()
const ORG2 = randomUUID()
const PASSWORD = "Ipe-Roxo-Prova-Erros-2026"
let pool: pg.Pool
const ids: Record<string, string> = {}
const email: Record<string, string> = {}
const accounts: string[] = []
const references: string[] = []
const sql = (text: string, values: unknown[] = []) => pool.query(text, values)
const startedAt = new Date()
const settle = () => new Promise((resolve) => setTimeout(resolve, 150))

async function personWithAccount(key: string, organizationId: string, role: string | null) {
  ids[key] = (await sql(`insert into people (organization_id, name, role, active) values ($1, $2, 'OPERATOR', true) returning id`, [organizationId, `Prova Erros ${key}`])).rows[0].id
  email[key] = `${key.toLowerCase()}.${ids[key]!.slice(0, 8)}@prova-erros.inia.local`
  const id = (await sql(`insert into user_accounts (organization_id, person_id, email, password_hash, active, password_change_required) values ($1, $2, $3, $4, true, false) returning id`, [organizationId, ids[key], email[key], await hashPassword(PASSWORD)])).rows[0].id as string
  accounts.push(id)
  if (role) await sql(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, $3, 'ORGANIZATION', now())`, [organizationId, id, role])
}

describe.skipIf(!ENABLED)("Diagnóstico de erros — prova Postgres", () => {
  let app: ReturnType<typeof createApp>
  const origin = () => env.allowedOrigins[0]!
  const login = async (key: string) => {
    const agent = request.agent(app)
    expect((await agent.post("/api/v1/auth/login").set("Origin", origin()).send({ email: email[key], password: PASSWORD })).status).toBe(200)
    return agent
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 4 })
    for (const [organizationId, name] of [[ORG, "Prova Erros"], [ORG2, "Prova Erros 2"]] as const) {
      await sql(`insert into organizations (id, name, slug) values ($1, $2, $3)`, [organizationId, name, `prova-erros-${organizationId.slice(0, 8)}`])
    }
    await personWithAccount("ADMIN", ORG, "ADMINISTRADOR_GERAL")
    await personWithAccount("PLAIN", ORG, null)
    registerOccurrenceRecorder(createOccurrenceRecorder(pool))
    app = createApp(pool, { rateLimits: false })
  })

  afterAll(async () => {
    if (!pool) return
    registerOccurrenceRecorder(null)
    // Inclusive as que esta prova provocou sem guardar a referência (401 sem sessão, 400 do corpo inválido).
    await sql(`delete from error_occurrences where reference = any($1) or organization_id = any($2) or (occurred_at >= $3 and (route like '% /api/v1/client-errors%' or route like '% /api/v1/admin/error-diagnostics%'))`, [references, [ORG, ORG2], startedAt])
    await sql(`delete from auth_login_attempts where account_id = any($1)`, [accounts]).catch(() => undefined)
    await sql(`delete from user_sessions where account_id = any($1)`, [accounts]).catch(() => undefined)
    await sql(`delete from access_role_assignments where organization_id = any($1)`, [[ORG, ORG2]])
    await sql(`delete from user_accounts where organization_id = any($1)`, [[ORG, ORG2]]).catch((error: unknown) => console.error("limpeza user_accounts:", (error as Error).message))
    await sql(`delete from people where organization_id = any($1)`, [[ORG, ORG2]]).catch(() => undefined)
    for (const organizationId of [ORG, ORG2]) await sql(`delete from organizations where id = $1`, [organizationId]).catch((error: unknown) => console.error("limpeza organizations:", (error as Error).message))
    await pool.end()
  }, 60_000)

  it("usuário comum, chamando a API direto: 403 no catálogo e na ocorrência, com mensagem pública e referência", async () => {
    const plain = await login("PLAIN")
    for (const path of ["/api/v1/admin/error-diagnostics/codes?q=BANCO", "/api/v1/admin/error-diagnostics/codes/INIA-BANCO-INDISPONIVEL", `/api/v1/admin/error-diagnostics/occurrences/${randomUUID()}`]) {
      const response = await plain.get(path)
      expect(response.status).toBe(403)
      expect(response.body.error).toMatchObject({ code: "FORBIDDEN", message: "Você não tem permissão para este recurso." })
      expect(response.body.error.reference).toBe(response.headers["x-request-id"])
      expect(JSON.stringify(response.body)).not.toMatch(/probableCauses|Select-String/)
      references.push(response.body.error.reference)
    }
    expect((await plain.get("/api/v1/auth/me")).body.data.access.capabilities.canViewErrorDiagnostics).toBe(false)
    // Sem sessão: 401.
    expect((await request(app).get("/api/v1/admin/error-diagnostics/codes")).status).toBe(401)
  })

  it("incidente completo: a falha vira ocorrência; o administrador acha pela referência e lê o código", async () => {
    const plain = await login("PLAIN")
    // Uma falha real: o usuário comum tenta abrir o catálogo → 403 FORBIDDEN, registrada pela API com a referência da tela.
    const reference = `prova-${randomUUID()}`
    references.push(reference)
    const failed = await plain.get("/api/v1/admin/error-diagnostics/codes/INIA-BANCO-INDISPONIVEL").set("x-request-id", reference)
    expect(failed.status).toBe(403)
    await settle()
    const admin = await login("ADMIN")
    expect((await admin.get("/api/v1/auth/me")).body.data.access.capabilities.canViewErrorDiagnostics).toBe(true)
    const found = await admin.get(`/api/v1/admin/error-diagnostics/occurrences/${reference}`)
    expect(found.status).toBe(200)
    expect(found.body.data.occurrences).toEqual([
      expect.objectContaining({ reference, code: "FORBIDDEN", source: "API", httpStatus: 403, route: "GET /api/v1/admin/error-diagnostics/codes/INIA-BANCO-INDISPONIVEL", authenticated: true, service: "inia-api" }),
    ])
    expect(found.body.data.explanations.FORBIDDEN).toMatchObject({ kind: "ENTRY", entry: { code: "FORBIDDEN", probableCauses: expect.any(Array) } })
    const code = await admin.get("/api/v1/admin/error-diagnostics/codes/inia-dados-timeout")
    expect(code.status).toBe(200)
    expect(code.body.data.explanation).toMatchObject({ kind: "ENTRY", viaAlias: true, entry: { code: "DATA_SOURCE_TIMEOUT" } })
    const byCode = await admin.get("/api/v1/admin/error-diagnostics/codes/FORBIDDEN")
    expect(byCode.body.data.occurrences.recent.some((occurrence: { reference: string }) => occurrence.reference === reference)).toBe(true)
    expect((await admin.get("/api/v1/admin/error-diagnostics/codes/NAO_EXISTE_XYZ")).status).toBe(404)
    expect((await admin.get("/api/v1/admin/error-diagnostics/occurrences/a b")).status).toBe(400)
  })

  it("ocorrência de outra organização nunca aparece", async () => {
    const reference = `outra-org-${randomUUID()}`
    references.push(reference)
    await insertOccurrence(pool, { reference, code: "INTERNAL_ERROR", source: "API", httpStatus: 500, severity: "error", organizationId: ORG2, authenticated: true })
    const admin = await login("ADMIN")
    expect((await admin.get(`/api/v1/admin/error-diagnostics/occurrences/${reference}`)).body.data.occurrences).toEqual([])
  })

  it("navegador registra sem sessão (201 só depois de gravar); código fora da lista do navegador vira o de renderização; texto sanitizado", async () => {
    const reference = `web-${randomUUID()}`
    references.push(reference)
    const response = await request(app).post("/api/v1/client-errors").set("Origin", origin()).send({ reference, code: "INIA-REDE-SEM-CONEXAO", route: "/operator/3f2b8c1a-1111-2222-3333-444455556666?cpf=1", httpStatus: null, online: false, message: "falhou para ana.souza@empresa.com token=abc" })
    expect(response.status).toBe(201)
    expect(response.body.data).toEqual({ reference, recorded: true })
    // Repetir não duplica.
    expect((await request(app).post("/api/v1/client-errors").set("Origin", origin()).send({ reference, code: "INIA-REDE-SEM-CONEXAO", route: "/x" })).status).toBe(201)
    const forged = `web-${randomUUID()}`
    references.push(forged)
    await request(app).post("/api/v1/client-errors").set("Origin", origin()).send({ reference: forged, code: "INTERNAL_ERROR", route: "/x" }).expect(201)
    expect((await request(app).post("/api/v1/client-errors").set("Origin", origin()).send({ reference: "x", code: "Y", route: "/" })).status).toBe(400)
    expect((await request(app).post("/api/v1/client-errors").set("Origin", origin()).send({ reference: `web-${randomUUID()}`, code: "X", route: "/", extra: 1 })).status).toBe(400)
    const rows = (await sql(`select code, source, route, authenticated, organization_id, details from error_occurrences where reference = any($1) order by code`, [[reference, forged]])).rows
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.code === "INIA-REDE-SEM-CONEXAO")).toMatchObject({ source: "CLIENT", route: "/operator/:id", authenticated: false, organization_id: null })
    expect(rows.find((row) => row.code === "INIA-INTERFACE-RENDERIZACAO")?.details).toMatchObject({ reportedCode: "INTERNAL_ERROR" })
    expect(JSON.stringify(rows)).not.toMatch(/ana\.souza|abc|cpf/)
    // Sem organização = visível para quem administra a organização inteira (tela de login, rede).
    const admin = await login("ADMIN")
    expect((await admin.get(`/api/v1/admin/error-diagnostics/occurrences/${reference}`)).body.data.occurrences).toHaveLength(1)
  })
})
