import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { FlowNode } from "../domain/graph-schema.js"
import type { NodeOutcome, ProcessContext } from "./node-handlers.js"

/**
 * Worker contínuo do motor: várias matrículas ao mesmo tempo, sem que uma execução longa segure as outras. Relógio falso e
 * um banco falso que emula o claim (vencida + livre, skip locked, rodízio entre workflows, exclusões), a posse (token) e a
 * aplicação do resultado com revisão otimista.
 */
type Behavior = (context: ProcessContext, node: FlowNode) => Promise<NodeOutcome>
const control = vi.hoisted(() => ({ behavior: null as null | ((context: unknown, node: unknown) => Promise<unknown>) }))
vi.mock("./node-handlers.js", () => ({ processNode: (context: unknown, node: unknown) => control.behavior!(context, node) }))

const { startWorkflowWorker } = await import("./workflow-worker.js")
const { signalWorkflowWork } = await import("./workflow-work-signal.js")

const GRAPH = { nodes: ["investigar", "gerar", "fim", "loop"].map((id) => ({ id, type: "end", label: id, config: {}, position: { x: 0, y: 0 } })), edges: [] }
const NEXT: Record<string, string> = { investigar: "gerar", gerar: "fim" }

type Enrollment = { id: string; workflowId: string; node: string; status: string; revision: number; nextEvalAt: number; claimedUntil: number | null }

function fakeDb(seed: { id: string; workflowId: string; node?: string; dueIn?: number }[], options: { failEventsFor?: string[] } = {}) {
  const enrollments = new Map<string, Enrollment>(
    seed.map((item) => [item.id, { id: item.id, workflowId: item.workflowId, node: item.node ?? "investigar", status: "active", revision: 0, nextEvalAt: Date.now() + (item.dueIn ?? 0), claimedUntil: null }]),
  )
  const tokenOf = (value: number | null) => (value === null ? null : new Date(value).toISOString())
  const rowOf = (e: Enrollment) => ({
    id: e.id, organization_id: "org-1", workflow_id: e.workflowId, version_id: "v-1", interaction_id: null, indicator_measurement_id: null, scheduled_subject_id: "op-1", scheduled_for: null,
    current_node_id: e.node, matched_flag_name: null, matched_value_boolean: null, matched_value_numeric: null, status: e.status, attempts: 0, revision: e.revision,
    node_outputs: {}, variables: {}, parent_enrollment_id: null, scope_type: "ALL_TEAMS", workflow_team_id: null, workflow_subteam_id: null, consolidated_structure: null, population_filter: null,
  })
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const now = Date.now()
    if (sql.includes("for update of we skip locked")) {
      const [limit, only, runningIds, runningCounts, perWorkflow, excluded] = params as [number, string[] | null, string[], number[], number, string[]]
      const running = new Map(runningIds.map((id, index) => [id, runningCounts[index]!]))
      const due = [...enrollments.values()]
        .filter((e) => ["active", "waiting"].includes(e.status) && e.nextEvalAt <= now && (e.claimedUntil === null || e.claimedUntil < now))
        .filter((e) => (only === null || only.includes(e.id)) && !excluded.includes(e.id))
        .sort((a, b) => a.nextEvalAt - b.nextEvalAt || a.id.localeCompare(b.id))
      const positions = new Map<string, number>()
      const ranked = due.map((e) => {
        const position = (positions.get(e.workflowId) ?? 0) + 1
        positions.set(e.workflowId, position)
        return { e, position }
      })
      const picked = ranked
        .filter(({ e, position }) => position + (running.get(e.workflowId) ?? 0) <= perWorkflow)
        .sort((a, b) => a.position - b.position || a.e.nextEvalAt - b.e.nextEvalAt)
        .slice(0, limit)
      return { rows: picked.map(({ e }) => rowOf(e)), rowCount: picked.length }
    }
    if (sql.includes("where id = any($1::uuid[])") && sql.includes("returning id")) {
      const rows = (params[0] as string[]).map((id) => {
        const e = enrollments.get(id)!
        e.claimedUntil = now + (params[1] as number) * 1000
        return { id, token: tokenOf(e.claimedUntil) }
      })
      return { rows, rowCount: rows.length }
    }
    if (sql.includes("set claimed_until = null where id = $1")) {
      const e = enrollments.get(params[0] as string)!
      if (tokenOf(e.claimedUntil) === params[1]) e.claimedUntil = null
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes("claimed_until = $2::timestamptz")) {
      const e = enrollments.get(params[0] as string)!
      if (tokenOf(e.claimedUntil) !== params[1]) return { rows: [], rowCount: 0 }
      e.claimedUntil = now + (params[2] as number) * 1000
      return { rows: [{ token: tokenOf(e.claimedUntil) }], rowCount: 1 }
    }
    if (sql.includes("from workflow_versions")) return { rows: [{ graph: GRAPH }], rowCount: 1 }
    if (sql.includes("insert into workflow_enrollment_events")) {
      if (options.failEventsFor?.includes(params[0] as string)) throw new Error("banco indisponível para esta matrícula")
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes("update workflow_enrollments") && sql.includes("current_node_id = $1")) {
      const e = enrollments.get(params[1] as string)!
      if (e.revision !== params[2]) return { rows: [], rowCount: 0 }
      Object.assign(e, { node: params[0], status: "active", nextEvalAt: now, claimedUntil: null, revision: e.revision + 1 })
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes("set status = 'completed'")) {
      const e = enrollments.get(params[0] as string)!
      if (e.revision !== params[1]) return { rows: [], rowCount: 0 }
      Object.assign(e, { status: "completed", claimedUntil: null, revision: e.revision + 1 })
      return { rows: [], rowCount: 1 }
    }
    return { rows: [], rowCount: 1 }
  })
  const db = { query, connect: async () => ({ query, release: () => {} }) } as unknown as Database
  return { db, enrollments }
}

