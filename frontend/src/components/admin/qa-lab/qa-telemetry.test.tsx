/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }))

import { QaRunCard, QaRunsTable } from "./qa-history"
import { deltaOf, telemetryCells, tokensSavedText } from "./qa-telemetry"
import { RunResult } from "./run-result"
import type { QaRun, QaRunSummary, QaRunTelemetry } from "@/schemas/admin/qa-lab.schema"

afterEach(cleanup)

function withClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

const telemetry: QaRunTelemetry = {
  version: 1,
  requests: 4,
  tokens: { input: 38_000, cached: null, uncached: null, output: 2_100, reasoning: null, total: 40_100 },
  cacheHitRate: null,
  toolBudget: { executed: 10, cached: 1, rejected: 0, preflight: 3, investigation: 7, budget: 12, outcome: "ANSWERED", planningRounds: 2, parallelWaves: 2 },
  technicalIdsInPrompts: 0,
  contextBreakdown: { staticPromptChars: 44_000, toolSchemaChars: 16_000, evidenceLedgerChars: 2_400, interactionContentChars: 0, knowledgeContentChars: 1_200, structuredSchemaChars: 2_500, objectiveChars: 900 },
  tokenBudget: { status: "OK", thresholds: { total: 60_000, input: 50_000, output: 8_000 }, exceeded: [] },
  phases: [
    { phase: "PLANNING", requests: 2, tokens: { input: 20_000, cached: null, uncached: null, output: 200, reasoning: null, total: 20_200 }, durationMs: 4_000, toolCallsRequested: 4 },
    { phase: "SYNTHESIS", requests: 2, tokens: { input: 18_000, cached: null, uncached: null, output: 1_900, reasoning: null, total: 19_900 }, durationMs: 6_000, toolCallsRequested: 0 },
  ],
  perRequest: [
    { sequence: 1, phase: "PLANNING", role: "agent", agentName: "Agent POC", model: "gemini-3.8-flash", provider: "gemini", tokens: { input: 9_000, cached: null, uncached: null, output: 90, reasoning: null, total: 9_090 }, durationMs: 2_000, toolCalls: ["compare_periods", "compare_population"], promptBreakdown: { systemPromptChars: 10_000, toolSchemaChars: 6_000, inputChars: 800, declaredTools: 9 }, route: { provider: "GEMINI", tier: "STANDARD", reason: "planning · 10 tool schemas · modo CURRENT", mode: "CURRENT", escalated: false, fallback: false }, technicalIds: 0 },
    { sequence: 2, phase: "PLANNING", role: "agent", agentName: "Agent POC", model: "gemini-3.8-flash", provider: "gemini", tokens: { input: 11_000, cached: null, uncached: null, output: 110, reasoning: null, total: 11_110 }, durationMs: 2_000, toolCalls: ["find_interactions", "get_employee_history"], promptBreakdown: null },
    { sequence: 3, phase: "SYNTHESIS", role: "agent", agentName: "Agent POC", model: "gemini-3.8-flash", provider: "gemini", tokens: { input: 12_000, cached: null, uncached: null, output: 1_300, reasoning: null, total: 13_300 }, durationMs: 3_000, toolCalls: [], promptBreakdown: null },
    { sequence: 4, phase: "SYNTHESIS", role: "agent", agentName: "Agent POC", model: "gemini-3.1-flash-lite", provider: "gemini", tokens: { input: 6_000, cached: null, uncached: null, output: 600, reasoning: null, total: 6_600 }, durationMs: 3_000, toolCalls: [], promptBreakdown: null, route: { provider: "GEMINI", tier: "STANDARD", reason: "agent_synthesis → escalado por gating_correction", mode: "CURRENT", escalated: true, fallback: false }, technicalIds: 0 },
  ],
  reference: { runId: "run-0", createdAt: "2026-09-17T10:00:00.000Z", requests: 8, toolCalls: null, tokens: { input: 74_000, output: 2_400, total: 80_207, cached: null }, durationMs: 24_900 },
}

const baseSummary: QaRunSummary = {
  id: "run-1",
  executedBy: "admin",
  executedByName: "Carla",
  resourceType: "AGENT",
  resourceId: "agent-1",
  resourceName: "[POC TOOLS] Diagnóstico de Performance",
  status: "COMPLETED",
  input: {},
  aiCalls: 4,
  inputTokens: 38_000,
  outputTokens: 2_100,
  totalTokens: 40_100,
  durationMs: 12_000,
  errorMessage: null,
  createdAt: "2026-09-17T12:00:00.000Z",
  updatedAt: "2026-09-17T12:00:00.000Z",
  contextSummary: { operatorName: "Mariana Alves", interactionId: null, interactionExternalId: null, interactionStartedAt: null, workflowState: null },
  telemetry,
}
const historicSummary: QaRunSummary = { ...baseSummary, id: "run-old", aiCalls: 8, inputTokens: 74_000, outputTokens: 2_400, totalTokens: 80_207, durationMs: 24_900, telemetry: null }

