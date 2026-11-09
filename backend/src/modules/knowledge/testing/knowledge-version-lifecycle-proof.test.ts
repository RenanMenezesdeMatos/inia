import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

/**
 * PROVA da PEN-008 (04/11/2026) — atualização automática, status e histórico comparável das bases. Banco de teste real, API real; o
 * PROVEDOR DE IA é simulado na fronteira do gateway: nenhuma chamada paga. A API roda sem o processamento na hora, para a prova
 * controlar o instante em que cada versão fica pronta.
 *
 *   INIA_DB_PROOF=1 npx vitest run knowledge-version-lifecycle-proof
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const control = vi.hoisted(() => ({
  /** Roda na primeira chamada ao modelo que não seja roteamento nem esclarecimento: a publicação fica pronta "durante" o especialista. */
  during: null as null | (() => Promise<void>),
  /** Roda na decisão do esclarecimento: depois da primeira leitura das bases e antes de qualquer especialista. */
  duringClarification: null as null | (() => Promise<void>),
  /** Por rodada de roteamento, as ferramentas que o modelo simulado aciona. */
  routes: [] as string[][],
  /** O que cada chamada ao modelo fora do roteamento recebeu: é onde se vê de qual versão vieram os trechos. */
  prompts: [] as string[],
}))
vi.mock("../../../shared/application/model-routing/llm-gateway.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../shared/application/model-routing/llm-gateway.js")>()
  const usage = { inputTokens: 10, outputTokens: 10, totalTokens: 20, cachedInputTokens: 0, thinkingTokens: 0 }
  const reply = { usage, durationMs: 1, model: "simulado", cache: { cacheable: false, hit: false } }
  const simulated = async (gatewayRequest: { tools?: unknown[]; systemPrompt?: string; contents?: unknown; structuredOutput?: boolean; classification?: { purpose?: string } }) => {
    // A conferência da resposta (PEN-017) também passa por aqui: permite, e não entra na lista de prompts desta prova.
    if (gatewayRequest.classification?.purpose === "RESPONSE_COMPLIANCE") return { kind: "text", text: JSON.stringify({ verdict: "ALLOW", violated: [] }), ...reply }
    if (gatewayRequest.classification?.purpose === "KNOWLEDGE_CLARIFICATION") {
      const hook = control.duringClarification
      control.duringClarification = null
      if (hook) await hook()
      return { kind: "text", text: JSON.stringify({ decision: "NOT_APPLICABLE" }), ...reply }
    }
    if (gatewayRequest.tools?.length) {
      const names = control.routes.shift()
      if (names) return { kind: "functionCalls", calls: names.map((name) => ({ name, args: { query: "Como oriento a segunda via?" } })), ...reply }
    } else {
      control.prompts.push(JSON.stringify({ system: gatewayRequest.systemPrompt, contents: gatewayRequest.contents }))
    }
    if (control.during) {
      const hook = control.during
      control.during = null
      await hook()
    }
    return { kind: "text", text: gatewayRequest.structuredOutput ? JSON.stringify({ title: "Segunda via", summary: "Resumo simulado.", impactedIndicator: "Não se aplica", evidenceFound: "Preciso da segunda via.", observedBehavior: "Orientou a segunda via.", relatedProcedure: "Segunda via", recommendation: "Confirme o e-mail." }) : "Resposta simulada do agente.", ...reply }
  }
  return { ...original, generateForRoute: simulated, streamForRoute: simulated }
})

const { docxWithLines, pdfWithLines, DOCX_CONTENT_TYPE, PDF_CONTENT_TYPE } = await import("./knowledge-file-fixtures.js")
const { env } = await import("../../../config/env.js")
const { createApp } = await import("../../../main/app.js")
const { setProofAccountPassword } = await import("../../auth/testing/proof-account-password.js")
const { KnowledgeProcessingError, processKnowledgeVersion, processPendingKnowledgeVersions, MAX_PROCESSING_ATTEMPTS } = await import("../application/knowledge-versions.js")
const { retrieveKnowledgeForAgent } = await import("../application/retrieve-knowledge.js")
const { withKnowledgeConsultation } = await import("../application/knowledge-consultation-context.js")
const { appendConversationMessage } = await import("../../assistant/application/assistant-conversations.js")
const { productionEffects } = await import("../../workflows/application/effect-sink.js")
const { processEnrollment } = await import("../../workflows/application/engine.js")
const { loadProductCatalogAt } = await import("../../product-catalog/infrastructure/product-catalog-loaders.js")

const ORG = "00000000-0000-4000-8000-000000000001"
const PREFIX = "Prova Bases · "
const API = "/api/v1/admin/knowledge"
const ADMIN = { email: "carla.nunes@inia.com", password: "Inia@123" }
const ACCOUNTS = {
  teamA: { email: "prova-kb-a@proof.inia.local", password: "Prova@12345" },
  teamB: { email: "prova-kb-b@proof.inia.local", password: "Prova@12345" },
  operator: { email: "prova-kb-op@proof.inia.local", password: "Prova@12345" },
  otherOrg: { email: "prova-kb-org@proof.inia.local", password: "Prova@12345" },
}
const V1_TEXT = "# Segunda via\nConfirme o e-mail do cliente.\nEnvie a segunda via.\nEncerre o atendimento."

let pool: pg.Pool
let admin: ReturnType<typeof request.agent>
let adminTeamA: ReturnType<typeof request.agent>
let adminTeamB: ReturnType<typeof request.agent>
let operator: ReturnType<typeof request.agent>
let otherOrgAdmin: ReturnType<typeof request.agent>
let teamA = ""
let teamB = ""
let otherOrg = ""

async function cleanup() {
  const workflows = (await pool.query<{ id: string }>(`select id from workflows where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])).rows.map((row) => row.id)
  await pool.query(`delete from alerts where workflow_enrollment_id in (select id from workflow_enrollments where workflow_id = any($1::uuid[]))`, [workflows]).catch(() => undefined)
  await pool.query(`delete from workflow_outputs where enrollment_id in (select id from workflow_enrollments where workflow_id = any($1::uuid[]))`, [workflows])
  await pool.query(`delete from workflow_enrollment_events where enrollment_id in (select id from workflow_enrollments where workflow_id = any($1::uuid[]))`, [workflows])
  await pool.query(`update workflow_enrollments set retry_of_enrollment_id = null, parent_enrollment_id = null where workflow_id = any($1::uuid[])`, [workflows])
  await pool.query(`delete from workflow_enrollments where workflow_id = any($1::uuid[])`, [workflows])
  await pool.query(`delete from workflow_manual_runs where workflow_id = any($1::uuid[])`, [workflows])
  await pool.query(`update workflows set active_version_id = null where id = any($1::uuid[])`, [workflows])
  await pool.query(`delete from workflow_versions where workflow_id = any($1::uuid[])`, [workflows])
  await pool.query(`delete from workflows where id = any($1::uuid[])`, [workflows])
  await pool.query(`delete from assistant_orchestrators where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])
  await pool.query(`delete from transcripts where interaction_id in (select id from interactions where organization_id = $1 and external_id like 'PROVA-KB-%')`, [ORG])
  await pool.query(`delete from interactions where organization_id = $1 and external_id like 'PROVA-KB-%'`, [ORG])
  const documents = (await pool.query<{ id: string }>(`select id from knowledge_documents where organization_id = $1 and (title like $2 or id in (select document_id from knowledge_versions where config->>'title' like $2))`, [ORG, `${PREFIX}%`])).rows.map((row) => row.id)
  const agents = (await pool.query<{ id: string }>(`select id from agents where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])).rows.map((row) => row.id)
  const conversations = (await pool.query<{ id: string }>(`select c.id from assistant_conversations c join people p on p.id = c.owner_person_id where p.name like $1`, [`${PREFIX}%`])).rows.map((row) => row.id)
  await pool.query(`delete from assistant_interaction_agents where agent_id = any($1::uuid[])`, [agents])
  await pool.query(`delete from assistant_interactions where conversation_id = any($1::uuid[])`, [conversations])
  await pool.query(`delete from assistant_conversations where id = any($1::uuid[])`, [conversations])
  await pool.query(`delete from agent_runs where agent_id = any($1::uuid[])`, [agents])
  await pool.query(`update agents set current_version_id = null where id = any($1::uuid[])`, [agents])
  await pool.query(`delete from agents where id = any($1::uuid[])`, [agents])
  await pool.query(`delete from checkpoint_versions where knowledge_document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from checkpoint_definitions where knowledge_document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from checkpoint_change_sets where knowledge_document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from audit_logs where entity_id = any($1::uuid[])`, [documents])
  await pool.query(`alter table product_scope_assignments disable trigger user`)
  await pool.query(`delete from product_scope_assignments where source_id = any($1::uuid[])`, [documents])
  await pool.query(`alter table product_scope_assignments enable trigger user`)
  await pool.query(`delete from product_catalog_nodes where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])
  await pool.query(`delete from knowledge_versions where document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from knowledge_documents where id = any($1::uuid[])`, [documents])
  const emails = Object.values(ACCOUNTS).map((account) => account.email)
  await pool.query(`delete from access_role_assignments where user_account_id in (select id from user_accounts where email = any($1))`, [emails])
  await pool.query(`delete from auth_login_attempts where account_id in (select id from user_accounts where email = any($1))`, [emails])
  await pool.query(`delete from auth_session_activity where account_id in (select id from user_accounts where email = any($1))`, [emails])
  await pool.query(`delete from user_accounts where email = any($1)`, [emails])
  await pool.query(`delete from people where name like $1`, [`${PREFIX}%`])
  await pool.query(`delete from organizations where name like $1`, [`${PREFIX}%`])
}

