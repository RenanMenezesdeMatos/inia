/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import type { FlowGraph, FlowNode } from "@/schemas/admin/workflow-graph.schema"
import { validateWorkflowGraph } from "@/schemas/admin/workflow-validation"
import type { WorkflowTrigger } from "@/schemas/admin/workflow.schema"

import { ConditionForm } from "./condition-form"

installJsdomStubs()

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const SCHEDULE: WorkflowTrigger = { kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1, frequency: { type: "DAILY" } }
const position = { x: 0, y: 0 }
const VALUE_CONFIG = { comparator: "GT", thresholdNumeric: 1, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", source: "PRV_ACHIEVEMENT", aggregation: "AVERAGE", period: { kind: "CALENDAR", unit: "MONTH" } } } as Extract<FlowNode, { type: "condition" }>["config"]
const QUARTILE_CONFIG = { comparator: "EQUALS", thresholdText: "Q4", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE" } } as Extract<FlowNode, { type: "condition" }>["config"]

/** Workflow consolidado com uma Condição em `where`: na estrutura, no caminho individual ou depois de consolidar. */
function graphWithCondition(where: "estrutura" | "individual" | "consolidado", config: Extract<FlowNode, { type: "condition" }>["config"]): { graph: FlowGraph; node: Extract<FlowNode, { type: "condition" }> } {
  const node: Extract<FlowNode, { type: "condition" }> = { id: "cond", type: "condition", label: "Condição", position, config }
  const chain: FlowNode[] = [
    { id: "gatilho", type: "trigger", label: "Gatilho", position, config: {} },
    ...(where === "estrutura" ? [node] : []),
    { id: "selecionar", type: "select_employees", label: "Selecionar", position, config: { selectionMode: "RANKING", ranking: { source: "PRV_ACHIEVEMENT", aggregation: "AVERAGE", period: { kind: "CALENDAR", unit: "MONTH" }, selection: "BEST", count: 1 } } },
    { id: "aplicar", type: "apply_individually", label: "Aplicar", position, config: {} },
    ...(where === "individual" ? [node] : []),
    { id: "consolidar", type: "consolidate_results", label: "Consolidar", position, config: {} },
    ...(where === "consolidado" ? [node] : []),
    { id: "fim", type: "end", label: "Fim", position, config: {} },
  ]
  const edges = chain.slice(0, -1).flatMap((current, index) => {
    const target = chain[index + 1]!.id
    const handles = current.id === "cond" ? ["true", "false", "no_data"] : ["always"]
    return handles.map((sourceHandle) => ({ id: `${current.id}-${sourceHandle}`, source: current.id, sourceHandle, target }))
  })
  return { graph: { nodes: chain, edges }, node }
}

function renderForm(graph: FlowGraph, node: Extract<FlowNode, { type: "condition" }>, evaluationMode: "INDIVIDUAL" | "CONSOLIDATED") {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ConditionForm node={node} graph={graph} agentsById={new Map()} orchestratorsById={new Map()} trigger={SCHEDULE} workflowId="workflow-ficticio" evaluationMode={evaluationMode} onChange={() => {}} />
    </QueryClientProvider>,
  )
}

const analysisField = () => screen.getByRole("combobox", { name: "O que deseja analisar?" })
function offered(): (string | null)[] {
  fireEvent.keyDown(analysisField(), { key: "ArrowDown" })
  return screen.getAllByRole("option").map((option) => option.textContent)
}

const OFFICIAL_INDICATOR = "Quartil do indicador (fechamento oficial)"
const OFFICIAL_PRV = "Quartil do PRV"
const OPERATIONAL = "Quartil operacional (janela de dias)"

describe("ConditionForm — quartil em um Workflow consolidado", () => {
  it("no caminho individual, oferece os três quartis: o motor olha a pessoa da execução", () => {
    const { graph, node } = graphWithCondition("individual", VALUE_CONFIG)
    renderForm(graph, node, "CONSOLIDATED")
    const options = offered()
    for (const quartile of [OFFICIAL_INDICATOR, OFFICIAL_PRV, OPERATIONAL]) expect(options).toContain(quartile)
  })

  it("no caminho individual, os rótulos falam da pessoa, não da estrutura", () => {
    const { graph, node } = graphWithCondition("individual", VALUE_CONFIG)
    renderForm(graph, node, "CONSOLIDATED")
    expect(analysisField()).toHaveTextContent("Atingimento consolidado do PRV")
    const options = offered()
    expect(options).toContain("Atingimento do indicador")
    expect(options.join(" ")).not.toContain("da estrutura")
  })

  it("fora do caminho individual, os rótulos continuam falando da estrutura", () => {
    const { graph, node } = graphWithCondition("consolidado", VALUE_CONFIG)
    renderForm(graph, node, "CONSOLIDATED")
    expect(analysisField()).toHaveTextContent("Atingimento do PRV da estrutura")
  })

  it.each(["estrutura", "consolidado"] as const)("em %s, nenhum quartil é oferecido", (where) => {
    const { graph, node } = graphWithCondition(where, VALUE_CONFIG)
    renderForm(graph, node, "CONSOLIDATED")
    const options = offered()
    for (const quartile of [OFFICIAL_INDICATOR, OFFICIAL_PRV, OPERATIONAL]) expect(options).not.toContain(quartile)
  })

  it("quartil salvo no caminho individual aparece no campo e passa na validação de publicar", () => {
    const { graph, node } = graphWithCondition("individual", QUARTILE_CONFIG)
    renderForm(graph, node, "CONSOLIDATED")
    expect(analysisField()).toHaveTextContent(OFFICIAL_PRV)
    const issues = validateWorkflowGraph(graph, SCHEDULE, new Map(), new Map(), true)
    expect(issues.filter((issue) => issue.code === "WORKFLOW_PERFORMANCE_QUERY_INVALID_MODE")).toEqual([])
  })

  it("quartil salvo onde não vale continua visível, nunca um campo em branco, e a validação aponta o problema", () => {
    const { graph, node } = graphWithCondition("consolidado", QUARTILE_CONFIG)
    renderForm(graph, node, "CONSOLIDATED")
    expect(analysisField()).toHaveTextContent(OFFICIAL_PRV)
    const issues = validateWorkflowGraph(graph, SCHEDULE, new Map(), new Map(), true)
    expect(issues.some((issue) => issue.nodeId === node.id && issue.code === "WORKFLOW_PERFORMANCE_QUERY_INVALID_MODE")).toBe(true)
  })

  it("em Workflow individual, oferece os três", () => {
    const graph: FlowGraph = { nodes: [{ id: "gatilho", type: "trigger", label: "Gatilho", position, config: {} }], edges: [] }
    const node: Extract<FlowNode, { type: "condition" }> = { id: "cond", type: "condition", label: "Condição", position, config: VALUE_CONFIG }
    renderForm({ ...graph, nodes: [...graph.nodes, node] }, node, "INDIVIDUAL")
    const options = offered()
    for (const quartile of [OFFICIAL_INDICATOR, OFFICIAL_PRV, OPERATIONAL]) expect(options).toContain(quartile)
  })
})
