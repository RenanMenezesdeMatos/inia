import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it, vi } from "vitest"
import { ZodError } from "zod"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { legacyAccessQuery } from "../../access/testing/legacy-admin-fixture.js"

// A sessão (JWT + estado no banco) tem teste próprio; aqui o usuário já chega autenticado e o assunto é permissão + escopo.
vi.mock("../../auth/presentation/require-auth.js", () => ({ createRequireAuth: () => (_req: unknown, _res: unknown, next: () => void) => next() }))
const { createOperatingUniverseRouter } = await import("./operating-universe-router.js")

/**
 * Contrato HTTP de `/api/v1/admin/operating-universe` com um banco fake por SQL: prontidão só para quem configura a organização
 * inteira; a lista de classificação aplica o escopo de quem administra ANTES do teto (e avisa quando corta) e escapa a busca; a
 * classificação de recurso fora do escopo ou de outra organização é 404 (não revela), e a escrita trava/grava só na organização.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const OTHER_ORG = "00000000-0000-4000-8000-000000000002"
const TEAM_A = "a0000000-0000-4000-8000-00000000000a"
const TEAM_B = "b0000000-0000-4000-8000-00000000000b"
const AGENT_A = "c0000000-0000-4000-8000-00000000000a"
const AGENT_B = "c0000000-0000-4000-8000-00000000000b"
const AGENT_OTHER_ORG = "c0000000-0000-4000-8000-0000000000ff"

type Admin = "ORGANIZATION" | "GROUP_B" | "NONE"
type AgentRow = { id: string; organization_id: string; name: string; operating_universe: string | null; scope_type: string; team_id: string | null; subteam_id: string | null }

const BASE_AGENTS: AgentRow[] = [
  { id: AGENT_A, organization_id: ORG, name: "Agente do Grupo A", operating_universe: null, scope_type: "TEAM", team_id: TEAM_A, subteam_id: null },
  { id: AGENT_B, organization_id: ORG, name: "Agente do Grupo B", operating_universe: null, scope_type: "TEAM", team_id: TEAM_B, subteam_id: null },
  { id: AGENT_OTHER_ORG, organization_id: OTHER_ORG, name: "Agente de outra organização", operating_universe: null, scope_type: "TEAM", team_id: TEAM_B, subteam_id: null },
]

/** O parâmetro posicional citado num trecho do SQL (`r.team_id = any($4::uuid[])` → params[3]). */
function paramOf(sql: string, pattern: RegExp, params: unknown[]): unknown {
  const match = pattern.exec(sql)
  return match ? params[Number(match[1]) - 1] : undefined
}

