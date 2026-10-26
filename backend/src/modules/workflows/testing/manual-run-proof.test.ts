/**
 * PROVA contra o banco de TESTE real — gatilho MANUAL ("Executar agora"): criação e publicação pela API real, impedimentos
 * (não publicado, inativo, sem permissão, fora do escopo), elegibilidade do colaborador, contexto (interação real DO
 * colaborador, com transcrição), idempotência (mesma chave = mesmo disparo; chave nova = nova execução), a matrícula NORMAL
 * processada pelo motor até o fim, a origem manual visível em Execuções/Resultados e que ingestão nunca dispara um Manual.
 * ZERO chamada de modelo. Cada caso roda numa transação desfeita AO FIM DO PRÓPRIO CASO (banco intacto); o de concorrência
 * grava por outras conexões do pool e apaga o que criou.
 * A transação nunca atravessa casos: escrita pendente segura lock de linha até o rollback, e o caso seguinte, que grava por
 * OUTRA conexão, esperaria por ela até estourar o tempo. Foi o que aconteceu com a migration 128 (`analytics_versions`,
 * 13/10/2026): todo insert em `people` atualiza a MESMA linha por organização.
 *   INIA_DB_PROOF=1 npx vitest run manual-run-proof
 */
import pg from "pg"
import request from "supertest"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { processEnrollment, type ClaimedRow } from "../application/engine.js"
import { enrollIndicatorWorkflows } from "../application/indicator-enrollment.js"
import { requestManualRun } from "../application/manual-run.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
let client: pg.PoolClient

