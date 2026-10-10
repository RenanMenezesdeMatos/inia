import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"

const generateWithTools = vi.fn()
const executeTool = vi.fn()
vi.mock("../../assistant/infrastructure/gemini-function-calling-client.js", () => ({ generateWithTools: (...args: unknown[]) => generateWithTools(...args) }))
vi.mock("./tool-executor.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./tool-executor.js")>()
  return { ...original, executeTool: (...args: unknown[]) => executeTool(...args) }
})

const { runInvestigation, renderDossier, buildLedger, INVESTIGATION_POLICY, accountRequests } = await import("./investigation-runtime.js")
const { STATE_MARKER } = await import("../domain/evidence-sufficiency.js")
type ToolInvocationTrace = import("../domain/tool-trace.js").ToolInvocationTrace

const subject = { operatorId: "op-1", operatorName: "Camila Fonseca", teamId: "team-1", teamName: "B2C · Atendimento Geral", subteamId: "sub-1", subteamName: "Voz", interactionId: null, indicatorCode: "TMA" }
const period = { start: new Date("2026-08-18T03:00:00Z"), end: new Date("2026-09-17T03:00:00Z"), label: "2026-08-18 a 2026-09-16" }
const db = { query: vi.fn(async () => ({ rows: [{ count: "2" }], rowCount: 1 })) } as unknown as Database
// V1.3.1: objetivo DESCRIBE_PERFORMANCE ("qual foi…") — a comparação não é necessidade material, então os cenários
// de mecânica (preflight, ondas, pruning, orçamento) podem parar com o texto do modelo; os cenários do controlador de
// suficiência (EXPLAIN/EMPLOYEE_PATTERN) ficam no bloco V1.3.1 abaixo.
const baseInput = { db, organizationId: "org", agentId: "agent-1", systemPrompt: "Você é o Agent.", subject, defaultPeriod: period, objective: "Diagnostique o TMA.", objectiveContext: { query: "qual foi meu TMA?" }, now: new Date("2026-09-17T12:00:00Z"), timeZone: "America/Fortaleza", tokenThresholds: { total: 60_000, input: 50_000, output: 8_000 } }

const okResult = (summary: unknown, quality: Record<string, unknown> = {}) => ({ data: summary, quality: { status: "SUFFICIENT", sampleCount: 20, coverage: 0.95, freshness: "FRESH", ...quality }, provenance: { period: { start: period.start.toISOString(), end: period.end.toISOString(), label: period.label }, population: "colaborador", filters: [], dataSource: "MEASUREMENT", method: "resolvedor único de medições (detalhe técnico longo)" } })
const snapshot = okResult({ indicator: { code: "TMA" }, operational: { formatted: "467.04 s", sampleCount: 21, coverage: 1 }, target: { value: 400, withinTarget: false }, official: null })
const quality = okResult({ analysisStatus: "SUFFICIENT", sampleCount: 21, minimumSample: 10, coverage: 1, minimumCoverage: 0.8 })
const dimensions = okResult({ indicator: { code: "TMA" }, dimensions: [{ dimension: "DAY", available: true }, { dimension: "SUBJECT", available: true }, { dimension: "CHANNEL", available: false }], interactionsInPeriod: 2 })
const usage = (promptTokens: number, outputTokens: number, cached: number | null = null) => ({ promptTokens, outputTokens, totalTokens: promptTokens + outputTokens, cachedInputTokens: cached, reasoningTokens: null })
const text = (value: string, tokens = usage(1000, 100)) => ({ kind: "text", text: value, usage: tokens, durationMs: 50, model: "gemini-test" })
const calls = (list: { name: string; args: Record<string, unknown> }[], tokens = usage(1000, 50)) => ({ kind: "functionCalls", calls: list, usage: tokens, durationMs: 50, model: "gemini-test" })

/** Preflight do indicador em foco: snapshot + qualidade + dimensões (3 chamadas determinísticas, rodada 0). */
function mockPreflight() {
  executeTool.mockImplementation(async (_context: unknown, tool: { key: string }) => {
    if (tool.key === "get_indicator_snapshot") return snapshot
    if (tool.key === "validate_data_quality") return quality
    if (tool.key === "get_available_dimensions") return dimensions
    throw new Error(`sem mock para ${tool.key}`)
  })
}

const allCapabilities = ["INDICATOR_ANALYSIS", "SEGMENTATION", "OPERATIONAL_COMPARISON", "INTERACTION_ANALYSIS", "WORK_CONTEXT", "KNOWLEDGE", "SUPPORT_MATERIALS"] as const

beforeEach(() => {
  generateWithTools.mockReset()
  executeTool.mockReset()
})

describe("runInvestigation V1.1 — preflight determinístico", () => {
  it("sem capacidades não há investigação (NO_TOOLS), nenhum preflight e nenhuma request", async () => {
    const outcome = await runInvestigation({ ...baseInput, capabilities: [] })
    expect(outcome.summary.outcome).toBe("NO_TOOLS")
    expect(outcome.trace).toEqual([])
    expect(generateWithTools).not.toHaveBeenCalled()
    expect(executeTool).not.toHaveBeenCalled()
  })

  it("indicador em foco: snapshot + qualidade + dimensões rodam ANTES da 1ª request (rodada 0, em paralelo) e entram no contexto inicial; as Tools preflighted não são declaradas", async () => {
    mockPreflight()
    generateWithTools.mockResolvedValueOnce(text("Fatos: F1 TMA 467.04 s. Amostra de interações insuficiente."))
    const outcome = await runInvestigation({ ...baseInput, capabilities: ["INDICATOR_ANALYSIS", "SEGMENTATION"] })
    expect(executeTool).toHaveBeenCalledTimes(3)
    expect(outcome.trace.map((item) => [item.tool, item.round, item.concurrency, item.status])).toEqual([
      ["get_indicator_snapshot", 0, 3, "COMPLETED"],
      ["validate_data_quality", 0, 3, "COMPLETED"],
      ["get_available_dimensions", 0, 3, "COMPLETED"],
    ])
    expect(outcome.summary).toMatchObject({ toolCalls: 3, preflightCalls: 3, planningRounds: 0, outcome: "ANSWERED", requests: 1 })
    const [turns, systemPrompt, declarations] = generateWithTools.mock.calls[0]! as [{ text: string }[], string, { name: string }[]]
    expect(turns[0]!.text).toContain("CONTEXTO INICIAL")
    expect(turns[0]!.text).toContain("F1 (get_indicator_snapshot indicatorCode=TMA): TMA: 467.04 s no período · meta 400 (fora)")
    expect(turns[0]!.text).toContain("Dimensões disponíveis para segmentar: DAY, SUBJECT.")
    expect(turns[0]!.text).toContain("Interações do colaborador no período: 2.")
    expect(systemPrompt).toContain(INVESTIGATION_POLICY)
    const names = declarations.map((tool) => tool.name)
    expect(names).not.toContain("get_indicator_snapshot")
    expect(names).not.toContain("validate_data_quality")
    expect(names).not.toContain("get_available_dimensions")
    expect(names).not.toContain("synthesize_evidence")
    expect(names).toEqual(expect.arrayContaining(["compare_periods", "segment_indicator", "detect_anomalies", "get_employee_history"]))
  })

  it("interação em foco: get_interaction_context roda no preflight sem argumentos", async () => {
    executeTool.mockResolvedValueOnce(okResult({ localDate: "2026-09-10", localTime: "10:00", subject: "Fatura", durationSeconds: 300, flags: [] }))
    generateWithTools.mockResolvedValueOnce(text("notas"))
    const outcome = await runInvestigation({ ...baseInput, subject: { ...subject, indicatorCode: null, interactionId: "int-1" }, capabilities: ["INTERACTION_ANALYSIS"] })
    expect(outcome.trace[0]).toMatchObject({ tool: "get_interaction_context", round: 0, status: "COMPLETED", ledgerRef: "F1" })
    expect(outcome.summary.preflightCalls).toBe(1)
  })
})

