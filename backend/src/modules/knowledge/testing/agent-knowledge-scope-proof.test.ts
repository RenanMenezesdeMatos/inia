/**
 * PROVA contra o banco de TESTE real: a base que passa a valer só para OUTRO Grupo sai da recuperação do Agent na hora, sem
 * ninguém salvar o Agent (achado AI-05 da auditoria de 17/10/2026). Tudo numa transação desfeita no fim.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run agent-knowledge-scope-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { clearKnowledgeSnapshotCache, retrieveKnowledgeForAgent } from "../application/retrieve-knowledge.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool
let client: pg.PoolClient

describe.skipIf(!ENABLED)("Alcance da base conferido a cada busca do Agent — prova Postgres", () => {
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

  it("base global vinculada ao Agent do Grupo A: aparece; restrita ao Grupo B: some; Agent de todos os Grupos continua vendo", async () => {
    const org = (await client.query<{ id: string }>("select id from organizations order by created_at limit 1")).rows[0]!.id
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [org])).rows[0]!.id
    const team = async (name: string) => (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, $3) returning id", [org, operation, name])).rows[0]!.id
    const teamA = await team("Proof AI05 Grupo A")
    const teamB = await team("Proof AI05 Grupo B")
    const agent = async (name: string, scopeType: "TEAM" | "ALL_TEAMS", teamId: string | null) =>
      (await client.query<{ id: string }>("insert into agents (organization_id, name, agent_type, objective, description, context_prompt, scope_type, team_id) values ($1, $2, 'CALL_FEEDBACK', 'o', 'd', 'c', $3, $4) returning id", [org, name, scopeType, teamId])).rows[0]!.id
    const agentA = await agent("Proof AI05 Agent A", "TEAM", teamA)
    const agentAll = await agent("Proof AI05 Agent Todos", "ALL_TEAMS", null)
    const document = (await client.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type) values ($1, 'Proof AI05 Procedimento comercial', 'PROCEDURE') returning id", [org])).rows[0]!.id
    await client.query("insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1, $2, 1, '### Desconto especial\nOfereça o desconto confidencial de retenção de 40%.', 'PUBLISHED', 'h')", [org, document])
    const scope = (scopeType: "ALL_TEAMS" | "TEAM", teamId: string | null) => client.query("insert into knowledge_document_org_scopes (knowledge_document_id, scope_type, team_id) values ($1, $2, $3)", [document, scopeType, teamId])
    await scope("ALL_TEAMS", null)
    for (const id of [agentA, agentAll]) await client.query("insert into agent_knowledge_documents (agent_id, knowledge_document_id) values ($1, $2)", [id, document])
    const titles = async (agentId: string) => (await retrieveKnowledgeForAgent(client as unknown as Database, agentId, "desconto de retenção")).trace.authorizedDocuments.map((entry) => entry.title)

    clearKnowledgeSnapshotCache()
    expect(await titles(agentA)).toEqual(["Proof AI05 Procedimento comercial"])
    // O Administrador geral restringe a base ao Grupo B — o vínculo com o Agent A continua no banco.
    await client.query("delete from knowledge_document_org_scopes where knowledge_document_id = $1", [document])
    await scope("TEAM", teamB)
    expect(await titles(agentA)).toEqual([])
    expect(await titles(agentAll)).toEqual(["Proof AI05 Procedimento comercial"])
  })
})
