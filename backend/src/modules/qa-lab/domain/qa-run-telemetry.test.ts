import { describe, expect, it } from "vitest"
import type { LlmCallRecord } from "../../../shared/application/llm-telemetry.js"
import { buildQaRunTelemetry, buildToolBudget, collectInvestigations, tokensOfCall } from "./qa-run-telemetry.js"
import type { QaStep } from "./qa-run-schema.js"

const call = (overrides: Partial<LlmCallRecord> & { sequence: number }): LlmCallRecord & { agentName: string | null } => ({
  role: "agent",
  agentId: "a1",
  agentName: "Agent POC",
  model: "gemini-3.8-flash",
  promptTokens: 1000,
  outputTokens: 100,
  totalTokens: 1100,
  durationMs: 500,
  startedAt: "2026-09-17T12:00:00.000Z",
  systemPrompt: "sys",
  input: "in",
  outputText: "out",
  ...overrides,
})

const step = (nodeOutput: unknown): QaStep => ({ index: 0, nodeId: "n1", nodeType: "action", label: "Agent", status: "completed", startedAt: "", simulatedNow: "", durationMs: 10, outcome: null, nodeOutput, aiCalls: 0, totalTokens: 0 })

const toolTrace = [
  { sequence: 1, tool: "get_indicator_snapshot", label: "Consultar indicador", capability: "INDICATOR_ANALYSIS", argumentsSummary: {}, resultSummary: "ok", quality: null, provenance: null, status: "COMPLETED" as const, startedAt: "", completedAt: "", round: 0 },
  { sequence: 2, tool: "compare_periods", label: "Comparar períodos", capability: "INDICATOR_ANALYSIS", argumentsSummary: {}, resultSummary: "ok", quality: null, provenance: null, status: "COMPLETED" as const, startedAt: "", completedAt: "", round: 1 },
  { sequence: 3, tool: "compare_periods", label: "Comparar períodos", capability: "INDICATOR_ANALYSIS", argumentsSummary: {}, resultSummary: "(cache)", quality: null, provenance: null, status: "CACHED" as const, startedAt: "", completedAt: "", round: 2 },
  { sequence: 4, tool: "find_interactions", label: "Buscar interações", capability: "INTERACTION_ANALYSIS", argumentsSummary: {}, resultSummary: "falha", quality: null, provenance: null, status: "FAILED" as const, startedAt: "", completedAt: "", round: 2 },
  { sequence: 5, tool: "analyze_interactions", label: "Analisar", capability: "INTERACTION_ANALYSIS", argumentsSummary: {}, resultSummary: "orçamento", quality: null, provenance: null, status: "BUDGET_EXCEEDED" as const, startedAt: "", completedAt: "", round: 2 },
]
const investigation = { toolCalls: 3, cachedCalls: 1, rejectedCalls: 1, budget: 12, outcome: "BUDGET_EXHAUSTED" as const, preflightCalls: 1, planningRounds: 2, parallelWaves: 1, tokenBudget: { status: "WARNING" as const, thresholds: { total: 60000, input: 50000, output: 8000 }, exceeded: ["total" as const] } }

