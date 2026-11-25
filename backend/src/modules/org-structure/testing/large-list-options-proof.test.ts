/**
 * PROVA contra o banco de TESTE real — busca e filtros de listas grandes (24/11/2026):
 *   - Usuários e acessos (Acessos e Pessoas): acha quem está fora da primeira página, sem acento, combinando busca com Grupo e Subgrupo;
 *     paginação estável (ninguém repetido nem pulado, com nomes iguais), total certo numa página além do fim, escopo por Grupo/Subgrupo;
 *   - opções em lotes (`/admin/scope-units`): Subgrupos de nome igual em Grupos diferentes, encadeamento por Grupo, Grupo-pai só nos
 *     filtros, recorte por Grupos, resolução do valor salvo fora do primeiro lote;
 *   - opções das telas de acompanhamento (`listScopedOptions`): cursor, busca, encadeamento Grupo → Subgrupo → pessoa, e NADA fora do alcance;
 *   - a rota de opções de cada tela responde no banco real (SQL válido) e respeita o escopo de quem pede.
 * Tudo numa transação desfeita no fim (banco intacto). ZERO chamada de modelo.
 *   INIA_DB_PROOF=1 NODE_ENV=test TEST_DATABASE_URL=<banco> npx vitest run large-list-options-proof
 */
import express, { type ErrorRequestHandler, type RequestHandler } from "express"
import pg from "pg"
import request from "supertest"
import { ZodError } from "zod"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"
import { createAccessRouter } from "../../access/presentation/access-router.js"
import { createAiManagementRouter } from "../../ai-management/presentation/ai-management-router.js"
import { createConversationMonitoringRouter } from "../../assistant/presentation/conversation-monitoring-router.js"
import { createBestPracticesRouter } from "../../best-practices/presentation/best-practices-router.js"
import { createDiagnosticsRouter } from "../../diagnostics/presentation/diagnostics-router.js"
import { createIniaSuccessRouter } from "../../inia-success/presentation/inia-success-router.js"
import { createFeedbackReviewRouter } from "../../interaction-feedback/presentation/feedback-review-router.js"
import { createInterventionAdminRouter } from "../../interventions/presentation/intervention-admin-router.js"
import { createKnowledgeRouter } from "../../knowledge/presentation/knowledge-router.js"
import { createTeamCalendarRouter } from "../../people/presentation/team-calendar-router.js"
import { createAnalyticsRouter } from "../../performance-analytics/presentation/analytics-router.js"
import { PgAnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { createReportsRouter } from "../../reports/presentation/reports-router.js"
import { createUsabilityRouter } from "../../usage-analytics/presentation/usability-router.js"
import { createAgentRouter } from "../../agents/presentation/agent-router.js"
import { createArgumentScriptRouter } from "../../argument-scripts/presentation/argument-script-router.js"
import { createAssistantRouter } from "../../assistant/presentation/assistant-router.js"
import { createCallExpectationRouter } from "../../call-expectations/presentation/call-expectation-router.js"
import { createHumanSupportAdminRouter } from "../../human-support/presentation/human-support-admin-router.js"
import { createHumanSupportMonitoringRouter } from "../../human-support/presentation/human-support-monitoring-router.js"
import { createIndicatorRuleRouter } from "../../indicator-rules/presentation/indicator-rule-router.js"
import { createOperationalAlignmentRouter } from "../../operational-alignments/presentation/operational-alignment-router.js"
import { createWorkflowRouter } from "../../workflows/presentation/workflow-router.js"
import { createUserAccountRouter } from "../../users/presentation/user-account-router.js"
import { listScopedOptions, reachOfPeople } from "../application/scoped-options.js"
import { createScopeUnitOptionsRouter } from "../presentation/scope-unit-options-router.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
let client: pg.PoolClient
const ids: Record<string, string> = {}
const accounts: Record<string, { sub: string; personId: string }> = {}

const one = async (sql: string, params: unknown[]) => (await client.query<{ id: string }>(sql, params)).rows[0]!.id
const insertTeam = (name: string, universe: string | null) => one(`insert into teams (organization_id, operation_id, name, operating_universe) values ($1, (select id from operations where organization_id = $1 limit 1), $2, $3) returning id`, [ORG, name, universe])
const insertSubteam = (teamId: string, name: string) => one(`insert into subteams (organization_id, team_id, name) values ($1, $2, $3) returning id`, [ORG, teamId, name])
const insertPerson = (name: string, options: { role?: string; teamId?: string | null; subteamId?: string | null; matricula?: string; reportsTo?: string } = {}) =>
  one(`insert into people (organization_id, name, role, team_id, subteam_id, matricula, reports_to_id, active) values ($1, $2, $3, $4, $5, $6, $7, true) returning id`, [ORG, name, options.role ?? "OPERATOR", options.teamId ?? null, options.subteamId ?? null, options.matricula ?? null, options.reportsTo ?? null])

async function account(key: string, roles: { code: string; scope: "ORGANIZATION" | "GROUP" | "SUBGROUP"; teamId?: string; subteamId?: string }[], person: { teamId?: string } = {}) {
  const personId = await insertPerson(`Lista QA conta ${key}`, { role: "SUPERVISOR", teamId: person.teamId ?? null })
  const sub = await one(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, 'x') returning id`, [ORG, personId, `lista-qa-${key}@inia.test`])
  for (const role of roles) await client.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, subteam_id, granted_at) values ($1, $2, $3, $4, $5, $6, now())`, [ORG, sub, role.code, role.scope, role.teamId ?? null, role.subteamId ?? null])
  accounts[key] = { sub, personId }
}

