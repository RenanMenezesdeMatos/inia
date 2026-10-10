import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { NodeOutcome } from "./node-handlers.js"

/**
 * Posse da matrícula durante o nó (heartbeat da lease). Caso real (dev, 2026-10-05): uma investigação de indicador de
 * ~12 min rodou TRÊS vezes em paralelo — a lease de 120 s vencia no meio do nó e o tick seguinte reivindicava a mesma
 * matrícula. Aqui o relógio é falso e o banco emula o claim (`claimed_until < now()`) e o compare-and-swap da posse.
 */
const processNode = vi.fn<() => Promise<NodeOutcome>>()
vi.mock("./node-handlers.js", () => ({ processNode: () => processNode() }))

const { runWorkflowTick } = await import("./engine.js")

const GRAPH = { nodes: [{ id: "investigar", type: "end", label: "Nó", config: {}, position: { x: 0, y: 0 } }], edges: [] }
const ADVANCE: NodeOutcome = { kind: "advance", nextNodeId: "gerar-feedback", eventType: "node_advanced" }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** Uma matrícula; o "banco" usa o relógio falso como `now()`. O token da posse é o próprio `claimed_until`. */
function fakeDb() {
  const state = { status: "active", currentNodeId: "investigar", revision: 3, nextEvalAt: Date.now(), claimedUntil: null as number | null }
  const counters = { claims: 0, renewals: 0, outcomes: 0 }
  const tokenOf = (value: number | null) => (value === null ? null : new Date(value).toISOString())
  const row = () => ({
    id: "enr-1", organization_id: "org-1", workflow_id: "wf-1", version_id: "v-1", interaction_id: null, indicator_measurement_id: null, scheduled_subject_id: "op-1", scheduled_for: null,
    current_node_id: state.currentNodeId, matched_flag_name: null, matched_value_boolean: null, matched_value_numeric: null, status: state.status, attempts: 0, revision: state.revision,
    node_outputs: {}, variables: {}, parent_enrollment_id: null, scope_type: "ALL_TEAMS", workflow_team_id: null, workflow_subteam_id: null, consolidated_structure: null, population_filter: null,
  })
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const now = Date.now()
    if (sql.includes("for update of we skip locked")) {
      const due = ["active", "waiting"].includes(state.status) && state.nextEvalAt <= now && (state.claimedUntil === null || state.claimedUntil < now)
      return { rows: due ? [row()] : [], rowCount: due ? 1 : 0 }
    }
    if (sql.includes("where id = any($1::uuid[])") && sql.includes("returning id")) {
      counters.claims++
      state.claimedUntil = now + (params[1] as number) * 1000
      return { rows: [{ id: "enr-1", token: tokenOf(state.claimedUntil) }], rowCount: 1 }
    }
    if (sql.includes("claimed_until = $2::timestamptz")) {
      if (tokenOf(state.claimedUntil) !== params[1]) return { rows: [], rowCount: 0 }
      counters.renewals++
      state.claimedUntil = now + (params[2] as number) * 1000
      return { rows: [{ token: tokenOf(state.claimedUntil) }], rowCount: 1 }
    }
    if (sql.includes("from workflow_versions")) return { rows: [{ graph: GRAPH }], rowCount: 1 }
    if (sql.includes("update workflow_enrollments") && sql.includes("current_node_id = $1")) {
      if (params[2] !== state.revision) return { rows: [], rowCount: 0 }
      counters.outcomes++
      Object.assign(state, { currentNodeId: params[0], status: "active", nextEvalAt: now, claimedUntil: null, revision: state.revision + 1 })
      return { rows: [], rowCount: 1 }
    }
    return { rows: [], rowCount: 1 }
  })
  const db = { query, connect: async () => ({ query, release: () => {} }) } as unknown as Database
  /** O MESMO banco visto por um worker que morreu: toda consulta dele falha a partir de `kill()`. */
  const worker = () => {
    let dead = false
    const failing = async (sql: string, params?: unknown[]) => (dead ? Promise.reject(new Error("worker morto")) : query(sql, params))
    return { db: { query: failing, connect: async () => ({ query: failing, release: () => {} }) } as unknown as Database, kill: () => (dead = true) }
  }
  return { db, state, counters, worker }
}

