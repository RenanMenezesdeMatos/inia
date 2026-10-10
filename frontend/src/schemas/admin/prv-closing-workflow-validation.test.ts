import { describe, expect, it } from "vitest"
import { resolveFeedbackDomain, type FlowGraph, type FlowNode } from "./workflow-graph.schema"
import { validateReliableFeedbackFlow, validateWorkflowGraph } from "./workflow-validation"
import type { WorkflowTrigger } from "./workflow.schema"

/** Indicator Diagnosis V1 — o editor espelha a regra do backend: diagnóstico do fechamento só com Agenda + "Fechamentos oficiais". */
const position = { x: 0, y: 0 }
const schedule = { kind: "schedule", mode: "CALENDAR", times: ["09:00"], frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 5 }, intervalDays: 1 } as unknown as WorkflowTrigger
const flag = { kind: "channel_flag", channelFlagId: "flag-1", channel: "VOICE", flagName: "Rechamada", valueType: "BOOLEAN" } as WorkflowTrigger
const agent = (source: "PERFORMANCE" | "INDICATOR"): FlowNode => ({ id: "agent", type: "action", label: "Diagnóstico do fechamento", position, config: { actionType: "CALL_AGENT", agentId: "00000000-0000-4000-8000-000000000001", scheduledDataSource: source === "PERFORMANCE" ? { kind: "PERFORMANCE", closures: 1 } : { kind: "INDICATOR", indicatorCode: "TMA", period: "MONTH" }, outputContract: "PRV_CLOSING_DIAGNOSIS" } } as FlowNode)
const graphOf = (source: "PERFORMANCE" | "INDICATOR"): FlowGraph => ({
  nodes: [
    { id: "trigger", type: "trigger", label: "Gatilho", position, config: {} },
    agent(source),
    { id: "feedback", type: "action", label: "Gerar feedback", position, config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "AUTO" } } as FlowNode,
    { id: "output", type: "output", label: "Feedback", position, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.feedback" } } as FlowNode,
    { id: "end", type: "end", label: "Fim", position, config: {} },
  ],
  edges: [{ id: "e1", source: "trigger", target: "agent", sourceHandle: "always" }, { id: "e2", source: "agent", target: "feedback", sourceHandle: "always" }, { id: "e3", source: "feedback", target: "output", sourceHandle: "always" }, { id: "e4", source: "output", target: "end", sourceHandle: "always" }],
})

describe("Indicator Diagnosis V1 — editor de Workflow (diagnóstico do fechamento do PRV)", () => {
  it("Agenda + Fechamentos oficiais + Gerar feedback (AUTO) = feedback de INDICADOR, sem pendência", () => {
    expect(resolveFeedbackDomain("AUTO", "schedule", "AGENT", "PRV_CLOSING_DIAGNOSIS")).toBe("INDICATOR")
    expect(resolveFeedbackDomain("AUTO", "schedule", "AGENT", null)).toBeNull()
    const graph = graphOf("PERFORMANCE")
    expect(validateReliableFeedbackFlow(graph, schedule, false)).toEqual([])
    expect(validateWorkflowGraph(graph, schedule).filter((issue) => issue.message.includes("fechamento"))).toEqual([])
  })

  it("fonte diferente de Fechamentos oficiais, gatilho por Flag ou modo Consolidado: pendência antes de publicar", () => {
    expect(validateWorkflowGraph(graphOf("INDICATOR"), schedule).map((issue) => issue.message)).toContain("\"Diagnóstico do fechamento do PRV\" parte do fechamento oficial — só com gatilho por Agenda e a fonte de dados \"Fechamentos oficiais\".")
    expect(validateWorkflowGraph(graphOf("PERFORMANCE"), flag).some((issue) => issue.message.includes("Diagnóstico do fechamento do PRV"))).toBe(true)
    expect(validateReliableFeedbackFlow(graphOf("PERFORMANCE"), schedule, true).map((issue) => issue.message)).toContain("Feedback do fechamento do PRV precisa do gatilho por Agenda no modo Individual (um colaborador por execução).")
  })
})
