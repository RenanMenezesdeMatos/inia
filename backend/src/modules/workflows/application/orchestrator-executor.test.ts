import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { EmployeeCollectionOutput } from "./select-employees-executor.js"
import type { EmployeeFanInOutput } from "./consolidate-results-executor.js"
import { executeOrchestrator, executeOrchestratorConsolidated, type ConsolidatedOrchestratorContext, type OrchestratorExecutionContext } from "./orchestrator-executor.js"

const resolveOrchestratorById = vi.fn()
const runOrchestratedReply = vi.fn()
const generateWithTools = vi.fn()

vi.mock("../../assistant/application/resolve-orchestrator.js", () => ({
  resolveOrchestratorById: (...args: unknown[]) => resolveOrchestratorById(...args),
}))
vi.mock("../../assistant/application/run-orchestrated-reply.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../assistant/application/run-orchestrated-reply.js")>()
  return {
    ...actual,
    runOrchestratedReply: (...args: unknown[]) => runOrchestratedReply(...args),
  }
})
vi.mock("../../assistant/infrastructure/gemini-function-calling-client.js", () => ({
  generateWithTools: (...args: unknown[]) => generateWithTools(...args),
}))

const fakeDb = {} as Database

const ORG = "00000000-0000-4000-8000-0000000000c3"

function baseContext(overrides: Partial<OrchestratorExecutionContext> = {}): OrchestratorExecutionContext {
  return {
    db: fakeDb,
    organizationId: ORG,
    inputContext: "transcrição da chamada",
    enrollment: { interactionId: "interaction-1", indicatorMeasurementId: null, scheduledSubjectId: null },
    ...overrides,
  }
}

describe("executeOrchestrator", () => {
  it("resolves the operator, calls the referenced orchestrator with a fixed instruction, and returns its structured reply as nodeOutput", async () => {
    resolveOrchestratorById.mockReset().mockResolvedValueOnce({
      orchestratorId: "orch-1",
      orchestratorName: "Monitoria Geral",
      orchestratorAgentId: "agent-orch-1",
      systemPrompt: "...",
      specialists: [],
      tools: [],
      outputInstructions: null,
    })
    runOrchestratedReply.mockReset().mockResolvedValueOnce({
      text: "síntese final",
      agentId: null,
      calls: [{ toolName: "agent_diagnostico", query: "Analise esta interação" }],
      results: [{ agentId: "diag-1", toolName: "agent_diagnostico", text: "causa provável: X" }],
      structuredResult: null,
    })

    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database

    const result = await executeOrchestrator({ orchestratorId: "orch-1", instruction: "Analise esta interação" }, baseContext({ db }))

    // O Orquestrador é procurado na organização da matrícula.
    expect(resolveOrchestratorById).toHaveBeenCalledWith(db, ORG, "orch-1", "WORKFLOW", expect.any(String))
    expect(runOrchestratedReply).toHaveBeenCalledWith(
      db,
      { orchestratorId: "orch-1", orchestratorName: "Monitoria Geral", orchestratorAgentId: "agent-orch-1", systemPrompt: "...", specialists: [], tools: [], outputInstructions: null },
      [{ role: "user", text: "Analise esta interação" }],
      "transcrição da chamada",
      "operator-1",
      { investigation: { interactionId: "interaction-1" } },
      // V1.7.1 — nó sem roteamento declarado e sem avaliação de processo: síntese de sempre (nada de caminho rápido).
      { allowSynthesisPassthrough: false },
    )
    expect(result.nodeOutput.text).toBe("síntese final")
    expect(result.nodeOutput.results).toEqual([{ agentId: "diag-1", toolName: "agent_diagnostico", text: "causa provável: X" }])
  })

  it("fails the node when the referenced orchestrator doesn't exist, is inactive, or doesn't accept WORKFLOW invocation", async () => {
    resolveOrchestratorById.mockReset().mockResolvedValueOnce(null)
    const db = { query: vi.fn(async () => ({ rows: [{ operator_id: "operator-1" }], rowCount: 1 })) } as unknown as Database

    await expect(executeOrchestrator({ orchestratorId: "orch-1", instruction: "Analise" }, baseContext({ db }))).rejects.toThrow(/Orquestrador não encontrado/)
  })
})