describe("runInvestigation V1.1 — ondas paralelas, ledger, compactação e pruning", () => {
  it("uma decisão do modelo pede várias Tools independentes; elas rodam em PARALELO (concurrency no trace), a sequência é lógica e o resultado volta em UMA rodada", async () => {
    mockPreflight()
    const order: string[] = []
    executeTool.mockImplementation(async (_context: unknown, tool: { key: string }) => {
      if (tool.key === "get_indicator_snapshot") return snapshot
      if (tool.key === "validate_data_quality") return quality
      if (tool.key === "get_available_dimensions") return dimensions
      order.push(`start:${tool.key}`)
      await new Promise((resolve) => setTimeout(resolve, tool.key === "compare_periods" ? 30 : 5))
      order.push(`end:${tool.key}`)
      if (tool.key === "compare_periods") return okResult({ current: { value: 467.04, period: "ago" }, reference: { value: 525.5, period: "jul" }, absoluteDifference: -58.46, relativeDifferencePercent: -11.1, performanceDirection: "IMPROVED" })
      return okResult({ reference: "SUBGROUP", targetValue: 467.04, referenceValue: 406.87, referencePopulation: 24, difference: 60.17, differencePercent: 14.8, performance: "WORSE_THAN_REFERENCE" })
    })
    generateWithTools
      .mockResolvedValueOnce(calls([{ name: "compare_periods", args: { indicatorCode: "TMA" } }, { name: "compare_population", args: { indicatorCode: "TMA", reference: "SUBGROUP" } }]))
      .mockResolvedValueOnce(text("Fatos: F4 melhorou 11,1%; F5 14,8% acima do subgrupo."))
    const outcome = await runInvestigation({ ...baseInput, capabilities: ["INDICATOR_ANALYSIS", "OPERATIONAL_COMPARISON"] })
    // compare_population terminou antes de compare_periods (paralelo), mas a sequência é a do pedido.
    expect(order).toEqual(["start:compare_periods", "start:compare_population", "end:compare_population", "end:compare_periods"])
    expect(outcome.trace.map((item) => [item.sequence, item.tool, item.round, item.concurrency])).toEqual([
      [1, "get_indicator_snapshot", 0, 2],
      [2, "validate_data_quality", 0, 2],
      [3, "compare_periods", 1, 2],
      [4, "compare_population", 1, 2],
    ])
    expect(outcome.summary).toMatchObject({ toolCalls: 4, preflightCalls: 2, planningRounds: 1, parallelWaves: 2, outcome: "ANSWERED", requests: 2 })
    expect(outcome.ledger.map((entry) => entry.ref)).toEqual(["F1", "F2", "F3", "F4"])
    expect(outcome.trace[2]!.ledgerRef).toBe("F3")
    expect(generateWithTools).toHaveBeenCalledTimes(2)
  })

  it("ledger compacto: sem UUID/measurementId/timestamp/method/proveniência integral; o trace completo continua com tudo", async () => {
    mockPreflight()
    executeTool.mockImplementation(async (_context: unknown, tool: { key: string }) => {
      if (tool.key === "get_indicator_snapshot") return snapshot
      if (tool.key === "validate_data_quality") return quality
      if (tool.key === "get_available_dimensions") return dimensions
      return okResult({ returned: 2, total: 2, orderBy: "RECENT", interactions: [{ interactionId: "5a0b6d1e-1111-4c1c-9c2c-aaaaaaaaaaaa", startedAt: "2026-09-10T13:00:00.000Z" }] })
    })
    generateWithTools.mockResolvedValueOnce(calls([{ name: "find_interactions", args: {} }])).mockResolvedValueOnce(text("notas"))
    const outcome = await runInvestigation({ ...baseInput, capabilities: allCapabilities as unknown as (typeof allCapabilities)[number][] })
    const rendered = outcome.dossier
    expect(rendered).toContain("F4 (find_interactions): 2 de 2 interação(ões) (RECENT)")
    expect(rendered).not.toContain("5a0b6d1e")
    expect(rendered).not.toContain("resolvedor único")
    expect(rendered).not.toContain("2026-09-10T13:00")
    // Trace persistido: proveniência integral (method) preservada.
    expect(outcome.trace[3]!.provenance?.method).toContain("resolvedor único")
    // O 2º prompt (notas) recebe o detalhe SÓ da última onda — com HANDLES (I1), nunca o UUID — e o ledger do resto.
    const notesPrompt = (generateWithTools.mock.calls[1]![0] as { text: string }[])[0]!.text
    expect(notesPrompt).toContain("RESULTADOS DA ÚLTIMA RODADA")
    expect(notesPrompt).toContain('"interaction":"I1"')
    expect(notesPrompt).not.toContain("5a0b6d1e-1111-4c1c-9c2c-aaaaaaaaaaaa")
    expect(notesPrompt).not.toContain("startedAt")
    expect(notesPrompt).toContain("F1 (get_indicator_snapshot")
  })

  it("compactação por rodada: a rodada N recebe objetivo + ledger + limitações + detalhe da última onda + orçamento — nunca o histórico de function calls (contents = 1 turno)", async () => {
    mockPreflight()
    executeTool.mockImplementation(async (_context: unknown, tool: { key: string }) => {
      if (tool.key === "get_indicator_snapshot") return snapshot
      if (tool.key === "validate_data_quality") return quality
      if (tool.key === "get_available_dimensions") return dimensions
      if (tool.key === "compare_population") return okResult({ reference: "SUBGROUP", targetValue: 467, referenceValue: 406, referencePopulation: 24, difference: 61, differencePercent: 14.8, performance: "WORSE_THAN_REFERENCE" })
      return okResult({ returned: 2, total: 2, orderBy: "RECENT", interactions: [{ interactionId: "i-1" }, { interactionId: "i-2" }] })
    })
    generateWithTools
      .mockResolvedValueOnce(calls([{ name: "compare_population", args: { indicatorCode: "TMA", reference: "SUBGROUP" } }]))
      .mockResolvedValueOnce(calls([{ name: "find_interactions", args: {} }]))
      .mockResolvedValueOnce(text("notas finais"))
    const outcome = await runInvestigation({ ...baseInput, capabilities: allCapabilities as unknown as (typeof allCapabilities)[number][] })
    expect(outcome.summary.planningRounds).toBe(2)
    for (const call of generateWithTools.mock.calls) {
      const turns = call[0] as { role: string; text?: string }[]
      expect(turns).toHaveLength(1)
      expect(turns[0]!.role).toBe("user")
      expect(turns[0]!.text).toContain("OBJETIVO DA INVESTIGAÇÃO")
    }
    const round2 = (generateWithTools.mock.calls[1]![0] as { text: string }[])[0]!.text
    expect(round2).toContain("rodada 2 de 3")
    expect(round2).toContain("## F4 compare_population")
    expect(round2).toContain("EVIDÊNCIAS ACUMULADAS")
    // Pruning por pré-requisito: analyze_interactions só é declarada quando há ids conhecidos (após find_interactions).
    const declaredRound2 = (generateWithTools.mock.calls[1]![2] as { name: string }[]).map((tool) => tool.name)
    expect(declaredRound2).not.toContain("analyze_interactions")
    const declaredRound3 = (generateWithTools.mock.calls[2]![2] as { name: string }[]).map((tool) => tool.name)
    expect(declaredRound3).toContain("analyze_interactions")
    expect(declaredRound3).toContain("analyze_peer_patterns")
    // A rodada 3 ainda tem ferramentas declaradas (é a última) e o modelo escolheu escrever as notas.
    expect(outcome.notes).toBe("notas finais")
  })

  it("sem interações no período: nenhuma Tool de interação é declarada e a limitação fica registrada", async () => {
    executeTool.mockImplementation(async (_context: unknown, tool: { key: string }) => {
      if (tool.key === "get_indicator_snapshot") return snapshot
      if (tool.key === "validate_data_quality") return quality
      if (tool.key === "get_available_dimensions") return okResult({ indicator: { code: "TMA" }, dimensions: [{ dimension: "DAY", available: true }], interactionsInPeriod: 0 })
      throw new Error("inesperado")
    })
    generateWithTools.mockResolvedValueOnce(text("notas"))
    const outcome = await runInvestigation({ ...baseInput, capabilities: allCapabilities as unknown as (typeof allCapabilities)[number][] })
    const declared = (generateWithTools.mock.calls[0]![2] as { name: string }[]).map((tool) => tool.name)
    expect(declared.some((name) => ["find_interactions", "analyze_interactions", "get_interaction_flags", "find_comparable_interactions", "analyze_peer_patterns"].includes(name))).toBe(false)
    expect(declared).toContain("inspect_work_context")
    expect(declared).toContain("query_knowledge")
    expect(outcome.limitations[0]).toContain("nenhuma interação do colaborador registrada no período")
    expect(outcome.dossier).toContain("LIMITAÇÕES E NÃO INVESTIGADO: nenhuma interação")
  })
})

