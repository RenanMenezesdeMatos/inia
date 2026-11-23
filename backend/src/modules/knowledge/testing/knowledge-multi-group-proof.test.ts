/**
 * PROVA contra o banco de TESTE real — ALCANCE POR VÁRIOS GRUPOS da Base de Conhecimento (223). A mesma base (mesmo id, conteúdo e
 * histórico) vale para o Grupo A inteiro e só para o Subgrupo B1 do Grupo B:
 *  - material (operador, pela API): A e B1 abrem; B2 (irmão) e o Grupo C, não — inclusive por chamada direta ao id;
 *  - gestão: o administrador só do Grupo A LÊ a base (tem um vínculo dele), mas não altera texto nem vínculos (a base também vale para
 *    B1, fora do escopo dele); o administrador geral altera; vínculo repetido / Subgrupo junto do Grupo inteiro / "todos" com Grupo = 422;
 *  - Agents: as regras de antes continuam (Agent do Grupo pela base do Grupo/Subgrupo dele; Agent de outro Grupo não usa);
 *  - lista: a base aparece UMA vez, mesmo com dois vínculos no filtro/escopo;
 *  - remoção do vínculo B1: B1 perde o material e o Agent do Grupo B deixa de recuperar a base na busca seguinte (sem cache velho);
 *    A continua.
 * ZERO chamada de modelo (processamento inline desligado). Tudo numa transação desfeita no fim.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run knowledge-multi-group-proof
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { clearKnowledgeSnapshotCache, retrieveKnowledgeForAgent } from "../application/retrieve-knowledge.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
let client: pg.PoolClient

describe.skipIf(!ENABLED)("Base de Conhecimento para vários Grupos — prova Postgres", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    client = await pool.connect()
    await client.query("begin")
  })
  afterAll(async () => {
    if (client) {
      await client.query("rollback")
      client.release()
    }
    if (pool) await pool.end()
  })

  it("Grupo A inteiro + Subgrupo B1: acesso, gestão parcial, Agents, lista sem duplicata e remoção de vínculo", async () => {
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 order by created_at limit 1", [ORG])).rows[0]!.id
    const team = async (name: string) => (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name, operating_universe) values ($1, $2, $3, 'B2C') returning id", [ORG, operation, name])).rows[0]!.id
    const subteam = async (teamId: string, name: string) => (await client.query<{ id: string }>("insert into subteams (organization_id, team_id, name) values ($1, $2, $3) returning id", [ORG, teamId, name])).rows[0]!.id
    const teamA = await team("Proof KBMG Grupo A")
    const teamB = await team("Proof KBMG Grupo B")
    const teamC = await team("Proof KBMG Grupo C")
    const subB1 = await subteam(teamB, "Proof KBMG B1")
    const subB2 = await subteam(teamB, "Proof KBMG B2")
    const hash = await hashPassword("Proof@12345")
    let n = 0
    const person = async (teamId: string | null, subteamId: string | null, roleCode?: string, scope?: { type: string; teamId?: string }) => {
      n += 1
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id, subteam_id) values ($1, $2, 'OPERATOR', $3, $4) returning id", [ORG, `Proof KBMG ${n}`, teamId, subteamId])).rows[0]!.id
      const email = `proof-kbmg-${n}-${Date.now()}@proof.inia.local`
      const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [ORG, id, email, hash])).rows[0]!.id
      if (roleCode && scope) await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, $3, $4, $5, now())", [ORG, accountId, roleCode, scope.type, scope.teamId ?? null])
      return { id, email }
    }
    const geral = await person(null, null, "ADMINISTRADOR_GERAL", { type: "ORGANIZATION" })
    const adminA = await person(teamA, null, "ADMINISTRADOR", { type: "GROUP", teamId: teamA })
    const opA = await person(teamA, null)
    const opB1 = await person(teamB, subB1)
    const opB2 = await person(teamB, subB2)
    const opC = await person(teamC, null)

    // A base: um cadastro, dois vínculos (o Subgrupo sem o Grupo é completado pelo banco com o Grupo-pai real).
    const document = (await client.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type, operating_universe) values ($1, 'Proof KBMG — PR Segunda via', 'PROCEDURE', 'B2C') returning id", [ORG])).rows[0]!.id
    await client.query("insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1, $2, 1, '### Segunda via\nOriente a segunda via pelo aplicativo.', 'PUBLISHED', 'h-kbmg')", [ORG, document])
    await client.query("insert into knowledge_document_org_scopes (knowledge_document_id, scope_type, team_id) values ($1, 'TEAM', $2)", [document, teamA])
    await client.query("insert into knowledge_document_org_scopes (knowledge_document_id, scope_type, subteam_id) values ($1, 'SUBTEAM', $2)", [document, subB1])
    expect((await client.query<{ team_id: string }>("select team_id from knowledge_document_org_scopes where knowledge_document_id = $1 and scope_type = 'SUBTEAM'", [document])).rows[0]!.team_id).toBe(teamB)
    // Duplicata e Subgrupo de outro Grupo barrados pelo banco (índice único e FK composta).
    await client.query("savepoint dup")
    await expect(client.query("insert into knowledge_document_org_scopes (knowledge_document_id, scope_type, team_id) values ($1, 'TEAM', $2)", [document, teamA])).rejects.toThrow(/unique|duplicate/i)
    await client.query("rollback to savepoint dup")

    const app = createApp(client as never, { knowledgeInlineProcessing: false, rateLimits: false })
    const login = async (email: string) => {
      const http = request.agent(app)
      expect((await http.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200)
      return http
    }
    const material = async (who: { email: string }) => (await (await login(who.email)).get(`/api/v1/knowledge-materials/${document}`)).status
    expect(await material(opA)).toBe(200)
    expect(await material(opB1)).toBe(200)
    expect(await material(opB2)).toBe(404)
    expect(await material(opC)).toBe(404)

    // Gestão: o administrador só do Grupo A lê (vínculo dele), mas não altera — a base também vale para B1.
    const admin = await login(adminA.email)
    const org = await login(geral.email)
    const kb = "/api/v1/admin/knowledge"
    expect((await admin.get(`${kb}/${document}`)).status).toBe(200)
    expect((await admin.patch(`${kb}/${document}`).send({ title: "Proof KBMG — título trocado" })).body.error.code).toBe("KNOWLEDGE_SCOPE_FORBIDDEN")
    expect((await admin.patch(`${kb}/${document}`).send({ orgScopes: [{ scopeType: "TEAM", teamId: teamA }] })).body.error.code).toBe("KNOWLEDGE_SCOPE_FORBIDDEN")
    // Validação do alcance no backend.
    expect((await org.patch(`${kb}/${document}`).send({ orgScopes: [{ scopeType: "TEAM", teamId: teamA }, { scopeType: "TEAM", teamId: teamA }] })).body.error.code).toBe("KNOWLEDGE_SCOPE_INVALID")
    expect((await org.patch(`${kb}/${document}`).send({ orgScopes: [{ scopeType: "TEAM", teamId: teamB }, { scopeType: "SUBTEAM", subteamId: subB1 }] })).body.error.code).toBe("KNOWLEDGE_SCOPE_INVALID")
    expect((await org.patch(`${kb}/${document}`).send({ orgScopes: [{ scopeType: "ALL_TEAMS" }, { scopeType: "TEAM", teamId: teamA }] })).body.error.code).toBe("KNOWLEDGE_SCOPE_INVALID")
    expect((await org.patch(`${kb}/${document}`).send({ orgScopes: [{ scopeType: "SUBTEAM", teamId: teamA, subteamId: subB1 }] })).body.error.code).toBe("KNOWLEDGE_SCOPE_INVALID")

    // Lista: uma linha por base (dois vínculos não duplicam), para o geral e para o administrador do Grupo A.
    const listed = async (agent: request.Agent, query = "") => ((await agent.get(`${kb}?page=1&pageSize=50&search=Proof KBMG${query}`)).body.data.items as { id: string }[]).filter((item) => item.id === document).length
    expect(await listed(org)).toBe(1)
    expect(await listed(admin)).toBe(1)
    expect(await listed(org, `&teamId=${teamB}`)).toBe(1)
    expect(await listed(org, `&teamId=${teamC}`)).toBe(0)

    // Agents: mesma regra de antes (Grupo do Agent; Subgrupo leva o Grupo-pai). Vincular a base a mais Grupos não liga Agent nenhum.
    // Agente de Grupo (249): GROUPS + um vínculo com o Grupo inteiro em `agent_scope_links`.
    const agent = async (name: string, teamId: string) => {
      const id = (await client.query<{ id: string }>("insert into agents (organization_id, name, agent_type, objective, description, context_prompt, scope_type, operating_universe) values ($1, $2, 'CALL_FEEDBACK', 'o', 'd', 'c', 'GROUPS', 'B2C') returning id", [ORG, name])).rows[0]!.id
      await client.query("insert into agent_scope_links (agent_id, organization_id, team_id) values ($1, $2, $3)", [id, ORG, teamId])
      return id
    }
    const agentA = await agent("Proof KBMG Agent A", teamA)
    const agentB = await agent("Proof KBMG Agent B", teamB)
    const agentC = await agent("Proof KBMG Agent C", teamC)
    for (const id of [agentA, agentB, agentC]) await client.query("insert into agent_knowledge_documents (agent_id, knowledge_document_id) values ($1, $2)", [id, document])
    const titles = async (agentId: string) => (await retrieveKnowledgeForAgent(client as unknown as Database, agentId, "segunda via")).trace.authorizedDocuments.map((entry) => entry.title)
    clearKnowledgeSnapshotCache()
    expect(await titles(agentA)).toEqual(["Proof KBMG — PR Segunda via"])
    expect(await titles(agentB)).toEqual(["Proof KBMG — PR Segunda via"])
    expect(await titles(agentC)).toEqual([])

    // Remover o vínculo B1 (o que a publicação da nova configuração aplica): B1 perde; A continua; Agent do Grupo B deixa de usar já na
    // próxima busca (o cache de versões é por Agent e o alcance é relido a cada busca).
    await client.query("delete from knowledge_document_org_scopes where knowledge_document_id = $1 and subteam_id = $2", [document, subB1])
    expect(await material(opB1)).toBe(404)
    expect(await material(opA)).toBe(200)
    expect(await titles(agentB)).toEqual([])
    expect(await titles(agentA)).toEqual(["Proof KBMG — PR Segunda via"])
    // Mesmo id, conteúdo e histórico.
    expect((await client.query<{ n: number }>("select count(*)::int n from knowledge_versions where document_id = $1", [document])).rows[0]!.n).toBe(1)
  })
})
