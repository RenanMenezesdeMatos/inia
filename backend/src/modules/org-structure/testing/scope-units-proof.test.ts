/**
 * PROVA contra o banco de TESTE real — opções de Grupo/Subgrupo dos seletores de alcance (23/11/2026) e admissão de vínculos novos.
 *   - lista grande: busca sem maiúsculas/acentos e paginação por cursor além da primeira página, sem repetir nem perder item;
 *   - elegibilidade: Grupo com operador "Em produção" só em um Subgrupo aparece; os Subgrupos sem operador em produção somem;
 *     Grupo sem ninguém em produção some das novas escolhas, mas volta por `ids` marcado `eligible: false`;
 *   - universo e escopo de gestão aplicados antes da paginação; rota real (permissão da tela, lista fechada, 403);
 *   - admissão: vínculo novo inelegível ou de outro universo é recusado; o já salvo continua aceito;
 *   - alcance de Indicador e Produto (250) pelo serviço: "Todos" × vínculos, salvo inelegível preservado.
 * Tudo numa transação desfeita no fim (banco intacto). ZERO chamada de modelo.
 *   INIA_DB_PROOF=1 NODE_ENV=test TEST_DATABASE_URL=<banco com a 249/250> npx vitest run scope-units-proof
 */
import express, { type ErrorRequestHandler } from "express"
import pg from "pg"
import request from "supertest"
import { ZodError } from "zod"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { applyIndicatorScope } from "../../indicators/application/indicator-definition-service.js"
import { classifyResource } from "../../operating-universe/application/universe-administration.js"
import { listScopeUnitOptions } from "../application/scope-unit-options.js"
import { assertNewScopeLinksAdmissible } from "../application/scope-unit-admission.js"
import { loadResourceScopeLinks } from "../application/resource-scope-links.js"
import { createScopeUnitOptionsRouter } from "../presentation/scope-unit-options-router.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
let client: pg.PoolClient
const all = { unrestricted: true } as const
const ids: Record<string, string> = {}

async function insertTeam(name: string, universe: string | null): Promise<string> {
  return (await client.query<{ id: string }>(`insert into teams (organization_id, operation_id, name, operating_universe) values ($1, (select id from operations where organization_id = $1 limit 1), $2, $3) returning id`, [ORG, name, universe])).rows[0]!.id
}
async function insertSubteam(teamId: string, name: string): Promise<string> {
  return (await client.query<{ id: string }>(`insert into subteams (organization_id, team_id, name) values ($1, $2, $3) returning id`, [ORG, teamId, name])).rows[0]!.id
}
async function insertOperator(teamId: string, subteamId: string | null, status: string, name = "Operador QA"): Promise<string> {
  return (await client.query<{ id: string }>(`insert into people (organization_id, name, role, team_id, subteam_id, active, current_employment_status) values ($1, $2, 'OPERATOR', $3, $4, true, $5) returning id`, [ORG, name, teamId, subteamId, status])).rows[0]!.id
}