describe("runInvestigation V1.1 — limites, cache, enforcement e tokens", () => {
  it("limite de rodadas de planejamento: após maxPlanningRounds o loop para e UMA request sem ferramentas escreve as notas (não conta como rodada)", async () => {
    mockPreflight()
    executeTool.mockImplementation(async (_context: unknown, tool: { key: string }) => {
      if (tool.key === "get_indicator_snapshot") return snapshot
      if (tool.key === "validate_data_quality") return quality
      if (tool.key === "get_available_dimensions") return dimensions
      return okResult({ pattern: "STABLE", baseline: 460, anomalies: [], pointsAnalyzed: 21 })
    })
    generateWithTools
      .mockResolvedValueOnce(calls([{ name: "detect_anomalies", args: { indicatorCode: "TMA" } }]))
      .mockResolvedValueOnce(calls([{ name: "detect_anomalies", args: { indicatorCode: "TMA", period: { from: "2026-07-01", to: "2026-07-31" } } }]))
      .mockResolvedValueOnce(text("notas após o limite"))
    const outcome = await runInvestigation({ ...baseInput, capabilities: ["INDICATOR_ANALYSIS"], maxPlanningRounds: 2 })
    expect(outcome.summary).toMatchObject({ planningRounds: 2, maxPlanningRounds: 2, requests: 3, outcome: "ANSWERED" })
    expect(outcome.notes).toBe("notas após o limite")
    expect((generateWithTools.mock.calls[2]! as unknown[])[2]).toEqual([])
    expect(outcome.limitations).toContain("limite de 2 rodadas de planejamento atingido")
  })

  it("orçamento (teto): chamadas além de maxToolCalls viram BUDGET_EXCEEDED, o loop para (BUDGET_EXHAUSTED) e as notas saem sem ferramentas; alvo fica registrado", async () => {
    mockPreflight()
    executeTool.mockImplementation(async (_context: unknown, tool: { key: string }) => {
      if (tool.key === "get_indicator_snapshot") return snapshot
      if (tool.key === "validate_data_quality") return quality
      if (tool.key === "get_available_dimensions") return dimensions
      return okResult({ layer: "OPERATIONAL", series: [] })
    })
    generateWithTools
      .mockResolvedValueOnce(calls([{ name: "get_employee_history", args: { indicatorCode: "TMA", layer: "OPERATIONAL" } }, { name: "get_employee_history", args: { indicatorCode: "TMA", layer: "OFFICIAL" } }]))
      .mockResolvedValueOnce(text("notas com o que deu"))
    // V1.2: o orçamento é só das Tools ESCOLHIDAS pelo Agent — as 2 do preflight não contam.
    const outcome = await runInvestigation({ ...baseInput, capabilities: ["INDICATOR_ANALYSIS"], maxToolCalls: 1, targetToolCalls: 1 })
    expect(outcome.trace.map((item) => item.status)).toEqual(["COMPLETED", "COMPLETED", "COMPLETED", "BUDGET_EXCEEDED"])
    expect(outcome.summary).toMatchObject({ toolCalls: 3, preflightCalls: 2, investigationToolCalls: 1, rejectedCalls: 1, budget: 1, targetToolCalls: 1, outcome: "BUDGET_EXHAUSTED", planningRounds: 1 })
    expect((generateWithTools.mock.calls[1]! as unknown[])[2]).toEqual([])
    expect(outcome.limitations).toContain("orçamento de 1 chamadas esgotado")
  })

  it("cache por execução: mesma Tool + mesmos argumentos na MESMA onda ou em ondas diferentes não executa de novo (CACHED, contado à parte)", async () => {
    executeTool.mockImplementation(async (_context: unknown, tool: { key: string }) => {
      if (tool.key === "get_indicator_snapshot") return snapshot
      if (tool.key === "validate_data_quality") return quality
      return okResult({ reference: "SUBGROUP", targetValue: 1, referenceValue: 1, referencePopulation: 24, difference: 0, differencePercent: 0, performance: "SIMILAR" })
    })
    generateWithTools
      .mockResolvedValueOnce(calls([{ name: "compare_population", args: { indicatorCode: "TMA", reference: "SUBGROUP" } }, { name: "compare_population", args: { reference: "SUBGROUP", indicatorCode: "TMA" } }]))
      .mockResolvedValueOnce(calls([{ name: "compare_population", args: { indicatorCode: "TMA", reference: "SUBGROUP" } }]))
      .mockResolvedValueOnce(text("ok"))
    const outcome = await runInvestigation({ ...baseInput, capabilities: ["INDICATOR_ANALYSIS", "OPERATIONAL_COMPARISON"] })
    expect(executeTool).toHaveBeenCalledTimes(3) // 2 preflight + 1 compare_population
    expect(outcome.summary).toMatchObject({ toolCalls: 3, cachedCalls: 2 })
    expect(outcome.trace.map((item) => item.status)).toEqual(["COMPLETED", "COMPLETED", "COMPLETED", "CACHED", "CACHED"])
    const round2 = (generateWithTools.mock.calls[1]![0] as { text: string }[])[0]!.text
    expect(round2).toContain('"cached":true')
  })

  it("capability enforcement: Tool fora das capacidades é REJECTED (nunca executada); argumentos inválidos REJECTED sem consumir orçamento; falha vira FAILED e a investigação continua", async () => {
    executeTool.mockImplementation(async (_context: unknown, tool: { key: string }) => {
      if (tool.key === "get_indicator_snapshot") return snapshot
      if (tool.key === "validate_data_quality") return quality
      throw new Error("timeout do banco")
    })
    generateWithTools
      .mockResolvedValueOnce(calls([{ name: "find_interactions", args: {} }, { name: "compare_periods", args: { indicatorCode: "" } }, { name: "compare_periods", args: { indicatorCode: "TMA" } }]))
      .mockResolvedValueOnce(text("notas"))
    const outcome = await runInvestigation({ ...baseInput, capabilities: ["INDICATOR_ANALYSIS"] })
    expect(outcome.trace.slice(2).map((item) => item.status)).toEqual(["REJECTED", "REJECTED", "FAILED"])
    expect(outcome.trace[2]!.error).toBe("TOOL_NOT_AVAILABLE")
    expect(outcome.trace[3]!.error).toContain("Argumentos inválidos")
    expect(outcome.summary).toMatchObject({ toolCalls: 3, rejectedCalls: 2, outcome: "ANSWERED" })
    expect(outcome.trace[4]!.error).toBe("timeout do banco")
    expect(executeTool).toHaveBeenCalledTimes(3)
  })

  it("recommend_support_materials e synthesize_evidence nunca são declaradas (incorporadas à síntese final), mas continuam recusáveis se o modelo insistir", async () => {
    executeTool.mockResolvedValue(snapshot)
    generateWithTools.mockResolvedValueOnce(calls([{ name: "recommend_support_materials", args: { selections: [] } }])).mockResolvedValueOnce(text("notas"))
    const outcome = await runInvestigation({ ...baseInput, subject: { ...subject, indicatorCode: null }, capabilities: ["SUPPORT_MATERIALS", "KNOWLEDGE"] })
    const declared = (generateWithTools.mock.calls[0]![2] as { name: string }[]).map((tool) => tool.name)
    expect(declared).toEqual(["query_knowledge"])
    expect(outcome.trace[0]).toMatchObject({ tool: "recommend_support_materials", status: "REJECTED" })
    expect(outcome.supportMaterials).toBeUndefined()
  })

  it("Token Budget: soma o que o provider informou por request (cached/reasoning ficam null quando não informados), avalia limiares e conta requests", async () => {
    executeTool.mockResolvedValue(snapshot)
    generateWithTools
      .mockResolvedValueOnce(calls([{ name: "compare_periods", args: { indicatorCode: "TMA" } }], usage(30_000, 60, 12_000)))
      .mockResolvedValueOnce(text("notas", usage(35_000, 900)))
    const outcome = await runInvestigation({ ...baseInput, capabilities: ["INDICATOR_ANALYSIS"] })
    expect(outcome.summary.tokens).toEqual({ input: 65_000, cached: 12_000, output: 960, reasoning: null, total: 65_960 })
    expect(outcome.summary.tokenBudget).toEqual({ status: "WARNING", thresholds: { total: 60_000, input: 50_000, output: 8_000 }, exceeded: ["total", "input"] })
    // A 2ª request foi uma rodada de planejamento que concluiu em notas (sem Tools).
    expect(outcome.requests.map((request) => [request.phase, request.toolCalls])).toEqual([["PLANNING", ["compare_periods"]], ["PLANNING", []]])
    // Quem chama (síntese final) acrescenta a própria request ao mesmo resumo.
    accountRequests(outcome.summary, [...outcome.requests, { usage: usage(6_000, 500) }], { total: 100_000, input: null, output: null })
    expect(outcome.summary.requests).toBe(3)
    expect(outcome.summary.tokens?.total).toBe(72_460)
    expect(outcome.summary.tokenBudget?.status).toBe("OK")
  })

  it("provider sem contagem de tokens: tudo null e Token Budget NOT_INFORMED — nunca estimado", async () => {
    executeTool.mockResolvedValue(snapshot)
    generateWithTools.mockResolvedValueOnce({ kind: "text", text: "notas" })
    const outcome = await runInvestigation({ ...baseInput, capabilities: ["INDICATOR_ANALYSIS"] })
    expect(outcome.summary.tokens).toEqual({ input: null, cached: null, output: null, reasoning: null, total: null })
    expect(outcome.summary.tokenBudget?.status).toBe("NOT_INFORMED")
  })
})

