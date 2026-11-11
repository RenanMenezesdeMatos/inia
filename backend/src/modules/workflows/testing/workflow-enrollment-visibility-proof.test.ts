/**
 * PROVA contra o banco de TESTE real — Execuções de um Workflow só para quem alcança a PESSOA da execução (achado da auditoria
 * run-2, `enrollment-visibility.ts`). Autorizar o Workflow pela Abrangência PUBLICADA não basta: depois de mover o Workflow de
 * Grupo (rascunho + Publicar) ou de a pessoa trocar de Grupo, o administrador do Grupo novo não lê — nem aciona — as execuções
 * de quem está fora do escopo dele; a aba Resultados já escondia essas pessoas e as duas leituras agora concordam.
 * Pela API real (login, rotas de Execuções e do "Executar agora") numa transação desfeita no fim. ZERO chamada de modelo.
 *   INIA_DB_PROOF=1 npx vitest run workflow-enrollment-visibility-proof
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type pg from "pg"
import { loadResultsPage } from "../application/workflow-results-reader.js"
import { getManageableScopes } from "../../auth/application/manageable-scopes.js"
import { closeProofTransaction, openProofTransaction, createAccount, createPerson, createTeam, insertEnrollment, insertLiveWorkflow, loginAs, ORG, triggerNode, endNode, flowEdge, type ProofClient } from "./p5-proof-helpers.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const MARKER = "MARCADOR-PROVA-GRUPO-A"
const GRAPH = { nodes: [triggerNode, endNode], edges: [flowEdge("trigger", "always", "end")] }

describe.skipIf(!ENABLED)("Execuções do Workflow — escopo pela pessoa da execução (prova Postgres, zero modelo)", () => {
  let pool: pg.Pool | undefined
  let client: ProofClient | undefined
  beforeEach(async () => {
    ;({ pool, client } = await openProofTransaction())
  })
  afterEach(async () => {
    await closeProofTransaction(pool, client)
    pool = undefined
    client = undefined
  })

  it("Workflow movido do Grupo A para o B e pessoa que trocou de Grupo: o administrador do Grupo B não lê nem aciona a execução de quem é do Grupo A", async () => {
    const db = client!
    const teamA = await createTeam(db, "Prova Visibilidade Grupo A")
    const teamB = await createTeam(db, "Prova Visibilidade Grupo B")
    const operator = async (name: string, teamId: string) => {
      const id = await createPerson(db, name)
      await db.query("update people set team_id = $2 where id = $1", [id, teamId])
      return id
    }
    const operatorA = await operator("Prova Visibilidade Operador A", teamA)
    const operatorB = await operator("Prova Visibilidade Operador B", teamB)
    const adminBPerson = await createPerson(db, "Prova Visibilidade Admin B", { role: "SUPERVISOR" })
    const adminB = await createAccount(db, adminBPerson, [{ role: "ADMINISTRADOR", scopeType: "GROUP", teamId: teamB }])
    const geralPerson = await createPerson(db, "Prova Visibilidade Admin Geral", { role: "SUPERVISOR" })
    const geral = await createAccount(db, geralPerson, [{ role: "ADMINISTRADOR_GERAL", scopeType: "ORGANIZATION" }])

    // Workflow publicado no Grupo A, com uma execução sobre o operador A: saída do agente e do nó com o marcador.
    const workflow = await insertLiveWorkflow(db, "Prova Visibilidade WF", GRAPH, { teamId: teamA, publisherId: geralPerson })
    const enrollmentA = await insertEnrollment(db, workflow, { nodeId: "end", subjectId: operatorA, status: "waiting" })
    const agentId = (await db.query<{ id: string }>("insert into agents (organization_id, name, agent_type, objective, description, context_prompt, active) values ($1, 'Prova Visibilidade Agente', 'CUSTOM', 'Avaliar', 'Prova', 'Avalie.', true) returning id", [ORG])).rows[0]!.id
    const runId = (await db.query<{ id: string }>("insert into agent_runs (organization_id, agent_id, source, input_context, output_text, status) values ($1, $2, 'WORKFLOW', $3, $3, 'COMPLETED') returning id", [ORG, agentId, `${MARKER} saída do agente`])).rows[0]!.id
    await db.query("insert into workflow_enrollment_events (enrollment_id, node_id, event_type, payload, idempotency_key, agent_run_id) values ($1, 'agent', 'action_executed', $2, $3, $4)", [enrollmentA, JSON.stringify({ nodeOutput: `${MARKER} saída do nó` }), `prova-visibilidade-${enrollmentA}`, runId])

    const base = `/api/v1/admin/workflows/${workflow.workflowId}`
    const httpB = await loginAs(db, adminB.email)
    const httpGeral = await loginAs(db, geral.email)
    const scopesB = await getManageableScopes(db as never, { organizationId: ORG, sub: adminB.accountId }, "workflows.manage")
    const resultsTotal = async () => (await loadResultsPage(db as never, ORG, workflow.workflowId, scopesB, { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) }, 1, 50)).total

    // Antes de mover: o Workflow é do Grupo A — o administrador do B nem o enxerga.
    expect((await httpB.get(`${base}/enrollments`)).status).toBe(404)

    // Movido para o Grupo B (estado que rascunho + Publicar produz): o B passa a administrar o Workflow…
    await db.query("update workflows set scope_type = 'TEAM', team_id = $2, draft_scope_type = 'TEAM', draft_team_id = $2 where id = $1", [workflow.workflowId, teamB])
    const list = await httpB.get(`${base}/enrollments`)
    expect(list.status).toBe(200)
    // …mas a execução sobre o operador do Grupo A não sai, nem com o marcador — a mesma resposta da aba Resultados.
    expect(list.body.data.items).toEqual([])
    expect(JSON.stringify(list.body)).not.toContain(MARKER)
    expect(await resultsTotal()).toBe(0)
    const records = await httpB.get(`${base}/enrollments/${enrollmentA}/agent-records`)
    expect(records.status).toBe(404)
    expect(JSON.stringify(records.body)).not.toContain(MARKER)
    expect((await httpB.get(`${base}/enrollments/${enrollmentA}/retry`)).status).toBe(404)
    expect((await httpB.post(`${base}/enrollments/${enrollmentA}/retry`).send({ fingerprint: "impressao-digital-qualquer" })).status).toBe(404)
    expect((await httpB.post(`${base}/enrollments/${enrollmentA}/decision`).send({ nodeId: "end", decision: "approved" })).status).toBe(404)
    expect((await db.query("select count(*)::int n from workflow_enrollments where retry_of_enrollment_id = $1", [enrollmentA])).rows[0].n).toBe(0)
    expect((await db.query<{ status: string }>("select status from workflow_enrollments where id = $1", [enrollmentA])).rows[0]!.status).toBe("waiting")

    // Quem alcança a organização continua vendo tudo.
    const geralList = await httpGeral.get(`${base}/enrollments`)
    expect(geralList.body.data.items.map((row: { id: string }) => row.id)).toEqual([enrollmentA])
    expect(JSON.stringify(geralList.body)).toContain(MARKER)
    expect((await httpGeral.get(`${base}/enrollments/${enrollmentA}/agent-records`)).body.data[0].outputText).toContain(MARKER)

    // "Executar agora": o disparo manual para o operador do Grupo A também some da trilha e do detalhe para o B.
    const manualRun = (await db.query<{ id: string }>(
      "insert into workflow_manual_runs (organization_id, workflow_id, version_id, requested_by, idempotency_key, context, collaborator_id) values ($1, $2, $3, $4, $5, 'COLLABORATOR', $6) returning id",
      [ORG, workflow.workflowId, workflow.versionId, geralPerson, `prova-visibilidade-${enrollmentA}`, operatorA],
    )).rows[0]!.id
    await db.query("update workflow_enrollments set manual_run_id = $2 where id = $1", [enrollmentA, manualRun])
    expect((await httpB.get(`${base}/manual-run`)).body.data.recentRuns).toEqual([])
    expect((await httpB.get(`${base}/manual-runs/${manualRun}`)).status).toBe(404)
    expect((await httpGeral.get(`${base}/manual-run`)).body.data.recentRuns.map((run: { id: string }) => run.id)).toEqual([manualRun])
    expect((await httpGeral.get(`${base}/manual-runs/${manualRun}`)).status).toBe(200)

    // Variante: execução sobre o operador do Grupo B — visível ao B; depois que ele vai para o Grupo A, some das duas leituras.
    const enrollmentB = await insertEnrollment(db, workflow, { nodeId: "end", subjectId: operatorB })
    expect((await httpB.get(`${base}/enrollments`)).body.data.items.map((row: { id: string }) => row.id)).toEqual([enrollmentB])
    expect((await httpB.get(`${base}/enrollments/${enrollmentB}/agent-records`)).status).toBe(200)
    await db.query("update people set team_id = $2 where id = $1", [operatorB, teamA])
    expect((await httpB.get(`${base}/enrollments`)).body.data.items).toEqual([])
    expect((await httpB.get(`${base}/enrollments/${enrollmentB}/agent-records`)).status).toBe(404)
    expect(await resultsTotal()).toBe(0)

    // Execução sem pessoa (medição de um Grupo, não de uma PESSOA): vale a Abrangência da VERSÃO que rodou (Grupo A) — falha
    // fechada para o B; versão sem Abrangência gravada (anterior à migration 144) só para quem alcança a organização.
    const definitionId = (await db.query<{ id: string }>("select id from indicator_definitions where organization_id = $1 limit 1", [ORG])).rows[0]!.id
    const teamMeasurement = (await db.query<{ id: string }>(
      "insert into indicator_measurements_all (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source) values ($1, $2, 'TEAM', $3, 1, now() - interval '1 day', now(), 'PROOF') returning id",
      [ORG, definitionId, teamA],
    )).rows[0]!.id
    const rootless = (await db.query<{ id: string }>(
      "insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, indicator_measurement_id) values ($1, $2, $3, 'end', 'completed', now(), $4) returning id",
      [ORG, workflow.workflowId, workflow.versionId, teamMeasurement],
    )).rows[0]!.id
    expect((await httpB.get(`${base}/enrollments/${rootless}/agent-records`)).status).toBe(404)
    await db.query("update workflow_versions set team_id = $2 where id = $1", [workflow.versionId, teamB])
    expect((await httpB.get(`${base}/enrollments/${rootless}/agent-records`)).status).toBe(200)
    await db.query("update workflow_versions set scope_type = null, team_id = null where id = $1", [workflow.versionId])
    expect((await httpB.get(`${base}/enrollments/${rootless}/agent-records`)).status).toBe(404)
    expect((await httpGeral.get(`${base}/enrollments/${rootless}/agent-records`)).status).toBe(200)
  })
})
