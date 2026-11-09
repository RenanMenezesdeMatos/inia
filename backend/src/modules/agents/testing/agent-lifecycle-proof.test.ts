import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

/**
 * PROVA do bloco aprovado em 03/11/2026 (PEN-001, PEN-065 a PEN-076, PEN-002, PEN-049, PEN-050, ponto da PEN-047) contra o banco
 * de TESTE real (migrations 164/165 aplicadas), pelo mesmo contrato do produto (API admin) e pelas mesmas funções do motor.
 * ZERO chamada paga de IA: nenhuma execução de agente chega ao modelo (as execuções de uso são registradas pelo mesmo
 * registrador do runtime; a nova tentativa é criada e conferida, não processada).
 *
 *   INIA_DB_PROOF=1 npx vitest run agent-lifecycle-proof
 *
 * Perfil "administra agentes sem ser administrador": nenhum papel de sistema tem hoje `agents.manage` sem `agents.inactive.manage`
 * (o mapeamento dos perfis da Vivo é a PEN-032). Para provar a restrição no servidor, esta prova acrescenta SÓ AQUI um papel de
 * teste com `agents.manage` + `workflows.manage` — nunca existe fora da prova.
 */
vi.mock("../../access/domain/roles.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../access/domain/roles.js")>()
  const proofRole = { code: "PROVA_GESTOR_DE_AGENTES", name: "Prova — gestor de agentes", description: "Só na prova.", permissions: ["agents.manage", "workflows.manage"], allowedScopes: ["ORGANIZATION", "GROUP", "SUBGROUP"], delegates: [], system: true } as const
  const roles = [...original.SYSTEM_ROLES, proofRole]
  const catalog = { find: (code: string) => roles.find((role) => role.code === code) ?? null, all: () => roles }
  return { ...original, SYSTEM_ROLES: roles, systemRoleCatalog: catalog, rolesWithPermission: (permission: string, cat = catalog) => cat.all().filter((role) => (role.permissions as readonly string[]).includes(permission)).map((role) => role.code) }
})

const { env } = await import("../../../config/env.js")
const { createApp } = await import("../../../main/app.js")
const { setProofAccountPassword } = await import("../../auth/testing/proof-account-password.js")
const { productionAgentRuns } = await import("../../workflows/application/effect-sink.js")
const { resolveAgentVersionForRun } = await import("../application/agent-versions.js")
const { configFromLiveRow, AGENT_LIVE_COLUMNS, sameAgentConfig, parseAgentConfig } = await import("../domain/agent-config.js")
const { processEnrollment } = await import("../../workflows/application/engine.js")
const { resolveWorkflowAgentSnapshot, pinGraphReferences } = await import("../../workflows/application/workflow-agent-version.js")
const { previewWorkflowRetry, confirmWorkflowRetry, priorChainDelivery, WORKFLOW_OFF_RETRY_MESSAGE } = await import("../../workflows/application/workflow-retry.js")
const { resolveOrchestratorById, resolveOrchestratorForTeam } = await import("../../assistant/application/resolve-orchestrator.js")
const { appendConversationMessage } = await import("../../assistant/application/assistant-conversations.js")

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const ADMIN = { email: "carla.nunes@inia.com", password: "Inia@123" }
const MANAGER = { email: "prova-gestor-agentes@proof.inia.local", password: "Prova@12345" }
const PREFIX = "Prova Ciclo · "
const INTERACTION = "00000000-0000-4000-8000-000000000500"

let pool: pg.Pool
let admin: ReturnType<typeof request.agent>
let manager: ReturnType<typeof request.agent>
let teamA = ""
let teamB = ""
let operatorId = ""
const created = { people: [] as string[], workflows: [] as string[], conversations: [] as string[] }

const agentBody = (name: string, extra: Record<string, unknown> = {}) => ({
  name: `${PREFIX}${name}`,
  agentType: "CUSTOM",
  objective: "Objetivo da versão 1.",
  description: "Agente temporário da prova do ciclo de vida.",
  contextPrompt: "Contexto da prova.",
  scopeType: "ALL_TEAMS",
  ...extra,
})

