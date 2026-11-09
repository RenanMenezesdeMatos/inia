/**
 * PROVA contra o banco de TESTE real — o rascunho aceita etapa incompleta; só a publicação exige tudo (proposta P1 da auditoria de
 * UX de Workflows, `docs/qa/workflows/propostas.md`).
 *
 * Prova, pela API real:
 *   1. salvar uma etapa recém-criada de cada tipo responde 200, e reabrir devolve os campos em branco, sem nenhum valor provisório;
 *   2. o dry-run e a publicação recusam apontando a etapa e o que falta, e nenhuma versão é criada;
 *   3. mudar a Abrangência e o modo de avaliação continuam funcionando com o rascunho incompleto;
 *   4. dado inválido que não é branco continua recusado ao salvar;
 *   5. o QA Lab recusa simular o rascunho incompleto com a mesma orientação;
 *   6. com um fluxo publicado, salvar um rascunho incompleto não mexe na versão no ar;
 *   7. completado, o fluxo publica, e a versão nunca guarda campo em branco.
 * ZERO chamada de modelo. Tudo numa transação desfeita no fim (banco intacto).
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run workflow-incomplete-draft-proof
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { loadWorkflowForSimulation, resolveSimulationGraph } from "../../qa-lab/application/build-simulated-enrollment.js"
import { DomainError } from "../../../shared/domain/domain-error.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const position = { x: 0, y: 0 }
const trigger = { id: "trigger", type: "trigger", label: "Início", position, config: {} }
const end = { id: "end", type: "end", label: "Fim", position, config: {} }

const blankHistorical = { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "", aggregation: "COUNT", comparator: "LT", indicatorThreshold: 0, period: { kind: "ROLLING_DAYS", days: 7 } }

/** Etapas como o editor as cria, antes de a pessoa preencher qualquer campo. */
const INCOMPLETE_NODES = [
  { id: "agente", type: "action", label: "Analisar chamada", position, config: { actionType: "CALL_AGENT", agentId: "" } },
  { id: "feedback", type: "action", label: "Gerar feedback", position, config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: "", feedbackDomain: "AUTO" } },
  { id: "variavel", type: "action", label: "Definir variável", position, config: { actionType: "SET_VARIABLE", variableId: "", value: true } },
  { id: "orquestrador", type: "orchestrator", label: "Orquestrador", position, config: { orchestratorId: "", instruction: "" } },
  { id: "politica", type: "intervention_policy", label: "Política", position, config: { policyId: "", mode: "RECOMMEND_ONLY", analysisSourceNodeIds: [] } },
  { id: "condicao", type: "condition", label: "Condição", position, config: { comparator: "GTE", thresholdNumeric: 1, thresholdBoolean: null, historicalQuery: blankHistorical } },
  { id: "saida", type: "output", label: "Output", position, config: { target: { type: "USER", userId: "" }, surfaces: [], source: "" } },
]

