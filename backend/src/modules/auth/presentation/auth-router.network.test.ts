import cookieParser from "cookie-parser"
import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { ZodError } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DOMAIN_ERROR_CODES } from "../../../shared/domain/errors/domain-error-codes.generated.js"
import { LOGIN_LOCKED, LOGIN_REFUSALS, createAuthRouter } from "./auth-router.js"
import type { DirectoryAuthenticator } from "../application/directory-authenticator.js"
import type { DirectoryVerdict } from "../domain/network-login.js"
import { NETWORK_CREDENTIAL_ERRORS } from "../../feedback-application/application/read-confirmation-service.js"

/** `/auth/login-options` e as recusas do `/auth/login` pela matrícula (achado QA-10 da run-9), com banco e AD falsos. */
const ORG = "00000000-0000-4000-8000-000000000001"
const ACCOUNT_ROW = {
  id: "11111111-1111-4111-8111-111111111111", organization_id: ORG, person_id: "00000000-0000-4000-8000-000000000032", name: "Larissa", role: "OPERATOR", email: "larissa@inia.local",
  password_hash: "x", active: true, session_version: 0, password_change_required: false, temporary_password_expires_at: null, person_active: true,
  avatar_url: null, job_title: null, team_id: null, team_name: null, matricula: "G0055350", network_login_enabled: true, emergency_local_access: false,
}

function fakeDatabase(options: { anyEnabled?: boolean; failures?: number } = {}) {
  const attempts: { id: number; outcome: string; at: Date }[] = Array.from({ length: options.failures ?? 0 }, (_, index) => ({ id: index + 1, outcome: "INVALID_CREDENTIALS", at: new Date(Date.now() - (index + 1) * 60_000) }))
  const database = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("from organizations where network_login_enabled")) return { rows: [{ on: options.anyEnabled ?? true }], rowCount: 1 }
      if (sql.includes("upper(btrim(p.matricula)) = $1")) return { rows: params[0] === "G0055350" ? [ACCOUNT_ROW] : [], rowCount: 0 }
      if (sql.includes("insert into auth_login_attempts") && sql.includes("returning id")) {
        const id = attempts.length + 1
        attempts.push({ id, outcome: "INVALID_CREDENTIALS", at: params[1] as Date })
        return { rows: [{ id }], rowCount: 1 }
      }
      if (sql.includes("select attempted_at from auth_login_attempts")) {
        const rows = attempts.filter((entry) => entry.outcome === "INVALID_CREDENTIALS" && String(entry.id) !== String(params[2])).map((entry) => ({ attempted_at: entry.at })).sort((a, b) => b.attempted_at.getTime() - a.attempted_at.getTime())
        return { rows, rowCount: rows.length }
      }
      if (sql.includes("update auth_login_attempts set outcome")) {
        const entry = attempts.find((candidate) => String(candidate.id) === String(params[0]))
        if (entry) entry.outcome = String(params[1])
        return { rows: [], rowCount: entry ? 1 : 0 }
      }
      return { rows: [], rowCount: 0 }
    },
  } as unknown as Database
  return { database, attempts }
}

function directoryAnswering(verdict: DirectoryVerdict, configured = true): DirectoryAuthenticator {
  return { configured, domain: "empresa.local", async verify() { return verdict }, async probe() { return [] } }
}

const errors: ErrorRequestHandler = (error, _request, response, next) => {
  void next
  if (error instanceof ZodError) return void response.status(400).json({ error: { code: "VALIDATION_ERROR" } })
  response.status(500).json({ error: { code: "INTERNAL_ERROR", message: String(error) } })
}

function appWith(directory: DirectoryAuthenticator, options: { anyEnabled?: boolean; failures?: number } = {}) {
  const fake = fakeDatabase(options)
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use("/auth", createAuthRouter(fake.database, { directory, networkLoginMinimumMs: 0, cookieSecure: false }))
  app.use(errors)
  return { app, ...fake }
}

describe("GET /auth/login-options", () => {
  it("matrícula só com o AD configurado E alguma organização com o login pela rede ligado; sem cache", async () => {
    const on = await request(appWith(directoryAnswering({ kind: "OK" })).app).get("/auth/login-options")
    expect(on.status).toBe(200)
    expect(on.headers["cache-control"]).toBe("no-store")
    expect(on.body).toEqual({ data: { networkLogin: true } })
    expect((await request(appWith(directoryAnswering({ kind: "OK" }), { anyEnabled: false }).app).get("/auth/login-options")).body.data.networkLogin).toBe(false)
    expect((await request(appWith(directoryAnswering({ kind: "OK" }, false)).app).get("/auth/login-options")).body.data.networkLogin).toBe(false)
  })
})

