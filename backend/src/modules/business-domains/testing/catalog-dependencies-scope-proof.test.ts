/**
 * PROVA contra o banco de TESTE real (lote 2 da 4ª auditoria): as listas de dependências dos catálogos que valem para todos os
 * Grupos — domínio de negócio (Agents/Orquestradores) e definição de indicador (Workflows) — mostram pelo nome só o que quem
 * consulta administra; o resto entra só na contagem. Antes, um administrador do Grupo A lia ali os nomes e ids dos Agents,
 * Orquestradores e Workflows do Grupo B, que a lista de cada um (e o detalhe, 404) já escondia.
 *   A) administrador do Grupo A: só o Agent e o Workflow do Grupo A pelo nome; Grupo B e "todos os Grupos" contados;
 *   B) administrador da organização inteira: tudo pelo nome, nada contado à parte;
 *   C) conta sem a permissão: nada pelo nome, tudo contado;
 *   D) a trava de código/exclusão (escritas só da organização inteira) continua vendo todas as dependências.
 * Escopo resolvido do banco (atribuições de papel), mesma função das rotas. Organização própria, apagada no fim.
 *   INIA_DB_PROOF=1 npx vitest run catalog-dependencies-scope-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { getManageableScopes } from "../../auth/application/manageable-scopes.js"
import { loadIndicatorDependencies, loadVisibleIndicatorDependencies } from "../../indicators/application/indicator-dependencies.js"
import { loadBusinessDomainDependencies, loadVisibleBusinessDomainDependencies } from "../application/business-domain-service.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "de00ee00-0000-4000-8000-0000000c0200"
const OPERATION = "de00ee00-0000-4000-8000-0000000c0201"
const CODE = "DEPENDENCIAS_QA"

let pool: pg.Pool
let db: Database
let teamA = ""
let teamB = ""
let domain = { id: "", code: CODE }
let indicator = { id: "", code: "INDICADOR_DEP_QA" }
const accounts = { groupAdmin: "", orgAdmin: "", noPermission: "" }

async function cleanup() {
  await pool.query(`delete from workflows where organization_id = $1`, [ORG])
  await pool.query(`delete from assistant_orchestrators where organization_id = $1`, [ORG])
  await pool.query(`delete from agents where organization_id = $1`, [ORG])
  await pool.query(`delete from business_domains where organization_id = $1`, [ORG])
  await pool.query(`delete from indicator_definitions where organization_id = $1`, [ORG])
  await pool.query(`delete from access_role_assignments where organization_id = $1`, [ORG])
  await pool.query(`delete from user_accounts where organization_id = $1`, [ORG])
  await pool.query(`delete from people where organization_id = $1`, [ORG])
  await pool.query(`delete from teams where organization_id = $1`, [ORG])
  await pool.query(`delete from operations where organization_id = $1`, [ORG])
  await pool.query(`delete from organizations where id = $1`, [ORG])
}

async function account(name: string, teamId: string | null, role?: { code: string; scope: "ORGANIZATION" | "GROUP"; teamId?: string }): Promise<string> {
  const person = (await pool.query<{ id: string }>(`insert into people (organization_id, name, role, team_id) values ($1, $2, 'ADMIN', $3) returning id`, [ORG, name, teamId])).rows[0]!.id
  const id = (await pool.query<{ id: string }>(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, 'x') returning id`, [ORG, person, `${name.toLowerCase().replace(/\W+/g, ".")}@dependencias-proof.test`])).rows[0]!.id
  if (role) {
    await pool.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, $3, $4, $5, now())`, [ORG, id, role.code, role.scope, role.teamId ?? null])
  }
  return id
}

async function agent(name: string, teamId: string | null, options: { domain?: boolean; agentType?: string } = {}): Promise<string> {
  return (
    await pool.query<{ id: string }>(
      `insert into agents (organization_id, name, agent_type, objective, description, context_prompt, scope_type, team_id, specialty_kind, domain, specialty, business_domain_id)
       values ($1, $2, $3, 'Prova', 'Prova', 'Prova', $4, $5, $6, $7, $7, $8) returning id`,
      [ORG, name, options.agentType ?? "CUSTOM", teamId ? "TEAM" : "ALL_TEAMS", teamId, options.domain ? "DOMAIN" : null, options.domain ? CODE : null, options.domain ? domain.id : null],
    )
  ).rows[0]!.id
}

async function workflow(name: string, teamId: string | null) {
  const scope = teamId ? "TEAM" : "ALL_TEAMS"
  await pool.query(
    `insert into workflows (organization_id, name, scope_type, team_id, draft_scope_type, draft_team_id, draft_graph) values ($1, $2, $3, $4, $3, $4, $5)`,
    [ORG, name, scope, teamId, JSON.stringify({ nodes: [{ id: "n1", type: "condition", config: { indicatorCode: indicator.code } }], edges: [] })],
  )
}

const scopesOf = (accountId: string, permission: "agents.manage" | "workflows.manage") => getManageableScopes(db, { organizationId: ORG, sub: accountId }, permission)

describe.skipIf(!ENABLED)("Catálogos — dependências mostram pelo nome só o que quem consulta administra (lote 2)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 3 })
    db = pool as unknown as Database
    await cleanup()
    await pool.query(`insert into organizations (id, name, slug) values ($1, 'Prova dependências', 'prova-dependencias')`, [ORG])
    await pool.query(`insert into operations (id, organization_id, name, timezone) values ($1, $2, 'Prova dependências', 'America/Fortaleza')`, [OPERATION, ORG])
    teamA = (await pool.query<{ id: string }>(`insert into teams (organization_id, operation_id, name) values ($1, $2, 'Grupo A') returning id`, [ORG, OPERATION])).rows[0]!.id
    teamB = (await pool.query<{ id: string }>(`insert into teams (organization_id, operation_id, name) values ($1, $2, 'Grupo B') returning id`, [ORG, OPERATION])).rows[0]!.id
    accounts.groupAdmin = await account("Admin Grupo A", teamA, { code: "ADMINISTRADOR", scope: "GROUP", teamId: teamA })
    accounts.orgAdmin = await account("Admin Geral", null, { code: "ADMINISTRADOR_GERAL", scope: "ORGANIZATION" })
    accounts.noPermission = await account("Sem papel", teamA)

    domain = { id: (await pool.query<{ id: string }>(`insert into business_domains (organization_id, code, name) values ($1, $2, 'Dependências QA') returning id`, [ORG, CODE])).rows[0]!.id, code: CODE }
    await agent("Agent do Grupo A", teamA, { domain: true })
    await agent("Agent do Grupo B", teamB, { domain: true })
    const coordinator = await agent("Coordenador do Grupo B", teamB, { agentType: "ORCHESTRATOR" })
    await pool.query(
      `insert into assistant_orchestrators (organization_id, name, orchestrator_agent_id, scope_type, team_id, active, routing_policy, routing_domains) values ($1, 'Orquestrador do Grupo B', $2, 'TEAM', $3, false, 'DOMAINS', $4)`,
      [ORG, coordinator, teamB, [CODE]],
    )

    indicator = { id: (await pool.query<{ id: string }>(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction) values ($1, $2, 'Indicador dependências QA', 'PERCENT', 'HIGHER') returning id`, [ORG, indicator.code])).rows[0]!.id, code: indicator.code }
    await workflow("Workflow do Grupo A", teamA)
    await workflow("Workflow do Grupo B", teamB)
    await workflow("Workflow de todos os Grupos", null)
  }, 60_000)

  afterAll(async () => {
    if (!pool) return
    await cleanup()
    await pool.end()
  })

  it("A) administrador do Grupo A: pelo nome só o que é do Grupo A; o Grupo B e 'todos os Grupos' entram só na contagem", async () => {
    const domainDeps = await loadVisibleBusinessDomainDependencies(db, ORG, domain, await scopesOf(accounts.groupAdmin, "agents.manage"))
    expect(domainDeps).toMatchObject({ agents: [{ name: "Agent do Grupo A", active: true }], orchestrators: [], total: 3, agentsOutOfScope: 1, orchestratorsOutOfScope: 1 })
    expect(JSON.stringify(domainDeps)).not.toContain("Grupo B")
    const indicatorDeps = await loadVisibleIndicatorDependencies(db, ORG, indicator, await scopesOf(accounts.groupAdmin, "workflows.manage"))
    expect(indicatorDeps).toMatchObject({ workflows: [{ name: "Workflow do Grupo A" }], workflowsOutOfScope: 2, hasHistory: true })
    expect(JSON.stringify(indicatorDeps)).not.toMatch(/Grupo B|todos os Grupos/)
  })

  it("B) administrador da organização inteira: tudo pelo nome, nada contado à parte", async () => {
    const domainDeps = await loadVisibleBusinessDomainDependencies(db, ORG, domain, await scopesOf(accounts.orgAdmin, "agents.manage"))
    expect(domainDeps.agents.map((row) => row.name)).toEqual(["Agent do Grupo A", "Agent do Grupo B"])
    expect(domainDeps.orchestrators.map((row) => row.name)).toEqual(["Orquestrador do Grupo B"])
    expect(domainDeps).toMatchObject({ total: 3, agentsOutOfScope: 0, orchestratorsOutOfScope: 0 })
    const indicatorDeps = await loadVisibleIndicatorDependencies(db, ORG, indicator, await scopesOf(accounts.orgAdmin, "workflows.manage"))
    expect(indicatorDeps.workflows.map((row) => row.name)).toEqual(["Workflow de todos os Grupos", "Workflow do Grupo A", "Workflow do Grupo B"])
    expect(indicatorDeps.workflowsOutOfScope).toBe(0)
  })

  it("C) conta sem a permissão: nada pelo nome, tudo contado", async () => {
    expect(await loadVisibleBusinessDomainDependencies(db, ORG, domain, await scopesOf(accounts.noPermission, "agents.manage"))).toEqual({ agents: [], orchestrators: [], total: 3, agentsOutOfScope: 2, orchestratorsOutOfScope: 1 })
    expect(await loadVisibleIndicatorDependencies(db, ORG, indicator, await scopesOf(accounts.noPermission, "workflows.manage"))).toMatchObject({ workflows: [], workflowsOutOfScope: 3, hasHistory: true })
  })

  it("D) a trava de código/exclusão continua vendo todas as dependências (e só os campos de sempre)", async () => {
    const domainDeps = await loadBusinessDomainDependencies(db, ORG, domain)
    expect(domainDeps.total).toBe(3)
    expect(Object.keys(domainDeps.agents[0]!).sort()).toEqual(["active", "id", "name"])
    const indicatorDeps = await loadIndicatorDependencies(db, ORG, indicator)
    expect(indicatorDeps.workflows).toHaveLength(3)
    expect(Object.keys(indicatorDeps.workflows[0]!).sort()).toEqual(["id", "name"])
  })
})