describe.skipIf(!ENABLED)("Rascunho incompleto: salva e reabre; publicar exige tudo (prova Postgres)", () => {
  let pool: pg.Pool
  let client: pg.PoolClient

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

  it("salvar, reabrir, validar, publicar, completar e editar um fluxo publicado", async () => {
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [ORG])).rows[0]!.id
    const team = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof Rascunho Grupo') returning id", [ORG, operation])).rows[0]!.id
    const personId = (await client.query<{ id: string }>("insert into people (organization_id, name, role) values ($1, 'Proof Rascunho Admin', 'OPERATOR') returning id", [ORG])).rows[0]!.id
    const email = `proof-rascunho-${Date.now()}@proof.inia.local`
    const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [ORG, personId, email, await hashPassword("Proof@12345")])).rows[0]!.id
    await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, 'ADMINISTRADOR_GERAL', 'ORGANIZATION', now())", [ORG, accountId])

    const admin = request.agent(createApp(client as never))
    expect((await admin.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200)
    const base = "/api/v1/admin/workflows"
    const versionCount = async (workflowId: string) => (await client.query<{ n: number }>("select count(*)::int n from workflow_versions where workflow_id = $1", [workflowId])).rows[0]!.n

    const created = await admin.post(base).send({ name: "Proof Rascunho", scopeType: "ALL_TEAMS", trigger: { kind: "manual", context: "COLLABORATOR" } })
    expect(created.status).toBe(201)
    const workflowId = created.body.data.id as string

    // 1) Salva com todas as etapas em branco; reabre igual, sem valor provisório.
    const incomplete = { nodes: [trigger, ...INCOMPLETE_NODES, end], edges: [] }
    expect((await admin.put(`${base}/${workflowId}/draft`).send({ graph: incomplete })).status).toBe(200)
    const reopened = await admin.get(`${base}/${workflowId}`)
    expect(reopened.status).toBe(200)
    expect(reopened.body.data.draftGraph.nodes.map((node: { config: unknown }) => node.config)).toEqual(incomplete.nodes.map((node) => node.config))
    expect(JSON.stringify(reopened.body.data.draftGraph)).not.toMatch(/00000000-0000-4000-8000-000000000000|preenchido/i)

    // 2) Dry-run e publicação apontam a primeira etapa incompleta; nenhuma versão nasce.
    const dryRun = await admin.post(`${base}/${workflowId}/validate`).send({})
    expect(dryRun.status).toBe(200)
    expect(dryRun.body.data).toEqual({ valid: false, error: { code: "VALIDATION_ERROR", message: 'Em "Analisar chamada", escolha o agente.', nodeId: "agente" } })
    const refused = await admin.post(`${base}/${workflowId}/publish`).send({})
    expect(refused.status).toBe(422)
    expect(refused.body.error).toMatchObject({ code: "VALIDATION_ERROR", message: 'Em "Analisar chamada", escolha o agente.', details: { nodeId: "agente" } })
    expect(await versionCount(workflowId)).toBe(0)

    // 3) A configuração do Workflow continua editável com o rascunho incompleto. Orquestrador em branco não vira erro de banco.
    expect((await admin.patch(`${base}/${workflowId}`).send({ scopeType: "TEAM", teamId: team })).status).toBe(200)
    expect((await admin.patch(`${base}/${workflowId}`).send({ trigger: { kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1, frequency: { type: "DAILY" } } })).status).toBe(200)
    expect((await admin.put(`${base}/${workflowId}/analysis-config`).send({ mode: "INDIVIDUAL", populationFilter: null })).status).toBe(200)
    expect((await admin.patch(`${base}/${workflowId}`).send({ trigger: { kind: "manual", context: "COLLABORATOR" } })).status).toBe(200)

    // 4) Só o branco é tolerado.
    const invalid = await admin.put(`${base}/${workflowId}/draft`).send({ graph: { nodes: [trigger, { ...INCOMPLETE_NODES[0], config: { actionType: "CALL_AGENT", agentId: "nao-e-uuid" } }, end], edges: [] } })
    expect(invalid.status).toBe(400)
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR")
    expect((await admin.put(`${base}/${workflowId}/draft`).send({ graph: "nada" })).status).toBe(400)
    expect((await admin.put(`${base}/${workflowId}/draft`).send({})).status).toBe(400)

    // 5) QA Lab: simular o rascunho incompleto recusa com a mesma orientação.
    const loaded = await loadWorkflowForSimulation(client as never, ORG, workflowId)
    expect(() => resolveSimulationGraph(loaded!, "DRAFT")).toThrow(DomainError)
    expect(() => resolveSimulationGraph(loaded!, "DRAFT")).toThrow('Em "Analisar chamada", escolha o agente.')

    // 7) Completado, publica; a versão não guarda campo em branco.
    const wait = { id: "espera", type: "wait", label: "Aguardar", position, config: { durationMs: 3_600_000 } }
    const complete = {
      nodes: [trigger, wait, end],
      edges: [
        { id: "e1", source: "trigger", sourceHandle: "always", target: "espera" },
        { id: "e2", source: "espera", sourceHandle: "always", target: "end" },
      ],
    }
    expect((await admin.put(`${base}/${workflowId}/draft`).send({ graph: complete })).status).toBe(200)
    expect((await admin.post(`${base}/${workflowId}/validate`).send({})).body.data).toEqual({ valid: true, error: null })
    expect((await admin.post(`${base}/${workflowId}/publish`).send({})).status).toBe(200)
    expect(await versionCount(workflowId)).toBe(1)
    const publishedVersion = (await client.query<{ graph: unknown; id: string }>("select v.id, v.graph from workflow_versions v join workflows w on w.active_version_id = v.id where w.id = $1", [workflowId])).rows[0]!

    // 6) Fluxo publicado: salvar um rascunho incompleto não mexe na versão no ar, e publicar continua recusado.
    expect((await admin.put(`${base}/${workflowId}/draft`).send({ graph: { nodes: [trigger, INCOMPLETE_NODES[6], end], edges: [] } })).status).toBe(200)
    const afterEdit = await admin.get(`${base}/${workflowId}`)
    expect(afterEdit.body.data.publishedGraph).toEqual(publishedVersion.graph)
    expect(afterEdit.body.data.draftGraph.nodes[1].config).toEqual(INCOMPLETE_NODES[6]!.config)
    expect((await client.query<{ id: string }>("select active_version_id id from workflows where id = $1", [workflowId])).rows[0]!.id).toBe(publishedVersion.id)
    const refusedAgain = await admin.post(`${base}/${workflowId}/publish`).send({})
    expect(refusedAgain.status).toBe(422)
    expect(refusedAgain.body.error.details).toEqual({ nodeId: "saida" })
    expect(await versionCount(workflowId)).toBe(1)
    // A prévia da simulação da versão publicada segue funcionando: a versão no ar é completa.
    const reloaded = await loadWorkflowForSimulation(client as never, ORG, workflowId)
    expect(resolveSimulationGraph(reloaded!, "PUBLISHED").graph.nodes.map((node) => node.id)).toEqual(["trigger", "espera", "end"])
  })
})
