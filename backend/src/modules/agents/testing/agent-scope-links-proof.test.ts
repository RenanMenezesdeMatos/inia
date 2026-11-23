import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

/**
 * PROVA do alcance por VÁRIOS Grupos no Agente (migration 249, 23/11/2026) contra o banco de TESTE real, pelo contrato do produto (API
 * admin). ZERO chamada de IA. Cenário: Grupo A inteiro + Subgrupo B1 do Grupo B; o Subgrupo irmão B2 fica de fora.
 *   - alcance: pessoas de A e de B1 são alcançadas, de B2 não (a mesma SQL dos consumidores, `resourceScopeReachSql`);
 *   - formato legado (TEAM/SUBTEAM) guardado num rascunho é lido com o mesmo alcance;
 *   - edição preserva vínculo salvo que perdeu a elegibilidade; vínculo NOVO sem operador em produção = 422; fora do universo = 422;
 *   - "Todos" só com escopo de organização; gestor de um Grupo não grava vínculo de outro;
 *   - base × agente com vários Grupos (base de qualquer Grupo efetivo cabe; de outro Grupo, não);
 *   - filtro da lista por Grupo/Subgrupo = algum vínculo, uma linha por agente.
 *
 *   INIA_DB_PROOF=1 npx vitest run agent-scope-links-proof
 */
vi.mock("../../access/domain/roles.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../access/domain/roles.js")>()
  const proofRole = { code: "PROVA_GESTOR_DE_AGENTES_VINCULOS", name: "Prova — gestor de agentes", description: "Só na prova.", permissions: ["agents.manage"], allowedScopes: ["ORGANIZATION", "GROUP", "SUBGROUP"], delegates: [], system: true } as const
  const roles = [...original.SYSTEM_ROLES, proofRole]
  const catalog = { find: (code: string) => roles.find((role) => role.code === code) ?? null, all: () => roles }
  return { ...original, SYSTEM_ROLES: roles, systemRoleCatalog: catalog, rolesWithPermission: (permission: string, cat = catalog) => cat.all().filter((role) => (role.permissions as readonly string[]).includes(permission)).map((role) => role.code) }
})

const { env } = await import("../../../config/env.js")
const { createApp } = await import("../../../main/app.js")
const { setProofAccountPassword } = await import("../../auth/testing/proof-account-password.js")
const { resolveAgentVersionForRun } = await import("../application/agent-versions.js")
const { agentScopeOf } = await import("../domain/agent-config.js")
const { ineligibleScopeUnits } = await import("../../org-structure/application/scope-unit-options.js")
const { resourceScopeReachSql } = await import("../../../shared/domain/scope-links/resource-scope.js")

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const ADMIN = { email: "carla.nunes@inia.com", password: "Inia@123" }
const MANAGER = { email: "prova-gestor-agentes-vinculos@proof.inia.local", password: "Prova@12345" }
const PREFIX = "Prova Vínculos Agente · "
const EMPTY_SUBTEAM = "Prova Vínculos Agente · Subgrupo sem operadores"

let pool: pg.Pool
let admin: ReturnType<typeof request.agent>
let manager: ReturnType<typeof request.agent>
/** A = Grupo inteiro elegível; B com os Subgrupos B1 (elegível) e B2; C = terceiro Grupo; empty = Subgrupo novo de B sem ninguém. */
const unit = { A: "", B: "", B1: "", B2: "", C: "", empty: "" }
const person = { A: "", B1: "", B2: "" }

