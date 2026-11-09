/**
 * PROVA contra o banco de teste real: excluir qualquer objeto não apaga nada, e restaurar pela Central de Dados traz de volta sempre desligado.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run deleted-items-proof --no-file-parallelism
 * Duas organizações próprias, apagadas no fim. Nenhuma chamada de IA nem rede externa.
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { DELETED_ITEM_TYPES, DELETED_ITEMS, type DeletedItemType } from "../domain/deleted-items.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "ce00ee00-0000-4000-8000-0000000d0177"
const ORG_B = "ce00ee00-0000-4000-8000-0000000e0177"
const PASSWORD = "Prova@ItensExcluidos-2026"
const ITEMS = "/api/v1/admin/data-explorer/deleted-items"

let pool: pg.Pool
let geral: ReturnType<typeof request.agent>
let dados: ReturnType<typeof request.agent>
let outra: ReturnType<typeof request.agent>
let operador: ReturnType<typeof request.agent>
const people: Record<string, string> = {}
const accounts: Record<string, string> = {}
let sequence = 0
const unique = (prefix: string) => `${prefix}${++sequence}`

const one = async (sql: string, params: unknown[]) => (await pool.query<{ id: string }>(`${sql} returning id`, params)).rows[0]!.id
const value = async <T>(sql: string, params: unknown[]) => (await pool.query<{ v: T }>(sql, params)).rows[0]?.v as T

async function cleanup() {
  for (const org of [ORG, ORG_B]) {
    const inOrg = async (table: string) => pool.query(`delete from ${table} where organization_id = $1`, [org])
    await pool.query(`update workflows_all set active_version_id = null where organization_id = $1`, [org])
    await pool.query(`delete from workflow_enrollment_events where enrollment_id in (select id from workflow_enrollments where organization_id = $1)`, [org])
    await inOrg("workflow_enrollments")
    await inOrg("agent_runs")
    await pool.query(`delete from workflow_versions where workflow_id in (select id from workflows_all where organization_id = $1)`, [org])
    await inOrg("workflows_all")
    await inOrg("assistant_orchestrators_all")
    await pool.query(`delete from agent_versions where agent_id in (select id from agents_all where organization_id = $1)`, [org])
    await inOrg("agents_all")
    await inOrg("interaction_flags")
    await inOrg("interactions")
    await inOrg("channel_flags_all")
    await inOrg("indicator_measurements_all")
    await inOrg("goals_all")
    await inOrg("indicator_calculation_rules")
    await inOrg("indicator_definitions_all")
    await inOrg("argument_scripts_all")
    await inOrg("business_domains_all")
    await inOrg("prohibited_topics_all")
    await inOrg("glossary_terms_all")
    await inOrg("organization_holidays_all")
    // Versão publicada e abrangência são imutáveis de propósito: só a limpeza da prova passa por cima.
    await pool.query(`alter table intervention_policy_versions disable trigger user`)
    await pool.query(`delete from intervention_policy_versions where policy_id in (select id from intervention_policies where organization_id = $1)`, [org])
    await pool.query(`alter table intervention_policy_versions enable trigger user`)
    await inOrg("intervention_policies")
    await pool.query(`alter table product_scope_assignments disable trigger user`)
    await inOrg("product_scope_assignments")
    await pool.query(`alter table product_scope_assignments enable trigger user`)
    await inOrg("inia_scene_settings")
    await inOrg("inia_scenes_all")
    await inOrg("product_identification_criteria_all")
    await inOrg("product_catalog_nodes_all")
    await inOrg("ai_connection_secrets")
    await inOrg("ai_model_pricing")
    await inOrg("ai_models_all")
    await inOrg("ai_connections_all")
    await inOrg("ai_budgets_all")
    await inOrg("knowledge_versions")
    await inOrg("knowledge_documents")
    await inOrg("data_push_tokens")
    await inOrg("data_secrets")
    await inOrg("data_feeds")
    await inOrg("data_sources")
    await inOrg("reports")
    await inOrg("audit_logs")
    await inOrg("access_role_assignments")
    await inOrg("user_accounts")
    await inOrg("people")
    await inOrg("teams")
    await inOrg("operations")
    await pool.query(`delete from organizations where id = $1`, [org])
  }
}

async function account(key: string, org: string, role?: string, teamId?: string) {
  const personId = await one(`insert into people (organization_id, team_id, name, role, job_title, matricula, current_employment_status) values ($1, $2, $3, $4, 'A', $5, 'EM_PRODUCAO')`, [org, teamId ?? null, `Pessoa ${key}`, role ? "ADMIN" : "OPERATOR", `M-${key}`])
  people[key] = personId
  accounts[key] = await one(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4)`, [org, personId, `${key}@prova-excluidos.inia.local`, await hashPassword(PASSWORD)])
  if (role) await pool.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, $3, 'ORGANIZATION', now())`, [org, accounts[key], role])
}

const newAgent = (name = unique("Agent ")) => one(`insert into agents (organization_id, name, agent_type, objective, description, context_prompt, active, scope_type) values ($1, $2, 'CUSTOM', 'o', 'd', 'c', true, 'ALL_TEAMS')`, [ORG, name])
const newWorkflow = (name = unique("Workflow ")) => one(`insert into workflows (organization_id, name, active, scope_type, draft_scope_type, draft_graph) values ($1, $2, true, 'ALL_TEAMS', 'ALL_TEAMS', '{"nodes":[],"edges":[]}')`, [ORG, name])
const newDomain = (code = unique("DOM_")) => one(`insert into business_domains (organization_id, code, name, active) values ($1, $2, $3, true)`, [ORG, code, `Domínio ${code}`])
const newIndicator = () => {
  const code = unique("IND_")
  return one(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction, active, official_closure_supported) values ($1, $2, $3, 'COUNT', 'HIGHER', true, true)`, [ORG, code, `Indicador ${code}`])
}
const newFlag = () => one(`insert into channel_flags (organization_id, channel, flag_name, value_type, active) values ($1, 'VOICE', $2, 'BOOLEAN', true)`, [ORG, unique("flag_")])
const newConnection = (name = unique("Conexão ")) => one(`insert into ai_connections (organization_id, provider_key, name, enabled) values ($1, 'OPENAI', $2, true)`, [ORG, name])
const newModel = (connection: string) => one(`insert into ai_models (organization_id, connection_id, provider_model_id, display_name, enabled) values ($1, $2, $3, $4, true)`, [ORG, connection, unique("model-"), unique("Modelo ")])
const newSource = (name = unique("Fonte ")) => one(`insert into data_sources (organization_id, public_id, name, kind, status) values ($1, $2, $3, 'FILE_UPLOAD', 'ACTIVE')`, [ORG, unique("pub-"), name])
const newFeed = (source: string, authoritative = false, contract = unique("contrato_")) => one(`insert into data_feeds (organization_id, source_id, feed_key, name, contract_key, status, authoritative) values ($1, $2, $3, $4, $5, 'ACTIVE', $6)`, [ORG, source, unique("feed-"), unique("Conjunto "), contract, authoritative])
const newScene = async (name = unique("Cenário ")) => {
  const scene = await pool.query<{ id: string }>(
    `with s as (insert into inia_scenes (organization_id, name, schedule_start, schedule_end) values ($1, $2, '2031-12-20', '2031-12-26') returning id),
          i as (insert into inia_scene_images (organization_id, scene_id, label, mime_type, byte_size, width, height, sha256, data, is_primary) select $1, id, 'Principal', 'image/png', 1, 1, 1, repeat('a', 64), '\\x00', true from s)
     select id from s`,
    [ORG, name],
  )
  return scene.rows[0]!.id
}
const newScript = async () => {
  const script = await one(`insert into argument_scripts (organization_id, name, scope_type, status) values ($1, $2, 'ALL_TEAMS', 'ACTIVE')`, [ORG, unique("Argumentário ")])
  await pool.query(`insert into argument_script_versions (organization_id, script_id, version, status, content, content_hash, effective_from, published_at) values ($1, $2, 1, 'PUBLISHED', '{}', 'h', now() - interval '1 day', now() - interval '1 day')`, [ORG, script])
  return script
}
const newCriterion = async () => {
  const node = await newNode()
  const criterion = await one(`insert into product_identification_criteria (organization_id, title, status) values ($1, $2, 'ACTIVE')`, [ORG, unique("Indício ")])
  await pool.query(
    `insert into product_identification_criterion_versions (organization_id, criterion_id, version, status, statement, target_node_ids, strength, content_hash, effective_from, approved_at) values ($1, $2, 1, 'APPROVED', 'Afirmação do indício', $3, 'INDICATIVE', 'h', now() - interval '1 day', now() - interval '1 day')`,
    [ORG, criterion, [node]],
  )
  return criterion
}
const newNode = (parent: string | null = null) => {
  const code = unique("P_")
  return one(`insert into product_catalog_nodes (organization_id, kind, code, name, parent_id, active) values ($1, 'PRODUCT', $2, $3, $4, true)`, [ORG, code, `Produto ${code}`, parent])
}
const newDocument = async () => {
  const document = await one(`insert into knowledge_documents (organization_id, title, document_type) values ($1, $2, 'PROCEDURE')`, [ORG, unique("Base ")])
  await pool.query(`insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1, $2, 1, 'conteúdo', 'PUBLISHED', 'h')`, [ORG, document])
  return document
}

/** Cada tipo: como nasce, a rota real que o exclui e o que prova que voltou desligado. */
type Case = { table: string; view: string | null; make: () => Promise<string>; remove: (id: string) => string; off: string }
const CASES: Record<Exclude<DeletedItemType, "REPORT" | "WORKFLOW_VARIABLE" | "INDICATOR_RULE">, Case> = {
  WORKFLOW: { table: "workflows_all", view: "workflows", make: newWorkflow, remove: (id) => `/api/v1/admin/workflows/${id}`, off: "not active" },
  AGENT: { table: "agents_all", view: "agents", make: () => newAgent(), remove: (id) => `/api/v1/admin/agents/${id}`, off: "not active" },
  ORCHESTRATOR: { table: "assistant_orchestrators_all", view: "assistant_orchestrators", make: async () => one(`insert into assistant_orchestrators (organization_id, name, orchestrator_agent_id, scope_type, active, policy_kind) values ($1, $2, $3, 'ALL_TEAMS', true, 'OPEN')`, [ORG, unique("Orquestrador "), await newAgent()]), remove: (id) => `/api/v1/admin/assistant-orchestrators/${id}`, off: "not active" },
  KNOWLEDGE_DOCUMENT: { table: "knowledge_documents", view: null, make: newDocument, remove: (id) => `/api/v1/admin/knowledge/${id}`, off: "exists (select 1 from knowledge_versions v where v.document_id = t.id and v.status = 'ARCHIVED') and not exists (select 1 from knowledge_versions v where v.document_id = t.id and v.status = 'PUBLISHED')" },
  ARGUMENT_SCRIPT: { table: "argument_scripts_all", view: "argument_scripts", make: newScript, remove: (id) => `/api/v1/admin/argument-scripts/${id}`, off: "status = 'ARCHIVED' and not exists (select 1 from argument_script_versions v where v.script_id = t.id and v.status = 'PUBLISHED' and (v.effective_until is null or v.effective_until > now()))" },
  BUSINESS_DOMAIN: { table: "business_domains_all", view: "business_domains", make: () => newDomain(), remove: (id) => `/api/v1/admin/business-domains/${id}`, off: "not active" },
  CHANNEL_FLAG: { table: "channel_flags_all", view: "channel_flags", make: newFlag, remove: (id) => `/api/v1/admin/channel-flags/${id}`, off: "not active" },
  INDICATOR: { table: "indicator_definitions_all", view: "indicator_definitions", make: newIndicator, remove: (id) => `/api/v1/admin/indicator-rules/definitions/${id}`, off: "not active" },
  PRODUCT_NODE: { table: "product_catalog_nodes_all", view: "product_catalog_nodes", make: () => newNode(), remove: (id) => `/api/v1/admin/product-catalog/nodes/${id}`, off: "not active" },
  PRODUCT_CRITERION: { table: "product_identification_criteria_all", view: "product_identification_criteria", make: newCriterion, remove: (id) => `/api/v1/admin/product-catalog/criteria/${id}`, off: "status = 'ARCHIVED' and not exists (select 1 from product_identification_criterion_versions v where v.criterion_id = t.id and v.status = 'APPROVED' and (v.effective_until is null or v.effective_until > now()))" },
  PROHIBITED_TOPIC: { table: "prohibited_topics_all", view: "prohibited_topics", make: () => one(`insert into prohibited_topics (organization_id, name, required_behavior, active) values ($1, $2, 'Recusar o assunto', true)`, [ORG, unique("Assunto ")]), remove: (id) => `/api/v1/admin/prohibited-topics/${id}`, off: "not active" },
  GLOSSARY_TERM: { table: "glossary_terms_all", view: "glossary_terms", make: () => one(`insert into glossary_terms (organization_id, term, definition, feedback_application, active) values ($1, $2, 'def', 'uso', true)`, [ORG, unique("Termo ")]), remove: (id) => `/api/v1/admin/glossary/${id}`, off: "not active" },
  HOLIDAY: { table: "organization_holidays_all", view: "organization_holidays", make: () => one(`insert into organization_holidays (organization_id, holiday_date, name, active) values ($1, '2031-01-01', $2, true)`, [ORG, unique("Feriado ")]), remove: (id) => `/api/v1/admin/operational-calendar/holidays/${id}`, off: "not active" },
  INIA_SCENE: { table: "inia_scenes_all", view: "inia_scenes", make: () => newScene(), remove: (id) => `/api/v1/admin/inia-scenes/${id}`, off: "schedule_start is null and schedule_end is null" },
  AI_CONNECTION: { table: "ai_connections_all", view: "ai_connections", make: () => newConnection(), remove: (id) => `/api/v1/admin/ai/connections/${id}`, off: "not enabled" },
  AI_MODEL: { table: "ai_models_all", view: "ai_models", make: async () => newModel(await newConnection()), remove: (id) => `/api/v1/admin/ai/models/${id}`, off: "not enabled" },
  AI_BUDGET: { table: "ai_budgets_all", view: "ai_budgets", make: () => one(`insert into ai_budgets (organization_id, scope, scope_key, currency, monthly_amount, enabled) values ($1, 'USE_CASE', $2, 'USD', 10, true)`, [ORG, unique("uso-")]), remove: (id) => `/api/v1/admin/ai/budgets/${id}`, off: "not enabled" },
  DATA_SOURCE: { table: "data_sources", view: null, make: () => newSource(), remove: (id) => `/api/v1/admin/data-hub/sources/${id}`, off: "status = 'PAUSED'" },
  DATA_FEED: { table: "data_feeds", view: null, make: async () => newFeed(await newSource()), remove: (id) => `/api/v1/admin/data-hub/feeds/${id}`, off: "status = 'PAUSED' and next_sync_at is null" },
}