describe("renderDossier / buildLedger", () => {
  it("lista só chamadas concluídas/cache como F-n compactos, com qualidade e período só quando diferem do padrão; recusadas viram limitação", () => {
    const trace: ToolInvocationTrace[] = [
      { sequence: 1, tool: "get_indicator_snapshot", label: "Consultar indicador", capability: "INDICATOR_ANALYSIS", argumentsSummary: { indicatorCode: "TMA" }, resultSummary: "TMA: 452 s", quality: { status: "INSUFFICIENT_COVERAGE" as const, sampleCount: 5, coverage: 0.3, freshness: null, note: "cobertura 30%" }, provenance: { population: "colaborador", filters: [], dataSource: "MEASUREMENT", period: { start: "", end: "", label: "set/2026" } }, status: "COMPLETED" as const, startedAt: "", completedAt: "" },
      { sequence: 2, tool: "find_interactions", label: "Buscar interações", capability: "INTERACTION_ANALYSIS", argumentsSummary: {}, resultSummary: "não disponível", quality: null, provenance: null, status: "REJECTED" as const, startedAt: "", completedAt: "" },
    ]
    const dossier = renderDossier(trace, "notas", { defaultPeriodLabel: "ago/2026" })
    expect(dossier).toContain("F1 (get_indicator_snapshot indicatorCode=TMA): TMA: 452 s [período set/2026] [INSUFFICIENT_COVERAGE: cobertura 30%]")
    expect(dossier).not.toContain("F2")
    expect(dossier).toContain("Buscar interações")
    expect(buildLedger(trace, "set/2026")[0]!.periodLabel).toBeNull()
    expect(trace[0]!.ledgerRef).toBe("F1")
  })
})

describe("runInvestigation V1.2 — Zero-ID Model Context, handles e orçamento separado", () => {
  it("handles: find_interactions devolve I1/I2 ao modelo; analyze_interactions recebe I1 e a Tool executa com o UUID real; o trace guarda os dois lados; handle desconhecido é REJECTED", async () => {
    const realIds = ["5a0b6d1e-1111-4c1c-9c2c-aaaaaaaaaaaa", "5a0b6d1e-2222-4c1c-9c2c-bbbbbbbbbbbb"]
    executeTool.mockImplementation(async (_context: unknown, tool: { key: string }, args: Record<string, unknown>) => {
      if (tool.key === "get_indicator_snapshot") return snapshot
      if (tool.key === "validate_data_quality") return quality
      if (tool.key === "get_available_dimensions") return dimensions
      if (tool.key === "find_interactions") return okResult({ returned: 2, total: 2, orderBy: "RECENT", interactions: realIds.map((id, index) => ({ interactionId: id, startedAt: "2026-09-10T13:00:00.000Z", localDate: "2026-09-10", localTime: "10:0" + index, subject: "Fatura", durationSeconds: 300 + index })) })
      if (tool.key === "analyze_interactions") return okResult({ objective: String(args.objective), transcriptsAnalyzed: (args.interactionIds as string[]).length, patterns: [{ description: "repete confirmação", occurrenceCount: 1, interactionEvidence: [{ interactionId: realIds[0], excerpt: "confirma de novo" }], evidenceStrength: "WEAK" }] })
      throw new Error("inesperado")
    })
    generateWithTools
      .mockResolvedValueOnce(calls([{ name: "find_interactions", args: {} }]))
      .mockResolvedValueOnce(calls([{ name: "analyze_interactions", args: { interactionIds: ["I1", "I2"], objective: "pausas" } }, { name: "analyze_interactions", args: { interactionIds: ["I9"], objective: "x" } }]))
      .mockResolvedValueOnce(text("notas"))
    const outcome = await runInvestigation({ ...baseInput, capabilities: allCapabilities as unknown as (typeof allCapabilities)[number][] })
    const round2 = (generateWithTools.mock.calls[1]![0] as { text: string }[])[0]!.text
    expect(round2).toContain('"interaction":"I1"')
    expect(round2).toContain('"interaction":"I2"')
    expect(round2).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
    // A Tool recebeu os UUIDs reais resolvidos pelo backend.
    const analyzeCall = executeTool.mock.calls.find((call) => (call[1] as { key: string }).key === "analyze_interactions")!
    expect((analyzeCall[2] as { interactionIds: string[] }).interactionIds).toEqual(realIds)
    const analyzed = outcome.trace.find((item) => item.tool === "analyze_interactions" && item.status === "COMPLETED")!
    expect(analyzed.argumentsSummary.interactionIds).toEqual(realIds)
    expect(analyzed.modelArguments?.interactionIds).toEqual(["I1", "I2"])
    // O resultado da análise volta ao modelo com handles nas evidências.
    const round3 = (generateWithTools.mock.calls[2]![0] as { text: string }[])[0]!.text
    expect(round3).toContain('"interaction":"I1"')
    expect(round3).not.toContain(realIds[0])
    // Handle inexistente nesta execução: recusado sem consumir orçamento.
    const rejected = outcome.trace.find((item) => item.status === "REJECTED")!
    expect(rejected.error).toBe("UNKNOWN_HANDLE")
    expect(rejected.resultSummary).toContain('"I9"')
    expect(outcome.summary).toMatchObject({ toolCalls: 5, preflightCalls: 3, investigationToolCalls: 2, rejectedCalls: 1 })
  })

  it("interação em foco entra no prefixo como I1 (nunca UUID); nenhum UUID chega ao modelo em nenhuma request; cada request registra rota e breakdown de contexto", async () => {
    executeTool.mockResolvedValueOnce(okResult({ interactionId: "de005dda-68b4-4857-8a9c-6c83069a47a5", startedAt: "2026-06-10T13:23:00.000Z", localDate: "2026-06-10", localTime: "10:23", subject: "Fatura", durationSeconds: 1250, flags: [] }))
    generateWithTools.mockResolvedValueOnce(calls([{ name: "get_interaction_flags", args: { interactionIds: ["I1"] } }])).mockResolvedValueOnce(text("notas"))
    executeTool.mockResolvedValueOnce(okResult({ interactionsInSet: 1, flags: [{ flag: "rechamada", count: 1, interactionIds: ["de005dda-68b4-4857-8a9c-6c83069a47a5"] }] }))
    const outcome = await runInvestigation({ ...baseInput, subject: { ...subject, indicatorCode: null, interactionId: "de005dda-68b4-4857-8a9c-6c83069a47a5" }, capabilities: ["INTERACTION_ANALYSIS"] })
    for (const call of generateWithTools.mock.calls) {
      const [turns, systemPrompt] = call as [{ text: string }[], string]
      expect(`${systemPrompt}\n${turns[0]!.text}`).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
    }
    expect((generateWithTools.mock.calls[0]![1] as string)).toContain("Interação em foco: I1")
    expect(outcome.trace[1]!.argumentsSummary.interactionIds).toEqual(["de005dda-68b4-4857-8a9c-6c83069a47a5"])
    expect(outcome.requests.map((request) => request.route?.tier)).toEqual(["STANDARD", "STANDARD"])
    expect(outcome.requests[0]!.route?.mode).toBe("CURRENT")
  })
})

