import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

/**
 * PROVA da revisão aprovada da PEN-002/PEN-076 (03/11/2026) — atualização automática dos agentes com a condição de segurança —
 * e das lacunas do bloco (nova tentativa até o fim, execução filha, execução em andamento, testes, substituição + exclusão,
 * históricos contextuais). Banco de teste real; o PROVEDOR DE IA é simulado na fronteira do gateway (`generateForRoute`):
 * nenhuma chamada paga. O que só uma chamada real ao provedor confirmaria está listado no relatório da implementação.
 *
 *   INIA_DB_PROOF=1 npx vitest run agent-auto-update-proof
 *
 * Como na `agent-lifecycle-proof`, um papel de teste com `agents.manage` + `workflows.manage` e sem `agents.inactive.manage`
 * nem `assistant_conversations.view` existe SÓ nesta prova (os perfis da Vivo são a PEN-032).
 */
const LITERAL = "vou enviar a segunda via agora"
const TRANSCRIPT = `Cliente: Preciso da segunda via da minha fatura.\nAtendente: Claro, ${LITERAL} para o seu e-mail.`

const control = vi.hoisted(() => ({ calls: 0, during: null as null | (() => Promise<void>) }))

vi.mock("../../access/domain/roles.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../access/domain/roles.js")>()
  const proofRole = { code: "PROVA_GESTOR_DE_AGENTES", name: "Prova — gestor de agentes", description: "Só na prova.", permissions: ["agents.manage", "workflows.manage"], allowedScopes: ["ORGANIZATION", "GROUP", "SUBGROUP"], delegates: [], system: true } as const
  const roles = [...original.SYSTEM_ROLES, proofRole]
  const catalog = { find: (code: string) => roles.find((role) => role.code === code) ?? null, all: () => roles }
  return { ...original, SYSTEM_ROLES: roles, systemRoleCatalog: catalog, rolesWithPermission: (permission: string, cat = catalog) => cat.all().filter((role) => (role.permissions as readonly string[]).includes(permission)).map((role) => role.code) }
})

vi.mock("../../../shared/application/model-routing/llm-gateway.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../shared/application/model-routing/llm-gateway.js")>()
  // Provedor simulado: resposta estruturada com citação literal da transcrição (Workflow por Flag) ou texto livre (teste manual).
  const simulated = async (gatewayRequest: { structuredOutput?: boolean; classification?: { purpose?: string } }) => {
    // A conferência da resposta (PEN-017) também passa por aqui: permite, e não conta como chamada do agente.
    if (gatewayRequest.classification?.purpose === "RESPONSE_COMPLIANCE") {
      return { kind: "text", text: JSON.stringify({ verdict: "ALLOW", violated: [] }), usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, cachedInputTokens: 0, thinkingTokens: 0 }, durationMs: 1, model: "simulado", cache: { cacheable: false, hit: false } }
    }
    control.calls += 1
    if (control.during) {
      const hook = control.during
      control.during = null
      await hook()
    }
    const text = gatewayRequest.structuredOutput
      ? JSON.stringify({ title: "Segunda via enviada", summary: "O atendente enviou a segunda via.", impactedIndicator: "Resolução", evidenceFound: LITERAL, observedBehavior: "Enviou a segunda via.", relatedProcedure: "Procedimento de segunda via", recommendation: "Continue confirmando o e-mail antes de enviar." })
      : "Resposta simulada do agente."
    return { kind: "text", text, usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, cachedInputTokens: 0, thinkingTokens: 0 }, durationMs: 1, model: "simulado", cache: { cacheable: false, hit: false }, cost: { amountUsd: 0 } }
  }
  return { ...original, generateForRoute: simulated, streamForRoute: simulated }
})

const { env } = await import("../../../config/env.js")
const { createApp } = await import("../../../main/app.js")
const { setProofAccountPassword } = await import("../../auth/testing/proof-account-password.js")
const { processEnrollment } = await import("../../workflows/application/engine.js")
const { previewWorkflowRetry, confirmWorkflowRetry } = await import("../../workflows/application/workflow-retry.js")
const { countFanOutChildren } = await import("../../workflows/application/consolidate-results-executor.js")
const { resolveAgentVersionForRun } = await import("../application/agent-versions.js")
const { executionDenialFor } = await import("../application/agent-execution-authorization.js")
const { resolveOrchestratorForTeam } = await import("../../assistant/application/resolve-orchestrator.js")
const { effectiveCapabilities } = await import("../../investigation/domain/capabilities.js")
const { appendConversationMessage } = await import("../../assistant/application/assistant-conversations.js")

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const ADMIN = { email: "carla.nunes@inia.com", password: "Inia@123" }
const MANAGER = { email: "prova-gestor-auto@proof.inia.local", password: "Prova@12345" }
const PREFIX = "Prova Auto · "

let pool: pg.Pool
let admin: ReturnType<typeof request.agent>
let manager: ReturnType<typeof request.agent>
let teamA = ""
let teamB = ""
let operator = ""
let interaction = ""
let otherOrg = ""
const created = { people: [] as string[], interactions: [] as string[], documents: [] as string[], cases: [] as string[], conversations: [] as string[] }