describe.skipIf(!ENABLED)("Gatilho Manual — prova Postgres (API real, motor real, zero modelo)", () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
  })
  beforeEach(async () => {
    client = await pool.connect()
    await client.query("begin")
  })
  afterEach(async () => {
    if (client) {
      await client.query("rollback")
      client.release()
    }
  })
  afterAll(async () => {
    if (pool) await pool.end()
  })

  it("cria, publica, bloqueia, valida e executa pelo motor — com idempotência e origem manual rastreável", async () => {
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [ORG])).rows[0]!.id
    const teamA = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof Manual Grupo A') returning id", [ORG, operation])).rows[0]!.id
    const teamB = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof Manual Grupo B') returning id", [ORG, operation])).rows[0]!.id
    const hash = await hashPassword("Proof@12345")
    let n = 0
    const person = async (level: string, teamId: string | null, roleCode?: string, scope?: { type: string; teamId?: string }) => {
      n += 1
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1, $2, $3, $4) returning id", [ORG, `Proof Manual ${level} ${n}`, level, teamId])).rows[0]!.id
      const email = `proof-manual-${n}-${Date.now()}@proof.inia.local`
      const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [ORG, id, email, hash])).rows[0]!.id
      if (roleCode && scope) await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, $3, $4, $5, now())", [ORG, accountId, roleCode, scope.type, scope.teamId ?? null])
      return { id, email }
    }
    const geral = await person("OPERATOR", null, "ADMINISTRADOR_GERAL", { type: "ORGANIZATION" })
    const adminB = await person("SUPERVISOR", teamB, "ADMINISTRADOR", { type: "GROUP", teamId: teamB })
    const semPapel = await person("SUPERVISOR", teamA)
    const operatorA = await person("OPERATOR", teamA)
    const operatorB = await person("OPERATOR", teamB)
    const interaction = async (operatorId: string, withTranscript: boolean) => {
      const id = (await client.query<{ id: string }>(
        "insert into interactions (organization_id, operator_id, reason, started_at, ended_at, external_id) values ($1, $2, 'Contestação de conta', now() - interval '2 days', now() - interval '2 days' + interval '9 minutes', $3) returning id",
        [ORG, operatorId, `PROOF-MANUAL-${Math.random()}`],
      )).rows[0]!.id
      if (withTranscript) await client.query("insert into transcripts (organization_id, interaction_id, content) values ($1, $2, 'OPERADOR: Bom dia. CLIENTE: Quero contestar a conta.')", [ORG, id])
      return id
    }
    const callA = await interaction(operatorA.id, true)
    const callANoTranscript = await interaction(operatorA.id, false)
    const callB = await interaction(operatorB.id, true)

    const app = createApp(client as never)
    const login = async (email: string) => {
      const agentHttp = request.agent(app)
      expect((await agentHttp.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200)
      return agentHttp
    }
    const admin = await login(geral.email)
    const base = "/api/v1/admin/workflows"
    // Publicar = o MESMO dry-run da rota (validateWorkflowForPublish) + a gravação da versão (a rota abre conexão própria,
    // incompatível com a transação desta prova — mesmo recurso das outras provas).
    const publish = async (id: string) => {
      expect((await admin.post(`${base}/${id}/validate`)).body.data).toEqual({ valid: true, error: null })
      const draft = (await client.query<{ draft_graph: unknown }>("select draft_graph from workflows where id = $1", [id])).rows[0]!.draft_graph
      const version = (await client.query<{ id: string }>("insert into workflow_versions (workflow_id, graph, created_by) values ($1, $2, $3) returning id", [id, JSON.stringify(draft), geral.id])).rows[0]!.id
      await client.query("update workflows set active_version_id = $1 where id = $2", [version, id])
    }

    // 1) Criação com o gatilho Manual (Grupo A) — nada é disparado ao criar.
    const createdWorkflow = await admin.post(base).send({ name: "Proof Manual WF", scopeType: "TEAM", teamId: teamA, trigger: { kind: "manual", context: "INTERACTION", indicatorCode: "IGNORADO" } })
    expect(createdWorkflow.status).toBe(201)
    const workflowId = createdWorkflow.body.data.id as string
    expect(createdWorkflow.body.data.trigger).toEqual({ kind: "manual", context: "INTERACTION" })
    expect((await admin.get(`${base}?triggerKind=manual&pageSize=100`)).body.data.items.map((item: { id: string }) => item.id)).toContain(workflowId)
    expect((await client.query("select count(*)::int n from workflow_enrollments where workflow_id = $1", [workflowId])).rows[0].n).toBe(0)

    // 2) Não publicado: a tela mostra o impedimento; o backend recusa.
    const key = () => `proof-${Math.random().toString(36).slice(2)}-${Date.now()}`
    expect((await admin.get(`${base}/${workflowId}/manual-run`)).body.data).toMatchObject({ context: "INTERACTION", published: false, blockers: [{ code: "WORKFLOW_MANUAL_RUN_NOT_PUBLISHED" }] })
    const notPublished = await admin.post(`${base}/${workflowId}/manual-runs`).send({ collaboratorId: operatorA.id, interactionId: callA, idempotencyKey: key() })
    expect(notPublished.status).toBe(409)
    expect(notPublished.body.error.code).toBe("WORKFLOW_MANUAL_RUN_NOT_PUBLISHED")

    // 3) Publica (trigger → Fim) — publicar também não dispara.
    const graph = { nodes: [{ id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} }, { id: "end", type: "end", label: "Fim", position: { x: 0, y: 160 }, config: {} }], edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "end" }] }
    expect((await admin.put(`${base}/${workflowId}/draft`).send({ graph })).status).toBe(200)
    await publish(workflowId)
    expect((await client.query("select count(*)::int n from workflow_enrollments where workflow_id = $1", [workflowId])).rows[0].n).toBe(0)
    const versionId = (await client.query<{ active_version_id: string }>("select active_version_id from workflows where id = $1", [workflowId])).rows[0]!.active_version_id

    // 4) Inativo: recusado; reativado: liberado.
    await admin.patch(`${base}/${workflowId}`).send({ active: false })
    expect((await admin.post(`${base}/${workflowId}/manual-runs`).send({ collaboratorId: operatorA.id, interactionId: callA, idempotencyKey: key() })).body.error.code).toBe("WORKFLOW_MANUAL_RUN_INACTIVE")
    await admin.patch(`${base}/${workflowId}`).send({ active: true })
    expect((await admin.get(`${base}/${workflowId}/manual-run`)).body.data.blockers).toEqual([])

    // 4b) D10 (20/10/2026): Agent da versão publicada desativado DEPOIS de publicar = impedimento visível e disparo recusado.
    const agentWorkflowId = (await admin.post(base).send({ name: "Proof Manual WF com Agent", scopeType: "TEAM", teamId: teamA, trigger: { kind: "manual", context: "INTERACTION" } })).body.data.id as string
    const agentId = (await client.query<{ id: string }>("insert into agents (organization_id, name, agent_type, objective, description, context_prompt, active) values ($1, 'Proof Manual Agent desligado', 'CUSTOM', 'Avaliar', 'Prova', 'Avalie.', false) returning id", [ORG])).rows[0]!.id
    const agentGraph = { nodes: [{ id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} }, { id: "agent", type: "action", label: "Especialista", position: { x: 0, y: 80 }, config: { actionType: "CALL_AGENT", agentId } }, { id: "end", type: "end", label: "Fim", position: { x: 0, y: 160 }, config: {} }], edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "agent" }, { id: "e2", source: "agent", sourceHandle: "always", target: "end" }] }
    const agentVersion = (await client.query<{ id: string }>("insert into workflow_versions (workflow_id, graph, created_by) values ($1, $2, $3) returning id", [agentWorkflowId, JSON.stringify(agentGraph), geral.id])).rows[0]!.id
    await client.query("update workflows set active_version_id = $1 where id = $2", [agentVersion, agentWorkflowId])
    expect((await admin.get(`${base}/${agentWorkflowId}/manual-run`)).body.data.blockers.map((blocker: { code: string }) => blocker.code)).toEqual(["WORKFLOW_AGENT_INACTIVE"])
    const agentOff = await admin.post(`${base}/${agentWorkflowId}/manual-runs`).send({ collaboratorId: operatorA.id, interactionId: callA, idempotencyKey: key() })
    expect([agentOff.status, agentOff.body.error.code]).toEqual([409, "WORKFLOW_AGENT_INACTIVE"])
    expect((await client.query("select count(*)::int n from workflow_enrollments where workflow_id = $1", [agentWorkflowId])).rows[0].n).toBe(0)

    // 5) Permissão: sem papel = 403; admin de outro Grupo não enxerga o Workflow (404).
    expect((await (await login(semPapel.email)).post(`${base}/${workflowId}/manual-runs`).send({ collaboratorId: operatorA.id, interactionId: callA, idempotencyKey: key() })).status).toBe(403)
    expect((await (await login(adminB.email)).post(`${base}/${workflowId}/manual-runs`).send({ collaboratorId: operatorB.id, interactionId: callB, idempotencyKey: key() })).status).toBe(404)

    // 6) Elegibilidade: só colaboradores da Abrangência do Workflow; fora dela = recusado mesmo para o admin geral.
    const collaborators = (await admin.get(`${base}/${workflowId}/manual-run/collaborators?search=Proof Manual`)).body.data
    expect(collaborators.items.map((item: { id: string }) => item.id)).toEqual([operatorA.id])
    const outOfScope = await admin.post(`${base}/${workflowId}/manual-runs`).send({ collaboratorId: operatorB.id, interactionId: callB, idempotencyKey: key() })
    expect(outOfScope.status).toBe(422)
    expect(outOfScope.body.error.code).toBe("WORKFLOW_MANUAL_RUN_COLLABORATOR_NOT_ELIGIBLE")

    // 7) Contexto: interação obrigatória, DO colaborador e com transcrição. A lista só oferece as válidas.
    const interactions = (await admin.get(`${base}/${workflowId}/manual-run/interactions?collaboratorId=${operatorA.id}`)).body.data
    expect(interactions.map((item: { id: string }) => item.id)).toEqual([callA])
    expect((await admin.post(`${base}/${workflowId}/manual-runs`).send({ collaboratorId: operatorA.id, idempotencyKey: key() })).body.error.code).toBe("WORKFLOW_MANUAL_RUN_CONTEXT_REQUIRED")
    expect((await admin.post(`${base}/${workflowId}/manual-runs`).send({ collaboratorId: operatorA.id, interactionId: callB, idempotencyKey: key() })).body.error.code).toBe("WORKFLOW_MANUAL_RUN_INTERACTION_INVALID")
    expect((await admin.post(`${base}/${workflowId}/manual-runs`).send({ collaboratorId: operatorA.id, interactionId: callANoTranscript, idempotencyKey: key() })).body.error.code).toBe("WORKFLOW_MANUAL_RUN_INTERACTION_INVALID")
    expect((await admin.post(`${base}/${workflowId}/manual-runs`).send({ collaboratorId: operatorA.id, indicatorMeasurementId: callA, interactionId: callA, idempotencyKey: key() })).body.error.code).toBe("WORKFLOW_MANUAL_RUN_CONTEXT_UNEXPECTED")
    expect((await client.query("select count(*)::int n from workflow_manual_runs where workflow_id = $1", [workflowId])).rows[0].n).toBe(0)

    // 8) Disparo válido: matrícula NORMAL no Gatilho, versão publicada pinada, interação real, origem manual + auditoria.
    const k1 = key()
    const first = await admin.post(`${base}/${workflowId}/manual-runs`).send({ collaboratorId: operatorA.id, interactionId: callA, idempotencyKey: k1 })
    expect(first.status).toBe(201)
    expect(first.body.data).toMatchObject({ created: true, run: { context: "INTERACTION", versionId, versionNumber: 1, collaborator: { id: operatorA.id }, interaction: { id: callA }, execution: { stage: "QUEUED", status: "active" }, deliveries: [] } })
    const runId = first.body.data.run.id as string
    const enrollment = (await client.query<{ id: string; interaction_id: string; scheduled_subject_id: string | null; version_id: string; current_node_id: string; status: string; manual_run_id: string }>(
      "select id, interaction_id, scheduled_subject_id, version_id, current_node_id, status, manual_run_id from workflow_enrollments where workflow_id = $1", [workflowId],
    )).rows
    expect(enrollment).toHaveLength(1)
    expect(enrollment[0]).toMatchObject({ interaction_id: callA, scheduled_subject_id: null, version_id: versionId, current_node_id: "trigger", status: "active", manual_run_id: runId })
    expect((await client.query("select requested_by, collaborator_id, interaction_id, context from workflow_manual_runs where id = $1", [runId])).rows[0]).toEqual({ requested_by: geral.id, collaborator_id: operatorA.id, interaction_id: callA, context: "INTERACTION" })
    expect((await client.query("select action, actor_id from audit_logs where entity_id = $1", [runId])).rows).toEqual([{ action: "WORKFLOW_MANUAL_RUN_REQUESTED", actor_id: geral.id }])

    // 9) Duplo clique / reenvio (mesma chave) = o MESMO disparo; mesma chave com outro contexto = conflito.
    const again = await admin.post(`${base}/${workflowId}/manual-runs`).send({ collaboratorId: operatorA.id, interactionId: callA, idempotencyKey: k1 })
    expect(again.status).toBe(200)
    expect(again.body.data).toMatchObject({ created: false, run: { id: runId } })
    const reused = await admin.post(`${base}/${workflowId}/manual-runs`).send({ collaboratorId: operatorA.id, interactionId: callANoTranscript, idempotencyKey: k1 })
    expect(reused.body.error.code).toBe("WORKFLOW_MANUAL_RUN_IDEMPOTENCY_CONFLICT")
    expect((await client.query("select count(*)::int n from workflow_enrollments where workflow_id = $1", [workflowId])).rows[0].n).toBe(1)

    // 10) Novo disparo INTENCIONAL (chave nova) = nova execução para repetir a demonstração.
    const second = await admin.post(`${base}/${workflowId}/manual-runs`).send({ collaboratorId: operatorA.id, interactionId: callA, idempotencyKey: key() })
    expect(second.status).toBe(201)
    expect(second.body.data.run.id).not.toBe(runId)
    expect((await client.query("select count(*)::int n from workflow_enrollments where workflow_id = $1", [workflowId])).rows[0].n).toBe(2)

    // 11) O MOTOR processa a matrícula (mesmo processEnrollment do tick): Gatilho → Fim = concluída.
    const claim = async (id: string) =>
      (await client.query<ClaimedRow>(
        `select we.id, we.organization_id, we.workflow_id, we.version_id, we.interaction_id, we.indicator_measurement_id, we.scheduled_subject_id, we.scheduled_for, we.current_node_id,
                we.matched_flag_name, we.matched_value_boolean, we.matched_value_numeric, we.status, we.attempts, we.revision, we.node_outputs, we.variables, we.parent_enrollment_id,
                w.scope_type, w.team_id workflow_team_id, w.subteam_id workflow_subteam_id, w.consolidated_structure, w.population_filter, now()::text claimed_until
           from workflow_enrollments we join workflows w on w.id = we.workflow_id where we.id = $1`,
        [id],
      )).rows[0]!
    const enrollmentId = enrollment[0]!.id
    await processEnrollment(client as never, await claim(enrollmentId))
    await processEnrollment(client as never, await claim(enrollmentId))
    const done = (await admin.get(`${base}/${workflowId}/manual-runs/${runId}`)).body.data
    expect(done.execution).toMatchObject({ stage: "COMPLETED", status: "completed" })
    const eventTypes = done.execution.events.map((event: { eventType: string }) => event.eventType) as string[]
    expect(eventTypes[0]).toBe("manual_run_requested")
    expect([...eventTypes].sort()).toEqual(["flow_completed", "manual_run_requested", "node_advanced"])

    // 12) Origem manual visível em Execuções e em Resultados (mesmo com interação associada).
    const executions = (await admin.get(`${base}/${workflowId}/enrollments`)).body.data.items as { id: string; manualRun: { requestedByName: string; collaboratorName: string } | null }[]
    expect(executions.find((item) => item.id === enrollmentId)!.manualRun).toMatchObject({ requestedByName: "Proof Manual OPERATOR 1", collaboratorName: "Proof Manual OPERATOR 4" })
    const results = (await admin.get(`${base}/${workflowId}/results?page=1&pageSize=10`)).body.data
    expect(results.items[0].trigger).toEqual({ kind: "MANUAL", label: "Manual: por Proof Manual OPERATOR 1" })

    // 13) Ingestão NUNCA dispara um Manual (mesmo com contexto de medição do mesmo indicador).
    const indicatorCode = `PROOF_MANUAL_${Date.now()}`
    const indicatorId = (await client.query<{ id: string }>("insert into indicator_definitions (organization_id, code, name, unit, desired_direction) values ($1, $2, 'Proof Manual Indicador', 'SECONDS', 'LOWER') returning id", [ORG, indicatorCode])).rows[0]!.id
    const measurementWorkflow = await admin.post(base).send({ name: "Proof Manual Medição", scopeType: "TEAM", teamId: teamA, trigger: { kind: "manual", context: "INDICATOR_MEASUREMENT", indicatorCode } })
    expect(measurementWorkflow.body.data.trigger).toMatchObject({ kind: "manual", context: "INDICATOR_MEASUREMENT", indicatorCode })
    const measurementWorkflowId = measurementWorkflow.body.data.id as string
    await admin.put(`${base}/${measurementWorkflowId}/draft`).send({ graph })
    await publish(measurementWorkflowId)
    const measurement = (await client.query<{ id: string }>(
      "insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity) values ($1, $2, 'PERSON', $3, 480, now() - interval '2 days', now() - interval '1 day', 'PROOF', 'DAILY') returning id",
      [ORG, indicatorId, operatorA.id],
    )).rows[0]!.id
    expect(await enrollIndicatorWorkflows(client, { organizationId: ORG, measurementId: measurement, operatorId: operatorA.id, indicatorCode, value: 480 })).toBe(0)
    expect((await admin.get(`${base}/${measurementWorkflowId}/manual-run/measurements?collaboratorId=${operatorA.id}`)).body.data.map((item: { id: string }) => item.id)).toEqual([measurement])
    const byMeasurement = await admin.post(`${base}/${measurementWorkflowId}/manual-runs`).send({ collaboratorId: operatorA.id, indicatorMeasurementId: measurement, idempotencyKey: key() })
    expect(byMeasurement.status).toBe(201)
    expect((await client.query("select indicator_measurement_id, matched_value_numeric::int v from workflow_enrollments where workflow_id = $1", [measurementWorkflowId])).rows).toEqual([{ indicator_measurement_id: measurement, v: 480 }])
  })

  it("duplo clique SIMULTÂNEO (duas conexões, mesma chave) = exatamente uma execução; dados gravados e apagados", async () => {
    const fixture = { people: [] as string[], workflows: [] as string[] }
    try {
      // Cada id entra na limpeza assim que nasce: uma falha no meio não deixa resíduo no banco de teste.
      const requester = (await pool.query<{ id: string }>("insert into people (organization_id, name, role) values ($1, 'Proof Manual Concorrência Admin', 'SUPERVISOR') returning id", [ORG])).rows[0]!.id
      fixture.people.push(requester)
      const operator = (await pool.query<{ id: string }>("insert into people (organization_id, name, role) values ($1, 'Proof Manual Concorrência Operador', 'OPERATOR') returning id", [ORG])).rows[0]!.id
      fixture.people.push(operator)
      const graph = { nodes: [{ id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} }, { id: "end", type: "end", label: "Fim", position: { x: 0, y: 0 }, config: {} }], edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "end" }] }
      const workflowId = (await pool.query<{ id: string }>(`insert into workflows (organization_id, name, trigger_config, draft_graph) values ($1, 'Proof Manual Concorrência', '{"kind":"manual","context":"COLLABORATOR"}', $2) returning id`, [ORG, JSON.stringify(graph)])).rows[0]!.id
      fixture.workflows.push(workflowId)
      const versionId = (await pool.query<{ id: string }>("insert into workflow_versions (workflow_id, graph) values ($1, $2) returning id", [workflowId, JSON.stringify(graph)])).rows[0]!.id
      await pool.query("update workflows set active = true, active_version_id = $2 where id = $1", [workflowId, versionId])
      const request = { organizationId: ORG, workflowId, requestedBy: requester, collaboratorId: operator, idempotencyKey: `proof-concurrent-${Date.now()}` }
      const results = await Promise.all([1, 2, 3].map(() => requestManualRun(pool as never, request, () => true)))
      expect(results.filter((result) => result.created)).toHaveLength(1)
      expect(new Set(results.map((result) => result.runId)).size).toBe(1)
      expect((await pool.query("select count(*)::int n from workflow_enrollments where workflow_id = $1", [workflowId])).rows[0].n).toBe(1)
      const next = await requestManualRun(pool as never, { ...request, idempotencyKey: `proof-concurrent-new-${Date.now()}` }, () => true)
      expect(next.created).toBe(true)
      expect((await pool.query("select count(*)::int n, count(scheduled_subject_id)::int subjects, count(scheduled_for)::int scheduled from workflow_enrollments where workflow_id = $1", [workflowId])).rows[0]).toEqual({ n: 2, subjects: 2, scheduled: 0 })
    } finally {
      const runs = (await pool.query<{ id: string }>("select id from workflow_manual_runs where workflow_id = any($1::uuid[])", [fixture.workflows])).rows.map((row) => row.id)
      await pool.query("delete from audit_logs where entity_id = any($1::uuid[])", [runs])
      await pool.query("delete from workflow_enrollment_events where enrollment_id in (select id from workflow_enrollments where workflow_id = any($1::uuid[]))", [fixture.workflows])
      await pool.query("delete from workflow_enrollments where workflow_id = any($1::uuid[])", [fixture.workflows])
      await pool.query("delete from workflow_manual_runs where workflow_id = any($1::uuid[])", [fixture.workflows])
      await pool.query("update workflows set active_version_id = null where id = any($1::uuid[])", [fixture.workflows])
      await pool.query("delete from workflow_versions where workflow_id = any($1::uuid[])", [fixture.workflows])
      await pool.query("delete from workflows where id = any($1::uuid[])", [fixture.workflows])
      await pool.query("delete from people where id = any($1::uuid[])", [fixture.people])
    }
  })
})