// ---------------------------------------------------------------------------------------------
// V1.3 — prompt por componentes (COMPACT), declarações compactas e universo operacional (§54/§55/§6)
// ---------------------------------------------------------------------------------------------
describe("runInvestigation V1.3 — perfil COMPACT + schemas compactos", () => {
  const parts = { identity: "Você é o Agent.\nObjetivo: diagnosticar.", knowledge: "Bases de conhecimento disponíveis (cada uma identificada pelo título exato depois de ###):\n### Procedimento X\ntrecho recuperado pela entrada", knowledgeTitles: 'Bases de conhecimento autorizadas (consulte com query_knowledge quando uma evidência pedir procedimento): "Procedimento X".', expectations: "Expectativas de chamada cadastradas: informar protocolo.", restrictions: "Restrições: nunca opinar sobre política." }
  const snapshotWithVolume = okResult({ indicator: { code: "TMA", aggregation: "WEIGHTED_AVERAGE" }, operational: { formatted: "467.04 s", sampleCount: 21, coverage: 1, denominator: 1267 }, target: { value: 400, withinTarget: false }, official: null })

  it("planejamento: sistema só com componentes ESTÁTICOS (identidade, expectativas, restrições, política compacta, parâmetros comuns, títulos de KB) — sem nome do colaborador, sem trechos de KB, sem contrato de síntese; sujeito e contexto vão no turno do usuário; zero UUID", async () => {
    executeTool.mockImplementation(async (_context: unknown, tool: { key: string }) => (tool.key === "get_indicator_snapshot" ? snapshotWithVolume : tool.key === "validate_data_quality" ? quality : dimensions))
    generateWithTools.mockResolvedValueOnce(text("Notas: F1."))
    const { INVESTIGATION_POLICY_COMPACT } = await import("./investigation-prompt.js")
    const outcome = await runInvestigation({ ...baseInput, promptParts: parts, toolSchemaMode: "COMPACT", capabilities: ["INDICATOR_ANALYSIS", "SEGMENTATION", "KNOWLEDGE"] })
    const [turns, systemPrompt, declarations] = generateWithTools.mock.calls[0]! as [{ text: string }[], string, { name: string; description: string; parameters: { required?: string[] } }[]]
    // O perfil vem do env (CURRENT nos testes): forçamos a montagem COMPACT pela função pública para provar a separação.
    const { assembleInvestigationPrompt } = await import("./investigation-prompt.js")
    const { toolsForCapabilities } = await import("../domain/tool-catalog.js")
    const compact = assembleInvestigationPrompt("PLANNING", { systemPrompt: baseInput.systemPrompt, parts, capabilities: ["INDICATOR_ANALYSIS", "SEGMENTATION", "KNOWLEDGE"], tools: toolsForCapabilities(["INDICATOR_ANALYSIS", "SEGMENTATION", "KNOWLEDGE"]), subject, defaultPeriod: period, interactionHandle: null, schemaMode: "COMPACT" }, "COMPACT")
    expect(compact.system).toContain(INVESTIGATION_POLICY_COMPACT)
    expect(compact.system).toContain("Restrições: nunca opinar sobre política.")
    expect(compact.system).toContain('"Procedimento X"')
    expect(compact.system).not.toContain("trecho recuperado pela entrada")
    expect(compact.system).not.toContain("Camila Fonseca")
    expect(compact.system).not.toContain("Inclua no MESMO JSON")
    expect(compact.userPreamble).toContain("Colaborador em foco: Camila Fonseca")
    expect(compact.components.filter((item) => item.static).map((item) => item.id)).toEqual(["agent.identity", "agent.expectations", "agent.restrictions", "investigation.policy", "investigation.common-parameters", "investigation.stop-contract", "knowledge.titles"])
    expect(compact.components.filter((item) => !item.static).map((item) => item.id)).toEqual(["investigation.subject"])
    // Declarações compactas: indicatorCode opcional (indicador em foco) e descrições curtas.
    const comparePeriods = declarations.find((tool) => tool.name === "compare_periods")!
    expect(comparePeriods.parameters.required).toBeUndefined()
    expect(comparePeriods.description.length).toBeLessThan(160)
    expect(systemPrompt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i)
    expect(turns[0]!.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i)
    // Universo operacional capturado do snapshot (denominador de média ponderada) — distinto das 2 interações registradas.
    expect(outcome.operationalUniverse).toEqual({ count: 1267, source: "get_indicator_snapshot", label: "contatos/avaliações (denominador do indicador)" })
    expect(outcome.summary.operationalUniverse?.count).toBe(1267)
    expect(outcome.summary.interactionsInPeriod).toBe(2)
  })

  it("COMPACT: indicatorCode omitido pelo modelo é injetado pelo runtime (indicador em foco) — a auditoria guarda o argumento real; código inválido continua rejeitado pelo catálogo", async () => {
    mockPreflight()
    executeTool.mockImplementation(async (_context: unknown, tool: { key: string }) => (tool.key === "compare_periods" ? okResult({ current: 467, reference: 525 }) : tool.key === "get_indicator_snapshot" ? snapshot : tool.key === "validate_data_quality" ? quality : dimensions))
    generateWithTools.mockResolvedValueOnce(calls([{ name: "compare_periods", args: {} }, { name: "compare_periods", args: { indicatorCode: "" } }])).mockResolvedValueOnce(text("Notas."))
    const outcome = await runInvestigation({ ...baseInput, promptParts: parts, toolSchemaMode: "COMPACT", capabilities: ["INDICATOR_ANALYSIS"] })
    const compare = outcome.trace.filter((item) => item.tool === "compare_periods")
    expect(compare[0]).toMatchObject({ status: "COMPLETED", argumentsSummary: { indicatorCode: "TMA" }, modelArguments: {} })
    expect(compare[1]).toMatchObject({ status: "REJECTED" })
    expect(compare[1]!.error).toContain("Argumentos inválidos")
  })
})