const warnings = () => vi.mocked(console.warn).mock.calls.map(([message]) => JSON.parse(String(message)).event as string)

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-05T19:41:24Z") })
  processNode.mockReset()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("runWorkflowTick — o nó em execução mantém a posse da matrícula", () => {
  it("nó de 12 min: os ticks de cada minuto não o executam de novo; ao terminar, o heartbeat para e nada ressuscita a posse", async () => {
    const { db, state, counters } = fakeDb()
    const node = deferred<NodeOutcome>()
    processNode.mockReturnValueOnce(node.promise)

    const running = runWorkflowTick(db)
    await vi.advanceTimersByTimeAsync(0)
    expect(processNode).toHaveBeenCalledTimes(1)

    for (let minute = 1; minute <= 12; minute++) {
      await vi.advanceTimersByTimeAsync(60_000)
      expect(await runWorkflowTick(db)).toEqual({ processed: 0 }) // o ticker do servidor (e o pump) encontram a posse viva
      expect(state.claimedUntil).toBeGreaterThan(Date.now())
    }
    expect(processNode).toHaveBeenCalledTimes(1)
    expect(counters.claims).toBe(1)
    expect(counters.renewals).toBeGreaterThanOrEqual(18) // uma batida a cada 40 s

    node.resolve(ADVANCE)
    await expect(running).resolves.toEqual({ processed: 1 })
    expect(state).toMatchObject({ currentNodeId: "gerar-feedback", claimedUntil: null, revision: 4 })
    expect(counters.outcomes).toBe(1)

    const renewals = counters.renewals
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(counters.renewals).toBe(renewals)
    expect(state.claimedUntil).toBeNull()
    expect(warnings()).toEqual([])
  })

  it("worker morto no meio do nó: as batidas param, a lease vence e o tick seguinte recupera a matrícula; o morto não grava nada", async () => {
    const { db, state, worker } = fakeDb()
    const dead = worker()
    const stuck = deferred<NodeOutcome>()
    processNode.mockReturnValueOnce(stuck.promise).mockResolvedValueOnce(ADVANCE)

    const deadTick = runWorkflowTick(dead.db)
    const deadOutcome = deadTick.catch((error: Error) => error.message)
    await vi.advanceTimersByTimeAsync(0)
    dead.kill()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(await runWorkflowTick(db)).toEqual({ processed: 0 }) // a lease do morto ainda vale
    await vi.advanceTimersByTimeAsync(61_000)
    expect(await runWorkflowTick(db)).toEqual({ processed: 1 }) // venceu: recuperada pelo claim normal
    expect(processNode).toHaveBeenCalledTimes(2)
    expect(state).toMatchObject({ currentNodeId: "gerar-feedback", claimedUntil: null, revision: 4 })
    expect(warnings()).toContain("workflow_enrollment_lease_heartbeat_failed")

    stuck.resolve(ADVANCE)
    expect(await deadOutcome).toBe("worker morto")
    expect(state.revision).toBe(4)
  })

  it("nó travado além do teto da posse: o heartbeat desiste, a lease vence e outro tick o retoma", async () => {
    const { db, state } = fakeDb()
    processNode.mockReturnValueOnce(new Promise<NodeOutcome>(() => {})).mockResolvedValueOnce(ADVANCE)

    void runWorkflowTick(db, { maxHoldSeconds: 300 })
    await vi.advanceTimersByTimeAsync(0)
    let recoveredAt = 0
    for (let minute = 1; minute <= 10 && !recoveredAt; minute++) {
      await vi.advanceTimersByTimeAsync(60_000)
      if ((await runWorkflowTick(db)).processed === 1) recoveredAt = minute
    }
    expect(recoveredAt).toBeGreaterThan(5) // nunca antes do teto
    expect(recoveredAt).toBeLessThanOrEqual(7) // e no máximo uma lease depois dele
    expect(state.currentNodeId).toBe("gerar-feedback")
    expect(warnings()).toContain("workflow_enrollment_lease_hold_limit")
  })

  it("posse perdida antes de começar (outro tick reivindicou o resto do lote): pula sem executar o nó", async () => {
    const { db, state } = fakeDb()
    // Entre o claim (transação já confirmada) e a vez desta linha, outro worker reivindicou a matrícula: token diferente.
    const raced = {
      query: db.query,
      connect: async () => {
        const client = await db.connect()
        return { ...client, release: () => void (state.claimedUntil = (state.claimedUntil ?? 0) + 1) }
      },
    } as unknown as Database
    expect(await runWorkflowTick(raced)).toEqual({ processed: 0 })
    expect(processNode).not.toHaveBeenCalled()
  })
})
