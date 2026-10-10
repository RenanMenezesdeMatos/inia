/**
 * PROVA contra o banco de TESTE real — concorrência do motor de Workflow. Caso real (dev, 2026-10-05): uma investigação de
 * indicador de ~12 min rodou três vezes em paralelo porque a lease de 120 s vencia no meio do nó e o tick seguinte
 * reivindicava a mesma matrícula; e o tick sequencial deixava qualquer outro workflow esperando atrás dela. Aqui o motor
 * real (claim com skip locked + rodízio entre workflows, compare-and-swap da posse com heartbeat, applyOutcome) roda sobre o
 * Postgres com lease de 1 s e nós segurados por um portão (o handler real do nó roda depois dele). Prova que:
 *   A) um nó que dura várias leases não roda duas vezes, mesmo com passadas concorrentes;
 *   B) um worker morto — antes ou no meio do nó — é recuperado quando a lease vence;
 *   C) com o worker contínuo, um workflow lento não segura outro: o outro vai até o fim enquanto o lento roda;
 *   D) rodízio pelo SQL real: um workflow com muitas matrículas ocupa no máximo metade das vagas;
 *   E) duas instâncias do worker no mesmo banco processam cada nó de cada matrícula exatamente uma vez.
 * ZERO chamada de modelo; dados gravados e apagados.
 *   INIA_DB_PROOF=1 npx vitest run workflow-engine-concurrency-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import type * as NodeHandlers from "../application/node-handlers.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const LEASE_SECONDS = 1
const SCENARIO_TIMEOUT_MS = 20_000

/**
 * O PRIMEIRO processamento de cada matrícula com portão espera até ele abrir; os seguintes passam direto. `delayMs` segura
 * todo nó por um tempo fixo; `active`/`maxActive` medem quantos nós rodaram ao mesmo tempo.
 */
const control = vi.hoisted(() => ({ gates: new Map<string, Promise<void>>(), runs: [] as string[], delayMs: 0, active: 0, maxActive: 0 }))
vi.mock("../application/node-handlers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeHandlers>()
  return {
    ...actual,
    processNode: async (context: NodeHandlers.ProcessContext, node: Parameters<typeof actual.processNode>[1]) => {
      control.runs.push(`${context.enrollment.id}:${node.id}`)
      control.active++
      control.maxActive = Math.max(control.maxActive, control.active)
      try {
        const gate = control.gates.get(context.enrollment.id)
        control.gates.delete(context.enrollment.id)
        await gate
        if (control.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, control.delayMs))
      } finally {
        control.active--
      }
      return actual.processNode(context, node)
    },
  }
})

const { runWorkflowTick } = await import("../application/engine.js")
const { startWorkflowWorker } = await import("../application/workflow-worker.js")

let pool: pg.Pool
const fixture = { people: [] as string[], workflows: [] as string[] }
const workflows: Record<"A" | "B", { id: string; versionId: string }> = { A: { id: "", versionId: "" }, B: { id: "", versionId: "" } }
let operatorId = ""

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
function gate(enrollmentId: string) {
  let open!: () => void
  control.gates.set(enrollmentId, new Promise<void>((resolve) => (open = resolve)))
  return open
}
const runsOf = (enrollmentId: string) => control.runs.filter((run) => run.startsWith(`${enrollmentId}:`)).map((run) => run.slice(enrollmentId.length + 1))
async function untilRunning(enrollmentId: string) {
  for (let i = 0; i < 100 && runsOf(enrollmentId).length === 0; i++) await sleep(50)
  expect(runsOf(enrollmentId)).toEqual(["trigger"])
}
async function enroll(workflow: "A" | "B" = "A"): Promise<string> {
  return (await pool.query<{ id: string }>(
    "insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, scheduled_subject_id) values ($1, $2, $3, 'trigger', 'active', now(), $4) returning id",
    [ORG, workflows[workflow].id, workflows[workflow].versionId, operatorId],
  )).rows[0]!.id
}
async function until(check: () => Promise<boolean>, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condição não atingida no prazo")
    await sleep(50)
  }
}
const completed = async (ids: string[]) => (await pool.query<{ n: number }>("select count(*)::int n from workflow_enrollments where id = any($1::uuid[]) and status = 'completed'", [ids])).rows[0]!.n === ids.length
async function state(enrollmentId: string) {
  return (await pool.query<{ current_node_id: string; status: string; revision: number; claimed: boolean; live: boolean }>(
    "select current_node_id, status, revision, claimed_until is not null claimed, coalesce(claimed_until > now(), false) live from workflow_enrollments where id = $1",
    [enrollmentId],
  )).rows[0]!
}
const tick = (enrollmentId: string, db: Database = pool) => runWorkflowTick(db, { enrollmentIds: [enrollmentId], leaseSeconds: LEASE_SECONDS })

