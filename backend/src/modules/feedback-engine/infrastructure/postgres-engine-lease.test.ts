import { describe, expect, it, vi } from "vitest"

import type { Database } from "../../../infrastructure/database/pool.js"
import { EngineLeaseLostError } from "../application/engine-lease.js"
import { createPostgresFeedbackMemoryStore } from "./postgres-feedback-memory-store.js"

/**
 * `ENGINE_LEASE_V1` no Postgres (run-9, SFW-01/SFW-02): a posse nasce, é comparada e é renovada com o relógio do BANCO, e a conclusão
 * só grava se a linha ainda for da tentativa que a pegou. Confere o SQL e os parâmetros enviados (sem banco).
 */
type Call = { sql: string; params: unknown[] }
function fakeDb(rows: (sql: string) => { rows: unknown[]; rowCount?: number }) {
  const calls: Call[] = []
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      const result = rows(sql)
      return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length }
    }),
  }
  return { db: db as unknown as Database, calls }
}

const identity = { organizationId: "org", kind: "CALL_ANALYSIS" as const, analysisKey: "k", personId: "p", interactionId: "i", indicatorDefinitionId: null, periodStart: null, periodEnd: null, agentId: "a", trigger: { kind: "EVALUATION" as const, selectionReason: "teste" }, logicVersion: "v", asOf: new Date("2026-11-21T12:00:00Z") }
const dbLease = new Date("2026-11-21T12:02:00.123Z")

describe("ENGINE_LEASE_V1 no Postgres — relógio do banco", () => {
  it("a posse da análise nasce e é retomada pelo now() do banco; o token e a tentativa vêm do banco", async () => {
    const { db, calls } = fakeDb(() => ({ rows: [{ id: "run-1", claimed_until: dbLease, attempts: 3 }] }))
    const processNow = new Date("2030-01-01T00:00:00Z")
    const claim = await createPostgresFeedbackMemoryStore(db).claimAnalysis(identity, processNow, 120)
    expect(claim).toEqual({ kind: "CLAIMED", runId: "run-1", leaseUntil: dbLease, attempt: 3 })
    const sql = calls[0]!.sql
    expect(sql).toContain("date_trunc('milliseconds', now()) + make_interval(secs => $13::int)")
    expect(sql).toContain("r.claimed_until < now()")
    // Nenhum prazo calculado pelo processo é enviado: só a duração e a data de início registrada.
    expect(calls[0]!.params[12]).toBe(120)
    expect(calls[0]!.params.filter((value) => value instanceof Date && value.getTime() > processNow.getTime())).toEqual([])
  })

  it("a renovação soma o prazo ao now() do banco e devolve o claimed_until gravado", async () => {
    const { db, calls } = fakeDb(() => ({ rows: [{ claimed_until: dbLease }] }))
    const store = createPostgresFeedbackMemoryStore(db)
    expect(await store.renewAnalysisLease("org", "run-1", new Date("2026-11-21T12:00:00.000Z"), 120)).toEqual(dbLease)
    expect(calls[0]!.sql).toContain("claimed_until = (date_trunc('milliseconds', now()) + make_interval(secs => $4::int))")
    expect(calls[0]!.sql).toContain("claimed_until = $3")
    expect(await createPostgresFeedbackMemoryStore(fakeDb(() => ({ rows: [] })).db).renewMessageLease("org", "m-1", dbLease, 120)).toBeNull()
  })

  it("a posse da mensagem também usa o relógio do banco", async () => {
    const { db, calls } = fakeDb(() => ({ rows: [{ id: "m-1", claimed_until: dbLease, attempts: 1 }] }))
    const claim = await createPostgresFeedbackMemoryStore(db).claimMessage({ organizationId: "org", messageKey: "m", enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: "n", sourceNodeId: "s", personId: "p", domain: "MONITORING" }, new Date(), 120)
    expect(claim).toEqual({ kind: "CLAIMED", messageId: "m-1", leaseUntil: dbLease, attempt: 1 })
    expect(calls[0]!.sql).toContain("m.claimed_until < now()")
    expect(calls[0]!.params[9]).toBe(120)
  })
})

describe("ENGINE_LEASE_V1 no Postgres — só a dona da posse grava", () => {
  it("conclusão com a dona: o UPDATE confere status e tentativa; 0 linhas = nada gravado e a perda é registrada", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { db, calls } = fakeDb(() => ({ rows: [], rowCount: 0 }))
    const store = createPostgresFeedbackMemoryStore(db)
    await expect(store.completeInsufficient("org", "run-1", { outcomeReasons: [], result: null, provenance: {}, metrics: {} }, new Date(), { attempt: 2 })).rejects.toBeInstanceOf(EngineLeaseLostError)
    expect(calls[0]!.sql).toContain("and status = 'RUNNING' and attempts = $9::int")
    expect(calls[0]!.params[8]).toBe(2)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("feedback_engine_lease_lost_on_complete"))
    warn.mockRestore()
  })

  it("falha da execução que perdeu a posse não derruba a tentativa da outra", async () => {
    const { db, calls } = fakeDb(() => ({ rows: [], rowCount: 0 }))
    const store = createPostgresFeedbackMemoryStore(db)
    await store.failAnalysis("org", "run-1", "erro", new Date(), { attempt: 2 })
    await store.failMessage("org", "m-1", "erro", new Date(), { attempt: 4 })
    expect(calls[0]!.sql).toContain("attempts = $5::int")
    expect(calls[0]!.params[4]).toBe(2)
    expect(calls[1]!.sql).toContain("attempts = $5::int")
    expect(calls[1]!.params[4]).toBe(4)
  })

  it("sem dona (provas e scripts antigos): grava como antes, sem conferir a tentativa", async () => {
    const { db, calls } = fakeDb(() => ({ rows: [], rowCount: 1 }))
    await createPostgresFeedbackMemoryStore(db).completeInsufficient("org", "run-1", { outcomeReasons: [], result: null, provenance: {}, metrics: {} }, new Date())
    expect(calls[0]!.sql).not.toContain("attempts =")
    expect(calls[0]!.params).toHaveLength(8)
  })
})