describe("POST /auth/login pela matrícula", () => {
  const login = (app: express.Express, body: object = { matricula: "g0055350", password: "Rede#2026" }) => request(app).post("/auth/login").send(body)

  it("senha de rede certa entra e grava o cookie de sessão", async () => {
    const response = await login(appWith(directoryAnswering({ kind: "OK" })).app)
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ email: "larissa@inia.local" })
    expect(String(response.headers["set-cookie"])).toContain("inia_session=")
  })

  it.each([
    [{ kind: "INVALID" }, 401, "INVALID_CREDENTIALS", "peça ao administrador da INIA para conferir se o seu acesso está habilitado"],
    [{ kind: "PASSWORD_EXPIRED" }, 403, "NETWORK_PASSWORD_EXPIRED", "senha de rede venceu"],
    [{ kind: "ACCOUNT_LOCKED" }, 403, "NETWORK_ACCOUNT_LOCKED", "conta de rede está bloqueada"],
    [{ kind: "ACCOUNT_DISABLED" }, 403, "NETWORK_ACCOUNT_DISABLED", "conta de rede está desativada"],
    [{ kind: "UNAVAILABLE", reason: "timeout" }, 503, "NETWORK_LOGIN_UNAVAILABLE", "indisponível"],
  ] as const)("veredito do AD %o → %i %s", async (verdict, status, code, message) => {
    const response = await login(appWith(directoryAnswering(verdict)).app)
    expect(response.status).toBe(status)
    expect(response.body.error.code).toBe(code)
    expect(response.body.error.message).toContain(message)
    expect(JSON.stringify(response.body)).not.toContain("Rede#2026")
  })

  it("matrícula sem conta: a mesma resposta da senha errada (sem revelar quem tem conta)", async () => {
    const response = await login(appWith(directoryAnswering({ kind: "OK" })).app, { matricula: "R0099999", password: "Rede#2026" })
    expect(response.status).toBe(401)
    expect(response.body.error).toEqual({ code: "INVALID_CREDENTIALS", message: LOGIN_REFUSALS.INVALID_NETWORK_CREDENTIALS.message })
  })

  it("matrícula travada: 429 com o horário e o aviso de que insistir bloqueia a conta de rede", async () => {
    const response = await login(appWith(directoryAnswering({ kind: "OK" }), { failures: 3 }).app)
    expect(response.status).toBe(429)
    expect(response.body.error.code).toBe("LOGIN_TOO_MANY_ATTEMPTS")
    expect(response.body.error.message).toBe(LOGIN_LOCKED.NETWORK.message)
    expect(Number.isNaN(Date.parse(response.body.error.details.retryAt))).toBe(false)
  })

  it("corpo com e-mail E matrícula, ou com campo a mais, é recusado (400)", async () => {
    const { app } = appWith(directoryAnswering({ kind: "OK" }))
    expect((await login(app, { email: "larissa@inia.local", matricula: "G0055350", password: "x" })).status).toBe(400)
    expect((await login(app, { matricula: "G0055350", password: "x", extra: true })).status).toBe(400)
  })
})

describe("catálogo de erros (achado ARQ-01 da run-9)", () => {
  it("todo código que o login e a ciência pela rede devolvem está no catálogo, com mensagem", () => {
    const catalog = new Map(DOMAIN_ERROR_CODES.map((entry) => [entry.code, entry]))
    const returned = [...Object.values(LOGIN_REFUSALS), ...Object.values(LOGIN_LOCKED), ...Object.values(NETWORK_CREDENTIAL_ERRORS)]
    for (const refusal of returned) {
      const entry = catalog.get(refusal.code)
      expect(entry, refusal.code).toBeDefined()
      expect(entry!.messages.length, refusal.code).toBeGreaterThan(0)
      expect(entry!.statuses, refusal.code).toContain(refusal.status)
    }
    for (const code of ["NETWORK_LOGIN_AMBIGUOUS_MATRICULA", "READ_CONFIRMATION_ACCOUNT_CHANGED"]) expect(catalog.has(code), code).toBe(true)
  })
})