async function createBase(name: string, content = V1_TEXT, scopes: unknown = [{ scopeType: "ALL_TEAMS" }]) {
  const created = await admin.post(API).field("title", `${PREFIX}${name}`).field("documentType", "PROCEDURE").field("content", content).field("orgScopes", JSON.stringify(scopes))
  expect(created.status, JSON.stringify(created.body)).toBe(201)
  return created.body.data.id as string
}
const detailOf = async (id: string, agent = admin) => (await agent.get(`${API}/${id}`)).body.data
type VersionItem = { id: string; number: number; situation: string; origin?: string; hasConfig?: boolean; supersededReason?: string | null; revertedFromNumber?: number | null }
const versionsOf = async (id: string, agent = admin) => (await agent.get(`${API}/${id}/versions`)).body.data as VersionItem[]
const versionId = async (id: string, number: number) => (await versionsOf(id)).find((version) => version.number === number)!.id as string

/** Pede a publicação; sem `process: false`, já processa. */
async function publish(id: string, options: { process?: boolean; body?: Record<string, unknown> } = {}) {
  const response = await admin.post(`${API}/${id}/publish`).send(options.body ?? {})
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  const update = response.body.data.updates[0] as { id: string }
  if (options.process !== false) expect(await processKnowledgeVersion(pool, update.id)).toBe("PUBLISHED")
  return update.id
}
async function publishedBase(name: string, content = V1_TEXT, scopes?: unknown) {
  const id = await createBase(name, content, scopes)
  await publish(id)
  return id
}
const edit = async (id: string, change: Record<string, unknown>) => {
  const response = await admin.patch(`${API}/${id}`).send(change)
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response.body.data
}

async function agentWith(name: string, documentIds: string[], extra: Record<string, unknown> = {}) {
  const created = await admin.post("/api/v1/admin/agents").send({ name: `${PREFIX}${name}`, agentType: "CUSTOM", objective: "Orientar.", description: "Agente da prova.", contextPrompt: "Contexto da prova.", scopeType: "ALL_TEAMS", knowledgeDocumentIds: documentIds, ...extra })
  expect(created.status, JSON.stringify(created.body)).toBe(201)
  const id = created.body.data.id as string
  const published = await admin.post(`/api/v1/admin/agents/${id}/publish`).send({})
  expect(published.status, JSON.stringify(published.body)).toBe(201)
  return id
}
const testAgent = async (agentId: string) => {
  const run = await admin.post(`/api/v1/admin/agents/${agentId}/test`).send({ input: "Como oriento a segunda via?", target: "VERSION" })
  expect(run.status, JSON.stringify(run.body)).toBe(201)
  return run.body.data.id as string
}
const usagesOf = async (sourceId: string) => (await pool.query<{ version: number; source_kind: string; agent_id: string | null }>(`select version, source_kind, agent_id from knowledge_version_usages where source_id = $1 order by version`, [sourceId])).rows