/** Uma requisição como a conta `key`, com o mesmo contexto que o guarda de permissão monta. */
async function as(key: string, router: RequestHandler, url: string, query: Record<string, unknown> = {}) {
  const app = express()
  const who = accounts[key]!
  const access = await createPostgresAccessRepository(client as unknown as Database).loadContext(ORG, who.sub)
  app.use((req, _res, next) => {
    req.user = { sub: who.sub, personId: who.personId, organizationId: ORG, role: "SUPERVISOR" } as never
    req.access = access
    ;(req as { aiPermissions?: string[] }).aiPermissions = ["AI_USAGE_RANKING_READ"]
    next()
  })
  app.use(router)
  const handler: ErrorRequestHandler = (error, _req, res, next) => {
    void next
    if (error instanceof DomainError) return res.status(error.statusCode).json({ error: { code: error.code } })
    if (error instanceof ZodError) return res.status(400).json({ error: { code: "VALIDATION_ERROR" } })
    return res.status(500).json({ error: { message: String(error) } })
  }
  app.use(handler)
  return request(app).get(url).query(query)
}
const db = () => client as unknown as Database
const names = (items: { name: string }[]) => items.map((item) => item.name)

describe.skipIf(!ENABLED)("Busca e filtros de listas grandes (Postgres)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    client = await pool.connect()
    await client.query("begin")
    ids.big = await insertTeam("Lista QA Atendimento", "B2C")
    ids.morning = await insertSubteam(ids.big, "Lista QA Tarde")
    ids.night = await insertSubteam(ids.big, "Lista QA Noite")
    ids.other = await insertTeam("Lista QA Retenção", "B2B")
    ids.otherMorning = await insertSubteam(ids.other, "Lista QA Tarde")
    // 45 Grupos com um Subgrupo de nome IGUAL: lista grande de Subgrupos homônimos.
    for (let index = 0; index < 45; index += 1) await insertSubteam(await insertTeam(`Lista QA Grupo ${String(index).padStart(2, "0")}`, "B2C"), "Lista QA Homônimo")
    // 60 pessoas de nome IGUAL (a ordenação precisa do id) e a pessoa procurada, fora da primeira página.
    for (let index = 0; index < 60; index += 1) await insertPerson("Lista QA Ana", { teamId: ids.big, subteamId: index % 2 === 0 ? ids.morning : ids.night, matricula: `LQA-${String(index).padStart(3, "0")}` })
    ids.target = await insertPerson("Lista QA Zélia Conceição", { teamId: ids.big, subteamId: ids.night, matricula: "LQA-ZELIA" })
    ids.outsider = await insertPerson("Lista QA Zélia Conceição", { teamId: ids.other, subteamId: ids.otherMorning })
    await account("org", [{ code: "ADMINISTRADOR_GERAL", scope: "ORGANIZATION" }])
    await account("group", [{ code: "ADMINISTRADOR", scope: "GROUP", teamId: ids.big }])
    await account("subgroup", [{ code: "ADMINISTRADOR", scope: "SUBGROUP", subteamId: ids.night }])
    await account("reader", [{ code: "LEITOR_DE_CONVERSAS_INIA", scope: "GROUP", teamId: ids.big }])
    await account("none", [])
    await account("alignments", [{ code: "GESTOR_DE_ALINHAMENTOS", scope: "ORGANIZATION" }])
  })
  afterAll(async () => {
    if (client) {
      await client.query("rollback")
      client.release()
    }
    if (pool) await pool.end()
  })

  for (const list of ["Acessos", "Pessoas"] as const) {
    const load = async (key: string, query: Record<string, unknown>) => {
      const response = list === "Acessos" ? await as(key, createAccessRouter(db()), "/users", query) : await as(key, createUserAccountRouter(db()), "/", { page: 1, pageSize: 10, ...query })
      expect(response.status, JSON.stringify(response.body)).toBe(200)
      return response.body.data as { items: { name: string; personId?: string; id?: string }[]; total: number }
    }
    const idOf = (item: { personId?: string; id?: string }) => item.personId ?? item.id

    it(`${list}: acha quem está fora da primeira página, sem acento, e combina a busca com Grupo e Subgrupo`, async () => {
      const first = await load("org", { search: "Lista QA", teamId: ids.big, page: 1, pageSize: 10 })
      expect(first.items).toHaveLength(10)
      expect(first.total).toBe(61)
      expect(first.items.map(idOf)).not.toContain(ids.target)
      const found = await load("org", { search: "zelia conceicao" })
      expect(found.items.map(idOf).sort()).toEqual([ids.target, ids.outsider].sort())
      expect((await load("org", { search: "zelia conceicao", teamId: ids.big })).items.map(idOf)).toEqual([ids.target])
      expect((await load("org", { search: "zelia conceicao", teamId: ids.big, subteamId: ids.night })).items.map(idOf)).toEqual([ids.target])
      expect((await load("org", { search: "zelia conceicao", teamId: ids.big, subteamId: ids.morning })).total).toBe(0)
      // Nomes iguais em Grupos diferentes: a busca com os dois Grupos traz as duas pessoas.
      expect((await load("org", { search: "zelia conceicao", teamId: [ids.big, ids.other] })).items.map(idOf).sort()).toEqual([ids.target, ids.outsider].sort())
      // Subgrupo sozinho (sem Grupo) e o critério de matrícula, que já existia.
      expect((await load("org", { subteamId: ids.otherMorning })).items.map(idOf)).toEqual([ids.outsider])
      expect((await load("org", { search: "lqa-zelia" })).items.map(idOf)).toEqual([ids.target])
      // Palavra a palavra, em qualquer ordem e misturando nome com matrícula.
      expect((await load("org", { search: "conceicao zelia lqa-zelia" })).items.map(idOf)).toEqual([ids.target])
    })

    it(`${list}: vários Grupos e vários Subgrupos — o Subgrupo refina o Grupo dele e os outros Grupos entram inteiros`, async () => {
      const total = async (key: string, query: Record<string, unknown>) => (await load(key, { search: "Lista QA", ...query })).total
      expect(await total("org", { teamId: [ids.big, ids.other] })).toBe(62)
      // `?teamId=a,b` (uma chave só) vale o mesmo que repetir a chave.
      expect(await total("org", { teamId: `${ids.big},${ids.other}` })).toBe(62)
      expect(await total("org", { subteamId: [ids.morning, ids.night] })).toBe(61)
      expect(await total("org", { subteamId: [ids.night, ids.otherMorning] })).toBe(32)
      expect(await total("org", { teamId: [ids.big, ids.other], subteamId: ids.night })).toBe(32)
      expect(await total("org", { teamId: ids.big, subteamId: [ids.night, ids.morning] })).toBe(61)
      // O escopo de quem lê vem antes da escolha: um Grupo de fora não soma ninguém.
      expect(await total("group", { teamId: [ids.big, ids.other] })).toBe(61)
      expect(await total("subgroup", { teamId: [ids.other], subteamId: [ids.morning, ids.night] })).toBe(31)
    })

    it(`${list}: paginação estável com nomes iguais, sem repetir nem pular ninguém; página além do fim mantém o total`, async () => {
      const seen: string[] = []
      for (let page = 1; page <= 7; page += 1) seen.push(...(await load("org", { search: "Lista QA", teamId: ids.big, page, pageSize: 10 })).items.map((item) => idOf(item)!))
      expect(seen).toHaveLength(61)
      expect(new Set(seen).size).toBe(61)
      expect(await load("org", { search: "Lista QA", teamId: ids.big, page: 40, pageSize: 10 })).toMatchObject({ items: [], total: 61 })
    })

    it(`${list}: cada escopo vê só quem alcança, mesmo filtrando por um Grupo de fora`, async () => {
      expect((await load("group", { search: "Lista QA" })).total).toBe(61)
      expect((await load("group", { teamId: ids.other })).total).toBe(0)
      expect((await load("group", { search: "zelia conceicao" })).items.map(idOf)).toEqual([ids.target])
      expect((await load("subgroup", { search: "Lista QA" })).total).toBe(31)
      expect((await load("subgroup", { teamId: ids.big })).total).toBe(31)
      expect((await load("subgroup", { subteamId: ids.morning })).total).toBe(0)
    })
  }

  const units = async (key: string, query: Record<string, unknown>) => {
    const response = await as(key, createScopeUnitOptionsRouter(db()), "/", query)
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    return response.body.data as { items: { id: string; name: string; teamName: string | null; teamId: string | null; manageable: boolean; eligible: boolean }[]; nextCursor: string | null }
  }

  it("Subgrupos de nome igual: o cursor passa por todos sem repetir e cada um vem com o Grupo de origem", async () => {
    const seen: { id: string; teamName: string | null }[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const page = await units("org", { kind: "SUBTEAM", permission: "people.manage", purpose: "filter", search: "lista qa homonimo", limit: 20, ...(cursor ? { cursor } : {}) })
      seen.push(...page.items)
      cursor = page.nextCursor ?? undefined
      pages += 1
    } while (cursor)
    expect(pages).toBe(3)
    expect(seen).toHaveLength(45)
    expect(new Set(seen.map((item) => item.id)).size).toBe(45)
    expect(new Set(seen.map((item) => item.teamName)).size).toBe(45)
    // Homônimos em ordem de Grupo, inclusive de um lote para o outro.
    expect(seen.map((item) => item.teamName)).toEqual(seen.map((item) => item.teamName).sort())
    // A busca distingue homônimos pelo Grupo: "Grupo 07" traz só o dele.
    expect((await units("org", { kind: "SUBTEAM", permission: "people.manage", purpose: "filter", search: "grupo 07 homonimo" })).items.map((item) => item.teamName)).toEqual(["Lista QA Grupo 07"])
  })

  it("encadeamento: com Grupo, só os Subgrupos dele; sem Grupo, os homônimos de todos; o salvo fora do lote resolve por id", async () => {
    expect(names((await units("org", { kind: "SUBTEAM", permission: "access.users.view", purpose: "filter", teamId: ids.big, search: "lista qa" })).items)).toEqual(["Lista QA Noite", "Lista QA Tarde"])
    expect((await units("org", { kind: "SUBTEAM", permission: "access.users.view", purpose: "filter", search: "lista qa tarde" })).items.map((item) => item.teamName)).toEqual(expect.arrayContaining(["Lista QA Atendimento", "Lista QA Retenção"]))
    const firstPage = await units("org", { kind: "SUBTEAM", permission: "people.manage", purpose: "filter", search: "lista qa", limit: 5 })
    expect(firstPage.items.map((item) => item.id)).not.toContain(ids.otherMorning)
    expect((await units("org", { kind: "SUBTEAM", permission: "people.manage", purpose: "filter", ids: ids.otherMorning })).items).toEqual([expect.objectContaining({ id: ids.otherMorning, teamName: "Lista QA Retenção" })])
  })

  it("escopo das opções: Grupo, Subgrupo (com o Grupo-pai só no filtro) e ninguém de fora, nem por id", async () => {
    expect((await units("group", { kind: "TEAM", permission: "people.manage", purpose: "filter" })).items.map((item) => item.id)).toEqual([ids.big])
    expect((await units("group", { kind: "SUBTEAM", permission: "people.manage", purpose: "filter", search: "homonimo" })).items).toEqual([])
    expect((await units("group", { kind: "TEAM", permission: "people.manage", purpose: "filter", ids: ids.other })).items).toEqual([])
    const parent = await units("subgroup", { kind: "TEAM", permission: "people.manage", purpose: "filter" })
    expect(parent.items).toEqual([expect.objectContaining({ id: ids.big, manageable: false })])
    // O Grupo-pai vem só com o nome: a contagem dele é do Grupo inteiro, fora do alcance (run-13 CFA-01), também por id.
    await client.query(`update people set current_employment_status = 'EM_PRODUCAO' where organization_id = $1 and team_id = $2`, [ORG, ids.big])
    expect((await units("org", { kind: "TEAM", permission: "people.manage", purpose: "filter", ids: ids.big })).items).toEqual([expect.objectContaining({ productionOperators: 61 })])
    for (const query of [{}, { ids: ids.big }]) expect((await units("subgroup", { kind: "TEAM", permission: "people.manage", purpose: "filter", ...query })).items).toEqual([expect.objectContaining({ id: ids.big, productionOperators: 0, manageable: false })])
    // Nem o universo do Subgrupo irmão aparece por inferência.
    await client.query(`update subteams set operating_universe = 'B2B' where id = $1`, [ids.morning])
    expect((await units("subgroup", { kind: "TEAM", permission: "people.manage", purpose: "filter", universes: "B2B" })).items).toEqual([])
    expect((await units("group", { kind: "TEAM", permission: "people.manage", purpose: "filter", universes: "B2B" })).items.map((item) => item.id)).toEqual([ids.big])
    await client.query(`update subteams set operating_universe = null where id = $1`, [ids.morning])
    // No alcance de um cadastro o Grupo-pai não é opção: a conta não administra o Grupo inteiro.
    expect((await units("subgroup", { kind: "TEAM", permission: "people.manage", eligibility: "all" })).items).toEqual([])
    expect((await units("subgroup", { kind: "SUBTEAM", permission: "people.manage", purpose: "filter" })).items.map((item) => item.id)).toEqual([ids.night])
    expect((await as("none", createScopeUnitOptionsRouter(db()), "/", { kind: "TEAM", permission: "people.manage" })).status).toBe(403)
    expect((await as("org", createScopeUnitOptionsRouter(db()), "/", { kind: "TEAM", permission: "access.users.manage" })).status).toBe(400)
  })

  it("universo e recorte por Grupos: o filtro mostra o Grupo de outro universo que tem Subgrupo do escolhido", async () => {
    await client.query(`update subteams set operating_universe = 'B2B' where id = $1`, [ids.night])
    const b2b = await units("org", { kind: "TEAM", permission: "people.manage", purpose: "filter", universes: "B2B", search: "lista qa" })
    expect(b2b.items.map((item) => item.id).sort()).toEqual([ids.big, ids.other].sort())
    expect((await units("org", { kind: "TEAM", permission: "people.manage", eligibility: "all", universes: "B2B", search: "lista qa" })).items.map((item) => item.id)).toEqual([ids.other])
    expect((await units("org", { kind: "SUBTEAM", permission: "workflows.manage", purpose: "filter", withinTeamIds: ids.other })).items.map((item) => item.id)).toEqual([ids.otherMorning])
    await client.query(`update subteams set operating_universe = null where id = $1`, [ids.night])
  })

  it("opções por alcance (telas de acompanhamento): cursor, busca, encadeamento e nada fora do alcance", async () => {
    const people = (await client.query<{ id: string }>(`select id from people where organization_id = $1 and team_id = $2`, [ORG, ids.big])).rows.map((row) => row.id)
    const reach = reachOfPeople(people)
    const seen: string[] = []
    let cursor: { name: string; id: string } | undefined
    do {
      const page = await listScopedOptions(client, ORG, reach, { kind: "PERSON", search: "lista qa", cursor, limit: 25 })
      seen.push(...page.items.map((item) => item.id))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(seen).toHaveLength(61)
    expect(new Set(seen).size).toBe(61)
    expect(names((await listScopedOptions(client, ORG, reach, { kind: "TEAM", limit: 30 })).items)).toEqual(["Lista QA Atendimento"])
    expect(names((await listScopedOptions(client, ORG, reach, { kind: "SUBTEAM", teamId: [ids.big!], limit: 30 })).items)).toEqual(["Lista QA Noite", "Lista QA Tarde"])
    expect(names((await listScopedOptions(client, ORG, reach, { kind: "SUBTEAM", teamId: [ids.big!, ids.other!], limit: 30 })).items)).toEqual(["Lista QA Noite", "Lista QA Tarde"])
    expect((await listScopedOptions(client, ORG, reach, { kind: "PERSON", teamId: [ids.big!, ids.other!], subteamId: [ids.night!], search: "zelia", limit: 30 })).items.map((item) => item.id)).toEqual([ids.target])
    expect((await listScopedOptions(client, ORG, reach, { kind: "PERSON", subteamId: [ids.morning!], search: "zelia", limit: 30 })).items).toEqual([])
    expect((await listScopedOptions(client, ORG, reach, { kind: "PERSON", search: "lqa-zelia", limit: 30 }, { matricula: true })).items).toEqual([expect.objectContaining({ id: ids.target, matricula: "LQA-ZELIA", teamName: "Lista QA Atendimento", subteamName: "Lista QA Noite" })])
    // Sem pedir, a matrícula (login de rede) nem volta nem é pesquisável.
    expect((await listScopedOptions(client, ORG, reach, { kind: "PERSON", search: "lqa-zelia", limit: 30 })).items).toEqual([])
    expect((await listScopedOptions(client, ORG, reach, { kind: "PERSON", search: "zelia", limit: 30 })).items).toEqual([expect.objectContaining({ id: ids.target, matricula: null })])
    expect((await listScopedOptions(client, ORG, reach, { kind: "PERSON", ids: [ids.target!, ids.outsider!], limit: 2 })).items.map((item) => item.id)).toEqual([ids.target])
    expect((await listScopedOptions(client, ORG, reach, { kind: "TEAM", ids: [ids.other!], limit: 1 })).items).toEqual([])
  })

  it("a rota de opções de cada tela responde no banco real", async () => {
    // Telas que só filtram por Grupo e Subgrupo: a rota delas nunca lista pessoas (run-13 CFA-02).
    const unitsOnly = new Set(["indicadores de sucesso", "equipe", "boas práticas", "ranking de IA"])
    const routes: [string, RequestHandler, string, Record<string, unknown>][] = [
      ["conversas", createConversationMonitoringRouter(db()), "/filter-options", {}],
      ["diagnóstico", createDiagnosticsRouter(db()), "/memory/unit-options", {}],
      ["indicadores de sucesso", createIniaSuccessRouter(db()), "/unit-options", {}],
      ["monitoria de usabilidade", createUsabilityRouter(db()), "/users/options", {}],
      ["monitoria (lideranças)", createUsabilityRouter(db()), "/users/options", { of: "leaders" }],
      ["equipe", createAnalyticsRouter(db(), new PgAnalyticsReadRepository(db())), "/team/unit-options", { subjectKind: "TEAM", subjectId: ids.big }],
      ["calendário (equipe)", createTeamCalendarRouter(db()), "/options", {}],
      ["calendário (âncoras)", createTeamCalendarRouter(db()), "/options", { of: "anchors" }],
      ["boas práticas", createBestPracticesRouter(db()), "/unit-options", {}],
      ["QA de feedback", createFeedbackReviewRouter(db()), "/filter-options", {}],
      ["ranking de IA", createAiManagementRouter({ db: db() } as never), "/usage/ranking/unit-options", {}],
    ]
    const roles = ["LEITOR_DE_CONVERSAS_INIA", "QA_DE_FEEDBACK", "REPORT"]
    for (const code of roles) await client.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, $3, 'ORGANIZATION', now()) on conflict do nothing`, [ORG, accounts.org!.sub, code])
    for (const [label, router, url, extra] of routes) {
      for (const kind of ["TEAM", "SUBTEAM", "PERSON"]) {
        const response = await as("org", router, url, { kind, search: "lista qa", limit: 5, ...extra })
        if (kind === "PERSON" && unitsOnly.has(label)) {
          expect(response.status, label).toBe(400)
          continue
        }
        expect(response.status, `${label} ${kind}: ${JSON.stringify(response.body)}`).toBe(200)
        expect(Array.isArray(response.body.data.items)).toBe(true)
        expect(response.body.data.items.length).toBeLessThanOrEqual(5)
      }
    }
    // Reports: público no escopo de quem distribui e estruturas em lotes.
    for (const kind of ["TEAM", "SUBTEAM", "PERSON"]) {
      const response = await as("org", createReportsRouter(db()), "/audience/options", { kind, limit: 5 })
      expect([200, 403], JSON.stringify(response.body)).toContain(response.status)
    }
    expect([200, 403]).toContain((await as("org", createReportsRouter(db()), "/structure-options", { limit: 5 })).status)
    const documents = await as("org", createInterventionAdminRouter(db()), "/editor-catalog/documents", { limit: 3, search: "a" })
    expect(documents.status, JSON.stringify(documents.body)).toBe(200)
    expect(documents.body.data.items.length).toBeLessThanOrEqual(3)
    const bases = await as("org", createKnowledgeRouter(db()), "/", { page: 1, pageSize: 5, scopeMatch: "fits", teamId: ids.big, subteamId: ids.night, operatingUniverse: "B2C,PENDING" })
    expect(bases.status, JSON.stringify(bases.body)).toBe(200)
    // Bases no seletor: sem acento, palavra a palavra e em ordem alfabética.
    for (const title of ["Lista QA Zoneamento da cobrança", "Lista QA Ágio da cobrança"]) await client.query(`insert into knowledge_documents (organization_id, title, document_type, source_type) values ($1, $2, 'PROCEDURE', 'TEXT')`, [ORG, title])
    const sorted = await as("org", createKnowledgeRouter(db()), "/", { page: 1, pageSize: 5, search: "cobranca lista", sort: "title" })
    expect((sorted.body.data.items as { title: string }[]).map((item) => item.title)).toEqual(["Lista QA Ágio da cobrança", "Lista QA Zoneamento da cobrança"])
    // Título longo na última posição do lote: o cursor continua aceito (run-13 CFQ-04).
    for (const suffix of ["a", "b"]) await client.query(`insert into knowledge_documents (organization_id, title, document_type, source_type) values ($1, $2, 'PROCEDURE', 'TEXT')`, [ORG, `Lista QA longo ${"ç".repeat(900)}${suffix}`])
    const long = await as("org", createInterventionAdminRouter(db()), "/editor-catalog/documents", { limit: 1, search: "lista qa longo" })
    const next = await as("org", createInterventionAdminRouter(db()), "/editor-catalog/documents", { limit: 1, search: "lista qa longo", cursor: long.body.data.nextCursor })
    expect(next.status, JSON.stringify(next.body)).toBe(200)
    expect(next.body.data.items).toHaveLength(1)
    expect(next.body.data.items[0].id).not.toBe(long.body.data.items[0].id)
  })

  it("quem só gere alinhamentos filtra os indicadores de sucesso por Grupo, mas não lista pessoas nem matrículas", async () => {
    const router = createIniaSuccessRouter(db())
    expect((await as("alignments", router, "/unit-options", { kind: "TEAM", search: "lista qa atendimento" })).body.data.items.map((item: { id: string }) => item.id)).toEqual([ids.big])
    expect((await as("alignments", router, "/unit-options", { kind: "PERSON" })).status).toBe(400)
  })

  it("Calendário e Equipe: Subgrupo sem ninguém na lista não faz o Grupo entrar inteiro", async () => {
    const empty = await insertSubteam(ids.big!, "Lista QA Vazio")
    const filter = { teamId: [ids.big], subteamId: [empty] }
    const people = await as("org", createAnalyticsRouter(db(), new PgAnalyticsReadRepository(db())), "/team/members", { subjectKind: "TEAM", subjectId: ids.big, ...filter })
    expect(people.status, JSON.stringify(people.body)).toBe(200)
    expect(people.body.data.total).toBe(0)
    const calendar = await as("org", createTeamCalendarRouter(db()), "/", { from: "2026-11-01", to: "2026-11-02", ...filter })
    expect(calendar.body.data.people).toEqual([])
  })

  it("a lista e o painel de cada tela aceitam vários Grupos e Subgrupos no banco real", async () => {
    const period = { from: "2026-11-01", to: "2026-11-20" }
    const routes: [string, RequestHandler, string, Record<string, unknown>][] = [
      ["agentes", createAgentRouter(db()), "/", { page: 1 }],
      ["orquestradores", createAssistantRouter(db()), "/", { page: 1 }],
      ["workflows", createWorkflowRouter(db()), "/", { page: 1 }],
      ["bases", createKnowledgeRouter(db()), "/", { page: 1 }],
      ["argumentários", createArgumentScriptRouter(db()), "/", { page: 1 }],
      ["indicadores", createIndicatorRuleRouter(db()), "/", { page: 1 }],
      ["alinhamentos", createOperationalAlignmentRouter(db()), "/", { page: 1 }],
      ["regras de chamada", createCallExpectationRouter(db()), "/", { page: 1 }],
      ["boas práticas", createBestPracticesRouter(db()), "/patterns", {}],
      ["conversas", createConversationMonitoringRouter(db()), "/", {}],
      ["conversas (tempo)", createConversationMonitoringRouter(db()), "/response-times", period],
      ["QA de feedback", createFeedbackReviewRouter(db()), "/", {}],
      ["equipe", createAnalyticsRouter(db(), new PgAnalyticsReadRepository(db())), "/team/members", { subjectKind: "TEAM", subjectId: ids.big }],
      ["calendário", createTeamCalendarRouter(db()), "/", period],
      ["ranking de IA", createAiManagementRouter({ db: db(), now: () => new Date() } as never), "/usage/ranking", { period: "7D" }],
      ...["/memory/summary", "/memory/processes", "/memory/people", "/memory/concentration", "/memory/materials", "/memory/indicators", "/memory/assessments"].map((url): [string, RequestHandler, string, Record<string, unknown>] => [`diagnóstico ${url}`, createDiagnosticsRouter(db()), url, period]),
      ...["/response-time", "/routes", "/replies", "/support", "/feedback", "/compliance", "/alignments"].map((url): [string, RequestHandler, string, Record<string, unknown>] => [`sucesso ${url}`, createIniaSuccessRouter(db()), url, period]),
      ...["/overview", "/users"].flatMap((url) => (["AT_FACT", "CURRENT"] as const).map((structureMode): [string, RequestHandler, string, Record<string, unknown>] => [`usabilidade ${url} ${structureMode}`, createUsabilityRouter(db()), url, { structureMode }])),
      ...["/metrics", "/requests", "/unavailable-attempts", "/abandonment", "/demand", "/history"].map((url): [string, RequestHandler, string, Record<string, unknown>] => [`apoio ${url}`, createHumanSupportMonitoringRouter(db()), url, period]),
      ["apoio /abandonment/list", createHumanSupportMonitoringRouter(db()), "/abandonment/list", { ...period, kind: "WAITING" }],
      ["apoio /anjos/now", createHumanSupportMonitoringRouter(db()), "/anjos/now", {}],
      ["apoio /queue", createHumanSupportMonitoringRouter(db()), "/queue", {}],
      ["anjos", createHumanSupportAdminRouter(db()), "/anjos", {}],
    ]
    await client.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, 'COORDENADOR_DE_ANJOS', 'ORGANIZATION', now()) on conflict do nothing`, [ORG, accounts.org!.sub])
    // Só Grupos, só Subgrupos, e os dois juntos (o Subgrupo refinando um dos Grupos).
    const units = [{ teamId: [ids.big, ids.other] }, { subteamId: [ids.night, ids.otherMorning] }, { teamId: [ids.big, ids.other], subteamId: [ids.night] }]
    for (const [label, router, url, extra] of routes) {
      for (const unit of units) {
        if (label === "QA de feedback" && !("teamId" in unit)) continue
        const query = label === "QA de feedback" ? { teamId: (unit as { teamId: string[] }).teamId } : unit
        const response = await as("org", router, url, { ...extra, ...query })
        expect(response.status, `${label}: ${JSON.stringify(response.body)}`).toBe(200)
      }
    }
    const tooMany = Array.from({ length: 41 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`).join(",")
    expect((await as("org", createAccessRouter(db()), "/users", { teamId: tooMany })).status).toBe(400)
    expect((await as("org", createAccessRouter(db()), "/users", { teamId: [ids.big, "x' or true"] })).status).toBe(400)
  })

  it("leitor de um Grupo: as opções das conversas não trazem Grupo, Subgrupo nem pessoa de fora", async () => {
    for (const personId of [ids.target!, ids.outsider!]) await client.query(`insert into assistant_conversations (organization_id, owner_person_id, started_at, last_activity_at, title) values ($1, $2, now(), now(), 'Lista QA')`, [ORG, personId])
    const router = createConversationMonitoringRouter(db())
    expect((await as("reader", router, "/filter-options", { kind: "PERSON" })).body.data.items.map((item: { id: string }) => item.id)).toEqual([ids.target])
    expect((await as("reader", router, "/filter-options", { kind: "TEAM" })).body.data.items.map((item: { id: string }) => item.id)).toEqual([ids.big])
    expect((await as("reader", router, "/filter-options", { kind: "SUBTEAM" })).body.data.items.map((item: { id: string }) => item.id)).toEqual([ids.night])
    expect((await as("reader", router, "/filter-options", { kind: "PERSON", ids: ids.outsider })).body.data.items).toEqual([])
    expect((await as("reader", router, "/filter-options", { kind: "PERSON", cursor: "lixo" })).status).toBe(400)
  })
})