describe.skipIf(!ENABLED)("Seletores de alcance — opções elegíveis, busca e paginação no servidor, admissão de vínculos (Postgres)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    client = await pool.connect()
    await client.query("begin")
    // 75 Grupos B2C com gente em produção (lista grande), um com acento, e os cenários de elegibilidade.
    for (let index = 0; index < 75; index += 1) {
      const id = await insertTeam(`Escopo QA Grupo ${String(index).padStart(2, "0")}`, "B2C")
      await insertOperator(id, null, "EM_PRODUCAO")
    }
    ids.accent = await insertTeam("Escopo QA Cobrança Única", "B2C")
    await insertOperator(ids.accent, null, "EM_PRODUCAO")
    ids.x = await insertTeam("Escopo QA Retenção", "B2C")
    ids.x1 = await insertSubteam(ids.x, "Retenção Manhã")
    ids.x2 = await insertSubteam(ids.x, "Retenção Tarde")
    ids.x3 = await insertSubteam(ids.x, "Retenção Noite")
    await insertOperator(ids.x, ids.x1, "EM_PRODUCAO")
    await insertOperator(ids.x, ids.x2, "FERIAS")
    ids.y = await insertTeam("Escopo QA Sem Produção", "B2C")
    await insertOperator(ids.y, null, "INSS")
    ids.z = await insertTeam("Escopo QA Empresas", "B2B")
    await insertOperator(ids.z, null, "EM_PRODUCAO")
    // Conta com Administrador só do Grupo Retenção (para a rota real).
    ids.adminPerson = (await client.query<{ id: string }>(`insert into people (organization_id, name, role, active) values ($1, 'Admin Retenção QA', 'SUPERVISOR', true) returning id`, [ORG])).rows[0]!.id
    ids.adminAccount = (await client.query<{ id: string }>(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, 'admin-retencao-qa@inia.test', 'x') returning id`, [ORG, ids.adminPerson])).rows[0]!.id
    await client.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, 'ADMINISTRADOR', 'GROUP', $3, now())`, [ORG, ids.adminAccount, ids.x])
  })
  afterAll(async () => {
    if (client) {
      await client.query("rollback")
      client.release()
    }
    if (pool) await pool.end()
  })

  it("lista grande: a busca vai além da primeira página pelo cursor, sem repetir nem perder nenhum Grupo", async () => {
    const seen: string[] = []
    let cursor: { name: string; id: string } | undefined
    let pages = 0
    do {
      const page = await listScopeUnitOptions(client, { organizationId: ORG, kind: "TEAM", search: "escopo qa grupo", eligibleOnly: true, scopes: all, limit: 30, cursor })
      seen.push(...page.items.map((item) => item.name))
      cursor = page.nextCursor ?? undefined
      pages += 1
    } while (cursor)
    expect(pages).toBe(3)
    expect(seen).toHaveLength(75)
    expect(new Set(seen).size).toBe(75)
    expect(seen.at(-1)).toBe("Escopo QA Grupo 74")
  })

  it("busca sem maiúsculas nem acentos; Subgrupo também pelo nome do Grupo-pai", async () => {
    const accent = await listScopeUnitOptions(client, { organizationId: ORG, kind: "TEAM", search: "COBRANCA unica", eligibleOnly: true, scopes: all, limit: 30 })
    expect(accent.items.map((item) => item.name)).toEqual(["Escopo QA Cobrança Única"])
    const byParent = await listScopeUnitOptions(client, { organizationId: ORG, kind: "SUBTEAM", search: "escopo qa retencao manha", eligibleOnly: false, scopes: all, limit: 30 })
    expect(byParent.items.map((item) => `${item.teamName} › ${item.name}`)).toEqual(["Escopo QA Retenção › Retenção Manhã"])
  })

  it("elegibilidade: o Grupo entra pelo único Subgrupo com operador em produção; os outros Subgrupos e o Grupo sem produção somem", async () => {
    const teams = await listScopeUnitOptions(client, { organizationId: ORG, kind: "TEAM", search: "escopo qa", eligibleOnly: true, scopes: all, limit: 100 })
    const names = teams.items.map((item) => item.name)
    expect(names).toContain("Escopo QA Retenção")
    expect(names).not.toContain("Escopo QA Sem Produção")
    expect(teams.items.find((item) => item.id === ids.x)?.productionOperators).toBe(1)
    const subteams = await listScopeUnitOptions(client, { organizationId: ORG, kind: "SUBTEAM", teamId: ids.x, eligibleOnly: true, scopes: all, limit: 30 })
    expect(subteams.items.map((item) => item.name)).toEqual(["Retenção Manhã"])
    // Escolha já salva que perdeu a elegibilidade continua resolvível (para a edição mostrá-la marcada).
    const saved = await listScopeUnitOptions(client, { organizationId: ORG, kind: "TEAM", ids: [ids.y!], eligibleOnly: true, scopes: all, limit: 30 })
    expect(saved.items).toEqual([expect.objectContaining({ id: ids.y, name: "Escopo QA Sem Produção", eligible: false, productionOperators: 0 })])
  })

  it("universo e escopo de gestão filtram antes da paginação", async () => {
    const b2c = await listScopeUnitOptions(client, { organizationId: ORG, kind: "TEAM", search: "escopo qa", universes: ["B2C"], eligibleOnly: true, scopes: all, limit: 100 })
    expect(b2c.items.map((item) => item.name)).not.toContain("Escopo QA Empresas")
    const b2b = await listScopeUnitOptions(client, { organizationId: ORG, kind: "TEAM", search: "escopo qa", universes: ["B2B"], eligibleOnly: true, scopes: all, limit: 100 })
    expect(b2b.items.map((item) => item.name)).toEqual(["Escopo QA Empresas"])
    const onlyX = { unrestricted: false as const, allTeams: false, teamIds: new Set([ids.x!]), subteamIds: new Set([ids.x1!, ids.x2!, ids.x3!]) }
    const managed = await listScopeUnitOptions(client, { organizationId: ORG, kind: "TEAM", eligibleOnly: true, scopes: onlyX, limit: 5 })
    expect(managed.items.map((item) => item.id)).toEqual([ids.x])
    expect(managed.nextCursor).toBeNull()
    // run-10 SEA-03: a consulta por `ids` também respeita o escopo — Grupo de fora não devolve nome, universo nem contagem.
    const byIds = await listScopeUnitOptions(client, { organizationId: ORG, kind: "TEAM", ids: [ids.x!, ids.z!, ids.y!], eligibleOnly: false, scopes: onlyX, limit: 30 })
    expect(byIds.items.map((item) => item.id)).toEqual([ids.x])
    const subByIds = await listScopeUnitOptions(client, { organizationId: ORG, kind: "SUBTEAM", ids: [ids.x1!], eligibleOnly: false, scopes: { unrestricted: false as const, allTeams: false, teamIds: new Set([ids.z!]), subteamIds: new Set<string>() }, limit: 30 })
    expect(subByIds.items).toEqual([])
  })

  it("rota real: permissão da tela (lista fechada), escopo de quem pede e 403 sem a permissão", async () => {
    const app = express()
    app.use((req, _res, next) => {
      req.user = { sub: ids.adminAccount!, personId: ids.adminPerson!, organizationId: ORG } as never
      next()
    })
    app.use("/scope-units", createScopeUnitOptionsRouter(client as unknown as Database))
    const handler: ErrorRequestHandler = (error, _req, res, next) => {
      void next
      if (error instanceof DomainError) return res.status(error.statusCode).json({ error: { code: error.code } })
      if (error instanceof ZodError) return res.status(400).json({ error: { code: "VALIDATION_ERROR" } })
      return res.status(500).json({ error: { message: String(error) } })
    }
    app.use(handler)
    const teams = await request(app).get("/scope-units").query({ kind: "TEAM", permission: "configuration.manage", search: "escopo" })
    expect(teams.status).toBe(200)
    expect(teams.body.data.items.map((item: { id: string }) => item.id)).toEqual([ids.x])
    const subteams = await request(app).get("/scope-units").query({ kind: "SUBTEAM", permission: "configuration.manage" })
    expect(subteams.body.data.items.map((item: { name: string }) => item.name)).toEqual(["Retenção Manhã"])
    expect((await request(app).get("/scope-units").query({ kind: "TEAM", permission: "access.users.manage" })).status).toBe(400)
    expect((await request(app).get("/scope-units").query({ kind: "TEAM", permission: "communications.publish_organization" })).status).toBe(403)
  })

  it("admissão: vínculo NOVO sem operador em produção ou de outro universo é recusado; o já salvo continua aceito", async () => {
    await expect(assertNewScopeLinksAdmissible(client, ORG, [{ teamId: ids.y!, subteamId: null }], { universe: "B2C" })).rejects.toMatchObject({ code: "SCOPE_UNIT_WITHOUT_PRODUCTION_OPERATORS" })
    await expect(assertNewScopeLinksAdmissible(client, ORG, [{ teamId: ids.x!, subteamId: ids.x3! }], {})).rejects.toMatchObject({ code: "SCOPE_UNIT_WITHOUT_PRODUCTION_OPERATORS" })
    await expect(assertNewScopeLinksAdmissible(client, ORG, [{ teamId: ids.z!, subteamId: null }], { universe: "B2C" })).rejects.toMatchObject({ code: "SCOPE_UNIT_OUTSIDE_UNIVERSE" })
    await expect(assertNewScopeLinksAdmissible(client, ORG, [{ teamId: ids.y!, subteamId: null }, { teamId: ids.x!, subteamId: ids.x1! }], { universe: "B2C", previous: [{ teamId: ids.y!, subteamId: null }] })).resolves.toBeUndefined()
  })

  it("alcance do Indicador (250): vínculos validados e gravados; salvo inelegível preservado; removido não volta; “Todos” só com escopo de organização", async () => {
    const indicatorId = (await client.query<{ id: string }>(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction, operating_universe) values ($1, 'QA_ESCOPO_IND', 'Indicador QA escopo', 'PERCENT', 'HIGHER', 'B2C') returning id`, [ORG])).rows[0]!.id
    await applyIndicatorScope(client, ORG, indicatorId, { scopeType: "GROUPS", scopeLinks: [{ teamId: ids.x, subteamId: null }, { teamId: ids.accent, subteamId: null }] }, all)
    expect((await loadResourceScopeLinks(client, "INDICATOR", [indicatorId])).get(indicatorId)).toHaveLength(2)
    // Y perdeu a produção depois de salvo: continua aceito ao editar.
    await client.query(`insert into indicator_scope_links (indicator_id, organization_id, team_id) values ($1, $2, $3)`, [indicatorId, ORG, ids.y])
    await applyIndicatorScope(client, ORG, indicatorId, { scopeType: "GROUPS", scopeLinks: [{ teamId: ids.x, subteamId: null }, { teamId: ids.y, subteamId: null }] }, all)
    await applyIndicatorScope(client, ORG, indicatorId, { scopeType: "GROUPS", scopeLinks: [{ teamId: ids.x, subteamId: null }] }, all)
    await expect(applyIndicatorScope(client, ORG, indicatorId, { scopeType: "GROUPS", scopeLinks: [{ teamId: ids.x, subteamId: null }, { teamId: ids.y, subteamId: null }] }, all)).rejects.toMatchObject({ code: "SCOPE_UNIT_WITHOUT_PRODUCTION_OPERATORS" })
    const onlyX = { unrestricted: false as const, allTeams: false, teamIds: new Set([ids.x!]), subteamIds: new Set<string>() }
    await expect(applyIndicatorScope(client, ORG, indicatorId, { scopeType: "ALL_TEAMS" }, onlyX)).rejects.toMatchObject({ code: "INDICATOR_SCOPE_FORBIDDEN" })
    await applyIndicatorScope(client, ORG, indicatorId, { scopeType: "ALL_TEAMS" }, all)
    expect((await client.query<{ scope_type: string }>(`select scope_type from indicator_definitions where id = $1`, [indicatorId])).rows[0]!.scope_type).toBe("ALL_TEAMS")
    expect((await loadResourceScopeLinks(client, "INDICATOR", [indicatorId])).get(indicatorId)).toEqual([])
  })
  it("reclassificar o universo confere os vínculos já salvos (run-10 SEA-04): indicador com Grupo B2C não vira B2B; o do mesmo universo passa", async () => {
    const person = (await client.query<{ id: string }>(`insert into people (organization_id, name, role, active) values ($1, 'Admin Org QA universo', 'SUPERVISOR', true) returning id`, [ORG])).rows[0]!.id
    const account = (await client.query<{ id: string }>(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, 'admin-org-universo-qa@inia.test', 'x') returning id`, [ORG, person])).rows[0]!.id
    await client.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, 'ADMINISTRADOR_GERAL', 'ORGANIZATION', now())`, [ORG, account])
    const actor = { organizationId: ORG, sub: account, personId: person }
    const indicatorId = (await client.query<{ id: string }>(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction, operating_universe) values ($1, 'QA_ESCOPO_UNI', 'Indicador QA universo', 'PERCENT', 'HIGHER', 'B2C') returning id`, [ORG])).rows[0]!.id
    await applyIndicatorScope(client, ORG, indicatorId, { scopeType: "GROUPS", scopeLinks: [{ teamId: ids.x, subteamId: null }] }, all)
    await expect(classifyResource(client as never, actor, "INDICATOR", indicatorId, "B2B")).rejects.toMatchObject({ code: "SCOPE_UNIT_OUTSIDE_UNIVERSE" })
    expect((await client.query<{ operating_universe: string }>(`select operating_universe from indicator_definitions where id = $1`, [indicatorId])).rows[0]!.operating_universe).toBe("B2C")
    await client.query(`update indicator_scope_links set team_id = $2 where indicator_id = $1`, [indicatorId, ids.z])
    await expect(classifyResource(client as never, actor, "INDICATOR", indicatorId, "B2B")).resolves.toMatchObject({ changed: true })
  })
})
