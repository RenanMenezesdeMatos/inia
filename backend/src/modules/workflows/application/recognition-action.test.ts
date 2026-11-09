import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { ActionConfig, FlowGraph } from "../domain/graph-schema.js"
import { createFakeEffects } from "../testing/fake-effect-sink.js"
import type { ActionExecutionContext } from "./action-executors.js"
import type { EmployeeCollectionOutput } from "./select-employees-executor.js"

const runAgent = vi.fn()
vi.mock("../../agents/application/run-agent.js", () => ({ runAgent: (...args: unknown[]) => runAgent(...args) }))
vi.mock("../../indicators/application/official-closure.js", () => ({ resolveOfficialClosure: async () => ({ lastClosedPeriod: "2026-10" }) }))
vi.mock("./workflow-agent-version.js", () => ({ withWorkflowAgent: async (_db: unknown, _organizationId: unknown, _agentId: unknown, _scope: unknown, run: () => unknown) => run() }))

const { actionExecutors } = await import("./action-executors.js")
const { processNode } = await import("./node-handlers.js")
const { buildConsolidatedSummary } = await import("./orchestrator-executor.js")

const position = { x: 0, y: 0 }
const GRAPH = {
  nodes: [
    { id: "selecionar", type: "select_employees", label: "Selecionar", position, config: {} },
    { id: "aplicar", type: "apply_individually", label: "Aplicar", position, config: {} },
    { id: "agente", type: "action", label: "Reconhecer", position, config: {} },
  ],
  edges: [
    { id: "1", source: "selecionar", sourceHandle: "always", target: "aplicar" },
    { id: "2", source: "aplicar", sourceHandle: "always", target: "agente" },
  ],
} as unknown as FlowGraph

const COLLECTION = {
  kind: "EMPLOYEE_COLLECTION",
  mode: "RANKING",
  ranking: { source: "PRV_ACHIEVEMENT", selection: "BEST" },
  partitionBy: "SUBTEAM",
  partitions: [{ id: "voz", name: "Voz", rankedCount: 12, members: [{ employeeId: "gabriel", value: 85, position: 1 }], calculation: { periodLabel: "Mês anterior" } }],
} as unknown as EmployeeCollectionOutput

/** O melhor do Subgrupo com o PRV abaixo da meta: um indicador fora e outro dentro. */
const db = {
  query: vi.fn(async (text: string) => {
    if (text.includes("from people")) return { rows: [{ team_id: "grupo" }] }
    if (text.includes("from employee_prv_performance")) return { rows: [{ id: "prv-1", reference_period: "2026-10", achievement_percent: "85", quartile: "Q1" }] }
    if (text.includes("from employee_indicator_performance")) {
      return {
        rows: [
          { id: "fcr-1", reference_period: "2026-10", code: "FCR", name: "Resolução", unit: "PERCENT", desired_direction: "HIGHER", value: "62", target_value: "70", achievement_percent: "88", weight_percent: "40", quartile: "Q1" },
          { id: "tma-1", reference_period: "2026-10", code: "TMA", name: "Tempo médio", unit: "SECONDS", desired_direction: "LOWER", value: "350", target_value: "400", achievement_percent: null, weight_percent: "60", quartile: "Q1" },
        ],
      }
    }
    return { rows: [] }
  }),
} as unknown as Database

function context(overrides: Partial<ActionExecutionContext> = {}): ActionExecutionContext {
  return {
    db,
    organizationId: "org",
    workflowId: "w",
    workflowVersionId: null,
    nodeId: "agente",
    graph: GRAPH,
    enrollment: { id: "e", interactionId: null, indicatorMeasurementId: null, scheduledSubjectId: "gabriel", matchedFlagName: null, matchedValueBoolean: null, matchedValueNumeric: null, nodeOutputs: {}, variables: {} },
    scopeType: "ALL_TEAMS",
    teamId: null,
    subteamId: null,
    inputContext: "",
    now: new Date("2026-11-02T12:00:00.000Z"),
    effects: createFakeEffects(),
    readCollection: async () => COLLECTION,
    ...overrides,
  }
}

const config = (outputContract?: "RECOGNITION"): ActionConfig => ({ actionType: "CALL_AGENT", agentId: "agente-1", scheduledDataSource: { kind: "PERFORMANCE", closures: 1 }, ...(outputContract ? { outputContract } : {}) })

