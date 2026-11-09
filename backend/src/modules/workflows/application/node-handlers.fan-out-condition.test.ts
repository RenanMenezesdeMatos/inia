import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { FlowGraph, FlowNode } from "../domain/graph-schema.js"
import { processNode, type EnrollmentRow, type WorkflowScope } from "./node-handlers.js"
import { createFakeEffects } from "../testing/fake-effect-sink.js"

vi.mock("./hierarchy-subjects.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("./hierarchy-subjects.js")>()), resolveStructureAnchorOperatorIds: async () => ["colega-a", "colega-b", "pessoa"] }))

/**
 * Condição na execução individual de um Workflow consolidado (entre "Aplicar individualmente" e "Consolidar resultados"). O sujeito é a
 * pessoa da execução, nunca a estrutura. A prova com banco de verdade está em `workflow-fan-out-condition-proof`.
 */
type ConditionConfig = Extract<FlowNode, { type: "condition" }>["config"]

const WEEK = { kind: "ROLLING_DAYS", days: 7 } as const
const CONDITIONS: [string, ConditionConfig][] = [
  ["Valor do indicador", { comparator: "GT", thresholdNumeric: 1, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", source: "MEASUREMENT", indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE", period: WEEK } }],
  ["Quantidade de ocorrências", { comparator: "GT", thresholdNumeric: 1, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", source: "MEASUREMENT", indicatorCode: "TMA", aggregation: "COUNT", comparator: "GT", indicatorThreshold: 1, period: WEEK } }],
  ["Atingimento do PRV", { comparator: "LT", thresholdNumeric: 80, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", source: "PRV_ACHIEVEMENT", aggregation: "AVERAGE", period: { kind: "CALENDAR", unit: "MONTH" } } }],
  ["Atingimento do indicador", { comparator: "LT", thresholdNumeric: 80, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", source: "INDICATOR_ACHIEVEMENT", indicatorCode: "TMA", aggregation: "AVERAGE", period: { kind: "CALENDAR", unit: "MONTH" } } }],
  ["Quartil oficial do indicador", { comparator: "EQUALS", thresholdText: "Q4", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "TMA" } }],
  ["Quartil do PRV", { comparator: "EQUALS", thresholdText: "Q4", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE" } }],
]
const OPERATIONAL: ConditionConfig = { comparator: "EQUALS", thresholdText: "Q4", historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", source: "OPERATIONAL_QUARTILE", indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE", period: WEEK } }

const position = { x: 0, y: 0 }
const nodeWith = (config: ConditionConfig): FlowNode => ({ id: "cond", type: "condition", label: "Condição", position, config })
const graphWith = (node: FlowNode): FlowGraph => ({
  nodes: [
    { id: "selecionar", type: "select_employees", label: "Selecionar", position, config: {} },
    { id: "aplicar", type: "apply_individually", label: "Aplicar", position, config: {} },
    node,
    { id: "fim", type: "end", label: "Fim", position, config: {} },
  ],
  edges: [
    { id: "1", source: "selecionar", sourceHandle: "always", target: "aplicar" },
    { id: "2", source: "aplicar", sourceHandle: "always", target: "cond" },
    { id: "3", source: "cond", sourceHandle: "true", target: "fim" },
    { id: "4", source: "cond", sourceHandle: "false", target: "fim" },
    { id: "5", source: "cond", sourceHandle: "no_data", target: "fim" },
  ],
})

const PEOPLE = ["pessoa", "colega-a", "colega-b"]
const WORKFLOW: WorkflowScope = { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, populationFilter: null, consolidatedStructure: { kind: "SUPERVISOR_TEAM", supervisorId: "supervisor" } }

function enrollment(overrides: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return { id: "execucao", organization_id: "org", workflow_id: "w", version_id: "v", current_node_id: "cond", status: "active", attempts: 0, revision: 0, interaction_id: null, indicator_measurement_id: null, scheduled_subject_id: "pessoa", matched_flag_name: null, matched_value_boolean: null, matched_value_numeric: null, node_outputs: {}, variables: {}, ...overrides } as EnrollmentRow
}

let queries: { sql: string; params: unknown[] }[]
let parentCollection: unknown

const database = (): Database =>
  ({
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params })
      if (/node_outputs -> \$1/.test(sql)) return { rows: parentCollection === undefined ? [] : [{ collection: parentCollection }] }
      return { rows: [] }
    },
  }) as unknown as Database

const peopleConsulted = () => [...new Set(queries.flatMap(({ params }) => params.flatMap((param) => (Array.isArray(param) ? param : [param]))).filter((value) => PEOPLE.includes(String(value))))].sort()

const run = (config: ConditionConfig, row: EnrollmentRow) => {
  const node = nodeWith(config)
  return processNode({ db: database(), graph: graphWith(node), enrollment: row, workflow: WORKFLOW, inputContext: "", now: new Date("2026-11-05T12:00:00Z"), effects: createFakeEffects() } as never, node)
}

beforeEach(() => {
  queries = []
  parentCollection = undefined
})

describe("Condição na execução individual de um Workflow consolidado", () => {
  it.each(CONDITIONS)("%s consulta só a pessoa da execução", async (_name, config) => {
    await run(config, enrollment({ parent_enrollment_id: "principal" }))
    expect(peopleConsulted()).toEqual(["pessoa"])
  })

  it("na execução principal, Valor e Atingimento continuam agregando a estrutura", async () => {
    await run(CONDITIONS[0]![1], enrollment())
    expect(peopleConsulted()).toEqual(["colega-a", "colega-b", "pessoa"])
  })

  it("o quartil operacional busca a população na execução principal, dentro da organização", async () => {
    parentCollection = { kind: "EMPLOYEE_COLLECTION", memberIds: ["pessoa", "colega-a", "colega-b", "colega-c"] }
    await run(OPERATIONAL, enrollment({ parent_enrollment_id: "principal" }))
    const lookup = queries.find(({ sql }) => /node_outputs -> \$1/.test(sql))
    expect(lookup?.params).toEqual(["selecionar", "principal", "org"])
    expect(peopleConsulted()).toEqual(expect.arrayContaining(["pessoa", "colega-a", "colega-b"]))
  })

  it("no QA Lab, a população vem do contexto simulado, sem consultar a execução no banco", async () => {
    await run(OPERATIONAL, enrollment({ parent_enrollment_id: "simulada", parent_node_outputs: { selecionar: { kind: "EMPLOYEE_COLLECTION", memberIds: ["pessoa", "colega-a"] } } }))
    expect(queries.some(({ sql }) => /node_outputs -> \$1/.test(sql))).toBe(false)
    expect(peopleConsulted()).toEqual(["colega-a", "pessoa"])
  })

  it("sem coleção na execução principal, a resposta é Sem dados, nunca Sim nem Não", async () => {
    const outcome = await run(OPERATIONAL, enrollment({ parent_enrollment_id: "principal" }))
    expect(outcome).toMatchObject({ kind: "advance", eventPayload: { branch: "no_data" } })
  })
})
