import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { legacyAccessQuery } from "../../access/testing/legacy-admin-fixture.js"

/**
 * Autorização do QA Lab (Parte 50/52/60 do pedido): EXCLUSIVO do administrador global.
 * Administrar Workflows/Agents/Orchestrators de um ou vários grupos NÃO concede acesso — todo
 * endpoint (leitura, execução, massa de teste, histórico) responde 403 pra qualquer outro perfil
 * e 401 sem sessão. O guard roda ANTES de qualquer handler: um admin de grupo não descobre nem
 * a existência dos recursos por aqui.
 */
const TEAM_A = "11111111-1111-4111-8111-111111111111"
const TEAM_B = "22222222-2222-4222-8222-222222222222"
const PASSWORD = "Inia@123"

type RoleAssignment = { scope_type: string; team_id: string | null; subteam_id: string | null }

function fakeDatabase(role: string, roleAssignmentRows: RoleAssignment[], passwordHash: string, log: string[] = []): Database {
  async function routedQuery(sql: string) {
    log.push(sql)
    if (sql.includes("from user_accounts ua")) {
      return {
        rows: [
          {
            id: "acc-1",
            organization_id: "00000000-0000-4000-8000-000000000001",
            person_id: "person-1",
            name: "Pessoa",
            role,
            email: "pessoa@inia.com",
            password_hash: passwordHash,
            active: true,
            avatar_url: null,
            job_title: null,
            team_id: null,
            team_name: null,
          },
        ],
        rowCount: 1,
      }
    }
    const access = legacyAccessQuery(sql, role, roleAssignmentRows as never)
    if (access) return access
    if (sql.includes("from user_role_assignments")) return { rows: roleAssignmentRows, rowCount: roleAssignmentRows.length }
    if (sql.includes("from subteams where team_id")) return { rows: [], rowCount: 0 }
    return { rows: [], rowCount: 0 }
  }
  return { query: routedQuery, connect: async () => ({ query: routedQuery, release: () => {} }) } as unknown as Database
}

async function loginAs(role: string, assignments: RoleAssignment[], log: string[] = []) {
  const passwordHash = await hashPassword(PASSWORD)
  const agent = request.agent(createApp(fakeDatabase(role, assignments, passwordHash, log)))
  await agent.post("/api/v1/auth/login").send({ email: "pessoa@inia.com", password: PASSWORD })
  return agent
}

const QA_ENDPOINTS: { method: "get" | "post"; path: string; body?: unknown }[] = [
  { method: "get", path: "/api/v1/admin/qa-lab/runs" },
  { method: "get", path: "/api/v1/admin/qa-lab/runs/00000000-0000-4000-8000-00000000abcd" },
  { method: "get", path: "/api/v1/admin/qa-lab/test-data/people" },
  { method: "get", path: "/api/v1/admin/qa-lab/test-data/interactions?channelFlagId=00000000-0000-4000-8000-00000000aaaa" },
  // Massa por interação: lista compatível e detalhe com transcrição (dado sensível) — mesmo guard.
  { method: "get", path: "/api/v1/admin/qa-lab/test-data/workflows/00000000-0000-4000-8000-00000000aaaa/interactions?operatorId=00000000-0000-4000-8000-00000000bbbb" },
  { method: "get", path: "/api/v1/admin/qa-lab/test-data/interactions/00000000-0000-4000-8000-00000000cccc" },
  { method: "post", path: "/api/v1/admin/qa-lab/runs/00000000-0000-4000-8000-00000000abcd/rerun-current" },
  { method: "get", path: "/api/v1/admin/qa-lab/test-data/measurements?indicatorCode=NOTA_URA" },
  { method: "post", path: "/api/v1/admin/qa-lab/test-data/condition-preview", body: { workflowId: "00000000-0000-4000-8000-00000000aaaa", nodeId: "condition" } },
  { method: "post", path: "/api/v1/admin/qa-lab/runs/workflow", body: { workflowId: "00000000-0000-4000-8000-00000000aaaa", subject: { kind: "operator", operatorId: "00000000-0000-4000-8000-00000000bbbb" } } },
  { method: "post", path: "/api/v1/admin/qa-lab/runs/agent", body: { agentId: "00000000-0000-4000-8000-00000000aaaa", input: "teste" } },
  { method: "post", path: "/api/v1/admin/qa-lab/runs/orchestrator", body: { orchestratorId: "00000000-0000-4000-8000-00000000aaaa", operatorId: "00000000-0000-4000-8000-00000000bbbb", instruction: "oi" } },
  { method: "post", path: "/api/v1/admin/qa-lab/runs/00000000-0000-4000-8000-00000000abcd/resume", body: {} },
  { method: "post", path: "/api/v1/admin/qa-lab/runs/00000000-0000-4000-8000-00000000abcd/decision", body: { decision: "approved" } },
  { method: "post", path: "/api/v1/admin/qa-lab/runs/00000000-0000-4000-8000-00000000abcd/rerun" },
]