describe.skipIf(!ENABLED)("PEN-008 — bases de conhecimento: atualização automática, status e histórico (banco de teste real, provedor simulado)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    await cleanup()
    const teams = (await pool.query<{ id: string }>(`select id from teams where organization_id = $1 order by name limit 2`, [ORG])).rows
    teamA = teams[0]!.id
    teamB = teams[1]!.id
    const person = async (name: string, role: string, teamId: string | null, organizationId = ORG) => (await pool.query<{ id: string }>(`insert into people (organization_id, name, role, team_id) values ($1,$2,$3,$4) returning id`, [organizationId, `${PREFIX}${name}`, role, teamId])).rows[0]!.id
    const account = async (email: string, personId: string, organizationId = ORG) => (await pool.query<{ id: string }>(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1,$2,$3,'x') returning id`, [organizationId, personId, email])).rows[0]!.id
    const grant = (organizationId: string, accountId: string, role: string, scope: string, teamId: string | null) => pool.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1,$2,$3,$4,$5,now())`, [organizationId, accountId, role, scope, teamId])
    await grant(ORG, await account(ACCOUNTS.teamA.email, await person("Admin A", "ADMIN", teamA)), "ADMINISTRADOR", "GROUP", teamA)
    await grant(ORG, await account(ACCOUNTS.teamB.email, await person("Admin B", "ADMIN", teamB)), "ADMINISTRADOR", "GROUP", teamB)
    await account(ACCOUNTS.operator.email, await person("Operador A", "OPERATOR", teamA))
    otherOrg = (await pool.query<{ id: string }>(`insert into organizations (name, slug) values ($1,$2) returning id`, [`${PREFIX}Outra organização`, `prova-kb-${Date.now()}`])).rows[0]!.id
    await grant(otherOrg, await account(ACCOUNTS.otherOrg.email, await person("Admin outra org", "ADMIN", null, otherOrg), otherOrg), "ADMINISTRADOR_GERAL", "ORGANIZATION", null)
    await setProofAccountPassword(pool, ADMIN.email, ADMIN.password)
    for (const value of Object.values(ACCOUNTS)) await setProofAccountPassword(pool, value.email, value.password)
    const app = createApp(pool, { knowledgeInlineProcessing: false })
    admin = request.agent(app)
    adminTeamA = request.agent(app)
    adminTeamB = request.agent(app)
    operator = request.agent(app)
    otherOrgAdmin = request.agent(app)
    expect((await admin.post("/api/v1/auth/login").send(ADMIN)).status).toBe(200)
    expect((await adminTeamA.post("/api/v1/auth/login").send(ACCOUNTS.teamA)).status).toBe(200)
    expect((await adminTeamB.post("/api/v1/auth/login").send(ACCOUNTS.teamB)).status).toBe(200)
    expect((await operator.post("/api/v1/auth/login").send(ACCOUNTS.operator)).status).toBe(200)
    expect((await otherOrgAdmin.post("/api/v1/auth/login").send(ACCOUNTS.otherOrg)).status).toBe(200)
  })

  afterAll(async () => {
    await cleanup()
    await pool.end()
  })

  it("rascunho sem impacto: editar conteúdo, título e alcance não muda o que a IA, a lista e o leitor do material usam", async () => {
    const id = await publishedBase("Rascunho")
    const agentId = await agentWith("Rascunho", [id])
    const edited = await edit(id, { title: `${PREFIX}Título novo`, content: `${V1_TEXT}\nLinha do rascunho.`, orgScopes: [{ scopeType: "TEAM", teamId: teamA }], changeSummary: "Inclui linha" })
    expect(edited).toMatchObject({ title: `${PREFIX}Rascunho`, status: "PUBLISHED", inUseVersion: 1, draftVersion: 2, inUse: { version: 1, status: "PUBLISHED" }, draft: { version: 2, status: "DRAFT", changeSummary: "Inclui linha" } })
    expect(edited.inUse.content).toBe(V1_TEXT)
    expect(edited.draft.content).toContain("Linha do rascunho")
    expect(edited.orgScopes.map((scope: { scopeType: string }) => scope.scopeType)).toEqual(["ALL_TEAMS"])
    const retrieved = await retrieveKnowledgeForAgent(pool, agentId, "segunda via")
    expect(retrieved.promptBlock).toContain("Encerre o atendimento")
    expect(retrieved.promptBlock).not.toContain("Linha do rascunho")
    expect(retrieved.promptBlock).toContain(`${PREFIX}Rascunho`)
    // Salvar de novo atualiza o mesmo rascunho: não nasce uma versão por gravação.
    await edit(id, { content: `${V1_TEXT}\nLinha revisada.` })
    expect((await versionsOf(id)).map((version) => [version.number, version.situation])).toEqual([[2, "DRAFT"], [1, "IN_USE"]])
    expect(((await admin.get(API).query({ status: "DRAFT", search: `${PREFIX}Rascunho` })).body.data as { id: string }[]).some((item) => item.id === id)).toBe(true)
    // Salvar sem mudar nada, sem rascunho, não cria versão: nem com espaços nas pontas do texto.
    const unchanged = await publishedBase("Sem mudança")
    await edit(unchanged, { content: V1_TEXT })
    await edit(unchanged, { content: `  ${V1_TEXT}  ` })
    expect((await versionsOf(unchanged)).length).toBe(1)
    // Descartar: a versão em uso continua; a base que só tem o rascunho não descarta.
    expect((await admin.post(`${API}/${id}/draft/discard`)).body.data).toMatchObject({ draft: null, inUseVersion: 1 })
    const onlyDraft = await createBase("Só rascunho")
    expect((await admin.post(`${API}/${onlyDraft}/draft/discard`)).body.error.code).toBe("KNOWLEDGE_DRAFT_ONLY")
  })

  it("sem versão pronta a base não é apresentada como disponível: nenhum consumidor lê, e o leitor do material recebe 404", async () => {
    const id = await createBase("Nunca publicada")
    const agentId = await agentWith("Nunca publicada", [id])
    expect(await detailOf(id)).toMatchObject({ status: "DRAFT", inUseVersion: null, inUse: null, draft: { version: 1 } })
    expect((await retrieveKnowledgeForAgent(pool, agentId, "segunda via")).trace.mode).toBe("NONE")
    expect((await operator.get(`/api/v1/knowledge-materials/${id}`)).status).toBe(404)
    await publish(id, { process: false })
    expect(await detailOf(id)).toMatchObject({ status: "PROCESSING", inUse: null, updates: [{ version: 1, status: "PROCESSING" }] })
    expect((await retrieveKnowledgeForAgent(pool, agentId, "segunda via")).trace.mode).toBe("NONE")
  })

  it("atualização automática: a versão nova só vale quando fica pronta, para o agente já publicado, sem republicar nada; a configuração entra junto", async () => {
    const id = await publishedBase("Automática")
    const agentId = await agentWith("Automática", [id])
    const agentVersion = (await pool.query<{ current_version_id: string }>(`select current_version_id from agents where id = $1`, [agentId])).rows[0]!.current_version_id
    await edit(id, { title: `${PREFIX}Automática revisada`, content: `${V1_TEXT}\nProcedimento da versão 2.` })
    const pending = await publish(id, { process: false, body: { changeSummary: "Versão 2" } })
    // Publicação pedida, ainda processando: a anterior continua em uso (“Em uso pela IA: V1 · Atualização: V2 · Processando”).
    expect(await detailOf(id)).toMatchObject({ title: `${PREFIX}Automática`, status: "PUBLISHED", inUse: { version: 1 }, draft: null, updates: [{ version: 2, status: "PROCESSING" }], updateVersion: 2, updateStatus: "PROCESSING" })
    expect((await retrieveKnowledgeForAgent(pool, agentId, "segunda via")).promptBlock).not.toContain("Procedimento da versão 2")
    expect(await processKnowledgeVersion(pool, pending)).toBe("PUBLISHED")
    const after = await detailOf(id)
    expect(after).toMatchObject({ title: `${PREFIX}Automática revisada`, inUseVersion: 2, inUse: { version: 2, changeSummary: "Versão 2" }, updates: [] })
    expect(after.inUse.publishedByName).toBeTruthy()
    const retrieved = await retrieveKnowledgeForAgent(pool, agentId, "segunda via")
    expect(retrieved.promptBlock).toContain("Procedimento da versão 2")
    expect(retrieved.promptBlock).toContain(`${PREFIX}Automática revisada`)
    expect(retrieved.trace.authorizedDocuments[0]).toMatchObject({ version: 2 })
    // O agente não foi republicado.
    expect((await pool.query<{ current_version_id: string }>(`select current_version_id from agents where id = $1`, [agentId])).rows[0]!.current_version_id).toBe(agentVersion)
    // A varredura conclui o que ficou sem dono (a API reiniciou depois de pedir).
    await edit(id, { content: `${V1_TEXT}\nProcedimento da versão 3.` })
    await publish(id, { process: false })
    await processPendingKnowledgeVersions(pool, 200)
    expect(await detailOf(id)).toMatchObject({ inUseVersion: 3 })
  })

  it("falha de processamento preserva a anterior; texto indisponível falha na hora; falha passageira tenta de novo e, esgotada, vira falha; dá para tentar de novo", async () => {
    const id = await publishedBase("Falha")
    const agentId = await agentWith("Falha", [id])
    await edit(id, { content: `${V1_TEXT}\nVersão que vai falhar.` })
    const failing = await publish(id, { process: false })
    expect(await processKnowledgeVersion(pool, failing, { prepare: async () => { throw new KnowledgeProcessingError("KNOWLEDGE_NO_CHUNKS", "Sem trechos.") } })).toBe("FAILED")
    expect(await detailOf(id)).toMatchObject({ status: "PUBLISHED", inUse: { version: 1 }, updates: [{ version: 2, status: "FAILED", errorCode: "KNOWLEDGE_NO_CHUNKS", errorMessage: "Sem trechos." }] })
    expect((await retrieveKnowledgeForAgent(pool, agentId, "segunda via")).promptBlock).not.toContain("Versão que vai falhar")
    expect((await detailOf(id)).editable).toMatchObject({ version: 2, status: "FAILED" })
    // O filtro da lista acha a base em uso pela atualização com falha, além da situação em uso.
    const listed = async (status: string) => ((await admin.get(API).query({ status, search: `${PREFIX}Falha` })).body.data as { id: string }[]).some((item) => item.id === id)
    expect(await listed("FAILED")).toBe(true)
    expect(await listed("PUBLISHED")).toBe(true)
    expect(await listed("PROCESSING")).toBe(false)
    expect(await listed("DRAFT")).toBe(false)
    const retried = await admin.post(`${API}/${id}/versions/${failing}/retry`)
    expect(retried.body.data.updates).toEqual([expect.objectContaining({ version: 2, status: "PROCESSING" })])
    for (let attempt = 1; attempt <= MAX_PROCESSING_ATTEMPTS; attempt += 1) {
      const outcome = await processKnowledgeVersion(pool, failing, { prepare: async () => { throw new Error("banco indisponível") } })
      expect(outcome).toBe(attempt < MAX_PROCESSING_ATTEMPTS ? "RETRY" : "FAILED")
    }
    expect((await detailOf(id)).updates[0]).toMatchObject({ errorCode: "KNOWLEDGE_PROCESSING_FAILED" })
    await admin.post(`${API}/${id}/versions/${failing}/retry`)
    expect(await processKnowledgeVersion(pool, failing)).toBe("PUBLISHED")
    expect((await retrieveKnowledgeForAgent(pool, agentId, "segunda via")).promptBlock).toContain("Versão que vai falhar")
  })

  it("consulta em andamento: mantém a versão em todas as leituras, sem misturar; a próxima consulta usa a nova; cada consulta registra a versão usada", async () => {
    const id = await publishedBase("Consulta")
    const agentId = await agentWith("Consulta", [id])
    await edit(id, { title: `${PREFIX}Consulta V2`, content: `${V1_TEXT}\nTrecho da versão 2.` })
    const pending = await publish(id, { process: false })
    await withKnowledgeConsultation(async () => {
      const first = await retrieveKnowledgeForAgent(pool, agentId, "segunda via")
      expect(await processKnowledgeVersion(pool, pending)).toBe("PUBLISHED")
      const second = await retrieveKnowledgeForAgent(pool, agentId, "segunda via")
      expect(first.promptBlock).toBe(second.promptBlock)
      expect(second.promptBlock).not.toContain("Trecho da versão 2")
      expect(second.trace.retrieved.every((excerpt) => excerpt.version === 1)).toBe(true)
      expect(second.trace.authorizedDocuments[0]).toMatchObject({ version: 1 })
    })
    const fresh = await retrieveKnowledgeForAgent(pool, agentId, "segunda via")
    expect(fresh.promptBlock).toContain("Trecho da versão 2")
    expect(fresh.promptBlock).toContain(`${PREFIX}Consulta V2`)

    // Pela execução real do agente: a publicação fica pronta durante a chamada ao modelo; a execução registra a versão com que começou.
    await edit(id, { content: `${V1_TEXT}\nTrecho da versão 3.` })
    const third = await publish(id, { process: false })
    control.during = async () => {
      expect(await processKnowledgeVersion(pool, third)).toBe("PUBLISHED")
    }
    const during = await testAgent(agentId)
    expect(await usagesOf(during)).toEqual([{ version: 2, source_kind: "AGENT_RUN", agent_id: agentId }])
    const next = await testAgent(agentId)
    expect(await usagesOf(next)).toEqual([{ version: 3, source_kind: "AGENT_RUN", agent_id: agentId }])
    // A resposta da conversa guarda as versões da consulta do turno.
    const owner = (await pool.query<{ id: string }>(`select id from people where name = $1`, [`${PREFIX}Operador A`])).rows[0]!.id
    const conversation = (await pool.query<{ id: string }>(`insert into assistant_conversations (organization_id, owner_person_id, origin, started_at, last_activity_at) values ($1,$2,'USER',now(),now()) returning id`, [ORG, owner])).rows[0]!.id
    const saved = await withKnowledgeConsultation(async () => {
      await retrieveKnowledgeForAgent(pool, agentId, "segunda via")
      return appendConversationMessage(pool, { conversationId: conversation, organizationId: ORG, ownerPersonId: owner, channel: "chat", role: "assistant", content: "Resposta.", occurredAt: new Date() })
    })
    expect(await usagesOf(saved.id)).toEqual([{ version: 3, source_kind: "CONVERSATION", agent_id: agentId }])
    // O histórico mostra quantas consultas usaram cada versão.
    const history = await versionsOf(id)
    expect(history.find((version) => version.number === 3)).toMatchObject({ situation: "IN_USE", usageCount: 2 })
    expect(history.find((version) => version.number === 2)).toMatchObject({ situation: "REPLACED", usageCount: 1 })

    // Etapa de orquestrador do Workflow: as versões da consulta ficam na execução (quem chama é o executor; ver orchestrator-executor.test.ts).
    const enrollmentId = "00000000-0000-4000-8000-00000000f008"
    await withKnowledgeConsultation(async () => {
      await retrieveKnowledgeForAgent(pool, agentId, "segunda via")
      await productionEffects.recordWorkflowKnowledgeUsage(pool, enrollmentId)
    })
    expect(await usagesOf(enrollmentId)).toEqual([{ version: 3, source_kind: "WORKFLOW", agent_id: agentId }])
  })

  it("chat e voz pelas rotas reais: a releitura da mesma base no mesmo turno fica na versão fixada, mesmo com a nova publicação pronta no meio; o turno seguinte usa a nova", async () => {
    const line = (version: number) => `Trecho do chat na versão ${version}.`
    const id = await publishedBase("Chat", `${V1_TEXT}\n${line(1)}`)
    const specialist = await agentWith("Especialista do chat", [id], { specialtyKind: "PERFORMANCE" })
    const coordinator = await agentWith("Coordenador do chat", [], { agentType: "ORCHESTRATOR" })
    const orchestrator = await admin.post("/api/v1/admin/assistant-orchestrators").send({ name: `${PREFIX}Orquestrador`, scopeType: "TEAM", teamId: teamA, orchestratorAgentId: coordinator, specialistAgentIds: [specialist], invocationMode: "INTERACTIVE", routingPolicy: "OPEN" })
    expect(orchestrator.status, JSON.stringify(orchestrator.body)).toBe(201)
    const tool = (await pool.query<{ tool_name: string }>(`select tool_name from assistant_orchestrator_specialists where orchestrator_id = $1 and agent_id = $2`, [orchestrator.body.data.id, specialist])).rows[0]!.tool_name
    const owner = (await pool.query<{ id: string }>(`select id from people where name = $1`, [`${PREFIX}Operador A`])).rows[0]!.id
    const used = (version: number) => [{ version, source_kind: "CONVERSATION", agent_id: specialist }]
    // Cria a versão seguinte e devolve o passo que a deixa pronta, para o cenário escolher quando.
    const nextVersion = async (version: number) => {
      await edit(id, { content: `${V1_TEXT}\n${line(version)}` })
      const pending = await publish(id, { process: false })
      return async () => {
        expect(await processKnowledgeVersion(pool, pending)).toBe("PUBLISHED")
      }
    }
    // Os trechos que chegaram ao especialista: as chamadas ao modelo com o conteúdo da base.
    const excerptsSeen = () => control.prompts.filter((prompt) => prompt.includes("Trecho do chat na versão"))
    const expectOnlyVersion = (version: number, reads: number) => {
      expect(excerptsSeen()).toHaveLength(reads)
      for (const prompt of excerptsSeen()) {
        expect(prompt).toContain(line(version))
        expect(prompt).not.toMatch(new RegExp(`Trecho do chat na versão (?!${version}\\.)`))
      }
      control.prompts.length = 0
    }
    const chat = async (key: string) => {
      const response = await operator.post("/api/v1/realtime/messages").send({ conversationId: null, text: "Como oriento a segunda via?", clientMessageId: `prova-kb-${key}-${Date.now()}` })
      expect(response.status, response.text).toBe(200)
      const answer = (await pool.query<{ id: string }>(`select id from assistant_interactions where operator_id = $1 and role = 'assistant' order by created_at desc limit 1`, [owner])).rows[0]!
      return usagesOf(answer.id)
    }
    const speak = async (toolName: string, turnId: string, callId: string) => {
      const voice = await operator.post("/api/v1/realtime/tool-call").send({ toolName, query: "Como oriento a segunda via?", callId, turnId, conversationId: null })
      expect(voice.status, voice.text).toBe(200)
      return usagesOf(voice.body.data.interactionId as string)
    }
    try {
      // CHAT, primeira releitura: o esclarecimento lê a base, a nova versão fica pronta, e o especialista lê de novo no mesmo turno.
      control.duringClarification = await nextVersion(2)
      control.routes = [[tool]]
      expect(await chat("esclarecimento")).toEqual(used(1))
      expect(control.duringClarification).toBeNull()
      expect(await detailOf(id)).toMatchObject({ inUse: { version: 2 } })
      expectOnlyVersion(1, 1)
      // O turno seguinte começa na nova.
      control.routes = [[tool]]
      expect(await chat("seguinte")).toEqual(used(2))
      expectOnlyVersion(2, 1)

      // CHAT, segunda releitura: o mesmo especialista é chamado em duas rodadas do turno, e a nova versão fica pronta entre elas.
      control.during = await nextVersion(3)
      control.routes = [[tool], [tool]]
      expect(await chat("duas-rodadas")).toEqual(used(2))
      expect(control.during).toBeNull()
      expect(await detailOf(id)).toMatchObject({ inUse: { version: 3 } })
      expectOnlyVersion(2, 2)

      // VOZ, pergunta encaminhada: o mesmo caminho do chat, numa requisição só (esclarecimento, depois especialista).
      control.duringClarification = await nextVersion(4)
      control.routes = [[tool]]
      expect(await speak("self_ask", `prova-kb-${Date.now()}-a`, "chamada-1")).toEqual(used(3))
      expect(control.duringClarification).toBeNull()
      expect(await detailOf(id)).toMatchObject({ inUse: { version: 4 } })
      expectOnlyVersion(3, 1)

      // VOZ, duas chamadas de ferramenta no MESMO turno, cada uma numa requisição: a segunda fica na versão da primeira.
      const turn = `prova-kb-${Date.now()}-b`
      const fifth = await nextVersion(5)
      expect(await speak(tool, turn, "chamada-1")).toEqual(used(4))
      await fifth()
      expect(await detailOf(id)).toMatchObject({ inUse: { version: 5 } })
      expect(await speak(tool, turn, "chamada-2")).toEqual(used(4))
      expectOnlyVersion(4, 2)
      // Por outra ferramenta do mesmo turno, também.
      control.routes = [[tool]]
      expect(await speak("self_ask", turn, "chamada-3")).toEqual(used(4))
      expectOnlyVersion(4, 1)
      // Turno novo: a nova.
      expect(await speak(tool, `prova-kb-${Date.now()}-c`, "chamada-1")).toEqual(used(5))
      expectOnlyVersion(5, 1)
      // O identificador do turno vem do cliente: reusar um turno antigo não prende ninguém numa versão substituída.
      await pool.query(`update knowledge_version_usages set created_at = now() - interval '1 hour' where document_id = $1 and version = 4`, [id])
      expect(await speak(tool, turn, "chamada-4")).toEqual(used(5))
      expectOnlyVersion(5, 1)
    } finally {
      control.routes = []
      control.during = null
      control.duringClarification = null
      await pool.query(`delete from assistant_interaction_agents where orchestrator_id = $1`, [orchestrator.body.data.id])
      await pool.query(`delete from assistant_orchestrators where id = $1`, [orchestrator.body.data.id])
    }
  })

  it("Workflow completo: publicado pela API, disparado pelo gatilho manual e levado até o fim pelo motor; cada etapa de orquestrador é uma consulta e as versões usadas ficam na execução", async () => {
    const line = (version: number) => `Trecho do Workflow na versão ${version}.`
    const id = await publishedBase("Workflow", `${V1_TEXT}\n${line(1)}`)
    const first = await agentWith("Especialista do Workflow 1", [id], { specialtyKind: "PERFORMANCE" })
    const second = await agentWith("Especialista do Workflow 2", [id], { specialtyKind: "CROSS_CUTTING", capability: "Orientar a segunda via." })
    const coordinator = await agentWith("Coordenador do Workflow", [], { agentType: "ORCHESTRATOR" })
    const orchestrator = await admin.post("/api/v1/admin/assistant-orchestrators").send({ name: `${PREFIX}Orquestrador do Workflow`, scopeType: "TEAM", teamId: teamA, orchestratorAgentId: coordinator, specialistAgentIds: [first, second], invocationMode: "WORKFLOW", routingPolicy: "OPEN" })
    expect(orchestrator.status, JSON.stringify(orchestrator.body)).toBe(201)
    const orchestratorId = orchestrator.body.data.id as string
    const tools = new Map((await pool.query<{ agent_id: string; tool_name: string }>(`select agent_id, tool_name from assistant_orchestrator_specialists where orchestrator_id = $1`, [orchestratorId])).rows.map((row) => [row.agent_id, row.tool_name]))
    const owner = (await pool.query<{ id: string }>(`select id from people where name = $1`, [`${PREFIX}Operador A`])).rows[0]!.id
    const call = async () => {
      const interaction = (await pool.query<{ id: string }>(`insert into interactions (organization_id, operator_id, reason, started_at, ended_at, external_id) values ($1,$2,'Segunda via',now() - interval '2 days',now() - interval '2 days' + interval '9 minutes',$3) returning id`, [ORG, owner, `PROVA-KB-${Math.random()}`])).rows[0]!.id
      await pool.query(`insert into transcripts (organization_id, interaction_id, content) values ($1,$2,'OPERADOR: Bom dia. CLIENTE: Preciso da segunda via.')`, [ORG, interaction])
      return interaction
    }
    const position = { x: 0, y: 0 }
    const graph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position, config: {} },
        { id: "orch1", type: "orchestrator", label: "Primeira análise", position, config: { orchestratorId, instruction: "Analise a conversa." } },
        { id: "orch2", type: "orchestrator", label: "Segunda análise", position, config: { orchestratorId, instruction: "Revise a análise." } },
        { id: "out", type: "output", label: "Recado", position, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["INBOX"], source: "nodeOutputs.orch2" } },
        { id: "end", type: "end", label: "Fim", position, config: {} },
      ],
      edges: [["trigger", "orch1"], ["orch1", "orch2"], ["orch2", "out"], ["out", "end"]].map(([source, target]) => ({ id: `${source}-${target}`, source, target, sourceHandle: "always" })),
    }
    const base = "/api/v1/admin/workflows"
    const workflow = await admin.post(base).send({ name: `${PREFIX}Workflow`, scopeType: "TEAM", teamId: teamA, trigger: { kind: "manual", context: "INTERACTION" } })
    expect(workflow.status, workflow.text).toBe(201)
    const workflowId = workflow.body.data.id as string
    const draft = await admin.put(`${base}/${workflowId}/draft`).send({ graph })
    expect(draft.status, draft.text).toBe(200)
    const published = await admin.post(`${base}/${workflowId}/publish`).send({})
    expect(published.status, published.text).toBe(200)

    type Claimed = Parameters<typeof processEnrollment>[1]
    const claimed = async (enrollmentId: string) => (await pool.query<Claimed>(
      `select we.id, we.organization_id, we.workflow_id, we.version_id, we.interaction_id, we.indicator_measurement_id, we.scheduled_subject_id, we.scheduled_for, we.current_node_id,
              we.matched_flag_name, we.matched_value_boolean, we.matched_value_numeric, we.status, we.attempts, we.revision, we.node_outputs, we.variables, we.parent_enrollment_id, we.retry_of_enrollment_id,
              w.scope_type, w.team_id workflow_team_id, w.subteam_id workflow_subteam_id, w.consolidated_structure, w.population_filter, now()::text claimed_until
         from workflow_enrollments we join workflows w on w.id = we.workflow_id where we.id = $1`,
      [enrollmentId],
    )).rows[0]!
    const stateOf = async (enrollmentId: string) => (await pool.query<{ status: string; current_node_id: string; attempts: number }>(`select status, current_node_id, attempts from workflow_enrollments where id = $1`, [enrollmentId])).rows[0]!
    const run = async (key: string) => {
      const started = await admin.post(`${base}/${workflowId}/manual-runs`).send({ collaboratorId: owner, interactionId: await call(), idempotencyKey: `prova-kb-${key}-${Date.now()}` })
      expect(started.status, started.text).toBe(201)
      const enrollmentId = (await pool.query<{ id: string }>(`select id from workflow_enrollments where manual_run_id = $1`, [started.body.data.run.id])).rows[0]!.id
      for (let step = 0; step < 8; step += 1) {
        const before = await stateOf(enrollmentId)
        if (before.status !== "active") break
        await processEnrollment(pool, await claimed(enrollmentId))
        const after = await stateOf(enrollmentId)
        if (after.attempts > before.attempts) throw new Error(`etapa ${before.current_node_id} falhou: ${JSON.stringify((await pool.query(`select event_type, payload from workflow_enrollment_events where enrollment_id = $1 order by created_at desc limit 2`, [enrollmentId])).rows)}`)
      }
      expect((await stateOf(enrollmentId)).status).toBe("completed")
      return enrollmentId
    }
    const usedBy = async (enrollmentId: string) => (await usagesOf(enrollmentId)).map((usage) => `${usage.source_kind} V${usage.version} ${usage.agent_id}`).sort()

    await edit(id, { content: `${V1_TEXT}\n${line(2)}` })
    const pending = await publish(id, { process: false })
    // Primeira etapa: os dois especialistas leem a mesma base, e a V2 fica pronta durante a chamada ao modelo.
    control.during = async () => {
      expect(await processKnowledgeVersion(pool, pending)).toBe("PUBLISHED")
    }
    control.routes = [[tools.get(first)!, tools.get(second)!], [tools.get(first)!]]
    const enrollment = await run("primeira")
    expect(control.during).toBeNull()
    expect(await usedBy(enrollment)).toEqual([`WORKFLOW V1 ${first}`, `WORKFLOW V1 ${second}`, `WORKFLOW V2 ${first}`].sort())
    expect((await pool.query(`select 1 from workflow_outputs where enrollment_id = $1`, [enrollment])).rows).toHaveLength(1)
    const reads = control.prompts.filter((prompt) => prompt.includes("Trecho do Workflow na versão"))
    expect(reads.filter((prompt) => prompt.includes(line(1)))).toHaveLength(2)
    expect(reads.filter((prompt) => prompt.includes(line(2)))).toHaveLength(1)
    control.prompts.length = 0

    // A execução seguinte começa na nova, sem republicar agente, orquestrador nem Workflow.
    control.routes = [[tools.get(first)!], [tools.get(second)!]]
    const next = await run("seguinte")
    expect(await usedBy(next)).toEqual([`WORKFLOW V2 ${first}`, `WORKFLOW V2 ${second}`].sort())
    // O histórico da base mostra as consultas por versão.
    const history = await versionsOf(id)
    expect(history.find((version) => version.number === 1)).toMatchObject({ situation: "REPLACED", usageCount: 2 })
    expect(history.find((version) => version.number === 2)).toMatchObject({ situation: "IN_USE", usageCount: 3 })
  })

  it("produtos seguem o ciclo da versão: no rascunho nada muda em produção; valem na transição, com a vigência daquele instante; falha e permissão preservam o que está valendo", async () => {
    const id = await publishedBase("Produtos", V1_TEXT, [{ scopeType: "TEAM", teamId: teamA }])
    const sequence = { value: 0 }
    const productNode = async (name: string) => {
      sequence.value += 1
      return (await pool.query<{ id: string }>(`insert into product_catalog_nodes (organization_id, kind, code, name) values ($1, 'PRODUCT', $2, $3) returning id`, [ORG, `PROVA_KB_${sequence.value}_${Date.now()}`, `${PREFIX}${name}`])).rows[0]!.id
    }
    const [productA, productB, productC] = [await productNode("Produto A"), await productNode("Produto B"), await productNode("Produto C")]
    const scopeUrl = `/api/v1/admin/product-catalog/sources/KNOWLEDGE_DOCUMENT/${id}/scope`
    const inProduction = async (at = new Date()) => (await loadProductCatalogAt(pool, ORG, at, [id]))?.scopes.flatMap((scope) => scope.nodeIds) ?? []
    const source = async () => (await admin.get("/api/v1/admin/product-catalog/sources")).body.data.find((row: { sourceId: string }) => row.sourceId === id) as { scope: { nodeIds: string[] } | null; pendingScope: { version: number; status: string; nodeIds: string[] } | null }

    // Salvar: fica no rascunho. Nada do que o motor lê muda; a versão em uso e os produtos dela continuam.
    const saved = await admin.put(scopeUrl).send({ nodeIds: [productA] })
    expect(saved.status, saved.text).toBe(200)
    expect(saved.body.data.pending).toEqual({ version: 2, nodeIds: [productA] })
    expect(await inProduction()).toEqual([])
    expect(await source()).toMatchObject({ scope: null, pendingScope: { version: 2, status: "DRAFT", nodeIds: [productA] } })
    expect(await detailOf(id)).toMatchObject({ inUse: { version: 1 }, inUseProductNodeIds: [], draft: { version: 2, config: { productNodeIds: [productA] } } })
    // Salvar a mesma escolha não cria nada; descartar some com a escolha.
    expect((await admin.put(scopeUrl).send({ nodeIds: [productA] })).body.data.pending).toMatchObject({ version: 2 })
    expect(await versionsOf(id)).toHaveLength(2)
    expect((await admin.post(`${API}/${id}/draft/discard`).send({})).status).toBe(200)
    expect(await source()).toMatchObject({ scope: null, pendingScope: null })
    // Sem mudança em relação ao que vale: não nasce rascunho.
    expect((await admin.put(scopeUrl).send({ nodeIds: [] })).body.data.pending).toBeNull()
    expect(await versionsOf(id)).toHaveLength(1)

    // Permissão: gravar exige alcance de organização, e fazer valer também. Quem só alcança o Grupo publica o resto, não os produtos.
    expect((await adminTeamA.put(scopeUrl).send({ nodeIds: [productA] })).status).toBe(403)
    await admin.put(scopeUrl).send({ nodeIds: [productA] })
    const refused = await adminTeamA.post(`${API}/${id}/publish`).send({})
    expect(refused.status).toBe(403)
    expect(refused.body.error.code).toBe("ORGANIZATION_SCOPE_REQUIRED")
    expect(await detailOf(id)).toMatchObject({ inUse: { version: 1 }, draft: { version: 2 }, updates: [] })

    // Pedir a publicação ainda não muda; a transição muda, na mesma transação, a partir daquele instante.
    const beforeTransition = new Date()
    const pending = await publish(id, { process: false })
    expect(await inProduction()).toEqual([])
    expect(await processKnowledgeVersion(pool, pending)).toBe("PUBLISHED")
    expect(await inProduction()).toEqual([productA])
    expect(await inProduction(beforeTransition)).toEqual([])
    const assignment = (await pool.query<{ effective_from: Date; created_by: string | null }>(`select s.effective_from, s.created_by from product_scope_assignments s where s.source_id = $1 and s.effective_until is null`, [id])).rows[0]!
    const version = (await pool.query<{ effective_from: Date }>(`select effective_from from knowledge_versions where id = $1`, [pending])).rows[0]!
    expect(assignment.effective_from).toEqual(version.effective_from)
    expect(assignment.created_by).not.toBeNull()
    expect(await source()).toMatchObject({ scope: { nodeIds: [productA] }, pendingScope: null })

    // Sem mudar produtos, quem alcança o Grupo publica; o rascunho novo parte dos produtos que estão valendo, sem desfazê-los.
    expect((await adminTeamA.patch(`${API}/${id}`).send({ content: `${V1_TEXT}\nOutra linha.` })).status).toBe(200)
    expect((await detailOf(id)).draft.config.productNodeIds).toEqual([productA])
    const contentOnly = await adminTeamA.post(`${API}/${id}/publish`).send({})
    expect(contentOnly.status, contentOnly.text).toBe(200)
    expect(await processKnowledgeVersion(pool, contentOnly.body.data.updates[0].id as string)).toBe("PUBLISHED")
    expect(await inProduction()).toEqual([productA])
    expect((await pool.query(`select 1 from product_scope_assignments where source_id = $1`, [id])).rows).toHaveLength(1)

    // Falha no processamento: os produtos não mudam; tentar de novo, só com alcance de organização; pronta, passam a valer.
    await admin.put(scopeUrl).send({ nodeIds: [productB] })
    const failing = await publish(id, { process: false })
    expect(await processKnowledgeVersion(pool, failing, { prepare: async () => { throw new KnowledgeProcessingError("KNOWLEDGE_NO_CHUNKS", "Sem trechos.") } })).toBe("FAILED")
    expect(await inProduction()).toEqual([productA])
    expect((await adminTeamA.post(`${API}/${id}/versions/${failing}/retry`).send({})).status).toBe(403)
    expect((await admin.post(`${API}/${id}/versions/${failing}/retry`).send({})).status).toBe(200)
    expect(await processKnowledgeVersion(pool, failing)).toBe("PUBLISHED")
    expect(await inProduction()).toEqual([productB])

    // Produto desativado: depois do pedido, a transição falha e nada muda; antes do pedido, a publicação é recusada.
    await admin.put(scopeUrl).send({ nodeIds: [productC] })
    const late = await publish(id, { process: false })
    await pool.query(`update product_catalog_nodes set active = false, archived_at = now() where id = $1`, [productC])
    expect(await processKnowledgeVersion(pool, late)).toBe("FAILED")
    expect((await detailOf(id)).updates).toMatchObject([{ status: "FAILED", errorCode: "KNOWLEDGE_PRODUCT_INVALID" }])
    expect(await inProduction()).toEqual([productB])
    const inactive = await admin.post(`${API}/${id}/versions/${late}/retry`).send({})
    expect(inactive.status).toBe(422)
    expect(inactive.body.error.code).toBe("PRODUCT_SCOPE_TARGET_INVALID")
    await pool.query(`update product_catalog_nodes set active = true, archived_at = null where id = $1`, [productC])

    // Reverter traz de volta os produtos da versão: pela mesma transição, com a mesma exigência de alcance.
    const withA = await versionId(id, 2)
    expect((await adminTeamA.post(`${API}/${id}/versions/${withA}/revert`).send({})).status).toBe(403)
    const reverted = await admin.post(`${API}/${id}/versions/${withA}/revert`).send({})
    expect(reverted.status, reverted.text).toBe(200)
    expect(await inProduction()).toEqual([productB])
    expect(await processKnowledgeVersion(pool, reverted.body.data.updates.find((update: { status: string }) => update.status === "PROCESSING").id as string)).toBe("PUBLISHED")
    expect(await inProduction()).toEqual([productA])
    // As vigências continuam guardadas, cada uma com o seu período.
    const periods = (await pool.query<{ node_ids: string[]; effective_until: Date | null }>(`select node_ids, effective_until from product_scope_assignments where source_id = $1 order by effective_from`, [id])).rows
    expect(periods.map((period) => [period.node_ids, period.effective_until === null])).toEqual([[[productA], false], [[productB], false], [[productA], true]])

    // Dado anterior à mudança: abrangência em vigor que a versão publicada não registra não se perde num rascunho novo (a 168 acerta os que já existiam).
    const legacy = await publishedBase("Produtos legado")
    await pool.query(`insert into product_scope_assignments (organization_id, source_kind, source_id, node_ids, effective_from) values ($1,'KNOWLEDGE_DOCUMENT',$2,$3,now())`, [ORG, legacy, [productA]])
    await edit(legacy, { title: `${PREFIX}Produtos legado revisado` })
    expect((await detailOf(legacy)).draft.config.productNodeIds).toEqual([productA])
  })

  it("base arquivada: nenhuma publicação a reativa sem a confirmação explícita, por nenhum caminho; confirmada, ela só volta a valer quando a versão fica pronta", async () => {
    const id = await publishedBase("Arquivada")
    const agentId = await agentWith("Base arquivada", [id])
    const isArchived = async () => expect(await detailOf(id)).toMatchObject({ inUse: null, archived: { version: 1 } })
    expect((await admin.post(`${API}/${id}/archive`).send({})).status).toBe(200)
    await edit(id, { content: `${V1_TEXT}\nLinha da versão 2.` })
    await isArchived()

    // Publicar sem confirmar: recusado pela rota própria e pelo PATCH antigo. O rascunho fica como estava.
    for (const attempt of [() => admin.post(`${API}/${id}/publish`).send({}), () => admin.patch(`${API}/${id}`).send({ status: "PUBLISHED" })]) {
      const refused = await attempt()
      expect(refused.status).toBe(409)
      expect(refused.body.error.code).toBe("KNOWLEDGE_ARCHIVED_REACTIVATION_REQUIRED")
      await isArchived()
      expect((await detailOf(id)).draft).toMatchObject({ version: 2 })
    }

    // Confirmada: enquanto processa e se falhar, a base continua arquivada e fora de uso; a confirmação fica registrada.
    const asked = await admin.post(`${API}/${id}/publish`).send({ reactivate: true })
    expect(asked.status, asked.text).toBe(200)
    const pending = asked.body.data.updates[0].id as string
    expect(asked.body.data.updates[0]).toMatchObject({ reactivationConfirmedByName: expect.any(String), reactivationConfirmedAt: expect.any(String) })
    await isArchived()
    expect((await retrieveKnowledgeForAgent(pool, agentId, "segunda via")).trace.authorizedDocuments).toEqual([])
    expect(await processKnowledgeVersion(pool, pending, { prepare: async () => { throw new KnowledgeProcessingError("KNOWLEDGE_NO_CHUNKS", "Sem trechos.") } })).toBe("FAILED")
    await isArchived()

    // Tentar de novo: a confirmação vale por ação, e a tentativa não reativa sem ela.
    const noConfirmation = await admin.post(`${API}/${id}/versions/${pending}/retry`).send({})
    expect(noConfirmation.status).toBe(409)
    expect(noConfirmation.body.error.code).toBe("KNOWLEDGE_ARCHIVED_REACTIVATION_REQUIRED")
    expect((await admin.post(`${API}/${id}/versions/${pending}/retry`).send({ reactivate: true })).status).toBe(200)
    await isArchived()
    expect(await processKnowledgeVersion(pool, pending)).toBe("PUBLISHED")
    expect(await detailOf(id)).toMatchObject({ inUse: { version: 2 }, archived: null })
    expect((await versionsOf(id) as unknown as { number: number; reactivationConfirmedByName?: string }[]).find((version) => version.number === 2)?.reactivationConfirmedByName).toEqual(expect.any(String))
    expect((await retrieveKnowledgeForAgent(pool, agentId, "segunda via")).promptBlock).toContain("Linha da versão 2")

    // Falha ANTES do arquivamento: tentar depois de arquivar não reativa sem confirmar.
    await edit(id, { content: `${V1_TEXT}\nLinha da versão 3.` })
    const before = await publish(id, { process: false })
    expect(await processKnowledgeVersion(pool, before, { prepare: async () => { throw new KnowledgeProcessingError("KNOWLEDGE_NO_CHUNKS", "Sem trechos.") } })).toBe("FAILED")
    expect((await admin.post(`${API}/${id}/archive`).send({})).status).toBe(200)
    expect((await admin.post(`${API}/${id}/versions/${before}/retry`).send({})).status).toBe(409)
    expect(await detailOf(id)).toMatchObject({ inUse: null, archived: { version: 2 } })

    // Última barreira: uma versão em processamento sem a confirmação registrada não entra em uso, mesmo que chegue à transição.
    await pool.query(`update knowledge_versions set status = 'PROCESSING', processing_attempts = 0, processing_lease_until = null, reactivation_confirmed_at = null, reactivation_confirmed_by_name = null where id = $1`, [before])
    expect(await processKnowledgeVersion(pool, before)).toBe("SUPERSEDED")
    expect(await detailOf(id)).toMatchObject({ inUse: null, archived: { version: 2 } })
    expect((await versionsOf(id)).find((version) => version.number === 3)).toMatchObject({ situation: "SUPERSEDED", supersededReason: "ARCHIVED" })

    // Sem rascunho, o PATCH antigo também pede a confirmação; a ação Reativar é a confirmação.
    const noDraft = await admin.patch(`${API}/${id}`).send({ status: "PUBLISHED" })
    expect(noDraft.status).toBe(409)
    expect((await admin.post(`${API}/${id}/reactivate`).send({})).status).toBe(200)
    expect(await detailOf(id)).toMatchObject({ inUse: { version: 2 }, archived: null })
  })

  it("concorrência: conclusão tardia não substitui a mais nova; a anterior fica pronta se a mais nova falhar; duas conclusões da mesma versão, uma só vale; arquivar no meio não reativa", async () => {
    const id = await publishedBase("Concorrência")
    await edit(id, { content: `${V1_TEXT}\nVersão 2.` })
    const v2 = await publish(id, { process: false })
    await edit(id, { content: `${V1_TEXT}\nVersão 3.` })
    const v3 = await publish(id, { process: false })
    expect((await detailOf(id)).updates.map((update: { version: number }) => update.version)).toEqual([3, 2])
    expect(await processKnowledgeVersion(pool, v3)).toBe("PUBLISHED")
    expect(await processKnowledgeVersion(pool, v2)).toBe("SUPERSEDED")
    expect(await detailOf(id)).toMatchObject({ inUseVersion: 3, updates: [] })
    expect((await versionsOf(id)).map((version) => [version.number, version.situation, version.supersededReason ?? null])).toEqual([[3, "IN_USE", null], [2, "SUPERSEDED", "NEWER_VERSION"], [1, "REPLACED", null]])

    const other = await publishedBase("Concorrência falha")
    await edit(other, { content: `${V1_TEXT}\nVersão 2.` })
    const older = await publish(other, { process: false })
    await edit(other, { content: `${V1_TEXT}\nVersão 3.` })
    const newer = await publish(other, { process: false })
    expect(await processKnowledgeVersion(pool, newer, { prepare: async () => { throw new KnowledgeProcessingError("KNOWLEDGE_NO_CHUNKS", "Sem trechos.") } })).toBe("FAILED")
    expect(await processKnowledgeVersion(pool, older)).toBe("PUBLISHED")
    // A mais nova fica visível com a falha; publicar não some com a intenção.
    expect(await detailOf(other)).toMatchObject({ inUseVersion: 2, updates: [{ version: 3, status: "FAILED" }] })

    const same = await publishedBase("Mesma versão")
    await edit(same, { content: `${V1_TEXT}\nVersão 2.` })
    const racing = await publish(same, { process: false })
    const outcomes = await Promise.all([processKnowledgeVersion(pool, racing), processKnowledgeVersion(pool, racing)])
    expect(outcomes.filter((outcome) => outcome === "PUBLISHED")).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome === "NOT_CLAIMED")).toHaveLength(1)

    const archived = await publishedBase("Arquivada no meio")
    await edit(archived, { content: `${V1_TEXT}\nVersão 2.` })
    const inFlight = await publish(archived, { process: false })
    expect((await admin.post(`${API}/${archived}/archive`)).body.data).toMatchObject({ status: "ARCHIVED", inUse: null, archived: { version: 1 } })
    expect(await processKnowledgeVersion(pool, inFlight)).toBe("NOT_CLAIMED")
    expect(await detailOf(archived)).toMatchObject({ status: "ARCHIVED", inUseVersion: null })
    expect((await versionsOf(archived)).find((version) => version.number === 2)).toMatchObject({ situation: "SUPERSEDED", supersededReason: "ARCHIVED" })
    // Publicar em base arquivada só com a confirmação; reativar devolve a mesma versão.
    await edit(archived, { content: `${V1_TEXT}\nVersão 3.` })
    expect((await admin.post(`${API}/${archived}/publish`).send({})).body.error.code).toBe("KNOWLEDGE_ARCHIVED_REACTIVATION_REQUIRED")
    expect(await detailOf(archived)).toMatchObject({ status: "ARCHIVED" })
    expect((await admin.post(`${API}/${archived}/reactivate`)).body.data).toMatchObject({ status: "PUBLISHED", inUseVersion: 1 })
    expect((await admin.post(`${API}/${archived}/publish`).send({})).status).toBe(200)
  })

  it("comparação: conteúdo e configuração, lado a lado; arquivo trocado com texto comparado; caso sem texto dito com clareza e sem derrubar a versão em uso", async () => {
    const created = await admin.post(API).field("title", `${PREFIX}Comparação`).field("documentType", "MANUAL").field("orgScopes", JSON.stringify([{ scopeType: "ALL_TEAMS" }])).attach("file", Buffer.from("Primeira linha.\nLinha que muda.\nLinha removida.\nÚltima linha."), { filename: "manual-v1.txt", contentType: "text/plain" })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const id = created.body.data.id as string
    await publish(id)
    await edit(id, { title: `${PREFIX}Comparação revisada`, documentType: "FAQ", orgScopes: [{ scopeType: "TEAM", teamId: teamA }], changeSummary: "Só para o Grupo A" })
    const replaced = await admin.post(`${API}/${id}/draft/file`).attach("file", Buffer.from("Primeira linha.\nLinha alterada.\nÚltima linha.\nLinha adicionada."), { filename: "manual-v2.txt", contentType: "text/plain" })
    expect(replaced.status, JSON.stringify(replaced.body)).toBe(200)
    // O arquivo novo está no rascunho: o original em uso continua sendo o da versão 1, também para quem lê o material.
    expect((await admin.get(`${API}/${id}/file`)).text).toContain("Linha removida")
    expect((await operator.get(`/api/v1/knowledge-materials/${id}/file`)).text).toContain("Linha removida")
    await publish(id)
    const v1 = await versionId(id, 1)
    const v2 = await versionId(id, 2)
    const comparison = (await admin.get(`${API}/${id}/versions/compare`).query({ from: v1, to: v2 })).body.data
    expect(comparison.from.number).toBe(1)
    expect(comparison.to.number).toBe(2)
    expect(comparison.content).toMatchObject({ comparable: true, identical: false, added: 1, changed: 1, removed: 1 })
    expect(comparison.content.rows).toContainEqual({ kind: "ADDED", rightLine: 4, right: "Linha adicionada." })
    expect(comparison.content.rows).toContainEqual(expect.objectContaining({ kind: "CHANGED", left: "Linha que muda.", right: "Linha alterada." }))
    expect(comparison.content.rows).toContainEqual({ kind: "REMOVED", leftLine: 3, left: "Linha removida." })
    expect(comparison.file).toEqual({ change: "REPLACED", from: { filename: "manual-v1.txt", sizeBytes: expect.any(Number) }, to: { filename: "manual-v2.txt", sizeBytes: expect.any(Number) } })
    const changes = Object.fromEntries(comparison.configuration.changes.map((row: { field: string; from: string[]; to: string[] }) => [row.field, [row.from, row.to]]))
    expect(changes.title).toEqual([[`${PREFIX}Comparação`], [`${PREFIX}Comparação revisada`]])
    expect(changes.documentType).toEqual([["Manual"], ["Perguntas frequentes"]])
    expect(changes.orgScopes[0]).toEqual(["Todos os grupos"])
    expect(changes.orgScopes[1][0]).toMatch(/^Grupo /)
    // Produtos: continuam na regra própria (valem a partir de agora); cada versão guarda os da publicação, e a comparação mostra a diferença.
    const node = (await pool.query<{ id: string }>(`insert into product_catalog_nodes (organization_id, kind, code, name) values ($1, 'PRODUCT', $2, $3) returning id`, [ORG, `PROVA_KB_${Date.now()}`, `${PREFIX}Produto`])).rows[0]!.id
    const scoped = await admin.put(`/api/v1/admin/product-catalog/sources/KNOWLEDGE_DOCUMENT/${id}/scope`).send({ nodeIds: [node] })
    expect(scoped.status, JSON.stringify(scoped.body)).toBe(200)
    await edit(id, { title: `${PREFIX}Comparação com produto` })
    await publish(id)
    const withProduct = await versionId(id, 3)
    const productChange = (await admin.get(`${API}/${id}/versions/compare`).query({ from: v2, to: withProduct })).body.data.configuration.changes.find((row: { field: string }) => row.field === "products")
    expect(productChange).toMatchObject({ label: "Vale para (produtos)", from: ["Todos os produtos"], to: [`${PREFIX}Produto`] })
    // Arquivo antigo: disponível pela versão; o atual, pela base.
    expect((await admin.get(`${API}/${id}/versions/${v1}/file`)).text).toContain("Linha removida")
    expect((await admin.get(`${API}/${id}/file`)).text).toContain("Linha adicionada")

    // Arquivo sem texto extraído: a troca é identificada e o conteúdo não é comparável; publicar falha e a versão 2 continua em uso.
    await admin.post(`${API}/${id}/draft/file`).attach("file", Buffer.from("   \n  \n"), { filename: "digitalizado.txt", contentType: "text/plain" }).expect(200)
    const noText = await detailOf(id)
    expect(noText.draft).toMatchObject({ version: 4, textAvailable: false, content: "" })
    const v4 = await versionId(id, 4)
    const notComparable = (await admin.get(`${API}/${id}/versions/compare`).query({ from: withProduct, to: v4 })).body.data
    expect(notComparable.content).toEqual({ comparable: false, reason: "TEXT_UNAVAILABLE", versions: [4] })
    expect(notComparable.file).toMatchObject({ change: "REPLACED", to: { filename: "digitalizado.txt" } })
    const pending = await publish(id, { process: false })
    expect(await processKnowledgeVersion(pool, pending)).toBe("FAILED")
    expect(await detailOf(id)).toMatchObject({ inUse: { version: 3 }, updates: [{ version: 4, status: "FAILED", errorCode: "KNOWLEDGE_TEXT_UNAVAILABLE" }] })

    // Versão anterior ao registro por versão: o conteúdo compara; a configuração diz que não foi registrada.
    const legacy = await publishedBase("Sem configuração", "Texto antigo.")
    await pool.query(`alter table knowledge_versions disable trigger knowledge_versions_content_immutable`)
    await pool.query(`update knowledge_versions set config = null, origin = 'MIGRATION' where document_id = $1`, [legacy])
    await pool.query(`alter table knowledge_versions enable trigger knowledge_versions_content_immutable`)
    await edit(legacy, { content: "Texto novo." })
    const legacyVersions = await versionsOf(legacy)
    const legacyComparison = (await admin.get(`${API}/${legacy}/versions/compare`).query({ from: legacyVersions[1]!.id, to: legacyVersions[0]!.id })).body.data
    expect(legacyComparison.configuration).toEqual({ comparable: false, reason: "NOT_RECORDED", versions: [1] })
    expect(legacyComparison.content).toMatchObject({ comparable: true, changed: 1 })
  })

  it("reversão: versão nova com o conteúdo anterior, passando pelo processamento, sem apagar nem alterar nada; versões publicadas são imutáveis no banco", async () => {
    const id = await publishedBase("Reversão")
    await edit(id, { content: `${V1_TEXT}\nVersão 2.`, title: `${PREFIX}Reversão V2` })
    await publish(id)
    const v1 = await versionId(id, 1)
    const before = (await pool.query<{ id: string; content_hash: string; status: string }>(`select id, content_hash, status from knowledge_versions where document_id = $1 order by version`, [id])).rows
    await edit(id, { content: `${V1_TEXT}\nRascunho em andamento.` })
    expect((await admin.post(`${API}/${id}/versions/${v1}/revert`).send({})).body.error.code).toBe("KNOWLEDGE_DRAFT_PENDING")
    const reverted = await admin.post(`${API}/${id}/versions/${v1}/revert`).send({ discardDraft: true })
    expect(reverted.status, JSON.stringify(reverted.body)).toBe(200)
    // Processando: a versão 2 continua em uso.
    expect(reverted.body.data).toMatchObject({ inUse: { version: 2 }, updates: [{ version: 3, status: "PROCESSING" }], draft: null })
    expect(await processKnowledgeVersion(pool, reverted.body.data.updates[0].id)).toBe("PUBLISHED")
    const after = await detailOf(id)
    expect(after).toMatchObject({ title: `${PREFIX}Reversão`, inUse: { version: 3, changeSummary: "Reversão para a versão 1" } })
    expect(after.inUse.content).toBe(V1_TEXT)
    const history = await versionsOf(id)
    expect(history.map((version) => [version.number, version.situation, version.origin])).toEqual([[3, "IN_USE", "REVERT"], [2, "REPLACED", "EDIT"], [1, "REPLACED", "CREATE"]])
    expect(history[0]!.revertedFromNumber).toBe(1)
    const untouched = (await pool.query<{ id: string; content_hash: string; status: string }>(`select id, content_hash, status from knowledge_versions where id = any($1::uuid[]) order by version`, [before.map((row) => row.id)])).rows
    expect(untouched).toEqual(before)
    await expect(pool.query(`update knowledge_versions set content = 'alterado' where id = $1`, [v1])).rejects.toThrow(/imutável/)
    expect((await admin.post(`${API}/${id}/versions/${history[0]!.id}/revert`).send({})).body.error.code).toBe("KNOWLEDGE_VERSION_ALREADY_CURRENT")
  })

  it("arquivos reais: PDF e DOCX comparados pelo texto extraído; PDF digitalizado não é comparável, não entra em uso e não cria base", async () => {
    const base = () => admin.post(API).field("title", `${PREFIX}Arquivos reais`).field("documentType", "MANUAL").field("orgScopes", JSON.stringify([{ scopeType: "ALL_TEAMS" }]))
    const created = await base().attach("file", pdfWithLines(["Linha comum.", "Linha do PDF."]), { filename: "manual-v1.pdf", contentType: PDF_CONTENT_TYPE })
    expect(created.status, created.text).toBe(201)
    const id = created.body.data.id as string
    await publish(id)
    const inUse = (await detailOf(id)).inUse
    expect(inUse).toMatchObject({ version: 1, content: "Linha comum.\nLinha do PDF." })

    const docx = await admin.post(`${API}/${id}/draft/file`).attach("file", docxWithLines(["Linha comum.", "Linha do DOCX."]), { filename: "manual-v2.docx", contentType: DOCX_CONTENT_TYPE })
    expect(docx.status, docx.text).toBe(200)
    await publish(id)
    const v1 = await versionId(id, 1)
    const v2 = await versionId(id, 2)
    const betweenFormats = (await admin.get(`${API}/${id}/versions/compare`).query({ from: v1, to: v2 })).body.data
    expect(betweenFormats.file).toMatchObject({ change: "REPLACED", from: { filename: "manual-v1.pdf" }, to: { filename: "manual-v2.docx" } })
    expect(betweenFormats.content).toMatchObject({ comparable: true, identical: false })
    // O DOCX separa parágrafos com linha em branco e o PDF não: só o que mudou de verdade aparece.
    expect(betweenFormats.content).toMatchObject({ added: 0, removed: 0, changed: 1, unchanged: 1 })
    expect(betweenFormats.content.rows).toContainEqual(expect.objectContaining({ kind: "CHANGED", left: "Linha do PDF.", right: "Linha do DOCX." }))
    expect(betweenFormats.configuration.changes).toContainEqual(expect.objectContaining({ field: "sourceType", from: ["PDF"], to: ["DOCX"] }))

    const scanned = await admin.post(`${API}/${id}/draft/file`).attach("file", pdfWithLines([]), { filename: "digitalizado.pdf", contentType: PDF_CONTENT_TYPE })
    expect(scanned.status, scanned.text).toBe(200)
    expect((await detailOf(id)).draft).toMatchObject({ version: 3, textAvailable: false, content: "" })
    const v3 = await versionId(id, 3)
    const notComparable = (await admin.get(`${API}/${id}/versions/compare`).query({ from: v2, to: v3 })).body.data
    expect(notComparable.content).toEqual({ comparable: false, reason: "TEXT_UNAVAILABLE", versions: [3] })
    expect(notComparable.file).toMatchObject({ change: "REPLACED", to: { filename: "digitalizado.pdf" } })
    const asked = await admin.post(`${API}/${id}/publish`).send({})
    expect(asked.status, asked.text).toBe(200)
    expect(await processKnowledgeVersion(pool, asked.body.data.updates[0].id as string)).toBe("FAILED")
    expect(await detailOf(id)).toMatchObject({ inUse: { version: 2, content: "Linha comum.\n\nLinha do DOCX." }, updates: [{ version: 3, status: "FAILED", errorCode: "KNOWLEDGE_TEXT_UNAVAILABLE" }] })

    const refused = await base().attach("file", pdfWithLines([]), { filename: "digitalizado.pdf", contentType: PDF_CONTENT_TYPE })
    expect(refused.status).toBe(422)
    expect(refused.body.error.code).toBe("KNOWLEDGE_EXTRACTION_FAILED")
  })

  it("isolamento: organização, alcance e permissão valem para histórico, comparação, conteúdo antigo e arquivos antigos; publicar não concede acesso", async () => {
    const created = await admin.post(API).field("title", `${PREFIX}Isolamento`).field("documentType", "MANUAL").field("orgScopes", JSON.stringify([{ scopeType: "TEAM", teamId: teamA }])).attach("file", Buffer.from("Texto restrito ao Grupo A."), { filename: "restrito.txt", contentType: "text/plain" })
    const id = created.body.data.id as string
    await publish(id)
    const v1 = await versionId(id, 1)
    const urls = (versionIdValue: string) => [`${API}/${id}/versions`, `${API}/${id}/versions/${versionIdValue}`, `${API}/${id}/versions/${versionIdValue}/file`, `${API}/${id}/versions/compare?from=${versionIdValue}&to=${versionIdValue}`]
    // Outro Grupo e outra organização: a base não existe para eles, inclusive com o id da versão.
    for (const url of urls(v1)) {
      expect((await adminTeamB.get(url)).status, url).toBe(404)
      expect((await otherOrgAdmin.get(url)).status, url).toBe(404)
      expect((await operator.get(url)).status, url).toBe(403)
      expect((await adminTeamA.get(url)).status, url).toBe(200)
    }
    for (const action of ["publish", "archive", "reactivate", "draft/discard"]) {
      expect((await adminTeamB.post(`${API}/${id}/${action}`).send({})).status, action).toBe(404)
      expect((await otherOrgAdmin.post(`${API}/${id}/${action}`).send({})).status, action).toBe(404)
    }
    expect((await otherOrgAdmin.post(`${API}/${id}/versions/${v1}/revert`).send({})).status).toBe(404)
    // Id de versão de outra base não abre pela base que a pessoa pode ler.
    const otherBase = await publishedBase("Global", "Texto global.")
    expect((await adminTeamB.get(`${API}/${otherBase}/versions/${v1}`)).status).toBe(404)
    expect((await adminTeamB.get(`${API}/${otherBase}/versions/${v1}/file`)).status).toBe(404)

    // A base passa a valer para todos: quem é de outro Grupo lê a versão nova, mas não o conteúdo antigo, que era restrito.
    await edit(id, { orgScopes: [{ scopeType: "ALL_TEAMS" }], content: "Texto para todos." })
    await publish(id)
    const v2 = await versionId(id, 2)
    const history = await versionsOf(id, adminTeamB)
    expect(history.find((version) => version.number === 1)).toEqual(expect.objectContaining({ restricted: true, situation: "REPLACED" }))
    expect(history.find((version) => version.number === 1)).not.toHaveProperty("authorName")
    expect(history.find((version) => version.number === 1)).not.toHaveProperty("changeSummary")
    expect(history.find((version) => version.number === 2)).toMatchObject({ restricted: false })
    expect((await adminTeamB.get(`${API}/${id}/versions/${v2}`)).status).toBe(200)
    expect((await adminTeamB.get(`${API}/${id}/versions/${v1}`)).body.error.code).toBe("KNOWLEDGE_VERSION_RESTRICTED")
    expect((await adminTeamB.get(`${API}/${id}/versions/${v1}/file`)).status).toBe(403)
    expect((await adminTeamB.get(`${API}/${id}/versions/compare`).query({ from: v1, to: v2 })).status).toBe(403)
    // Quem não alcança toda a base não publica nem reverte, e um rascunho não amplia o que a pessoa alcança.
    await edit(id, { content: "Rascunho global." })
    expect((await adminTeamA.post(`${API}/${id}/publish`).send({})).status).toBe(403)
    expect((await adminTeamA.post(`${API}/${id}/versions/${v1}/revert`).send({ discardDraft: true })).status).toBe(403)
    const teamBase = await publishedBase("Do Grupo A", "Texto do Grupo A.", [{ scopeType: "TEAM", teamId: teamA }])
    expect((await adminTeamA.patch(`${API}/${teamBase}`).send({ orgScopes: [{ scopeType: "ALL_TEAMS" }] })).status).toBe(403)

    // Quem lê o material só vê a versão em uso; atualização não dá acesso a quem o alcance não cobre.
    const material = await publishedBase("Material do Grupo B", "Texto do Grupo B.", [{ scopeType: "TEAM", teamId: teamB }])
    expect((await operator.get(`/api/v1/knowledge-materials/${material}`)).status).toBe(404)
    await edit(material, { content: "Texto novo do Grupo B." })
    await publish(material)
    expect((await operator.get(`/api/v1/knowledge-materials/${material}`)).status).toBe(404)
    const readable = await publishedBase("Material global", "Texto em uso.")
    await edit(readable, { content: "Texto do rascunho." })
    expect((await operator.get(`/api/v1/knowledge-materials/${readable}`)).body.data).toMatchObject({ content: "Texto em uso.", version: 1 })

    // A versão nova restringe o alcance: o agente de outro Grupo deixa de ler a base na próxima consulta.
    const narrowed = await publishedBase("Restringida", "Texto global restringido.")
    const agentB = await agentWith("Grupo B", [narrowed], { scopeType: "TEAM", teamId: teamB })
    expect((await retrieveKnowledgeForAgent(pool, agentB, "texto")).trace.mode).not.toBe("NONE")
    await edit(narrowed, { orgScopes: [{ scopeType: "TEAM", teamId: teamA }] })
    expect((await retrieveKnowledgeForAgent(pool, agentB, "texto")).trace.mode).not.toBe("NONE")
    await publish(narrowed)
    expect((await retrieveKnowledgeForAgent(pool, agentB, "texto")).trace.mode).toBe("NONE")
  })

  it("dados anteriores à PEN-008: rascunho não é publicado, base arquivada não volta, versões antigas e vínculos continuam", async () => {
    const id = await createBase("Legado")
    await pool.query(`alter table knowledge_versions disable trigger knowledge_versions_content_immutable`)
    await pool.query(`update knowledge_versions set status = 'PUBLISHED', config = null, origin = 'MIGRATION' where document_id = $1`, [id])
    await pool.query(`insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash, origin) values ($1,$2,2,'Rascunho antigo em edição.','DRAFT','h2','MIGRATION'), ($1,$2,3,'Rascunho mais novo.','DRAFT','h3','MIGRATION')`, [ORG, id])
    await pool.query(`alter table knowledge_versions enable trigger knowledge_versions_content_immutable`)
    const agentId = await agentWith("Legado", [id])
    expect(await detailOf(id)).toMatchObject({ status: "PUBLISHED", inUseVersion: 1, draftVersion: 3, draft: { version: 3 } })
    expect((await versionsOf(id)).map((version) => [version.number, version.situation, version.hasConfig])).toEqual([[3, "DRAFT", false], [2, "OLD_DRAFT", false], [1, "IN_USE", false]])
    expect((await retrieveKnowledgeForAgent(pool, agentId, "segunda via")).promptBlock).toContain("Encerre o atendimento")
    // Salvar e publicar o rascunho antigo funciona a partir da configuração em uso.
    await edit(id, { content: "Rascunho mais novo, revisado." })
    await publish(id)
    expect(await detailOf(id)).toMatchObject({ title: `${PREFIX}Legado`, inUseVersion: 3 })

    const archived = await createBase("Legado arquivado")
    await pool.query(`alter table knowledge_versions disable trigger knowledge_versions_content_immutable`)
    await pool.query(`update knowledge_versions set status = 'ARCHIVED' where document_id = $1`, [archived])
    await pool.query(`alter table knowledge_versions enable trigger knowledge_versions_content_immutable`)
    const agentArchived = await agentWith("Legado arquivado", [archived])
    expect(await detailOf(archived)).toMatchObject({ status: "ARCHIVED", inUse: null, archived: { version: 1 } })
    expect((await retrieveKnowledgeForAgent(pool, agentArchived, "segunda via")).trace.mode).toBe("NONE")
  })
})