async function cleanup() {
  await pool.query(`delete from workflow_enrollment_events where enrollment_id in (select e.id from workflow_enrollments e join workflows w on w.id = e.workflow_id where w.organization_id = $1 and w.name like $2)`, [ORG, `${PREFIX}%`])
  await pool.query(`update workflow_enrollments set retry_of_enrollment_id = null where workflow_id in (select id from workflows where organization_id = $1 and name like $2)`, [ORG, `${PREFIX}%`])
  await pool.query(`delete from workflow_enrollments where workflow_id in (select id from workflows where organization_id = $1 and name like $2)`, [ORG, `${PREFIX}%`])
  await pool.query(`update workflows set active_version_id = null where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])
  await pool.query(`delete from workflow_versions where workflow_id in (select id from workflows where organization_id = $1 and name like $2)`, [ORG, `${PREFIX}%`])
  await pool.query(`delete from workflows where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])
  await pool.query(`delete from assistant_interactions where conversation_id = any($1::uuid[])`, [created.conversations])
  await pool.query(`delete from assistant_conversations where id = any($1::uuid[])`, [created.conversations])
  await pool.query(`delete from assistant_orchestrators where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])
  const agents = (await pool.query<{ id: string }>(`select id from agents where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])).rows.map((row) => row.id)
  await pool.query(`delete from assistant_interaction_agents where agent_id = any($1::uuid[])`, [agents])
  await pool.query(`delete from agent_runs where agent_id = any($1::uuid[])`, [agents])
  await pool.query(`update agents set current_version_id = null where id = any($1::uuid[])`, [agents])
  await pool.query(`delete from agents where id = any($1::uuid[])`, [agents])
  await pool.query(`delete from access_role_assignments where user_account_id in (select id from user_accounts where email = $1)`, [MANAGER.email])
  await pool.query(`delete from user_accounts where email = $1`, [MANAGER.email])
  await pool.query(`delete from people where organization_id = $1 and (id = any($2::uuid[]) or name = 'Prova Gestor de Agentes')`, [ORG, created.people])
}

async function insertWorkflow(name: string, graph: unknown, options: { teamId?: string | null; active?: boolean; publish?: boolean } = {}) {
  const workflow = (await pool.query<{ id: string }>(
    `insert into workflows (organization_id, name, trigger_config, draft_graph, active, scope_type, team_id, draft_scope_type, draft_team_id) values ($1,$2,$3,$4,$5,$6,$7,$6,$7) returning id`,
    [ORG, `${PREFIX}${name}`, JSON.stringify({ kind: "channel_flag", channelFlagId: "00000000-0000-4000-8000-000000000000" }), JSON.stringify(graph), options.active ?? true, options.teamId ? "TEAM" : "ALL_TEAMS", options.teamId ?? null],
  )).rows[0]!.id
  created.workflows.push(workflow)
  let version: string | null = null
  if (options.publish !== false) {
    version = (await pool.query<{ id: string }>(`insert into workflow_versions (workflow_id, graph) values ($1,$2) returning id`, [workflow, JSON.stringify(graph)])).rows[0]!.id
    await pool.query(`update workflows set active_version_id = $2 where id = $1`, [workflow, version])
  }
  return { workflow, version }
}

