/**
 * PROVA contra o banco de teste real: excluir um Workflow não apaga nada. Ele sai das telas e para de rodar, e o histórico continua guardado e visível na Consultar dados.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run workflow-logical-deletion-proof --no-file-parallelism
 * Duas organizações próprias, apagadas no fim. Nenhuma chamada de IA nem rede externa.
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { loadIndicatorDependencies } from "../../indicators/application/indicator-dependencies.js"
import { runWorkflowTick } from "../application/engine.js"
import { enrollIndicatorWorkflows } from "../application/indicator-enrollment.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "ce00ee00-0000-4000-8000-0000000d0175"
const ORG_B = "ce00ee00-0000-4000-8000-0000000e0175"
const PASSWORD = "Prova@WorkflowExcluido-2026"
const WORKFLOWS = "/api/v1/admin/workflows"
const EXPLORER = "/api/v1/admin/data-explorer"

let pool: pg.Pool
let geral: ReturnType<typeof request.agent>
let dados: ReturnType<typeof request.agent>
let outraOrganizacao: ReturnType<typeof request.agent>
let operador: ReturnType<typeof request.agent>
const people: Record<string, string> = {}
let team = ""

const one = async (sql: string, params: unknown[]) => (await pool.query<{ id: string }>(`${sql} returning id`, params)).rows[0]!.id
const rows = async (sql: string, params: unknown[]) => Number((await pool.query<{ n: string }>(`select count(*) n from ${sql}`, params)).rows[0]!.n)

async function cleanup() {
  for (const org of [ORG, ORG_B]) {
    await pool.query(`update workflows_all set active_version_id = null where organization_id = $1`, [org])
    for (const table of ["interaction_feedback_generations", "workflow_enrollment_events", "workflow_outputs", "workflow_enrollments", "workflow_versions", "workflows_all", "agent_runs", "agent_versions", "agents_all", "transcripts", "interactions", "indicator_measurements_all", "indicator_definitions", "audit_logs", "access_role_assignments", "user_accounts", "people", "teams", "operations"]) {
      if (table === "workflow_enrollment_events") await pool.query(`delete from workflow_enrollment_events where enrollment_id in (select id from workflow_enrollments where organization_id = $1)`, [org])
      else if (table === "workflow_versions") await pool.query(`delete from workflow_versions where workflow_id in (select id from workflows_all where organization_id = $1)`, [org])
      else if (table === "agent_versions") await pool.query(`delete from agent_versions where agent_id in (select id from agents_all where organization_id = $1)`, [org])
      else await pool.query(`delete from ${table} where organization_id = $1`, [org])
    }
    await pool.query(`delete from organizations where id = $1`, [org])
  }
}

async function account(key: string, org: string, role?: string, person?: string) {
  const personId = person ?? (await one(`insert into people (organization_id, name, role, job_title, matricula, current_employment_status) values ($1, $2, 'ADMIN', 'A', $3, 'EM_PRODUCAO')`, [org, `Pessoa ${key}`, `M-${key}`]))
  people[key] = personId
  const accountId = await one(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4)`, [org, personId, `${key}@prova-workflow.inia.local`, await hashPassword(PASSWORD)])
  if (role) await pool.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, $3, 'ORGANIZATION', now())`, [org, accountId, role])
}

const node = (id: string, type: string, label: string, config: Record<string, unknown> = {}) => ({ id, type, label, position: { x: 0, y: 0 }, config })
const graph = { nodes: [node("trigger", "trigger", "Gatilho"), node("x", "condition", "Condição", { comparator: "GTE", thresholdNumeric: 1, thresholdBoolean: null }), node("end", "end", "Fim")], edges: [{ id: "a", source: "trigger", sourceHandle: "always", target: "x" }, { id: "b", source: "x", sourceHandle: "true", target: "end" }, { id: "c", source: "x", sourceHandle: "false", target: "end" }] }

async function newWorkflow(name: string, triggerConfig: Record<string, unknown> = { kind: "manual", context: "COLLABORATOR" }, currentGraph: unknown = graph) {
  const workflow = await one(`insert into workflows (organization_id, name, active, scope_type, draft_scope_type, trigger_config, draft_graph) values ($1, $2, true, 'ALL_TEAMS', 'ALL_TEAMS', $3, $4)`, [ORG, name, JSON.stringify(triggerConfig), JSON.stringify(currentGraph)])
  const version = await one(`insert into workflow_versions (workflow_id, graph) values ($1, $2)`, [workflow, JSON.stringify(currentGraph)])
  await pool.query(`update workflows set active_version_id = $1 where id = $2`, [version, workflow])
  return { workflow, version }
}

const enroll = (found: { workflow: string; version: string }, status: string, node_id = "x") => one(`insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, scheduled_subject_id) values ($1, $2, $3, $4, $5, now(), $6)`, [ORG, found.workflow, found.version, node_id, status, people.op])

describe.skipIf(!ENABLED)("Excluir Workflow sem apagar — prova Postgres", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    await cleanup()
    await pool.query(`insert into organizations (id, name, slug) values ($1, 'Prova workflow A', 'prova-workflow-a'), ($2, 'Prova workflow B', 'prova-workflow-b')`, [ORG, ORG_B])
    const operation = await one(`insert into operations (organization_id, name, timezone) values ($1, 'Op', 'America/Sao_Paulo')`, [ORG])
    team = await one(`insert into teams (organization_id, operation_id, name, external_code) values ($1, $2, 'Grupo', 'G')`, [ORG, operation])
    await account("geral", ORG, "ADMINISTRADOR_GERAL")
    await account("dados", ORG, "ADMINISTRADOR_DE_DADOS")
    await account("geralB", ORG_B, "ADMINISTRADOR_GERAL")
    const op = await one(`insert into people (organization_id, team_id, name, role, job_title, matricula, current_employment_status) values ($1, $2, 'Operador', 'OPERATOR', 'A', 'OP-1', 'EM_PRODUCAO')`, [ORG, team])
    await account("op", ORG, undefined, op)
    const app = createApp(pool as unknown as Database, { rateLimits: false })
    const login = async (key: string) => {
      const agent = request.agent(app)
      expect((await agent.post("/api/v1/auth/login").send({ email: `${key}@prova-workflow.inia.local`, password: PASSWORD })).status, key).toBe(200)
      return agent
    }
    geral = await login("geral")
    dados = await login("dados")
    outraOrganizacao = await login("geralB")
    operador = await login("op")
  }, 60_000)

  afterAll(async () => {
    if (pool) {
      await cleanup()
      await pool.end()
    }
  }, 60_000)

  it("nada é apagado: versões, execuções e recados ficam, e quem excluiu fica registrado", async () => {
    const found = await newWorkflow("Workflow com histórico")
    const completed = await enroll(found, "completed", "end")
    await pool.query(`insert into workflow_outputs (organization_id, enrollment_id, node_id, recipient_id, surface, content, display_text, delivery_status, delivered_at) values ($1, $2, 'out', $3, 'CHAT', '{"text":"Recado"}', 'Recado', 'DELIVERED', now())`, [ORG, completed, people.op])

    const deleted = await geral.delete(`${WORKFLOWS}/${found.workflow}`)
    expect(deleted.status).toBe(204)

    const row = (await pool.query<{ active: boolean; deleted_at: Date | null; deleted_by_person_id: string | null }>(`select active, deleted_at, deleted_by_person_id from workflows_all where id = $1`, [found.workflow])).rows[0]!
    expect(row).toMatchObject({ active: false, deleted_by_person_id: people.geral })
    expect(row.deleted_at).not.toBeNull()
    expect(await rows(`workflow_versions where workflow_id = $1`, [found.workflow])).toBe(1)
    expect(await rows(`workflow_enrollments where id = $1 and status = 'completed'`, [completed])).toBe(1)
    expect(await rows(`workflow_outputs where enrollment_id = $1`, [completed])).toBe(1)
    const audit = await pool.query<{ payload: Record<string, unknown> }>(`select payload from audit_logs where organization_id = $1 and action = 'WORKFLOW_DELETED' and entity_id = $2`, [ORG, found.workflow])
    expect(audit.rows[0]?.payload).toMatchObject({ name: "Workflow com histórico", stoppedExecutions: 0 })
  })

  it("some das telas e das rotas: lista, abrir, alterar e excluir de novo", async () => {
    const found = await newWorkflow("Workflow que some")
    await geral.delete(`${WORKFLOWS}/${found.workflow}`)
    const list = await geral.get(WORKFLOWS)
    expect(JSON.stringify(list.body)).not.toContain(found.workflow)
    expect((await geral.get(`${WORKFLOWS}/${found.workflow}`)).status).toBe(404)
    expect((await geral.patch(`${WORKFLOWS}/${found.workflow}`).send({ name: "Tentativa" })).status).toBe(404)
    expect((await geral.delete(`${WORKFLOWS}/${found.workflow}`)).status).toBe(404)
    expect((await pool.query<{ name: string }>(`select name from workflows_all where id = $1`, [found.workflow])).rows[0]?.name).toBe("Workflow que some")
  })

  it("o nome pode ser usado de novo", async () => {
    const found = await newWorkflow("Nome reaproveitado")
    await geral.delete(`${WORKFLOWS}/${found.workflow}`)
    const again = await newWorkflow("Nome reaproveitado")
    expect(again.workflow).not.toBe(found.workflow)
    expect((await geral.get(`${WORKFLOWS}/${again.workflow}`)).status).toBe(200)
  })

  it.each(["active", "waiting"])("execução %s é interrompida com o motivo e o motor não roda mais nada", async (status) => {
    const found = await newWorkflow(`Workflow com execução ${status}`)
    const enrollment = await enroll(found, status)
    expect((await geral.delete(`${WORKFLOWS}/${found.workflow}`)).status).toBe(204)
    const row = (await pool.query<{ status: string; blocked_reason: string; current_node_id: string }>(`select status, blocked_reason, current_node_id from workflow_enrollments where id = $1`, [enrollment])).rows[0]!
    expect(row).toMatchObject({ status: "blocked", blocked_reason: "WORKFLOW_DELETED", current_node_id: "x" })
    const events = (await pool.query<{ event_type: string; payload: { reason: string } }>(`select event_type, payload from workflow_enrollment_events where enrollment_id = $1`, [enrollment])).rows
    expect(events).toMatchObject([{ event_type: "node_blocked", payload: { reason: "WORKFLOW_DELETED" } }])
    await runWorkflowTick(pool as unknown as Database, { enrollmentIds: [enrollment] })
    expect((await pool.query<{ status: string; current_node_id: string }>(`select status, current_node_id from workflow_enrollments where id = $1`, [enrollment])).rows[0]).toMatchObject({ status: "blocked", current_node_id: "x" })
    expect((await geral.get(`${WORKFLOWS}/${found.workflow}/enrollments/${enrollment}/retry`)).status).toBe(404)
  })

  it("gatilho não dispara mais", async () => {
    const code = "PROVA_WF_GATILHO"
    await one(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction, operational_aggregation) values ($1, $2, 'Indicador', 'SECONDS', 'LOWER', 'SUM')`, [ORG, code])
    const measurement = "00000000-0000-4000-8000-00000000f175"
    const found = await newWorkflow("Workflow de indicador", { kind: "indicator", indicatorCode: code })
    await geral.delete(`${WORKFLOWS}/${found.workflow}`)
    expect(await enrollIndicatorWorkflows(pool as unknown as Database, { organizationId: ORG, measurementId: measurement, operatorId: people.op!, indicatorCode: code, value: 1 })).toBe(0)
  })

  it("excluído não prende indicador nem agente que ninguém mais usa", async () => {
    const code = "PROVA_WF_TRAVA"
    const indicator = await one(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction, operational_aggregation) values ($1, $2, 'Indicador', 'SECONDS', 'LOWER', 'SUM')`, [ORG, code])
    const found = await newWorkflow("Workflow que trava", { kind: "indicator", indicatorCode: code })
    const db = pool as unknown as Database
    expect((await loadIndicatorDependencies(db, ORG, { id: indicator, code })).workflows).toHaveLength(1)
    await geral.delete(`${WORKFLOWS}/${found.workflow}`)
    expect((await loadIndicatorDependencies(db, ORG, { id: indicator, code })).hasHistory).toBe(false)

    const agent = await one(`insert into agents (organization_id, name, agent_type, objective, description, context_prompt) values ($1, 'Agente', 'CALL_FEEDBACK', 'Objetivo', 'Prova', 'Contexto')`, [ORG])
    const withAgent = await newWorkflow("Workflow com agente", { kind: "manual", context: "COLLABORATOR" }, { nodes: [node("trigger", "trigger", "Gatilho"), node("x", "action", "Agente", { actionType: "CALL_AGENT", agentId: agent }), node("end", "end", "Fim")], edges: [] })
    expect((await geral.delete(`/api/v1/admin/agents/${agent}`)).status).toBe(409)
    await geral.delete(`${WORKFLOWS}/${withAgent.workflow}`)
    expect((await geral.delete(`/api/v1/admin/agents/${agent}`)).status).toBe(204)
  })

  it("Workflow que já gerou feedback de atendimento também é excluído: nenhuma chave estrangeira entra na conta", async () => {
    const found = await newWorkflow("Workflow com feedback gerado")
    const interaction = await one(`insert into interactions (organization_id, operator_id, reason, channel, started_at, ended_at, external_id) values ($1, $2, 'Motivo', 'VOICE', now() - interval '5 minutes', now(), 'P-WF-1')`, [ORG, people.op])
    await pool.query(`insert into interaction_feedback_generations (organization_id, generation_key, intent, contract_version, interaction_id, collaborator_id, workflow_id, workflow_version_id, selection_source, status, created_at, updated_at) values ($1, 'chave', 'WORKFLOW_ACTION', '1', $2, $3, $4, $5, 'TRIGGER_INTERACTION', 'RESERVED', now(), now())`, [ORG, interaction, people.op, found.workflow, found.version])
    expect((await geral.delete(`${WORKFLOWS}/${found.workflow}`)).status).toBe(204)
    expect(await rows(`interaction_feedback_generations where workflow_id = $1`, [found.workflow])).toBe(1)
  })

  it("recado de voz ainda não ouvido deixa de ser oferecido; o histórico dele fica", async () => {
    const found = await newWorkflow("Workflow com recado de voz")
    const enrollment = await enroll(found, "completed", "end")
    const output = await one(`insert into workflow_outputs (organization_id, enrollment_id, node_id, recipient_id, surface, content, title, display_text, speech_text, delivery_status) values ($1, $2, 'out', $3, 'AVATAR', '{"text":"Recado"}', 'Recado', 'Recado', 'Recado falado', 'OFFERED')`, [ORG, enrollment, people.op])
    const inbox = () => operador.get("/api/v1/inia-deliveries/inbox")
    expect(JSON.stringify((await inbox()).body)).toContain(output)
    await geral.delete(`${WORKFLOWS}/${found.workflow}`)
    expect(await rows(`workflow_outputs where id = $1`, [output])).toBe(1)
    expect(JSON.stringify((await inbox()).body)).not.toContain(output)
  })

  describe("na Consultar dados", () => {
    it("o Workflow aparece como Excluído, com quando e quem, sem o desenho do fluxo", async () => {
      const found = await newWorkflow("Workflow para consultar")
      await enroll(found, "completed", "end")
      await geral.delete(`${WORKFLOWS}/${found.workflow}`)
      const filter = { type: "group", logic: "AND", children: [{ type: "condition", column: "situation", operator: "EQ", value: "DELETED" }, { type: "condition", column: "name", operator: "EQ", value: "Workflow para consultar" }] }
      for (const agent of [geral, dados]) {
        const page = await agent.post(`${EXPLORER}/query`).send({ dataset: "workflows", columns: ["name", "situation", "executions", "deleted_at", "deleted_by"], filter })
        expect(page.status, JSON.stringify(page.body)).toBe(200)
        expect(page.body.data.rows).toHaveLength(1)
        const [name, situation, executions, deletedAt, by] = page.body.data.rows[0]
        expect([name, situation, executions, by]).toEqual(["Workflow para consultar", "DELETED", "1", "M-geral"])
        expect(deletedAt).not.toBeNull()
      }
      const described = await geral.get(`${EXPLORER}/datasets/workflows`)
      expect(JSON.stringify(described.body)).not.toMatch(/draft_graph|trigger_config|workflows_all/)
    })

    it("quem excluiu sem ter matrícula aparece pelo nome", async () => {
      const found = await newWorkflow("Workflow excluído sem matrícula")
      await pool.query(`update people set matricula = null where id = $1`, [people.geral])
      await geral.delete(`${WORKFLOWS}/${found.workflow}`)
      const filter = { type: "group", logic: "AND", children: [{ type: "condition", column: "name", operator: "EQ", value: "Workflow excluído sem matrícula" }] }
      const page = await geral.post(`${EXPLORER}/query`).send({ dataset: "workflows", columns: ["deleted_by"], filter })
      expect(page.body.data.rows).toEqual([["Pessoa geral"]])
      await pool.query(`update people set matricula = 'M-geral' where id = $1`, [people.geral])
    })

    it("a execução continua na consulta, com o nome do Workflow e a data da exclusão", async () => {
      const found = await newWorkflow("Workflow das execuções")
      const enrollment = await enroll(found, "waiting")
      await geral.delete(`${WORKFLOWS}/${found.workflow}`)
      const page = await dados.post(`${EXPLORER}/query`).send({ dataset: "workflow_executions", columns: ["id", "workflow", "workflow_deleted_at", "status"], filter: { type: "group", logic: "AND", children: [{ type: "condition", column: "id", operator: "EQ", value: enrollment }] } })
      expect(page.status, JSON.stringify(page.body)).toBe(200)
      const [id, workflow, deletedAt, status] = page.body.data.rows[0]
      expect([id, workflow, status]).toEqual([enrollment, "Workflow das execuções", "blocked"])
      expect(deletedAt).not.toBeNull()
    })

    it("outra organização não vê", async () => {
      const found = await newWorkflow("Workflow só da organização A")
      await geral.delete(`${WORKFLOWS}/${found.workflow}`)
      const page = await outraOrganizacao.post(`${EXPLORER}/query`).send({ dataset: "workflows", columns: ["name"] })
      expect(JSON.stringify(page.body)).not.toContain("Workflow só da organização A")
      expect((await outraOrganizacao.delete(`${WORKFLOWS}/${found.workflow}`)).status).toBe(404)
    })

    it("o operador não acessa", async () => {
      expect((await operador.post(`${EXPLORER}/query`).send({ dataset: "workflows" })).status).toBe(403)
    })
  })
})
