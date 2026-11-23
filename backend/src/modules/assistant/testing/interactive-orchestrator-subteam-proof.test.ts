/**
 * PROVA no banco de TESTE real — alcance do Orquestrador por vínculos (migration 249, 23/11/2026):
 *
 *  - quem conversa (chat/voz) é atendido pelo Orquestrador cujo VÍNCULO que alcança a pessoa é o mais específico: Subgrupo dela (2) >
 *    Grupo dela inteiro (1) > "Todos os Grupos" (0); um vínculo de Subgrupo nunca alcança os irmãos;
 *  - um Orquestrador com vínculos [Grupo A inteiro, Subgrupo B1] atende quem está em A e em B1, e ninguém de B2;
 *  - vínculo IDÊNTICO a outro ativo do chat/voz no mesmo universo é recusado (409 ORCHESTRATOR_SCOPE_OVERLAP); Grupo A inteiro × A1 não;
 *  - vínculo NOVO sem operador em produção é recusado; o já salvo continua aceito na edição;
 *  - especialista: serve se for de "Todos os Grupos" ou se os Grupos dele cobrirem todos os do Orquestrador.
 * Tudo numa organização própria, numa transação desfeita.
 *
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run interactive-orchestrator-subteam-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { ResourceScope } from "../../../shared/domain/scope-links/resource-scope.js"
import { replaceResourceScopeLinks, resolveResourceScopeForWrite, scopedTargetOf } from "../../org-structure/application/resource-scope-links.js"
import { assertAgentsCompatibleWithOrchestratorScope, assertNoInteractiveScopeOverlap } from "../application/orchestrator-scope.js"
import { resolveOrchestratorForSubject, resolveOrchestratorForTeam } from "../application/resolve-orchestrator.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "0000a249-0000-4000-8000-000000000001"
const OPERATION = "0000a249-0000-4000-8000-000000000010"
const ORG_WIDE = { unrestricted: false as const, allTeams: true, teamIds: new Set<string>(), subteamIds: new Set<string>() }
let pool: pg.Pool
let client: pg.PoolClient
const db = () => client as unknown as Database

describe.skipIf(!ENABLED)("Orquestrador do chat/voz por vínculos de Grupo/Subgrupo (banco real)", () => {
  const ids = { teamA: "", a1: "", a2: "", teamB: "", b1: "", b2: "", empty: "", inA1: "", inA2: "", inAOnly: "", inB1: "", inB2: "", x: "", y: "", agentAB: "", agentA: "", agentAll: "" }
  const one = async (sql: string, params: unknown[]) => (await client.query<{ id: string }>(sql, params)).rows[0]!.id
  const coordinator = (name: string, scopeType = "ALL_TEAMS") => one(`insert into agents (organization_id, name, agent_type, objective, description, context_prompt, scope_type) values ($1, $2, 'ORCHESTRATOR', 'Coordenar', 'Prova', 'Coordene.', $3) returning id`, [ORG, name, scopeType])
  async function orchestrator(name: string, scope: ResourceScope, mode = "INTERACTIVE"): Promise<string> {
    const id = await one(
      `insert into assistant_orchestrators (organization_id, name, scope_type, orchestrator_agent_id, invocation_mode, policy_kind, routing_policy) values ($1, $2, $3, $4, $5, $6, 'OPEN') returning id`,
      [ORG, name, scope.scopeType, await coordinator(`${name} — coordenador`), mode, mode === "INTERACTIVE" ? "INTERACTIVE" : "OPEN"],
    )
    await replaceResourceScopeLinks(client, "ORCHESTRATOR", ORG, id, scope)
    return id
  }
  /** Mesma ordem do router: grava, depois confere a sobreposição na transação (savepoint para o teste seguir depois de uma recusa). */
  async function attempt(run: () => Promise<unknown>): Promise<unknown> {
    await client.query("savepoint attempt")
    try {
      await run()
      await client.query("release savepoint attempt")
      return null
    } catch (error) {
      await client.query("rollback to savepoint attempt")
      return error
    }
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    client = await pool.connect()
    await client.query("begin")
    await client.query("set local statement_timeout = '10s'")
    await client.query(`insert into organizations (id, name, slug) values ($1, 'Prova 249 Orquestrador', 'prova-249-orquestrador')`, [ORG])
    await client.query(`insert into operations (id, organization_id, name, timezone) values ($1, $2, 'Prova 249', 'America/Fortaleza')`, [OPERATION, ORG])
    const team = (name: string) => one("insert into teams (organization_id, operation_id, name) values ($1, $2, $3) returning id", [ORG, OPERATION, name])
    const subteam = (teamId: string, name: string) => one("insert into subteams (organization_id, team_id, name) values ($1, $2, $3) returning id", [ORG, teamId, name])
    const person = (name: string, teamId: string, subteamId: string | null) => one("insert into people (organization_id, name, role, team_id, subteam_id) values ($1, $2, 'OPERATOR', $3, $4) returning id", [ORG, name, teamId, subteamId])
    ids.teamA = await team("Prova Grupo A")
    ids.a1 = await subteam(ids.teamA, "A1")
    ids.a2 = await subteam(ids.teamA, "A2")
    ids.teamB = await team("Prova Grupo B")
    ids.b1 = await subteam(ids.teamB, "B1")
    ids.b2 = await subteam(ids.teamB, "B2")
    ids.empty = await subteam(ids.teamB, "B3 sem operador")
    ids.inA1 = await person("Prova em A1", ids.teamA, ids.a1)
    ids.inA2 = await person("Prova em A2", ids.teamA, ids.a2)
    ids.inAOnly = await person("Prova só no Grupo A", ids.teamA, null)
    ids.inB1 = await person("Prova em B1", ids.teamB, ids.b1)
    ids.inB2 = await person("Prova em B2", ids.teamB, ids.b2)
    // X: Grupo A inteiro + Subgrupo B1. Y: só o Subgrupo A1 (mais específico que o "A inteiro" de X para quem está em A1).
    ids.x = await orchestrator("Prova Orq X (A + B1)", { scopeType: "GROUPS", links: [{ teamId: ids.teamA, subteamId: null }, { teamId: ids.teamB, subteamId: ids.b1 }] })
    ids.y = await orchestrator("Prova Orq Y (A1)", { scopeType: "GROUPS", links: [{ teamId: ids.teamA, subteamId: ids.a1 }] })
  })

  afterAll(async () => {
    await client?.query("rollback")
    client?.release()
    await pool?.end()
  })

  it("o vínculo mais específico que alcança a pessoa vence: A1 → Y; A2 e só-Grupo-A → X; B1 → X; B2 → nenhum", async () => {
    const served = async (personId: string) => (await resolveOrchestratorForSubject(db(), ORG, personId, "INTERACTIVE"))?.orchestratorId ?? null
    expect(await served(ids.inA1)).toBe(ids.y)
    expect(await served(ids.inA2)).toBe(ids.x)
    expect(await served(ids.inAOnly)).toBe(ids.x)
    expect(await served(ids.inB1)).toBe(ids.x)
    expect(await served(ids.inB2)).toBeNull()
    // Consulta por Grupo (liderança): só o vínculo de Grupo inteiro conta.
    expect((await resolveOrchestratorForTeam(db(), ORG, ids.teamA, "INTERACTIVE"))?.orchestratorId).toBe(ids.x)
    expect(await resolveOrchestratorForTeam(db(), ORG, ids.teamB, "INTERACTIVE")).toBeNull()
  })

  it("'Todos os Grupos' só atende onde nenhum vínculo alcança; no mesmo nível, o mais recente", async () => {
    const all = await orchestrator("Prova Orq Todos", { scopeType: "ALL_TEAMS", links: [] })
    expect((await resolveOrchestratorForSubject(db(), ORG, ids.inB2, "INTERACTIVE"))?.orchestratorId).toBe(all)
    expect((await resolveOrchestratorForSubject(db(), ORG, ids.inA2, "INTERACTIVE"))?.orchestratorId).toBe(ids.x)
    // Só de Workflow não atende o chat; inativo também não.
    await client.query("update assistant_orchestrators set active = false where id = $1", [ids.y])
    expect((await resolveOrchestratorForSubject(db(), ORG, ids.inA1, "INTERACTIVE"))?.orchestratorId).toBe(ids.x)
    await client.query("update assistant_orchestrators set active = true, invocation_mode = 'WORKFLOW', policy_kind = 'OPEN' where id = $1", [ids.y])
    expect((await resolveOrchestratorForSubject(db(), ORG, ids.inA1, "INTERACTIVE"))?.orchestratorId).toBe(ids.x)
    await client.query("update assistant_orchestrators set invocation_mode = 'INTERACTIVE', policy_kind = 'INTERACTIVE' where id = $1", [ids.y])
    await client.query("update assistant_orchestrators set active = false where id = $1", [all])
  })

  it("sobreposição: vínculo idêntico com outro ativo do chat/voz → 409 com nomes e Grupos; Grupo inteiro × Subgrupo dele passa", async () => {
    const overlapping = await attempt(async () => {
      const id = await orchestrator("Prova Orq Z (B1)", { scopeType: "GROUPS", links: [{ teamId: ids.teamB, subteamId: ids.b1 }, { teamId: ids.teamB, subteamId: ids.b2 }] })
      await assertNoInteractiveScopeOverlap(client, ORG, id)
    })
    expect(overlapping).toMatchObject({ code: "ORCHESTRATOR_SCOPE_OVERLAP", statusCode: 409 })
    expect((overlapping as Error).message).toContain('"Prova Orq X (A + B1)" (Prova Grupo B › B1)')
    // A2 sozinho (dentro do "A inteiro" de X) e B2 não são idênticos a nada: passa.
    expect(await attempt(async () => assertNoInteractiveScopeOverlap(client, ORG, await orchestrator("Prova Orq W (A2 + B2)", { scopeType: "GROUPS", links: [{ teamId: ids.teamA, subteamId: ids.a2 }, { teamId: ids.teamB, subteamId: ids.b2 }] })))).toBeNull()
    // Só de Workflow, mesmo com o vínculo idêntico, não disputa o chat.
    expect(await attempt(async () => assertNoInteractiveScopeOverlap(client, ORG, await orchestrator("Prova Orq workflow (B1)", { scopeType: "GROUPS", links: [{ teamId: ids.teamB, subteamId: ids.b1 }] }, "WORKFLOW")))).toBeNull()
    // Dois "Todos os Grupos" ativos no mesmo universo: recusado também.
    const twoAll = await attempt(async () => {
      await orchestrator("Prova Orq Todos 2", { scopeType: "ALL_TEAMS", links: [] })
      const second = await orchestrator("Prova Orq Todos 3", { scopeType: "ALL_TEAMS", links: [] })
      await assertNoInteractiveScopeOverlap(client, ORG, second)
    })
    expect(twoAll).toMatchObject({ code: expect.stringMatching(/ORCHESTRATOR_SCOPE_TAKEN|23505/) })
    // Universo pendente disputa com qualquer universo (sem a exigência ativa, o pendente atende todos): vínculo idêntico B2C × pendente
    // é recusado, inclusive quando o pendente é classificado depois (run-10 QA-03/SEA-04).
    const pendingVsB2c = await attempt(async () => {
      const id = await orchestrator("Prova Orq B2C (B1)", { scopeType: "GROUPS", links: [{ teamId: ids.teamB, subteamId: ids.b1 }] })
      await client.query(`update assistant_orchestrators set operating_universe = 'B2C' where id = $1`, [id])
      await client.query(`update assistant_orchestrators set operating_universe = null where name = 'Prova Orq X (A + B1)' and organization_id = $1`, [ORG])
      await assertNoInteractiveScopeOverlap(client, ORG, id)
    })
    expect(pendingVsB2c).toMatchObject({ code: "ORCHESTRATOR_SCOPE_OVERLAP", statusCode: 409 })
  })

  it("vínculo NOVO sem operador em produção é recusado; o já salvo continua aceito na edição", async () => {
    const empty = { teamId: ids.teamB, subteamId: ids.empty }
    await expect(resolveResourceScopeForWrite(client, ORG, ORG_WIDE, { scopeType: "GROUPS", scopeLinks: [empty] }, { codePrefix: "ORCHESTRATOR" })).rejects.toMatchObject({ code: "SCOPE_UNIT_WITHOUT_PRODUCTION_OPERATORS" })
    const previous: ResourceScope = { scopeType: "GROUPS", links: [empty] }
    const kept = await resolveResourceScopeForWrite(client, ORG, ORG_WIDE, { scopeType: "GROUPS", scopeLinks: [empty, { teamId: ids.teamA, subteamId: ids.a2 }] }, { codePrefix: "ORCHESTRATOR", previous })
    expect(kept.links).toHaveLength(2)
  })

  it("especialista: 'Todos os Grupos' ou os Grupos dele cobrindo todos os do Orquestrador", async () => {
    const agent = async (name: string, scope: ResourceScope) => {
      const id = await one(`insert into agents (organization_id, name, agent_type, objective, description, context_prompt, scope_type) values ($1, $2, 'CUSTOM', 'Ajudar', 'Prova', 'Ajude.', $3) returning id`, [ORG, name, scope.scopeType])
      await replaceResourceScopeLinks(client, "AGENT", ORG, id, scope)
      return id
    }
    ids.agentAB = await agent("Prova Agent A + B", { scopeType: "GROUPS", links: [{ teamId: ids.teamA, subteamId: null }, { teamId: ids.teamB, subteamId: null }] })
    ids.agentA = await agent("Prova Agent A", { scopeType: "GROUPS", links: [{ teamId: ids.teamA, subteamId: null }] })
    ids.agentAll = await agent("Prova Agent Todos", { scopeType: "ALL_TEAMS", links: [] })
    const xScope = scopedTargetOf({ scopeType: "GROUPS", links: [{ teamId: ids.teamA, subteamId: null }, { teamId: ids.teamB, subteamId: ids.b1 }] })
    await expect(assertAgentsCompatibleWithOrchestratorScope(client, xScope, [ids.agentAB, ids.agentAll])).resolves.toBeUndefined()
    await expect(assertAgentsCompatibleWithOrchestratorScope(client, xScope, [ids.agentA])).rejects.toMatchObject({ code: "ORCHESTRATOR_AGENT_SCOPE_FORBIDDEN" })
    // Orquestrador de "Todos os Grupos" só usa Agent de "Todos os Grupos".
    await expect(assertAgentsCompatibleWithOrchestratorScope(client, scopedTargetOf({ scopeType: "ALL_TEAMS", links: [] }), [ids.agentAB])).rejects.toMatchObject({ code: "ORCHESTRATOR_AGENT_SCOPE_FORBIDDEN" })
  })
})
