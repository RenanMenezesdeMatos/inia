import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { legacyAccessQuery } from "../../access/testing/legacy-admin-fixture.js"

const ACCOUNT = {
  id: "acc-1",
  organization_id: "00000000-0000-4000-8000-000000000001",
  person_id: "person-1",
  name: "Admin de Contas",
  role: "ADMIN",
  email: "admin@inia.com",
  avatar_url: null,
  job_title: null,
  team_id: null,
  team_name: null,
}

function fakeDatabase(passwordHash: string, extra?: (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount: number } | undefined): Database {
  return {
    query: async (sql: string, params?: unknown[]) => {
      const extraResult = extra?.(sql, params)
      if (extraResult) return extraResult
      if (sql.includes("from user_accounts ua")) return { rows: [{ ...ACCOUNT, password_hash: passwordHash, active: true }], rowCount: 1 }
      if (sql.includes("from user_role_assignments")) return { rows: [], rowCount: 0 }
      const access = legacyAccessQuery(sql, ACCOUNT.role, [])
      if (access) return access
      return { rows: [], rowCount: 0 }
    },
  } as unknown as Database
}

describe("user-account-router — Jornada prevista do colaborador (evolução do Trigger por agenda relativo ao expediente)", () => {
  it("GET /:id/shift devolve null quando o colaborador não tem jornada cadastrada — nunca inventa um horário padrão (Parte 29)", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const agent = request.agent(createApp(fakeDatabase(passwordHash)))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
    const response = await agent.get("/api/v1/admin/users/operator-1/shift")
    expect(response.status).toBe(200)
    expect(response.body.data).toBeNull()
  })

  it("GET /:id/shift devolve a jornada vigente", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = fakeDatabase(passwordHash, (sql) => {
      if (sql.includes("from employee_work_shifts")) {
        return { rows: [{ startTime: "08:00:00", workMinutes: 480, effectiveFrom: "2026-09-01" }], rowCount: 1 }
      }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
    const response = await agent.get("/api/v1/admin/users/operator-1/shift")
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ startTime: "08:00:00", workMinutes: 480 })
  })

  it("PUT /:id/shift rejeita carga horária <= 0 com mensagem de validação", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const agent = request.agent(createApp(fakeDatabase(passwordHash)))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
    const response = await agent.put("/api/v1/admin/users/operator-1/shift").send({ startTime: "08:00", workMinutes: 0 })
    expect(response.status).toBe(400)
  })

  it("PUT /:id/shift 404 quando o colaborador não existe", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = fakeDatabase(passwordHash, (sql) => {
      if (sql.includes("select id from people where id")) return { rows: [], rowCount: 0 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
    const response = await agent.put("/api/v1/admin/users/nao-existe/shift").send({ startTime: "08:00", workMinutes: 480 })
    expect(response.status).toBe(404)
  })

  it("PUT /:id/shift fecha a jornada anterior (nunca UPDATE destrutivo) e insere uma nova a partir de hoje (Parte 28)", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const calls: { sql: string; params: unknown[] }[] = []
    const database = fakeDatabase(passwordHash, (sql, params) => {
      calls.push({ sql, params: params ?? [] })
      if (sql.includes("select id from people where id")) return { rows: [{ id: "operator-1" }], rowCount: 1 }
      if (sql.trim().startsWith("insert into employee_work_shifts")) return { rows: [{ id: "shift-2" }], rowCount: 1 }
      return undefined
    })
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
    const response = await agent.put("/api/v1/admin/users/operator-1/shift").send({ startTime: "09:00", workMinutes: 480 })
    expect(response.status).toBe(201)

    const closesPrevious = calls.some((call) => call.sql.trim().startsWith("update employee_work_shifts") && call.sql.includes("effective_to = current_date - 1"))
    const removesSameDay = calls.some((call) => call.sql.trim().startsWith("delete from employee_work_shifts") && call.sql.includes("effective_from = current_date"))
    const insertsNew = calls.some((call) => call.sql.trim().startsWith("insert into employee_work_shifts"))
    expect(closesPrevious).toBe(true)
    expect(removesSameDay).toBe(true)
    expect(insertsNew).toBe(true)
  })

  it("POST / — a senha provisória digitada por quem cadastra é TEMPORÁRIA: troca obrigatória no primeiro login, com validade", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const statements: { sql: string; params: unknown[] }[] = []
    const transactionClient = { query: async (sql: string, params?: unknown[]) => { statements.push({ sql, params: params ?? [] }); return sql.includes("insert into people") ? { rows: [{ id: "new-person" }], rowCount: 1 } : sql.includes("insert into user_accounts") ? { rows: [{ id: "new-account" }], rowCount: 1 } : { rows: [], rowCount: 0 } }, release: () => undefined }
    const database = { ...fakeDatabase(passwordHash), connect: async () => transactionClient } as unknown as Database
    const agent = request.agent(createApp(database))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
    const response = await agent.post("/api/v1/admin/users").send({ name: "Pessoa Nova", role: "OPERATOR", email: "Pessoa.Nova@INIA.com", password: "Provisoria-2026" })
    expect(response.status).toBe(201)
    // Auditoria da criação da conta, sem senha nem hash.
    const audit = statements.find((entry) => entry.sql.includes("insert into audit_logs"))!
    expect(String(audit.params[3])).not.toMatch(/Provisoria|\$2[aby]\$/)
    const insert = statements.find((entry) => entry.sql.includes("insert into user_accounts"))!
    expect(insert.sql).toContain("password_change_required")
    const [, , email, hash, issuedAt, expiresAt] = insert.params as [string, string, string, string, Date, Date]
    expect(email).toBe("pessoa.nova@inia.com")
    expect(hash).not.toContain("Provisoria-2026")
    expect(expiresAt.getTime() - issuedAt.getTime()).toBe(72 * 3_600_000)
  })
})