describe("QA Lab — telemetria de eficiência", () => {
  it("células da listagem: requests, tool calls, rodadas, input/cached/uncached/output/reasoning/total, duração e budgets; provider sem cache → 'Não informado'", () => {
    const cells = Object.fromEntries(telemetryCells(baseSummary).map((cell) => [cell.key, cell.node]))
    expect(cells["Requests IA"]).toBe(4)
    expect(cells.Preflight).toBe(3)
    expect(cells["Tools Agent"]).toBe(7)
    expect(cells["Tools total"]).toBe(10)
    expect(cells.Rodadas).toBe(2)
    expect(cells.Input).toBe("38.000")
    expect(cells.Cached).toBe("Não informado")
    expect(cells.Uncached).toBe("Não informado")
    expect(cells.Output).toBe("2.100")
    expect(cells.Reasoning).toBe("Não informado")
    expect(cells.Total).toBe("40.100")
    expect(cells.Duração).toBe("12,0 s")
  })

  it("run histórico sem telemetria: totais das colunas continuam; Tool calls/rodadas/cached/reasoning = 'Não informado'", () => {
    const cells = Object.fromEntries(telemetryCells(historicSummary).map((cell) => [cell.key, cell.node]))
    expect(cells["Requests IA"]).toBe(8)
    expect(cells.Preflight).toBe("Não informado")
    expect(cells["Tools Agent"]).toBe("Não informado")
    expect(cells["Tools total"]).toBe("Não informado")
    expect(cells.Rodadas).toBe("Não informado")
    expect(cells.Input).toBe("74.000")
    expect(cells.Cached).toBe("Não informado")
    expect(cells.Total).toBe("80.207")
  })

  it("tokens economizados vs run anterior (absoluto e percentual) — só com referência compatível", () => {
    expect(tokensSavedText(telemetry)).toBe("40.107 tokens economizados (-50%) vs execução anterior")
    expect(tokensSavedText({ ...telemetry, reference: null })).toBeNull()
    expect(tokensSavedText({ ...telemetry, tokens: { ...telemetry.tokens, total: null } })).toBeNull()
    expect(deltaOf(4, 8)).toEqual({ absolute: -4, percent: -50 })
    expect(deltaOf(null, 8)).toBeNull()
  })

  it("tabela do histórico (desktop): colunas de telemetria por execução, badges de Tool/Token Budget e 'Não informado' no run antigo", () => {
    withClient(<QaRunsTable runs={[baseSummary, historicSummary]} onOpen={() => {}} />)
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent)
    expect(headers).toEqual(expect.arrayContaining(["Requests IA", "Preflight", "Tools Agent", "Tools total", "Rodadas", "Input", "Cached", "Uncached", "Output", "Reasoning", "Total", "Duração", "Tool Budget", "Token Budget"]))
    const rows = screen.getAllByRole("row").slice(1)
    expect(within(rows[0]!).getByTestId("qa-tool-budget")).toHaveTextContent("7 de 12 (+3 preflight) · Respondida")
    expect(within(rows[0]!).getByTestId("qa-token-budget")).toHaveTextContent("OK")
    expect(within(rows[1]!).queryByTestId("qa-tool-budget")).toBeNull()
    expect(within(rows[1]!).getAllByText("Não informado").length).toBeGreaterThanOrEqual(5)
  })

  it("cards do histórico (mobile): requests, tool calls/rodadas, tokens por tipo, badges e tokens economizados", () => {
    withClient(<QaRunCard run={baseSummary} onOpen={() => {}} />)
    expect(screen.getByText("4 request(s) de IA")).toBeInTheDocument()
    expect(screen.getByText("10 tool call(s) (3 preflight + 7 Agent) · 2 rodada(s)")).toBeInTheDocument()
    expect(screen.getByText(/40\.100 tokens · in 38\.000 · out 2\.100/)).toBeInTheDocument()
    expect(screen.getByText(/cached Não informado · reasoning Não informado/)).toBeInTheDocument()
    expect(screen.getByText(/40\.107 tokens economizados \(-50%\)/)).toBeInTheDocument()
    expect(screen.getByTestId("qa-tool-budget")).toHaveTextContent("7 de 12 (+3 preflight) · Respondida")
    cleanup()
    withClient(<QaRunCard run={historicSummary} onOpen={() => {}} />)
    expect(screen.getByText("Tool calls: não informado")).toBeInTheDocument()
    expect(screen.getByText("Tool Budget: não informado")).toBeInTheDocument()
    expect(screen.getByText("Token Budget: não informado")).toBeInTheDocument()
  })

  it("detalhe: aba 'Tokens e eficiência' com total, antes × depois (diferença absoluta/percentual, requests, tool calls, duração), por fase e por request com as Tools pedidas", () => {
    const run = { ...baseSummary, context: {}, state: null, trace: { steps: [], effects: [], aiCalls: [], people: {}, context: {}, telemetry } } as unknown as QaRun
    withClient(<RunResult run={run} />)
    fireEvent.click(screen.getByRole("button", { name: /Tokens e eficiência/ }))
    const panel = screen.getByTestId("qa-telemetry-panel")
    expect(within(panel).getByTestId("qa-telemetry-totals")).toHaveTextContent("Requests de IA4")
    expect(within(panel).getByTestId("qa-telemetry-totals")).toHaveTextContent("Cached inputNão informado")
    const comparison = within(panel).getByTestId("qa-telemetry-comparison")
    expect(comparison).toHaveTextContent("40.107 tokens economizados (-50%) vs execução anterior")
    const totalRow = within(comparison).getByText("Total de tokens").closest("tr")!
    expect(totalRow).toHaveTextContent("80.207")
    expect(totalRow).toHaveTextContent("40.100")
    expect(totalRow).toHaveTextContent("−40.107 (-50%)")
    expect(within(comparison).getByText("Requests de IA").closest("tr")).toHaveTextContent("−4 (-50%)")
    expect(within(comparison).getByText("Tool calls").closest("tr")).toHaveTextContent("Não informado")
    // V1.2: preflight × Agent × total, IDs técnicos e contexto por categoria; rota por request.
    const totals = within(panel).getByTestId("qa-telemetry-totals")
    expect(totals).toHaveTextContent("Preflight calls3")
    expect(totals).toHaveTextContent("Tool calls (Agent)7")
    expect(totals).toHaveTextContent("Tool calls (total)10 (+1 cache)")
    expect(totals).toHaveTextContent("IDs técnicos no prompt0")
    expect(within(panel).getByTestId("qa-context-breakdown")).toHaveTextContent("Prompt estático44.000 chars (66%)")
    const routed = within(within(panel).getByTestId("qa-telemetry-requests")).getAllByRole("row")
    expect(routed[1]).toHaveTextContent("GEMINI · STANDARD")
    expect(routed[1]).toHaveTextContent("planning · 10 tool schemas · modo CURRENT")
    expect(routed[4]).toHaveTextContent("escalado")
    expect(routed[2]).toHaveTextContent("Não informado")
    expect(within(comparison).getByText("Duração").closest("tr")).toHaveTextContent("24,9 s")
    const phases = within(panel).getByTestId("qa-telemetry-phases")
    expect(within(phases).getByText("Planejamento").closest("tr")).toHaveTextContent("20.200")
    expect(within(phases).getByText("Síntese").closest("tr")).toHaveTextContent("19.900")
    const requests = within(panel).getByTestId("qa-telemetry-requests")
    expect(within(requests).getAllByRole("row")).toHaveLength(5)
    expect(within(requests).getAllByRole("row")[1]).toHaveTextContent("compare_periods, compare_population")
    expect(within(requests).getAllByRole("row")[1]).toHaveTextContent("gemini-3.8-flash")
    expect(within(requests).getAllByRole("row")[1]).toHaveTextContent("sys 10.000 · tools 6.000 (9) · entrada 800 chars")
    expect(within(requests).getAllByRole("row")[4]).toHaveTextContent("gemini-3.1-flash-lite")
  })

  it("detalhe de run histórico: painel explica a ausência de telemetria e mostra só os totais", () => {
    const run = { ...historicSummary, context: {}, state: null, trace: { steps: [], effects: [], aiCalls: [], people: {}, context: {} } } as unknown as QaRun
    withClient(<RunResult run={run} />)
    fireEvent.click(screen.getByRole("button", { name: /Tokens e eficiência/ }))
    const panel = screen.getByTestId("qa-telemetry-panel")
    expect(panel).toHaveTextContent("Execução anterior à telemetria de eficiência")
    expect(within(panel).getByTestId("qa-telemetry-totals")).toHaveTextContent("Total80.207")
    expect(within(panel).queryByTestId("qa-telemetry-comparison")).toBeNull()
  })
})

