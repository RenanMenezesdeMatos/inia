import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

/**
 * PROVA da associação de agentes a partir da base (20/11/2026) contra o banco de TESTE real, pelo contrato do produto (API admin).
 * ZERO chamada de IA. Confere que a tela da base usa o MESMO ciclo de vida do agente: rascunho sem afetar a versão em uso, trava
 * otimista (lote inteiro desfeito), publicação imutável, outras alterações pendentes nunca publicadas daqui, alcance e universo
 * conferidos no servidor, e leitura da base exigida (quem só administra agentes não enxerga a base).
 *
 *   INIA_DB_PROOF=1 npx vitest run agent-knowledge-links-proof
 */
vi.mock("../../access/domain/roles.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../access/domain/roles.js")>()
  const proofRole = { code: "PROVA_GESTOR_DE_AGENTES_BASES", name: "Prova — gestor de agentes", description: "Só na prova.", permissions: ["agents.manage"], allowedScopes: ["ORGANIZATION", "GROUP", "SUBGROUP"], delegates: [], system: true } as const
  const roles = [...original.SYSTEM_ROLES, proofRole]
  const catalog = { find: (code: string) => roles.find((role) => role.code === code) ?? null, all: () => roles }
  return { ...original, SYSTEM_ROLES: roles, systemRoleCatalog: catalog, rolesWithPermission: (permission: string, cat = catalog) => cat.all().filter((role) => (role.permissions as readonly string[]).includes(permission)).map((role) => role.code) }
})

const { env } = await import("../../../config/env.js")
const { createApp } = await import("../../../main/app.js")
const { setProofAccountPassword } = await import("../../auth/testing/proof-account-password.js")
const { eligibleProofTeamIds } = await import("./proof-scope-units.js")
const { resolveAgentVersionForRun } = await import("../application/agent-versions.js")

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const ADMIN = { email: "carla.nunes@inia.com", password: "Inia@123" }
const MANAGER = { email: "prova-gestor-agentes-bases@proof.inia.local", password: "Prova@12345" }
const PREFIX = "Prova Base→Agente · "

let pool: pg.Pool
let admin: ReturnType<typeof request.agent>
let manager: ReturnType<typeof request.agent>
let teamA = ""
let teamB = ""

type Candidate = { id: string; linkedInUse: boolean; linkedInDraft: boolean; published: boolean; currentVersionNumber: number | null; draft: { revision: number; pending: boolean; otherChanges: boolean }; block: string | null }