describe.skipIf(!ENABLED)("Itens excluídos — prova Postgres", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    await cleanup()
    await pool.query(`insert into organizations (id, name, slug) values ($1, 'Prova excluídos A', 'prova-excluidos-a'), ($2, 'Prova excluídos B', 'prova-excluidos-b')`, [ORG, ORG_B])
    const operation = await one(`insert into operations (organization_id, name, timezone) values ($1, 'Op', 'America/Sao_Paulo')`, [ORG])
    const team = await one(`insert into teams (organization_id, operation_id, name, external_code) values ($1, $2, 'Grupo', 'G')`, [ORG, operation])
    await account("geral", ORG, "ADMINISTRADOR_GERAL")
    await account("dados", ORG, "ADMINISTRADOR_DE_DADOS")
    await account("geralB", ORG_B, "ADMINISTRADOR_GERAL")
    await account("op", ORG, undefined, team)
    const app = createApp(pool as unknown as Database, { rateLimits: false })
    const login = async (key: string) => {
      const agent = request.agent(app)
      expect((await agent.post("/api/v1/auth/login").send({ email: `${key}@prova-excluidos.inia.local`, password: PASSWORD })).status, key).toBe(200)
      return agent
    }
    geral = await login("geral")
    dados = await login("dados")
    outra = await login("geralB")
    operador = await login("op")
  }, 60_000)

  afterAll(async () => {
    if (pool) {
      await cleanup()
      await pool.end()
    }
  })

  const remove = async (path: string) => {
    const response = await geral.delete(path)
    expect([200, 204], `${path}: ${JSON.stringify(response.body)}`).toContain(response.status)
  }
  const preview = (type: string, id: string, agent = geral) => agent.get(`${ITEMS}/${type}/${id}/restoration`)
  const restore = (type: string, id: string, agent = geral) => agent.post(`${ITEMS}/${type}/${id}/restoration`).send({})
  const expectRestored = async (type: string, id: string) => {
    const response = await restore(type, id)
    expect(response.status, JSON.stringify(response.body)).toBe(200)
  }
  const listed = async (agent = geral, query = "") => {
    const response = await agent.get(`${ITEMS}${query}`)
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    return response.body.data.items as { type: string; id: string; name: string; deletedBy: string | null; typeLabel: string }[]
  }

  it("o catálogo tem todos os tipos, sem repetir", () => {
    expect(DELETED_ITEMS.map((item) => item.type)).toEqual([...DELETED_ITEM_TYPES])
  })

  for (const [type, spec] of Object.entries(CASES)) {
    it(`${type}: excluir guarda, esconde e registra quem; restaurar volta desligado`, async () => {
      const id = await spec.make()
      await remove(spec.remove(id))
      const stored = (await pool.query<{ deleted_at: Date; deleted_by_person_id: string }>(`select deleted_at, deleted_by_person_id from ${spec.table} where id = $1`, [id])).rows[0]
      expect(stored?.deleted_at, "continua no banco").toBeTruthy()
      expect(stored?.deleted_by_person_id).toBe(people.geral)
      if (spec.view) expect(await value<string>(`select count(*)::text v from ${spec.view} where id = $1`, [id])).toBe("0")

      const item = (await listed()).find((entry) => entry.id === id)
      expect(item, "aparece nos itens excluídos").toBeTruthy()
      expect(item?.deletedBy).toBe("M-geral")

      const check = await preview(type, id)
      expect(check.status, JSON.stringify(check.body)).toBe(200)
      expect(check.body.data.canRestore).toBe(true)
      expect(check.body.data.notices.length).toBeGreaterThan(0)

      await expectRestored(type, id)
      const back = await value<boolean>(`select (${spec.off}) v from ${spec.table} t where t.id = $1 and t.deleted_at is null`, [id])
      expect(back, "voltou e desligado").toBe(true)
      if (spec.view) expect(await value<string>(`select count(*)::text v from ${spec.view} where id = $1`, [id])).toBe("1")
      expect((await listed()).some((entry) => entry.id === id)).toBe(false)
      // Já restaurado: não há o que restaurar de novo.
      expect((await restore(type, id)).status).toBe(404)
    })
  }

  it("variável de Workflow: guarda e volta, e precisa do Workflow vivo", async () => {
    const workflow = await newWorkflow()
    const variable = await one(`insert into workflow_variables (workflow_id, name, type) values ($1, 'contador', 'NUMERIC')`, [workflow])
    await remove(`/api/v1/admin/workflows/${workflow}/variables/${variable}`)
    expect(await value<string>(`select count(*)::text v from workflow_variables where id = $1`, [variable])).toBe("0")
    expect(await value<string>(`select count(*)::text v from workflow_variables_all where id = $1`, [variable])).toBe("1")
    await remove(`/api/v1/admin/workflows/${workflow}`)
    const blocked = await preview("WORKFLOW_VARIABLE", variable)
    expect(blocked.body.data.canRestore).toBe(false)
    expect(blocked.body.data.problems[0].code).toBe("DELETED_ITEM_PARENT_DELETED")
    expect((await restore("WORKFLOW_VARIABLE", variable)).status).toBe(409)
    await expectRestored("WORKFLOW", workflow)
    await expectRestored("WORKFLOW_VARIABLE", variable)
    expect(await value<string>(`select count(*)::text v from workflow_variables where id = $1`, [variable])).toBe("1")
  })

  it("regra de cálculo: volta desativada e precisa do indicador vivo", async () => {
    const indicator = await newIndicator()
    const rule = await one(`insert into indicator_calculation_rules (organization_id, indicator_definition_id, scope_type, calculation_period, calculation_method, active) values ($1, $2, 'ALL_TEAMS', 'MONTHLY', 'AVERAGE', true)`, [ORG, indicator])
    await remove(`/api/v1/admin/indicator-rules/${rule}`)
    expect(await value<string>(`select deleted_by_person_id::text v from indicator_calculation_rules where id = $1`, [rule])).toBe(people.geral)
    await remove(`/api/v1/admin/indicator-rules/definitions/${indicator}`)
    expect((await preview("INDICATOR_RULE", rule)).body.data.canRestore).toBe(false)
    await expectRestored("INDICATOR", indicator)
    await expectRestored("INDICATOR_RULE", rule)
    expect(await value<boolean>(`select not active v from indicator_calculation_rules where id = $1 and deleted_at is null`, [rule])).toBe(true)
  })

  it("nome e código ficam livres, e restaurar com o nome em uso é barrado até renomear", async () => {
    const name = unique("Agent repetido ")
    const original = await newAgent(name)
    await remove(`/api/v1/admin/agents/${original}`)
    const replacement = await newAgent(name)
    const blocked = await preview("AGENT", original)
    expect(blocked.body.data.canRestore).toBe(false)
    expect(blocked.body.data.problems[0].message).toContain(name)
    const refused = await restore("AGENT", original)
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe("DELETED_ITEM_RESTORE_BLOCKED")
    expect(await value<string>(`select count(*)::text v from agents where id = $1`, [original])).toBe("0")
    await pool.query(`update agents set name = $1 where id = $2`, [`${name} novo`, replacement])
    await expectRestored("AGENT", original)
  })

  it.each([
    ["domínio", () => unique("DOM_X"), async (code: string) => newDomain(code), (id: string) => `/api/v1/admin/business-domains/${id}`, "BUSINESS_DOMAIN"],
    ["conexão", () => unique("Conexão Y "), async (name: string) => newConnection(name), (id: string) => `/api/v1/admin/ai/connections/${id}`, "AI_CONNECTION"],
    ["cenário", () => unique("Cenário Z "), async (name: string) => newScene(name), (id: string) => `/api/v1/admin/inia-scenes/${id}`, "INIA_SCENE"],
  ] as const)("%s: o nome excluído pode ser usado de novo", async (_label, makeName, make, path, type) => {
    const name = makeName()
    const first = await make(name)
    await remove(path(first))
    await make(name)
    expect((await preview(type, first)).body.data.canRestore).toBe(false)
  })

  it("orquestrador precisa dos Agents vivos; o Agent fica livre quando o orquestrador é excluído", async () => {
    const agent = await newAgent()
    const orchestrator = await one(`insert into assistant_orchestrators (organization_id, name, orchestrator_agent_id, scope_type, active, policy_kind) values ($1, $2, $3, 'ALL_TEAMS', true, 'OPEN')`, [ORG, unique("Orquestrador P "), agent])
    expect((await geral.delete(`/api/v1/admin/agents/${agent}`)).status, "orquestrador vivo segura o Agent").toBe(409)
    await remove(`/api/v1/admin/assistant-orchestrators/${orchestrator}`)
    await remove(`/api/v1/admin/agents/${agent}`)
    const blocked = await preview("ORCHESTRATOR", orchestrator)
    expect(blocked.body.data.canRestore).toBe(false)
    expect(blocked.body.data.problems[0].message).toContain("Agent")
    await expectRestored("AGENT", agent)
    await expectRestored("ORCHESTRATOR", orchestrator)
    expect(await value<boolean>(`select active v from assistant_orchestrators where id = $1`, [orchestrator])).toBe(false)
  })

  it("Agent com domínio excluído depois dele só volta depois do domínio", async () => {
    const domain = await newDomain()
    const agent = await newAgent()
    await pool.query(`update agents set business_domain_id = $1 where id = $2`, [domain, agent])
    expect((await geral.delete(`/api/v1/admin/business-domains/${domain}`)).status, "Agent vivo segura o domínio").toBe(409)
    await remove(`/api/v1/admin/agents/${agent}`)
    await remove(`/api/v1/admin/business-domains/${domain}`)
    expect((await preview("AGENT", agent)).body.data.canRestore).toBe(false)
    await expectRestored("BUSINESS_DOMAIN", domain)
    await expectRestored("AGENT", agent)
  })

  it("categoria: o produto dentro dela só volta depois dela", async () => {
    const parent = await newNode()
    const child = await newNode(parent)
    await remove(`/api/v1/admin/product-catalog/nodes/${child}`)
    await remove(`/api/v1/admin/product-catalog/nodes/${parent}`)
    expect((await preview("PRODUCT_NODE", child)).body.data.problems[0].message).toContain("categoria")
    await expectRestored("PRODUCT_NODE", parent)
    await expectRestored("PRODUCT_NODE", child)
  })

  it("domínio com Argumentário vivo continua sem sair", async () => {
    const domain = await newDomain()
    await pool.query(`insert into argument_scripts (organization_id, name, scope_type, status, business_domain_id) values ($1, $2, 'ALL_TEAMS', 'ACTIVE', $3)`, [ORG, unique("Argumentário D "), domain])
    const inUse = await geral.delete(`/api/v1/admin/business-domains/${domain}`)
    expect(inUse.status).toBe(409)
    expect(inUse.body.error.code).toBe("BUSINESS_DOMAIN_IN_USE")
  })

  describe("item com histórico pode ser excluído: o que barra é o uso de agora", () => {
    const EXPLORER_QUERY = "/api/v1/admin/data-explorer/query"
    const firstColumn = async (dataset: string, column: string, filterColumn: string, value: string) => {
      const response = await geral.post(EXPLORER_QUERY).send({ dataset, columns: [column], filter: { type: "group", logic: "AND", children: [{ type: "condition", column: filterColumn, operator: "EQ", value }] } })
      expect(response.status, JSON.stringify(response.body)).toBe(200)
      return response.body.data.rows.map((row: string[]) => row[0])
    }
    const newInteraction = () => one(`insert into interactions (organization_id, operator_id, channel, reason, started_at, ended_at, external_id) values ($1, $2, 'VOICE', 'Motivo', now() - interval '5 minutes', now(), $3)`, [ORG, people.op, unique("EXT-")])
    const newMeasurement = (indicator: string) => one(`insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source) values ($1, $2, 'PERSON', $3, 10, now() - interval '1 day', now(), 'PROVA')`, [ORG, indicator, people.op])
    const newPolicy = async (definition: unknown) => {
      const policy = await one(`insert into intervention_policies (organization_id, key, name, scope_type, active) values ($1, $2, $3, 'ORGANIZATION', true)`, [ORG, unique("POLITICA_"), unique("Política ")])
      await pool.query(`insert into intervention_policy_versions (organization_id, policy_id, version, status, definition, effective_from, published_at) values ($1, $2, 1, 'PUBLISHED', $3, now(), now())`, [ORG, policy, JSON.stringify(definition)])
      return policy
    }

    it("Agent com execução e conversa sai, e o histórico continua com o nome dele", async () => {
      const name = unique("Agent com histórico ")
      const agent = await newAgent(name)
      const workflow = await newWorkflow()
      const version = await one(`insert into workflow_versions (workflow_id, graph) values ($1, '{"nodes":[],"edges":[]}')`, [workflow])
      const enrollment = await one(`insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, scheduled_subject_id) values ($1, $2, $3, 'x', 'completed', now(), $4)`, [ORG, workflow, version, people.op])
      const run = await one(`insert into agent_runs (organization_id, agent_id, source, input_context, status) values ($1, $2, 'WORKFLOW', 'prova', 'COMPLETED')`, [ORG, agent])
      await pool.query(`insert into workflow_enrollment_events (enrollment_id, node_id, event_type, idempotency_key, agent_run_id) values ($1, 'x', 'agent_run', $2, $3)`, [enrollment, unique("evt-"), run])

      const check = (await geral.get(`/api/v1/admin/agents/${agent}/deletion-check`)).body.data
      expect(check).toMatchObject({ deletable: true, hasUsage: true, usage: { runs: 1, runningRuns: 0 } })
      await remove(`/api/v1/admin/agents/${agent}`)
      expect(await value<string>(`select count(*)::text v from agents where id = $1`, [agent])).toBe("0")

      const records = await geral.get(`/api/v1/admin/workflows/${workflow}/enrollments/${enrollment}/agent-records`)
      expect(records.status, JSON.stringify(records.body)).toBe(200)
      expect(JSON.stringify(records.body.data)).toContain(name)
      expect(await firstColumn("agent_executions", "agent", "id", run), "a Consultar dados também").toEqual([name])
      await expectRestored("AGENT", agent)
      expect(await value<boolean>(`select active v from agents where id = $1`, [agent])).toBe(false)
    })

    it("Agent barra por execução em andamento, e execução presa há dias não barra", async () => {
      const agent = await newAgent()
      const run = await one(`insert into agent_runs (organization_id, agent_id, source, input_context, status) values ($1, $2, 'WORKFLOW', 'prova', 'PENDING')`, [ORG, agent])
      const refused = await geral.delete(`/api/v1/admin/agents/${agent}`)
      expect(refused.status).toBe(409)
      expect(refused.body.error.code).toBe("AGENT_DELETE_BLOCKED")
      expect(refused.body.error.message).toContain("execução em andamento")
      await pool.query(`update agent_runs set created_at = now() - interval '3 days' where id = $1`, [run])
      await remove(`/api/v1/admin/agents/${agent}`)
    })

    it("indicador com medições sai dos painéis, o código fica livre e os dados continuam guardados", async () => {
      const indicator = await newIndicator()
      const code = await value<string>(`select code v from indicator_definitions where id = $1`, [indicator])
      const measurement = await newMeasurement(indicator)

      await remove(`/api/v1/admin/indicator-rules/definitions/${indicator}`)
      expect(await value<string>(`select count(*)::text v from indicator_definitions where code = $1 and organization_id = $2`, [code, ORG])).toBe("0")
      expect(await value<string>(`select count(*)::text v from indicator_measurements_all where id = $1 and cancelled_at is null`, [measurement]), "a medição fica").toBe("1")
      expect(await firstColumn("indicator_measurements", "indicator", "indicator", code), "a Consultar dados continua mostrando o código").toEqual([code])

      // É a saída para um indicador cadastrado errado: cria o certo com o mesmo código.
      const replacement = await one(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction, active, official_closure_supported) values ($1, $2, 'Indicador certo', 'COUNT', 'HIGHER', true, true)`, [ORG, code])
      const blocked = await preview("INDICATOR", indicator)
      expect(blocked.body.data.canRestore).toBe(false)
      expect(blocked.body.data.problems[0].message).toContain(code)
      await remove(`/api/v1/admin/indicator-rules/definitions/${replacement}`)
      await expectRestored("INDICATOR", indicator)
      expect(await value<boolean>(`select active v from indicator_definitions where id = $1`, [indicator]), "volta desligado, com o histórico").toBe(false)
    })

    it("indicador barra por execução em andamento e por política de acompanhamento", async () => {
      const indicator = await newIndicator()
      const code = await value<string>(`select code v from indicator_definitions where id = $1`, [indicator])
      const measurement = await newMeasurement(indicator)
      const workflow = await newWorkflow()
      const version = await one(`insert into workflow_versions (workflow_id, graph) values ($1, '{"nodes":[],"edges":[]}')`, [workflow])
      const enrollment = await one(`insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, indicator_measurement_id) values ($1, $2, $3, 'x', 'waiting', now(), $4)`, [ORG, workflow, version, measurement])
      const running = await geral.delete(`/api/v1/admin/indicator-rules/definitions/${indicator}`)
      expect(running.status).toBe(409)
      expect(running.body.error.code).toBe("INDICATOR_HAS_DEPENDENTS")
      expect(running.body.error.message).toContain("em andamento")
      await pool.query(`update workflow_enrollments set status = 'completed' where id = $1`, [enrollment])

      const policy = await newPolicy({ rules: [{ condition: { kind: "SUPPORTED_DIAGNOSIS", indicatorCode: code } }] })
      const cited = await geral.delete(`/api/v1/admin/indicator-rules/definitions/${indicator}`)
      expect(cited.status).toBe(409)
      expect(cited.body.error.message).toContain("política")
      await pool.query(`update intervention_policies set active = false where id = $1`, [policy])
      await remove(`/api/v1/admin/indicator-rules/definitions/${indicator}`)
    })

    it("flag com interações sai, e barra só por Workflow ou política que a usem", async () => {
      const flag = await newFlag()
      const flagName = await value<string>(`select flag_name v from channel_flags where id = $1`, [flag])
      const interaction = await newInteraction()
      await pool.query(`insert into interaction_flags (organization_id, interaction_id, channel_flag_id, value_boolean) values ($1, $2, $3, true)`, [ORG, interaction, flag])
      const workflow = await one(`insert into workflows (organization_id, name, active, scope_type, draft_scope_type, draft_graph, trigger_config) values ($1, $2, true, 'ALL_TEAMS', 'ALL_TEAMS', '{"nodes":[],"edges":[]}', $3)`, [ORG, unique("Workflow da flag "), JSON.stringify({ kind: "channel_flag", channelFlagId: flag })])
      const byWorkflow = await geral.delete(`/api/v1/admin/channel-flags/${flag}`)
      expect(byWorkflow.status).toBe(409)
      expect(byWorkflow.body.error.code).toBe("CHANNEL_FLAG_IN_USE")
      expect(byWorkflow.body.error.message).toContain("Workflow")
      await remove(`/api/v1/admin/workflows/${workflow}`)

      const policy = await newPolicy({ rules: [{ condition: { kind: "INTERACTION_FLAG", channel: "VOICE", flagName } }] })
      const byPolicy = await geral.delete(`/api/v1/admin/channel-flags/${flag}`)
      expect(byPolicy.status).toBe(409)
      expect(byPolicy.body.error.message).toContain("política")
      await pool.query(`update intervention_policies set active = false where id = $1`, [policy])

      await remove(`/api/v1/admin/channel-flags/${flag}`)
      expect(await value<string>(`select count(*)::text v from interaction_flags where channel_flag_id = $1`, [flag]), "a interação continua com a flag").toBe("1")
      expect(await firstColumn("interaction_flags", "flag", "protocol", await value<string>(`select external_id v from interactions where id = $1`, [interaction])), "e a Consultar dados mostra o nome").toEqual([flagName])
    })

    it("produto com abrangência encerrada sai, com abrangência aberta barra", async () => {
      const node = await newNode()
      const document = await newDocument()
      const scope = await one(`insert into product_scope_assignments (organization_id, source_kind, source_id, node_ids, effective_from) values ($1, 'KNOWLEDGE_DOCUMENT', $2, $3, now() - interval '2 days')`, [ORG, document, [node]])
      const open = await geral.delete(`/api/v1/admin/product-catalog/nodes/${node}`)
      expect(open.status).toBe(409)
      expect(open.body.error.code).toBe("PRODUCT_NODE_IN_USE")
      await pool.query(`update product_scope_assignments set effective_until = now() - interval '1 day' where id = $1`, [scope])
      await remove(`/api/v1/admin/product-catalog/nodes/${node}`)
    })

    it("Orquestrador citado por Workflow vivo barra, e quando o Workflow sai ele também pode sair", async () => {
      const orchestrator = await one(`insert into assistant_orchestrators (organization_id, name, orchestrator_agent_id, scope_type, active, policy_kind) values ($1, $2, $3, 'ALL_TEAMS', false, 'OPEN')`, [ORG, unique("Orquestrador citado "), await newAgent()])
      const workflow = await one(`insert into workflows (organization_id, name, active, scope_type, draft_scope_type, draft_graph) values ($1, $2, false, 'ALL_TEAMS', 'ALL_TEAMS', $3)`, [ORG, unique("Workflow citando "), JSON.stringify({ nodes: [{ id: "x", type: "orchestrator", label: "Etapa", position: { x: 0, y: 0 }, config: { orchestratorId: orchestrator } }], edges: [] })])
      const refused = await geral.delete(`/api/v1/admin/assistant-orchestrators/${orchestrator}`)
      expect(refused.status).toBe(409)
      expect(refused.body.error.code).toBe("ORCHESTRATOR_DELETE_BLOCKED")
      await remove(`/api/v1/admin/workflows/${workflow}`)
      await remove(`/api/v1/admin/assistant-orchestrators/${orchestrator}`)
    })
  })

  describe("Report volta pela tela de Reports, sem precisar da Consultar dados", () => {
    const newDeletedReport = (owner: "op" | "dados") => one(
      `insert into reports (organization_id, owner_account_id, owner_person_id, name, status, origin, audience_mode, definition, visualization, schedule, audience, analysis, time_zone, deleted_at, deleted_by_account_id)
       values ($1, $2, $3, $4, 'INACTIVE', 'SCREEN', 'SELF', '{}', '{}', '{}', '{}', '{}', 'America/Sao_Paulo', now(), $2)`,
      [ORG, accounts[owner], people[owner], unique("Report ")],
    )

    it("o dono vê e restaura o próprio, inativo; o de outra pessoa não existe para ele", async () => {
      await pool.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, 'REPORT', 'ORGANIZATION', now())`, [ORG, accounts.op])
      expect((await operador.get(ITEMS)).status, "não tem a Consultar dados").toBe(403)
      const own = await newDeletedReport("op")
      const other = await newDeletedReport("dados")
      const list = await operador.get("/api/v1/reports/deleted")
      expect(list.status, JSON.stringify(list.body)).toBe(200)
      expect(list.body.data.map((item: { id: string }) => item.id)).toEqual([own])
      expect((await operador.post(`/api/v1/reports/${other}/restore`)).status).toBe(404)
      expect((await operador.post(`/api/v1/reports/${own}/restore`)).status).toBe(204)
      expect(await value<string>(`select status v from reports where id = $1 and deleted_at is null`, [own])).toBe("INACTIVE")
      expect((await operador.post(`/api/v1/reports/${own}/restore`)).status, "já voltou").toBe(404)
      expect(await value<string>(`select count(*)::text v from audit_logs where action = 'REPORT_RESTORED' and entity_id = $1`, [own])).toBe("1")
      await pool.query(`delete from access_role_assignments where user_account_id = $1 and role_code = 'REPORT'`, [accounts.op])
    })

    it("sem acesso a Reports, nada", async () => {
      expect((await operador.get("/api/v1/reports/deleted")).status).toBe(403)
    })
  })

  it("conexão de IA: os modelos que saíram junto voltam desabilitados, o excluído antes não volta e a credencial segue revogada", async () => {
    const connection = await newConnection()
    const earlier = await newModel(connection)
    const together = await newModel(connection)
    await pool.query(`insert into ai_connection_secrets (organization_id, connection_id, purpose, ciphertext, iv, auth_tag) values ($1, $2, 'API_KEY', '\\x00', '\\x00', '\\x00')`, [ORG, connection])
    await pool.query(`insert into ai_model_pricing (organization_id, model_id, currency, input_per_million, output_per_million, effective_from) values ($1, $2, 'USD', 1, 1, now())`, [ORG, together])
    await remove(`/api/v1/admin/ai/models/${earlier}`)
    await remove(`/api/v1/admin/ai/connections/${connection}`)
    expect(await value<string>(`select count(*)::text v from ai_connection_secrets where connection_id = $1 and revoked_at is null`, [connection])).toBe("0")
    expect(await value<string>(`select count(*)::text v from ai_model_pricing where model_id = $1`, [together]), "preço continua").toBe("1")

    const items = await listed()
    expect(items.some((entry) => entry.id === together), "quem saiu junto aparece só pela conexão").toBe(false)
    expect(items.some((entry) => entry.id === earlier)).toBe(true)
    expect((await preview("AI_MODEL", earlier)).body.data.canRestore).toBe(false)

    await expectRestored("AI_CONNECTION", connection)
    expect(await value<boolean>(`select not enabled v from ai_models where id = $1`, [together])).toBe(true)
    expect(await value<string>(`select count(*)::text v from ai_models where id = $1`, [earlier]), "excluído antes continua excluído").toBe("0")
    expect(await value<string>(`select count(*)::text v from ai_connection_secrets where connection_id = $1 and revoked_at is null`, [connection])).toBe("0")
    await expectRestored("AI_MODEL", earlier)
  })

  it("fonte de dados: os conjuntos que saíram junto voltam pausados, o excluído antes não volta, e credencial e token seguem revogados", async () => {
    const source = await newSource()
    const earlier = await newFeed(source)
    const together = await newFeed(source)
    await pool.query(`insert into data_secrets (organization_id, source_id, purpose, ciphertext, iv, auth_tag) values ($1, $2, 'API_TOKEN', '\\x00', '\\x00', '\\x00')`, [ORG, source])
    await remove(`/api/v1/admin/data-hub/feeds/${earlier}`)
    await remove(`/api/v1/admin/data-hub/sources/${source}`)
    const items = await listed()
    expect(items.some((entry) => entry.id === together)).toBe(false)
    expect(items.some((entry) => entry.id === earlier)).toBe(true)
    expect((await preview("DATA_FEED", earlier)).body.data.canRestore).toBe(false)

    await expectRestored("DATA_SOURCE", source)
    expect(await value<string>(`select status v from data_feeds where id = $1 and deleted_at is null`, [together])).toBe("PAUSED")
    expect(await value<string>(`select count(*)::text v from data_feeds where id = $1 and deleted_at is null`, [earlier])).toBe("0")
    expect(await value<string>(`select count(*)::text v from data_secrets where source_id = $1 and revoked_at is null`, [source])).toBe("0")
    await expectRestored("DATA_FEED", earlier)
  })

  it("conjunto oficial: restaurar é barrado se outro virou a fonte oficial do mesmo dado", async () => {
    const contract = unique("oficial_")
    const source = await newSource()
    const first = await newFeed(source, true, contract)
    await remove(`/api/v1/admin/data-hub/feeds/${first}`)
    const second = await newFeed(source, true, contract)
    const blocked = await preview("DATA_FEED", first)
    expect(blocked.body.data.canRestore).toBe(false)
    expect(blocked.body.data.problems[0].code).toBe("DELETED_ITEM_AUTHORITATIVE_IN_USE")
    await pool.query(`update data_feeds set authoritative = false where id = $1`, [second])
    await expectRestored("DATA_FEED", first)
  })

  it("cenário padrão: excluir volta o padrão para nenhum, e restaurar não o devolve", async () => {
    const scene = await newScene()
    await pool.query(`insert into inia_scene_settings (organization_id, default_scene_id) values ($1, $2) on conflict (organization_id) do update set default_scene_id = excluded.default_scene_id`, [ORG, scene])
    await remove(`/api/v1/admin/inia-scenes/${scene}`)
    expect(await value<string | null>(`select default_scene_id::text v from inia_scene_settings where organization_id = $1`, [ORG])).toBeNull()
    await expectRestored("INIA_SCENE", scene)
    expect(await value<string | null>(`select default_scene_id::text v from inia_scene_settings where organization_id = $1`, [ORG])).toBeNull()
    // O gatilho de consistência continua valendo depois de a tabela mudar de nome.
    await pool.query(`update inia_scenes set name = $1 where id = $2`, [unique("Cenário R "), scene])
    await expect(pool.query(`delete from inia_scene_images where scene_id = $1`, [scene])).rejects.toThrow(/imagem/)
  })

  it("feriado: a tela grava de novo o mesmo feriado sem reviver o excluído", async () => {
    const id = await one(`insert into organization_holidays (organization_id, holiday_date, name, active) values ($1, '2031-05-01', 'Feriado repetido', true)`, [ORG])
    await remove(`/api/v1/admin/operational-calendar/holidays/${id}`)
    const created = await geral.post("/api/v1/admin/operational-calendar/holidays").send({ date: "2031-05-01", name: "Feriado repetido", scope: "NATIONAL", active: true })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect(created.body.data.id).not.toBe(id)
    const again = await geral.post("/api/v1/admin/operational-calendar/holidays").send({ date: "2031-05-01", name: "Feriado repetido", scope: "NATIONAL", active: false })
    expect(again.status, JSON.stringify(again.body)).toBe(201)
    expect(again.body.data.id, "o upsert continua atualizando o vivo").toBe(created.body.data.id)
    expect((await preview("HOLIDAY", id)).body.data.canRestore).toBe(false)
  })

  it("execução interrompida pela exclusão aceita nova tentativa depois de restaurar e ativar", async () => {
    const workflow = await newWorkflow()
    const version = await one(`insert into workflow_versions (workflow_id, graph) values ($1, '{"nodes":[],"edges":[]}')`, [workflow])
    await pool.query(`update workflows set active_version_id = $1 where id = $2`, [version, workflow])
    const enrollment = await one(`insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, scheduled_subject_id) values ($1, $2, $3, 'x', 'waiting', now(), $4)`, [ORG, workflow, version, people.op])
    await remove(`/api/v1/admin/workflows/${workflow}`)
    expect(await value<string>(`select blocked_reason v from workflow_enrollments where id = $1`, [enrollment])).toBe("WORKFLOW_DELETED")
    await expectRestored("WORKFLOW", workflow)
    expect(await value<boolean>(`select active v from workflows where id = $1`, [workflow]), "volta pausado").toBe(false)
    expect(await value<string>(`select status v from workflow_enrollments where id = $1`, [enrollment]), "não volta a rodar sozinha").toBe("blocked")
    const paused = await geral.get(`/api/v1/admin/workflows/${workflow}/enrollments/${enrollment}/retry`)
    expect(paused.status, JSON.stringify(paused.body)).toBe(200)
    expect(paused.body.data.blockers.map((blocker: { code: string }) => blocker.code)).toContain("WORKFLOW_RETRY_WORKFLOW_INACTIVE")
    await pool.query(`update workflows set active = true where id = $1`, [workflow])
    const active = await geral.get(`/api/v1/admin/workflows/${workflow}/enrollments/${enrollment}/retry`)
    expect(active.body.data.blockers.map((blocker: { code: string }) => blocker.code)).not.toContain("WORKFLOW_RETRY_WORKFLOW_INACTIVE")
  })

  describe("o que a revisão independente provou", () => {
    const newToken = (source: string, feed: string | null) => one(`insert into data_push_tokens (organization_id, source_id, feed_id, label, token_prefix, token_hash) values ($1, $2, $3, 'Token', 'inia_push_', $4)`, [ORG, source, feed, unique("hash-")])
    const tokenRevoked = (token: string) => value<boolean>(`select revoked_at is not null v from data_push_tokens where id = $1`, [token])

    it("token do conjunto é revogado ao excluir e segue revogado depois de restaurar", async () => {
      const source = await newSource()
      const feed = await newFeed(source)
      const token = await newToken(source, feed)
      const otherFeed = await newFeed(source)
      const otherToken = await newToken(source, otherFeed)
      await remove(`/api/v1/admin/data-hub/feeds/${feed}`)
      expect(await tokenRevoked(token)).toBe(true)
      expect(await tokenRevoked(otherToken), "token de outro conjunto não muda").toBe(false)
      await expectRestored("DATA_FEED", feed)
      expect(await tokenRevoked(token)).toBe(true)
    })

    it("fonte excluída antes de existir a revogação não devolve credencial nem token", async () => {
      const source = await newSource()
      const token = await newToken(source, null)
      await pool.query(`insert into data_secrets (organization_id, source_id, purpose, ciphertext, iv, auth_tag) values ($1, $2, 'API_TOKEN', '\\x00', '\\x00', '\\x00')`, [ORG, source])
      await pool.query(`update data_sources set deleted_at = now(), status = 'PAUSED' where id = $1`, [source])
      expect(await value<string>(`select count(*)::text v from data_secrets where source_id = $1 and revoked_at is null`, [source]), "como ficou a fonte antiga").toBe("1")
      await expectRestored("DATA_SOURCE", source)
      expect(await value<string>(`select count(*)::text v from data_secrets where source_id = $1 and revoked_at is null`, [source])).toBe("0")
      expect(await tokenRevoked(token)).toBe(true)
    })

    it("Workflow só volta sem citar Agent, Orquestrador, indicador ou flag excluídos", async () => {
      const citing = (config: Record<string, unknown>) => ({ nodes: [{ id: "x", type: "agent", label: "Etapa", position: { x: 0, y: 0 }, config }], edges: [] })
      const newCiting = (graph: unknown, trigger: unknown = null) => one(`insert into workflows (organization_id, name, active, scope_type, draft_scope_type, draft_graph, trigger_config) values ($1, $2, false, 'ALL_TEAMS', 'ALL_TEAMS', $3, $4)`, [ORG, unique("Workflow citando "), JSON.stringify(graph), trigger ? JSON.stringify(trigger) : null])

      const agent = await newAgent()
      const usingAgent = await newCiting(citing({ agentId: agent }))
      expect((await geral.delete(`/api/v1/admin/agents/${agent}`)).status, "Workflow vivo segura o Agent").toBe(409)
      await remove(`/api/v1/admin/workflows/${usingAgent}`)
      await remove(`/api/v1/admin/agents/${agent}`)
      const blocked = await preview("WORKFLOW", usingAgent)
      expect(blocked.body.data.canRestore).toBe(false)
      expect(blocked.body.data.problems[0].message).toContain("Agent")
      expect((await restore("WORKFLOW", usingAgent)).status).toBe(409)
      await expectRestored("AGENT", agent)
      await expectRestored("WORKFLOW", usingAgent)

      const orchestrator = await one(`insert into assistant_orchestrators (organization_id, name, orchestrator_agent_id, scope_type, active, policy_kind) values ($1, $2, $3, 'ALL_TEAMS', false, 'OPEN')`, [ORG, unique("Orquestrador W "), await newAgent()])
      const usingOrchestrator = await newCiting(citing({ orchestratorId: orchestrator }))
      await remove(`/api/v1/admin/workflows/${usingOrchestrator}`)
      await remove(`/api/v1/admin/assistant-orchestrators/${orchestrator}`)
      expect((await preview("WORKFLOW", usingOrchestrator)).body.data.problems[0].message).toContain("Orquestrador")

      const flag = await newFlag()
      const usingFlag = await newCiting({ nodes: [], edges: [] }, { channelFlagId: flag })
      await remove(`/api/v1/admin/workflows/${usingFlag}`)
      await remove(`/api/v1/admin/channel-flags/${flag}`)
      expect((await preview("WORKFLOW", usingFlag)).body.data.problems[0].message).toContain("flag")

      const indicator = await newIndicator()
      const code = await value<string>(`select code v from indicator_definitions where id = $1`, [indicator])
      const usingIndicator = await newCiting(citing({ indicatorCode: code }))
      expect((await geral.delete(`/api/v1/admin/indicator-rules/definitions/${indicator}`)).status, "Workflow vivo segura o indicador").toBe(409)
      await remove(`/api/v1/admin/workflows/${usingIndicator}`)
      await remove(`/api/v1/admin/indicator-rules/definitions/${indicator}`)
      expect((await preview("WORKFLOW", usingIndicator)).body.data.problems[0].message).toContain("indicador")
      // Outro indicador com o mesmo código resolve: o Workflow cita pelo código.
      await pool.query(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction, active, official_closure_supported) values ($1, $2, 'Indicador novo', 'COUNT', 'HIGHER', true, true)`, [ORG, code])
      expect((await preview("WORKFLOW", usingIndicator)).body.data.canRestore).toBe(true)
    })

    it("a mensagem do que barra diz o que restaurar primeiro, no singular e no plural", () => {
      const orchestrator = DELETED_ITEMS.find((item) => item.type === "ORCHESTRATOR")!
      const check = orchestrator.checks.find((entry) => entry.code === "DELETED_ITEM_PARENT_DELETED")!
      expect(check.message(["Atendimento"])).toBe('Restaure primeiro o Agent "Atendimento", que está entre os itens excluídos.')
      expect(check.message(["Atendimento", "Faturamento"])).toBe('Restaure primeiro os Agents "Atendimento", "Faturamento", que estão entre os itens excluídos.')
    })

    it("indício excluído não prende o produto, e só volta com o produto vivo", async () => {
      const node = await newNode()
      const criterion = await one(`insert into product_identification_criteria (organization_id, title, status) values ($1, $2, 'ACTIVE')`, [ORG, unique("Indício P ")])
      await pool.query(`insert into product_identification_criterion_versions (organization_id, criterion_id, version, status, statement, target_node_ids, strength, content_hash, effective_from, approved_at) values ($1, $2, 1, 'APPROVED', 'Afirmação do indício', $3, 'INDICATIVE', 'h', now() - interval '1 day', now() - interval '1 day')`, [ORG, criterion, [node]])
      expect((await geral.delete(`/api/v1/admin/product-catalog/nodes/${node}`)).status, "indício vivo segura o produto").toBe(409)
      await remove(`/api/v1/admin/product-catalog/criteria/${criterion}`)
      await remove(`/api/v1/admin/product-catalog/nodes/${node}`)
      expect((await preview("PRODUCT_CRITERION", criterion)).body.data.canRestore).toBe(false)
      await expectRestored("PRODUCT_NODE", node)
      await expectRestored("PRODUCT_CRITERION", criterion)
    })

    it("flag restaurada não volta apontando para indicador excluído", async () => {
      const indicator = await newIndicator()
      const flag = await newFlag()
      await pool.query(`update channel_flags set related_indicator_definition_id = $1 where id = $2`, [indicator, flag])
      await remove(`/api/v1/admin/channel-flags/${flag}`)
      await remove(`/api/v1/admin/indicator-rules/definitions/${indicator}`)
      await expectRestored("CHANNEL_FLAG", flag)
      expect(await value<string | null>(`select related_indicator_definition_id::text v from channel_flags where id = $1`, [flag])).toBeNull()
    })

    it("imagem de cenário excluído deixa de ser servida e volta com ele", async () => {
      const scene = await newScene()
      const image = await value<string>(`select id::text v from inia_scene_images where scene_id = $1`, [scene])
      expect((await geral.get(`/api/v1/inia-scenes/images/${image}`)).status).toBe(200)
      await remove(`/api/v1/admin/inia-scenes/${scene}`)
      expect((await geral.get(`/api/v1/inia-scenes/images/${image}`)).status).toBe(404)
      expect((await geral.get(`/api/v1/inia-scenes/${scene}/image`)).status).toBe(404)
      await expectRestored("INIA_SCENE", scene)
      expect((await geral.get(`/api/v1/inia-scenes/images/${image}`)).status).toBe(200)
    })

    it("regra e glossário não entram em indicador excluído: a chave estrangeira não recusa mais", async () => {
      const indicator = await newIndicator()
      await remove(`/api/v1/admin/indicator-rules/definitions/${indicator}`)
      const rule = await geral.post("/api/v1/admin/indicator-rules").send({ indicatorDefinitionId: indicator, scopeType: "ALL_TEAMS", calculationPeriod: "MONTHLY", calculationMethod: "Média do mês" })
      expect(rule.status).toBe(404)
      const glossary = await geral.put("/api/v1/admin/indicator-rules/glossary").send({ indicatorDefinitionId: indicator, description: "Descrição", interpretation: "Interpretação", goodPractices: "Boas práticas", feedbackGuidance: "Orientação" })
      expect(glossary.status).toBe(404)
    })

    it("Agent volta inativo, então restaurar exige também a permissão de mexer em inativo", () => {
      const agent = DELETED_ITEMS.find((item) => item.type === "AGENT")!
      expect(agent.access).toEqual({ permissions: ["agents.manage", "agents.inactive.manage"] })
    })

    describe("duas pessoas ao mesmo tempo, em conexões separadas", () => {
      const stillWaiting = async (pending: Promise<unknown>) => {
        const marker = Symbol("esperando")
        return (await Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve(marker), 300))])) === marker
      }

      it("restaurar espera a exclusão do pai terminar, e então é barrado", async () => {
        const domain = await newDomain()
        const agent = await newAgent()
        await pool.query(`update agents set business_domain_id = $1 where id = $2`, [domain, agent])
        await remove(`/api/v1/admin/agents/${agent}`)
        const other = await pool.connect()
        try {
          await other.query("begin")
          await other.query(`select 1 from business_domains where id = $1 for update`, [domain])
          await other.query(`update business_domains_all set active = false, deleted_at = now() where id = $1`, [domain])
          const pending = restore("AGENT", agent).then((response) => response)
          expect(await stillWaiting(pending), "a restauração espera o pai").toBe(true)
          await other.query("commit")
          const response = await pending
          expect(response.status).toBe(409)
          expect(response.body.error.code).toBe("DELETED_ITEM_RESTORE_BLOCKED")
        } finally {
          other.release()
        }
        expect(await value<string>(`select count(*)::text v from agents where id = $1`, [agent]), "Agent continua excluído").toBe("0")
        await expectRestored("BUSINESS_DOMAIN", domain)
        await expectRestored("AGENT", agent)
      })

      it("excluir o pai espera a restauração terminar, e então é barrado", async () => {
        const domain = await newDomain()
        const agent = await newAgent()
        await pool.query(`update agents set business_domain_id = $1 where id = $2`, [domain, agent])
        await remove(`/api/v1/admin/agents/${agent}`)
        const other = await pool.connect()
        try {
          await other.query("begin")
          await other.query(`select 1 from business_domains where id = $1 for share`, [domain])
          await other.query(`update agents_all set deleted_at = null, deleted_by_person_id = null where id = $1`, [agent])
          const pending = geral.delete(`/api/v1/admin/business-domains/${domain}`).then((response) => response)
          expect(await stillWaiting(pending), "a exclusão espera a restauração").toBe(true)
          await other.query("commit")
          const response = await pending
          expect(response.status).toBe(409)
          expect(response.body.error.code).toBe("BUSINESS_DOMAIN_IN_USE")
        } finally {
          other.release()
        }
        expect(await value<string>(`select count(*)::text v from business_domains where id = $1`, [domain]), "domínio continua vivo").toBe("1")
      })
    })
  })

  describe("quem vê e quem restaura", () => {
    it("Administrador de dados só vê o que gerencia; o resto responde como se não existisse", async () => {
      const agent = await newAgent()
      await remove(`/api/v1/admin/agents/${agent}`)
      const source = await newSource()
      await remove(`/api/v1/admin/data-hub/sources/${source}`)

      const catalog = await dados.get("/api/v1/admin/data-explorer/datasets")
      expect(catalog.body.data.deletedItemTypes.map((entry: { type: string }) => entry.type).sort()).toEqual(["DATA_FEED", "DATA_SOURCE", "REPORT"])
      const items = await listed(dados)
      expect(items.some((entry) => entry.id === source)).toBe(true)
      expect(items.some((entry) => entry.id === agent)).toBe(false)
      expect((await dados.get(`${ITEMS}?type=AGENT`)).body.data.items).toEqual([])
      expect((await preview("AGENT", agent, dados)).status).toBe(404)
      expect((await restore("AGENT", agent, dados)).status).toBe(404)
      expect(await value<string>(`select count(*)::text v from agents where id = $1`, [agent]), "nada voltou").toBe("0")
      await expectRestored("AGENT", agent)
      expect((await restore("DATA_SOURCE", source, dados)).status).toBe(200)
    })

    it("sem a consulta, nada; de outra organização, não existe", async () => {
      const agent = await newAgent()
      await remove(`/api/v1/admin/agents/${agent}`)
      expect((await operador.get(ITEMS)).status).toBe(403)
      expect((await restore("AGENT", agent, operador)).status).toBe(403)
      expect((await listed(outra)).some((entry) => entry.id === agent)).toBe(false)
      expect((await preview("AGENT", agent, outra)).status).toBe(404)
      expect((await restore("AGENT", agent, outra)).status).toBe(404)
      expect(await value<string>(`select count(*)::text v from agents where id = $1`, [agent])).toBe("0")
      await expectRestored("AGENT", agent)
    })

    it("Report só aparece e volta para quem o criou, inativo", async () => {
      const report = await one(
        `insert into reports (organization_id, owner_account_id, owner_person_id, name, status, origin, audience_mode, definition, visualization, schedule, audience, analysis, time_zone, deleted_at, deleted_by_account_id)
         values ($1, $2, $3, 'Report do dono', 'INACTIVE', 'SCREEN', 'SELF', '{}', '{}', '{}', '{}', '{}', 'America/Sao_Paulo', now(), $2)`,
        [ORG, accounts.dados, people.dados],
      )
      expect((await listed(geral)).some((entry) => entry.id === report)).toBe(false)
      expect((await preview("REPORT", report, geral)).status).toBe(404)
      expect((await restore("REPORT", report, geral)).status).toBe(404)
      const own = (await listed(dados)).find((entry) => entry.id === report)
      expect(own?.deletedBy).toBe("M-dados")
      expect((await restore("REPORT", report, dados)).status).toBe(200)
      expect(await value<string>(`select status v from reports where id = $1 and deleted_at is null`, [report])).toBe("INACTIVE")
    })

    it("tipo inventado e id inválido respondem como inexistentes", async () => {
      const agent = await newAgent()
      expect((await preview("__proto__", agent)).status).toBe(404)
      expect((await preview("AGENT", "nao-e-uuid")).status).toBe(404)
      expect((await restore("AGENT", agent)).status, "Agent vivo não tem o que restaurar").toBe(404)
    })
  })

  it("busca filtra pelo nome, e a auditoria guarda a restauração sem guardar o termo buscado", async () => {
    const name = unique("Agent Buscável Único ")
    const agent = await newAgent(name)
    await remove(`/api/v1/admin/agents/${agent}`)
    const found = await listed(geral, `?search=${encodeURIComponent("buscável único")}`)
    expect(found.map((entry) => entry.id)).toContain(agent)
    expect((await listed(geral, `?search=${encodeURIComponent("não existe esse nome")}`)).length).toBe(0)
    await expectRestored("AGENT", agent)
    const logs = (await pool.query<{ action: string; payload: Record<string, unknown> }>(`select action, payload from audit_logs where organization_id = $1 and action like 'DATA_HUB_DELETED_%'`, [ORG])).rows
    expect(JSON.stringify(logs)).not.toContain("não existe esse nome")
    const restored = logs.find((log) => log.action === "DATA_HUB_DELETED_ITEM_RESTORED" && log.payload.itemId === agent)
    expect(restored?.payload).toMatchObject({ itemType: "AGENT", itemName: name, accountId: accounts.geral })
    expect(logs.some((log) => log.action === "DATA_HUB_DELETED_ITEMS_LIST" && log.payload.searched === true)).toBe(true)
    expect(await value<string>(`select count(*)::text v from audit_logs where organization_id = $1 and action = 'AGENT_DELETED' and entity_id = $2`, [ORG, agent])).toBe("1")
  })
})