function call(agent: ReturnType<typeof request.agent>, endpoint: (typeof QA_ENDPOINTS)[number]) {
  return endpoint.method === "get" ? agent.get(endpoint.path) : agent.post(endpoint.path).send(endpoint.body ?? {})
}

describe("QA Lab — autorização (exclusivo do administrador global)", () => {
  it("administrador global (ADMIN sem atribuição de escopo) acessa: GET runs → 200, POST run → passa do guard", async () => {
    const agent = await loginAs("ADMIN", [])
    const list = await agent.get("/api/v1/admin/qa-lab/runs")
    expect(list.status).toBe(200)
    expect(list.body).toEqual({ data: [] })

    // Passa do guard e chega no handler — que responde 404 porque o workflow não existe no
    // banco fake (nunca 401/403).
    const run = await agent
      .post("/api/v1/admin/qa-lab/runs/workflow")
      .send({ workflowId: "00000000-0000-4000-8000-00000000aaaa", subject: { kind: "operator", operatorId: "00000000-0000-4000-8000-00000000bbbb" } })
    expect(run.status).toBe(404)
    expect(run.body.error.code).toBe("WORKFLOW_NOT_FOUND")
  })

  it("administrador global explícito (atribuição ADMIN em ALL_TEAMS) também acessa", async () => {
    const agent = await loginAs("ADMIN", [{ scope_type: "ALL_TEAMS", team_id: null, subteam_id: null }])
    const response = await agent.get("/api/v1/admin/qa-lab/runs")
    expect(response.status).toBe(200)
  })

  it("administrador limitado a UM grupo (FATURAS) recebe 403 em TODOS os endpoints, sem executar nenhum handler", async () => {
    const log: string[] = []
    const agent = await loginAs("ADMIN", [{ scope_type: "TEAM", team_id: TEAM_A, subteam_id: null }], log)
    for (const endpoint of QA_ENDPOINTS) {
      const response = await call(agent, endpoint)
      expect(response.status, `${endpoint.method.toUpperCase()} ${endpoint.path}`).toBe(403)
      expect(response.body.error.code).toBe("FORBIDDEN")
    }
    // Nenhuma consulta de recurso do QA Lab chegou ao banco — só login + leitura de escopos.
    expect(log.some((sql) => sql.includes("qa_runs") || sql.includes("from workflows") || sql.includes("from agents") || sql.includes("from interaction_flags"))).toBe(false)
  })

  it("administrador limitado a MÚLTIPLOS grupos (FATURAS + RETENÇÃO) continua sem acesso", async () => {
    const agent = await loginAs("ADMIN", [
      { scope_type: "TEAM", team_id: TEAM_A, subteam_id: null },
      { scope_type: "TEAM", team_id: TEAM_B, subteam_id: null },
    ])
    for (const endpoint of QA_ENDPOINTS) {
      const response = await call(agent, endpoint)
      expect(response.status, `${endpoint.method.toUpperCase()} ${endpoint.path}`).toBe(403)
    }
  })

  it("administrador limitado a um subgrupo também não acessa", async () => {
    const agent = await loginAs("ADMIN", [{ scope_type: "SUBTEAM", team_id: null, subteam_id: "33333333-3333-4333-8333-333333333333" }])
    const response = await agent.get("/api/v1/admin/qa-lab/runs")
    expect(response.status).toBe(403)
  })

  it.each(["SUPERVISOR", "COORDINATOR", "MANAGER", "SENIOR_MANAGER", "DIRECTOR", "OPERATOR"])("perfil %s recebe 403 em todos os endpoints", async (role) => {
    const agent = await loginAs(role, [])
    for (const endpoint of QA_ENDPOINTS) {
      const response = await call(agent, endpoint)
      expect(response.status, `${endpoint.method.toUpperCase()} ${endpoint.path}`).toBe(403)
    }
  })

  it("sem sessão: 401 em todos os endpoints", async () => {
    const passwordHash = await hashPassword(PASSWORD)
    const anonymous = request(createApp(fakeDatabase("ADMIN", [], passwordHash)))
    for (const endpoint of QA_ENDPOINTS) {
      const response = endpoint.method === "get" ? await anonymous.get(endpoint.path) : await anonymous.post(endpoint.path).send(endpoint.body ?? {})
      expect(response.status, `${endpoint.method.toUpperCase()} ${endpoint.path}`).toBe(401)
    }
  })

  it("GET /auth/me informa a capability canUseQaLab derivada das permissões (base da proteção da rota /admin/simulate no frontend)", async () => {
    const globalAdmin = await loginAs("ADMIN", [])
    expect((await globalAdmin.get("/api/v1/auth/me")).body.data.access.capabilities.canUseQaLab).toBe(true)

    const groupAdmin = await loginAs("ADMIN", [{ scope_type: "TEAM", team_id: TEAM_A, subteam_id: null }])
    expect((await groupAdmin.get("/api/v1/auth/me")).body.data.access.capabilities.canUseQaLab).toBe(false)

    const supervisor = await loginAs("SUPERVISOR", [])
    expect((await supervisor.get("/api/v1/auth/me")).body.data.access.capabilities).toMatchObject({ canUseQaLab: false, canAccessAdministration: false })
  })
})
