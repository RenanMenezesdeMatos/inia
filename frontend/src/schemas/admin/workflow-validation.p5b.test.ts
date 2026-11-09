import { describe, expect, it } from "vitest"

import { validateWorkflowGraph, type VariableInfo } from "./workflow-validation"
import { variablesDefinedBefore } from "./workflow-validation/node-references"
import type { FlowGraph, FlowNode } from "./workflow-graph.schema"
import type { WorkflowTrigger } from "./workflow.schema"

/**
 * P5b e WF-41 (`docs/qa/workflows/propostas.md`): origem que existe, mas não vem antes da etapa, e origem em variável. O editor só
 * oferece etapas anteriores, mas a referência fica para trás quando alguém remove ou refaz uma ligação. O caso de etapa que não existe
 * é coberto por `workflow-validation.test.ts`.
 */

const position = { x: 0, y: 0 }
const trigger: WorkflowTrigger = { kind: "channel_flag", channelFlagId: "flag-1", channel: "VOICE", flagName: "Rechamada", valueType: "BOOLEAN" }
const AGENT_ID = "0a7a0000-0000-4000-8000-0000000000b1"
const start: FlowNode = { id: "trigger", type: "trigger", label: "Gatilho", position, config: {} }
const finish: FlowNode = { id: "end", type: "end", label: "Fim", position, config: {} }
const agent: FlowNode = { id: "agent", type: "action", label: "Analisar", position, config: { actionType: "CALL_AGENT", agentId: AGENT_ID } }
const deliver = (id: string, source: string): FlowNode => ({ id, type: "output", label: "Entrega", position, config: { target: { type: "SUPERVISOR_OF_OPERATOR" }, surfaces: ["FOLLOW_UP"], source } })
const edge = (source: string, sourceHandle: string, target: string) => ({ id: `${source}-${sourceHandle}-${target}`, source, sourceHandle, target })
const line = (...nodes: FlowNode[]): FlowGraph => ({ nodes, edges: nodes.slice(0, -1).map((node, index) => edge(node.id, "always", nodes[index + 1]!.id)) })
const issuesOf = (graph: FlowGraph, nodeId: string) => validateWorkflowGraph(graph, trigger).filter((issue) => issue.nodeId === nodeId).map((issue) => issue.code)

const review = (contentSource: string): FlowNode => ({ id: "review", type: "human_review", label: "Revisão", position, config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, contentSource } })
const escalation = (contentSource: string): FlowNode => ({ id: "esc", type: "action", label: "Escalonar", position, config: { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, surfaces: ["FOLLOW_UP"], contentSource } })
const check = (config: Record<string, unknown>): FlowNode => ({ id: "cond", type: "condition", label: "Condição", position, config: { comparator: "GT", thresholdNumeric: 3, thresholdBoolean: null, ...config } as never })

describe("P5b · origem que não vem antes da etapa", () => {
  it("Output", () => {
    expect(issuesOf(line(start, deliver("cedo", "nodeOutputs.agent"), agent, deliver("out", "nodeOutputs.agent"), finish), "cedo")).toContain("WORKFLOW_INVALID_OUTPUT")
  })

  it("Revisão", () => {
    const graph: FlowGraph = {
      nodes: [start, review("nodeOutputs.agent"), agent, deliver("out", "nodeOutputs.agent"), finish],
      edges: [edge("trigger", "always", "review"), edge("review", "approved", "agent"), edge("review", "rejected", "end"), edge("review", "escalated", "end"), edge("agent", "always", "out"), edge("out", "always", "end")],
    }
    expect(issuesOf(graph, "review")).toContain("WORKFLOW_INVALID_HUMAN_REVIEW")
  })

  it("Escalonar", () => {
    expect(issuesOf(line(start, escalation("nodeOutputs.agent"), agent, deliver("out", "nodeOutputs.agent"), finish), "esc")).toContain("WORKFLOW_INVALID_ACTION")
  })

  it.each([
    ["simples", { sourcePath: "nodeOutputs.agent" }],
    ["em grupo", { comparator: "EQUALS", thresholdNumeric: null, group: { operator: "ALL", rules: [{ sourcePath: "nodeOutputs.agent", comparator: "GT", thresholdNumeric: 3 }] } }],
  ])("Condição %s", (_name, config) => {
    const graph: FlowGraph = {
      nodes: [start, check(config), agent, deliver("out", "nodeOutputs.agent"), finish],
      edges: [edge("trigger", "always", "cond"), edge("cond", "true", "agent"), edge("cond", "false", "end"), edge("agent", "always", "out"), edge("out", "always", "end")],
    }
    expect(issuesOf(graph, "cond")).toContain("WORKFLOW_INVALID_CONDITION")
  })

  it("controle: com a origem antes da etapa, nenhum problema de referência", () => {
    expect(validateWorkflowGraph(line(start, agent, deliver("out", "nodeOutputs.agent"), finish), trigger)).toEqual([])
    expect(issuesOf(line(start, agent, escalation("nodeOutputs.agent"), deliver("out", "nodeOutputs.agent"), finish), "esc")).toEqual([])
  })
})

describe("WF-41 · origem em variável", () => {
  const VARIABLE_ID = "0a7a0000-0000-4000-8000-0000000000d1"
  const variables = new Map<string, VariableInfo>([[VARIABLE_ID, { type: "TEXT", name: "Texto" }]])
  const setVariable: FlowNode = { id: "define", type: "action", label: "Definir variável", position, config: { actionType: "SET_VARIABLE", variableId: VARIABLE_ID, value: "Texto" } }
  const issuesWithVariables = (graph: FlowGraph, nodeId: string) => validateWorkflowGraph(graph, trigger, new Map(), variables).filter((issue) => issue.nodeId === nodeId).map((issue) => issue.message)
  const path = `variables.${VARIABLE_ID}`

  it("variável definida antes é aceita, em Output, Revisão e Escalonar", () => {
    expect(issuesWithVariables(line(start, setVariable, deliver("saida", path), finish), "saida")).toEqual([])
    expect(issuesWithVariables(line(start, setVariable, escalation(path), finish), "esc")).toEqual([])
    const graph: FlowGraph = {
      nodes: [start, setVariable, review(path), finish],
      edges: [edge("trigger", "always", "define"), edge("define", "always", "review"), edge("review", "approved", "end"), edge("review", "rejected", "end"), edge("review", "escalated", "end")],
    }
    expect(issuesWithVariables(graph, "review")).toEqual([])
  })

  it("variável que só é definida depois é recusada: ela ainda não terá valor", () => {
    expect(issuesWithVariables(line(start, deliver("saida", path), setVariable, finish), "saida").join()).toContain("nenhuma etapa anterior define")
  })

  it("variável apagada é recusada", () => {
    expect(issuesWithVariables(line(start, setVariable, deliver("saida", "variables.0a7a0000-0000-4000-8000-0000000000ee"), finish), "saida").join()).toContain("não existe mais")
  })

  it("no Acompanhamento do próprio colaborador, variável não serve: ali é preciso o resultado inteiro", () => {
    const official: FlowNode = { id: "saida", type: "output", label: "Entrega", position, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: path } }
    expect(issuesWithVariables(line(start, setVariable, official, finish), "saida").join()).toContain("resultado inteiro")
  })

  it("só conta como definida a variável de uma etapa anterior no caminho", () => {
    const graph = line(start, setVariable, deliver("saida", path), finish)
    expect([...variablesDefinedBefore(graph, "saida")]).toEqual([VARIABLE_ID])
    expect([...variablesDefinedBefore(graph, "define")]).toEqual([])
  })
})
