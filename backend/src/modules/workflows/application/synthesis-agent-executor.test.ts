import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { EmployeeFanInOutput } from "./consolidate-results-executor.js"

const generateAgentReply = vi.fn<(systemPrompt: string, input: string, options?: { structuredOutput?: boolean; route?: unknown }) => Promise<string>>()
// V1.3: o pós-JOIN sai pelo llm-gateway → adapter Gemini → generateAgentReplyWithUsage (o mock devolve o texto sem uso informado).
vi.mock("../../agents/infrastructure/gemini-agent-client.js", () => ({
  generateAgentReplyWithUsage: async (...args: [string, string, { structuredOutput?: boolean }?]) => ({ text: await generateAgentReply(...args), usage: { promptTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null, reasoningTokens: null }, durationMs: 0, model: "mock" }),
}))
vi.mock("../../agents/application/build-system-prompt.js", () => ({
  buildSystemPromptWithTrace: async (_db: unknown, _id: string, agent: { context_prompt: string }) => ({
    systemPrompt: `SYSTEM:${agent.context_prompt}`,
    knowledge: { mode: "NONE", authorizedDocuments: [], retrieved: [], injectedChars: 0 },
    parts: { identity: `SYSTEM:${agent.context_prompt}`, knowledge: "Nenhuma base de conhecimento associada.", knowledgeTitles: "", expectations: "", restrictions: "" },
  }),
}))

const { executeSynthesisAgent, parseSynthesisResult, renderSynthesisText } = await import("./synthesis-agent-executor.js")

const SYNTHESIS_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
const ORG = "00000000-0000-4000-8000-000000000001"
const A = "11111111-1111-4111-8111-111111111111"
const B = "22222222-2222-4222-8222-222222222222"

function fakeDb(agent: Record<string, unknown> | null): Database {
  return {
    query: async (sql: string) => {
      if (sql.includes("from agents where id = $1")) return { rows: agent ? [agent] : [], rowCount: agent ? 1 : 0 }
      if (sql.includes("select id, name from people")) return { rows: [{ id: A, name: "Ana Lima" }, { id: B, name: "Bruno Souza" }], rowCount: 2 }
      return { rows: [], rowCount: 0 }
    },
  } as unknown as Database
}

const fanIn: EmployeeFanInOutput = {
  kind: "EMPLOYEE_FAN_IN",
  sourceFanOutNodeId: "apply",
  expectedCount: 2,
  completedCount: 1,
  failedCount: 1,
  joinedAt: "2026-09-16T12:00:00.000Z",
  children: [
    { employeeId: A, status: "completed", nodeOutputs: { agent: { kind: "indicator", input: { structured: { summary: "PRV 87%" } } }, review: { decision: "approved" } } },
    { employeeId: B, status: "failed", failureReason: "sem dados", nodeOutputs: {} },
  ] as EmployeeFanInOutput["children"],
}

const synthesisAgent = { id: SYNTHESIS_ID, name: "Especialista de Síntese Gerencial", objective: "Sintetizar", description: "d", context_prompt: "PROMPT", active: true, specialty: "SYNTHESIS", specialty_kind: "SYNTHESIS", domain: null, capability: null, consolidated_input: true }
const recorderCalls: string[] = []
const recorder = {
  start: async () => {
    recorderCalls.push("start")
    return "run-1"
  },
  complete: async () => {
    recorderCalls.push("complete")
  },
  fail: async () => {
    recorderCalls.push("fail")
  },
}
const config = { actionType: "CALL_AGENT" as const, agentId: SYNTHESIS_ID, instruction: "Sintetize as quedas." }

beforeEach(() => {
  generateAgentReply.mockReset()
  recorderCalls.length = 0
})

