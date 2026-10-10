import { describe, expect, it } from "vitest"
import { addUsage, createLlmTelemetryStore, EMPTY_USAGE, recordLlmCall, runWithLlmTelemetry, summarizeLlmCalls, usageFromGeminiPayload, withLlmPhase, withLlmScope } from "./llm-telemetry.js"

describe("llm-telemetry — uso informado pelo provider e fases", () => {
  it("usageFromGeminiPayload lê cached/thoughts quando presentes e devolve null (não 0) quando ausentes", () => {
    expect(usageFromGeminiPayload({ usageMetadata: { promptTokenCount: 6589, candidatesTokenCount: 40, totalTokenCount: 6879 } })).toEqual({ promptTokens: 6589, outputTokens: 40, totalTokens: 6879, cachedInputTokens: null, reasoningTokens: null })
    expect(usageFromGeminiPayload({ usageMetadata: { promptTokenCount: 6589, candidatesTokenCount: 40, totalTokenCount: 8250, cachedContentTokenCount: 4100, thoughtsTokenCount: 1621 } })).toEqual({ promptTokens: 6589, outputTokens: 40, totalTokens: 8250, cachedInputTokens: 4100, reasoningTokens: 1621 })
    expect(usageFromGeminiPayload({})).toEqual(EMPTY_USAGE)
  })

  it("addUsage mantém null enquanto nenhuma request informou o campo", () => {
    const sum = addUsage(addUsage(EMPTY_USAGE, { promptTokens: 10, outputTokens: 1, totalTokens: 11, cachedInputTokens: null, reasoningTokens: null }), { promptTokens: 20, outputTokens: 2, totalTokens: 22, cachedInputTokens: 5, reasoningTokens: null })
    expect(sum).toEqual({ promptTokens: 30, outputTokens: 3, totalTokens: 33, cachedInputTokens: 5, reasoningTokens: null })
  })

  it("withLlmPhase etiqueta a fase das requests registradas dentro dele, preservando papel/agente; fora de um store é no-op", async () => {
    const store = createLlmTelemetryStore({ policy: "REAL" })
    await runWithLlmTelemetry(store, () =>
      withLlmScope({ role: "agent", agentId: "a1" }, async () => {
        await withLlmPhase("PLANNING", async () => {
          recordLlmCall({ model: "m", ...EMPTY_USAGE, promptTokens: 100, durationMs: 1, startedAt: new Date(), systemPrompt: "s", input: "i", outputText: null, toolCalls: ["compare_periods"] })
        })
        recordLlmCall({ model: "m", ...EMPTY_USAGE, durationMs: 1, startedAt: new Date(), systemPrompt: "s", input: "i", outputText: "t" })
      }),
    )
    expect(store.calls.map((call) => [call.sequence, call.role, call.agentId, call.phase ?? null, call.toolCalls ?? null])).toEqual([
      [1, "agent", "a1", "PLANNING", ["compare_periods"]],
      [2, "agent", "a1", null, null],
    ])
    expect(summarizeLlmCalls(store.calls)).toEqual({ aiCalls: 2, inputTokens: 100, outputTokens: 0, totalTokens: 0 })
    await expect(withLlmPhase("SYNTHESIS", async () => "ok")).resolves.toBe("ok")
  })
})