const callAgentGraph = (agentId: string, agentVersionId?: string) => ({
  nodes: [
    { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
    { id: "agent", type: "action", label: "Analisar conversa", position: { x: 0, y: 1 }, config: { actionType: "CALL_AGENT", agentId, ...(agentVersionId ? { agentVersionId } : {}) } },
    { id: "end", type: "end", label: "Fim", position: { x: 0, y: 2 }, config: {} },
  ],
  edges: [["trigger", "agent"], ["agent", "end"]].map(([source, target]) => ({ id: `${source}-${target}`, source, target, sourceHandle: "always" })),
})

type Claimed = Parameters<typeof processEnrollment>[1]
async function claimed(id: string): Promise<Claimed> {
  return (await pool.query<Claimed>(
    `select we.id, we.organization_id, we.workflow_id, we.version_id, we.interaction_id, we.indicator_measurement_id, we.scheduled_subject_id, we.scheduled_for, we.current_node_id,
            we.matched_flag_name, we.matched_value_boolean, we.matched_value_numeric, we.status, we.attempts, we.revision, we.node_outputs, we.variables, we.parent_enrollment_id,
            w.scope_type, w.team_id workflow_team_id, w.subteam_id workflow_subteam_id, w.consolidated_structure, w.population_filter, now()::text claimed_until
     from workflow_enrollments we join workflows w on w.id = we.workflow_id where we.id = $1`,
    [id],
  )).rows[0]!
}

async function createPublished(name: string, extra: Record<string, unknown> = {}) {
  const createdAgent = await admin.post("/api/v1/admin/agents").send(agentBody(name, extra))
  expect(createdAgent.status, JSON.stringify(createdAgent.body)).toBe(201)
  const id = createdAgent.body.data.id as string
  const published = await admin.post(`/api/v1/admin/agents/${id}/publish`).send({})
  expect(published.status, JSON.stringify(published.body)).toBe(201)
  return { id, versionId: published.body.data.version.id as string }
}

describe.skipIf(!ENABLED)("Ciclo de vida dos agentes — exclusão, desativação, versões, Workflows, orquestradores e nova tentativa (banco de teste real)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    await cleanup()
    const teams = (await pool.query<{ id: string }>(`select id from teams where organization_id = $1 order by name limit 2`, [ORG])).rows
    teamA = teams[0]!.id
    teamB = teams[1]!.id
    operatorId = (await pool.query<{ id: string }>(`select id from people where organization_id = $1 and role = 'OPERATOR' limit 1`, [ORG])).rows[0]!.id
    const person = (await pool.query<{ id: string }>(`insert into people (organization_id, name, role, team_id) values ($1, 'Prova Gestor de Agentes', 'ADMIN', $2) returning id`, [ORG, teamA])).rows[0]!.id
    created.people.push(person)
    const account = (await pool.query<{ id: string }>(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1,$2,$3,'x') returning id`, [ORG, person, MANAGER.email])).rows[0]!.id
    await pool.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1,$2,'PROVA_GESTOR_DE_AGENTES','GROUP',$3,now())`, [ORG, account, teamA])
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

  it("migração 164: todo agente e orquestrador tem versão vigente igual à configuração em uso; versões publicadas são imutáveis", async () => {
    const agents = (await pool.query<Record<string, unknown> & { id: string; current_version_id: string | null }>(`select id, current_version_id, ${AGENT_LIVE_COLUMNS} from agents where draft_config is null or current_version_id is not null`)).rows
    expect(agents.length).toBeGreaterThan(0)
    for (const agent of agents) {
      expect(agent.current_version_id, `agente ${agent.id} sem versão`).not.toBeNull()
      const version = (await pool.query<{ config: unknown }>(`select config from agent_versions where id = $1`, [agent.current_version_id])).rows[0]!
      const knowledge = (await pool.query<{ id: string }>(`select knowledge_document_id id from agent_knowledge_documents where agent_id = $1`, [agent.id])).rows.map((row) => row.id)
      expect(sameAgentConfig(parseAgentConfig(version.config), configFromLiveRow(agent as never, knowledge)), `agente ${agent.id}`).toBe(true)
    }
    expect((await pool.query(`select 1 from assistant_orchestrators where current_version_id is null`)).rowCount).toBe(0)
    const sample = agents[0]!.current_version_id!
    await expect(pool.query(`update agent_versions set config = '{}'::jsonb where id = $1`, [sample])).rejects.toThrow(/imutável/)
    await expect(pool.query(`delete from agent_versions where id = $1`, [sample])).rejects.toThrow(/Versão publicada só sai junto/)
  })

  it("criar = só rascunho: não executa fora do teste e aparece como não publicado; publicar cria a versão 1 vigente", async () => {
    const createdAgent = await admin.post("/api/v1/admin/agents").send(agentBody("Novo"))
    expect(createdAgent.status).toBe(201)
    expect(createdAgent.body.data).toMatchObject({ published: false, currentVersionNumber: null, hasDraft: true })
    const id = createdAgent.body.data.id
    await expect(resolveAgentVersionForRun(pool, ORG, id)).rejects.toMatchObject({ code: "AGENT_NOT_PUBLISHED" })
    const published = await admin.post(`/api/v1/admin/agents/${id}/publish`).send({ expectedDraftRevision: createdAgent.body.data.draftRevision })
    expect(published.status).toBe(201)
    expect(published.body.data.version.number).toBe(1)
    expect(published.body.data.agent).toMatchObject({ published: true, currentVersionNumber: 1, hasDraft: false, active: true })
    const history = await admin.get(`/api/v1/admin/agents/${id}/history`)
    expect(history.body.data.map((entry: { action: string }) => entry.action)).toEqual(expect.arrayContaining(["CREATED", "PUBLISHED"]))
  })

  it("rascunho não afeta a versão em uso; conflito de edição não sobrescreve; publicar cria versão 2; reverter cria versão 3 sem apagar nada", async () => {
    const { id } = await createPublished("Versões")
    const before = (await admin.get(`/api/v1/admin/agents/${id}`)).body.data
    const saved = await admin.patch(`/api/v1/admin/agents/${id}`).send({ objective: "Objetivo da versão 2.", expectedDraftRevision: before.draftRevision })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    expect(saved.body.data).toMatchObject({ objective: "Objetivo da versão 1.", hasDraft: true, currentVersionNumber: 1 })
    expect(saved.body.data.draft.config.objective).toBe("Objetivo da versão 2.")
    // CA-010.7: execução continua na versão 1.
    expect((await resolveAgentVersionForRun(pool, ORG, id)).config.objective).toBe("Objetivo da versão 1.")
    // PEN-050: edição baseada numa revisão antiga é recusada e nada muda.
    const stale = await admin.patch(`/api/v1/admin/agents/${id}`).send({ objective: "Sobrescrita silenciosa.", expectedDraftRevision: before.draftRevision })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe("AGENT_DRAFT_CONFLICT")
    expect((await admin.get(`/api/v1/admin/agents/${id}`)).body.data.draft.config.objective).toBe("Objetivo da versão 2.")
    const v2 = await admin.post(`/api/v1/admin/agents/${id}/publish`).send({})
    expect(v2.body.data.version.number).toBe(2)
    expect((await resolveAgentVersionForRun(pool, ORG, id)).config.objective).toBe("Objetivo da versão 2.")
    // Revert com rascunho em andamento exige confirmação explícita.
    await admin.patch(`/api/v1/admin/agents/${id}`).send({ description: "Rascunho em andamento." })
    const versions = (await admin.get(`/api/v1/admin/agents/${id}/versions`)).body.data as { id: string; number: number }[]
    const v1 = versions.find((version) => version.number === 1)!
    const refused = await admin.post(`/api/v1/admin/agents/${id}/versions/${v1.id}/revert`).send({})
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe("AGENT_DRAFT_PENDING")
    const reverted = await admin.post(`/api/v1/admin/agents/${id}/versions/${v1.id}/revert`).send({ discardDraft: true })
    expect(reverted.status).toBe(201)
    expect(reverted.body.data.version.number).toBe(3)
    const after = (await admin.get(`/api/v1/admin/agents/${id}/versions`)).body.data as { number: number; origin: string; revertedFromNumber: number | null; current: boolean }[]
    expect(after.map((version) => version.number)).toEqual([3, 2, 1])
    expect(after[0]).toMatchObject({ origin: "REVERT", revertedFromNumber: 1, current: true })
    expect((await resolveAgentVersionForRun(pool, ORG, id)).config.objective).toBe("Objetivo da versão 1.")
    const v1Content = (await admin.get(`/api/v1/admin/agents/${id}/versions/${v1.id}`)).body.data.config
    expect(v1Content.objective).toBe("Objetivo da versão 1.")
  })

  it("publicar não reativa (CA-010.10); inativo: só administrador lista, consulta, reativa e exclui — também no servidor", async () => {
    const { id } = await createPublished("Inativo", { scopeType: "TEAM", teamId: teamA })
    expect((await manager.get(`/api/v1/admin/agents/${id}`)).status).toBe(200)
    expect((await admin.patch(`/api/v1/admin/agents/${id}`).send({ active: false })).status).toBe(200)
    await admin.patch(`/api/v1/admin/agents/${id}`).send({ objective: "Mudança no inativo." })
    const published = await admin.post(`/api/v1/admin/agents/${id}/publish`).send({})
    expect(published.body.data.agent).toMatchObject({ active: false, currentVersionNumber: 2 })
    // Pessoa que administra agentes sem ser administradora (perfil de prova; PEN-032).
    const list = await manager.get("/api/v1/admin/agents").query({ search: `${PREFIX}Inativo` })
    expect(list.body.data.map((agent: { id: string }) => agent.id)).not.toContain(id)
    for (const path of ["", "/history", "/runs", "/versions", "/deletion-check"]) {
      const response = await manager.get(`/api/v1/admin/agents/${id}${path}`)
      expect(response.status, path).toBe(403)
      expect(JSON.stringify(response.body)).not.toContain("Mudança no inativo")
    }
    expect((await manager.patch(`/api/v1/admin/agents/${id}`).send({ active: true })).status).toBe(403)
    expect((await manager.delete(`/api/v1/admin/agents/${id}`)).status).toBe(403)
    // Administrador: lista, lê o histórico completo e reativa.
    expect((await admin.get("/api/v1/admin/agents").query({ active: "false", search: `${PREFIX}Inativo` })).body.data.map((agent: { id: string }) => agent.id)).toContain(id)
    const history = (await admin.get(`/api/v1/admin/agents/${id}/history`)).body.data as { changes: { from: string; to: string }[] }[]
    expect(JSON.stringify(history)).toContain("Mudança no inativo.")
    expect((await admin.patch(`/api/v1/admin/agents/${id}`).send({ active: true })).body.data.active).toBe(true)
  })

  it("exclusão: sem uso nem dependência exclui e mantém as bases; teste (qualquer situação), conversa e Workflow (inclusive rascunho) bloqueiam; referência fora do alcance não vaza", async () => {
    const free = await createPublished("Livre", { scopeType: "TEAM", teamId: teamA })
    await admin.patch(`/api/v1/admin/agents/${free.id}`).send({ contextPrompt: "Editado sem uso." })
    expect((await admin.delete(`/api/v1/admin/agents/${free.id}`)).status).toBe(204)
    expect((await pool.query(`select 1 from agents where id = $1`, [free.id])).rowCount).toBe(0)

    // Execução em andamento (PENDING) barra: o Agent está em uso agora. Histórico não barra mais: ver a conversa abaixo e deleted-items-proof.
    const used = await createPublished("Usado", { scopeType: "TEAM", teamId: teamA })
    await productionAgentRuns.start(pool, { organizationId: ORG, agentId: used.id, source: "MANUAL_TEST", inputContext: "prova", agentVersionId: used.versionId })
    const blocked = await admin.delete(`/api/v1/admin/agents/${used.id}`)
    expect(blocked.status).toBe(409)
    expect(blocked.body.error.code).toBe("AGENT_DELETE_BLOCKED")
    expect(blocked.body.error.details).toMatchObject({ hasUsage: true, usage: { runs: 1, runningRuns: 1 } })

    // CA-011.12: conversa em que o agente atuou conta como histórico, que fica guardado e não impede excluir.
    const chatted = await createPublished("Conversou", { scopeType: "TEAM", teamId: teamA })
    const conversation = (await pool.query<{ id: string }>(`insert into assistant_conversations (organization_id, owner_person_id, started_at, last_activity_at, status, closed_at, close_reason) values ($1,$2,now(),now(),'CLOSED',now(),'INACTIVITY') returning id`, [ORG, operatorId])).rows[0]!.id
    created.conversations.push(conversation)
    await appendConversationMessage(pool, { conversationId: conversation, organizationId: ORG, ownerPersonId: operatorId, channel: "chat", role: "assistant", content: "Resposta.", occurredAt: new Date(), toolCalls: [{ toolName: `agent_${chatted.id.replace(/-/g, "")}`, query: "q", agentId: chatted.id, agentVersionId: chatted.versionId, outcome: "BLOCKED_INACTIVE" }] })
    const participation = (await pool.query<{ agent_version_id: string; outcome: string }>(`select agent_version_id, outcome from assistant_interaction_agents where agent_id = $1`, [chatted.id])).rows
    expect(participation).toEqual([{ agent_version_id: chatted.versionId, outcome: "BLOCKED_INACTIVE" }])
    expect((await admin.get(`/api/v1/admin/agents/${chatted.id}/deletion-check`)).body.data).toMatchObject({ deletable: true, hasUsage: true, usage: { conversations: 1 } })

    // PEN-066: Workflow em rascunho (nunca publicado) do mesmo alcance aparece com dados e link; o de outro Grupo, só o aviso.
    const referenced = await createPublished("Referenciado", { scopeType: "TEAM", teamId: teamA })
    await insertWorkflow("Rascunho visível", callAgentGraph(referenced.id), { teamId: teamA, publish: false, active: false })
    await insertWorkflow("Outro grupo", callAgentGraph(referenced.id), { teamId: teamB })
    const check = (await manager.get(`/api/v1/admin/agents/${referenced.id}/deletion-check`)).body.data
    expect(check).toMatchObject({ deletable: false, hasUsage: false, hasRestrictedReferences: true })
    expect(check.references).toEqual([expect.objectContaining({ kind: "WORKFLOW", name: `${PREFIX}Rascunho visível`, status: "DRAFT", usages: ["Analisar conversa"] })])
    expect(JSON.stringify(check)).not.toContain("Outro grupo")
    const refusedDelete = await manager.delete(`/api/v1/admin/agents/${referenced.id}`)
    expect(refusedDelete.status).toBe(409)
    expect(JSON.stringify(refusedDelete.body)).not.toContain("Outro grupo")
  })

  it("PEN-069: exclusão e início de execução ao mesmo tempo — nunca execução registrada para agente excluído", async () => {
    for (let round = 0; round < 3; round += 1) {
      const { id, versionId } = await createPublished(`Corrida ${round}`)
      const [deleted, started] = await Promise.allSettled([
        admin.delete(`/api/v1/admin/agents/${id}`),
        productionAgentRuns.start(pool, { organizationId: ORG, agentId: id, source: "MANUAL_TEST", inputContext: "corrida", agentVersionId: versionId }),
      ])
      const exists = (await pool.query(`select 1 from agents where id = $1`, [id])).rowCount === 1
      const runs = (await pool.query(`select 1 from agent_runs where agent_id = $1`, [id])).rowCount
      if (exists) {
        expect(started.status).toBe("fulfilled")
        expect(runs).toBe(1)
        expect(deleted.status === "fulfilled" && deleted.value.status).toBe(409)
      } else {
        expect(started.status).toBe("rejected")
        expect(runs).toBe(0)
      }
    }
  })

  it("revisão de 03/11/2026 — atualização automática: a etapa do Workflow usa a versão vigente; referência antiga no grafo é ignorada; publicar o Workflow não fixa agente", async () => {
    const { id, versionId: v1 } = await createPublished("Vigente")
    await admin.patch(`/api/v1/admin/agents/${id}`).send({ objective: "Objetivo da versão 2." })
    const v2 = (await admin.post(`/api/v1/admin/agents/${id}/publish`).send({})).body.data.version.id as string
    // Sem republicar nada: a próxima execução já usa a versão 2.
    expect((await resolveWorkflowAgentSnapshot(pool, ORG, id, null)).versionId).toBe(v2)
    expect((await resolveWorkflowAgentSnapshot(pool, ORG, id, null)).config.objective).toBe("Objetivo da versão 2.")
    // A versão 1 continua existindo, imutável, e o rascunho não afeta a produção.
    await admin.patch(`/api/v1/admin/agents/${id}`).send({ objective: "Rascunho que não vale." })
    expect((await resolveWorkflowAgentSnapshot(pool, ORG, id, null)).config.objective).toBe("Objetivo da versão 2.")
    expect((await pool.query(`select config->>'objective' o from agent_versions where id = $1`, [v1])).rows[0]).toEqual({ o: "Objetivo da versão 1." })
    // Publicar o Workflow não fixa versão de agente (a referência de grafos antigos fica como está, sem efeito).
    const pinned = await pinGraphReferences(pool, ORG, callAgentGraph(id, v1))
    expect((pinned.nodes[1] as { config: { agentVersionId?: string } }).config.agentVersionId).toBe(v1)
    const unpinned = await pinGraphReferences(pool, ORG, callAgentGraph(id))
    expect((unpinned.nodes[1] as { config: { agentVersionId?: string } }).config.agentVersionId).toBeUndefined()
  })

  it("agente desativado depois do início: a execução fica 'Bloqueada — agente inativo', sem tentativa automática; nova tentativa só confirmada, conferida e sem duplicar", async () => {
    const { id, versionId } = await createPublished("Bloqueado")
    const { workflow, version } = await insertWorkflow("Bloqueio", callAgentGraph(id, versionId))
    const enrollment = (await pool.query<{ id: string }>(`insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, interaction_id, matched_flag_name, matched_value_boolean) values ($1,$2,$3,'agent','active','2999-01-01',$4,'prova',true) returning id`, [ORG, workflow, version, INTERACTION])).rows[0]!.id
    await pool.query(`update agents set active = false where id = $1`, [id])
    await processEnrollment(pool, await claimed(enrollment))
    const state = (await pool.query<{ status: string; blocked_reason: string; blocked_node_id: string; attempts: number }>(`select status, blocked_reason, blocked_node_id, attempts from workflow_enrollments where id = $1`, [enrollment])).rows[0]!
    expect(state).toMatchObject({ status: "blocked", blocked_reason: "AGENT_INACTIVE", blocked_node_id: "agent", attempts: 0 })
    expect((await pool.query(`select 1 from agent_runs where agent_id = $1`, [id])).rowCount).toBe(0)
    expect((await pool.query(`select 1 from workflow_enrollment_events where enrollment_id = $1 and event_type = 'node_blocked'`, [enrollment])).rowCount).toBe(1)

    // Agente ainda inativo: a prévia mostra o impedimento e a confirmação é recusada (CA-WF101.8).
    const stillInactive = await previewWorkflowRetry(pool, ORG, enrollment)
    expect(stillInactive.blockers.map((blocker) => blocker.code)).toContain("WORKFLOW_AGENT_INACTIVE")
    await expect(confirmWorkflowRetry(pool, ORG, enrollment, { fingerprint: stillInactive.fingerprint }, { personId: null, name: "Prova" })).rejects.toMatchObject({ code: "WORKFLOW_AGENT_INACTIVE" })

    // Reativar não cria tentativa sozinha (CA-WF101.3).
    await pool.query(`update agents set active = true where id = $1`, [id])
    expect((await pool.query(`select status from workflow_enrollments where id = $1`, [enrollment])).rows[0]).toEqual({ status: "blocked" })
    expect((await pool.query(`select 1 from workflow_enrollments where retry_of_enrollment_id = $1`, [enrollment])).rowCount).toBe(0)

    // Workflow desligado: mensagem decidida e recusa no servidor (PEN-075).
    await pool.query(`update workflows set active = false where id = $1`, [workflow])
    const off = await previewWorkflowRetry(pool, ORG, enrollment)
    expect(off.blockers[0]).toEqual({ code: "WORKFLOW_RETRY_WORKFLOW_INACTIVE", message: WORKFLOW_OFF_RETRY_MESSAGE })
    await expect(confirmWorkflowRetry(pool, ORG, enrollment, { fingerprint: off.fingerprint }, { personId: null, name: "Prova" })).rejects.toMatchObject({ code: "WORKFLOW_RETRY_WORKFLOW_INACTIVE" })
    await pool.query(`update workflows set active = true where id = $1`, [workflow])

    // Confirmação com dados velhos: nada começa e pede nova confirmação (CA-WF101.14).
    const preview = await previewWorkflowRetry(pool, ORG, enrollment)
    expect(preview).toMatchObject({ blockers: [], startsAt: "BLOCKED_STEP", workflowVersion: { id: version } })
    expect(preview.agents).toEqual([expect.objectContaining({ agentId: id, agentVersionId: versionId, agentVersionNumber: 1 })])
    await expect(confirmWorkflowRetry(pool, ORG, enrollment, { fingerprint: "0000000000000000" }, { personId: null, name: "Prova" })).rejects.toMatchObject({ code: "WORKFLOW_RETRY_RECONFIRM" })

    const retry = await confirmWorkflowRetry(pool, ORG, enrollment, { fingerprint: preview.fingerprint }, { personId: null, name: "Prova" })
    const retryRow = (await pool.query<{ status: string; retry_of_enrollment_id: string; current_node_id: string; version_id: string }>(`select status, retry_of_enrollment_id, current_node_id, version_id from workflow_enrollments where id = $1`, [retry.enrollmentId])).rows[0]!
    expect(retryRow).toEqual({ status: "active", retry_of_enrollment_id: enrollment, current_node_id: "agent", version_id: version })
    expect((await pool.query(`select status from workflow_enrollments where id = $1`, [enrollment])).rows[0]).toEqual({ status: "blocked" })
    // Uma tentativa por vez.
    await expect(confirmWorkflowRetry(pool, ORG, enrollment, { fingerprint: preview.fingerprint }, { personId: null, name: "Prova" })).rejects.toMatchObject({ code: "WORKFLOW_RETRY_IN_PROGRESS" })
    // Entrega já feita pela original (antes do bloqueio) não se repete na tentativa (CA-WF101.9, CA-WF101.17).
    await pool.query(`insert into workflow_enrollment_events (enrollment_id, node_id, event_type, payload, idempotency_key) values ($1,'recado','output_dispatched','{}','prova-recado')`, [enrollment])
    expect(await priorChainDelivery(pool, retry.enrollmentId, "recado")).toMatchObject({ enrollmentId: enrollment })
    expect(await priorChainDelivery(pool, enrollment, "recado")).toBeNull()
  })

  it("orquestrador versionado (PEN-076 com a revisão): versões guardam a configuração; especialistas rodam na vigente no chat e no Workflow; conflito e não publicado recusados", async () => {
    const coordinator = await createPublished("Coordenador", { agentType: "ORCHESTRATOR" })
    const specialist = await createPublished("Especialista", { specialtyKind: "PERFORMANCE" })
    const unpublished = (await admin.post("/api/v1/admin/agents").send(agentBody("Especialista não publicado", { specialtyKind: "PERFORMANCE" }))).body.data.id as string
    const refused = await admin.post("/api/v1/admin/assistant-orchestrators").send({ name: `${PREFIX}Orq recusado`, scopeType: "TEAM", teamId: teamA, orchestratorAgentId: coordinator.id, specialistAgentIds: [unpublished], invocationMode: "WORKFLOW", routingPolicy: "OPEN" })
    expect(refused.status).toBe(422)
    expect(refused.body.error.code).toBe("ORCHESTRATOR_AGENT_NOT_PUBLISHED")
    const orchestrator = await admin.post("/api/v1/admin/assistant-orchestrators").send({ name: `${PREFIX}Orq`, scopeType: "TEAM", teamId: teamA, orchestratorAgentId: coordinator.id, specialistAgentIds: [specialist.id], invocationMode: "BOTH", routingPolicy: "OPEN" })
    expect(orchestrator.status, JSON.stringify(orchestrator.body)).toBe(201)
    const orchestratorId = orchestrator.body.data.id as string
    const v1 = orchestrator.body.data.currentVersionId as string
    expect(orchestrator.body.data.specialists[0]).toMatchObject({ agentCurrentVersionNumber: 1, published: true })
    // A versão do Orquestrador guarda a configuração, sem versão de agente.
    expect((await pool.query<{ config: { specialists: Record<string, unknown>[] } }>(`select config from assistant_orchestrator_versions where id = $1`, [v1])).rows[0]!.config.specialists).toEqual([{ agentId: specialist.id, toolName: expect.any(String) }])

    await admin.patch(`/api/v1/admin/agents/${specialist.id}`).send({ objective: "Especialista versão 2." })
    const specialistV2 = (await admin.post(`/api/v1/admin/agents/${specialist.id}/publish`).send({})).body.data.version.id as string
    // Publicar o especialista não cria versão do Orquestrador.
    expect((await admin.get(`/api/v1/admin/assistant-orchestrators/${orchestratorId}`)).body.data).toMatchObject({ currentVersionId: v1, currentVersionNumber: 1 })

    // PEN-050: gravação baseada numa versão antiga do Orquestrador é recusada.
    const stale = await admin.patch(`/api/v1/admin/assistant-orchestrators/${orchestratorId}`).send({ name: `${PREFIX}Orq renomeado`, expectedVersionId: "00000000-0000-4000-8000-000000000999" })
    expect(stale.status).toBe(409)
    const renamed = await admin.patch(`/api/v1/admin/assistant-orchestrators/${orchestratorId}`).send({ name: `${PREFIX}Orq renomeado`, expectedVersionId: v1 })
    expect(renamed.body.data).toMatchObject({ currentVersionNumber: 2 })

    // Workflow fixado na versão 1 da configuração e chat (vigente): o especialista roda na versão 2 nos dois.
    const pinned = await resolveOrchestratorById(pool, ORG, orchestratorId, "WORKFLOW", "pergunta", { versionId: v1, legacyPin: false, workflowScope: { scopeType: "TEAM", teamId: teamA, subteamId: null } })
    expect(pinned).toMatchObject({ orchestratorVersionId: v1, orchestratorVersionNumber: 1 })
    expect(pinned!.specialists).toEqual([expect.objectContaining({ agentId: specialist.id, agentVersionId: specialistV2 })])
    expect(pinned!.tools[0]!.description).toContain("Especialista versão 2.")
    const chat = await resolveOrchestratorForTeam(pool, ORG, teamA, "INTERACTIVE", "pergunta")
    expect(chat!.orchestratorId).toBe(orchestratorId)
    expect(chat!.specialists).toEqual([expect.objectContaining({ agentId: specialist.id, agentVersionId: specialistV2 })])
    expect((await admin.get(`/api/v1/admin/assistant-orchestrators/${orchestratorId}/versions`)).body.data.map((version: { number: number }) => version.number)).toEqual([2, 1])
  })
})