describe("qa-run-telemetry — agregação por código do que o provider informou", () => {
  it("tokens por request: uncached só quando input E cached foram informados; reasoning/cached ficam null quando ausentes (nunca estimados)", () => {
    expect(tokensOfCall(call({ sequence: 1, promptTokens: 6589, outputTokens: 40, totalTokens: 6879 }))).toEqual({ input: 6589, cached: null, uncached: null, output: 40, reasoning: null, total: 6879 })
    expect(tokensOfCall(call({ sequence: 2, promptTokens: 6589, cachedInputTokens: 4000, reasoningTokens: 250, outputTokens: 40, totalTokens: 6879 }))).toEqual({ input: 6589, cached: 4000, uncached: 2589, output: 40, reasoning: 250, total: 6879 })
    expect(tokensOfCall(call({ sequence: 3, promptTokens: null, outputTokens: null, totalTokens: null }))).toEqual({ input: null, cached: null, uncached: null, output: null, reasoning: null, total: null })
  })

  it("resumo do run: requests, totais, breakdown por fase (PREFLIGHT/PLANNING/SEMANTIC_ANALYSIS/KNOWLEDGE/SYNTHESIS) e drill-down por request com as Tools pedidas", () => {
    const aiCalls = [
      call({ sequence: 1, phase: "PLANNING", toolCalls: ["compare_periods", "compare_population"], promptBreakdown: { systemPromptChars: 10000, toolSchemaChars: 8000, inputChars: 900, declaredTools: 9 } }),
      call({ sequence: 2, phase: "PLANNING", toolCalls: ["find_interactions"], promptTokens: 2000, outputTokens: 60, totalTokens: 2060 }),
      call({ sequence: 3, phase: "SEMANTIC_ANALYSIS", model: "gemini-3.1-flash-lite", promptTokens: 3000, outputTokens: 300, totalTokens: 3300, cachedInputTokens: 1000 }),
      call({ sequence: 4, phase: "SYNTHESIS", model: "gemini-3.1-flash-lite", promptTokens: 5000, outputTokens: 600, totalTokens: 5600, reasoningTokens: 200 }),
    ]
    const telemetry = buildQaRunTelemetry({ aiCalls, steps: [step({ text: "x", toolTrace, investigation })] }, null)
    expect(telemetry.requests).toBe(4)
    expect(telemetry.tokens).toEqual({ input: 11000, cached: 1000, uncached: 2000, output: 1060, reasoning: 200, total: 12060 })
    expect(telemetry.cacheHitRate).toBe(0.091)
    expect(telemetry.phases.map((phase) => [phase.phase, phase.requests, phase.tokens.total, phase.toolCallsRequested])).toEqual([
      ["PLANNING", 2, 3160, 3],
      ["SEMANTIC_ANALYSIS", 1, 3300, 0],
      ["SYNTHESIS", 1, 5600, 0],
    ])
    expect(telemetry.perRequest[0]).toMatchObject({ sequence: 1, phase: "PLANNING", model: "gemini-3.8-flash", provider: "gemini", agentName: "Agent POC", toolCalls: ["compare_periods", "compare_population"], durationMs: 500, promptBreakdown: { declaredTools: 9 } })
    expect(telemetry.perRequest[3]!.tokens).toEqual({ input: 5000, cached: null, uncached: null, output: 600, reasoning: 200, total: 5600 })
    expect(telemetry.toolBudget).toEqual({ executed: 3, cached: 1, rejected: 1, preflight: 1, investigation: null, budget: 12, outcome: "BUDGET_EXHAUSTED", planningRounds: 2, parallelWaves: 1 })
    // Requests sem telemetria V1.2: rota/contexto/ids ficam null (nunca inventados).
    expect(telemetry.perRequest[0]).toMatchObject({ route: null, contextBreakdown: null, technicalIds: null })
    expect(telemetry.technicalIdsInPrompts).toBeNull()
    expect(telemetry.contextBreakdown).toBeNull()
    expect(telemetry.tokenBudget?.status).toBe("WARNING")
    expect(telemetry.reference).toBeNull()
  })

  it("provider sem cached tokens: cached/uncached/reasoning null no total e cacheHitRate null", () => {
    const telemetry = buildQaRunTelemetry({ aiCalls: [call({ sequence: 1, phase: "PLANNING" }), call({ sequence: 2, phase: "SYNTHESIS" })], steps: [] }, null)
    expect(telemetry.tokens).toEqual({ input: 2000, cached: null, uncached: null, output: 200, reasoning: null, total: 2200 })
    expect(telemetry.cacheHitRate).toBeNull()
    expect(telemetry.toolBudget).toBeNull()
    expect(telemetry.tokenBudget).toBeNull()
  })

  it("run histórico (requests sem fase/tool calls, output sem investigação): agrega como UNASSIGNED e sem Tool Budget — nada inventado", () => {
    const telemetry = buildQaRunTelemetry({ aiCalls: [call({ sequence: 1 }), call({ sequence: 2 })], steps: [step({ text: "resposta antiga" })] }, null)
    expect(telemetry.phases).toEqual([{ phase: "UNASSIGNED", requests: 2, tokens: { input: 2000, cached: null, uncached: null, output: 200, reasoning: null, total: 2200 }, durationMs: 1000, toolCallsRequested: 0 }])
    expect(telemetry.perRequest.map((request) => request.phase)).toEqual([null, null])
    expect(telemetry.toolBudget).toBeNull()
  })

  it("coleta trace de Tools e resumos de investigação em steps, fan-out (employeeRuns) e resultados de orquestrador (results[])", () => {
    const collected = collectInvestigations({
      steps: [step({ results: [{ toolTrace: toolTrace.slice(0, 1), investigation }, { text: "sem tools" }] })],
      employeeRuns: [{ employeeId: "e1", status: "completed", steps: [step({ toolTrace: toolTrace.slice(1, 2), investigation: { ...investigation, outcome: "ANSWERED" } })] }],
    })
    expect(collected.toolTraces).toHaveLength(2)
    expect(collected.summaries).toHaveLength(2)
    // Pior resultado entre as investigações do run; contagens somadas.
    expect(buildToolBudget(collected.toolTraces, collected.summaries)).toMatchObject({ executed: 2, outcome: "BUDGET_EXHAUSTED", preflight: 2, budget: 24, planningRounds: 4 })
  })

  it("referência (run anterior compatível) viaja dentro da telemetria para a UI calcular antes/depois", () => {
    const reference = { runId: "r0", createdAt: "2026-09-17T10:00:00.000Z", requests: 8, toolCalls: null, tokens: { input: 74000, output: 2400, total: 80207, cached: null }, durationMs: 24900 }
    const telemetry = buildQaRunTelemetry({ aiCalls: [call({ sequence: 1, phase: "SYNTHESIS" })], steps: [] }, reference)
    expect(telemetry.reference).toEqual(reference)
  })
})