beforeEach(() => {
  runAgent.mockReset()
  runAgent.mockResolvedValue({ id: "run", outputText: "{}", status: "COMPLETED", errorMessage: null })
})

describe("formato Reconhecimento em \"Chamar agente\"", () => {
  it("o melhor abaixo da meta: a IA recebe o motivo e a situação de cada resultado, escritos pelo sistema", async () => {
    await actionExecutors.CALL_AGENT(config("RECOGNITION"), context())
    const input = runAgent.mock.calls[0]![1] as { inputContext: string; workflow: { recognition: { subject: string; reason: string; snapshot: { position: number } } } }

    expect(input.inputContext).toContain("Motivo do reconhecimento (fato oficial, definido por regra do sistema): Melhor resultado em Atingimento do PRV no Subgrupo Voz (mês anterior): posição 1 entre 12 pessoas com dados.")
    expect(input.inputContext).toContain("- PRV oficial: atingimento 85%, quartil Q1, fora da meta (meta: 100%)")
    expect(input.inputContext).toContain("- Resolução (FCR): 62%, meta 70%, atingimento 88%, peso 40%, quartil Q1, fora da meta")
    // Sem atingimento oficial, a direção decide: no TMA, menor é melhor.
    expect(input.inputContext).toContain("- Tempo médio (TMA): 350 s, meta 400 s, peso 60%, quartil Q1, dentro da meta")
    expect(input.workflow.recognition.subject).toBe("Atingimento do PRV")
    expect(input.workflow.recognition.snapshot.position).toBe(1)
  })

  it("na execução individual, o motivo vem da coleção guardada na execução principal", async () => {
    const lookups: unknown[][] = []
    const parentDb = {
      query: async (sql: string, params: unknown[] = []) => {
        if (!/node_outputs -> \$1/.test(sql)) return db.query(sql, params as never[])
        lookups.push(params)
        return { rows: [{ collection: COLLECTION }] }
      },
    } as unknown as Database
    const agentNode = { id: "agente", type: "action", label: "Reconhecer", position, config: config("RECOGNITION") }
    const graph = { nodes: [...GRAPH.nodes.filter((node) => node.id !== "agente"), agentNode, { id: "fim", type: "end", label: "Fim", position, config: {} }], edges: [...GRAPH.edges, { id: "3", source: "agente", sourceHandle: "always", target: "fim" }] }
    const enrollment = { id: "filha", organization_id: "org", workflow_id: "w", version_id: "v", current_node_id: "agente", status: "active", attempts: 0, revision: 0, interaction_id: null, indicator_measurement_id: null, scheduled_subject_id: "gabriel", matched_flag_name: null, matched_value_boolean: null, matched_value_numeric: null, node_outputs: {}, variables: {}, parent_enrollment_id: "principal" }

    await processNode({ db: parentDb, graph, enrollment, workflow: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, populationFilter: null, consolidatedStructure: null }, inputContext: "", now: new Date("2026-11-02T12:00:00.000Z"), effects: createFakeEffects() } as never, agentNode as never)

    expect(lookups).toEqual([["selecionar", "principal", "org"]])
    expect((runAgent.mock.calls[0]![1] as { inputContext: string }).inputContext).toContain("posição 1 entre 12 pessoas com dados")
  })

  it("sem a pessoa no ranking, falha em vez de elogiar sem motivo, e a IA não é chamada", async () => {
    await expect(actionExecutors.CALL_AGENT(config("RECOGNITION"), context({ readCollection: async () => undefined }))).rejects.toThrow(/sem o motivo oficial/)
    expect(runAgent).not.toHaveBeenCalled()
  })

  describe("sozinho no recorte", () => {
    const alone = (ranking: Record<string, unknown> = { source: "PRV_ACHIEVEMENT", selection: "BEST" }) => ({ ...COLLECTION, ranking, partitions: [{ id: "credito", name: "Crédito", rankedCount: 1, members: [{ employeeId: "gabriel", value: 85, position: 1 }], calculation: { periodLabel: "Mês anterior" } }] }) as unknown as EmployeeCollectionOutput

    it("fora da meta: a IA não é chamada, e a saída do nó diz o motivo", async () => {
      const result = await actionExecutors.CALL_AGENT(config("RECOGNITION"), context({ readCollection: async () => alone() }))
      expect(runAgent).not.toHaveBeenCalled()
      expect(result.nodeOutput).toMatchObject({ kind: "RECOGNITION_SKIPPED", personId: "gabriel", reason: "NO_COMPARISON_AND_TARGET_NOT_MET" })
      expect((result.nodeOutput as { text: string }).text).toContain("no Subgrupo Crédito (mês anterior), fora da meta")
    })

    it("num ranking de indicador, vale a meta desse indicador: dentro da meta, é reconhecido", async () => {
      await actionExecutors.CALL_AGENT(config("RECOGNITION"), context({ readCollection: async () => alone({ source: "INDICATOR_ACHIEVEMENT", indicatorCode: "TMA", selection: "BEST" }) }))
      expect(runAgent).toHaveBeenCalledTimes(1)
    })

    it("num ranking de indicador fora da meta, não é reconhecido", async () => {
      const result = await actionExecutors.CALL_AGENT(config("RECOGNITION"), context({ readCollection: async () => alone({ source: "INDICATOR_ACHIEVEMENT", indicatorCode: "FCR", selection: "BEST" }) }))
      expect(runAgent).not.toHaveBeenCalled()
      expect(result.nodeOutput).toMatchObject({ kind: "RECOGNITION_SKIPPED" })
    })

    it("com evolução, é reconhecido mesmo fora da meta", async () => {
      const collection = { ...alone({ source: "PRV_ACHIEVEMENT", selection: "IMPROVED" }), partitions: [{ id: "credito", name: "Crédito", rankedCount: 1, members: [{ employeeId: "gabriel", previousValue: 70, currentValue: 85, change: 15, performanceChange: 15, position: 1 }], calculation: { periodLabel: "Mês anterior" } }] } as unknown as EmployeeCollectionOutput
      await actionExecutors.CALL_AGENT(config("RECOGNITION"), context({ readCollection: async () => collection }))
      expect(runAgent).toHaveBeenCalledTimes(1)
    })
  })

  it("na consolidação, quem ficou sem reconhecimento aparece só com o fato, sem número para a IA interpretar", async () => {
    const skipped = { kind: "RECOGNITION_SKIPPED", personId: "noa", reason: "NO_COMPARISON_AND_TARGET_NOT_MET", text: "Sem reconhecimento: único resultado com dados, fora da meta.", fact: { position: 1 } }
    const names = { query: async () => ({ rows: [{ id: "10000000-0000-4000-8000-000000000006", name: "Noa" }] }) } as unknown as Database
    const summary = await buildConsolidatedSummary(names, { kind: "EMPLOYEE_FAN_IN", sourceFanOutNodeId: "aplicar", expectedCount: 1, completedCount: 1, failedCount: 0, joinedAt: "2026-11-02T12:00:00.000Z", children: [{ employeeId: "10000000-0000-4000-8000-000000000006", childEnrollmentId: "filha", status: "completed", nodeOutputs: { agente: skipped, entrega: { caseId: null, feedbackId: null, notPublished: { reason: skipped.reason, text: skipped.text } } } }] }, null)

    expect(summary).toContain("Noa: sem reconhecimento neste ciclo. Só esta pessoa tinha dados, então não houve comparação.")
    expect(summary).not.toContain("fora da meta")
  })

  it("o resumo de sempre continua igual: sem motivo, sem leitura de meta e sem ler a coleção", async () => {
    const readCollection = vi.fn(async () => COLLECTION)
    await actionExecutors.CALL_AGENT(config(), context({ readCollection }))
    const input = runAgent.mock.calls[0]![1] as { inputContext: string; workflow: Record<string, unknown> }

    expect(readCollection).not.toHaveBeenCalled()
    expect(input.inputContext).not.toContain("Motivo do reconhecimento")
    expect(input.inputContext).not.toContain("da meta")
    expect(input.inputContext).toContain("- PRV oficial: atingimento 85%, quartil Q1\n")
    expect(input.inputContext).toContain("- Tempo médio (TMA): 350 SECONDS, meta 400, peso 60%, quartil Q1\n")
    expect(input.workflow.recognition).toBeUndefined()
  })
})
