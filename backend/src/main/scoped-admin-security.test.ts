import request from "supertest"
import { beforeAll, describe, expect, it } from "vitest"
import type { Database } from "../infrastructure/database/pool.js"
import { legacyAccessQuery } from "../modules/access/testing/legacy-admin-fixture.js"
import { hashPassword } from "../modules/auth/infrastructure/password-hasher.js"
import { createApp } from "./app.js"

/**
 * Integração (sessão → guard de permissão → guarda de escrita → router) da auditoria de segurança: um ADMINISTRADOR de
 * Grupo lê os catálogos da organização, mas não os altera (A-F04, U-F7, U-F8), não entra na Central de Dados (I-F1) e um
 * operador não publica feedback de ninguém (U-F5). O Administrador geral continua podendo tudo isso.
 */
const TEAM_A = "a0000000-0000-4000-8000-00000000000a"
const ACCOUNT = { id: "11111111-1111-4111-8111-111111111111", organization_id: "00000000-0000-4000-8000-000000000001", person_id: "00000000-0000-4000-8000-000000000032", name: "Admin de Grupo", email: "admin.grupo@inia.com", avatar_url: null, job_title: null, team_id: TEAM_A, team_name: "A" }

let passwordHash: string
beforeAll(async () => {
  passwordHash = await hashPassword("Inia@123")
})

function fakeDatabase(kind: "GROUP_ADMIN" | "GENERAL_ADMIN" | "OPERATOR"): Database {
  const peopleRole = kind === "OPERATOR" ? "OPERATOR" : "ADMIN"
  const legacyRows = kind === "GROUP_ADMIN" ? [{ scope_type: "TEAM", team_id: TEAM_A, subteam_id: null }] : []
  const query = async (sql: string) => {
    const access = legacyAccessQuery(sql, peopleRole, legacyRows)
    if (access) return access
    if (sql.includes("from user_accounts ua")) return { rows: [{ ...ACCOUNT, role: peopleRole, password_hash: passwordHash, active: true }], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  }
  return { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Database
}

async function agentFor(kind: "GROUP_ADMIN" | "GENERAL_ADMIN" | "OPERATOR") {
  const agent = request.agent(createApp(fakeDatabase(kind)))
  expect((await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })).status).toBe(200)
  return agent
}

const ORGANIZATION_WRITES: [method: "post" | "patch" | "put" | "delete", path: string, body: object][] = [
  ["post", "/api/v1/admin/business-domains", { code: "LOGISTICA", name: "Logística" }],
  ["patch", "/api/v1/admin/operational-calendar/settings", { holidayPolicy: "IGNORE" }],
  ["post", "/api/v1/admin/channel-flags", { channel: "VOICE", code: "X", label: "X" }],
  ["post", "/api/v1/admin/prohibited-topics", { title: "x", description: "x" }],
  ["delete", `/api/v1/admin/prohibited-topics/${TEAM_A}`, {}],
  ["delete", `/api/v1/admin/glossary/${TEAM_A}`, {}],
  ["post", "/api/v1/admin/indicator-rules/definitions", { code: "TESTE" }],
  ["put", "/api/v1/admin/indicator-rules/glossary", { indicatorDefinitionId: TEAM_A }],
  ["post", "/api/v1/admin/indicator-rules", { indicatorDefinitionId: TEAM_A, scopeType: "ALL_TEAMS", calculationPeriod: "MONTHLY", calculationMethod: "Soma do mês" }],
  ["post", "/api/v1/admin/org-structure/subjects", { name: "Assunto" }],
]

describe("administrador de Grupo × recursos da organização inteira", () => {
  it("lê os catálogos, mas não altera o que vale para todos os Grupos", async () => {
    const agent = await agentFor("GROUP_ADMIN")
    expect((await agent.get("/api/v1/admin/business-domains")).status).not.toBe(403)
    for (const [method, path, body] of ORGANIZATION_WRITES) {
      const response = await agent[method](path).send(body)
      expect(response.status, `${method.toUpperCase()} ${path}`).toBe(403)
      expect(["ORGANIZATION_SCOPE_REQUIRED", "INDICATOR_RULE_SCOPE_FORBIDDEN"]).toContain(response.body.error.code)
    }
  })

  it("Central de Dados (dados e credenciais da organização) só com escopo de organização", async () => {
    const groupAdmin = await agentFor("GROUP_ADMIN")
    expect((await groupAdmin.get("/api/v1/admin/data-hub/sources")).status).toBe(403)
    expect((await groupAdmin.post("/api/v1/ingestion/interactions").send({})).status).toBe(403)
    const me = await groupAdmin.get("/api/v1/auth/me")
    expect(me.body.data.access.capabilities.canManageDataHub).toBe(false)
    const generalAdmin = await agentFor("GENERAL_ADMIN")
    expect((await generalAdmin.get("/api/v1/admin/data-hub/sources")).status).not.toBe(403)
  })

  it("o Administrador geral continua alterando os catálogos (passa da guarda de escrita)", async () => {
    const agent = await agentFor("GENERAL_ADMIN")
    for (const [method, path, body] of ORGANIZATION_WRITES) {
      const response = await agent[method](path).send(body)
      expect(response.body?.error?.code, `${method.toUpperCase()} ${path}`).not.toBe("ORGANIZATION_SCOPE_REQUIRED")
    }
  })
})

describe("publicação de feedback (rota legada)", () => {
  it("sessão sem escopo sobre o caso não publica — mesmo 404 de inexistente", async () => {
    const operator = await agentFor("OPERATOR")
    expect((await operator.post("/api/v1/feedbacks/30000000-0000-4000-8000-000000000001/publish")).status).toBe(404)
    expect((await operator.post("/api/v1/feedbacks/nao-e-uuid/publish")).status).toBe(404)
  })
})
