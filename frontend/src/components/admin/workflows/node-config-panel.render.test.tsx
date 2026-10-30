/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { NodeConfigPanel } from "./node-config-panel"
import { NODE_TYPE_LABELS, type FlowGraph, type FlowNode, type FlowNodeType } from "@/schemas/admin/workflow-graph.schema"
import type { WorkflowTrigger } from "@/schemas/admin/workflow.schema"

/**
 * Fumaça do painel de configuração inteiro: cada tipo de nó monta o seu formulário sem quebrar
 * (o painel é dividido em `node-config/*`; os testes de formulário isolados não passam pelo
 * despacho do `NodeConfigPanel`). A rede fica pendurada — só a montagem é verificada.
 */
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const FLAG: WorkflowTrigger = { kind: "channel_flag", channelFlagId: "flag-1", channel: "VOICE", flagName: "Rechamada", valueType: "BOOLEAN" }

const historicalCriterion = {
  comparator: "GTE",
  thresholdNumeric: 1,
  thresholdBoolean: null,
  historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "", aggregation: "COUNT", comparator: "LT", indicatorThreshold: 0, period: { kind: "ROLLING_DAYS", days: 7 } },
}

// Mesmas configurações com que o editor cria cada nó (workflow-editor-page.tsx › defaultConfigFor, gatilho por Flag).
const DEFAULT_CONFIG: Record<FlowNodeType, Record<string, unknown>> = {
  trigger: {},
  end: {},
  wait: { durationMs: 60 * 60 * 1000 },
  condition: { comparator: "EQUALS", thresholdBoolean: true, thresholdNumeric: null },
  select_employees: { criterion: historicalCriterion },
  apply_individually: {},
  consolidate_results: {},
  action: { actionType: "CALL_AGENT", agentId: "" },
  orchestrator: { orchestratorId: "", instruction: "Analise esta ocorrência." },
  human_review: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } },
  output: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "" },
  intervention_policy: { policyId: "", mode: "RECOMMEND_ONLY", analysisSourceNodeIds: [] },
}

function renderPanel(node: FlowNode, graph: FlowGraph): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<NodeConfigPanel node={node} graph={graph} trigger={FLAG} workflowId="wf-1" onChange={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />, { wrapper })
}

describe("NodeConfigPanel — acessibilidade", () => {
  it.each([
    ["output", DEFAULT_CONFIG.output],
    ["action", { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, surfaces: ["FOLLOW_UP"] }],
  ] as const)("Superfícies (%s): a toolbar do ToggleGroup tem o nome do rótulo", (type, config) => {
    const trigger = { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} } as unknown as FlowNode
    const node = { id: "node", type, label: `Nó ${type}`, position: { x: 0, y: 0 }, config } as unknown as FlowNode
    renderPanel(node, { nodes: [trigger, node], edges: [{ id: "e1", source: "trigger", target: "node", sourceHandle: "always" }] } as unknown as FlowGraph)
    expect(screen.getByRole("toolbar", { name: "Superfícies" })).toBeInTheDocument()
  })
})

describe("NodeConfigPanel — cada tipo de nó monta o seu formulário", () => {
  for (const type of Object.keys(DEFAULT_CONFIG) as FlowNodeType[]) {
    it(type, () => {
      const trigger = { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} } as unknown as FlowNode
      const node = { id: "node", type, label: `Nó ${type}`, position: { x: 0, y: 0 }, config: DEFAULT_CONFIG[type] } as unknown as FlowNode
      const graph = { nodes: type === "trigger" ? [node] : [trigger, node], edges: type === "trigger" ? [] : [{ id: "e1", source: "trigger", target: "node", sourceHandle: "always" }] } as unknown as FlowGraph
      renderPanel(type === "trigger" ? { ...node, id: "trigger" } : node, graph)
      expect(screen.getAllByText(NODE_TYPE_LABELS[type]).length).toBeGreaterThan(0)
      expect(screen.getByRole("button", { name: "Fechar painel" })).toBeInTheDocument()
    })
  }
})