describe("QA Lab — telemetria V1.3: cache, custo, qualidade (fail-closed) e cobertura (dois universos)", () => {
  const v13: QaRunTelemetry = {
    ...telemetry,
    tokens: { input: 23_000, cached: 9_000, uncached: 14_000, output: 2_100, reasoning: null, total: 25_100 },
    contextBreakdown: { staticPromptChars: 17_000, dynamicPromptChars: 6_500, toolSchemaChars: 10_000, evidenceLedgerChars: 2_400, interactionContentChars: 0, knowledgeContentChars: 4_600, structuredSchemaChars: 2_500, objectiveChars: 900 },
    cache: { mode: "EXPLICIT", cachedTokens: 9_000, hitRate: 0.391, explicitRequests: 3, implicitRequests: 0, cacheKeyVersions: ["a1b2c3d4e5f6"] },
    cost: { total: { status: "ESTIMATED_PROVIDER_COST", currency: "USD", inputCost: 0.0042, cachedInputCost: 0.0003, outputCost: 0.0052, reasoningCost: 0, totalEstimatedCost: 0.0097 }, byPhase: [{ phase: "PLANNING", cost: { status: "ESTIMATED_PROVIDER_COST", currency: "USD", inputCost: 0.002, cachedInputCost: 0.0002, outputCost: 0.0002, reasoningCost: 0, totalEstimatedCost: 0.0024 } }] },
    coverage: { recordedInteractions: 2, analyzedInteractions: 2, recordedCoverage: 1, operationalUniverse: 1267, operationalCoverage: null, universeRelationship: "UNKNOWN", representativeness: "ANECDOTAL", allowedScope: "INTERACTION_SPECIFIC", allowedScopeLabel: "nesta(s) interação(ões)" },
    quality: { gatingStatus: "FALLBACK", envelopePresent: false, correctionAttempted: true, correctionSucceeded: false, fallbackUsed: true, fallbackReason: "ENVELOPE_MISSING", rejectedClaims: 0, claimScopes: [], limitations: 1 },
    promptComponents: [{ id: "agent.identity", static: true, chars: 8_100, requests: 3 }, { id: "investigation.subject", static: false, chars: 600, requests: 3 }],
    reference: { ...telemetry.reference!, tokens: { input: 38_000, output: 2_100, total: 40_100, cached: null }, staticPromptChars: 44_000, toolSchemaChars: 16_000, cost: null },
    perRequest: [{ ...telemetry.perRequest![0]!, classification: { phase: "PLANNING", purpose: "PLANNING", source: "AGENT", semanticType: "INVESTIGATION" }, cache: { mode: "EXPLICIT", cacheKeyVersion: "a1b2c3d4e5f6", cachedTokens: 3_000, hitRate: 0.33 }, cost: { status: "ESTIMATED_PROVIDER_COST", currency: "USD", inputCost: 0.001, cachedInputCost: 0.0001, outputCost: 0.0001, reasoningCost: 0, totalEstimatedCost: 0.0012 } }],
  }

  it("painel: custo estimado (com pricing) e por fase, contexto com prompt dinâmico, seções Cache/Qualidade/Cobertura com 'Não determinado' na cobertura operacional; antes × depois com uncached/estático/schemas/custo", () => {
    const run = { ...baseSummary, context: {}, state: null, trace: { steps: [], effects: [], aiCalls: [], people: {}, context: {}, telemetry: v13 } } as unknown as QaRun
    withClient(<RunResult run={run} />)
    fireEvent.click(screen.getByRole("button", { name: /Tokens e eficiência/ }))
    const panel = screen.getByTestId("qa-telemetry-panel")
    expect(within(panel).getByTestId("qa-telemetry-totals")).toHaveTextContent("Custo estimadoUSD 0,0097")
    expect(within(panel).getByTestId("qa-cost-by-phase")).toHaveTextContent("Planejamento USD 0,0024")
    expect(within(panel).getByTestId("qa-context-breakdown")).toHaveTextContent("Prompt dinâmico (sujeito/KB/materiais)")
    expect(within(panel).getByTestId("qa-prompt-components")).toHaveTextContent("agent.identity 8.100 chars · investigation.subject 600 chars (dinâmico)")
    expect(within(panel).getByTestId("qa-telemetry-cache")).toHaveTextContent("ModoExplícito (prefixo em cache)")
    expect(within(panel).getByTestId("qa-telemetry-cache")).toHaveTextContent("Hit rate39,1%")
    const quality = within(panel).getByTestId("qa-telemetry-quality")
    expect(quality).toHaveTextContent("GatingFallback factual")
    expect(quality).toHaveTextContent("Envelope de evidênciaAusente")
    expect(quality).toHaveTextContent("Fallback factualSim (sem envelope)")
    const coverage = within(panel).getByTestId("qa-telemetry-coverage")
    expect(coverage).toHaveTextContent("Interações disponíveis2")
    expect(coverage).toHaveTextContent("Cobertura das registradas100%")
    expect(coverage).toHaveTextContent("Universo operacional1.267")
    expect(coverage).toHaveTextContent("Cobertura operacionalNão determinado")
    expect(coverage).toHaveTextContent("Relação entre universosNão determinado")
    expect(coverage).toHaveTextContent("Claim scope permitidonesta(s) interação(ões)")
    const comparison = within(panel).getByTestId("qa-telemetry-comparison")
    expect(within(comparison).getByText("Uncached input").closest("tr")).toHaveTextContent("14.000")
    expect(within(comparison).getByText("Prompt estático (chars)").closest("tr")).toHaveTextContent("−27.000")
    expect(within(comparison).getByText("Schemas de ferramentas (chars)").closest("tr")).toHaveTextContent("−6.000")
    expect(within(comparison).getByText("Custo estimado").closest("tr")).toHaveTextContent("Preço não configurado")
    const requests = within(panel).getByTestId("qa-telemetry-requests")
    expect(requests).toHaveTextContent("PLANNING · AGENT")
    expect(requests).toHaveTextContent("explícito")
  })

  it("run sem pricing e sem cache: 'Preço não configurado' e seções informam ausência sem inventar", () => {
    const run = { ...baseSummary, context: {}, state: null, trace: { steps: [], effects: [], aiCalls: [], people: {}, context: {}, telemetry: { ...telemetry, cost: { total: { status: "NOT_CONFIGURED" }, byPhase: [] }, cache: { mode: "NONE", cachedTokens: null, hitRate: null, explicitRequests: 0, implicitRequests: 0, cacheKeyVersions: [] }, quality: null, coverage: null } } } as unknown as QaRun
    withClient(<RunResult run={run} />)
    fireEvent.click(screen.getByRole("button", { name: /Tokens e eficiência/ }))
    const panel = screen.getByTestId("qa-telemetry-panel")
    expect(within(panel).getByTestId("qa-telemetry-totals")).toHaveTextContent("Custo estimadoPreço não configurado")
    expect(within(panel).getByTestId("qa-telemetry-cache")).toHaveTextContent("ModoSem cache")
    expect(within(panel).getByTestId("qa-telemetry-quality")).toHaveTextContent("Sem gating nesta execução")
    expect(within(panel).getByTestId("qa-telemetry-coverage")).toHaveTextContent("Sem investigação com interações")
  })
})