async function cleanup() {
  const agents = (await pool.query<{ id: string }>(`select id from agents_all where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])).rows.map((row) => row.id)
  await pool.query(`update agents_all set current_version_id = null where id = any($1::uuid[])`, [agents])
  await pool.query(`delete from agents_all where id = any($1::uuid[])`, [agents])
  const documents = (await pool.query<{ id: string }>(`select id from knowledge_documents where organization_id = $1 and title like $2`, [ORG, `${PREFIX}%`])).rows.map((row) => row.id)
  await pool.query(`delete from knowledge_document_org_scopes where knowledge_document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from knowledge_versions where document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from knowledge_documents where id = any($1::uuid[])`, [documents])
  await pool.query(`delete from subteams where organization_id = $1 and name = $2`, [ORG, EMPTY_SUBTEAM])
  await pool.query(`delete from access_role_assignments where user_account_id in (select id from user_accounts where email = $1)`, [MANAGER.email])
  await pool.query(`delete from user_accounts where email = $1`, [MANAGER.email])
  await pool.query(`delete from people where organization_id = $1 and name = 'Prova Gestor Agentes Vínculos'`, [ORG])
}

const body = (name: string, scope: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  name: `${PREFIX}${name}`, agentType: "CUSTOM", objective: "Objetivo da prova.", description: "Agente temporário da prova.", contextPrompt: "Contexto da prova.", ...scope, ...extra,
})
const groups = (...links: { teamId: string; subteamId?: string | null }[]) => ({ scopeType: "GROUPS", scopeLinks: links.map((link) => ({ teamId: link.teamId, subteamId: link.subteamId ?? null })) })

async function insertBase(name: string, teamId: string | null) {
  const id = (await pool.query<{ id: string }>(`insert into knowledge_documents (organization_id, title, document_type) values ($1, $2, 'PROCEDURE') returning id`, [ORG, `${PREFIX}${name}`])).rows[0]!.id
  await pool.query(`insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1, $2, 1, '### Procedimento da prova', 'PUBLISHED', 'h')`, [ORG, id])
  await pool.query(`insert into knowledge_document_org_scopes (knowledge_document_id, scope_type, team_id) values ($1, $2, $3)`, [id, teamId ? "TEAM" : "ALL_TEAMS", teamId])
  return id
}

/** O agente alcança a pessoa? A MESMA SQL que os consumidores usam (um `exists` por vínculo). */
async function reaches(agentId: string, personId: string): Promise<boolean> {
  const sql = resourceScopeReachSql({ linksTable: "AGENT", ownerIdExpr: "a.id", scopeTypeExpr: "a.scope_type", teamExpr: "p.team_id", subteamExpr: "p.subteam_id" })
  return (await pool.query<{ reaches: boolean }>(`select ${sql} reaches from agents a, people p where a.id = $1 and p.id = $2`, [agentId, personId])).rows[0]!.reaches
}

const storedLinks = async (agentId: string) => (await pool.query<{ team_id: string; subteam_id: string | null }>(`select team_id, subteam_id from agent_scope_links where agent_id = $1 order by team_id, subteam_id nulls first`, [agentId])).rows

describe.skipIf(!ENABLED)("Agente com vários Grupos/Subgrupos (249) — banco de teste real", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    await cleanup()
    // Grupos com ao menos dois Subgrupos, e Subgrupos/Grupos elegíveis (operador em produção) pela mesma regra do servidor.
    const teams = (await pool.query<{ id: string; subteams: string[] }>(
      `select t.id, array_agg(s.id order by s.name) subteams from teams t join subteams s on s.team_id = t.id where t.organization_id = $1 group by t.id having count(s.id) >= 2 order by t.name`,
      [ORG],
    )).rows
    const ineligible = new Set((await ineligibleScopeUnits(pool, ORG, teams.flatMap((team) => [{ teamId: team.id, subteamId: null }, ...team.subteams.map((subteamId) => ({ teamId: team.id, subteamId }))]))).map((item) => item.subteamId ?? item.teamId))
    const eligible = teams.filter((team) => !ineligible.has(team.id) && team.subteams.some((id) => !ineligible.has(id)))
    expect(eligible.length, "a massa de teste precisa de 3 Grupos com operadores em produção").toBeGreaterThanOrEqual(3)
    unit.A = eligible[0]!.id
    unit.B = eligible[1]!.id
    unit.B1 = eligible[1]!.subteams.find((id) => !ineligible.has(id))!
    unit.B2 = eligible[1]!.subteams.find((id) => id !== unit.B1)!
    unit.C = eligible[2]!.id
    unit.empty = (await pool.query<{ id: string }>(`insert into subteams (organization_id, team_id, name) values ($1, $2, $3) returning id`, [ORG, unit.B, EMPTY_SUBTEAM])).rows[0]!.id
    const someone = async (where: string, value: string) => (await pool.query<{ id: string }>(`select id from people where organization_id = $1 and active and ${where} = $2 limit 1`, [ORG, value])).rows[0]?.id ?? ""
    person.A = await someone("team_id", unit.A)
    person.B1 = await someone("subteam_id", unit.B1)
    person.B2 = await someone("subteam_id", unit.B2)
    expect(Object.values(person).every(Boolean), "pessoas em A, B1 e B2").toBe(true)

    const managerPerson = (await pool.query<{ id: string }>(`insert into people (organization_id, name, role, team_id) values ($1, 'Prova Gestor Agentes Vínculos', 'ADMIN', $2) returning id`, [ORG, unit.A])).rows[0]!.id
    const account = (await pool.query<{ id: string }>(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1,$2,$3,'x') returning id`, [ORG, managerPerson, MANAGER.email])).rows[0]!.id
    await pool.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1,$2,'PROVA_GESTOR_DE_AGENTES_VINCULOS','GROUP',$3,now())`, [ORG, account, unit.A])
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

  it("Grupo A inteiro + Subgrupo B1: alcança A e B1, não o irmão B2; vínculos na linha viva e na versão publicada", async () => {
    const created = await admin.post("/api/v1/admin/agents").send(body("A + B1", groups({ teamId: unit.A }, { teamId: unit.B, subteamId: unit.B1 })))
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const id = created.body.data.id as string
    expect(created.body.data.scopeType).toBe("GROUPS")
    expect((created.body.data.scopeLinks as { teamId: string; subteamId: string | null }[]).map((link) => [link.teamId, link.subteamId]).sort()).toEqual([[unit.A, null], [unit.B, unit.B1]].sort())
    const row = (await pool.query<{ scope_type: string; team_id: string | null; subteam_id: string | null }>(`select scope_type, team_id, subteam_id from agents where id = $1`, [id])).rows[0]!
    expect(row).toEqual({ scope_type: "GROUPS", team_id: null, subteam_id: null })
    expect(await reaches(id, person.A)).toBe(true)
    expect(await reaches(id, person.B1)).toBe(true)
    expect(await reaches(id, person.B2)).toBe(false)

    expect((await admin.post(`/api/v1/admin/agents/${id}/publish`).send({})).status).toBe(201)
    const version = await resolveAgentVersionForRun(pool, ORG, id)
    expect(version.config.scopeType).toBe("GROUPS")
    expect(agentScopeOf(version.config).links).toHaveLength(2)
    expect(await storedLinks(id)).toHaveLength(2)
  })

  it("rascunho no formato antigo (SUBTEAM + Grupo-pai) é lido com o MESMO alcance: um vínculo com o Subgrupo B1", async () => {
    const created = await admin.post("/api/v1/admin/agents").send(body("Legado", groups({ teamId: unit.A })))
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const id = created.body.data.id as string
    await pool.query(`update agents set draft_config = draft_config || jsonb_build_object('scopeType', 'SUBTEAM', 'teamId', $2::text, 'subteamId', $3::text) - 'scopeLinks' where id = $1`, [id, unit.B, unit.B1])
    const detail = await admin.get(`/api/v1/admin/agents/${id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.data.draft.config).toMatchObject({ scopeType: "GROUPS", teamId: null, subteamId: null, scopeLinks: [{ teamId: unit.B, subteamId: unit.B1 }] })
  })

  it("editar preserva o vínculo salvo que perdeu a elegibilidade; vínculo NOVO sem operador em produção = 422", async () => {
    const created = await admin.post("/api/v1/admin/agents").send(body("Preserva", groups({ teamId: unit.A })))
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const id = created.body.data.id as string
    // Vínculo que já estava salvo (ex.: o Subgrupo ficou sem operadores depois): continua aceito na edição.
    await pool.query(`insert into agent_scope_links (agent_id, organization_id, team_id, subteam_id) values ($1, $2, $3, $4)`, [id, ORG, unit.B, unit.empty])
    await pool.query(`update agents set draft_config = draft_config || jsonb_build_object('scopeType', 'GROUPS', 'scopeLinks', jsonb_build_array(jsonb_build_object('teamId', $2::text, 'subteamId', null), jsonb_build_object('teamId', $3::text, 'subteamId', $4::text))) where id = $1`, [id, unit.A, unit.B, unit.empty])
    const revision = (await admin.get(`/api/v1/admin/agents/${id}`)).body.data.draft.revision as number
    const kept = await admin.patch(`/api/v1/admin/agents/${id}`).send({ ...groups({ teamId: unit.A }, { teamId: unit.B, subteamId: unit.empty }, { teamId: unit.B, subteamId: unit.B1 }), expectedDraftRevision: revision })
    expect(kept.status, JSON.stringify(kept.body)).toBe(200)
    expect(await storedLinks(id)).toHaveLength(3)

    const fresh = await admin.post("/api/v1/admin/agents").send(body("Novo inelegível", groups({ teamId: unit.B, subteamId: unit.empty })))
    expect(fresh.status).toBe(422)
    expect(fresh.body.error.code).toBe("SCOPE_UNIT_WITHOUT_PRODUCTION_OPERATORS")
  })

  it("vínculo fora do universo do agente = 422 SCOPE_UNIT_OUTSIDE_UNIVERSE; sem vínculo nenhum = 422 (nunca vira global)", async () => {
    const outside = await admin.post("/api/v1/admin/agents").send(body("Universo", groups({ teamId: unit.A }), { operatingUniverse: "B2X" }))
    expect(outside.status).toBe(422)
    expect(outside.body.error.code).toBe("SCOPE_UNIT_OUTSIDE_UNIVERSE")
    const empty = await admin.post("/api/v1/admin/agents").send(body("Vazio", { scopeType: "GROUPS", scopeLinks: [] }))
    expect(empty.status).toBe(422)
    expect(empty.body.error.code).toBe("AGENT_SCOPE_INVALID")
  })

  it("“Todos” só com escopo de organização; gestor do Grupo A não grava vínculo de outro Grupo nem lê agente que também vale para B1", async () => {
    const all = await manager.post("/api/v1/admin/agents").send(body("Gestor todos", { scopeType: "ALL_TEAMS" }))
    expect(all.status).toBe(403)
    expect(all.body.error.code).toBe("AGENT_SCOPE_FORBIDDEN")
    const mixed = await manager.post("/api/v1/admin/agents").send(body("Gestor misto", groups({ teamId: unit.A }, { teamId: unit.B, subteamId: unit.B1 })))
    expect(mixed.status).toBe(403)
    const own = await manager.post("/api/v1/admin/agents").send(body("Gestor próprio", groups({ teamId: unit.A })))
    expect(own.status, JSON.stringify(own.body)).toBe(201)
    const shared = (await pool.query<{ id: string }>(`select id from agents where name = $1`, [`${PREFIX}A + B1`])).rows[0]!.id
    expect((await manager.get(`/api/v1/admin/agents/${shared}`)).status).toBe(404)
  })

  it("base × agente de vários Grupos: só cabe base global ou que valha para CADA Grupo efetivo dele (run-10 QA-01); base de um Grupo só, não", async () => {
    const baseOfB = await insertBase("Base do Grupo B", unit.B)
    const baseOfC = await insertBase("Base do Grupo C", unit.C)
    const baseOfAB = await insertBase("Base dos Grupos A e B", unit.A)
    await pool.query(`insert into knowledge_document_org_scopes (knowledge_document_id, scope_type, team_id) values ($1, 'TEAM', $2)`, [baseOfAB, unit.B])
    const scope = groups({ teamId: unit.A }, { teamId: unit.B, subteamId: unit.B1 })
    const fits = await admin.post("/api/v1/admin/agents").send(body("Bases", scope, { knowledgeDocumentIds: [baseOfAB] }))
    expect(fits.status, JSON.stringify(fits.body)).toBe(201)
    // Base só do Grupo B chegaria a quem é do Grupo A por este agente (a busca não sabe quem pergunta): recusada.
    for (const [name, base] of [["Bases recusa B", baseOfB], ["Bases recusa C", baseOfC]] as const) {
      const refused = await admin.post("/api/v1/admin/agents").send(body(name, scope, { knowledgeDocumentIds: [base] }))
      expect(refused.status).toBe(422)
      expect(refused.body.error.code).toBe("AGENT_KNOWLEDGE_SCOPE_FORBIDDEN")
    }
    // Pré-seleção pelos Grupos escolhidos: só o que vale para todos eles.
    const defaults = await admin.post("/api/v1/admin/agents/knowledge-options/group-defaults").send({ agentScope: { scopeType: "GROUPS", links: [{ teamId: unit.B, subteamId: null }, { teamId: unit.A, subteamId: null }] } })
    expect(defaults.status, JSON.stringify(defaults.body)).toBe(200)
    expect(defaults.body.data.ids).toContain(baseOfAB)
    expect(defaults.body.data.ids).not.toContain(baseOfB)
    expect(defaults.body.data.ids).not.toContain(baseOfC)
    // Um Grupo só: a base dele cabe (a regra de sempre).
    const single = await admin.post("/api/v1/admin/agents").send(body("Bases B", groups({ teamId: unit.B }), { knowledgeDocumentIds: [baseOfB] }))
    expect(single.status, JSON.stringify(single.body)).toBe(201)
  })

  it("lista: filtro por Grupo/Subgrupo acha o agente por QUALQUER vínculo, uma linha só; o Subgrupo irmão não o traz", async () => {
    const listed = async (query: string) => ((await admin.get(`/api/v1/admin/agents?search=${encodeURIComponent(`${PREFIX}A + B1`)}&${query}`)).body.data as { id: string }[]).map((item) => item.id)
    const id = (await pool.query<{ id: string }>(`select id from agents where name = $1`, [`${PREFIX}A + B1`])).rows[0]!.id
    expect(await listed(`teamId=${unit.A}`)).toEqual([id])
    expect(await listed(`teamId=${unit.B}`)).toEqual([id])
    expect(await listed(`subteamId=${unit.B1}`)).toEqual([id])
    expect(await listed(`subteamId=${unit.B2}`)).toEqual([])
    expect(await listed("scopeType=ALL_TEAMS")).toEqual([])
  })
})