// ---------------------------------------------------------------------------------------------
// V1.3.1 — EVIDENCE SUFFICIENCY CONTROLLER no runtime: o modelo propõe STOP, o runtime decide.
// ---------------------------------------------------------------------------------------------
describe("runInvestigation V1.3.1 — o modelo propõe parar; o runtime decide", () => {
  const explain = { ...baseInput, objectiveContext: {} } // TMA fora da meta → EXPLAIN_INDICATOR_DEVIATION (causal)
  const state = (extra: string) => `${STATE_MARKER} ${extra}`
  const compareResult = okResult({ current: { value: 467.04, period: "ago" }, reference: { value: 525.5, period: "jul" }, absoluteDifference: -58.46, relativeDifferencePercent: -11.1, performanceDirection: "IMPROVED" })
  const interactions = okResult({ interactions: [{ interactionId: "de001a75-c03b-40fb-8013-c44a05eb28df", subject: "Fatura" }], total: 2, returned: 1, orderBy: "RECENT" }, { sampleCount: 1 })
  const analysis = okResult({ transcriptsAnalyzed: 1, patterns: [{ description: "informa o protocolo", occurrenceCount: 1 }] }, { sampleCount: 1 })

  function mockTools() {
    executeTool.mockImplementation(async (_context: unknown, tool: { key: string }) => {
      if (tool.key === "get_indicator_snapshot") return snapshot
      if (tool.key === "validate_data_quality") return quality
      if (tool.key === "get_available_dimensions") return dimensions
      if (tool.key === "compare_periods") return compareResult
      if (tool.key === "find_interactions") return interactions
      if (tool.key === "analyze_interactions") return analysis
      throw new Error(`sem mock para ${tool.key}`)
    })
  }

  it("STOP proposto cedo (só indicador + comparação, objetivo causal, interações disponíveis) é RECUSADO: a próxima rodada recebe as lacunas com as Tools candidatas e a investigação continua até a evidência de interação", async () => {
    mockTools()
    generateWithTools
      .mockResolvedValueOnce(calls([{ name: "compare_periods", args: { indicatorCode: "TMA" } }]))
      // Rodada 2: propõe STOP sem ter lido interação nenhuma — objetivo causal com 2 interações registradas e find_interactions/analyze_interactions disponíveis.
      .mockResolvedValueOnce(text(`Notas: TMA acima da meta, melhorou.\n${state('{"proposedAction":"STOP","supportedClaims":[],"unresolvedQuestions":[],"hypotheses":[],"contradictoryEvidence":[],"dataLimitations":[],"proposedStopReason":"ANSWER_SUFFICIENT"}')}`))
      .mockResolvedValueOnce(calls([{ name: "find_interactions", args: {} }]))
    const outcome = await runInvestigation({ ...explain, capabilities: ["INDICATOR_ANALYSIS", "INTERACTION_ANALYSIS"] })
    const secondUserTurn = (generateWithTools.mock.calls[2]![0] as { text: string }[])[0]!.text
    expect(secondUserTurn).toContain("STOP RECUSADO pela aplicação")
    expect(secondUserTurn).toContain("find_interactions")
    expect(outcome.objective.kind).toBe("EXPLAIN_INDICATOR_DEVIATION")
    expect(outcome.summary.sufficiency?.rejections).toEqual([{ round: 2, reasons: [expect.stringContaining("causa comportamental")] }])
    // Sem mais rodadas (3 é o máximo): parou por limite, nunca por suficiência — e a lacuna virou limitação.
    expect(outcome.stopReason).toBe("MAX_PLANNING_ROUNDS")
    expect(outcome.summary.sufficiency?.status).toBe("LIMITED")
    expect(outcome.dossier).toContain("RESULTADO DA INVESTIGAÇÃO: Limite de rodadas de planejamento")
    expect(outcome.dossier).toContain("A evidência é INCOMPLETA")
    // Sinais determinísticos no trace/ledger (fatos críticos): direção da comparação e meta.
    expect(outcome.trace.find((item) => item.tool === "compare_periods")?.signals).toEqual({ performance: "IMPROVED" })
    expect(outcome.summary.sufficiency?.criticalFacts.map((fact) => fact.kind)).toEqual(["INDICATOR_STATE", "TREND"])
  })

  it("STOP aceito como ANSWER_SUFFICIENT quando a evidência de interação existe e a declaração não deixa lacuna material; as notas entram sem a linha de estado", async () => {
    mockTools()
    generateWithTools
      .mockResolvedValueOnce(calls([{ name: "compare_periods", args: { indicatorCode: "TMA" } }, { name: "find_interactions", args: {} }]))
      .mockResolvedValueOnce(calls([{ name: "analyze_interactions", args: { interactionIds: ["I1"], objective: "estrutura do atendimento" } }]))
      .mockResolvedValueOnce(text(`Notas finais.\n${state('{"proposedAction":"STOP","supportedClaims":[{"text":"na interação analisada você informou o protocolo","scope":"INTERACTION_SPECIFIC","evidenceRefs":["F6"]}],"hypotheses":[{"hypothesis":"cliente com pressa","status":"OPEN","material":false,"evidenceRefs":[],"candidateTools":[]}],"dataLimitations":["1 de 2 interações analisada"],"proposedStopReason":"ANSWER_SUFFICIENT"}')}`))
    const outcome = await runInvestigation({ ...explain, capabilities: ["INDICATOR_ANALYSIS", "INTERACTION_ANALYSIS"] })
    expect(outcome.stopReason).toBe("ANSWER_SUFFICIENT")
    expect(outcome.notes).toBe("Notas finais.")
    expect(outcome.summary.sufficiency).toMatchObject({ status: "SUFFICIENT", stopProposed: true, stopAccepted: true, rejections: [], dataLimitations: ["1 de 2 interações analisada"] })
    expect(outcome.summary.sufficiency?.hypotheses).toEqual([{ hypothesis: "cliente com pressa", status: "OPEN", material: false, evidenceRefs: [], candidateTools: [] }])
    expect(outcome.summary.sufficiency?.evidenceNeeds.find((need) => need.id === "E_BEHAVIORAL_EVIDENCE")?.status).toBe("SATISFIED")
    expect(outcome.dossier).toContain("RESULTADO DA INVESTIGAÇÃO: Evidência suficiente para o objetivo.")
  })

  it("sem interações registradas no período: a causa comportamental fica BLOCKED por falta de dados — STOP aceito como INSUFFICIENT_DATA (nenhuma rodada extra) e o dossiê diz isso à síntese", async () => {
    executeTool.mockImplementation(async (_context: unknown, tool: { key: string }) => (tool.key === "get_indicator_snapshot" ? snapshot : tool.key === "validate_data_quality" ? quality : tool.key === "get_available_dimensions" ? okResult({ indicator: { code: "TMA" }, dimensions: [{ dimension: "DAY", available: true }], interactionsInPeriod: 0 }) : tool.key === "compare_periods" ? compareResult : okResult({})))
    generateWithTools
      .mockResolvedValueOnce(calls([{ name: "compare_periods", args: { indicatorCode: "TMA" } }]))
      .mockResolvedValueOnce(text(`Notas.\n${state('{"proposedAction":"STOP","proposedStopReason":"INSUFFICIENT_DATA","dataLimitations":["sem interações no período"]}')}`))
    // Sem SEGMENTATION o preflight conta as interações direto no banco: zero registradas.
    const emptyDb = { query: vi.fn(async () => ({ rows: [{ count: "0" }], rowCount: 1 })) } as unknown as Database
    const outcome = await runInvestigation({ ...explain, db: emptyDb, capabilities: ["INDICATOR_ANALYSIS", "INTERACTION_ANALYSIS"] })
    expect(generateWithTools).toHaveBeenCalledTimes(2)
    expect(outcome.stopReason).toBe("INSUFFICIENT_DATA")
    expect(outcome.summary.sufficiency?.evidenceNeeds.find((need) => need.id === "E_BEHAVIORAL_EVIDENCE")).toMatchObject({ status: "BLOCKED", blockedBy: "NO_DATA" })
    expect(outcome.dossier).toContain("Dados insuficientes")
  })

  it("orçamento esgotado com lacuna aberta: motivo INVESTIGATION_TOOL_BUDGET, status LIMITED — nunca ANSWER_SUFFICIENT", async () => {
    mockTools()
    generateWithTools.mockResolvedValueOnce(calls([{ name: "compare_periods", args: { indicatorCode: "TMA" } }])).mockResolvedValueOnce(text(`Notas.\n${state('{"proposedAction":"STOP"}')}`))
    const outcome = await runInvestigation({ ...explain, capabilities: ["INDICATOR_ANALYSIS", "INTERACTION_ANALYSIS"], maxToolCalls: 1 })
    expect(outcome.stopReason).toBe("INVESTIGATION_TOOL_BUDGET")
    expect(outcome.summary.outcome).toBe("BUDGET_EXHAUSTED")
    expect(outcome.summary.sufficiency?.status).toBe("LIMITED")
    expect(outcome.limitations.some((item) => item.includes("não investigado por limite"))).toBe(true)
  })

  it("o contrato de parada (estado estruturado) entra no prompt de planejamento e o objetivo derivado vai no turno do usuário — nunca chain-of-thought", async () => {
    mockPreflight()
    generateWithTools.mockResolvedValueOnce(text("Notas."))
    await runInvestigation({ ...baseInput, capabilities: ["INDICATOR_ANALYSIS"] })
    const [turns, systemPrompt] = generateWithTools.mock.calls[0]! as [{ text: string }[], string]
    expect(systemPrompt).toContain(STATE_MARKER)
    expect(systemPrompt).toContain("MATERIAL = a resposta poderia mudar a conclusão")
    expect(turns[0]!.text).toContain("OBJETIVO DESTA INVESTIGAÇÃO: Descrever a performance")
  })
})