describe("QA Lab — V1.3.1: Investigation outcome (suficiência) e compatibilidade do benchmark (dataset fingerprint)", () => {
  const sufficiency: NonNullable<QaRunTelemetry["sufficiency"]> = {
    objective: "EXPLAIN_INDICATOR_DEVIATION", objectiveLabel: "Explicar o desvio do indicador", requiredScope: null, stopReason: "INSUFFICIENT_DATA", stopReasonLabel: "Dados insuficientes (o que faltava não existe/não tem cobertura)", status: "INSUFFICIENT_DATA",
    stopProposed: true, stopAccepted: false, rejections: [{ round: 2, reasons: ["EMPLOYEE_PATTERN exige evidência representativa"] }],
    needs: { satisfied: 2, open: 0, blocked: 1, notNeeded: 0, items: [{ id: "E_BEHAVIORAL_EVIDENCE", question: "Há evidência de interação?", status: "BLOCKED", material: true, candidateTools: [], blockedBy: "NO_DATA" }] },
    hypotheses: { supported: 1, refuted: 1, open: 1, blocked: 0, material: 2 }, contradictoryEvidence: false, additionalEvidenceCouldChangeConclusion: true, additionalEvidenceCouldIncreaseRequiredScope: false, criticalFacts: [{ ref: "F1", kind: "INDICATOR_STATE", label: "valor × meta" }],
  }

  it("mostra objetivo, claim scope exigido, stop reason, suficiência, needs/hipóteses, stop proposed × accepted com o motivo da recusa", () => {
    const run = { ...baseSummary, context: {}, state: null, trace: { steps: [], effects: [], aiCalls: [], people: {}, context: {}, telemetry: { ...telemetry, sufficiency } } } as unknown as QaRun
    withClient(<RunResult run={run} />)
    fireEvent.click(screen.getByRole("button", { name: /Tokens e eficiência/ }))
    const section = screen.getByTestId("qa-telemetry-sufficiency")
    expect(section).toHaveTextContent("ObjetivoExplicar o desvio do indicador")
    expect(section).toHaveTextContent("Claim scope exigidoQuantitativo (nenhum)")
    expect(section).toHaveTextContent("Stop reasonDados insuficientes")
    expect(section).toHaveTextContent("SuficiênciaDados insuficientes")
    expect(section).toHaveTextContent("Satisfeitas 2 · Abertas 0 · Bloqueadas 1")
    expect(section).toHaveTextContent("Sustentadas 1 · Refutadas 1 · Abertas/bloqueadas 1")
    expect(section).toHaveTextContent("Mais evidência mudaria a conclusãosim")
    expect(screen.getByTestId("qa-stop-decision")).toHaveTextContent("Stop proposed: sim · Stop accepted: nãoRodada 2: EMPLOYEE_PATTERN exige evidência representativa")
    expect(screen.getByTestId("qa-evidence-needs")).toHaveTextContent("E_BEHAVIORAL_EVIDENCE · Bloqueada (dados não existem)")
  })

  it("V1.3.2: recusa na última rodada, fontes de evidência consultadas × disponíveis, amostragem e contagens da análise de interações ficam visíveis (rastreabilidade, sem score)", () => {
    const extended = { ...sufficiency, stopRejectedAtFinalRound: true, remainingMaterialNeeds: ["E_TEMPORAL_COVERAGE"], candidateToolsAvailable: ["get_employee_history"], evidenceSources: { available: ["INTERACTION_CONTENT", "INTERACTION_EVENTS", "TEMPORAL_HISTORY", "KNOWLEDGE"], used: ["INTERACTION_CONTENT", "INTERACTION_EVENTS"] }, samplingStrategy: "TEMPORAL_STRATIFIED", periodIntent: "PERIOD_EVOLUTION", temporal: { temporalComparisonRequired: true, temporalComparisonStatus: "NO_DIFFERENCE_SUPPORTED", availableBuckets: 3, analyzedBuckets: 3, comparedBuckets: ["B1", "B3"], temporalClaimsProposed: 2, temporalClaimsAccepted: 1, temporalClaimsRejected: 1, rejectionReasons: { WRONG_TEMPORAL_POSITION: 1 } }, interactionAnalysis: [{ analyzedTranscriptCount: 8, recordedUniverseCount: 36, universeRelationship: "PARTIAL_COVERAGE", findings: 3, verifiedExcerpts: 9, temporalBucketsCovered: 2, temporalBuckets: 3, evidenceVerification: { candidateExcerptCount: 12, verifiedExcerptCount: 9, rejectedExcerptCount: 3, findingsBeforeVerification: 4, findingsAfterVerification: 3, rejectionReasons: { NOT_LITERAL: 2, WRONG_SPEAKER: 1 } } }], semantic: { analysisCalls: 1, semanticFramesCreated: 8, framesNotReturned: 1, framesEmpty: 2, interactionsWithFindings: 5, strengthFindingsCount: 3, riskFindingsCount: 4, unresolvedNeedsCount: 1, partialNeedsCount: 0, proceduralQuestionsCount: 1, procedureAssertionsCount: 1, crossInteractionPatternsCount: 2, patternsBySupport: { OBSERVED: 0, REPEATED_IN_SAMPLE: 1, RECURRENT_IN_SAMPLE: 0, EMPLOYEE_PATTERN_SUPPORTED: 1 }, patternsByKind: { STRENGTH: 1, RISK: 1, PROCEDURAL: 0, MIXED: 0, NEUTRAL: 0 }, contractViolations: 0, phaseAFindings: 3, phaseBPromotedFindings: 4, promotionRejectedCount: 1, interactionFrictionFindingsCount: 2, findingKindDowngraded: 2, interactionEventsCount: 3, patternsByScope: { SAMPLE: 1, PERIOD: 0, RECORDED_UNIVERSE: 0, EMPLOYEE_PATTERN: 1 }, questionsWithComponents: 2, answerCompletenessDowngraded: 1, needStatusDowngraded: 1, frictionDowngradedByCompleteAnswer: 1, contradictionDowngradedByCorrection: 0, proceduralConsistencyFindings: 1, proceduralDivergenceFindings: 1, proceduralQuestionFindings: 0, patternsByOwnership: { AGENT: 1, INTERACTION: 1, CUSTOMER: 0, PROCESS: 0, UNKNOWN: 0 }, patternsScopeCappedByOwnership: 1, frameContract: { calls: 2, initialComplete: 0, finalComplete: 1, retries: 2, expectedFrames: 16, initialMissingFrames: 9, finalMissingFrames: 1, emptyFrames: 2, duplicateFrames: 1, duplicateFrameObservationsDropped: 3, unexpectedFrames: 3, exampleRefEchoed: 0 } }, outcomeAttribution: { analysisCalls: 1, needsTotal: 9, needsOpen: 4, attributionsDeclared: 4, attributionsAccepted: 4, byAttribution: { AGENT_ACTION: 1, EXTERNAL_DEPENDENCY: 2, NOT_DETERMINED: 1, CUSTOMER_DEPENDENCY: 0, PROCESS_DEPENDENCY: 0 }, agentAttributionRejected: 2, bridges: { PARTIAL_ANSWER: 1, CONTRADICTED_COMMITMENT: 0, PROCEDURAL_DIVERGENCE: 0 }, findingsNeutralized: 3, findingsAgentAttributed: 1, patternsByOwnership: { AGENT: 1, INTERACTION: 1, CUSTOMER: 0, PROCESS: 0, UNKNOWN: 0 }, patternsScopeCappedByOwnership: 1, sidecarStatus: "OK" }, procedural: { analysisCalls: 1, assertionsDeclared: 3, quantitiesParsedAssertion: 2, knowledgeExcerptsAvailable: 4, rulesDeclared: 5, rulesVerified: 3, rulesRejected: 2, evaluations: 3, byStatus: { CONSISTENT: 1, CONTRADICTED: 1, POTENTIAL_DIVERGENCE: 0, INSUFFICIENT_KNOWLEDGE: 1, NOT_APPLICABLE: 0 }, coverage: "PARTIAL", knowledgeSource: "TOOL_RESULTS" } }
    const run = { ...baseSummary, context: {}, state: null, trace: { steps: [], effects: [], aiCalls: [], people: {}, context: {}, telemetry: { ...telemetry, sufficiency: extended, quality: { gatingStatus: "CORRECTED", envelopePresent: true, correctionAttempted: true, correctionSucceeded: true, fallbackUsed: false, fallbackReason: null, rejectedClaims: 1, claimScopes: [], limitations: 0, markerStatus: "VALID", correctionCategories: ["BINDING_FORMAT"], persistentCategories: [], claims: { proposed: 4, acceptedFirstPass: 2, correctionRequired: 2, corrected: 1, dropped: 1, preservedAfterSiblingFailure: 3, recommendationsDropped: 1 }, candidates: { available: 6, selected: 4, delivered: 3, textPolarityMismatch: 1, textScopeMismatch: 0, swapRejected: 0, duplicateSelection: 0 }, salvage: "PARTIAL" } } } } as unknown as QaRun
    withClient(<RunResult run={run} />)
    fireEvent.click(screen.getByRole("button", { name: /Tokens e eficiência/ }))
    expect(screen.getByTestId("qa-stop-final-round")).toHaveTextContent("Stop rejected at final round: sim · lacunas restantes E_TEMPORAL_COVERAGE · ferramentas disponíveis get_employee_history")
    expect(screen.getByTestId("qa-evidence-sources")).toHaveTextContent("Conteúdo das interações ✓ · Eventos por interação ✓ · Histórico/evolução — · Conhecimento — · Amostragem: distribuída no tempo · Período: padrão e evolução (janela longa)")
    expect(screen.getByTestId("qa-interaction-analysis")).toHaveTextContent("8 analisada(s) de 36 registrada(s) · 3 achado(s) · 9 trecho(s) verificado(s) · blocos temporais 2/3")
    // V1.3.3: verificação literal por unidade — só contagens; motivos no detalhe técnico (title).
    expect(screen.getByTestId("qa-evidence-verification")).toHaveTextContent("Evidências semânticas: 12 candidata(s) · 9 validada(s) · 3 descartada(s) · achados 3/4")
    expect(screen.getByTestId("qa-evidence-verification")).toHaveAttribute("title", "NOT_LITERAL: 2 · WRONG_SPEAKER: 1")
    // V1.3.4: comparação temporal ≠ cobertura — compacto, com motivos no detalhe técnico.
    expect(screen.getByTestId("qa-temporal-comparison")).toHaveTextContent("Comparação temporal: 3 bloco(s) disponível(is) · 3 analisado(s) · B1 × B3 comparados · Nenhuma diferença sustentada · claims temporais 1/2 aceitas")
    expect(screen.getByTestId("qa-temporal-comparison")).toHaveAttribute("title", "WRONG_TEMPORAL_POSITION: 1")
    // V1.4.0: resumo da camada semântica — uma linha, contagens; suporte/tipo e frames não devolvidos no detalhe técnico.
    expect(screen.getByTestId("qa-semantic-analysis")).toHaveTextContent("Análise semântica: 8 frame(s) · 5 com finding · 3 força(s) · 4 risco(s) · 1 necessidade(s) não resolvida(s)/parcial(is) · 1 questão(ões) procedimental(is) · 2 pattern(s) entre interações (1 com suporte de padrão do colaborador) · escopo de suporte: 1× SAMPLE · 1× EMPLOYEE_PATTERN · findings: 3 na extração + 4 promovido(s) na síntese (1 promoção(ões) recusada(s)) · 2 atrito(s) sem atribuição")
    expect(screen.getByTestId("qa-semantic-analysis")).toHaveAttribute("title", "patterns por suporte: REPEATED_IN_SAMPLE: 1 · EMPLOYEE_PATTERN_SUPPORTED: 1 · por tipo: STRENGTH: 1 · RISK: 1 · 1 frame(s) não devolvido(s) pelo modelo (criados vazios)")
    expect(screen.getByText("Marker parse status").parentElement).toHaveTextContent("VALID")
    // V1.4.2: escopo de suporte dos patterns (≠ nível) e categoria da correção (BINDING_FORMAT = perda por contrato).
    expect(screen.getByTestId("qa-semantic-analysis")).toHaveTextContent("escopo de suporte: 1× SAMPLE · 1× EMPLOYEE_PATTERN")
    expect(screen.getByText("Correction retry").parentElement).toHaveTextContent("1 (aceita) · BINDING_FORMAT")
    // V1.4.5: interpretação semântica (derivações que rebaixaram o declarado) e funil procedimental determinístico.
    expect(screen.getByTestId("qa-semantic-analysis")).toHaveTextContent("interpretação: 1 resposta(s) rebaixada(s) por componente · 1 necessidade(s) rebaixada(s) de resolvida · 1 atrito(s) sem materialidade")
    // V1.4.6.8: completude estrutural da Fase A (MISSING ≠ EMPTY; duplicados e inesperados separados).
    expect(screen.getByTestId("qa-frame-contract")).toHaveTextContent("Contrato de frames: 0/2 completo(s) na 1ª resposta · 1/2 após retry (2 retry) · ausentes 9 → 1 · duplicados 1 · inesperados 3 · vazios 2")
    expect(screen.getByTestId("qa-procedural-evaluation")).toHaveTextContent("Avaliação procedimental: 3 afirmação(ões) normativa(s) · 3 regra(s) da base com trecho literal · 3 comparação(ões) — 1× CONSISTENT · 1× CONTRADICTED · 1× INSUFFICIENT_KNOWLEDGE · cobertura PARCIAL (só os pontos verificados)")
    // V1.4.6: resultado × atribuição — necessidade aberta não é, por si, falha do operador.
    expect(screen.getByTestId("qa-outcome-attribution")).toHaveTextContent("Necessidades: 4 em aberto de 9 — 1× AGENT_ACTION · 2× EXTERNAL_DEPENDENCY · 1× NOT_DETERMINED · 1 ligada(s) à conduta do operador · 3 mantida(s) como resultado da interação · 2 atribuição(ões) ao operador recusada(s) por falta de ponte · 1 pattern(s) com teto reduzido por não serem de conduta do operador")
    expect(screen.getByTestId("qa-procedural-evaluation")).toHaveAttribute("title", "trechos da base disponíveis: 4 (TOOL_RESULTS) · regras declaradas 5, recusadas 2 (trecho não literal, documento inexistente ou assunto vazio)")
    // V1.4.3: destino por afirmação — uma inválida não apaga as válidas (salvamento parcial).
    // V1.4.4: candidatos projetados pela aplicação; o que sobra de erro é de TEXTO.
    expect(screen.getByTestId("qa-claim-candidates")).toHaveTextContent("6 candidato(s) · 4 selecionado(s) · 3 entregue(s) · 1 texto(s) com polaridade incompatível")
    expect(screen.getByTestId("qa-claim-salvage")).toHaveTextContent("4 proposta(s) · 3 aceita(s) (1 após correção) · 1 descartada(s) · 3 preservada(s) apesar de irmã inválida · 1 recomendação(ões) descartada(s) · salvamento parcial")
  })

  it("V1.3.4.1: diferença SÓ NA AMOSTRA aparece como tal (nunca como 'diferença sustentada'); campos novos opcionais não quebram runs antigos", () => {
    const extended = { ...sufficiency, temporal: { temporalComparisonRequired: true, temporalComparisonStatus: "SAMPLE_DIFFERENCE_ONLY", availableBuckets: 3, analyzedBuckets: 3, comparedBuckets: ["B1", "B3"], temporalClaimsProposed: 1, temporalClaimsAccepted: 0, temporalClaimsRejected: 1, rejectionReasons: { SAMPLE_DIFFERENCE_ONLY: 1 }, sampleDifferenceDetected: true, absenceEstablished: false } }
    const run = { ...baseSummary, context: {}, state: null, trace: { steps: [], effects: [], aiCalls: [], people: {}, context: {}, telemetry: { ...telemetry, sufficiency: extended } } } as unknown as QaRun
    withClient(<RunResult run={run} />)
    fireEvent.click(screen.getByRole("button", { name: /Tokens e eficiência/ }))
    expect(screen.getByTestId("qa-temporal-comparison")).toHaveTextContent("Comparação temporal: 3 bloco(s) disponível(is) · 3 analisado(s) · B1 × B3 comparados · Diferença só na amostra · claims temporais 0/1 aceitas")
    expect(screen.getByTestId("qa-temporal-comparison")).toHaveAttribute("title", "SAMPLE_DIFFERENCE_ONLY: 1")
  })

  it("V1.3.4.2: a conclusão temporal AUTORIZADA aparece ('nenhuma diferença sustentada (não é estabilidade)') com a formulação segura no title; NOT_COMPARED não aparece", () => {
    const conclusion = { kind: "NO_DIFFERENCE_SUPPORTED", safeMeaning: "Não foi encontrada diferença temporal sustentada nas evidências analisadas.", allowedRelations: [] }
    const extended = { ...sufficiency, temporal: { temporalComparisonRequired: true, temporalComparisonStatus: "NO_DIFFERENCE_SUPPORTED", availableBuckets: 3, analyzedBuckets: 3, comparedBuckets: ["B1", "B3"], temporalClaimsProposed: 0, temporalClaimsAccepted: 0, temporalClaimsRejected: 0, rejectionReasons: { TEMPORAL_CONCLUSION_INCOMPATIBLE: 1 }, conclusion } }
    const run = { ...baseSummary, context: {}, state: null, trace: { steps: [], effects: [], aiCalls: [], people: {}, context: {}, telemetry: { ...telemetry, sufficiency: extended } } } as unknown as QaRun
    const { unmount } = withClient(<RunResult run={run} />)
    fireEvent.click(screen.getByRole("button", { name: /Tokens e eficiência/ }))
    expect(screen.getByTestId("qa-temporal-conclusion")).toHaveTextContent("Conclusão autorizada: nenhuma diferença sustentada (não é estabilidade)")
    expect(screen.getByTestId("qa-temporal-conclusion")).toHaveAttribute("title", conclusion.safeMeaning)
    expect(screen.getByTestId("qa-temporal-comparison")).toHaveAttribute("title", "TEMPORAL_CONCLUSION_INCOMPATIBLE: 1")
    unmount()
    const notCompared = { ...extended, temporal: { ...extended.temporal, conclusion: { ...conclusion, kind: "NOT_COMPARED" } } }
    withClient(<RunResult run={{ ...run, trace: { ...run.trace, telemetry: { ...telemetry, sufficiency: notCompared } } } as unknown as QaRun} />)
    fireEvent.click(screen.getByRole("button", { name: /Tokens e eficiência/ }))
    expect(screen.queryByTestId("qa-temporal-conclusion")).toBeNull()
  })

  it("dataset diferente: aviso, sem percentual de economia e sem deltas; mesma massa: comparação normal; run antigo: UNKNOWN com deltas", () => {
    const changed = { ...telemetry, comparison: { status: "DATASET_CHANGED" as const, current: "a", reference: "b", message: "Dataset diferente — comparação não diretamente válida (percentuais omitidos; valores lado a lado)." } }
    const { unmount } = withClient(<RunResult run={{ ...baseSummary, context: {}, state: null, trace: { steps: [], effects: [], aiCalls: [], people: {}, context: {}, telemetry: changed } } as unknown as QaRun} />)
    fireEvent.click(screen.getByRole("button", { name: /Tokens e eficiência/ }))
    const comparison = screen.getByTestId("qa-telemetry-comparison")
    expect(screen.getByTestId("qa-benchmark-compatibility")).toHaveTextContent("Dataset diferente")
    expect(comparison).not.toHaveTextContent("tokens economizados")
    expect(within(comparison).getByText("Total de tokens").closest("tr")).toHaveTextContent("Dataset diferente")
    unmount()
    withClient(<RunResult run={{ ...baseSummary, context: {}, state: null, trace: { steps: [], effects: [], aiCalls: [], people: {}, context: {}, telemetry: { ...telemetry, comparison: { status: "UNKNOWN" as const, current: null, reference: null, message: "Compatibilidade da massa não verificável (execução sem fingerprint) — diferenças mostradas sem garantia de comparabilidade." } } } } as unknown as QaRun} />)
    fireEvent.click(screen.getByRole("button", { name: /Tokens e eficiência/ }))
    expect(screen.getByTestId("qa-benchmark-compatibility")).toHaveTextContent("não verificável")
    expect(screen.getByTestId("qa-benchmark-compatibility")).toHaveTextContent("Dataset da referência: Não informado")
    expect(screen.getByTestId("qa-telemetry-comparison")).toHaveTextContent("40.107 tokens economizados")
  })

  it("dataset de diagnóstico: linha discreta com versão + fingerprint resumido (hash inteiro no title); não aplicável fora da massa; 'Não informado' em run antigo; versões no aviso de dataset diferente", () => {
    const applied = { ...telemetry, dataset: { status: "APPLIED" as const, version: "DIAGNOSTIC_DATASET_V1_1", fingerprint: "ab530ce1e398f01afb41d5144093ed29286d9f03025cc9d6069b4ab80b641b46", shortFingerprint: "ab530ce1…1b46", hash: "0123456789abcdef" }, comparison: { status: "DATASET_CHANGED" as const, current: "a", reference: "b", currentDataset: "DIAGNOSTIC_DATASET_V1_1", referenceDataset: "DIAGNOSTIC_DATASET_V1", message: "Dataset diferente — comparação de eficiência não diretamente válida (percentuais omitidos; valores lado a lado). Dataset: DIAGNOSTIC_DATASET_V1 → DIAGNOSTIC_DATASET_V1_1." } }
    const { unmount } = withClient(<RunResult run={{ ...baseSummary, context: {}, state: null, trace: { steps: [], effects: [], aiCalls: [], people: {}, context: {}, telemetry: applied } } as unknown as QaRun} />)
    fireEvent.click(screen.getByRole("button", { name: /Tokens e eficiência/ }))
    const line = screen.getByTestId("qa-dataset")
    expect(line).toHaveTextContent("Dataset DIAGNOSTIC_DATASET_V1_1 · fingerprint ab530ce1…1b46")
    expect(line).toHaveAttribute("title", "ab530ce1e398f01afb41d5144093ed29286d9f03025cc9d6069b4ab80b641b46")
    expect(line).not.toHaveTextContent("e398f01afb41d5144093ed")
    expect(screen.getByTestId("qa-benchmark-compatibility")).toHaveTextContent("DIAGNOSTIC_DATASET_V1 → DIAGNOSTIC_DATASET_V1_1")
    expect(screen.getByTestId("qa-telemetry-comparison")).not.toHaveTextContent("tokens economizados")
    unmount()
    const notApplicable = withClient(<RunResult run={{ ...baseSummary, context: {}, state: null, trace: { steps: [], effects: [], aiCalls: [], people: {}, context: {}, telemetry: { ...telemetry, dataset: { status: "NOT_APPLICABLE" as const, version: null, fingerprint: null, shortFingerprint: null, hash: "0123" } } } } as unknown as QaRun} />)
    fireEvent.click(screen.getByRole("button", { name: /Tokens e eficiência/ }))
    expect(screen.getByTestId("qa-dataset")).toHaveTextContent("Dataset: não aplicável")
    notApplicable.unmount()
    withClient(<RunResult run={{ ...baseSummary, context: {}, state: null, trace: { steps: [], effects: [], aiCalls: [], people: {}, context: {}, telemetry: { ...telemetry, dataset: undefined } } } as unknown as QaRun} />)
    fireEvent.click(screen.getByRole("button", { name: /Tokens e eficiência/ }))
    expect(screen.getByTestId("qa-dataset")).toHaveTextContent("Dataset: Não informado")
  })
})
