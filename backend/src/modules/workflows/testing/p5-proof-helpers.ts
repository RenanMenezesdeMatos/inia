import pg from "pg"
import request from "supertest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { processEnrollment } from "../application/engine.js"

/**
 * Apoio às provas da P5 e do sino (`docs/qa/workflows/propostas.md`). Tudo roda numa transação desfeita no fim, no banco de TESTE, sem chamar
 * modelo: as etapas usadas não têm IA, e a execução começa direto na etapa em teste, como faria uma versão já publicada.
 */
export const ORG = "00000000-0000-4000-8000-000000000001"
export const PASSWORD = "Proof@12345"
const position = { x: 0, y: 0 }

export type ProofClient = pg.PoolClient

export async function openProofTransaction(): Promise<{ pool: pg.Pool; client: ProofClient }> {
  const pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
  const client = await pool.connect()
  await client.query("begin")
  return { pool, client }
}

export async function closeProofTransaction(pool: pg.Pool | undefined, client: ProofClient | undefined): Promise<void> {
  if (client) {
    await client.query("rollback")
    client.release()
  }
  if (pool) await pool.end()
}

type PersonOptions = { role?: string; reportsToId?: string | null; active?: boolean }

export async function createPerson(client: ProofClient, name: string, options: PersonOptions = {}): Promise<string> {
  const { role = "OPERATOR", reportsToId = null, active = true } = options
  const result = await client.query<{ id: string }>("insert into people (organization_id, name, role, reports_to_id, active) values ($1, $2, $3, $4, $5) returning id", [ORG, name, role, reportsToId, active])
  return result.rows[0]!.id
}

export async function createTeam(client: ProofClient, name: string): Promise<string> {
  const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [ORG])).rows[0]!.id
  return (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, $3) returning id", [ORG, operation, name])).rows[0]!.id
}

type RoleGrant = { role: string; scopeType?: "ORGANIZATION" | "GROUP" | "SUBGROUP"; teamId?: string | null; subteamId?: string | null }

let accountSequence = 0

/** Conta de login da pessoa. Sem papéis, ela entra mas não administra nada: é o caso "sem permissão atual". */
export async function createAccount(client: ProofClient, personId: string, grants: RoleGrant[] = []): Promise<{ accountId: string; email: string }> {
  accountSequence += 1
  const email = `prova-p5-${Date.now()}-${accountSequence}@proof.inia.local`
  const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [ORG, personId, email, await hashPassword(PASSWORD)])).rows[0]!.id
  for (const grant of grants) {
    await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, subteam_id, granted_at) values ($1, $2, $3, $4, $5, $6, now())", [ORG, accountId, grant.role, grant.scopeType ?? "ORGANIZATION", grant.teamId ?? null, grant.subteamId ?? null])
  }
  return { accountId, email }
}

export async function loginAs(client: ProofClient, email: string): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(createApp(client as never))
  const login = await agent.post("/api/v1/auth/login").send({ email, password: PASSWORD })
  if (login.status !== 200) throw new Error(`Login da prova recusado: ${login.status} ${JSON.stringify(login.body)}`)
  return agent
}

export const triggerNode = { id: "trigger", type: "trigger", label: "Gatilho", position, config: {} }
export const endNode = { id: "end", type: "end", label: "Fim", position, config: {} }
export const flowNode = (id: string, type: string, label: string, config: unknown) => ({ id, type, label, position, config })
export const flowEdge = (source: string, sourceHandle: string, target: string) => ({ id: `${source}-${sourceHandle}-${target}`, source, sourceHandle, target })

/** Gatilho → etapa → Fim, com as saídas da etapa indo para o Fim. */
export function singleStepGraph(step: { id: string }, handles: string[] = ["always"]) {
  return {
    nodes: [triggerNode, step, endNode],
    edges: [flowEdge("trigger", "always", step.id), ...handles.map((handle) => flowEdge(step.id, handle, "end"))],
  }
}

export const REVIEW_HANDLES = ["approved", "rejected", "escalated"]
export const reviewNode = (config: Record<string, unknown>, label = "Revisão da supervisão", id = "revisao") => flowNode(id, "human_review", label, config)

type WorkflowOptions = { publisherId?: string | null; teamId?: string | null; subteamId?: string | null; active?: boolean; organizationId?: string }