describe("qa-run-telemetry — V1.2: rota por request, contexto por categoria e UUIDs no prompt", () => {
  it("soma o breakdown de contexto e os ids técnicos das requests que informaram; separa preflight de investigação no Tool Budget", () => {
    const route = { provider: "GEMINI", tier: "STANDARD" as const, reason: "planning · modo CURRENT", mode: "CURRENT" as const, escalated: false, fallback: false }
    const breakdown = { staticPromptChars: 11_000, toolSchemaChars: 8_000, evidenceLedgerChars: 900, interactionContentChars: 0, knowledgeContentChars: 0, structuredSchemaChars: 0, objectiveChars: 300 }
    const aiCalls = [
      call({ sequence: 1, phase: "PLANNING", route, contextBreakdown: breakdown, promptBreakdown: { systemPromptChars: 11_000, toolSchemaChars: 8_000, inputChars: 1_200, declaredTools: 10, technicalIds: 0 } }),
      call({ sequence: 2, phase: "SYNTHESIS", route: { ...route, tier: "BASIC", escalated: true }, contextBreakdown: { ...breakdown, toolSchemaChars: 0, structuredSchemaChars: 2_500 }, promptBreakdown: { systemPromptChars: 12_000, toolSchemaChars: 0, inputChars: 5_000, declaredTools: 0, technicalIds: 2 } }),
    ]
    const investigation = { toolCalls: 10, cachedCalls: 0, rejectedCalls: 0, budget: 12, outcome: "ANSWERED" as const, preflightCalls: 3, investigationToolCalls: 7, planningRounds: 2 }
    const telemetry = buildQaRunTelemetry({ aiCalls, steps: [step({ text: "x", toolTrace: toolTrace.slice(0, 2), investigation })] }, null)
    expect(telemetry.perRequest.map((request) => [request.route?.tier, request.route?.escalated, request.technicalIds])).toEqual([["STANDARD", false, 0], ["BASIC", true, 2]])
    expect(telemetry.technicalIdsInPrompts).toBe(2)
    expect(telemetry.contextBreakdown).toMatchObject({ staticPromptChars: 22_000, toolSchemaChars: 8_000, evidenceLedgerChars: 1_800, interactionContentChars: 0, knowledgeContentChars: 0, structuredSchemaChars: 2_500, objectiveChars: 600 })
    expect(telemetry.toolBudget).toMatchObject({ preflight: 3, investigation: 7, budget: 12 })
  })
})

