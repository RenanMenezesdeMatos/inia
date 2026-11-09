import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { legacyAccessQuery } from "../../access/testing/legacy-admin-fixture.js"

/**
 * Contrato HTTP do catálogo de domínios de negócio com um banco fake em memória (mesmo harness dos
 * outros routers): criação normaliza o código, unicidade dá 409, lista padrão só ativos, exclusão
 * e troca de código com dependência dão 409, desativar/ativar e audit trail. O fluxo completo
 * contra o banco real (Agent + Orquestrador + política) está em testing/business-domain-proof.test.ts.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const ACCOUNT = { id: "acc-1", organization_id: ORG, person_id: "person-1", name: "Admin", role: "ADMIN", email: "admin@inia.com", avatar_url: null, job_title: null, team_id: null, team_name: null }

type DomainRow = { id: string; organization_id: string; code: string; name: string; description: string | null; active: boolean; created_at: Date; updated_at: Date }

function inMemoryDatabase(passwordHash: string, seed: { domains: DomainRow[]; agentsByDomainId?: Record<string, { id: string; name: string; active: boolean }[]>; orchestratorsByDomainId?: Record<string, { id: string; name: string; active: boolean }[]> }) {
  const domains = [...seed.domains]
  const audit: { action: string; entity_id: string }[] = []
  let sequence = 0
  const agentsOf = (id: string) => seed.agentsByDomainId?.[id] ?? []
  const orchestratorsOf = (id: string) => seed.orchestratorsByDomainId?.[id] ?? []
  const withCounts = (row: DomainRow) => ({ id: row.id, code: row.code, name: row.name, description: row.description, active: row.active, createdAt: row.created_at, updatedAt: row.updated_at, agentCount: agentsOf(row.id).length, orchestratorCount: orchestratorsOf(row.id).length })

  async function query(sql: string, params: unknown[] = []) {
    if (sql.includes("from user_accounts ua")) return { rows: [{ ...ACCOUNT, password_hash: passwordHash, active: true }], rowCount: 1 }
    if (sql.includes("from user_role_assignments")) return { rows: [], rowCount: 0 }
    const access = legacyAccessQuery(sql, ACCOUNT.role, [])
    if (access) return access
    if (sql.includes("from business_domains d") && sql.includes("and d.id = $2")) {
      const rows = domains.filter((row) => row.id === params[1]).map(withCounts)
      return { rows, rowCount: rows.length }
    }
    if (sql.includes("from (") && sql.includes("from business_domains d")) {
      // Lista via respondList: filtros aplicados sobre a subquery `q` — replicados aqui pelo texto do WHERE.
      let rows = domains.map(withCounts)
      const wantsActive = /q\.active = \$(\d+)/.exec(sql)
      if (wantsActive) rows = rows.filter((row) => row.active === params[Number(wantsActive[1]) - 1])
      const search = /q\.name ilike \$(\d+)/.exec(sql)
      if (search) {
        const term = String(params[Number(search[1]) - 1]).replace(/%/g, "").toLowerCase()
        rows = rows.filter((row) => row.name.toLowerCase().includes(term) || row.code.toLowerCase().includes(term))
      }
      if (sql.startsWith("select count(*)")) return { rows: [{ total: rows.length }], rowCount: 1 }
      return { rows, rowCount: rows.length }
    }
    if (sql.trim().startsWith("insert into business_domains")) {
      const [organization_id, code, name, description, active] = params as [string, string, string, string | null, boolean]
      if (domains.some((row) => row.organization_id === organization_id && row.code === code)) throw Object.assign(new Error("duplicate"), { code: "23505" })
      const row: DomainRow = { id: `d0000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`, organization_id, code, name, description, active, created_at: new Date(), updated_at: new Date() }
      domains.push(row)
      return { rows: [{ id: row.id }], rowCount: 1 }
    }
    if (sql.trim().startsWith("update business_domains set")) {
      const [code, name, description, active, id] = params as [string, string, string | null, boolean, string]
      const row = domains.find((candidate) => candidate.id === id)!
      if (domains.some((candidate) => candidate.id !== id && candidate.code === code)) throw Object.assign(new Error("duplicate"), { code: "23505" })
      Object.assign(row, { code, name, description, active, updated_at: new Date() })
      return { rows: [], rowCount: 1 }
    }
    if (sql.trim().startsWith("update business_domains_all set active = false, deleted_at")) {
      const index = domains.findIndex((row) => row.id === params[0])
      if (index >= 0) domains.splice(index, 1)
      return { rows: [], rowCount: index >= 0 ? 1 : 0 }
    }
    if (sql.includes("from agents where organization_id = $1 and (business_domain_id = $2")) return { rows: agentsOf(params[1] as string), rowCount: agentsOf(params[1] as string).length }
    if (sql.includes("from assistant_orchestrators o") && sql.includes("assistant_orchestrator_domains od")) return { rows: orchestratorsOf(params[1] as string), rowCount: orchestratorsOf(params[1] as string).length }
    if (sql.trim().startsWith("insert into audit_logs")) {
      audit.push({ action: params[2] as string, entity_id: params[3] as string })
      return { rows: [], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  }
  const database = { query, connect: async () => ({ query, release: () => {} }) } as unknown as Database
  return { database, domains, audit }
}

const FATURAMENTO: DomainRow = { id: "d0000000-0000-4000-8000-00000000f001", organization_id: ORG, code: "FATURAMENTO", name: "Faturamento", description: null, active: true, created_at: new Date("2026-09-01"), updated_at: new Date("2026-09-01") }
const INATIVO: DomainRow = { ...FATURAMENTO, id: "d0000000-0000-4000-8000-00000000f002", code: "BACKOFFICE", name: "Backoffice", active: false }

async function login(database: Database) {
  const agent = request.agent(createApp(database))
  await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
  return agent
}

describe("business-domain-router — CRUD administrativo do catálogo", () => {
  it("cria com código normalizado, recusa duplicado (409) e formato inválido (400); a lista padrão devolve só ativos e includeInactive=true devolve todos, com contadores", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const { database, audit } = inMemoryDatabase(passwordHash, { domains: [FATURAMENTO, INATIVO], agentsByDomainId: { [FATURAMENTO.id]: [{ id: "a1", name: "Especialista de Faturamento", active: true }] } })
    const api = await login(database)
    const created = await api.post("/api/v1/admin/business-domains").send({ name: "Logística e Entregas", code: "logística", description: "Processos relacionados a logística, rastreamento e entrega." })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect(created.body.data).toMatchObject({ code: "LOGISTICA", name: "Logística e Entregas", active: true, agentCount: 0, orchestratorCount: 0 })
    expect(audit).toEqual([{ action: "BUSINESS_DOMAIN_CREATED", entity_id: created.body.data.id }])
    const duplicate = await api.post("/api/v1/admin/business-domains").send({ name: "Outro nome", code: "LOGISTICA" })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error.code).toBe("BUSINESS_DOMAIN_CODE_TAKEN")
    expect((await api.post("/api/v1/admin/business-domains").send({ name: "Inválido", code: "9x" })).status).toBe(400)
    expect((await api.post("/api/v1/admin/business-domains").send({ name: "X", code: "OK_CODE" })).status).toBe(400)
    const active = await api.get("/api/v1/admin/business-domains")
    expect(active.body.data.map((row: { code: string }) => row.code)).toEqual(["FATURAMENTO", "LOGISTICA"])
    expect(active.body.data[0]).toMatchObject({ agentCount: 1, orchestratorCount: 0 })
    const all = await api.get("/api/v1/admin/business-domains?includeInactive=true")
    expect(all.body.data.map((row: { code: string }) => row.code)).toEqual(["FATURAMENTO", "BACKOFFICE", "LOGISTICA"])
    const inactiveOnly = await api.get("/api/v1/admin/business-domains?active=false")
    expect(inactiveOnly.body.data.map((row: { code: string }) => row.code)).toEqual(["BACKOFFICE"])
    const search = await api.get("/api/v1/admin/business-domains?includeInactive=true&search=logis")
    expect(search.body.data.map((row: { code: string }) => row.code)).toEqual(["LOGISTICA"])
    const paged = await api.get("/api/v1/admin/business-domains?includeInactive=true&page=1&pageSize=2")
    expect(paged.body.data).toMatchObject({ total: 3, page: 1, pageSize: 2 })
  })

  it("edição: nome/descrição/status livres; código bloqueado com dependência (409 BUSINESS_DOMAIN_CODE_LOCKED) e livre sem dependência; 404 para id inexistente", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const { database, audit } = inMemoryDatabase(passwordHash, { domains: [FATURAMENTO, INATIVO], orchestratorsByDomainId: { [FATURAMENTO.id]: [{ id: "o1", name: "Orquestrador · Faturamento", active: true }] } })
    const api = await login(database)
    const rename = await api.patch(`/api/v1/admin/business-domains/${FATURAMENTO.id}`).send({ name: "Faturamento e Cobrança", description: "Nova descrição." })
    expect(rename.status).toBe(200)
    expect(rename.body.data).toMatchObject({ code: "FATURAMENTO", name: "Faturamento e Cobrança", description: "Nova descrição." })
    const locked = await api.patch(`/api/v1/admin/business-domains/${FATURAMENTO.id}`).send({ code: "FATURAS" })
    expect(locked.status).toBe(409)
    expect(locked.body.error.code).toBe("BUSINESS_DOMAIN_CODE_LOCKED")
    expect(locked.body.error.message).toContain("Este código já é utilizado por Agents ou Orchestrators.")
    const free = await api.patch(`/api/v1/admin/business-domains/${INATIVO.id}`).send({ code: "back office" })
    expect(free.status).toBe(200)
    expect(free.body.data.code).toBe("BACK_OFFICE")
    expect((await api.patch("/api/v1/admin/business-domains/d0000000-0000-4000-8000-000000000999").send({ name: "X" })).status).toBe(404)
    expect(audit.map((entry) => entry.action)).toEqual(["BUSINESS_DOMAIN_UPDATED", "BUSINESS_DOMAIN_UPDATED"])
  })

  it("ativar/desativar registram auditoria própria; dependências listam Agents e Orchestrators; excluir em uso é 409 e sem uso é 204", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const { database, domains, audit } = inMemoryDatabase(passwordHash, {
      domains: [FATURAMENTO, INATIVO],
      agentsByDomainId: { [FATURAMENTO.id]: [{ id: "a1", name: "Especialista de Faturamento", active: true }] },
      orchestratorsByDomainId: { [FATURAMENTO.id]: [{ id: "o1", name: "Orquestrador · Faturamento", active: true }] },
    })
    const api = await login(database)
    const deactivated = await api.post(`/api/v1/admin/business-domains/${FATURAMENTO.id}/deactivate`)
    expect(deactivated.status).toBe(200)
    expect(deactivated.body.data.active).toBe(false)
    const activated = await api.post(`/api/v1/admin/business-domains/${FATURAMENTO.id}/activate`)
    expect(activated.body.data.active).toBe(true)
    expect(audit.map((entry) => entry.action)).toEqual(["BUSINESS_DOMAIN_DEACTIVATED", "BUSINESS_DOMAIN_ACTIVATED"])
    const dependencies = await api.get(`/api/v1/admin/business-domains/${FATURAMENTO.id}/dependencies`)
    expect(dependencies.body.data).toEqual({ agents: [{ id: "a1", name: "Especialista de Faturamento", active: true }], orchestrators: [{ id: "o1", name: "Orquestrador · Faturamento", active: true }], total: 2, agentsOutOfScope: 0, orchestratorsOutOfScope: 0 })
    const inUse = await api.delete(`/api/v1/admin/business-domains/${FATURAMENTO.id}`)
    expect(inUse.status).toBe(409)
    expect(inUse.body.error.code).toBe("BUSINESS_DOMAIN_IN_USE")
    expect(domains.some((row) => row.id === FATURAMENTO.id)).toBe(true)
    expect((await api.delete(`/api/v1/admin/business-domains/${INATIVO.id}`)).status).toBe(204)
    expect(domains.some((row) => row.id === INATIVO.id)).toBe(false)
    expect(audit.at(-1)).toEqual({ action: "BUSINESS_DOMAIN_DELETED", entity_id: INATIVO.id })
    expect((await api.delete(`/api/v1/admin/business-domains/${INATIVO.id}`)).status).toBe(404)
  })

  it("exige sessão de administrador (401 sem login)", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const { database } = inMemoryDatabase(passwordHash, { domains: [] })
    const response = await request(createApp(database)).get("/api/v1/admin/business-domains")
    expect(response.status).toBe(401)
  })
})
