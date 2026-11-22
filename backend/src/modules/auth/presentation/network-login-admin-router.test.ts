import cookieParser from "cookie-parser"
import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { ZodError } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { legacyAccessQuery } from "../../access/testing/legacy-admin-fixture.js"
import type { DirectoryAuthenticator } from "../application/directory-authenticator.js"
import { issueSessionToken, sessionPayloadOf } from "../infrastructure/jwt.js"
import { createNetworkLoginAdminRouter } from "./network-login-admin-router.js"
import { SESSION_COOKIE_NAME } from "./session-cookie.js"

/** Rota admin do login pela rede (achado QA-10 da run-9): GET, conferência dos servidores e cada bloqueio do PUT. */
const ORG = "00000000-0000-4000-8000-000000000001"
const ACCOUNT = { id: "11111111-1111-4111-8111-111111111111", personId: "00000000-0000-4000-8000-000000000032" }

type Fixture = { role?: string; legacy?: { scope_type: string; team_id: string | null; subteam_id: string | null }[]; emergency?: { active: boolean }[]; ambiguous?: string[]; enabled?: boolean }

function fakeDatabase(fixture: Fixture = {}) {
  const queries: { sql: string; params: unknown[] }[] = []
  const state = { enabled: fixture.enabled ?? false, audits: 0 }
  const database = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params })
      const access = legacyAccessQuery(sql, fixture.role ?? "ADMIN", fixture.legacy ?? [])
      if (access) return access
      if (sql.includes("from user_accounts ua") && sql.includes("emergency_local_access")) {
        return { rows: (fixture.emergency ?? []).map((account, index) => ({ account_id: `acc-${index}`, name: `Admin ${index}`, email: `admin${index}@inia.local`, active: account.active, last_login_at: null })), rowCount: 0 }
      }
      if (sql.includes("having count(*) > 1")) return { rows: (fixture.ambiguous ?? []).map((matricula) => ({ matricula, accounts: "2" })), rowCount: 0 }
      if (sql.includes("from organizations o left join people p")) return { rows: [{ network_login_enabled: state.enabled, network_login_changed_at: null, changed_by: null }], rowCount: 1 }
      if (sql.includes("update organizations set network_login_enabled")) {
        if (state.enabled !== params[1]) {
          state.enabled = params[1] as boolean
          state.audits += 1
        }
        return { rows: [], rowCount: 1 }
      }
      if (sql.includes("from user_accounts ua")) return { rows: [{ active: true, session_version: 0, password_change_required: false, temporary_password_expires_at: null, person_active: true, session_revoked: false }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    },
  } as unknown as Database
  return { database, queries, state }
}

function fakeDirectory(configured = true): DirectoryAuthenticator & { probes: number } {
  const directory = {
    configured,
    domain: configured ? "empresa.local" : null,
    probes: 0,
    async verify() { return { kind: "INVALID" as const } },
    async probe() {
      directory.probes += 1
      return [{ url: "ldaps://dc1.empresa.local:636", reachable: true, trusted: true, keyBits: 2048, validUntil: "2027-04-01T00:00:00.000Z", error: null }]
    },
  }
  return directory
}

const errors: ErrorRequestHandler = (error, _request, response, next) => {
  void next
  if (error instanceof DomainError) return void response.status(error.statusCode).json({ error: { code: error.code, message: error.message, details: error.details } })
  if (error instanceof ZodError) return void response.status(400).json({ error: { code: "VALIDATION_ERROR" } })
  response.status(500).json({ error: { code: "INTERNAL_ERROR", message: String(error) } })
}

function appWith(fixture: Fixture = {}, options: { configured?: boolean; httpsRequired?: boolean } = {}) {
  const fake = fakeDatabase(fixture)
  const directory = fakeDirectory(options.configured ?? true)
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use("/admin/network-login", createNetworkLoginAdminRouter(fake.database, { directory, httpsRequired: options.httpsRequired ?? false, servers: ["ldaps://dc1.empresa.local:636"] }))
  app.use(errors)
  const session = issueSessionToken(sessionPayloadOf({ personId: ACCOUNT.personId, name: "Carla", role: "ADMIN", email: "carla@inia.local", avatarUrl: null, jobTitle: null, teamId: null, teamName: null, sub: ACCOUNT.id, organizationId: ORG }, { sv: 0, pc: false }))
  const cookie = `${SESSION_COOKIE_NAME}=${session.token}`
  return { app, cookie, directory, ...fake }
}