/** Workflow com versão já no ar, inserido direto: é assim que uma versão antiga, publicada antes da regra nova, chega ao motor. */
export async function insertLiveWorkflow(client: ProofClient, name: string, graph: unknown, options: WorkflowOptions = {}): Promise<{ workflowId: string; versionId: string }> {
  const { publisherId = null, teamId = null, subteamId = null, active = true, organizationId = ORG } = options
  const scope = subteamId ? "SUBTEAM" : teamId ? "TEAM" : "ALL_TEAMS"
  const trigger = JSON.stringify({ kind: "manual", context: "COLLABORATOR" })
  const workflowId = (await client.query<{ id: string }>(
    "insert into workflows (organization_id, name, trigger_config, draft_trigger_config, draft_graph, active, scope_type, team_id, subteam_id, draft_scope_type, draft_team_id, draft_subteam_id) values ($1, $2, $3, $3, $4, $5, $6, $7, $8, $6, $7, $8) returning id",
    [organizationId, name, trigger, JSON.stringify(graph), active, scope, teamId, subteamId],
  )).rows[0]!.id
  const versionId = (await client.query<{ id: string }>("insert into workflow_versions (workflow_id, graph, created_by, trigger_config, scope_type, team_id, subteam_id) values ($1, $2, $3, $4, $5, $6, $7) returning id", [workflowId, JSON.stringify(graph), publisherId, trigger, scope, teamId, subteamId])).rows[0]!.id
  await client.query("update workflows set active_version_id = $2 where id = $1", [workflowId, versionId])
  return { workflowId, versionId }
}

type EnrollmentOptions = { nodeId: string; subjectId: string; nodeOutputs?: Record<string, unknown>; variables?: Record<string, unknown>; status?: "active" | "waiting" }

export async function insertEnrollment(client: ProofClient, workflow: { workflowId: string; versionId: string }, options: EnrollmentOptions): Promise<string> {
  const { nodeId, subjectId, nodeOutputs = {}, variables = {}, status = "active" } = options
  return (await client.query<{ id: string }>(
    `insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, scheduled_subject_id, node_outputs, variables)
     values ($1, $2, $3, $4, $5, now(), $6, $7, $8) returning id`,
    [ORG, workflow.workflowId, workflow.versionId, nodeId, status, subjectId, JSON.stringify(nodeOutputs), JSON.stringify(variables)],
  )).rows[0]!.id
}

type Claimed = Parameters<typeof processEnrollment>[1]

/** A mesma linha que o worker recebe ao reivindicar a execução (engine.ts, `claimDueEnrollments`). */
export async function runEnrollmentOnce(client: ProofClient, enrollmentId: string): Promise<void> {
  const row = (await client.query<Claimed>(
    `select we.id, we.organization_id, we.workflow_id, we.version_id, we.interaction_id, we.indicator_measurement_id, we.scheduled_subject_id, we.scheduled_for, we.current_node_id,
            we.matched_flag_name, we.matched_value_boolean, we.matched_value_numeric, we.status, we.attempts, we.revision, we.node_outputs, we.variables, we.parent_enrollment_id, we.retry_of_enrollment_id,
            w.scope_type, w.team_id workflow_team_id, w.subteam_id workflow_subteam_id, w.consolidated_structure, w.population_filter, now()::text claimed_until
     from workflow_enrollments we join workflows w on w.id = we.workflow_id where we.id = $1`,
    [enrollmentId],
  )).rows[0]!
  await processEnrollment(client as never, row)
}

export type EnrollmentState = {
  status: string
  current_node_id: string
  attempts: number
  blocked_node_id: string | null
  blocked_reason: string | null
  blocked_details: Record<string, unknown> | null
  node_outputs: Record<string, unknown>
  next_eval_year: number
}

export async function enrollmentState(client: ProofClient, enrollmentId: string): Promise<EnrollmentState> {
  return (await client.query<EnrollmentState>(
    "select status, current_node_id, attempts, blocked_node_id, blocked_reason, blocked_details, node_outputs, extract(year from next_eval_at)::int next_eval_year from workflow_enrollments where id = $1",
    [enrollmentId],
  )).rows[0]!
}

export async function enrollmentEvents(client: ProofClient, enrollmentId: string): Promise<{ event_type: string; payload: Record<string, unknown> }[]> {
  return (await client.query<{ event_type: string; payload: Record<string, unknown> }>("select event_type, payload from workflow_enrollment_events where enrollment_id = $1 order by created_at, id", [enrollmentId])).rows
}

export type AlertRow = { recipient_id: string; alert_type: string; title: string; description: string; dedupe_key: string }

export async function alertsByEnrollment(client: ProofClient, enrollmentId: string): Promise<AlertRow[]> {
  return (await client.query<AlertRow>("select recipient_id, alert_type, title, description, dedupe_key from alerts where dedupe_key like $1", [`%${enrollmentId}%`])).rows
}

export async function alertsOfType(client: ProofClient, alertType: string, recipientId: string): Promise<AlertRow[]> {
  return (await client.query<AlertRow>("select recipient_id, alert_type, title, description, dedupe_key from alerts where organization_id = $1 and alert_type = $2 and recipient_id = $3", [ORG, alertType, recipientId])).rows
}