const RESOLVED_ORCHESTRATOR = {
  orchestratorId: "orch-1",
  orchestratorName: "Monitoria Geral",
  orchestratorAgentId: "agent-orch-1",
  systemPrompt: "Você é a INIA.",
  specialists: [],
  tools: [{ name: "agent_diagnostico" }],
  outputInstructions: null,
}

function fanIn(overrides: Partial<EmployeeFanInOutput> = {}): EmployeeFanInOutput {
  return {
    kind: "EMPLOYEE_FAN_IN",
    sourceFanOutNodeId: "apply",
    expectedCount: 2,
    completedCount: 1,
    failedCount: 1,
    joinedAt: new Date().toISOString(),
    children: [
      { employeeId: "11111111-1111-1111-1111-111111111111", childEnrollmentId: "child-1", status: "completed", nodeOutputs: { review: { decision: "approved" } } },
      { employeeId: "22222222-2222-2222-2222-222222222222", childEnrollmentId: "child-2", status: "failed", nodeOutputs: {}, failureReason: "Erro desconhecido no motor de workflow." },
    ],
    ...overrides,
  }
}

const collection: EmployeeCollectionOutput = {
  kind: "EMPLOYEE_COLLECTION",
  mode: "CONDITION",
  memberIds: ["op-1", "op-2"],
  evaluatedCount: 5,
  selectedCount: 2,
  notMatchedCount: 2,
  noDataCount: 1,
  sourceKind: "STRUCTURE",
  sourceNodeId: null,
  criterion: { comparator: "EQUALS", thresholdText: "Q4", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "NOTA_URA" } },
  selectedAt: new Date().toISOString(),
}

