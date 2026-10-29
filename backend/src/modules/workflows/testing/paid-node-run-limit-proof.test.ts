/**
 * PROVA contra o banco de TESTE real (achado C06 da 4ª auditoria): ciclo de Workflow não gasta IA sem limite.
 *   A) o mesmo nó que chama a IA roda no máximo `WORKFLOW_MAX_PAID_NODE_RUNS` vezes por execução — contado no banco (eventos), o
 *      que vale com vários workers e depois de reiniciar; no limite a execução é encerrada SEM rodar o nó;
 *   B) abaixo do limite o nó roda normalmente (aqui ele falha por não achar o agente — nenhuma chamada de modelo);
 *   C) Workflow desativado não tem execução reivindicada; reativado, ela segue de onde parou.
 * ZERO chamada de modelo; organização própria, apagada no fim.
 *   INIA_DB_PROOF=1 npx vitest run paid-node-run-limit-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { runWorkflowTick } from "../application/engine.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "de00ee00-0000-4000-8000-00000000c061"
const MISSING_AGENT = "de00ee00-0000-4000-8000-00000000c069"

let pool: pg.Pool
let workflowId = ""
let versionId = ""
let operatorId = ""

const node = (id: string, type: string, label: string, config: Record<string, unknown> = {}) => ({ id, type, label, position: { x: 0, y: 0 }, config })
// O ciclo "Reprovado → refazer" sem Espera que a publicação agora recusa — gravado direto na versão, como um Workflow publicado antes.
const GRAPH = {
  nodes: [node("trigger", "trigger", "Gatilho"), node("agent", "action", "Chamar agente", { actionType: "CALL_AGENT", agentId: MISSING_AGENT }), node("review", "human_review", "Revisão", { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, contentSource: "nodeOutputs.agent" }), node("end", "end", "Fim")],
  edges: [
    { id: "e1", source: "trigger", sourceHandle: "always", target: "agent" },
    { id: "e2", source: "agent", sourceHandle: "always", target: "review" },
    { id: "e3", source: "review", sourceHandle: "approved", target: "end" },
    { id: "e4", source: "review", sourceHandle: "rejected", target: "agent" },
    { id: "e5", source: "review", sourceHandle: "escalated", target: "end" },
  ],
}

async function enrollAt(nodeId: string, previousAgentRuns: number): Promise<string> {
  const id = (await pool.query<{ id: string }>(
    "insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, scheduled_subject_id) values ($1, $2, $3, $4, 'active', now(), $5) returning id",
    [ORG, workflowId, versionId, nodeId, operatorId],
  )).rows[0]!.id
  for (let lap = 1; lap <= previousAgentRuns; lap += 1) {
    await pool.query("insert into workflow_enrollment_events (enrollment_id, node_id, event_type, payload, idempotency_key) values ($1, 'agent', 'action_executed', '{}', $2)", [id, `agent:${lap}`])
  }
  return id
}

const lastEvent = async (enrollmentId: string) =>
  (await pool.query<{ event_type: string; payload: { errorCode?: string; message?: string } }>("select event_type, payload from workflow_enrollment_events where enrollment_id = $1 order by created_at desc, id desc limit 1", [enrollmentId])).rows[0]!
const statusOf = async (enrollmentId: string) => (await pool.query<{ status: string; current_node_id: string }>("select status, current_node_id from workflow_enrollments where id = $1", [enrollmentId])).rows[0]!
const tick = (enrollmentId: string) => runWorkflowTick(pool as unknown as Database, { enrollmentIds: [enrollmentId] })

describe.skipIf(!ENABLED)("Motor de Workflow — teto de execuções do nó que chama a IA (C06)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 3 })
    await cleanup()
    await pool.query("insert into organizations (id, name, slug) values ($1, 'Proof C06', 'proof-c06')", [ORG])
    operatorId = (await pool.query<{ id: string }>("insert into people (organization_id, name, role) values ($1, 'Proof C06 Operador', 'OPERATOR') returning id", [ORG])).rows[0]!.id
    workflowId = (await pool.query<{ id: string }>(`insert into workflows (organization_id, name, trigger_config, draft_graph) values ($1, 'Proof C06 ciclo', '{"kind":"manual","context":"COLLABORATOR"}', $2) returning id`, [ORG, JSON.stringify(GRAPH)])).rows[0]!.id
    versionId = (await pool.query<{ id: string }>("insert into workflow_versions (workflow_id, graph) values ($1, $2) returning id", [workflowId, JSON.stringify(GRAPH)])).rows[0]!.id
    await pool.query("update workflows set active = true, active_version_id = $2 where id = $1", [workflowId, versionId])
  }, 60_000)

  afterAll(async () => {
    if (!pool) return
    await cleanup()
    await pool.end()
  })

  async function cleanup() {
    await pool.query("delete from workflow_enrollment_events where enrollment_id in (select id from workflow_enrollments where organization_id = $1)", [ORG])
    await pool.query("delete from workflow_enrollments where organization_id = $1", [ORG])
    await pool.query("update workflows set active_version_id = null where organization_id = $1", [ORG])
    await pool.query("delete from workflow_versions where workflow_id in (select id from workflows where organization_id = $1)", [ORG])
    await pool.query("delete from workflows where organization_id = $1", [ORG])
    await pool.query("delete from audit_logs where organization_id = $1", [ORG])
    await pool.query("delete from people where organization_id = $1", [ORG])
    await pool.query("delete from organizations where id = $1", [ORG])
  }

  it(`A) com ${env.WORKFLOW_MAX_PAID_NODE_RUNS} execuções do agente gravadas, a próxima volta encerra a execução sem rodar o nó`, async () => {
    const enrollmentId = await enrollAt("agent", env.WORKFLOW_MAX_PAID_NODE_RUNS)
    expect(await tick(enrollmentId)).toEqual({ processed: 1 })
    expect(await statusOf(enrollmentId)).toEqual({ status: "dead", current_node_id: "agent" })
    const event = await lastEvent(enrollmentId)
    expect(event.event_type).toBe("flow_dead")
    expect(event.payload.errorCode).toBe("WORKFLOW_PAID_NODE_RUN_LIMIT")
    expect(event.payload.message).toContain(`limite: ${env.WORKFLOW_MAX_PAID_NODE_RUNS}`)
  })

  it("B) abaixo do limite o nó roda (falhas e esperas anteriores não contam como execução)", async () => {
    const enrollmentId = await enrollAt("agent", env.WORKFLOW_MAX_PAID_NODE_RUNS - 1)
    for (const [type, key] of [["node_failed", "agent:failed"], ["wait_started", "agent:wait-1"], ["wait_started", "agent:wait-2"]]) {
      await pool.query("insert into workflow_enrollment_events (enrollment_id, node_id, event_type, payload, idempotency_key) values ($1, 'agent', $2, '{}', $3)", [enrollmentId, type, key])
    }
    expect(await tick(enrollmentId)).toEqual({ processed: 1 })
    const event = await lastEvent(enrollmentId)
    // O nó rodou de verdade: o erro é o do próprio "Chamar agente" (agente inexistente), não o teto.
    expect(["node_failed", "flow_dead"]).toContain(event.event_type)
    expect(event.payload.errorCode).not.toBe("WORKFLOW_PAID_NODE_RUN_LIMIT")
  })

  it("C) Workflow desativado: a execução não é reivindicada; reativado, segue de onde parou", async () => {
    const enrollmentId = await enrollAt("trigger", 0)
    await pool.query("update workflows set active = false where id = $1", [workflowId])
    try {
      expect(await tick(enrollmentId)).toEqual({ processed: 0 })
      expect(await statusOf(enrollmentId)).toEqual({ status: "active", current_node_id: "trigger" })
    } finally {
      await pool.query("update workflows set active = true where id = $1", [workflowId])
    }
    expect(await tick(enrollmentId)).toEqual({ processed: 1 })
    expect((await statusOf(enrollmentId)).current_node_id).toBe("agent")
  })
})