function appFor(admin: Admin, options: { agents?: AgentRow[]; deletedBeforeLock?: boolean } = {}) {
  const agents = (options.agents ?? BASE_AGENTS).map((row) => ({ ...row }))
  const statements: { sql: string; params: unknown[] }[] = []
  const legacyRows = admin === "GROUP_B" ? [{ scope_type: "TEAM", team_id: TEAM_B, subteam_id: null }] : []
  const query = vi.fn(async (raw: string, params: unknown[] = []) => {
    const sql = raw.replace(/\s+/g, " ").trim()
    statements.push({ sql, params })
    const access = legacyAccessQuery(sql, admin === "NONE" ? "OPERATOR" : "ADMIN", legacyRows)
    if (access) return access
    if (sql.includes("from user_accounts ua join people p")) return { rows: [{ id: "acc-1", person_id: "person-1" }], rowCount: 1 }
    if (sql.includes("select id from subteams where team_id")) return { rows: [], rowCount: 0 }
    if (sql.includes("operating_universe_enforced_at is not null enforced")) return { rows: [{ enforced: false }], rowCount: 1 }
    // Lista de classificação (o dublê aplica organização, escopo, busca e teto como o SQL).
    if (sql.startsWith("select r.id, r.name name, r.operating_universe") && sql.includes("from agents r where") && !sql.includes("r.id = $1")) {
      const teams = paramOf(sql, /r\.team_id = any\(\$(\d+)::uuid\[\]\)/, params) as string[] | undefined
      const search = paramOf(sql, /r\.name ilike \$(\d+)/, params) as string | undefined
      const limit = Number(paramOf(sql, /limit \$(\d+)$/, params))
      const rows = agents
        .filter((row) => row.organization_id === params[0])
        .filter((row) => (teams ? row.scope_type === "TEAM" && row.team_id !== null && teams.includes(row.team_id) : true))
        .filter((row) => (search ? row.name.toLowerCase().includes(search.replace(/^%|%$/g, "").toLowerCase()) : true))
        .slice(0, limit)
      return { rows, rowCount: rows.length }
    }
    // Leitura de um recurso e trava (sempre pelo id E pela organização).
    if (sql.includes("from agents r where r.id = $1 and r.organization_id = $2")) {
      // `deletedBeforeLock`: excluído (logicamente) entre a leitura e a trava — a visão já não o mostra.
      if (options.deletedBeforeLock && sql.endsWith("for update")) return { rows: [], rowCount: 0 }
      const rows = agents.filter((row) => row.id === params[0] && row.organization_id === params[1])
      return { rows, rowCount: rows.length }
    }
    if (sql.startsWith("update agents set operating_universe")) {
      const row = agents.find((candidate) => candidate.id === params[0] && candidate.organization_id === params[1])
      if (row) row.operating_universe = params[2] as string
      return { rows: [], rowCount: row ? 1 : 0 }
    }
    return { rows: [], rowCount: 0 }
  })
  const db = { query, connect: async () => ({ query, release: () => undefined }) }
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    ;(req as unknown as { user: unknown }).user = { personId: "person-1", sub: "acc-1", organizationId: ORG, name: "Administração", role: "ADMIN" }
    next()
  })
  app.use("/", createOperatingUniverseRouter(db as never))
  app.use(((error, _req, res, next) => {
    void next
    if (error instanceof ZodError) return void res.status(400).json({ error: { code: "VALIDATION_ERROR" } })
    res.status(error instanceof DomainError ? error.statusCode : 500).json({ error: { code: error instanceof DomainError ? error.code : "INTERNAL", message: error instanceof Error ? error.message : String(error) } })
  }) as ErrorRequestHandler)
  return { app, agents, statements }
}

