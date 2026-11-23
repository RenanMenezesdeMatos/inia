/**
 * PROVA contra o banco de TESTE real — Abrangência do Workflow com vários Grupos/Subgrupos (migration 249).
 *
 * Pela API real (criar, editar o rascunho, publicar) e pelos mesmos resolvedores do runtime:
 *   1. vínculos [Grupo A inteiro, Subgrupo B1] = gente de A + de B1, nunca de B2 (irmão), cada pessoa uma vez — no conjunto (agenda,
 *      prévia) e na decisão pontual (ingestão);
 *   2. mudar os vínculos no rascunho não muda o runtime até Publicar; publicar grava `workflow_scope_links` e o snapshot da versão;
 *   3. versão antiga (TEAM + team_id, sem `scope_links`) continua lida pela visibilidade das execuções; a nova exige todos os vínculos;
 *   4. vínculo NOVO sem operador em produção é recusado (422 SCOPE_UNIT_WITHOUT_PRODUCTION_OPERATORS), o já salvo é preservado numa
 *      edição; vínculo fora do universo do Workflow é recusado (422 SCOPE_UNIT_OUTSIDE_UNIVERSE);
 *   5. ALL_TEAMS publicado alcança um Grupo criado DEPOIS da publicação (a população é resolvida a cada execução);
 *   6. compatibilidade com um Orquestrador de vários Grupos: na troca de Abrangência (409) e na publicação (422).
 * ZERO chamada de modelo. Tudo numa transação desfeita no fim (banco intacto).
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run workflow-scope-links-proof
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { assertEnrollmentVisible } from "../application/enrollment-visibility.js"
import { loadWorkflowConfigurationRow } from "../application/workflow-configuration-store.js"
import { isOperatorEligibleForWorkflow, resolveEligibleOperatorIds } from "../application/workflow-eligibility.js"
import type { WorkflowConfiguration } from "../domain/workflow-configuration.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
let client: pg.PoolClient

describe.skipIf(!ENABLED)("Abrangência com vários Grupos/Subgrupos (prova Postgres)", () => {
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

  it("população por vínculos, rascunho × publicada, versões, admissão de vínculos, ALL_TEAMS dinâmico e Orquestrador", async () => {
    const db = client as never
    const one = async (sql: string, params: unknown[]) => (await client.query<{ id: string }>(sql, params)).rows[0]!.id
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [ORG])).rows[0]!.id
    const team = (name: string, universe: string) => one("insert into teams (organization_id, operation_id, name, operating_universe) values ($1, $2, $3, $4) returning id", [ORG, operation, name, universe])
    const subteam = (teamId: string, name: string) => one("insert into subteams (organization_id, team_id, name) values ($1, $2, $3) returning id", [ORG, teamId, name])
    const operator = (name: string, teamId: string, subteamId: string | null, universe = "B2C", status = "EM_PRODUCAO") =>
      one("insert into people (organization_id, name, role, team_id, subteam_id, operating_universe, current_employment_status) values ($1, $2, 'OPERATOR', $3, $4, $5, $6) returning id", [ORG, name, teamId, subteamId, universe, status])

    const teamA = await team("Proof Links Grupo A", "B2C")
    const teamB = await team("Proof Links Grupo B", "B2C")
    const b1 = await subteam(teamB, "B1")
    const b2 = await subteam(teamB, "B2")
    const b3 = await subteam(teamB, "B3 sem produção")
    const teamX = await team("Proof Links Grupo X (B2B)", "B2B")
    const opA1 = await operator("Proof Links A1", teamA, null)
    const opA2 = await operator("Proof Links A2", teamA, null)
    const opB1 = await operator("Proof Links B1", teamB, b1)
    const opB2 = await operator("Proof Links B2", teamB, b2)
    const opB3 = await operator("Proof Links B3 (férias)", teamB, b3, "B2C", "FERIAS")
    await operator("Proof Links X", teamX, null, "B2B")

    const hash = await hashPassword("Proof@12345")
    const adminPerson = await one("insert into people (organization_id, name, role) values ($1, 'Proof Links Admin', 'SUPERVISOR') returning id", [ORG])
    const email = `proof-links-${Date.now()}@proof.inia.local`
    const account = await one("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [ORG, adminPerson, email, hash])
    await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, 'ADMINISTRADOR_GERAL', 'ORGANIZATION', now())", [ORG, account])
    const admin = request.agent(createApp(db))
    expect((await admin.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200)

    const base = "/api/v1/admin/workflows"
    const manual = { kind: "manual", context: "COLLABORATOR" }
    const endGraph = { nodes: [{ id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} }, { id: "end", type: "end", label: "Fim", position: { x: 0, y: 160 }, config: {} }], edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "end" }] }
    const liveLinks = async (workflowId: string) => (await client.query<{ team_id: string; subteam_id: string | null }>("select team_id, subteam_id from workflow_scope_links where workflow_id = $1 order by team_id, subteam_id nulls first", [workflowId])).rows
    const liveConfiguration = async (workflowId: string): Promise<WorkflowConfiguration> => (await loadWorkflowConfigurationRow(client, ORG, workflowId))!.live
    const population = async (config: WorkflowConfiguration) =>
      resolveEligibleOperatorIds(db, ORG, { scopeType: config.scopeType, scopeLinks: config.scopeLinks, populationFilter: config.populationFilter, operatingUniverse: config.operatingUniverse, requireActiveAccess: false })

    // 1) Vínculos [A inteiro, B1]: A + B1, nunca B2 (irmão) — cada pessoa uma vez, no conjunto e na decisão pontual.
    const created = await admin.post(base).send({ name: "Proof Links A + B1", operatingUniverse: "B2C", scopeType: "GROUPS", scopeLinks: [{ teamId: teamA, subteamId: null }, { teamId: teamB, subteamId: b1 }], trigger: manual })
    expect(created.status).toBe(201)
    const workflowId = created.body.data.id as string
    expect(created.body.data).toMatchObject({ scopeType: "GROUPS", draftConfiguration: { scopeType: "GROUPS" }, configurationChanges: [] })
    expect(created.body.data.scopeLinks).toHaveLength(2)
    expect(created.body.data.scopeLinks).toEqual(expect.arrayContaining([expect.objectContaining({ teamId: teamA, teamName: "Proof Links Grupo A", subteamId: null }), expect.objectContaining({ teamId: teamB, subteamId: b1, subteamName: "B1" })]))
    // Nunca publicado: a configuração viva (inclusive os vínculos publicados) acompanha o rascunho.
    expect(await liveLinks(workflowId)).toHaveLength(2)
    const reached = await population(await liveConfiguration(workflowId))
    expect(new Set(reached)).toEqual(new Set([opA1, opA2, opB1]))
    expect(reached).toHaveLength(3)
    const config = await liveConfiguration(workflowId)
    const pointwise = { scopeType: config.scopeType, scopeLinks: config.scopeLinks, populationFilter: null, operatingUniverse: "B2C", requireActiveAccess: false }
    expect(await isOperatorEligibleForWorkflow(db, ORG, pointwise, opB1)).toBe(true)
    expect(await isOperatorEligibleForWorkflow(db, ORG, pointwise, opB2)).toBe(false)

    // 2) Publicar grava o snapshot da versão; mudar os vínculos do rascunho não muda o runtime até Publicar de novo.
    expect((await admin.put(`${base}/${workflowId}/draft`).send({ graph: endGraph })).status).toBe(200)
    expect((await admin.post(`${base}/${workflowId}/publish`).send({})).status).toBe(200)
    const firstVersion = (await client.query<{ active_version_id: string }>("select active_version_id from workflows where id = $1", [workflowId])).rows[0]!.active_version_id
    const firstSnapshot = (await client.query<{ scope_type: string; scope_links: unknown[] }>("select scope_type, scope_links from workflow_versions where id = $1", [firstVersion])).rows[0]!
    expect(firstSnapshot.scope_type).toBe("GROUPS")
    expect(firstSnapshot.scope_links).toHaveLength(2)

    const narrowed = await admin.patch(`${base}/${workflowId}`).send({ scopeType: "GROUPS", scopeLinks: [{ teamId: teamA, subteamId: null }] })
    expect(narrowed.status).toBe(200)
    expect(narrowed.body.data.configurationChanges).toEqual(["SCOPE"])
    expect(narrowed.body.data.scopeLinks).toHaveLength(2) // topo = publicado
    expect(narrowed.body.data.draftConfiguration.scopeLinks).toEqual([expect.objectContaining({ teamId: teamA, subteamId: null })])
    expect(await liveLinks(workflowId)).toHaveLength(2)
    expect(new Set(await population(await liveConfiguration(workflowId)))).toEqual(new Set([opA1, opA2, opB1]))

    expect((await admin.post(`${base}/${workflowId}/publish`).send({})).status).toBe(200)
    expect(await liveLinks(workflowId)).toEqual([{ team_id: teamA, subteam_id: null }])
    expect(new Set(await population(await liveConfiguration(workflowId)))).toEqual(new Set([opA1, opA2]))
    const secondVersion = (await client.query<{ active_version_id: string }>("select active_version_id from workflows where id = $1", [workflowId])).rows[0]!.active_version_id
    expect((await client.query("select scope_type, team_id, scope_links from workflow_versions where id = $1", [secondVersion])).rows[0]).toEqual({ scope_type: "GROUPS", team_id: null, scope_links: [{ teamId: teamA, subteamId: null }] })
    expect((await client.query("select scope_links from workflow_versions where id = $1", [firstVersion])).rows[0]).toMatchObject({ scope_links: expect.arrayContaining([{ teamId: teamB, subteamId: b1 }]) })

    // 3) Versões nas execuções sem pessoa: a antiga (TEAM + team_id) continua lida; a nova exige TODOS os vínculos no escopo.
    const legacyVersion = await one("insert into workflow_versions (workflow_id, graph, scope_type, team_id) values ($1, $2, 'TEAM', $3) returning id", [workflowId, JSON.stringify(endGraph), teamA])
    // Execução sem pessoa: a medição é de um Grupo (sujeito TEAM), não de uma pessoa.
    const indicator = (await client.query<{ id: string }>("select id from indicator_definitions where organization_id = $1 limit 1", [ORG])).rows[0]!.id
    const teamMeasurement = await one("insert into indicator_measurements_all (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source) values ($1, $2, 'TEAM', $3, 1, now() - interval '1 day', now(), 'PROOF') returning id", [ORG, indicator, teamA])
    const rootOf = (versionId: string) => one("insert into workflow_enrollments (organization_id, workflow_id, version_id, indicator_measurement_id, current_node_id, status) values ($1, $2, $3, $4, 'end', 'completed') returning id", [ORG, workflowId, versionId, teamMeasurement])
    const legacyRoot = await rootOf(legacyVersion)
    const multiRoot = await rootOf(firstVersion)
    const onlyA = { allTeams: false, teamIds: [teamA], subteamIds: [] }
    const aAndB = { allTeams: false, teamIds: [teamA, teamB], subteamIds: [b1, b2, b3] }
    await expect(assertEnrollmentVisible(client, ORG, workflowId, legacyRoot, onlyA)).resolves.toBeUndefined()
    await expect(assertEnrollmentVisible(client, ORG, workflowId, multiRoot, onlyA)).rejects.toMatchObject({ code: "WORKFLOW_ENROLLMENT_NOT_FOUND" })
    await expect(assertEnrollmentVisible(client, ORG, workflowId, multiRoot, aAndB)).resolves.toBeUndefined()

    // 4) Admissão: vínculo NOVO sem operador em produção é recusado; já salvo é preservado; fora do universo é recusado.
    const withB3 = await admin.patch(`${base}/${workflowId}`).send({ scopeType: "GROUPS", scopeLinks: [{ teamId: teamA, subteamId: null }, { teamId: teamB, subteamId: b3 }] })
    expect(withB3.status).toBe(422)
    expect(withB3.body.error.code).toBe("SCOPE_UNIT_WITHOUT_PRODUCTION_OPERATORS")
    await client.query("update people set current_employment_status = 'EM_PRODUCAO' where id = $1", [opB3])
    expect((await admin.patch(`${base}/${workflowId}`).send({ scopeType: "GROUPS", scopeLinks: [{ teamId: teamA, subteamId: null }, { teamId: teamB, subteamId: b3 }] })).status).toBe(200)
    await client.query("update people set current_employment_status = 'FERIAS' where id = $1", [opB3])
    const keepsB3 = await admin.patch(`${base}/${workflowId}`).send({ scopeType: "GROUPS", scopeLinks: [{ teamId: teamA, subteamId: null }, { teamId: teamB, subteamId: b3 }, { teamId: teamB, subteamId: b1 }] })
    expect(keepsB3.status).toBe(200)
    expect(keepsB3.body.data.draftConfiguration.scopeLinks).toHaveLength(3)
    const outside = await admin.patch(`${base}/${workflowId}`).send({ scopeType: "GROUPS", scopeLinks: [{ teamId: teamA, subteamId: null }, { teamId: teamX, subteamId: null }] })
    expect(outside.status).toBe(422)
    expect(outside.body.error.code).toBe("SCOPE_UNIT_OUTSIDE_UNIVERSE")
    // Grupo inteiro junto de um Subgrupo dele: redundante, recusado.
    expect((await admin.patch(`${base}/${workflowId}`).send({ scopeType: "GROUPS", scopeLinks: [{ teamId: teamB, subteamId: null }, { teamId: teamB, subteamId: b1 }] })).status).toBe(422)

    // 5) ALL_TEAMS publicado alcança um Grupo criado DEPOIS da publicação.
    const everyone = await admin.post(base).send({ name: "Proof Links Todos", operatingUniverse: "B2C", scopeType: "ALL_TEAMS", trigger: manual })
    expect(everyone.status).toBe(201)
    expect(everyone.body.data).toMatchObject({ scopeType: "ALL_TEAMS", scopeLinks: [] })
    expect((await admin.put(`${base}/${everyone.body.data.id}/draft`).send({ graph: endGraph })).status).toBe(200)
    expect((await admin.post(`${base}/${everyone.body.data.id}/publish`).send({})).status).toBe(200)
    const teamC = await team("Proof Links Grupo C (depois)", "B2C")
    const opC = await operator("Proof Links C", teamC, null)
    expect(await population(await liveConfiguration(everyone.body.data.id))).toEqual(expect.arrayContaining([opA1, opB2, opC]))

    // 6) Orquestrador de vários Grupos [A, B]: Workflow em [A, B1] é compatível; mover para [A, C] é recusado (409); publicar um
    //    rascunho em [C] que já cita o Orquestrador é recusado (422).
    const coordinator = await one("insert into agents (organization_id, name, agent_type, objective, description, context_prompt, scope_type) values ($1, 'Proof Links Coordenador', 'ORCHESTRATOR', 'Coordenar', 'Prova', 'Coordene.', 'ALL_TEAMS') returning id", [ORG])
    const orchestrator = await one("insert into assistant_orchestrators (organization_id, name, scope_type, orchestrator_agent_id, invocation_mode, policy_kind, routing_policy) values ($1, 'Proof Links Orq A+B', 'GROUPS', $2, 'WORKFLOW', 'OPEN', 'OPEN') returning id", [ORG, coordinator])
    await client.query("insert into assistant_orchestrator_scope_links (orchestrator_id, organization_id, team_id, subteam_id) values ($1, $2, $3, null), ($1, $2, $4, null)", [orchestrator, ORG, teamA, teamB])
    const orchestratorGraph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        { id: "orq", type: "orchestrator", label: "Orquestrador", position: { x: 0, y: 80 }, config: { orchestratorId: orchestrator, instruction: "Analise." } },
        { id: "end", type: "end", label: "Fim", position: { x: 0, y: 160 }, config: {} },
      ],
      edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "orq" }, { id: "e2", source: "orq", sourceHandle: "always", target: "end" }],
    }
    const compatible = await admin.post(base).send({ name: "Proof Links Orq compatível", operatingUniverse: "B2C", scopeType: "GROUPS", scopeLinks: [{ teamId: teamA, subteamId: null }, { teamId: teamB, subteamId: b1 }], trigger: manual })
    expect(compatible.status).toBe(201)
    expect((await admin.put(`${base}/${compatible.body.data.id}/draft`).send({ graph: orchestratorGraph })).status).toBe(200)
    const moved = await admin.patch(`${base}/${compatible.body.data.id}`).send({ scopeType: "GROUPS", scopeLinks: [{ teamId: teamA, subteamId: null }, { teamId: teamC, subteamId: null }] })
    expect(moved.status).toBe(409)
    expect(moved.body.error.code).toBe("WORKFLOW_ORCHESTRATOR_SCOPE_FORBIDDEN")
    expect((await admin.patch(`${base}/${compatible.body.data.id}`).send({ scopeType: "GROUPS", scopeLinks: [{ teamId: teamA, subteamId: null }, { teamId: teamB, subteamId: null }] })).status).toBe(200)
    const compatiblePublish = await admin.post(`${base}/${compatible.body.data.id}/publish`).send({})
    expect(compatiblePublish.body.error?.code).not.toBe("WORKFLOW_ORCHESTRATOR_SCOPE_FORBIDDEN")

    const incompatible = await admin.post(base).send({ name: "Proof Links Orq fora", operatingUniverse: "B2C", scopeType: "GROUPS", scopeLinks: [{ teamId: teamC, subteamId: null }], trigger: manual })
    expect(incompatible.status).toBe(201)
    expect((await admin.put(`${base}/${incompatible.body.data.id}/draft`).send({ graph: orchestratorGraph })).status).toBe(200)
    const refused = await admin.post(`${base}/${incompatible.body.data.id}/publish`).send({})
    expect(refused.status).toBe(422)
    expect(refused.body.error.code).toBe("WORKFLOW_ORCHESTRATOR_SCOPE_FORBIDDEN")

    // Listagem com filtro de Subgrupo: Workflow com o Grupo-pai inteiro também alcança B1 (uma linha por Workflow).
    const listed = await admin.get(`${base}?subteamId=${b1}&search=Proof%20Links`)
    expect(listed.status).toBe(200)
    const names = (listed.body.data as { name: string }[]).map((row) => row.name)
    expect(names).toContain("Proof Links Orq compatível")
    expect(names).not.toContain("Proof Links Orq fora")
    expect(new Set(names).size).toBe(names.length)
  })
})
