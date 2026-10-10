/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GenerateFeedbackForm } from "./node-config-panel"
import { describeNodeConfig } from "./node-visuals"
import { resolveFeedbackOrigins, resolveReliableFeedbackSources } from "./content-sources"
import { validateWorkflowGraph } from "@/schemas/admin/workflow-validation"
import { qaEffectSchema } from "@/schemas/admin/qa-lab.schema"
import type { Agent } from "@/schemas/admin/agent.schema"
import type { Orchestrator } from "@/schemas/admin/assistant.schema"
import { INDICATOR_DIAGNOSIS_HINT, INDICATOR_OUTPUT_CONTRACT_LABELS, type FlowGraph, type FlowNode } from "@/schemas/admin/workflow-graph.schema"
import type { WorkflowTrigger } from "@/schemas/admin/workflow.schema"

afterEach(cleanup)

const position = { x: 0, y: 0 }
const FLAG: WorkflowTrigger = { kind: "channel_flag", channelFlagId: "flag-1", channel: "VOICE", flagName: "Rechamada", valueType: "BOOLEAN" }
const INDICATOR = { kind: "indicator", indicatorCode: "TMA" } as unknown as WorkflowTrigger
const SCHEDULE = { kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1, anchorDate: "2026-09-16" } as unknown as WorkflowTrigger
const agentsById = new Map([["agent-a", { id: "agent-a", name: "Especialista de Experiência" } as unknown as Agent]])
const orchestratorsById = new Map([["orq-1", { id: "orq-1", name: "Atendimento multidomínio" } as unknown as Orchestrator]])