async function cleanup() {
  const agents = (await pool.query<{ id: string }>(`select id from agents where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])).rows.map((row) => row.id)
  await pool.query(`update agents set current_version_id = null where id = any($1::uuid[])`, [agents])
  await pool.query(`delete from agents where id = any($1::uuid[])`, [agents])
  const documents = (await pool.query<{ id: string }>(`select id from knowledge_documents where organization_id = $1 and title like $2`, [ORG, `${PREFIX}%`])).rows.map((row) => row.id)
  await pool.query(`delete from knowledge_document_org_scopes where knowledge_document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from knowledge_versions where document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from knowledge_documents where id = any($1::uuid[])`, [documents])
  await pool.query(`delete from access_role_assignments where user_account_id in (select id from user_accounts where email = $1)`, [MANAGER.email])
  await pool.query(`delete from user_accounts where email = $1`, [MANAGER.email])
  await pool.query(`delete from people where organization_id = $1 and name = 'Prova Gestor Agentes Bases'`, [ORG])
}

/** Base mínima direto no banco (o objeto da prova é o agente): título, uma versão publicada e o alcance. */
async function insertBase(name: string, scope: { scopeType: "ALL_TEAMS" | "TEAM"; teamId?: string }, universe: string | null = null) {
  const id = (await pool.query<{ id: string }>(`insert into knowledge_documents (organization_id, title, document_type, operating_universe) values ($1, $2, 'PROCEDURE', $3) returning id`, [ORG, `${PREFIX}${name}`, universe])).rows[0]!.id
  await pool.query(`insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1, $2, 1, '### Procedimento da prova', 'PUBLISHED', 'h')`, [ORG, id])
  await pool.query(`insert into knowledge_document_org_scopes (knowledge_document_id, scope_type, team_id) values ($1, $2, $3)`, [id, scope.scopeType, scope.teamId ?? null])
  return id
}

async function createAgent(name: string, options: { publish?: boolean; teamId?: string } = {}) {
  const created = await admin.post("/api/v1/admin/agents").send({
    name: `${PREFIX}${name}`, agentType: "CUSTOM", objective: "Objetivo da prova.", description: "Agente temporário da prova.", contextPrompt: "Contexto da prova.",
    scopeType: options.teamId ? "TEAM" : "ALL_TEAMS", ...(options.teamId ? { teamId: options.teamId } : {}),
  })
  expect(created.status, JSON.stringify(created.body)).toBe(201)
  const id = created.body.data.id as string
  if (options.publish !== false) expect((await admin.post(`/api/v1/admin/agents/${id}/publish`).send({})).status).toBe(201)
  return id
}

/** O agente na lista da base — procurado nas duas abas (Ligados e Disponíveis), pelo prefixo da prova, em páginas de 100. */
async function candidate(baseId: string, agentId: string): Promise<Candidate> {
  for (const tab of ["LINKED", "AVAILABLE"]) {
    const listed = await admin.get(`/api/v1/admin/agents/knowledge-links?knowledgeDocumentId=${baseId}&tab=${tab}&pageSize=100&search=${encodeURIComponent(PREFIX)}`)
    expect(listed.status, JSON.stringify(listed.body)).toBe(200)
    const found = (listed.body.data.items as Candidate[]).find((agent) => agent.id === agentId)
    if (found) return found
  }
  throw new Error(`agente ${agentId} fora das duas abas`)
}

const inUseIds = async (agentId: string) => (await pool.query<{ id: string }>(`select knowledge_document_id id from agent_knowledge_documents where agent_id = $1`, [agentId])).rows.map((row) => row.id)

describe.skipIf(!ENABLED)("Associar agentes a partir da base — mesmo ciclo de vida do agente (banco de teste real)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    await cleanup()
    // Grupos com operador em produção: vínculo novo de agente exige (249).
    const teams = (await eligibleProofTeamIds(pool, ORG, 2)).map((id) => ({ id }))
    teamA = teams[0]!.id
    teamB = teams[1]!.id
    const person = (await pool.query<{ id: string }>(`insert into people (organization_id, name, role, team_id) values ($1, 'Prova Gestor Agentes Bases', 'ADMIN', $2) returning id`, [ORG, teamA])).rows[0]!.id
    const account = (await pool.query<{ id: string }>(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1,$2,$3,'x') returning id`, [ORG, person, MANAGER.email])).rows[0]!.id
    await pool.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1,$2,'PROVA_GESTOR_DE_AGENTES_BASES','GROUP',$3,now())`, [ORG, account, teamA])
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

  it("rascunho: a base entra só no rascunho e a versão em uso não muda; o histórico registra a alteração", async () => {
    const base = await insertBase("Global rascunho", { scopeType: "ALL_TEAMS" })
    const agent = await createAgent("Rascunho")
    const before = await candidate(base, agent)
    expect(before).toMatchObject({ linkedInUse: false, linkedInDraft: false, published: true, block: null })

    const saved = await admin.post("/api/v1/admin/agents/knowledge-links").send({ knowledgeDocumentId: base, mode: "DRAFT", changes: [{ agentId: agent, linked: true, expectedDraftRevision: before.draft.revision }] })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    expect(saved.body.data.results).toEqual([expect.objectContaining({ agentId: agent, outcome: "DRAFT_SAVED", versionNumber: null })])
    expect(await inUseIds(agent)).not.toContain(base)
    expect((await resolveAgentVersionForRun(pool, ORG, agent)).config.knowledgeDocumentIds).not.toContain(base)
    const detail = (await admin.get(`/api/v1/admin/agents/${agent}`)).body.data
    expect(detail.draft.config.knowledgeDocumentIds).toContain(base)
    expect(await candidate(base, agent)).toMatchObject({ linkedInUse: false, linkedInDraft: true, draft: { pending: true, otherChanges: false } })
    const history = (await admin.get(`/api/v1/admin/agents/${agent}/history`)).body.data as { action: string; changes: { field: string }[] }[]
    expect(history.some((entry) => entry.action === "UPDATED" && entry.changes.some((change) => change.field === "knowledgeDocumentIds"))).toBe(true)
  })

  it("publicar: a prévia mostra a base entrando e a versão nova; aplicar publica a versão 2 com a base em uso", async () => {
    const base = await insertBase("Global publicar", { scopeType: "ALL_TEAMS" })
    const agent = await createAgent("Publicar")
    const { draft } = await candidate(base, agent)
    const body = { knowledgeDocumentId: base, mode: "PUBLISH", changes: [{ agentId: agent, linked: true, expectedDraftRevision: draft.revision }] }
    const preview = await admin.post("/api/v1/admin/agents/knowledge-links/preview").send(body)
    expect(preview.status, JSON.stringify(preview.body)).toBe(200)
    expect(preview.body.data.agents[0]).toMatchObject({ outcome: "PUBLISHED", firstPublication: false, problem: null, impact: { nextVersionNumber: 2, currentVersionNumber: 1 } })
    expect(preview.body.data.agents[0].impact.changes.knowledge.added).toEqual([{ id: base, title: `${PREFIX}Global publicar` }])
    // A prévia não grava nada.
    expect((await candidate(base, agent)).draft.revision).toBe(draft.revision)

    const applied = await admin.post("/api/v1/admin/agents/knowledge-links").send(body)
    expect(applied.status, JSON.stringify(applied.body)).toBe(200)
    expect(applied.body.data.results[0]).toMatchObject({ outcome: "PUBLISHED", versionNumber: 2 })
    expect(await inUseIds(agent)).toContain(base)
    expect((await resolveAgentVersionForRun(pool, ORG, agent))).toMatchObject({ versionNumber: 2 })
    expect(await candidate(base, agent)).toMatchObject({ linkedInUse: true, linkedInDraft: true, currentVersionNumber: 2, draft: { pending: false } })

    // Desligar também publica (versão 3) e tira a base do que a IA usa.
    const after = await candidate(base, agent)
    const unlinked = await admin.post("/api/v1/admin/agents/knowledge-links").send({ ...body, changes: [{ agentId: agent, linked: false, expectedDraftRevision: after.draft.revision }] })
    expect(unlinked.body.data.results[0]).toMatchObject({ outcome: "PUBLISHED", versionNumber: 3 })
    expect(await inUseIds(agent)).not.toContain(base)
  })

  it("rascunho com outras alterações pendentes: publicar daqui NUNCA publica o que não é da base — a base fica só no rascunho", async () => {
    const base = await insertBase("Global pendente", { scopeType: "ALL_TEAMS" })
    const agent = await createAgent("Pendente")
    expect((await admin.patch(`/api/v1/admin/agents/${agent}`).send({ objective: "Mudança de outra pessoa ainda não publicada." })).status).toBe(200)
    const listed = await candidate(base, agent)
    expect(listed.draft).toMatchObject({ pending: true, otherChanges: true })
    const body = { knowledgeDocumentId: base, mode: "PUBLISH", changes: [{ agentId: agent, linked: true, expectedDraftRevision: listed.draft.revision }] }
    expect((await admin.post("/api/v1/admin/agents/knowledge-links/preview").send(body)).body.data.agents[0]).toMatchObject({ outcome: "DRAFT_ONLY_OTHER_CHANGES", impact: null })
    const applied = await admin.post("/api/v1/admin/agents/knowledge-links").send(body)
    expect(applied.body.data.results[0]).toMatchObject({ outcome: "DRAFT_ONLY_OTHER_CHANGES", versionNumber: null })
    const resolved = await resolveAgentVersionForRun(pool, ORG, agent)
    expect(resolved.versionNumber).toBe(1)
    expect(resolved.config.objective).toBe("Objetivo da prova.")
    const detail = (await admin.get(`/api/v1/admin/agents/${agent}`)).body.data
    expect(detail.draft.config).toMatchObject({ objective: "Mudança de outra pessoa ainda não publicada." })
    expect(detail.draft.config.knowledgeDocumentIds).toContain(base)
  })

  it("agente nunca publicado: publicar daqui é a primeira publicação, avisada na prévia", async () => {
    const base = await insertBase("Global novo", { scopeType: "ALL_TEAMS" })
    const agent = await createAgent("Nunca publicado", { publish: false })
    const listed = await candidate(base, agent)
    expect(listed).toMatchObject({ published: false, currentVersionNumber: null, linkedInUse: false })
    const body = { knowledgeDocumentId: base, mode: "PUBLISH", changes: [{ agentId: agent, linked: true, expectedDraftRevision: listed.draft.revision }] }
    expect((await admin.post("/api/v1/admin/agents/knowledge-links/preview").send(body)).body.data.agents[0]).toMatchObject({ outcome: "PUBLISHED", firstPublication: true, impact: { nextVersionNumber: 1, currentVersionNumber: null } })
    const applied = await admin.post("/api/v1/admin/agents/knowledge-links").send(body)
    expect(applied.body.data.results[0]).toMatchObject({ outcome: "PUBLISHED", versionNumber: 1 })
    expect(await inUseIds(agent)).toContain(base)
    expect(await candidate(base, agent)).toMatchObject({ published: true, linkedInUse: true, currentVersionNumber: 1 })
  })

  it("nunca publicado com a base só no rascunho não aparece como em uso", async () => {
    const base = await insertBase("Global rascunho novo", { scopeType: "ALL_TEAMS" })
    const agent = await createAgent("Nunca publicado rascunho", { publish: false })
    const listed = await candidate(base, agent)
    const saved = await admin.post("/api/v1/admin/agents/knowledge-links").send({ knowledgeDocumentId: base, mode: "DRAFT", changes: [{ agentId: agent, linked: true, expectedDraftRevision: listed.draft.revision }] })
    expect(saved.body.data.results[0]).toMatchObject({ outcome: "DRAFT_SAVED" })
    expect(await candidate(base, agent)).toMatchObject({ published: false, linkedInUse: false, linkedInDraft: true })
    await expect(resolveAgentVersionForRun(pool, ORG, agent)).rejects.toMatchObject({ code: "AGENT_NOT_PUBLISHED" })
  })

  it("revisão desatualizada num agente desfaz o lote inteiro (nenhum agente gravado)", async () => {
    const base = await insertBase("Global lote", { scopeType: "ALL_TEAMS" })
    const first = await createAgent("Lote 1")
    const second = await createAgent("Lote 2")
    const one = await candidate(base, first)
    const two = await candidate(base, second)
    const stale = await admin.post("/api/v1/admin/agents/knowledge-links").send({
      knowledgeDocumentId: base, mode: "DRAFT",
      changes: [{ agentId: first, linked: true, expectedDraftRevision: one.draft.revision }, { agentId: second, linked: true, expectedDraftRevision: two.draft.revision + 5 }],
    })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe("AGENT_DRAFT_CONFLICT")
    expect(await candidate(base, first)).toMatchObject({ linkedInDraft: false, draft: { revision: one.draft.revision } })
    expect(await candidate(base, second)).toMatchObject({ linkedInDraft: false })
  })

  it("alcance e universo conferidos no servidor: base de outro Grupo e base de outro universo são recusadas", async () => {
    const otherGroupBase = await insertBase("Grupo B", { scopeType: "TEAM", teamId: teamB })
    const agentA = await createAgent("Grupo A", { teamId: teamA })
    const listed = await candidate(otherGroupBase, agentA)
    expect(listed.block).toBe("SCOPE")
    const refused = await admin.post("/api/v1/admin/agents/knowledge-links").send({ knowledgeDocumentId: otherGroupBase, mode: "DRAFT", changes: [{ agentId: agentA, linked: true, expectedDraftRevision: listed.draft.revision }] })
    expect(refused.status).toBe(422)
    expect(refused.body.error.code).toBe("AGENT_KNOWLEDGE_SCOPE_FORBIDDEN")

    const b2bBase = await insertBase("Universo B2B", { scopeType: "ALL_TEAMS" }, "B2B")
    const b2cAgent = await createAgent("Universo B2C")
    await pool.query(`update agents set operating_universe = 'B2C' where id = $1`, [b2cAgent])
    const universeCandidate = await candidate(b2bBase, b2cAgent)
    expect(universeCandidate.block).toBe("UNIVERSE")
    const crossed = await admin.post("/api/v1/admin/agents/knowledge-links").send({ knowledgeDocumentId: b2bBase, mode: "DRAFT", changes: [{ agentId: b2cAgent, linked: true, expectedDraftRevision: universeCandidate.draft.revision }] })
    expect(crossed.status).toBe(409)
    expect(crossed.body.error.code).toBe("OPERATING_UNIVERSE_LINK_CONFLICT")
    expect((await admin.get(`/api/v1/admin/agents/${b2cAgent}`)).body.data.draft).toBeNull()
  })

  it("lista da base: abas Ligados × Disponíveis, filtros, página e os publicados com a base só no rascunho", async () => {
    const base = await insertBase("Global lista", { scopeType: "ALL_TEAMS" })
    const ids = [await createAgent("Lista A"), await createAgent("Lista B"), await createAgent("Lista C", { teamId: teamA }), await createAgent("Lista D", { publish: false })]
    const url = (query: string) => `/api/v1/admin/agents/knowledge-links?knowledgeDocumentId=${base}&search=${encodeURIComponent(`${PREFIX}Lista`)}&${query}`
    const first = (await admin.get(url("tab=AVAILABLE&pageSize=2"))).body.data
    expect(first).toMatchObject({ total: 4, page: 1, pageSize: 2, counts: { linked: 0, available: 4 } })
    expect(first.items.map((item: { name: string }) => item.name)).toEqual([`${PREFIX}Lista A`, `${PREFIX}Lista B`])
    expect((await admin.get(url("tab=AVAILABLE&pageSize=2&page=2"))).body.data.items.map((item: { name: string }) => item.name)).toEqual([`${PREFIX}Lista C`, `${PREFIX}Lista D`])
    expect((await admin.get(url(`tab=AVAILABLE&teamId=${teamA}`))).body.data.items.map((item: { id: string }) => item.id)).toEqual([ids[2]])
    expect((await admin.get(url("tab=AVAILABLE&scopeType=ALL_TEAMS"))).body.data.total).toBe(3)
    expect((await admin.get(url("tab=AVAILABLE&state=NOT_PUBLISHED"))).body.data.items.map((item: { id: string }) => item.id)).toEqual([ids[3]])

    const a = await candidate(base, ids[0]!)
    await admin.post("/api/v1/admin/agents/knowledge-links").send({ knowledgeDocumentId: base, mode: "DRAFT", changes: [{ agentId: ids[0], linked: true, expectedDraftRevision: a.draft.revision }] })
    const linked = (await admin.get(url("tab=LINKED"))).body.data
    expect(linked).toMatchObject({ total: 1, counts: { linked: 1, available: 3 } })
    expect(linked.items[0]).toMatchObject({ id: ids[0], linkedInDraft: true, linkedInUse: false })
    // Publicado com a base só no rascunho: "Salvar e publicar" o inclui mesmo sem marcar de novo.
    expect(linked.pendingPublish.map((item: { id: string }) => item.id)).toContain(ids[0])
    expect((await admin.get(url("tab=LINKED&state=DRAFT_PENDING"))).body.data.total).toBe(1)
    expect((await admin.get(`/api/v1/admin/agents/knowledge-links?knowledgeDocumentId=${base}&pageSize=500`)).status).toBe(400)
  })

  it("quem só administra agentes (sem ler bases) não enxerga a base; agente fora do alcance = 404", async () => {
    const base = await insertBase("Sem leitura", { scopeType: "ALL_TEAMS" })
    const denied = await manager.get(`/api/v1/admin/agents/knowledge-links?knowledgeDocumentId=${base}`)
    expect(denied.status).toBe(404)
    expect(denied.body.error.code).toBe("KNOWLEDGE_NOT_FOUND")
    expect((await manager.post("/api/v1/admin/agents/knowledge-links").send({ knowledgeDocumentId: base, mode: "DRAFT", changes: [{ agentId: "00000000-0000-4000-8000-0000000000ab", linked: true, expectedDraftRevision: 0 }] })).status).toBe(404)
    const missingAgent = await admin.post("/api/v1/admin/agents/knowledge-links").send({ knowledgeDocumentId: base, mode: "DRAFT", changes: [{ agentId: "00000000-0000-4000-8000-0000000000ab", linked: true, expectedDraftRevision: 0 }] })
    expect(missingAgent.status).toBe(404)
    expect(missingAgent.body.error.code).toBe("AGENT_NOT_FOUND")
    const duplicated = await admin.post("/api/v1/admin/agents/knowledge-links").send({ knowledgeDocumentId: base, mode: "DRAFT", changes: [{ agentId: "00000000-0000-4000-8000-0000000000ab", linked: true, expectedDraftRevision: 0 }, { agentId: "00000000-0000-4000-8000-0000000000ab", linked: false, expectedDraftRevision: 0 }] })
    expect(duplicated.status).toBe(400)
  })
})
