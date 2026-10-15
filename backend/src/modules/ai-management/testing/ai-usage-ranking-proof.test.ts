import { randomUUID } from "node:crypto"
import cookieParser from "cookie-parser"
import express from "express"
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { createRequireAuth } from "../../auth/presentation/require-auth.js"
import { createAiRuntime } from "../application/ai-runtime-service.js"

/**
 * PROVA — ranking "Quem mais usa" a IA (Administração › IA / Modelos), contra o banco de TESTE real, numa organização PRÓPRIA
 * (nenhuma outra prova entra nos totais; roda junto com as demais provas de IA sem disputar a organização padrão).
 *
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run ai-usage-ranking-proof
 *
 * Estrutura: Diretora → Gerente Sênior → Gerente Um (Supervisor Um [Norte/N1: Operador A, B], Supervisor Dois [Norte/N2:
 * Operador C]) e Gerente Dois, INATIVO (Supervisora Três [Sul/S1: Operador D]); Operador Órfão E (Sul/S1, sem gestor).
 * Uso (01–14/10/2026): A 3 pedidos · B 1 pedido em 2 tentativas · C 2 execuções de Workflow (matrícula dele, disparadas pelo
 * admin) em BRL · D 1 pedido OpenAI sem preço · E 1 · Supervisor Um 1 · 2 sem pessoa · 1 de matrícula apagada. Fora do
 * recorte: um evento antigo do A e um evento de OUTRA organização.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const PASSWORD = "Ranking@Prova-123"
const RANGE = { period: "CUSTOM", from: "2026-10-01T03:00:00.000Z", to: "2026-10-15T02:59:59.999Z" }
const AT = new Date("2026-10-10T15:00:00Z")

let pool: pg.Pool
let tag = ""
type ViewerKey = "admin" | "norte" | "n2" | "access"
type Key = "org" | "otherOrg" | "norte" | "sul" | "n1" | "n2" | "s1" | "dir" | "gs" | "ger1" | "ger2" | "sup1" | "sup2" | "sup3" | "opA" | "opB" | "opC" | "opD" | "opE" | `p_${ViewerKey}`
const ids = {} as Record<Key, string>
const agents: Record<ViewerKey, ReturnType<typeof request.agent>> = {} as never
const sessionCookies: Partial<Record<ViewerKey, string[]>> = {}

type Item = { position: number; key: string; name: string | null; active: boolean; requests: number; attempts: number; errors: number; tokens: number | null; people: number; share: number | null; unknownCostCalls: number; costByCurrency: Record<string, string>; requestsBySource: { WORKFLOW: number; REQUEST: number } }
type Ranking = { items: Item[]; total: number; page: number; pageSize: number; scope: { organizationWide: boolean; unlinkedWithoutPersonVisible: boolean }; unlinked: { requests: number; people: number; reasons: { reason: string; requests: number }[] }; totals: { requests: number; people: number; costByCurrency: Record<string, string> } }

async function cleanup() {
  const orgs = (await pool.query<{ id: string }>(`select id from organizations where slug like 'prova-ranking-ia-%'`)).rows.map((row) => row.id)
  if (orgs.length === 0) return
  const run = (sql: string) => pool.query(sql, [orgs])
  await run(`delete from ai_usage_events where organization_id = any($1)`)
  await run(`delete from workflow_enrollments where organization_id = any($1)`)
  await run(`delete from workflow_versions where workflow_id in (select id from workflows where organization_id = any($1))`)
  await run(`delete from workflows where organization_id = any($1)`)
  await run(`delete from audit_logs where organization_id = any($1)`)
  await run(`delete from access_role_assignments where organization_id = any($1)`)
  await run(`delete from user_accounts where organization_id = any($1)`)
  await run(`update people set reports_to_id = null where organization_id = any($1)`)
  await run(`delete from people where organization_id = any($1)`)
  await run(`delete from subteams where organization_id = any($1)`)
  await run(`delete from teams where organization_id = any($1)`)
  await run(`delete from operations where organization_id = any($1)`)
  await run(`delete from organizations where id = any($1)`)
}

async function seed() {
  tag = randomUUID().slice(0, 8)
  const one = async (sql: string, params: unknown[]) => (await pool.query<{ id: string }>(sql, params)).rows[0]!.id
  const org = (ids.org = await one(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Prova Ranking IA ${tag}`, `prova-ranking-ia-${tag}`]))
  ids.otherOrg = await one(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Prova Ranking IA Outra ${tag}`, `prova-ranking-ia-outra-${tag}`])
  const operation = await one(`insert into operations (organization_id, name, timezone) values ($1, 'Operação prova', 'America/Sao_Paulo') returning id`, [org])
  ids.norte = await one(`insert into teams (organization_id, operation_id, name) values ($1, $2, 'Norte') returning id`, [org, operation])
  ids.sul = await one(`insert into teams (organization_id, operation_id, name) values ($1, $2, 'Sul') returning id`, [org, operation])
  ids.n1 = await one(`insert into subteams (organization_id, team_id, name) values ($1, $2, 'N1') returning id`, [org, ids.norte])
  ids.n2 = await one(`insert into subteams (organization_id, team_id, name) values ($1, $2, 'N2') returning id`, [org, ids.norte])
  ids.s1 = await one(`insert into subteams (organization_id, team_id, name) values ($1, $2, 'S1') returning id`, [org, ids.sul])
  const person = async (key: Key, name: string, role: string, options: { team?: string; subteam?: string; reportsTo?: string; active?: boolean } = {}) =>
    (ids[key] = await one(`insert into people (organization_id, name, role, team_id, subteam_id, reports_to_id, active) values ($1,$2,$3,$4,$5,$6,$7) returning id`, [org, name, role, options.team ?? null, options.subteam ?? null, options.reportsTo ?? null, options.active ?? true]))
  await person("dir", "Diretora Prova", "DIRECTOR")
  await person("gs", "Gerente Sênior Prova", "SENIOR_MANAGER", { reportsTo: ids.dir })
  await person("ger1", "Gerente Um", "MANAGER", { reportsTo: ids.gs })
  await person("ger2", "Gerente Dois", "MANAGER", { reportsTo: ids.gs, active: false })
  await person("sup1", "Supervisor Um", "SUPERVISOR", { team: ids.norte, subteam: ids.n1, reportsTo: ids.ger1 })
  await person("sup2", "Supervisor Dois", "SUPERVISOR", { team: ids.norte, subteam: ids.n2, reportsTo: ids.ger1 })
  await person("sup3", "Supervisora Três", "SUPERVISOR", { team: ids.sul, subteam: ids.s1, reportsTo: ids.ger2 })
  await person("opA", "Operador A", "OPERATOR", { team: ids.norte, subteam: ids.n1, reportsTo: ids.sup1 })
  await person("opB", "Operador B", "OPERATOR", { team: ids.norte, subteam: ids.n1, reportsTo: ids.sup1 })
  await person("opC", "Operador C", "OPERATOR", { team: ids.norte, subteam: ids.n2, reportsTo: ids.sup2 })
  await person("opD", "Operador D", "OPERATOR", { team: ids.sul, subteam: ids.s1, reportsTo: ids.sup3 })
  await person("opE", "Operador Órfão E", "OPERATOR", { team: ids.sul, subteam: ids.s1 })
  // Quem consulta: administradores fora da hierarquia (o nível nunca concede nada — o papel atribuído, sim).
  const hash = await hashPassword(PASSWORD)
  const viewer = async (key: ViewerKey, role: string, scope: { type: string; team?: string; subteam?: string }) => {
    const personId = await person(`p_${key}`, `Viewer ${key}`, "ADMIN")
    const email = `${key}.${tag}@prova-ranking-ia.local`
    const account = await one(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1,$2,$3,$4) returning id`, [org, personId, email, hash])
    await pool.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, subteam_id, source, granted_at) values ($1,$2,$3,$4,$5,$6,'MANUAL',now())`, [org, account, role, scope.type, scope.team ?? null, scope.subteam ?? null])
    agents[key] = request.agent(createApp(pool, { rateLimits: false }))
    const login = await agents[key].post("/api/v1/auth/login").send({ email, password: PASSWORD })
    expect(login.status, JSON.stringify(login.body)).toBe(200)
    sessionCookies[key] = ([] as string[]).concat(login.headers["set-cookie"] ?? [])
  }
  await viewer("admin", "ADMINISTRADOR_GERAL", { type: "ORGANIZATION" })
  await viewer("norte", "ADMINISTRADOR", { type: "GROUP", team: ids.norte })
  await viewer("n2", "ADMINISTRADOR", { type: "SUBGROUP", subteam: ids.n2 })
  await viewer("access", "ADMINISTRADOR_DE_ACESSOS", { type: "ORGANIZATION" })

  const workflow = await one(`insert into workflows (organization_id, name, trigger_config, draft_graph, active) values ($1,'Prova ranking','{"kind":"schedule"}','{"nodes":[],"edges":[]}',true) returning id`, [org])
  const version = await one(`insert into workflow_versions (workflow_id, graph) values ($1, '{"nodes":[],"edges":[]}') returning id`, [workflow])
  const enrollmentC = await one(`insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, scheduled_subject_id, scheduled_for) values ($1,$2,$3,'end','completed',$4,$5) returning id`, [org, workflow, version, ids.opC, AT])
  const event = (options: { requester?: string | null; enrollment?: string | null; correlation?: string; tokens?: number | null; cost?: string | null; currency?: string; status?: string; fallbackIndex?: number; provider?: string; at?: Date; organization?: string }) =>
    pool.query(
      `insert into ai_usage_events (organization_id, occurred_at, use_case, origin, provider_key, model_name, correlation_id, fallback_index, total_tokens, cost, currency, cost_status, pricing_source, status, routing_mode, route_reason, workflow_id, enrollment_id, root_enrollment_id, requester_person_id)
       values ($1,$2,'CHAT','RUNTIME',$3,'prova',$4,$5,$6,$7,$8,$9,'TABLE',$10,'LEGACY','prova',$11,$12,$12,$13)`,
      [options.organization ?? org, options.at ?? AT, options.provider ?? "GEMINI", options.correlation ?? randomUUID(), options.fallbackIndex ?? 0, options.tokens ?? null, options.cost ?? null, options.cost ? (options.currency ?? "USD") : null, options.cost ? "ESTIMATED" : "UNKNOWN", options.status ?? "SUCCESS", options.enrollment ? workflow : null, options.enrollment ?? null, options.requester ?? null],
    )
  for (let index = 0; index < 3; index += 1) await event({ requester: ids.opA, tokens: 100, cost: "0.010000" })
  const retried = randomUUID()
  await event({ requester: ids.opB, correlation: retried, status: "ERROR" })
  await event({ requester: ids.opB, correlation: retried, fallbackIndex: 1, tokens: 50, cost: "0.005000" })
  // Execução de Workflow disparada pelo admin: vale o colaborador da MATRÍCULA (C), nunca quem estava logado.
  for (let index = 0; index < 2; index += 1) await event({ requester: ids.p_admin, enrollment: enrollmentC, tokens: 200, cost: "0.020000", currency: "BRL" })
  await event({ requester: ids.opD, tokens: 10, provider: "OPENAI" })
  await event({ requester: ids.opE, tokens: 10 })
  await event({ requester: ids.sup1, tokens: 40, cost: "0.004000" })
  for (let index = 0; index < 2; index += 1) await event({ tokens: 5 })
  await event({ enrollment: randomUUID(), tokens: 7 })
  await event({ requester: ids.opA, tokens: 999, at: new Date("2026-09-01T12:00:00Z") })
  await event({ requester: ids.opA, tokens: 999, organization: ids.otherOrg })
}

async function rank(agent: keyof typeof agents, params: Record<string, string | number> = {}): Promise<Ranking> {
  const response = await agents[agent].get("/api/v1/admin/ai/usage/ranking").query({ ...RANGE, ...params })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response.body.data as Ranking
}
const summary = (data: Ranking) => data.items.map((item) => [item.position, item.name, item.requests])
const reasons = (data: Ranking) => Object.fromEntries(data.unlinked.reasons.map((reason) => [reason.reason, reason.requests]))

describe.skipIf(!ENABLED)("ranking 'Quem mais usa' a IA — prova contra o banco de teste", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    await cleanup()
    await seed()
  })

  afterAll(async () => {
    await cleanup()
    await pool.end()
  })

  it("Supervisor (organização inteira): cada linha soma a pessoa e a equipe; Sem vínculo com o motivo; nada de fora do período ou de outra organização", async () => {
    const data = await rank("admin", { level: "SUPERVISOR" })
    expect(summary(data)).toEqual([[1, "Supervisor Um", 5], [2, "Supervisor Dois", 2], [3, "Supervisora Três", 1]])
    const [sup1, sup2, sup3] = data.items as [Item, Item, Item]
    expect(sup1).toMatchObject({ attempts: 6, errors: 1, tokens: 390, people: 3, share: 41.7, costByCurrency: { USD: "0.039" }, requestsBySource: { WORKFLOW: 0, REQUEST: 5 } })
    expect(sup2).toMatchObject({ tokens: 400, people: 1, costByCurrency: { BRL: "0.04" }, requestsBySource: { WORKFLOW: 2, REQUEST: 0 } })
    expect(sup3).toMatchObject({ unknownCostCalls: 1, costByCurrency: {} })
    expect(data.unlinked).toMatchObject({ requests: 4, people: 1 })
    expect(reasons(data)).toEqual({ NO_PERSON: 2, OUTSIDE_LEVEL: 1, WORKFLOW_WITHOUT_PERSON: 1 })
    expect(data.totals).toMatchObject({ requests: 12, people: 6, costByCurrency: { USD: "0.039", BRL: "0.04" } })
    expect(data.scope).toEqual({ organizationWide: true, unlinkedWithoutPersonVisible: true })
  })

  it("as seis visões trocam só o nível: Diretoria, Gerência Sênior, Gerência (líder inativo continua com o uso), Grupo, Subgrupo", async () => {
    expect(summary(await rank("admin", { level: "DIRECTOR" }))).toEqual([[1, "Diretora Prova", 8]])
    expect(summary(await rank("admin", { level: "SENIOR_MANAGER" }))).toEqual([[1, "Gerente Sênior Prova", 8]])
    const managers = await rank("admin", { level: "MANAGER" })
    expect(summary(managers)).toEqual([[1, "Gerente Um", 7], [2, "Gerente Dois", 1]])
    expect(managers.items[1]!.active).toBe(false)
    expect(reasons(managers)).toEqual({ NO_PERSON: 2, OUTSIDE_LEVEL: 1, WORKFLOW_WITHOUT_PERSON: 1 })
    const teams = await rank("admin", { level: "TEAM" })
    expect(summary(teams)).toEqual([[1, "Norte", 7], [2, "Sul", 2]])
    expect(reasons(teams)).toEqual({ NO_PERSON: 2, WORKFLOW_WITHOUT_PERSON: 1 })
    expect(summary(await rank("admin", { level: "SUBTEAM" }))).toEqual([[1, "N1", 5], [2, "N2", 2], [3, "S1", 2]])
  })

  it("paginação pela posição no ranking; o Sem vínculo vem em toda página; ordenação por tokens e por pessoas", async () => {
    const first = await rank("admin", { level: "SUPERVISOR", pageSize: 2 })
    expect(summary(first)).toEqual([[1, "Supervisor Um", 5], [2, "Supervisor Dois", 2]])
    expect(first).toMatchObject({ total: 3, page: 1, pageSize: 2 })
    const second = await rank("admin", { level: "SUPERVISOR", pageSize: 2, page: 2 })
    expect(summary(second)).toEqual([[3, "Supervisora Três", 1]])
    expect(second.unlinked.requests).toBe(4)
    expect(summary(await rank("admin", { level: "SUPERVISOR", page: 9 }))).toEqual([])
    expect(summary(await rank("admin", { level: "SUPERVISOR", sort: "TOKENS" })).map((row) => row[1])).toEqual(["Supervisor Dois", "Supervisor Um", "Supervisora Três"])
    expect(summary(await rank("admin", { level: "SUPERVISOR", sort: "PEOPLE" })).map((row) => row[1])).toEqual(["Supervisor Um", "Supervisor Dois", "Supervisora Três"])
  })

  it("filtros: origem, provider e Grupo (que tira o uso sem pessoa — não dá para afirmar que é do Grupo)", async () => {
    const workflow = await rank("admin", { level: "SUPERVISOR", source: "WORKFLOW" })
    expect(summary(workflow)).toEqual([[1, "Supervisor Dois", 2]])
    expect(reasons(workflow)).toEqual({ WORKFLOW_WITHOUT_PERSON: 1 })
    const other = await rank("admin", { level: "SUPERVISOR", source: "OTHER" })
    expect(other.items).toEqual([])
    expect(reasons(other)).toEqual({ NO_PERSON: 2 })
    expect(summary(await rank("admin", { level: "SUPERVISOR", providerKey: "OPENAI" }))).toEqual([[1, "Supervisora Três", 1]])
    const sul = await rank("admin", { level: "SUPERVISOR", teamId: ids.sul })
    expect(summary(sul)).toEqual([[1, "Supervisora Três", 1]])
    expect(reasons(sul)).toEqual({ OUTSIDE_LEVEL: 1 })
    expect(sul.scope.unlinkedWithoutPersonVisible).toBe(false)
  })

  it("escopo do servidor: Administrador do Grupo Norte não recebe nome nem número do Sul; o filtro do cliente não amplia", async () => {
    const supervisors = await rank("norte", { level: "SUPERVISOR" })
    expect(summary(supervisors)).toEqual([[1, "Supervisor Um", 5], [2, "Supervisor Dois", 2]])
    expect(supervisors.unlinked).toMatchObject({ requests: 0, reasons: [] })
    expect(supervisors.totals.requests).toBe(7)
    expect(supervisors.scope).toEqual({ organizationWide: false, unlinkedWithoutPersonVisible: false })
    const managers = await rank("norte", { level: "MANAGER" })
    expect(summary(managers)).toEqual([[1, "Gerente Um", 7]])
    // Diretoria aparece com o número SÓ do escopo (7), nunca o total da organização (8).
    expect(summary(await rank("norte", { level: "DIRECTOR" }))).toEqual([[1, "Diretora Prova", 7]])
    const sul = await rank("norte", { level: "SUPERVISOR", teamId: ids.sul })
    expect(sul).toMatchObject({ items: [], total: 0, totals: { requests: 0 } })
    const everything = JSON.stringify([supervisors, managers, sul])
    for (const outside of ["Supervisora Três", "Gerente Dois", "Operador D", ids.sup3, ids.ger2]) expect(everything).not.toContain(outside)
  })

  it("Subgrupo N2: só o Supervisor Dois; Diretoria com o número do Subgrupo", async () => {
    expect(summary(await rank("n2", { level: "SUPERVISOR" }))).toEqual([[1, "Supervisor Dois", 2]])
    expect(summary(await rank("n2", { level: "DIRECTOR" }))).toEqual([[1, "Diretora Prova", 2]])
    expect(summary(await rank("n2", { level: "TEAM" }))).toEqual([[1, "Norte", 2]])
  })

  it("contexto: Grupos/Subgrupos só do escopo e a descrição do escopo", async () => {
    const context = async (agent: keyof typeof agents) => (await agents[agent].get("/api/v1/admin/ai/usage/ranking/context")).body.data
    const admin = await context("admin")
    expect(admin.scope).toEqual({ organizationWide: true, labels: ["Organização inteira"] })
    expect(admin.teams.map((team: { name: string; subteams: { name: string }[] }) => [team.name, team.subteams.map((subteam) => subteam.name)])).toEqual([["Norte", ["N1", "N2"]], ["Sul", ["S1"]]])
    expect(admin.levels.map((level: { label: string }) => level.label)).toEqual(["Diretoria", "Gerência Sênior", "Gerência", "Grupo", "Subgrupo", "Supervisor"])
    const norte = await context("norte")
    expect(norte.scope).toEqual({ organizationWide: false, labels: ["Grupo Norte"] })
    expect(norte.teams.map((team: { name: string; subteams: { name: string }[] }) => [team.name, team.subteams.map((subteam) => subteam.name)])).toEqual([["Norte", ["N1", "N2"]]])
    const n2 = await context("n2")
    expect(n2.scope.labels).toEqual(["Subgrupo N2"])
    expect(n2.teams.map((team: { name: string; subteams: { name: string }[] }) => [team.name, team.subteams.map((subteam) => subteam.name)])).toEqual([["Norte", ["N2"]]])
  })

  it("permissão explícita: Administrador de acessos (sem a permissão) recebe 403 e não vê a aba; filtros inválidos ou texto livre = 400", async () => {
    const me = await agents.access.get("/api/v1/admin/ai/me")
    expect(me.body.data.permissions).not.toContain("AI_USAGE_RANKING_READ")
    expect((await agents.access.get("/api/v1/admin/ai/usage/ranking")).status).toBe(403)
    expect((await agents.access.get("/api/v1/admin/ai/usage/ranking/context")).status).toBe(403)
    expect((await agents.admin.get("/api/v1/admin/ai/me")).body.data.permissions).toContain("AI_USAGE_RANKING_READ")
    expect((await agents.norte.get("/api/v1/admin/ai/me")).body.data.permissions).toEqual(["AI_CONFIG_READ", "AI_USAGE_READ", "AI_USAGE_RANKING_READ"])
    for (const invalid of [{ level: "COORDINATOR" }, { foo: "1" }, { search: "Operador" }, { pageSize: 101 }, { teamId: "Norte" }, { source: "ADMIN" }]) {
      const response = await agents.admin.get("/api/v1/admin/ai/usage/ranking").query({ ...RANGE, ...invalid })
      expect(response.status, JSON.stringify(invalid)).toBe(400)
    }
  })

  it("quem pediu (migration 143): o request autenticado grava a pessoa da SESSÃO no evento — middleware → contexto → registro → banco", async () => {
    const correlationId = randomUUID()
    const probe = express()
    probe.use(cookieParser())
    probe.post("/probe", createRequireAuth(pool), async (_request, response) => {
      // Qualquer chamada de IA feita dentro do request passa por este ponto único de registro.
      await createAiRuntime(pool).recordUsage({
        organizationId: ids.org, occurredAt: AT, useCase: "CHAT", purpose: null, phase: null, source: null, providerKey: "GEMINI", connectionId: null, modelId: null, modelName: "prova",
        isLocal: false, correlationId, attempt: 1, fallbackIndex: 0, usage: null, durationMs: 1, status: "SUCCESS", errorCategory: null, routingMode: "LEGACY", routeReason: "prova", fallbackReason: null, origin: "RUNTIME", legacyCost: null,
      })
      response.json({ ok: true })
    })
    const answer = await request(probe).post("/probe").set("Cookie", sessionCookies.norte!)
    expect(answer.status, JSON.stringify(answer.body)).toBe(200)
    const stored = await pool.query<{ requester_person_id: string | null; enrollment_id: string | null }>(`select requester_person_id, enrollment_id from ai_usage_events where correlation_id = $1`, [correlationId])
    expect(stored.rows).toEqual([{ requester_person_id: ids.p_norte, enrollment_id: null }])
  })
})