describe("Agent de síntese pós-JOIN (synthesis-agent-executor.ts)", () => {
  it("UMA request, com o MESMO contexto consolidado do Orquestrador legado (nomes resolvidos, revisão humana e falhas), sob o papel agent_synthesis; contrato validado e texto derivado", async () => {
    generateAgentReply.mockResolvedValue(JSON.stringify({ title: "Quedas de PRV", summary: "Um caso analisado, um sem dados.", patterns: ["PRV abaixo da meta em Ana Lima"], risks: [], strengths: [], trends: [], actions: ["Acompanhamento quinzenal"], withoutAnalysis: ["Bruno Souza"] }))
    const result = await executeSynthesisAgent(config, { db: fakeDb(synthesisAgent), organizationId: ORG, inputContext: "Ciclo de setembro", fanIn, collection: null, recorder })
    expect(generateAgentReply).toHaveBeenCalledTimes(1)
    const [systemPrompt, input, options] = generateAgentReply.mock.calls[0]!
    expect(systemPrompt).toContain("SYSTEM:PROMPT")
    expect(systemPrompt).toContain("nunca recalcule PRV")
    expect(input).toContain("Sintetize as quedas.")
    expect(input).toContain("Ana Lima: concluído. revisão humana: approved.")
    expect(input).toContain("Bruno Souza: falhou — sem dados.")
    expect(input).not.toContain(A) // nunca UUID cru
    // Pelo gateway (V1.3): o adapter recebe a rota decidida pela política (POST_JOIN_SYNTHESIS → BASIC no modo CURRENT).
    expect(options).toMatchObject({ structuredOutput: true, route: { provider: "GEMINI", tier: "BASIC" } })
    expect(result.agentRunId).toBe("run-1")
    expect(recorderCalls).toEqual(["start", "complete"])
    expect(result.nodeOutput).toMatchObject({ kind: "synthesis", executionKind: "SYNTHESIS_AGENT", agentName: "Especialista de Síntese Gerencial", consolidatedCount: 2 })
    expect(result.nodeOutput.structured.withoutAnalysis).toEqual(["Bruno Souza"])
    expect(result.nodeOutput.text).toContain("## Quedas de PRV")
    expect(result.nodeOutput.text).toContain("### Sem análise neste ciclo\n- Bruno Souza")
  })

  it("fan-in vazio: nenhuma request de IA, skippedReason EMPTY_FAN_IN (mesma semântica do Orquestrador legado)", async () => {
    const result = await executeSynthesisAgent(config, { db: fakeDb(synthesisAgent), organizationId: ORG, inputContext: "", fanIn: { ...fanIn, expectedCount: 0, children: [] }, collection: null, recorder })
    expect(generateAgentReply).not.toHaveBeenCalled()
    expect(result.nodeOutput.skippedReason).toBe("EMPTY_FAN_IN")
    expect(recorderCalls).toEqual([])
  })

  it("Agent que não aceita resultado consolidado é recusado antes de qualquer request (WORKFLOW_AGENT_NOT_CONSOLIDATED); inativo/inexistente idem", async () => {
    await expect(executeSynthesisAgent(config, { db: fakeDb({ ...synthesisAgent, specialty: "PERFORMANCE", specialty_kind: "PERFORMANCE", consolidated_input: false }), organizationId: ORG, inputContext: "", fanIn, collection: null, recorder })).rejects.toMatchObject({ code: "WORKFLOW_AGENT_NOT_CONSOLIDATED" })
    await expect(executeSynthesisAgent(config, { db: fakeDb({ ...synthesisAgent, active: false }), organizationId: ORG, inputContext: "", fanIn, collection: null, recorder })).rejects.toMatchObject({ code: "AGENT_INACTIVE" })
    await expect(executeSynthesisAgent(config, { db: fakeDb(null), organizationId: ORG, inputContext: "", fanIn, collection: null, recorder })).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" })
    expect(generateAgentReply).not.toHaveBeenCalled()
  })

  it("texto livre ou JSON incompleto é recusado (nunca aceito como síntese) e a execução é marcada como falha", async () => {
    generateAgentReply.mockResolvedValue("Segue um resumo em texto livre…")
    await expect(executeSynthesisAgent(config, { db: fakeDb(synthesisAgent), organizationId: ORG, inputContext: "", fanIn, collection: null, recorder })).rejects.toMatchObject({ code: "AGENT_STRUCTURED_OUTPUT_INVALID" })
    expect(recorderCalls).toEqual(["start", "fail"])
    expect(() => parseSynthesisResult(JSON.stringify({ title: "x" }))).toThrow(/campos obrigatórios/)
    expect(parseSynthesisResult('```json\n{"title":"T","summary":"S"}\n```')).toMatchObject({ title: "T", summary: "S", patterns: [], actions: [] })
    expect(renderSynthesisText({ title: "T", summary: "S", patterns: [], risks: [], strengths: [], trends: [], actions: [], withoutAnalysis: [] })).toBe("## T\n\nS")
  })
})