describe("/admin/network-login", () => {
  it("GET mostra a situação, as contas de emergência e as matrículas repetidas", async () => {
    const { app, cookie } = appWith({ emergency: [{ active: true }], ambiguous: ["G0055350"] })
    const response = await request(app).get("/admin/network-login").set("Cookie", cookie)
    expect(response.status).toBe(200)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.body.data).toMatchObject({ configured: true, domain: "empresa.local", servers: ["ldaps://dc1.empresa.local:636"], enabled: false, maxFailures: 3, emergencyAccounts: [{ accountId: "acc-0", active: true }], ambiguousMatriculas: [{ matricula: "G0055350", accounts: 2 }] })
  })

  it("administrador de um Grupo (não da organização inteira) não vê nem muda: 403", async () => {
    const { app, cookie, state } = appWith({ legacy: [{ scope_type: "TEAM", team_id: "00000000-0000-4000-8000-0000000000t1", subteam_id: null }], emergency: [{ active: true }] })
    expect((await request(app).get("/admin/network-login").set("Cookie", cookie)).status).toBe(403)
    expect((await request(app).put("/admin/network-login").set("Cookie", cookie).send({ enabled: true })).status).toBe(403)
    expect(state.enabled).toBe(false)
  })

  it("probe confere os servidores (sem senha); sem AD configurado = 409", async () => {
    const configured = appWith()
    const response = await request(configured.app).post("/admin/network-login/probe").set("Cookie", configured.cookie)
    expect(response.status).toBe(200)
    expect(response.body.data.servers[0]).toMatchObject({ reachable: true, keyBits: 2048 })
    expect(configured.directory.probes).toBe(1)
    const unconfigured = appWith({}, { configured: false })
    const refused = await request(unconfigured.app).post("/admin/network-login/probe").set("Cookie", unconfigured.cookie)
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe("NETWORK_LOGIN_NOT_CONFIGURED")
  })

  it.each([
    ["sem AD configurado", { emergency: [{ active: true }] }, { configured: false }, "NETWORK_LOGIN_NOT_CONFIGURED"],
    ["sem HTTPS em produção", { emergency: [{ active: true }] }, { httpsRequired: true }, "NETWORK_LOGIN_HTTPS_REQUIRED"],
    ["sem conta de emergência", { emergency: [] }, {}, "NETWORK_LOGIN_EMERGENCY_ACCOUNT_REQUIRED"],
    ["só com conta de emergência desabilitada", { emergency: [{ active: false }] }, {}, "NETWORK_LOGIN_EMERGENCY_ACCOUNT_REQUIRED"],
    ["com matrícula repetida por maiúscula/espaço", { emergency: [{ active: true }], ambiguous: ["G0055350"] }, {}, "NETWORK_LOGIN_AMBIGUOUS_MATRICULA"],
  ] as const)("PUT ligar %s = 409 e nada muda", async (_label, fixture, options, code) => {
    const { app, cookie, state } = appWith(fixture as unknown as Fixture, options)
    const response = await request(app).put("/admin/network-login").set("Cookie", cookie).send({ enabled: true })
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe(code)
    expect(state.enabled).toBe(false)
    expect(state.audits).toBe(0)
  })

  it("matrícula repetida: o 409 lista as matrículas", async () => {
    const { app, cookie } = appWith({ emergency: [{ active: true }], ambiguous: ["G0055350", "SP0000001"] })
    const response = await request(app).put("/admin/network-login").set("Cookie", cookie).send({ enabled: true })
    expect(response.body.error.details).toEqual({ matriculas: ["G0055350", "SP0000001"] })
  })

  it("PUT liga com tudo em ordem e audita só quando muda; desligar nunca é bloqueado", async () => {
    const { app, cookie, state, queries } = appWith({ emergency: [{ active: true }] })
    const on = await request(app).put("/admin/network-login").set("Cookie", cookie).send({ enabled: true })
    expect(on.status).toBe(200)
    expect(on.body.data.enabled).toBe(true)
    await request(app).put("/admin/network-login").set("Cookie", cookie).send({ enabled: true })
    expect(state.audits).toBe(1)
    const update = queries.find((query) => query.sql.includes("update organizations set network_login_enabled"))!
    expect(update.sql).toContain("ACCESS_NETWORK_LOGIN_CHANGED")
    expect(update.params).toEqual([ORG, true, expect.any(Date), ACCOUNT.personId])
    const blocked = appWith({ emergency: [], ambiguous: ["G0055350"], enabled: true }, { configured: false, httpsRequired: true })
    const off = await request(blocked.app).put("/admin/network-login").set("Cookie", blocked.cookie).send({ enabled: false })
    expect(off.status).toBe(200)
    expect(blocked.state.enabled).toBe(false)
  })

  it("corpo fora do contrato = 400", async () => {
    const { app, cookie } = appWith({ emergency: [{ active: true }] })
    expect((await request(app).put("/admin/network-login").set("Cookie", cookie).send({ enabled: true, extra: 1 })).status).toBe(400)
  })
})