describe("operating-universe-router — permissão e escopo", () => {
  it("prontidão e ativação exigem configuration.manage na organização inteira: administração de Grupo = 403", async () => {
    const { app, statements } = appFor("GROUP_B")
    expect((await request(app).get("/readiness")).status).toBe(403)
    expect((await request(app).put("/enforcement").send({ enforce: true })).status).toBe(403)
    expect(statements.some((statement) => statement.sql.startsWith("update organizations"))).toBe(false)
  })

  it("sem papel que administre o tipo: lista 403 e classificação 404 (não revela), nada gravado", async () => {
    const { app, statements } = appFor("NONE")
    expect((await request(app).get("/resources/AGENT")).body.error.code).toBe("FORBIDDEN")
    expect((await request(app).put(`/resources/AGENT/${AGENT_B}`).send({ operatingUniverse: "B2B" })).status).toBe(404)
    expect(statements.some((statement) => /^(update|insert)/.test(statement.sql))).toBe(false)
  })

  it("administração do Grupo B: a lista vem com o escopo aplicado no SQL (antes do teto) e sem o aviso de corte", async () => {
    const { app, statements } = appFor("GROUP_B")
    const response = await request(app).get("/resources/AGENT")
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ data: [{ kind: "AGENT", id: AGENT_B, name: "Agente do Grupo B", operatingUniverse: null }], meta: { truncated: false, limit: 500 } })
    const list = statements.find((statement) => statement.sql.includes("from agents r where"))!
    expect(list.sql).toContain("r.team_id = any(")
    expect(list.params).toContainEqual([TEAM_B])
  })

  it("catálogo da organização (produto) com administração só de Grupo: lista vazia, sem consultar o catálogo", async () => {
    const { app, statements } = appFor("GROUP_B")
    expect((await request(app).get("/resources/PRODUCT")).body).toEqual({ data: [], meta: { truncated: false, limit: 500 } })
    expect(statements.some((statement) => statement.sql.includes("from product_catalog_nodes"))).toBe(false)
  })

  it("mais itens no escopo do que o teto: devolve 500 e avisa a tela (meta.truncated)", async () => {
    const many: AgentRow[] = Array.from({ length: 501 }, (_, index) => ({ id: `d0000000-0000-4000-8000-${String(index).padStart(12, "0")}`, organization_id: ORG, name: `Agente ${String(index).padStart(3, "0")}`, operating_universe: null, scope_type: "TEAM", team_id: TEAM_B, subteam_id: null }))
    const response = await request(appFor("ORGANIZATION", { agents: many }).app).get("/resources/AGENT")
    expect(response.body.data).toHaveLength(500)
    expect(response.body.meta).toEqual({ truncated: true, limit: 500 })
  })

  it("busca: `%` e `_` são texto, não curinga do LIKE", async () => {
    const { app, statements } = appFor("ORGANIZATION")
    await request(app).get(`/resources/AGENT?search=${encodeURIComponent("50%_a\\b")}`)
    const list = statements.find((statement) => statement.sql.includes("from agents r where"))!
    expect(list.params).toContain("%50\\%\\_a\\\\b%")
  })

  it("classificar recurso de outro Grupo ou de outra organização: 404, nada gravado; tipo inválido: 400", async () => {
    const { app, statements } = appFor("GROUP_B")
    expect((await request(app).put(`/resources/AGENT/${AGENT_A}`).send({ operatingUniverse: "B2B" })).body.error.code).toBe("OPERATING_UNIVERSE_RESOURCE_NOT_FOUND")
    expect((await request(appFor("ORGANIZATION").app).put(`/resources/AGENT/${AGENT_OTHER_ORG}`).send({ operatingUniverse: "B2B" })).status).toBe(404)
    expect((await request(app).put(`/resources/NAO_EXISTE/${AGENT_B}`).send({ operatingUniverse: "B2B" })).status).toBe(400)
    expect(statements.some((statement) => /^(update|insert)/.test(statement.sql))).toBe(false)
  })

  it("caminho feliz: administração do Grupo B classifica o agente do Grupo B; trava e escrita filtram a organização; auditado", async () => {
    const { app, agents, statements } = appFor("GROUP_B")
    const response = await request(app).put(`/resources/AGENT/${AGENT_B}`).send({ operatingUniverse: "B2B" })
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({ kind: "AGENT", id: AGENT_B, operatingUniverse: "B2B", changed: true })
    expect(agents.find((row) => row.id === AGENT_B)!.operating_universe).toBe("B2B")
    const lock = statements.find((statement) => statement.sql.endsWith("for update"))!
    expect(lock.sql).toContain("r.organization_id = $2")
    expect(lock.params).toEqual([AGENT_B, ORG])
    expect(statements.find((statement) => statement.sql.startsWith("update agents"))!.params.slice(0, 2)).toEqual([AGENT_B, ORG])
    expect(statements.some((statement) => statement.sql.startsWith("insert into audit_logs") && statement.params.includes("agent"))).toBe(true)
  })

  it("Grupos/Subgrupos: data inexistente no calendário = 400 e data futura = 422, antes de qualquer leitura ou escrita (UB-05)", async () => {
    const { app, statements } = appFor("ORGANIZATION")
    const invalid = await request(app).put(`/units/TEAM/${TEAM_A}`).send({ operatingUniverse: "B2B", effectiveFrom: "2026-02-30" })
    expect([invalid.status, invalid.body.error.code]).toEqual([400, "VALIDATION_ERROR"])
    const future = await request(app).put(`/units/TEAM/${TEAM_A}`).send({ operatingUniverse: "B2B", effectiveFrom: "2999-01-01" })
    expect([future.status, future.body.error.code]).toEqual([422, "OPERATING_UNIVERSE_EFFECTIVE_FROM_FUTURE"])
    expect(statements.some((statement) => statement.sql.includes("from teams") || /^(update|insert)/.test(statement.sql))).toBe(false)
  })

  it("recurso excluído entre a leitura e a trava: 404, nada atualizado nem auditado", async () => {
    const { app, agents, statements } = appFor("GROUP_B", { deletedBeforeLock: true })
    const response = await request(app).put(`/resources/AGENT/${AGENT_B}`).send({ operatingUniverse: "B2B" })
    expect(response.body.error.code).toBe("OPERATING_UNIVERSE_RESOURCE_NOT_FOUND")
    expect(agents.find((row) => row.id === AGENT_B)!.operating_universe).toBeNull()
    expect(statements.some((statement) => /^(update|insert)/.test(statement.sql))).toBe(false)
  })
})
