import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { assertNodeMatchesIndicatorCatalog, assertPublishedWorkflowMatchesIndicatorCatalog } from "./indicator-graph-guard.js"
import { processNode, type EnrollmentRow } from "./node-handlers.js"
import { createFakeEffects } from "../testing/fake-effect-sink.js"

const ORG = "org-1"
const sumCondition = { id: "cond", type: "condition" as const, label: "Soma alta", position: { x: 0, y: 0 }, config: { comparator: "GTE", thresholdNumeric: 10, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "QA_X", aggregation: "SUM", source: "MEASUREMENT", period: { kind: "ROLLING_DAYS", days: 7 } } } }

function catalogDb(kind: string, direction = "HIGHER", graph?: unknown) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("from indicator_definitions")) return { rows: [{ code: "QA_X", operational_aggregation: kind, desired_direction: direction }], rowCount: 1 }
    if (sql.includes("join workflow_versions")) return { rows: graph ? [{ graph }] : [], rowCount: graph ? 1 : 0 }
    return { rows: [], rowCount: 0 }
  })
  return { db: { query } as unknown as Database, query }
}

describe("defesa de quem roda um grafo publicado contra o catálogo vigente", () => {
  it("nó sem indicador não custa consulta", async () => {
    const { db, query } = catalogDb("SUM")
    await assertNodeMatchesIndicatorCatalog(db, ORG, { id: "c", type: "condition", label: "Flag", config: { comparator: "EQUALS" } })
    expect(query).not.toHaveBeenCalled()
  })

  it("agregação aceita segue; a que a estratégia não aceita para com o motivo", async () => {
    await expect(assertNodeMatchesIndicatorCatalog(catalogDb("SUM").db, ORG, sumCondition)).resolves.toBeUndefined()
    await expect(assertNodeMatchesIndicatorCatalog(catalogDb("WEIGHTED_AVERAGE").db, ORG, sumCondition)).rejects.toMatchObject({ code: "WORKFLOW_INVALID_CONDITION", statusCode: 422, message: expect.stringMatching(/usa "Soma".*publique o Workflow de novo/) })
  })

  it("ativar confere a versão publicada; sem versão, nada a conferir", async () => {
    const graph = { nodes: [sumCondition], edges: [] }
    await expect(assertPublishedWorkflowMatchesIndicatorCatalog(catalogDb("SUM", "HIGHER", graph).db, ORG, "wf")).resolves.toBeUndefined()
    await expect(assertPublishedWorkflowMatchesIndicatorCatalog(catalogDb("LATEST", "HIGHER", graph).db, ORG, "wf")).rejects.toMatchObject({ code: "WORKFLOW_INVALID_CONDITION" })
    await expect(assertPublishedWorkflowMatchesIndicatorCatalog(catalogDb("LATEST").db, ORG, "wf")).resolves.toBeUndefined()
  })

  it("a execução da Condição para antes de calcular: nunca compara um número sem sentido e segue o ramo errado", async () => {
    const { db, query } = catalogDb("WEIGHTED_AVERAGE")
    const graph = { nodes: [sumCondition], edges: [{ id: "e", source: "cond", sourceHandle: "true", target: "fim" }] }
    const enrollment = { id: "e-1", organization_id: ORG, workflow_id: "wf", version_id: "v", interaction_id: null, indicator_measurement_id: null, scheduled_subject_id: "p-1", scheduled_for: null, current_node_id: "cond", matched_flag_name: null, matched_value_boolean: null, matched_value_numeric: null, status: "active", attempts: 0 } as unknown as EnrollmentRow
    await expect(processNode({ db, graph, enrollment, workflow: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, consolidatedStructure: null, populationFilter: null }, inputContext: {}, now: new Date("2026-09-16T12:00:00Z"), effects: createFakeEffects() } as never, sumCondition as never)).rejects.toThrow(/usa "Soma"/)
    expect(query.mock.calls.some(([sql]) => sql.includes("indicator_measurements"))).toBe(false)
  })
})