async function cleanup() {
  const workflows = (await pool.query<{ id: string }>(`select id from workflows where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])).rows.map((row) => row.id)
  await pool.query(`delete from workflow_outputs where enrollment_id in (select id from workflow_enrollments where workflow_id = any($1::uuid[]))`, [workflows])
  await pool.query(`delete from workflow_enrollment_events where enrollment_id in (select id from workflow_enrollments where workflow_id = any($1::uuid[]))`, [workflows])
  await pool.query(`update workflow_enrollments set retry_of_enrollment_id = null, parent_enrollment_id = null where workflow_id = any($1::uuid[])`, [workflows])
  await pool.query(`delete from workflow_enrollments where workflow_id = any($1::uuid[])`, [workflows])
  await pool.query(`update workflows set active_version_id = null where id = any($1::uuid[])`, [workflows])
  await pool.query(`delete from workflow_versions where workflow_id = any($1::uuid[])`, [workflows])
  await pool.query(`delete from workflows where id = any($1::uuid[])`, [workflows])
  await pool.query(`delete from assistant_interactions where conversation_id = any($1::uuid[])`, [created.conversations])
  await pool.query(`delete from assistant_conversations where id = any($1::uuid[])`, [created.conversations])
  await pool.query(`delete from assistant_orchestrators where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])
  const agents = (await pool.query<{ id: string }>(`select id from agents where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])).rows.map((row) => row.id)
  await pool.query(`delete from audit_logs where action = 'AGENT_EXECUTION_BLOCKED' and entity_id = any($1::uuid[])`, [agents])
  await pool.query(`delete from assistant_interaction_agents where agent_id = any($1::uuid[])`, [agents])
  await pool.query(`update agent_runs set case_id = null where agent_id = any($1::uuid[])`, [agents])
  await pool.query(`delete from supervision_cases where id = any($1::uuid[])`, [created.cases])
  await pool.query(`delete from agent_runs where agent_id = any($1::uuid[])`, [agents])
  await pool.query(`update agents set current_version_id = null where id = any($1::uuid[])`, [agents])
  await pool.query(`delete from agents where id = any($1::uuid[])`, [agents])
  await pool.query(`delete from knowledge_document_org_scopes where knowledge_document_id = any($1::uuid[])`, [created.documents])
  await pool.query(`delete from knowledge_documents where id = any($1::uuid[])`, [created.documents])
  await pool.query(`delete from transcripts where interaction_id = any($1::uuid[])`, [created.interactions])
  await pool.query(`delete from interactions where id = any($1::uuid[])`, [created.interactions])
  await pool.query(`delete from access_role_assignments where user_account_id in (select id from user_accounts where email = $1)`, [MANAGER.email])
  await pool.query(`delete from user_accounts where email = $1`, [MANAGER.email])
  await pool.query(`delete from people where id = any($1::uuid[]) or (organization_id = $2 and name like $3)`, [created.people, ORG, `${PREFIX}%`])
  if (otherOrg) await pool.query(`delete from organizations where id = $1`, [otherOrg])
}

const agentBody = (name: string, extra: Record<string, unknown> = {}) => ({ name: `${PREFIX}${name}`, agentType: "CALL_FEEDBACK", objective: "Objetivo da versão 1.", description: "Agente temporário da prova da revisão.", contextPrompt: "Contexto da prova.", scopeType: "ALL_TEAMS", ...extra })

async function createPublished(name: string, extra: Record<string, unknown> = {}) {
  const createdAgent = await admin.post("/api/v1/admin/agents").send(agentBody(name, extra))
  expect(createdAgent.status, JSON.stringify(createdAgent.body)).toBe(201)
  const id = createdAgent.body.data.id as string
  const published = await admin.post(`/api/v1/admin/agents/${id}/publish`).send({})
  expect(published.status, JSON.stringify(published.body)).toBe(201)
  return { id, versionId: published.body.data.version.id as string }
}

async function publishChange(agentId: string, change: Record<string, unknown>) {
  const saved = await admin.patch(`/api/v1/admin/agents/${agentId}`).send(change)
  expect(saved.status, JSON.stringify(saved.body)).toBe(200)
  const published = await admin.post(`/api/v1/admin/agents/${agentId}/publish`).send({})
  expect(published.status, JSON.stringify(published.body)).toBe(201)
  return published.body.data.version.id as string
}

const edges = (pairs: string[][]) => pairs.map(([source, target]) => ({ id: `${source}-${target}`, source, target, sourceHandle: "always" }))
const agentGraph = (agentId: string, withOutput = false) => ({
  nodes: [
    { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
    { id: "agent", type: "action", label: "Analisar conversa", position: { x: 0, y: 1 }, config: { actionType: "CALL_AGENT", agentId } },
    ...(withOutput ? [{ id: "out", type: "output", label: "Recado ao operador", position: { x: 0, y: 2 }, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["INBOX"], source: "nodeOutputs.agent" } }] : []),
    { id: "end", type: "end", label: "Fim", position: { x: 0, y: 3 }, config: {} },
  ],
  edges: edges(withOutput ? [["trigger", "agent"], ["agent", "out"], ["out", "end"]] : [["trigger", "agent"], ["agent", "end"]]),
})

async function insertWorkflow(name: string, graph: unknown, teamId: string | null = teamA) {
  const workflow = (await pool.query<{ id: string }>(
    `insert into workflows (organization_id, name, trigger_config, draft_trigger_config, draft_graph, active, scope_type, team_id, draft_scope_type, draft_team_id) values ($1,$2,$3,$3,$4,true,$5,$6,$5,$6) returning id`,
    [ORG, `${PREFIX}${name}`, JSON.stringify({ kind: "channel_flag", channelFlagId: "00000000-0000-4000-8000-000000000000" }), JSON.stringify(graph), teamId ? "TEAM" : "ALL_TEAMS", teamId],
  )).rows[0]!.id
  const version = (await pool.query<{ id: string }>(`insert into workflow_versions (workflow_id, graph) values ($1,$2) returning id`, [workflow, JSON.stringify(graph)])).rows[0]!.id
  await pool.query(`update workflows set active_version_id = $2 where id = $1`, [workflow, version])
  return { workflow, version }
}

async function enroll(workflow: string, version: string, node = "agent") {
  return (await pool.query<{ id: string }>(`insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, interaction_id, matched_flag_name, matched_value_boolean) values ($1,$2,$3,$4,'active','2999-01-01',$5,'prova',true) returning id`, [ORG, workflow, version, node, interaction])).rows[0]!.id
}

type Claimed = Parameters<typeof processEnrollment>[1]
async function claimed(id: string): Promise<Claimed> {
  return (await pool.query<Claimed>(
    `select we.id, we.organization_id, we.workflow_id, we.version_id, we.interaction_id, we.indicator_measurement_id, we.scheduled_subject_id, we.scheduled_for, we.current_node_id,
            we.matched_flag_name, we.matched_value_boolean, we.matched_value_numeric, we.status, we.attempts, we.revision, we.node_outputs, we.variables, we.parent_enrollment_id, we.retry_of_enrollment_id,
            w.scope_type, w.team_id workflow_team_id, w.subteam_id workflow_subteam_id, w.consolidated_structure, w.population_filter, now()::text claimed_until
     from workflow_enrollments we join workflows w on w.id = we.workflow_id where we.id = $1`,
    [id],
  )).rows[0]!
}
const state = async (id: string) => (await pool.query<{ status: string; current_node_id: string; attempts: number; blocked_reason: string | null }>(`select status, current_node_id, attempts, blocked_reason from workflow_enrollments where id = $1`, [id])).rows[0]!
async function drive(id: string, maxSteps = 6) {
  for (let step = 0; step < maxSteps; step += 1) {
    const before = await state(id)
    if (before.status !== "active") return before
    await processEnrollment(pool, await claimed(id))
    const after = await state(id)
    if (after.attempts > before.attempts) throw new Error(`nó ${before.current_node_id} falhou: ${JSON.stringify((await pool.query(`select payload from workflow_enrollment_events where enrollment_id = $1 and event_type in ('node_failed','flow_dead') order by created_at desc limit 1`, [id])).rows[0])}`)
  }
  return state(id)
}
const runsOf = async (agentId: string) => (await pool.query<{ id: string; status: string; agent_version_id: string | null; run_target: string | null; tested_config: { objective?: string } | null; source: string }>(`select id, status, agent_version_id, run_target, tested_config, source from agent_runs where agent_id = $1 order by created_at`, [agentId])).rows

async function insertDocument(title: string, scope: { scopeType: "ALL_TEAMS" | "TEAM"; teamId?: string | null }, organizationId = ORG) {
  const id = (await pool.query<{ id: string }>(`insert into knowledge_documents (organization_id, title, document_type) values ($1,$2,'PROCEDURE') returning id`, [organizationId, `${PREFIX}${title}`])).rows[0]!.id
  created.documents.push(id)
  await pool.query(`insert into knowledge_document_org_scopes (knowledge_document_id, scope_type, team_id) values ($1,$2,$3)`, [id, scope.scopeType, scope.teamId ?? null])
  return id
}

describe.skipIf(!ENABLED)("Revisão da PEN-002/PEN-076 — atualização automática com segurança, e as lacunas do bloco (banco de teste real, provedor simulado)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    await cleanup()
    const teams = (await pool.query<{ id: string }>(`select id from teams where organization_id = $1 order by name limit 2`, [ORG])).rows
    teamA = teams[0]!.id
    teamB = teams[1]!.id
    operator = (await pool.query<{ id: string }>(`insert into people (organization_id, name, role, team_id) values ($1,$2,'OPERATOR',$3) returning id`, [ORG, `${PREFIX}Operador`, teamA])).rows[0]!.id
    created.people.push(operator)
    interaction = (await pool.query<{ id: string }>(`insert into interactions (organization_id, operator_id, reason, started_at, ended_at, external_id) values ($1,$2,'Segunda via',now() - interval '5 minutes',now() - interval '1 minute',$3) returning id`, [ORG, operator, `PROVA-AUTO-${Date.now()}`])).rows[0]!.id
    created.interactions.push(interaction)
    await pool.query(`insert into transcripts (organization_id, interaction_id, content) values ($1,$2,$3)`, [ORG, interaction, TRANSCRIPT])
    const person = (await pool.query<{ id: string }>(`insert into people (organization_id, name, role, team_id) values ($1,$2,'ADMIN',$3) returning id`, [ORG, `${PREFIX}Gestor`, teamA])).rows[0]!.id
    created.people.push(person)
    const account = (await pool.query<{ id: string }>(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1,$2,$3,'x') returning id`, [ORG, person, MANAGER.email])).rows[0]!.id
    await pool.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1,$2,'PROVA_GESTOR_DE_AGENTES','GROUP',$3,now())`, [ORG, account, teamA])
    otherOrg = (await pool.query<{ id: string }>(`insert into organizations (name, slug) values ($1,$2) returning id`, [`${PREFIX}Outra organização`, `prova-auto-${Date.now()}`])).rows[0]!.id
    await setProofAccountPassword(pool, MANAGER.email, MANAGER.password)
    await setProofAccountPassword(pool, ADMIN.email, ADMIN.password)
    const app = createApp(pool)
    admin = request.agent(app)
    manager = request.agent(app)
    expect((await admin.post("/api/v1/auth/login").send(ADMIN)).status).toBe(200)
    expect((await manager.post("/api/v1/auth/login").send(MANAGER)).status).toBe(200)
  })

  afterAll(async () => {
    await cleanup()
    await pool.end()
  })

  it("atualização automática: a próxima execução do Workflow usa a versão nova sem republicar; a execução anterior continua registrada na versão dela", async () => {
    const { id, versionId: v1 } = await createPublished("Automático")
    const { workflow, version } = await insertWorkflow("Automático", agentGraph(id))
    expect((await drive(await enroll(workflow, version))).status).toBe("completed")
    const v2 = await publishChange(id, { objective: "Objetivo da versão 2." })
    // Rascunho salvo depois não afeta a produção.
    await admin.patch(`/api/v1/admin/agents/${id}`).send({ objective: "Rascunho que não vale." })
    expect((await drive(await enroll(workflow, version))).status).toBe("completed")
    expect((await runsOf(id)).map((run) => [run.source, run.status, run.agent_version_id])).toEqual([["WORKFLOW", "COMPLETED", v1], ["WORKFLOW", "COMPLETED", v2]])
    // Publicação: autor, data e versão registrados.
    const versions = (await pool.query<{ version_number: number; published_by_name: string; published_at: Date }>(`select version_number, published_by_name, published_at from agent_versions where agent_id = $1 order by version_number`, [id])).rows
    expect(versions.map((row) => row.version_number)).toEqual([1, 2])
    expect(versions.every((row) => row.published_by_name && row.published_at)).toBe(true)
  })

  it("execução em andamento: termina na versão em que começou, mesmo com uma versão nova publicada e o agente desativado durante a chamada; a seguinte já é bloqueada", async () => {
    const { id, versionId: v1 } = await createPublished("Em andamento")
    const { workflow, version } = await insertWorkflow("Em andamento", agentGraph(id))
    control.during = async () => {
      await admin.patch(`/api/v1/admin/agents/${id}`).send({ objective: "Versão 2 publicada no meio." })
      await admin.post(`/api/v1/admin/agents/${id}/publish`).send({})
      await admin.patch(`/api/v1/admin/agents/${id}`).send({ active: false })
    }
    expect((await drive(await enroll(workflow, version))).status).toBe("completed")
    expect(await runsOf(id)).toEqual([expect.objectContaining({ status: "COMPLETED", agent_version_id: v1 })])
    expect((await drive(await enroll(workflow, version))).status).toBe("blocked")
    expect(await runsOf(id)).toHaveLength(1)
  })

  it("segurança — alcance: a prévia mostra quem deixaria de ser atendido; publicada a versão restrita a outro Grupo, a execução é bloqueada sem expor nada restrito", async () => {
    const { id, versionId: v1 } = await createPublished("Alcance")
    const { workflow, version } = await insertWorkflow("Alcance", agentGraph(id), teamA)
    await admin.patch(`/api/v1/admin/agents/${id}`).send({ scopeType: "TEAM", teamId: teamB })
    const impact = (await admin.get(`/api/v1/admin/agents/${id}/publish-impact`)).body.data
    expect(impact.consumers).toEqual([expect.objectContaining({ kind: "WORKFLOW", id: workflow, losesAccess: true })])
    expect(impact.changes.scope).toMatchObject({ from: "Todos os grupos" })
    // Quem só administra o Grupo A não vê o agente agora restrito ao Grupo B — nem a prévia dele.
    expect((await admin.post(`/api/v1/admin/agents/${id}/publish`).send({})).status).toBe(201)
    expect((await manager.get(`/api/v1/admin/agents/${id}/publish-impact`)).status).toBe(404)
    const enrollment = await enroll(workflow, version)
    expect(await drive(enrollment)).toMatchObject({ status: "blocked", blocked_reason: "AGENT_ACCESS_NOT_AUTHORIZED" })
    expect(await runsOf(id)).toEqual([])
    const event = (await pool.query<{ payload: { message: string } }>(`select payload from workflow_enrollment_events where enrollment_id = $1 and event_type = 'node_blocked'`, [enrollment])).rows[0]!
    const teamNames = (await pool.query<{ name: string }>(`select name from teams where id = $1`, [teamB])).rows[0]!.name
    expect(event.payload.message).not.toContain(teamNames)
    // Executar agora e nova tentativa recusam pelo mesmo motivo.
    const preview = await previewWorkflowRetry(pool, ORG, enrollment)
    expect(preview.blockers.map((blocker) => blocker.code)).toContain("WORKFLOW_AGENT_NOT_AUTHORIZED")
    // Reverter também publica: a prévia compara a versão escolhida com a vigente (o alcance volta e o Workflow volta a ser atendido).
    const revertImpact = (await admin.get(`/api/v1/admin/agents/${id}/publish-impact?versionId=${v1}`)).body.data
    expect(revertImpact).toMatchObject({ nextVersionNumber: 3, currentVersionNumber: 2, changes: { scope: { to: "Todos os grupos" } } })
    expect(revertImpact.consumers).toEqual([expect.objectContaining({ id: workflow, losesAccess: false })])
    expect((await admin.get(`/api/v1/admin/agents/${id}/publish-impact?versionId=${crypto.randomUUID()}`)).status).toBe(404)
  })

  it("segurança — bases e organizações: base de outra organização ou de outro Grupo é recusada na publicação; base que passa a valer só para outro Grupo bloqueia a execução; outra organização não enxerga o agente", async () => {
    const { id } = await createPublished("Bases", { scopeType: "TEAM", teamId: teamA })
    const foreign = await insertDocument("Base de outra organização", { scopeType: "ALL_TEAMS" }, otherOrg)
    const otherGroup = await insertDocument("Base do Grupo B", { scopeType: "TEAM", teamId: teamB })
    const own = await insertDocument("Base do Grupo A", { scopeType: "TEAM", teamId: teamA })
    const crossOrg = await admin.patch(`/api/v1/admin/agents/${id}`).send({ knowledgeDocumentIds: [foreign] })
    expect(crossOrg.status).toBe(422)
    expect(crossOrg.body.error.code).toBe("AGENT_KNOWLEDGE_NOT_FOUND")
    const crossGroup = await admin.patch(`/api/v1/admin/agents/${id}`).send({ knowledgeDocumentIds: [otherGroup] })
    expect(crossGroup.body.error.code).toBe("AGENT_KNOWLEDGE_SCOPE_FORBIDDEN")
    // Nova versão com uma base autorizada: a prévia destaca a base e a execução segue.
    await admin.patch(`/api/v1/admin/agents/${id}`).send({ knowledgeDocumentIds: [own] })
    expect((await admin.get(`/api/v1/admin/agents/${id}/publish-impact`)).body.data.changes.knowledge.added).toEqual([{ id: own, title: `${PREFIX}Base do Grupo A` }])
    await admin.post(`/api/v1/admin/agents/${id}/publish`).send({})
    const { workflow, version } = await insertWorkflow("Bases", agentGraph(id), teamA)
    expect((await drive(await enroll(workflow, version))).status).toBe("completed")
    // A base passa a valer só para o Grupo B depois da publicação: a próxima execução é bloqueada (não usa a base em silêncio).
    await pool.query(`update knowledge_document_org_scopes set team_id = $2 where knowledge_document_id = $1`, [own, teamB])
    expect(await drive(await enroll(workflow, version))).toMatchObject({ status: "blocked", blocked_reason: "AGENT_ACCESS_NOT_AUTHORIZED" })
    // Organização: a versão de um agente nunca é lida por outra organização, e base de outra organização bloqueia.
    await expect(resolveAgentVersionForRun(pool, otherOrg, id)).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" })
    const snapshot = await resolveAgentVersionForRun(pool, ORG, id)
    expect(await executionDenialFor(pool, { ...snapshot, config: { ...snapshot.config, knowledgeDocumentIds: [foreign] } }, null)).toBe("KNOWLEDGE")
  })

  it("segurança — ferramentas: a versão nova pode trazer ferramentas, mas a restrição da etapa do Workflow continua valendo (interseção)", async () => {
    const { id } = await createPublished("Ferramentas")
    await admin.patch(`/api/v1/admin/agents/${id}`).send({ investigationCapabilities: ["INDICATOR_ANALYSIS", "INTERACTION_ANALYSIS"] })
    // A prévia destaca as ferramentas novas antes de publicar.
    expect((await admin.get(`/api/v1/admin/agents/${id}/publish-impact`)).body.data.changes.tools.added).toHaveLength(2)
    await admin.post(`/api/v1/admin/agents/${id}/publish`).send({})
    const tools = (await resolveAgentVersionForRun(pool, ORG, id)).config.investigationCapabilities
    expect(tools).toEqual(["INDICATOR_ANALYSIS", "INTERACTION_ANALYSIS"])
    expect(effectiveCapabilities(tools as never, ["INDICATOR_ANALYSIS"])).toEqual(["INDICATOR_ANALYSIS"])
  })

  it("segurança — orquestrador: especialista cuja versão vigente não cobre o alcance do Orquestrador sai das ferramentas; o motivo fica registrado uma vez", async () => {
    const coordinator = await createPublished("Coordenador", { agentType: "ORCHESTRATOR" })
    const specialist = await createPublished("Especialista", { agentType: "CUSTOM", specialtyKind: "PERFORMANCE" })
    const orchestrator = await admin.post("/api/v1/admin/assistant-orchestrators").send({ name: `${PREFIX}Orq`, scopeType: "TEAM", teamId: teamA, orchestratorAgentId: coordinator.id, specialistAgentIds: [specialist.id], invocationMode: "INTERACTIVE", routingPolicy: "OPEN" })
    expect(orchestrator.status, JSON.stringify(orchestrator.body)).toBe(201)
    expect((await resolveOrchestratorForTeam(pool, ORG, teamA, "INTERACTIVE"))!.specialists.map((entry) => entry.agentId)).toEqual([specialist.id])
    await publishChange(specialist.id, { scopeType: "TEAM", teamId: teamB })
    expect((await resolveOrchestratorForTeam(pool, ORG, teamA, "INTERACTIVE"))!.specialists).toEqual([])
    await resolveOrchestratorForTeam(pool, ORG, teamA, "INTERACTIVE")
    const denials = (await pool.query<{ payload: { reason: string } }>(`select payload from audit_logs where action = 'AGENT_EXECUTION_BLOCKED' and entity_id = $1`, [specialist.id])).rows
    expect(denials).toEqual([{ payload: expect.objectContaining({ reason: "SCOPE", consumerKind: "ORCHESTRATOR" }) }])
  })

  it("teste manual: rascunho salvo e versão publicada antiga, cada um registrado com o que foi testado; a vigente não muda", async () => {
    const { id, versionId: v1 } = await createPublished("Teste manual")
    const v2 = await publishChange(id, { objective: "Objetivo da versão 2." })
    await admin.patch(`/api/v1/admin/agents/${id}`).send({ objective: "Objetivo do rascunho." })
    const draft = await admin.post(`/api/v1/admin/agents/${id}/test`).send({ input: "Cenário de teste do rascunho.", target: "DRAFT" })
    expect(draft.status, JSON.stringify(draft.body)).toBe(201)
    const old = await admin.post(`/api/v1/admin/agents/${id}/test`).send({ input: "Cenário de teste da versão 1.", target: "VERSION", versionId: v1 })
    expect(old.status, JSON.stringify(old.body)).toBe(201)
    const runs = await runsOf(id)
    expect(runs.map((run) => [run.run_target, run.agent_version_id, run.tested_config?.objective ?? null, run.status])).toEqual([["DRAFT", null, "Objetivo do rascunho.", "COMPLETED"], ["VERSION", v1, null, "COMPLETED"]])
    expect((await resolveAgentVersionForRun(pool, ORG, id)).versionId).toBe(v2)
    // Editar o rascunho depois não muda o conteúdo testado registrado.
    await admin.patch(`/api/v1/admin/agents/${id}`).send({ objective: "Outro rascunho." })
    const detail = (await admin.get(`/api/v1/admin/agents/${id}/runs/${runs[0]!.id}`)).body.data
    expect(detail.testedConfig.objective).toBe("Objetivo do rascunho.")
  })

  it("nova tentativa até o fim: reconfirmação se a versão vigente muda antes; versão apresentada × usada quando publicam depois da confirmação; entrega uma vez só", async () => {
    const { id, versionId: v1 } = await createPublished("Tentativa")
    const { workflow, version } = await insertWorkflow("Tentativa", agentGraph(id, true))
    await admin.patch(`/api/v1/admin/agents/${id}`).send({ active: false })
    const original = await enroll(workflow, version)
    expect((await drive(original)).status).toBe("blocked")
    await admin.patch(`/api/v1/admin/agents/${id}`).send({ active: true })
    const first = await previewWorkflowRetry(pool, ORG, original)
    expect(first.agents).toEqual([expect.objectContaining({ agentId: id, agentVersionId: v1 })])
    // Publicaram antes da confirmação: nada começa, pede de novo.
    const v2 = await publishChange(id, { objective: "Versão 2 antes da confirmação." })
    await expect(confirmWorkflowRetry(pool, ORG, original, { fingerprint: first.fingerprint }, { personId: null, name: "Prova" })).rejects.toMatchObject({ code: "WORKFLOW_RETRY_RECONFIRM" })
    const second = await previewWorkflowRetry(pool, ORG, original)
    expect(second.agents[0]!.agentVersionId).toBe(v2)
    const retry = await confirmWorkflowRetry(pool, ORG, original, { fingerprint: second.fingerprint }, { personId: null, name: "Prova" })
    // Publicaram DEPOIS da confirmação e antes da chamada: a execução usa a vigente de agora e o registro diferencia.
    const v3 = await publishChange(id, { objective: "Versão 3 depois da confirmação." })
    expect((await drive(retry.enrollmentId)).status).toBe("completed")
    const used = (await runsOf(id)).at(-1)!
    expect(used.agent_version_id).toBe(v3)
    const confirmation = (await pool.query<{ retry_confirmation: { agents: { agentVersionId: string }[] } }>(`select retry_confirmation from workflow_enrollments where id = $1`, [retry.enrollmentId])).rows[0]!.retry_confirmation
    expect(confirmation.agents[0]!.agentVersionId).toBe(v2)
    expect((await pool.query(`select 1 from workflow_outputs where enrollment_id = $1`, [retry.enrollmentId])).rowCount).toBe(1)
    // Segunda tentativa da mesma original: o agente roda de novo, mas o recado já entregue pela cadeia não sai outra vez.
    const third = await previewWorkflowRetry(pool, ORG, original)
    const again = await confirmWorkflowRetry(pool, ORG, original, { fingerprint: third.fingerprint }, { personId: null, name: "Prova" })
    expect((await drive(again.enrollmentId)).status).toBe("completed")
    expect((await pool.query(`select 1 from workflow_outputs where enrollment_id = $1`, [again.enrollmentId])).rowCount).toBe(0)
    expect((await pool.query(`select 1 from workflow_enrollment_events where enrollment_id = $1 and event_type = 'output_already_delivered'`, [again.enrollmentId])).rowCount).toBe(1)
    expect((await state(original)).status).toBe("blocked")
  })

  it("nova tentativa de execução filha de 'Selecionar colaboradores': ligada à mesma execução principal, entra no consolidado e libera a barreira", async () => {
    const { id } = await createPublished("Filha")
    const graph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        { id: "fan", type: "apply_individually", label: "Aplicar individualmente", position: { x: 0, y: 1 }, config: {} },
        { id: "agent", type: "action", label: "Analisar conversa", position: { x: 0, y: 2 }, config: { actionType: "CALL_AGENT", agentId: id, scheduledDataSource: { kind: "MONITORING", sampleSize: 1, period: "TODAY" } } },
        { id: "join", type: "consolidate_results", label: "Consolidar resultados", position: { x: 0, y: 3 }, config: {} },
        { id: "end", type: "end", label: "Fim", position: { x: 0, y: 4 }, config: {} },
      ],
      edges: edges([["trigger", "fan"], ["fan", "agent"], ["agent", "join"], ["join", "end"]]),
    }
    const { workflow, version } = await insertWorkflow("Filha", graph)
    const parent = (await pool.query<{ id: string }>(`insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, interaction_id, node_outputs) values ($1,$2,$3,'join','waiting','2999-01-01',$4,$5) returning id`, [ORG, workflow, version, interaction, JSON.stringify({ fan: { kind: "FAN_OUT_COMPLETED", childCount: 1, memberIds: [operator], fanOutNodeId: "fan" } })])).rows[0]!.id
    // Filha como o envio a cria: só o colaborador como origem, começando no nó seguinte ao envio.
    const child = (await pool.query<{ id: string }>(`insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, parent_enrollment_id, fan_out_node_id, scheduled_subject_id) values ($1,$2,$3,'agent','active','2999-01-01',$4,'fan',$5) returning id`, [ORG, workflow, version, parent, operator])).rows[0]!.id
    await admin.patch(`/api/v1/admin/agents/${id}`).send({ active: false })
    expect((await drive(child)).status).toBe("blocked")
    expect(await countFanOutChildren(pool, parent, "fan")).toEqual({ completed: 0, failed: 1 })
    await admin.patch(`/api/v1/admin/agents/${id}`).send({ active: true })
    const preview = await previewWorkflowRetry(pool, ORG, child)
    expect(preview).toMatchObject({ blockers: [], startsAt: "BLOCKED_STEP", fanOut: { parentEnrollmentId: parent, joinsConsolidation: true } })
    const retry = await confirmWorkflowRetry(pool, ORG, child, { fingerprint: preview.fingerprint }, { personId: null, name: "Prova" })
    const retryRow = (await pool.query<{ parent_enrollment_id: string; fan_out_node_id: string; scheduled_subject_id: string }>(`select parent_enrollment_id, fan_out_node_id, scheduled_subject_id from workflow_enrollments where id = $1`, [retry.enrollmentId])).rows[0]!
    expect(retryRow).toEqual({ parent_enrollment_id: parent, fan_out_node_id: "fan", scheduled_subject_id: operator })
    // Enquanto a tentativa roda, o colaborador ainda não chegou; quando ela termina, conta o resultado dela (a original sai da conta).
    expect(await countFanOutChildren(pool, parent, "fan")).toEqual({ completed: 0, failed: 0 })
    expect((await drive(retry.enrollmentId)).status).toBe("completed")
    expect(await countFanOutChildren(pool, parent, "fan")).toEqual({ completed: 1, failed: 0 })
    await pool.query(`update workflow_enrollments set status = 'active' where id = $1`, [parent])
    expect((await drive(parent)).status).toBe("completed")
  })

  it("substituir a referência, publicar o Workflow e excluir: a exclusão só passa sem nenhum impedimento restante", async () => {
    const replaced = await createPublished("Substituído")
    const substitute = await createPublished("Substituto")
    const flag = (await pool.query<{ id: string }>(`select id from channel_flags where organization_id = $1 and active limit 1`, [ORG])).rows[0]!.id
    const workflowResponse = await admin.post("/api/v1/admin/workflows").send({ name: `${PREFIX}Substituição`, scopeType: "TEAM", teamId: teamA, trigger: { kind: "channel_flag", channelFlagId: flag } })
    expect(workflowResponse.status, JSON.stringify(workflowResponse.body)).toBe(201)
    const workflow = workflowResponse.body.data.id as string
    const draft = (graph: unknown) => admin.put(`/api/v1/admin/workflows/${workflow}/draft`).send({ graph })
    const publish = () => admin.post(`/api/v1/admin/workflows/${workflow}/publish`).send({})
    expect((await draft(agentGraph(replaced.id, true))).status).toBeLessThan(300)
    const firstPublish = await publish()
    expect(firstPublish.status, JSON.stringify(firstPublish.body)).toBeLessThan(300)
    expect((await admin.delete(`/api/v1/admin/agents/${replaced.id}`)).status).toBe(409)
    // Substitui no rascunho e publica: sem referência e sem uso, a exclusão passa.
    expect((await draft(agentGraph(substitute.id, true))).status).toBeLessThan(300)
    expect((await publish()).status).toBeLessThan(300)
    expect((await admin.get(`/api/v1/admin/agents/${replaced.id}/deletion-check`)).body.data).toMatchObject({ deletable: true, references: [] })
    // Impedimento restante: uma execução em andamento continua bloqueando. Execução terminada é histórico, e não impede excluir.
    const versionId = (await resolveAgentVersionForRun(pool, ORG, replaced.id)).versionId
    await pool.query(`insert into agent_runs (organization_id, agent_id, source, input_context, status, agent_version_id) values ($1,$2,'MANUAL_TEST','prova','PENDING',$3)`, [ORG, replaced.id, versionId])
    expect((await admin.delete(`/api/v1/admin/agents/${replaced.id}`)).status).toBe(409)
    await pool.query(`delete from agent_runs where agent_id = $1`, [replaced.id])
    expect((await admin.delete(`/api/v1/admin/agents/${replaced.id}`)).status).toBe(204)
  })

  it("históricos contextuais: autorizado vê só os registros do contexto; sem permissão ou fora do alcance é recusado", async () => {
    const { id } = await createPublished("Contexto", { scopeType: "TEAM", teamId: teamA })
    const inA = await insertWorkflow("Contexto A", agentGraph(id), teamA)
    const inB = await insertWorkflow("Contexto B", agentGraph(id), teamB)
    const enrollmentA = await enroll(inA.workflow, inA.version)
    const enrollmentB = await enroll(inB.workflow, inB.version)
    await drive(enrollmentA)
    await drive(enrollmentB)
    await admin.patch(`/api/v1/admin/agents/${id}`).send({ active: false })
    // Execução de Workflow: quem administra Workflows no Grupo A vê o registro (agente identificado como inativo) do Grupo A, não o do B.
    const ownRecords = await manager.get(`/api/v1/admin/workflows/${inA.workflow}/enrollments/${enrollmentA}/agent-records`)
    expect(ownRecords.status).toBe(200)
    expect(ownRecords.body.data).toEqual([expect.objectContaining({ agentId: id, agentActive: false })])
    expect((await manager.get(`/api/v1/admin/workflows/${inB.workflow}/enrollments/${enrollmentB}/agent-records`)).status).toBe(404)
    expect((await manager.get(`/api/v1/admin/workflows/${inA.workflow}/enrollments/${enrollmentB}/agent-records`)).status).toBe(404)
    // O cadastro do agente inativo continua fechado para ele.
    expect((await manager.get(`/api/v1/admin/agents/${id}`)).status).toBe(403)
    // Conversa: quem lê conversas vê a participação; quem não tem a permissão é recusado.
    const conversation = (await pool.query<{ id: string }>(`insert into assistant_conversations (organization_id, owner_person_id, started_at, last_activity_at, status, closed_at, close_reason) values ($1,$2,now(),now(),'CLOSED',now(),'INACTIVITY') returning id`, [ORG, operator])).rows[0]!.id
    created.conversations.push(conversation)
    await appendConversationMessage(pool, { conversationId: conversation, organizationId: ORG, ownerPersonId: operator, channel: "voice", role: "assistant", content: "Esta parte do pedido está indisponível no momento.", occurredAt: new Date(), toolCalls: [{ toolName: `agent_${id.replace(/-/g, "")}`, query: "q", agentId: id, outcome: "BLOCKED_INACTIVE" }] })
    const conversationRecords = await admin.get(`/api/v1/admin/assistant-conversations/${conversation}/agent-records`)
    expect(conversationRecords.status, JSON.stringify(conversationRecords.body)).toBe(200)
    expect(conversationRecords.body.data).toEqual([expect.objectContaining({ agentId: id, outcome: "BLOCKED_INACTIVE", guidance: expect.stringContaining("Agente inativo") })])
    expect((await manager.get(`/api/v1/admin/assistant-conversations/${conversation}/agent-records`)).status).toBe(403)
    // Caso: quem vê o caso vê a execução que o gerou (administrador e o gestor do Grupo do caso); caso de outro Grupo é recusado.
    const operatorB = (await pool.query<{ id: string }>(`insert into people (organization_id, name, role, team_id) values ($1,$2,'OPERATOR',$3) returning id`, [ORG, `${PREFIX}Operador B`, teamB])).rows[0]!.id
    created.people.push(operatorB)
    const newCase = async (personId: string, teamId: string) => {
      const caseId = (await pool.query<{ id: string }>(`insert into supervision_cases (organization_id, operator_id, team_id, title, summary, priority, indicator_code, indicator_value, indicator_target) values ($1,$2,$3,$4,'Prova','P2','PROVA',0,0) returning id`, [ORG, personId, teamId, `${PREFIX}Caso`])).rows[0]!.id
      created.cases.push(caseId)
      return caseId
    }
    const caseA = await newCase(operator, teamA)
    const caseB = await newCase(operatorB, teamB)
    const runs = await runsOf(id)
    await pool.query(`update agent_runs set case_id = $2 where id = $1`, [runs[0]!.id, caseA])
    const caseRecords = await admin.get(`/api/v1/supervision-cases/${caseA}/agent-records`)
    expect(caseRecords.status).toBe(200)
    expect(caseRecords.body.data).toEqual([expect.objectContaining({ agentId: id, agentActive: false })])
    expect((await manager.get(`/api/v1/supervision-cases/${caseA}/agent-records`)).body.data).toEqual([expect.objectContaining({ agentId: id })])
    expect((await manager.get(`/api/v1/supervision-cases/${caseB}/agent-records`)).status).toBe(404)
  })
})
