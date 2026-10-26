import { describe, expect, it } from "vitest"
import { createChatTurnMetrics, createChatTurnTrace, runWithChatTurnTrace, traceChatTool } from "./chat-turn-trace.js"

describe("rastreamento de um turno do chat", () => {
  it("etapas somam, o primeiro conteúdo é o primeiro (não o último) e ferramentas entram com duração e resultado", async () => {
    let clock = 0
    const trace = createChatTurnTrace({ channel: "chat", now: () => clock, traceId: "t-1" })
    await trace.span("context", async () => {
      clock += 30
    })
    await trace.span("context", async () => {
      clock += 20
    })
    clock = 100
    trace.firstContent()
    clock = 150
    trace.firstContent()
    await runWithChatTurnTrace(trace, () => traceChatTool("agent_x", "SPECIALIST", async () => {
      clock += 40
    }))
    await runWithChatTurnTrace(trace, () => traceChatTool("my_results", "DIRECT", async () => {
      throw new Error("falhou")
    })).catch(() => null)
    trace.setPath("ORCHESTRATED")
    clock = 400
    const summary = trace.finish("OK")
    expect(summary).toMatchObject({ traceId: "t-1", path: "ORCHESTRATED", firstContentMs: 100, totalMs: 400, stages: { context: 50 } })
    expect(summary.tools).toEqual([{ name: "agent_x", kind: "SPECIALIST", startMs: 150, ms: 40, ok: true }, { name: "my_results", kind: "DIRECT", startMs: 190, ms: 0, ok: false }])
    // Fechar de novo devolve o mesmo resumo (um registro por turno).
    expect(trace.finish("ERROR")).toBe(summary)
  })

  it("métricas do processo: p50/p95 por canal e caminho, só dos turnos que deram certo; erros e cancelamentos contados", () => {
    const metrics = createChatTurnMetrics(100)
    for (let index = 1; index <= 20; index += 1) metrics.record({ traceId: String(index), channel: "chat", path: "ORCHESTRATED", outcome: "OK", firstContentMs: index * 100, totalMs: index * 1_000, stages: {}, llm: [], tools: [], notes: {} })
    metrics.record({ traceId: "e", channel: "chat", path: "ORCHESTRATED", outcome: "ERROR", firstContentMs: null, totalMs: 5, stages: {}, llm: [], tools: [], notes: {} })
    metrics.record({ traceId: "c", channel: "chat", path: "ORCHESTRATED", outcome: "CANCELLED", firstContentMs: null, totalMs: 5, stages: {}, llm: [], tools: [], notes: {} })
    const snapshot = metrics.snapshot() as Record<string, { count: number; errors: number; cancelled: number; firstContent: { p50Ms: number; p95Ms: number; sampled: number }; total: { p95Ms: number } }>
    expect(snapshot["chat:ORCHESTRATED"]).toMatchObject({ count: 22, errors: 1, cancelled: 1, firstContent: { p50Ms: 1_000, p95Ms: 1_900, sampled: 20 }, total: { p95Ms: 19_000 } })
  })
})
