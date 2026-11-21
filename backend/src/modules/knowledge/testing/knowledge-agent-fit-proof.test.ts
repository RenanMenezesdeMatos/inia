import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { knowledgeFitsAgentSql } from "../application/knowledge-agent-fit.js"
import { FIT_SUBTEAM_PARENT, KNOWLEDGE_AGENT_FIT_CASES, type FitAgentScope, type FitDocumentScope, type FitSubteam, type FitTeam } from "./knowledge-agent-fit-cases.js"

/**
 * PROVA da regra "a base cabe no agente" contra o banco de TESTE real (run-8, ARQ-03): a SQL única (`knowledgeFitsAgentSql`, usada ao
 * salvar o agente, na lista da base, no seletor do agente e na recuperação) responde o caderno único — o mesmo que a tela responde em
 * `knowledge-agent-fit.parity.test.ts`. Bases criadas numa transação desfeita no fim: nada fica no banco. ZERO chamada de IA.
 *
 *   INIA_DB_PROOF=1 npx vitest run knowledge-agent-fit-proof
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"

let pool: pg.Pool
let client: pg.PoolClient
const teams = {} as Record<FitTeam, string>
const subteams = {} as Record<FitSubteam, string>

describe.skipIf(!ENABLED)("a base cabe no agente — a SQL do servidor responde o caderno único (ARQ-03)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    client = await pool.connect()
    await client.query("begin")
    // Dois Grupos da organização da prova, o A com dois Subgrupos e o B com um (os da massa de teste).
    const rows = (await client.query<{ team_id: string; subteam_ids: string[] }>(
      `select st.team_id, array_agg(st.id order by st.id) subteam_ids from subteams st join teams t on t.id = st.team_id
        where t.organization_id = $1 group by st.team_id order by count(*) desc, st.team_id limit 2`,
      [ORG],
    )).rows
    expect(rows).toHaveLength(2)
    expect(rows[0]!.subteam_ids.length).toBeGreaterThanOrEqual(2)
    ;[teams.A, teams.B] = [rows[0]!.team_id, rows[1]!.team_id]
    ;[subteams.a1, subteams.a2, subteams.b1] = [rows[0]!.subteam_ids[0]!, rows[0]!.subteam_ids[1]!, rows[1]!.subteam_ids[0]!]
    expect(Object.entries(FIT_SUBTEAM_PARENT).every(([sub, team]) => rows.find((row) => row.team_id === teams[team])!.subteam_ids.includes(subteams[sub as FitSubteam]))).toBe(true)
  })

  afterAll(async () => {
    await client?.query("rollback")
    client?.release()
    await pool?.end()
  })

  async function insertDocument(scopes: FitDocumentScope[]): Promise<string> {
    const id = (await client.query<{ id: string }>(`insert into knowledge_documents (organization_id, title, document_type) values ($1, 'Prova — a base cabe no agente', 'PROCEDURE') returning id`, [ORG])).rows[0]!.id
    for (const scope of scopes) {
      const teamId = scope.scopeType === "TEAM" ? teams[scope.team] : scope.scopeType === "SUBTEAM" ? teams[FIT_SUBTEAM_PARENT[scope.subteam]] : null
      const subteamId = scope.scopeType === "SUBTEAM" ? subteams[scope.subteam] : null
      await client.query(`insert into knowledge_document_org_scopes (knowledge_document_id, scope_type, team_id, subteam_id) values ($1, $2, $3, $4)`, [id, scope.scopeType, teamId, subteamId])
    }
    return id
  }

  const agentParams = (scope: FitAgentScope) => [scope.scopeType, scope.scopeType === "TEAM" ? teams[scope.team] : null, scope.scopeType === "SUBTEAM" ? subteams[scope.subteam] : null]

  it.each(KNOWLEDGE_AGENT_FIT_CASES)("$name", async (fitCase) => {
    const documentId = await insertDocument(fitCase.document)
    const sql = `select ${knowledgeFitsAgentSql("$1::uuid", { scopeType: "$2::text", teamId: "$3::uuid", subteamId: "$4::uuid" })} fits`
    const result = await client.query<{ fits: boolean }>(sql, [documentId, ...agentParams(fitCase.agent)])
    expect(result.rows[0]!.fits).toBe(fitCase.fits)
  })
})