describe("runInvestigation V1.3.2 — amostragem pela pergunta, análise consciente do objetivo, fontes de evidência e recusa na última rodada", () => {
  const quarter = { start: new Date("2026-06-01T03:00:00Z"), end: new Date("2026-09-01T03:00:00Z"), label: "trimestre (2026-06-01 a 2026-08-31)" }
  const patternInput = { ...baseInput, subject: { ...subject, indicatorCode: null }, objectiveContext: { query: "Identifique os padrões de comportamento recorrentes deste colaborador no período." } }
  const state = (extra: string) => `${STATE_MARKER} ${extra}`
  const found = okResult({ interactions: [{ interactionId: "de001a75-c03b-40fb-8013-c44a05eb28df", localDate: "2026-08-20", subject: "Fatura" }, { interactionId: "de002a75-c03b-40fb-8013-c44a05eb28df", localDate: "2026-06-05", subject: "Plano" }], total: 36, returned: 2, orderBy: "RECENT", sampling: { strategy: "TEMPORAL_STRATIFIED", candidateCount: 36, selectedCount: 2, periodBuckets: [], selectedPerBucket: [1, 0, 1], selectionReason: "x" } }, { sampleCount: 36 })
  const analysisSpread = okResult({ analyzedTranscriptCount: 2, recordedUniverseCount: 36, universeRelationship: "PARTIAL_COVERAGE", temporalCoverage: { buckets: 3, bucketsCovered: 2 }, findings: [{ finding: "recapitula pendências", matchedTranscriptCount: 2, verifiedExcerptCount: 2, matchedShareOfAnalyzedPercent: 100, prevalenceInUniversePercent: null, verifiedExcerpts: [] }] }, { sampleCount: 2 })

  const db36 = { query: vi.fn(async () => ({ rows: [{ count: "36" }], rowCount: 1 })) } as unknown as Database
  /** Snapshot do estado investigativo NO MOMENTO da análise (o objeto é atualizado a cada rodada). */
  let analysisStateAtCall: unknown = null
  function mockTools() {
    executeTool.mockImplementation(async (context: { investigation: unknown }, tool: { key: string }) => {
      if (tool.key === "find_interactions") return found
      if (tool.key === "analyze_interactions") {
        analysisStateAtCall = JSON.parse(JSON.stringify(context.investigation))
        return analysisSpread
      }
      throw new Error(`sem mock para ${tool.key}`)
    })
  }

  it("janela longa + padrão: o runtime decide TEMPORAL_STRATIFIED (3 blocos) e a análise semântica recebe o objetivo derivado, o escopo exigido e as lacunas abertas — sem 'o que procurar'; janela curta fica RECENT", async () => {
    mockTools()
    generateWithTools
      .mockResolvedValueOnce(calls([{ name: "find_interactions", args: {} }]))
      .mockResolvedValueOnce(calls([{ name: "analyze_interactions", args: { interactionIds: ["I1", "I2"], objective: "condução do atendimento" } }]))
      .mockResolvedValueOnce(text(`Notas.\n${state('{"proposedAction":"STOP","supportedClaims":[{"text":"nas analisadas recapitula pendências","scope":"INTERACTION_SPECIFIC","evidenceRefs":["F2"]}],"unresolvedQuestions":[],"hypotheses":[],"contradictoryEvidence":[],"dataLimitations":[],"proposedStopReason":"ANSWER_SUFFICIENT"}')}`))
    const outcome = await runInvestigation({ ...patternInput, db: db36, defaultPeriod: quarter, capabilities: ["INTERACTION_ANALYSIS"] })
    expect(outcome.summary.samplingStrategy).toBe("TEMPORAL_STRATIFIED")
    expect(outcome.summary.periodIntent).toBe("PERIOD_EVOLUTION")
    const analyzeState = analysisStateAtCall as { analysisObjective: { investigationObjective: string; requiredClaimScope: string; periodIntent: string; openEvidenceNeeds: { id: string }[] }; samplingStrategy: string; temporalBuckets: number; recordedUniverseCount: number | null }
    expect(analyzeState).toMatchObject({ samplingStrategy: "TEMPORAL_STRATIFIED", temporalBuckets: 3, recordedUniverseCount: 36 })
    expect(analyzeState.analysisObjective).toMatchObject({ investigationObjective: "IDENTIFY_EMPLOYEE_PATTERN", requiredClaimScope: "EMPLOYEE_PATTERN", periodIntent: "PERIOD_EVOLUTION" })
    expect(analyzeState.analysisObjective.openEvidenceNeeds.map((need) => need.id)).toEqual(expect.arrayContaining(["E_BEHAVIORAL_EVIDENCE", "E_TEMPORAL_COVERAGE"]))
    // O prompt de planejamento lista as FONTES de evidência (✓/—) e a pergunta de lacuna — nunca "chame a Tool X".
    const secondTurn = (generateWithTools.mock.calls[1]![0] as { text: string }[])[0]!.text
    expect(secondTurn).toContain("FONTES DE EVIDÊNCIA nesta execução")
    expect(secondTurn).toContain("✓ Eventos/fatos registrados por interação")
    expect(secondTurn).toContain("que TIPO de evidência ainda poderia mudar a conclusão")
    // Cobertura temporal da análise vira sinal determinístico no trace/ledger.
    expect(outcome.trace.find((item) => item.tool === "analyze_interactions")?.signals).toEqual({ temporalCoverage: { buckets: 3, bucketsCovered: 2 }, interactionAnalysis: { analyzedTranscriptCount: 2, recordedUniverseCount: 36, universeRelationship: "PARTIAL_COVERAGE", findings: 1, verifiedExcerpts: 0 } })
    expect(outcome.summary.evidenceSources).toEqual({ available: ["INTERACTION_CONTENT", "INTERACTION_EVENTS", "POPULATION_COMPARISON"], used: ["INTERACTION_CONTENT", "INTERACTION_EVENTS"] })
    // V1.3.4: comparação temporal exigida (padrão numa janela longa) e ainda não realizada (a análise mockada não comparou blocos) — telemetria + blocos da janela.
    expect(outcome.summary.temporal).toMatchObject({ temporalComparisonRequired: true, temporalComparisonStatus: "NOT_PERFORMED", availableBuckets: 3, analyzedBuckets: 2, comparedBuckets: [] })
    expect(outcome.summary.temporal?.buckets.map((bucket) => `${bucket.ref}:${bucket.relativePosition}`)).toEqual(["B1:FIRST", "B2:MIDDLE", "B3:LAST"])
    expect(outcome.summary.sufficiency?.evidenceNeeds.find((need) => need.id === "E_TEMPORAL_COMPARISON")).toBeDefined()
    const short = await (async () => {
      mockTools()
      generateWithTools.mockReset()
      generateWithTools
        .mockResolvedValueOnce(calls([{ name: "find_interactions", args: {} }]))
        .mockResolvedValueOnce(calls([{ name: "analyze_interactions", args: { interactionIds: ["I1", "I2"], objective: "condução do atendimento" } }]))
        .mockResolvedValueOnce(text(`Notas.\n${state('{"proposedAction":"STOP","supportedClaims":[],"unresolvedQuestions":[],"hypotheses":[],"contradictoryEvidence":[],"dataLimitations":[],"proposedStopReason":"ANSWER_SUFFICIENT"}')}`))
      return runInvestigation({ ...patternInput, db: db36, capabilities: ["INTERACTION_ANALYSIS"] })
    })()
    expect(short.summary.samplingStrategy).toBe("RECENT")
    expect(short.summary.periodIntent).toBe("PERIOD_PATTERN")
  })

  it("§42 recusa na ÚLTIMA rodada é instrumentada (stopRejectedAtFinalRound, lacunas e Tools restantes) e entra no log de recusas — sem rodada de remediação", async () => {
    mockTools()
    generateWithTools
      .mockResolvedValueOnce(calls([{ name: "find_interactions", args: {} }]))
      .mockResolvedValueOnce(calls([{ name: "analyze_interactions", args: { interactionIds: ["I1"], objective: "condução do atendimento" } }]))
      // Rodada 3 (última): claim EMPLOYEE_PATTERN com 2 de 36 → recusável por escopo, mas sem rodada para reagir.
      .mockResolvedValueOnce(text(`Notas.\n${state('{"proposedAction":"STOP","supportedClaims":[{"text":"você costuma recapitular","scope":"EMPLOYEE_PATTERN","evidenceRefs":["F2"]}],"unresolvedQuestions":[],"hypotheses":[],"contradictoryEvidence":[],"dataLimitations":[],"proposedStopReason":"ANSWER_SUFFICIENT"}')}`))
    const outcome = await runInvestigation({ ...patternInput, db: db36, defaultPeriod: quarter, capabilities: ["INTERACTION_ANALYSIS"] })
    expect(outcome.stopReason).toBe("MAX_PLANNING_ROUNDS")
    expect(outcome.summary.sufficiency).toMatchObject({ status: "LIMITED", stopProposed: true, stopAccepted: false, stopRejectedAtFinalRound: true })
    expect(outcome.summary.sufficiency?.remainingMaterialNeeds).toContain("E_CLAIM_SCOPE")
    expect(outcome.summary.sufficiency?.candidateToolsAvailable?.length ?? 0).toBeGreaterThan(0)
    expect(outcome.summary.sufficiency?.rejections).toEqual([{ round: 3, reasons: expect.arrayContaining([expect.stringContaining("EMPLOYEE_PATTERN")]) }])
    expect(outcome.summary.maxPlanningRounds).toBe(3)
  })
})