describe("executeOrchestratorConsolidated (Orchestrator pós-JOIN — fan-in/JOIN, Parte 8/9/23/46/47/85/86)", () => {
  it("nunca chama resolveEnrollmentOperatorId nem consulta interactions/indicator_measurements — não existe 'o operador' aqui", async () => {
    resolveOrchestratorById.mockReset().mockResolvedValueOnce(RESOLVED_ORCHESTRATOR)
    generateWithTools.mockReset().mockResolvedValueOnce({ kind: "text", text: "Resumo executivo: 1 concluído, 1 falhou." })
    const queries: string[] = []
    const db = { query: vi.fn(async (sql: string) => { queries.push(sql); return { rows: [{ id: "11111111-1111-1111-1111-111111111111", name: "João" }, { id: "22222222-2222-2222-2222-222222222222", name: "Maria" }], rowCount: 2 } }) } as unknown as Database

    await executeOrchestratorConsolidated({ orchestratorId: "orch-1", instruction: "Resuma os diagnósticos." }, { db, organizationId: ORG, inputContext: "", fanIn: fanIn(), collection } as ConsolidatedOrchestratorContext)

    expect(queries.some((sql) => sql.includes("from interactions"))).toBe(false)
    expect(queries.some((sql) => sql.includes("from indicator_measurements"))).toBe(false)
  })

  it("chama generateWithTools SEM nenhum tool (nunca aciona especialista com um colaborador arbitrário)", async () => {
    resolveOrchestratorById.mockReset().mockResolvedValueOnce(RESOLVED_ORCHESTRATOR)
    generateWithTools.mockReset().mockResolvedValueOnce({ kind: "text", text: "síntese" })
    const db = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as unknown as Database

    await executeOrchestratorConsolidated({ orchestratorId: "orch-1", instruction: "Resuma." }, { db, organizationId: ORG, inputContext: "", fanIn: fanIn(), collection: null })

    expect(generateWithTools).toHaveBeenCalledTimes(1)
    expect(generateWithTools.mock.calls[0]?.[2]).toEqual([])
  })

  it("monta o contexto com nomes resolvidos (nunca UUID cru), decisão de Human Review e motivo de falha por colaborador", async () => {
    resolveOrchestratorById.mockReset().mockResolvedValueOnce(RESOLVED_ORCHESTRATOR)
    generateWithTools.mockReset().mockResolvedValueOnce({ kind: "text", text: "síntese" })
    const db = { query: vi.fn(async () => ({ rows: [{ id: "11111111-1111-1111-1111-111111111111", name: "João" }, { id: "22222222-2222-2222-2222-222222222222", name: "Maria" }], rowCount: 2 })) } as unknown as Database

    await executeOrchestratorConsolidated({ orchestratorId: "orch-1", instruction: "Resuma." }, { db, organizationId: ORG, inputContext: "", fanIn: fanIn(), collection })

    const systemPrompt = generateWithTools.mock.calls[0]?.[1] as string
    expect(systemPrompt).toContain("João")
    expect(systemPrompt).toContain("Maria")
    expect(systemPrompt).toContain("approved")
    expect(systemPrompt).toContain("Erro desconhecido no motor de workflow.")
    expect(systemPrompt).not.toMatch(/11111111-1111|22222222-2222/)
    expect(systemPrompt).toContain("5 avaliados") // resumo da coleção original
  })

  it("Parte 65/66 da evolução de Evolução/Grupo — coleção RANKING com partição propaga o Grupo/Subgrupo de origem de cada filho pro contexto, sem tocar o engine de fan-in", async () => {
    resolveOrchestratorById.mockReset().mockResolvedValueOnce(RESOLVED_ORCHESTRATOR)
    generateWithTools.mockReset().mockResolvedValueOnce({ kind: "text", text: "síntese" })
    const db = { query: vi.fn(async () => ({ rows: [{ id: "11111111-1111-1111-1111-111111111111", name: "João" }, { id: "22222222-2222-2222-2222-222222222222", name: "Maria" }], rowCount: 2 })) } as unknown as Database

    const rankingCollection: EmployeeCollectionOutput = {
      kind: "EMPLOYEE_COLLECTION",
      mode: "RANKING",
      memberIds: ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"],
      evaluatedCount: 10,
      selectedCount: 2,
      direction: "HIGHER",
      partitionBy: "SUBTEAM",
      requestedCountPerPartition: 1,
      rankedCount: 8,
      noDataCount: 2,
      ranking: { source: "MEASUREMENT", indicatorCode: "QUALIDADE", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 }, rankingBasis: "CHANGE", selection: "DECLINED", count: 1, partitionBy: "SUBTEAM" },
      partitions: [
        { id: "sub-a", name: "Subgrupo Premium", evaluatedCount: 5, rankedCount: 4, noDataCount: 1, selectedCount: 1, members: [{ employeeId: "11111111-1111-1111-1111-111111111111", previousValue: 90, currentValue: 72, change: -20, performanceChange: -20, position: 1 }] },
        { id: "sub-b", name: "Subgrupo Básico", evaluatedCount: 5, rankedCount: 4, noDataCount: 1, selectedCount: 1, members: [{ employeeId: "22222222-2222-2222-2222-222222222222", previousValue: 88, currentValue: 77, change: -12.5, performanceChange: -12.5, position: 1 }] },
      ],
      sourceKind: "STRUCTURE",
      sourceNodeId: null,
      selectedAt: new Date().toISOString(),
    }

    await executeOrchestratorConsolidated({ orchestratorId: "orch-1", instruction: "Resuma." }, { db, organizationId: ORG, inputContext: "", fanIn: fanIn(), collection: rankingCollection })

    const systemPrompt = generateWithTools.mock.calls[0]?.[1] as string
    expect(systemPrompt).toContain("[Subgrupo Premium] João")
    expect(systemPrompt).toContain("[Subgrupo Básico] Maria")
    expect(systemPrompt).toContain("separado por Subgrupo (2 baldes)")
  })

  it("devolve o mesmo shape de OrchestratorNodeOutput (orchestratorId/orchestratorName + reply)", async () => {
    resolveOrchestratorById.mockReset().mockResolvedValueOnce(RESOLVED_ORCHESTRATOR)
    generateWithTools.mockReset().mockResolvedValueOnce({ kind: "text", text: "síntese final" })
    const db = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as unknown as Database

    const result = await executeOrchestratorConsolidated({ orchestratorId: "orch-1", instruction: "Resuma." }, { db, organizationId: ORG, inputContext: "", fanIn: fanIn(), collection: null })

    expect(result.nodeOutput).toMatchObject({ orchestratorId: "orch-1", orchestratorName: "Monitoria Geral", text: "síntese final", agentId: null, calls: [], results: [] })
  })
})