describe("qa-run-telemetry — V1.3: cache, custo, cobertura (dois universos) e qualidade fail-closed", () => {
  it("agrega cache (modo/tokens/taxa), custo total e por fase, componentes de prompt; runs sem essa telemetria ficam null (compatibilidade)", () => {
    const aiCalls = [
      call({ sequence: 1, phase: "PLANNING", promptTokens: 4000, cachedInputTokens: 3000, cache: { mode: "EXPLICIT", cacheKeyVersion: "v1", cachedTokens: 3000, hitRate: 0.75 }, cost: { status: "ESTIMATED_PROVIDER_COST", currency: "USD", inputCost: 0.001, cachedInputCost: 0.0003, outputCost: 0.0002, reasoningCost: 0, totalEstimatedCost: 0.0015 }, promptComponents: [{ id: "agent.identity", version: 1, chars: 2700, static: true, placement: "SYSTEM" }, { id: "investigation.subject", version: 1, chars: 200, static: false, placement: "USER" }], classification: { phase: "PLANNING", purpose: "PLANNING", source: "AGENT", semanticType: "INVESTIGATION" } }),
      call({ sequence: 2, phase: "SYNTHESIS", promptTokens: 5000, cachedInputTokens: null, cost: { status: "NOT_CONFIGURED" }, promptComponents: [{ id: "agent.identity", version: 1, chars: 2700, static: true, placement: "SYSTEM" }] }),
    ]
    const telemetry = buildQaRunTelemetry({ aiCalls, steps: [] }, null)
    expect(telemetry.cache).toEqual({ mode: "EXPLICIT", cachedTokens: 3000, hitRate: 0.333, explicitRequests: 1, implicitRequests: 0, cacheKeyVersions: ["v1"] })
    expect(telemetry.cost?.total).toMatchObject({ status: "ESTIMATED_PROVIDER_COST", totalEstimatedCost: 0.0015 })
    expect(telemetry.cost?.byPhase).toEqual([{ phase: "PLANNING", cost: expect.objectContaining({ totalEstimatedCost: 0.0015 }) }, { phase: "SYNTHESIS", cost: { status: "NOT_CONFIGURED" } }])
    expect(telemetry.promptComponents).toEqual([{ id: "agent.identity", static: true, chars: 5400, requests: 2 }, { id: "investigation.subject", static: false, chars: 200, requests: 1 }])
    expect(telemetry.perRequest[0]?.classification?.purpose).toBe("PLANNING")
    const legacy = buildQaRunTelemetry({ aiCalls: [call({ sequence: 1 })], steps: [] }, null)
    expect(legacy.cache).toEqual({ mode: "NONE", cachedTokens: null, hitRate: null, explicitRequests: 0, implicitRequests: 0, cacheKeyVersions: [] })
    expect(legacy.cost?.total).toEqual({ status: "NOT_CONFIGURED" })
    expect(legacy.coverage).toBeNull()
    expect(legacy.quality).toBeNull()
  })

  it("cobertura: interações registradas × analisadas × universo operacional (Não determinado = null) e escopo permitido; qualidade: gating fail-closed com fallback e escopos das claims", () => {
    const investigation = {
      toolCalls: 10, cachedCalls: 0, rejectedCalls: 0, budget: 12, outcome: "ANSWERED" as const, interactionsInPeriod: 2,
      operationalUniverse: { count: 1267, source: "get_indicator_snapshot", label: "contatos" },
      synthesis: { supportedHypotheses: [], unsupportedHypotheses: [], limitations: ["amostra de 2"], behavioralClaims: [{ text: "na interação analisada…", evidenceRefs: ["F7"], scope: "INTERACTION_SPECIFIC" as const }, { text: "sem escopo", evidenceRefs: ["F7"] }], recommendationSupport: [], evidenceRepresentativeness: [{ ref: "F7", tool: "analyze_interactions", analyzed: 2, universe: 2, level: "ANECDOTAL" as const, analyzedCount: 2, recordedUniverseCount: 2, recordedCoverage: 1, operationalUniverseCount: 1267, operationalCoverage: null, universeRelationship: "UNKNOWN" as const, classification: "ANECDOTAL" as const, reason: "…" }] },
      evidenceGating: { rejectedClaims: [{ kind: "BEHAVIORAL_CLAIM" as const, text: "você costuma", reason: "escopo" }], corrected: false, envelopePresent: false, parseStatus: "MISSING" as const, correctionAttempted: true, correctionSucceeded: false, fallbackUsed: true, fallbackReason: "ENVELOPE_MISSING" as const },
    }
    const telemetry = buildQaRunTelemetry({ aiCalls: [], steps: [step({ text: "x", toolTrace: [], investigation })] }, null)
    expect(telemetry.coverage).toEqual({ recordedInteractions: 2, analyzedInteractions: 2, recordedCoverage: 1, operationalUniverse: 1267, operationalCoverage: null, universeRelationship: "UNKNOWN", representativeness: "ANECDOTAL", allowedScope: "INTERACTION_SPECIFIC", allowedScopeLabel: "nesta(s) interação(ões)" })
    expect(telemetry.quality).toEqual({ gatingStatus: "FALLBACK", envelopePresent: false, correctionAttempted: true, correctionSucceeded: false, fallbackUsed: true, fallbackReason: "ENVELOPE_MISSING", rejectedClaims: 1, claimScopes: [{ scope: "INTERACTION_SPECIFIC", label: "nesta(s) interação(ões)", count: 2 }], limitations: 1, markerStatus: null, firstAttemptMarkerStatus: null, correctionCategories: null, persistentCategories: null, claims: null, candidates: null, salvage: null })
    // Run da V1.2 (sem os campos fail-closed): gating passou, envelope desconhecido (null).
    const legacy = buildQaRunTelemetry({ aiCalls: [], steps: [step({ text: "x", toolTrace: [], investigation: { ...investigation, evidenceGating: { rejectedClaims: [], corrected: true }, synthesis: { ...investigation.synthesis, evidenceRepresentativeness: [{ ref: "F7", tool: "analyze_interactions", analyzed: 8, universe: 10, level: "REPRESENTATIVE" as const }] } } })] }, null)
    expect(legacy.quality).toMatchObject({ gatingStatus: "CORRECTED", envelopePresent: null, correctionAttempted: true, correctionSucceeded: true, fallbackUsed: false })
    expect(legacy.coverage).toMatchObject({ analyzedInteractions: 8, recordedCoverage: null, representativeness: "REPRESENTATIVE", allowedScope: "EMPLOYEE_PATTERN" })
  })
})