// =====================================================================================================================
// V1.4.6.1 — ISOLAMENTO DE CONTEXTO E ORDEM (§7): a mesma onda executa Tools em paralelo; nada do que uma devolve pode
// mudar o que a outra manda ao modelo, e a ordem lógica (sequência, ledger) é a do PEDIDO, nunca a da conclusão.
// =====================================================================================================================
describe("runInvestigation V1.4.6.1 — ordem, concorrência e estado por execução", () => {
  const interactionsOf = (ids: string[]) => okResult({ returned: ids.length, total: ids.length, orderBy: "RECENT", interactions: ids.map((id, index) => ({ interactionId: id, startedAt: "2026-09-10T13:00:00.000Z", localDate: "2026-09-10", localTime: `10:0${index}`, subject: "Fatura", durationSeconds: 300 + index })) })

  it("duas Tools na MESMA onda: a que termina primeiro não rouba a sequência nem o ledger da que foi pedida antes", async () => {
    mockPreflight()
    const completion: string[] = []
    executeTool.mockImplementation(async (_context: unknown, tool: { key: string }, args: Record<string, unknown>) => {
      if (tool.key === "get_indicator_snapshot") return snapshot
      if (tool.key === "validate_data_quality") return quality
      if (tool.key === "get_available_dimensions") return dimensions
      // A primeira PEDIDA (limit 5) é a mais LENTA — resolve depois da segunda.
      await new Promise((resolve) => setTimeout(resolve, args.limit === 5 ? 25 : 1))
      completion.push(String(args.limit))
      return interactionsOf(args.limit === 5 ? ["aaaaaaaa-1111-4c1c-9c2c-aaaaaaaaaaaa"] : ["bbbbbbbb-2222-4c1c-9c2c-bbbbbbbbbbbb"])
    })
    generateWithTools
      .mockResolvedValueOnce(calls([{ name: "find_interactions", args: { limit: 5 } }, { name: "find_interactions", args: { limit: 3 } }]))
      .mockResolvedValueOnce(text("Fatos: F4 e F5."))
    const outcome = await runInvestigation({ ...baseInput, capabilities: ["INDICATOR_ANALYSIS", "INTERACTION_ANALYSIS"] })
    expect(completion).toEqual(["3", "5"])
    expect(outcome.trace.filter((item) => item.tool === "find_interactions").map((item) => [item.sequence, item.argumentsSummary.limit])).toEqual([[3, 5], [4, 3]])
    expect(outcome.ledger.map((entry) => entry.ref)).toEqual(["F1", "F2", "F3", "F4"])
  })

  it("o payload que cada Tool manda ao modelo não depende da outra Tool da onda (sem estado compartilhado de projeção)", async () => {
    mockPreflight()
    const seen: Record<string, unknown>[] = []
    executeTool.mockImplementation(async (_context: unknown, tool: { key: string }, args: Record<string, unknown>) => {
      if (tool.key === "get_indicator_snapshot") return snapshot
      if (tool.key === "validate_data_quality") return quality
      if (tool.key === "get_available_dimensions") return dimensions
      seen.push(args)
      await new Promise((resolve) => setTimeout(resolve, args.limit === 5 ? 20 : 1))
      return interactionsOf(["cccccccc-3333-4c1c-9c2c-cccccccccccc"])
    })
    generateWithTools
      .mockResolvedValueOnce(calls([{ name: "find_interactions", args: { limit: 5 } }, { name: "get_interaction_flags", args: {} }]))
      .mockResolvedValueOnce(text("Fatos."))
    await runInvestigation({ ...baseInput, capabilities: ["INDICATOR_ANALYSIS", "INTERACTION_ANALYSIS"] })
    // Cada Tool recebeu EXATAMENTE os argumentos que o modelo pediu (mais os defaults do runtime) — nada da irmã.
    expect(seen[0]).toMatchObject({ limit: 5 })
    expect(seen[1]).not.toHaveProperty("limit")
  })

  it("HandleRegistry é por EXECUÇÃO: I1 da investigação seguinte aponta para OUTRA interação, e handle sem origem nesta execução é recusado", async () => {
    const firstId = "dddddddd-4444-4c1c-9c2c-dddddddddddd"
    const secondId = "eeeeeeee-5555-4c1c-9c2c-eeeeeeeeeeee"
    let current = firstId
    const analyzed: string[][] = []
    executeTool.mockImplementation(async (_context: unknown, tool: { key: string }, args: Record<string, unknown>) => {
      if (tool.key === "get_indicator_snapshot") return snapshot
      if (tool.key === "validate_data_quality") return quality
      if (tool.key === "get_available_dimensions") return dimensions
      if (tool.key === "find_interactions") return interactionsOf([current])
      if (tool.key === "analyze_interactions") { analyzed.push(args.interactionIds as string[]); return okResult({ objective: String(args.objective), transcriptsAnalyzed: 1, patterns: [] }) }
      throw new Error("inesperado")
    })
    const run = async () => {
      generateWithTools
        .mockResolvedValueOnce(calls([{ name: "find_interactions", args: {} }]))
        .mockResolvedValueOnce(calls([{ name: "analyze_interactions", args: { interactionIds: ["I1"], objective: "condução" } }, { name: "analyze_interactions", args: { interactionIds: ["I7"], objective: "condução" } }]))
        .mockResolvedValueOnce(text("Fatos."))
      return runInvestigation({ ...baseInput, capabilities: ["INDICATOR_ANALYSIS", "INTERACTION_ANALYSIS"] })
    }
    const first = await run()
    current = secondId
    const second = await run()
    // I1 é reatribuído do zero a cada execução — nunca aponta para a interação da execução anterior.
    expect(analyzed).toEqual([[firstId], [secondId]])
    for (const outcome of [first, second]) {
      const rejected = outcome.trace.find((item) => item.status === "REJECTED")!
      expect(rejected.error).toBe("UNKNOWN_HANDLE")
      expect(rejected.resultSummary).toContain('"I7"')
    }
  })
})