function gate() {
  let open!: () => void
  const opened = new Promise<void>((resolve) => (open = resolve))
  return { opened, open }
}

/** Fluxo investigar → gerar → fim; `hold(enrollmentId, node)` segura um nó até o portão abrir. */
function linearFlow(hold: (enrollmentId: string, node: string) => Promise<void> | undefined = () => undefined) {
  const runs: string[] = []
  let active = 0
  let maxActive = 0
  const behavior: Behavior = async (context, node) => {
    runs.push(`${context.enrollment.id}:${node.id}`)
    active++
    maxActive = Math.max(maxActive, active)
    try {
      await hold(context.enrollment.id, node.id)
    } finally {
      active--
    }
    if (node.id === "fim") return { kind: "complete" }
    return { kind: "advance", nextNodeId: NEXT[node.id] ?? node.id, eventType: "node_advanced" }
  }
  control.behavior = behavior as never
  return { runs, maxActive: () => maxActive, runsOf: (id: string) => runs.filter((run) => run.startsWith(`${id}:`)).map((run) => run.split(":")[1]) }
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0)
}
const events = () => vi.mocked(console.warn).mock.calls.map(([message]) => JSON.parse(String(message)).event as string)

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-05T19:41:24Z") })
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  control.behavior = null
})

describe("startWorkflowWorker — várias execuções ao mesmo tempo", () => {
  it("uma investigação de 12 min de um workflow não segura o fluxo de outro: o outro vai até o fim enquanto ela roda", async () => {
    const { db, enrollments } = fakeDb([{ id: "lenta", workflowId: "wf-indicador" }, { id: "rapida", workflowId: "wf-monitoria" }])
    const slow = gate()
    const flow = linearFlow((id, node) => (id === "lenta" && node === "investigar" ? slow.opened : undefined))
    const worker = startWorkflowWorker(db, { concurrency: 2 })
    await settle()

    // Sem esperar ticker nenhum: os 3 nós da rápida rodam em sequência, na hora, enquanto a lenta continua no 1º nó.
    expect(flow.runsOf("rapida")).toEqual(["investigar", "gerar", "fim"])
    expect(enrollments.get("rapida")!.status).toBe("completed")
    expect(flow.runsOf("lenta")).toEqual(["investigar"])
    expect(worker.running).toBe(1)

    await vi.advanceTimersByTimeAsync(12 * 60_000)
    expect(flow.runsOf("lenta")).toEqual(["investigar"]) // a posse foi renovada o tempo todo: nunca reexecutada
    slow.open()
    await settle()
    expect(flow.runsOf("lenta")).toEqual(["investigar", "gerar", "fim"])
    expect(enrollments.get("lenta")!.status).toBe("completed")
    await worker.stop()
  })

  it("respeita o limite de concorrência e reaproveita a vaga assim que uma execução termina", async () => {
    const seeds = ["a", "b", "c", "d", "e"].map((id) => ({ id, workflowId: `wf-${id}` }))
    const { db, enrollments } = fakeDb(seeds)
    const flow = linearFlow((_id, node) => (node === "investigar" ? new Promise<void>((resolve) => setTimeout(resolve, 1_000)) : undefined))
    const worker = startWorkflowWorker(db, { concurrency: 2 })
    await settle()
    expect(worker.running).toBe(2)

    await vi.advanceTimersByTimeAsync(5_000)
    await settle()
    expect([...enrollments.values()].every((e) => e.status === "completed")).toBe(true)
    expect(flow.maxActive()).toBe(2)
    await worker.stop()
  })

  it("justiça entre workflows: um fan-out com muitas matrículas ocupa no máximo metade das vagas — o outro workflow entra já", async () => {
    const fanOut = Array.from({ length: 6 }, (_, index) => ({ id: `filho-${index}`, workflowId: "wf-fan-out" }))
    const { db } = fakeDb([...fanOut, { id: "outro", workflowId: "wf-outro", dueIn: 0 }])
    const holds = gate()
    const flow = linearFlow(() => holds.opened)
    const worker = startWorkflowWorker(db, { concurrency: 4 })
    await settle()

    const started = flow.runs.map((run) => run.split(":")[0]!)
    expect(started).toContain("outro")
    expect(started.filter((id) => id.startsWith("filho-"))).toHaveLength(2) // limite por workflow = metade de 4
    expect(worker.running).toBe(3)
    holds.open()
    await settle()
    await worker.stop()
  })

  it("ciclo entre nós sem Espera não vira laço quente: depois do teto na janela a matrícula esfria e o aviso aparece", async () => {
    const { db } = fakeDb([{ id: "ciclo", workflowId: "wf-ciclo", node: "loop" }])
    let runs = 0
    control.behavior = (async () => {
      runs++
      return { kind: "advance", nextNodeId: "loop", eventType: "node_advanced" }
    }) as never
    const worker = startWorkflowWorker(db, { concurrency: 2, hotLoop: { maxRuns: 5, windowMs: 60_000, cooldownMs: 60_000 } })
    await settle()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(runs).toBe(5)
    expect(events()).toContain("workflow_enrollment_hot_loop")

    await vi.advanceTimersByTimeAsync(31_000) // resfriamento acabou: volta a andar (e esfria de novo)
    await settle()
    expect(runs).toBe(10)
    await worker.stop()
  })

  it("falha técnica numa matrícula (banco recusou até o registro da falha) não derruba as outras", async () => {
    const { db, enrollments } = fakeDb([{ id: "quebrada", workflowId: "wf-1" }, { id: "saudavel", workflowId: "wf-2" }], { failEventsFor: ["quebrada"] })
    linearFlow()
    const worker = startWorkflowWorker(db, { concurrency: 2 })
    await settle()
    expect(enrollments.get("saudavel")!.status).toBe("completed")
    expect(enrollments.get("quebrada")!.node).toBe("investigar")
    expect(vi.mocked(console.error).mock.calls.map(([message]) => JSON.parse(String(message)).event)).toContain("workflow_enrollment_run_failed")
    await worker.stop()
  })

  it("acorda na hora com o sinal de trabalho novo (disparo manual) e, parado, não pega mais nada", async () => {
    const { db, enrollments } = fakeDb([{ id: "manual", workflowId: "wf-manual" }, { id: "depois", workflowId: "wf-depois" }])
    for (const id of ["manual", "depois"]) enrollments.get(id)!.status = "waiting" // ainda não vencidas para o worker
    enrollments.get("manual")!.nextEvalAt = enrollments.get("depois")!.nextEvalAt = Date.now() + 3_600_000
    const flow = linearFlow()
    const worker = startWorkflowWorker(db, { concurrency: 2, pollIntervalMs: 60_000 })
    await settle()
    expect(flow.runs).toEqual([])

    Object.assign(enrollments.get("manual")!, { status: "active", nextEvalAt: Date.now() })
    signalWorkflowWork()
    await settle()
    expect(flow.runsOf("manual")).toEqual(["investigar", "gerar", "fim"])

    expect(await worker.stop()).toEqual({ abandoned: 0 })
    Object.assign(enrollments.get("depois")!, { status: "active", nextEvalAt: Date.now() })
    signalWorkflowWork()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(flow.runsOf("depois")).toEqual([])
  })

  it("stop(): espera o que está rodando até o prazo e informa o que ficou para ser retomado pela posse", async () => {
    const { db } = fakeDb([{ id: "longa", workflowId: "wf-1" }])
    linearFlow(() => new Promise<void>(() => {}))
    const worker = startWorkflowWorker(db, { concurrency: 1 })
    await settle()
    expect(worker.running).toBe(1)
    const stopping = worker.stop(1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await stopping).toEqual({ abandoned: 1 })
  })
})