describe("executeOrchestratorConsolidated — JOIN vazio (rodada de hardening 2026-09-16)", () => {
  it("fan-in com zero filhos nunca gasta uma request de IA: devolve resultado determinístico, explícito, no mesmo formato", async () => {
    resolveOrchestratorById.mockReset().mockResolvedValueOnce(RESOLVED_ORCHESTRATOR)
    generateWithTools.mockReset()
    const db = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as unknown as Database
    const empty = fanIn({ expectedCount: 0, completedCount: 0, failedCount: 0, children: [] })

    const result = await executeOrchestratorConsolidated({ orchestratorId: "orch-1", instruction: "Resuma." }, { db, organizationId: ORG, inputContext: "", fanIn: empty, collection: null } as ConsolidatedOrchestratorContext)

    expect(generateWithTools).not.toHaveBeenCalled()
    expect(db.query).not.toHaveBeenCalled()
    expect(result.nodeOutput.skippedReason).toBe("EMPTY_FAN_IN")
    expect(result.nodeOutput.text).toContain("Nenhum colaborador foi selecionado")
    expect(result.nodeOutput.structuredResult).toBeNull()
    expect(result.nodeOutput.orchestratorName).toBe("Monitoria Geral")
  })

  it("fan-in com filhos continua chamando a IA normalmente (nada mudou fora do caso vazio)", async () => {
    resolveOrchestratorById.mockReset().mockResolvedValueOnce(RESOLVED_ORCHESTRATOR)
    generateWithTools.mockReset().mockResolvedValueOnce({ kind: "text", text: "síntese" })
    const db = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as unknown as Database
    const result = await executeOrchestratorConsolidated({ orchestratorId: "orch-1", instruction: "Resuma." }, { db, organizationId: ORG, inputContext: "", fanIn: fanIn(), collection: null } as ConsolidatedOrchestratorContext)
    expect(generateWithTools).toHaveBeenCalledTimes(1)
    expect(result.nodeOutput.skippedReason).toBeUndefined()
  })
})

describe("executeOrchestrator — V1.7.1 caminho rápido vem da configuração do nó", () => {
  it("roteamento DOMAINS e avaliação de processo viram opções do runtime (domínios declarados + síntese dispensável)", async () => {
    resolveOrchestratorById.mockReset().mockResolvedValueOnce({ orchestratorId: "orch-1", orchestratorName: "Monitoria", orchestratorAgentId: "a", systemPrompt: "...", specialists: [], tools: [], outputInstructions: null })
    runOrchestratedReply.mockReset().mockResolvedValueOnce({ text: "t", agentId: null, calls: [], results: [], structuredResult: null })
    const db = { query: vi.fn(async (sql: string) => (sql.includes("from interactions") ? { rows: [{ operator_id: "operator-1" }], rowCount: 1 } : { rows: [], rowCount: 0 })) } as unknown as Database
    const domain = "d0000000-0000-4000-8000-00000000000f"
    await executeOrchestrator({ orchestratorId: "orch-1", instruction: "Avalie", specialistOutputContract: "PROCESS_ASSESSMENT", routing: { mode: "DOMAINS", businessDomainIds: [domain] } }, baseContext({ db }))
    expect(runOrchestratedReply.mock.calls[0]![6]).toEqual({ fixedDomainIds: [domain], allowSynthesisPassthrough: true })
  })
})
