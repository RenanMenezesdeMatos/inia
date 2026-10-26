/**
 * PROVA no banco de TESTE real: quem conversa (chat/voz) é atendido pelo Orquestrador do SEU Subgrupo; sem ele, pelo do Grupo;
 * sem ele, pelo de "Todos os grupos". O cadastro já aceitava Orquestrador de Subgrupo, mas a resolução ignorava o Subgrupo e a
 * pessoa continuava no do Grupo (validação funcional de 20/10/2026, D6). A consulta por Grupo (liderança) segue no do Grupo.
 * Tudo numa transação desfeita.
 *
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run interactive-orchestrator-subteam-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { resolveOrchestratorForSubject, resolveOrchestratorForTeam } from "../application/resolve-orchestrator.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATION = "00000000-0000-4000-8000-000000000010"
let pool: pg.Pool
let client: pg.PoolClient
const db = () => client as unknown as Database

describe.skipIf(!ENABLED)("Orquestrador do chat/voz por Subgrupo (banco real)", () => {
  const ids = { team: "", subteam: "", inSubteam: "", teamOnly: "", teamOrchestrator: "", subteamOrchestrator: "" }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    client = await pool.connect()
    await client.query("begin")
    await client.query("set local statement_timeout = '10s'")
    const one = async (sql: string, params: unknown[]) => (await client.query<{ id: string }>(sql, params)).rows[0]!.id
    ids.team = await one("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Prova Orq Grupo') returning id", [ORG, OPERATION])
    ids.subteam = await one("insert into subteams (organization_id, team_id, name) values ($1, $2, 'Prova Orq Subgrupo') returning id", [ORG, ids.team])
    ids.inSubteam = await one("insert into people (organization_id, name, role, team_id, subteam_id) values ($1, 'Prova Orq Do Subgrupo', 'OPERATOR', $2, $3) returning id", [ORG, ids.team, ids.subteam])
    ids.teamOnly = await one("insert into people (organization_id, name, role, team_id) values ($1, 'Prova Orq Só do Grupo', 'OPERATOR', $2) returning id", [ORG, ids.team])
    const coordinator = async (name: string) => one("insert into agents (organization_id, name, agent_type, objective, description, context_prompt) values ($1, $2, 'ORCHESTRATOR', 'Coordenar', 'Prova', 'Coordene.') returning id", [ORG, name])
    const orchestrator = async (name: string, scope: "TEAM" | "SUBTEAM") =>
      one(
        "insert into assistant_orchestrators (organization_id, name, scope_type, team_id, subteam_id, orchestrator_agent_id, invocation_mode, policy_kind, routing_policy) values ($1, $2, $3, $4, $5, $6, 'INTERACTIVE', 'INTERACTIVE', 'OPEN') returning id",
        [ORG, name, scope, scope === "TEAM" ? ids.team : null, scope === "SUBTEAM" ? ids.subteam : null, await coordinator(`${name} — coordenador`)],
      )
    ids.teamOrchestrator = await orchestrator("Prova Orq do Grupo", "TEAM")
    ids.subteamOrchestrator = await orchestrator("Prova Orq do Subgrupo", "SUBTEAM")
  })

  afterAll(async () => {
    await client?.query("rollback")
    client?.release()
    await pool?.end()
  })

  it("pessoa do Subgrupo → Orquestrador do Subgrupo; pessoa só do Grupo → do Grupo; consulta por Grupo → do Grupo", async () => {
    expect((await resolveOrchestratorForSubject(db(), ORG, ids.inSubteam, "INTERACTIVE"))?.orchestratorId).toBe(ids.subteamOrchestrator)
    expect((await resolveOrchestratorForSubject(db(), ORG, ids.teamOnly, "INTERACTIVE"))?.orchestratorId).toBe(ids.teamOrchestrator)
    expect((await resolveOrchestratorForTeam(db(), ORG, ids.team, "INTERACTIVE"))?.orchestratorId).toBe(ids.teamOrchestrator)
  })

  it("Orquestrador do Subgrupo inativo → a pessoa volta ao do Grupo; só de Workflow não atende o chat", async () => {
    await client.query("update assistant_orchestrators set active = false where id = $1", [ids.subteamOrchestrator])
    expect((await resolveOrchestratorForSubject(db(), ORG, ids.inSubteam, "INTERACTIVE"))?.orchestratorId).toBe(ids.teamOrchestrator)
    await client.query("update assistant_orchestrators set active = true, invocation_mode = 'WORKFLOW', policy_kind = 'OPEN' where id = $1", [ids.subteamOrchestrator])
    expect((await resolveOrchestratorForSubject(db(), ORG, ids.inSubteam, "INTERACTIVE"))?.orchestratorId).toBe(ids.teamOrchestrator)
  })
})
