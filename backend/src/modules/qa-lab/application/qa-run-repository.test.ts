import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { QaTrace } from "../domain/qa-run-schema.js"
import { findReferenceRun, insertQaRun, updateQaRun } from "./qa-run-repository.js"

// Organização da sessão de quem executa — diferente da organização da instalação.
const ORG = "00000000-0000-4000-8000-0000000000d4"

const aiCall = (sequence: number, phase: "PLANNING" | "SYNTHESIS", promptTokens: number, toolCalls: string[] = []) => ({
  sequence, role: "agent" as const, agentId: "a1", agentName: "Agent", model: "gemini-3.8-flash", promptTokens, outputTokens: 100, totalTokens: promptTokens + 100, durationMs: 1000, startedAt: "2026-09-17T12:00:00.000Z", systemPrompt: "s", input: "i", outputText: "o", phase, toolCalls,
})
const toolTrace = [{ sequence: 1, tool: "get_indicator_snapshot", label: "Consultar indicador", capability: "INDICATOR_ANALYSIS", argumentsSummary: {}, resultSummary: "ok", quality: null, provenance: null, status: "COMPLETED" as const, startedAt: "", completedAt: "", round: 0 }]
const trace: QaTrace = {
  steps: [{ index: 0, nodeId: "n1", nodeType: "action", label: "Agent", status: "completed", startedAt: "", simulatedNow: "", durationMs: 10, outcome: null, aiCalls: 2, totalTokens: 30200, nodeOutput: { text: "x", toolTrace, investigation: { toolCalls: 1, cachedCalls: 0, rejectedCalls: 0, budget: 12, outcome: "ANSWERED", preflightCalls: 1, planningRounds: 1 } } }],
  effects: [],
  aiCalls: [aiCall(1, "PLANNING", 20000, ["compare_periods"]), aiCall(2, "SYNTHESIS", 10000)],
  people: {},
  context: { operator: { id: "op-1", name: "Mariana" }, interaction: null },
}

function fakeDb(referenceRow: Record<string, unknown> | null) {
  const queries: { sql: string; params: unknown[] }[] = []
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql: sql.replace(/\s+/g, " ").trim(), params })
      if (sql.includes("insert into qa_runs")) return { rows: [{ id: "run-new" }], rowCount: 1 }
      if (sql.includes("r.trace->'telemetry'->'reference' reference")) return { rows: [{ reference: { runId: "run-stored", createdAt: "2026-09-17T10:00:00.000Z", requests: 8, toolCalls: 12, tokens: { input: 74000, output: 2400, total: 80207, cached: null }, durationMs: 24900 } }], rowCount: 1 }
      if (sql.includes("from qa_runs r") && sql.includes("is not distinct from")) return { rows: referenceRow ? [referenceRow] : [], rowCount: referenceRow ? 1 : 0 }
      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
  return { db, queries }
}

describe("qa-run-repository — telemetria persistida a cada insert/update", () => {
  it("insert calcula trace.telemetry por código (requests, fases, tool budget) e liga a referência compatível anterior (mesmo recurso + colaborador + interação)", async () => {
    const { db, queries } = fakeDb({ id: "run-old", created_at: "2026-09-17T10:00:00.000Z", ai_calls: 8, input_tokens: 74000, output_tokens: 2400, total_tokens: 80207, duration_ms: 24900, telemetry: null, legacy_steps: { steps: [{ index: 0, nodeId: "n", nodeType: "action", label: "A", status: "completed", startedAt: "", simulatedNow: "", durationMs: 1, outcome: null, aiCalls: 0, totalTokens: 0, nodeOutput: { toolTrace: [...toolTrace, ...toolTrace] } }], employeeRuns: [] } })
    await insertQaRun(db, { organizationId: ORG, executedBy: "admin", resourceType: "WORKFLOW", resourceId: "wf-1", resourceName: "POC", status: "WAITING", input: {}, context: trace.context, state: null, trace, durationMs: 20300, errorMessage: null })
    const reference = queries.find((query) => query.sql.includes("is not distinct from"))!
    expect(reference.params.slice(0, 5)).toEqual([ORG, "WORKFLOW", "wf-1", "op-1", null])
    const insert = queries.find((query) => query.sql.startsWith("insert into qa_runs"))!
    const persisted = JSON.parse(insert.params[9] as string) as QaTrace
    expect(persisted.telemetry).toMatchObject({
      version: 1,
      requests: 2,
      tokens: { input: 30000, cached: null, uncached: null, output: 200, reasoning: null, total: 30200 },
      toolBudget: { executed: 1, preflight: 1, budget: 12, outcome: "ANSWERED", planningRounds: 1 },
      phases: [{ phase: "PLANNING", requests: 1, toolCallsRequested: 1 }, { phase: "SYNTHESIS", requests: 1 }],
      // Run antigo sem telemetria: totais das colunas + Tool calls contadas do trace dos steps.
      reference: { runId: "run-old", requests: 8, toolCalls: 2, tokens: { total: 80207, cached: null }, durationMs: 24900 },
    })
    expect(persisted.telemetry?.perRequest?.map((request) => request.toolCalls)).toEqual([["compare_periods"], []])
    // Colunas de totais continuam as de sempre (compatibilidade do histórico).
    expect(insert.params.slice(10, 14)).toEqual([2, 30000, 200, 30200])
  })

  it("sem run compatível a referência é null; update recalcula os números e PRESERVA a referência gravada na inserção", async () => {
    const { db, queries } = fakeDb(null)
    expect(await findReferenceRun(db, { organizationId: ORG, resourceType: "AGENT", resourceId: "a1", context: {}, before: null })).toBeNull()
    await updateQaRun(db, ORG, "run-new", { status: "COMPLETED", state: null, trace: { ...trace, aiCalls: [...trace.aiCalls, aiCall(3, "SYNTHESIS", 5000)] }, durationMs: 100, errorMessage: null })
    const update = queries.find((query) => query.sql.startsWith("update qa_runs"))!
    const persisted = JSON.parse(update.params[3] as string) as QaTrace
    expect(persisted.telemetry?.requests).toBe(3)
    expect(persisted.telemetry?.tokens.total).toBe(35300)
    expect(persisted.telemetry?.reference?.runId).toBe("run-stored")
    expect(update.params[10]).toBe(ORG)
  })

  it("a referência exclui o próprio run, runs posteriores e runs RUNNING/FAILED", async () => {
    const { db, queries } = fakeDb(null)
    await findReferenceRun(db, { organizationId: ORG, resourceType: "WORKFLOW", resourceId: "wf-1", context: { operator: { id: "op-1" }, interaction: { id: "int-1" } }, before: { id: "run-x", createdAt: "2026-09-17T12:00:00.000Z" } })
    const query = queries[0]!
    expect(query.sql).toContain("r.status not in ('RUNNING', 'FAILED')")
    expect(query.sql).toContain("r.id <> $6 and r.created_at < $7")
    expect(query.params).toEqual([ORG, "WORKFLOW", "wf-1", "op-1", "int-1", "run-x", "2026-09-17T12:00:00.000Z"])
  })
})