describe.skipIf(!ENABLED)("Motor de Workflow — concorrência e posse da matrícula (prova Postgres, workers reais)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    operatorId = (await pool.query<{ id: string }>("insert into people (organization_id, name, role) values ($1, 'Proof Concorrência Operador', 'OPERATOR') returning id", [ORG])).rows[0]!.id
    fixture.people.push(operatorId)
    const graph = { nodes: [{ id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} }, { id: "end", type: "end", label: "Fim", position: { x: 0, y: 160 }, config: {} }], edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "end" }] }
    for (const key of ["A", "B"] as const) {
      const id = (await pool.query<{ id: string }>(`insert into workflows (organization_id, name, trigger_config, draft_graph) values ($1, $2, '{"kind":"manual","context":"COLLABORATOR"}', $3) returning id`, [ORG, `Proof Concorrência ${key}`, JSON.stringify(graph)])).rows[0]!.id
      fixture.workflows.push(id)
      const versionId = (await pool.query<{ id: string }>("insert into workflow_versions (workflow_id, graph) values ($1, $2) returning id", [id, JSON.stringify(graph)])).rows[0]!.id
      await pool.query("update workflows set active = true, active_version_id = $2 where id = $1", [id, versionId])
      workflows[key] = { id, versionId }
    }
  })
  afterAll(async () => {
    if (!pool) return
    await pool.query("delete from workflow_enrollment_events where enrollment_id in (select id from workflow_enrollments where workflow_id = any($1::uuid[]))", [fixture.workflows])
    await pool.query("delete from workflow_enrollments where workflow_id = any($1::uuid[])", [fixture.workflows])
    await pool.query("update workflows set active_version_id = null where id = any($1::uuid[])", [fixture.workflows])
    await pool.query("delete from workflow_versions where workflow_id = any($1::uuid[])", [fixture.workflows])
    await pool.query("delete from workflows where id = any($1::uuid[])", [fixture.workflows])
    await pool.query("delete from people where id = any($1::uuid[])", [fixture.people])
    await pool.end()
  })

  it("A) nó que dura várias leases: ticks concorrentes nunca o executam de novo; ao terminar, a posse é liberada e não volta", async () => {
    const enrollmentId = await enroll()
    const open = gate(enrollmentId)
    const owner = tick(enrollmentId)
    await untilRunning(enrollmentId)

    // ~3,5 leases com o nó parado: o ticker do servidor e o pump (ticks em paralelo) encontram a posse viva.
    const deadline = Date.now() + 3_500
    while (Date.now() < deadline) {
      const results = await Promise.all([tick(enrollmentId), tick(enrollmentId)])
      expect(results).toEqual([{ processed: 0 }, { processed: 0 }])
      expect(await state(enrollmentId)).toMatchObject({ current_node_id: "trigger", live: true })
      await sleep(250)
    }
    expect(runsOf(enrollmentId)).toEqual(["trigger"])

    open()
    expect(await owner).toEqual({ processed: 1 })
    expect(await state(enrollmentId)).toEqual({ current_node_id: "end", status: "active", revision: 1, claimed: false, live: false })
    expect(runsOf(enrollmentId)).toEqual(["trigger"])

    // O heartbeat parou com o nó: depois de mais de uma lease ninguém regravou a posse, e o nó seguinte segue normal.
    await sleep(LEASE_SECONDS * 1_000 + 500)
    expect(await state(enrollmentId)).toMatchObject({ current_node_id: "end", claimed: false })
    expect(await tick(enrollmentId)).toEqual({ processed: 1 })
    expect(await state(enrollmentId)).toMatchObject({ status: "completed", revision: 2, claimed: false })
    expect(runsOf(enrollmentId)).toEqual(["trigger", "end"])
  }, SCENARIO_TIMEOUT_MS)

  it("B1) worker que reivindicou e morreu antes do nó: a matrícula fica presa só até a lease vencer", async () => {
    const enrollmentId = await enroll()
    await pool.query("update workflow_enrollments set claimed_until = now() + make_interval(secs => $2) where id = $1", [enrollmentId, LEASE_SECONDS])
    expect(await tick(enrollmentId)).toEqual({ processed: 0 })
    await sleep(LEASE_SECONDS * 1_000 + 300)
    expect(await tick(enrollmentId)).toEqual({ processed: 1 })
    expect(await state(enrollmentId)).toMatchObject({ current_node_id: "end", revision: 1, claimed: false })
    expect(runsOf(enrollmentId)).toEqual(["trigger"])
  }, SCENARIO_TIMEOUT_MS)

  it("B2) worker que morre NO MEIO do nó: as batidas param, a lease vence, outro tick refaz o nó e o morto não grava nada", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const enrollmentId = await enroll()
      let dead = false
      const query = (async (...args: Parameters<pg.Pool["query"]>) => (dead ? Promise.reject(new Error("worker morto")) : pool.query(...args))) as pg.Pool["query"]
      const deadWorker = { query, connect: () => pool.connect() } as Database
      const open = gate(enrollmentId)
      const deadTick = tick(enrollmentId, deadWorker).then(() => "concluiu", (error: Error) => error.message)
      await untilRunning(enrollmentId)
      dead = true

      expect(await tick(enrollmentId)).toEqual({ processed: 0 }) // a posse do morto ainda vale
      await sleep(LEASE_SECONDS * 1_000 + 500)
      expect(await tick(enrollmentId)).toEqual({ processed: 1 }) // venceu: recuperada pelo claim normal
      expect(await state(enrollmentId)).toMatchObject({ current_node_id: "end", revision: 1, claimed: false })
      expect(runsOf(enrollmentId)).toEqual(["trigger", "trigger"])
      expect(warn.mock.calls.some(([message]) => String(message).includes("workflow_enrollment_lease_heartbeat_failed"))).toBe(true)

      open()
      expect(await deadTick).toBe("worker morto")
      expect(await state(enrollmentId)).toMatchObject({ current_node_id: "end", revision: 1 })
    } finally {
      warn.mockRestore()
    }
  }, SCENARIO_TIMEOUT_MS)

  it("C) worker contínuo: o workflow lento ocupa uma vaga e o outro workflow vai até o fim enquanto ele roda", async () => {
    const slow = await enroll("A")
    const fast = await enroll("B")
    const open = gate(slow)
    const worker = startWorkflowWorker(pool, { enrollmentIds: [slow, fast], concurrency: 4, pollIntervalMs: 100, leaseSeconds: LEASE_SECONDS })
    try {
      await until(() => completed([fast]))
      expect(runsOf(fast)).toEqual(["trigger", "end"]) // os dois nós em sequência, sem esperar ticker
      expect(runsOf(slow)).toEqual(["trigger"])
      expect(await state(slow)).toMatchObject({ current_node_id: "trigger", live: true })

      await sleep(LEASE_SECONDS * 2_500) // várias leases com o nó lento parado: a posse continua viva, nada reexecuta
      expect(runsOf(slow)).toEqual(["trigger"])
      open()
      await until(() => completed([slow]))
      expect(runsOf(slow)).toEqual(["trigger", "end"])
    } finally {
      open() // falha no meio não pode deixar o nó preso no portão
      expect(await worker.stop(5_000)).toEqual({ abandoned: 0 })
    }
  }, SCENARIO_TIMEOUT_MS)

  it("D) rodízio pelo SQL real: 4 matrículas de um workflow + 1 de outro, 4 vagas → no máximo 2 do mesmo workflow, a outra entra já", async () => {
    const crowded = [await enroll("A"), await enroll("A"), await enroll("A"), await enroll("A")]
    const other = await enroll("B")
    const opens = [...crowded, other].map((id) => gate(id))
    const worker = startWorkflowWorker(pool, { enrollmentIds: [...crowded, other], concurrency: 4, pollIntervalMs: 100, leaseSeconds: LEASE_SECONDS })
    try {
      await until(async () => runsOf(other).length > 0 && crowded.filter((id) => runsOf(id).length > 0).length >= 2)
      await sleep(400) // mais varreduras: o limite por workflow continua valendo
      expect(runsOf(other)).toEqual(["trigger"])
      expect(crowded.filter((id) => runsOf(id).length > 0)).toHaveLength(2)
      expect(worker.running).toBe(3)

      for (const open of opens) open()
      await until(() => completed([...crowded, other]))
      for (const id of [...crowded, other]) expect(runsOf(id)).toEqual(["trigger", "end"])
    } finally {
      for (const open of opens) open()
      await worker.stop(5_000)
    }
  }, SCENARIO_TIMEOUT_MS)

  it("E) duas instâncias do worker no mesmo banco: cada nó de cada matrícula roda exatamente uma vez", async () => {
    const ids = [await enroll("A"), await enroll("B"), await enroll("A"), await enroll("B"), await enroll("A"), await enroll("B")]
    control.delayMs = 200
    control.maxActive = 0
    const instances = [1, 2].map(() => startWorkflowWorker(pool, { enrollmentIds: ids, concurrency: 2, pollIntervalMs: 50, leaseSeconds: LEASE_SECONDS }))
    try {
      await until(() => completed(ids), 15_000)
      for (const id of ids) expect(runsOf(id)).toEqual(["trigger", "end"])
      expect(control.maxActive).toBeGreaterThan(2) // as duas instâncias trabalharam ao mesmo tempo
      expect(control.maxActive).toBeLessThanOrEqual(4) // e nenhuma passou da própria concorrência
    } finally {
      control.delayMs = 0
      await Promise.all(instances.map((worker) => worker.stop(5_000)))
    }
  }, SCENARIO_TIMEOUT_MS)
})