const n = (id: string, type: string, config: Record<string, unknown> = {}, label = id) => ({ id, type, label, position, config }) as unknown as FlowNode
const e = (source: string, target: string, sourceHandle = "always") => ({ id: `${source}-${target}-${sourceHandle}`, source, target, sourceHandle })
const feedback = (config: Record<string, unknown> = {}) => n("feedback", "action", { actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "AUTO", ...config }, "Gerar feedback")
const output = (config: Record<string, unknown> = {}) => n("output", "output", { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.feedback", ...config }, "Feedback ao operador")
const official = (options: { feedbackNode?: FlowNode; outputNode?: FlowNode; orchestrator?: boolean } = {}): FlowGraph => ({
  nodes: [n("trigger", "trigger"), options.orchestrator ? n("agent", "orchestrator", { orchestratorId: "orq-1", instruction: "x" }, "Orquestrador") : n("agent", "action", { actionType: "CALL_AGENT", agentId: "agent-a" }, "Chamar agente"), options.feedbackNode ?? feedback(), options.outputNode ?? output(), n("end", "end")],
  edges: [e("trigger", "agent"), e("agent", "feedback"), e("feedback", "output"), e("output", "end")],
})

describe("V1.5.12 — editor: \"Gerar feedback\" (camada de confiabilidade obrigatória)", () => {
  it("origens oferecidas: só \"Chamar agente\"/\"Orquestrador\" ANCESTRAIS, com nome humano (nunca id)", () => {
    expect(resolveFeedbackOrigins(official(), "feedback", agentsById, orchestratorsById)).toEqual([{ nodeId: "agent", label: "Chamar agente — Agente: Especialista de Experiência" }])
    expect(resolveFeedbackOrigins(official({ orchestrator: true }), "feedback", agentsById, orchestratorsById)).toEqual([{ nodeId: "agent", label: "Orquestrador — Orquestrador: Atendimento multidomínio" }])
    // O Output enxerga o feedback confiável como fonte.
    expect(resolveReliableFeedbackSources(official(), "output")).toEqual([{ nodeId: "feedback", label: "Feedback confiável: Gerar feedback" }])
  })
  it("formulário: Origem + Tipo (Automático/Monitoria/Indicador); nada de modelo, prompt, validadores ou política", () => {
    render(<GenerateFeedbackForm config={{ sourceNodeId: "agent", feedbackDomain: "AUTO" }} graph={official()} fromNodeId="feedback" agentsById={agentsById} orchestratorsById={orchestratorsById} trigger={FLAG} moduleEnabled onChange={vi.fn()} />)
    expect(screen.getByRole("combobox", { name: "Origem" })).toHaveTextContent("Chamar agente — Agente: Especialista de Experiência")
    expect(screen.getByRole("combobox", { name: "Tipo" })).toHaveTextContent("Automático")
    expect(screen.getByText(/Automático: monitoria/)).toBeInTheDocument()
    const text = screen.getByTestId("generate-feedback-form").textContent ?? ""
    for (const forbidden of ["prompt", "modelo", "validador", "Gemini", "política"]) expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase())
  })
  it("card do nó: \"Feedback confiável · Origem: <nó> · Tipo: …\"", () => {
    expect(describeNodeConfig(feedback(), { getNodeLabel: (id: string) => (id === "agent" ? "Chamar agente" : undefined) } as never)).toBe("Feedback confiável · Origem: Chamar agente · Tipo: Automático")
  })
  it("validação local espelha o publish: fluxo oficial válido; Agent direto no Acompanhamento do operador é erro", () => {
    expect(validateWorkflowGraph(official(), FLAG)).toEqual([])
    expect(validateWorkflowGraph(official(), INDICATOR)).toEqual([])
    const direct: FlowGraph = { nodes: [n("trigger", "trigger"), n("agent", "action", { actionType: "CALL_AGENT", agentId: "agent-a" }, "Chamar agente"), output({ source: "nodeOutputs.agent" }), n("end", "end")], edges: [e("trigger", "agent"), e("agent", "output"), e("output", "end")] }
    expect(validateWorkflowGraph(direct, FLAG).map((issue) => issue.message).join(" ")).toMatch(/adicione "Gerar feedback"/)
    expect(validateWorkflowGraph(direct, SCHEDULE).filter((issue) => /Gerar feedback/.test(issue.message))).toEqual([])
  })
  it("validação local: sem origem, domínio incompatível, Indicador + Orquestrador, superfície sem consumidor, sem Output", () => {
    const messages = (graph: FlowGraph, trigger: WorkflowTrigger) => validateWorkflowGraph(graph, trigger).map((issue) => issue.message).join(" | ")
    expect(messages(official({ feedbackNode: feedback({ sourceNodeId: "" }) }), FLAG)).toMatch(/Escolha a origem/)
    expect(messages(official({ feedbackNode: feedback({ feedbackDomain: "INDICATOR" }) }), FLAG)).toMatch(/gatilho por Indicador/)
    expect(messages(official({ orchestrator: true, feedbackNode: feedback({ feedbackDomain: "INDICATOR" }) }), INDICATOR)).toMatch(/Orquestrador ainda não é suportado/)
    expect(messages(official({ outputNode: output({ surfaces: ["FOLLOW_UP", "INBOX"] }) }), FLAG)).toMatch(/Pendências ainda não tem consumidor real/)
    // Workflow Outputs V1 — Chat/Avatar do próprio operador são aceitos; para outra pessoa, não (o feedback é do colaborador).
    expect(messages(official({ outputNode: output({ surfaces: ["FOLLOW_UP", "CHAT", "AVATAR"] }) }), FLAG)).not.toMatch(/Chat\/Avatar|consumidor/)
    expect(messages(official({ outputNode: output({ surfaces: ["CHAT"], target: { type: "SUPERVISOR_OF_OPERATOR" } }) }), FLAG)).toMatch(/só pode ir para "O próprio operador"/)
    const noOutput: FlowGraph = { nodes: official().nodes.filter((node) => node.id !== "output"), edges: [e("trigger", "agent"), e("agent", "feedback"), e("feedback", "end")] }
    expect(messages(noOutput, FLAG)).toMatch(/não é entregue a ninguém/)
  })
  it("QA Lab aceita os efeitos simulados do feedback confiável", () => {
    expect(qaEffectSchema.safeParse({ kind: "RELIABLE_FEEDBACK", id: 1, nodeId: "feedback", domain: "MONITORING", sourceNodeId: "agent", sourceType: "AGENT", disposition: "HOLD_FOR_QA", itemCount: 1, emittableCount: 0, reasons: ["FEEDBACK_KIND_NOT_RELEASED_FOR_AUTONOMY"], policyVersion: "RELIABLE_FEEDBACK_POLICY_AUTONOMOUS_V1", writerInvoked: true, text: "" }).success).toBe(true)
    expect(qaEffectSchema.safeParse({ kind: "RELIABLE_FEEDBACK_EMISSION", id: 2, nodeId: "output", surface: "FOLLOW_UP", recipientId: "op", artifactId: "a", caseId: "c", feedbackId: "f", reused: false }).success).toBe(true)
  })
})

describe("V1.6.1 — editor: \"Diagnóstico do indicador\" em \"Chamar agente\"", () => {
  const diagnosis = (): FlowGraph => {
    const graph = official()
    return { ...graph, nodes: graph.nodes.map((node) => (node.id === "agent" ? n("agent", "action", { actionType: "CALL_AGENT", agentId: "agent-a", outputContract: "INDICATOR_DIAGNOSIS" }, "Chamar agente") : node)) }
  }
  it("válido com gatilho por Indicador; com Flag é erro no nó (mesma regra do publish)", () => {
    expect(validateWorkflowGraph(diagnosis(), INDICATOR)).toEqual([])
    expect(validateWorkflowGraph(diagnosis(), FLAG)).toContainEqual({ nodeId: "agent", code: "WORKFLOW_INDICATOR_DIAGNOSIS_REQUIRES_INDICATOR", message: "\"Diagnóstico do indicador\" parte da medição de um indicador — só disponível com gatilho por Indicador." })
  })
  it("opções e texto de ajuda: nunca promete causa; sem padrão fica no fato", () => {
    expect(Object.values(INDICATOR_OUTPUT_CONTRACT_LABELS)).toEqual(["Feedback do indicador (só o resultado oficial)", "Diagnóstico do indicador (feedback com base)"])
    expect(INDICATOR_DIAGNOSIS_HINT).toMatch(/Nunca diz que um comportamento causou o resultado/)
    expect(INDICATOR_DIAGNOSIS_HINT).toMatch(/só de forma agregada/)
  })
})
