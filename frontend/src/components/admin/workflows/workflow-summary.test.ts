import { describe, expect, it } from "vitest"

import type { FlowGraph } from "@/schemas/admin/workflow-graph.schema"
import type { Workflow } from "@/schemas/admin/workflow.schema"

import { summarizeWorkflow } from "./workflow-summary"

const position = { x: 0, y: 0 }

const workflow: Workflow = {
  id: "wf",
  name: "Nota baixa",
  description: null,
  scopeType: "TEAM",
  teamId: "t1",
  teamName: "B2C",
  subteamId: null,
  subteamName: null,
  active: true,
  createdAt: "2026-11-01T10:00:00Z",
  published: false,
  trigger: { kind: "channel_flag", channelFlagId: "f1", channel: "VOICE", flagName: "nota_ura", valueType: "NUMERIC" },
  activeEnrollments: 0,
  blockedEnrollments: 0,
  consolidatedStructure: null,
  populationFilter: null,
  configurationChanges: [],
}

const graph: FlowGraph = {
  nodes: [
    { id: "trigger", type: "trigger", label: "Início", position, config: {} },
    { id: "agent", type: "action", label: "Análise", position, config: { actionType: "CALL_AGENT", agentId: "a" } },
    { id: "feedback", type: "action", label: "Feedback", position, config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "MONITORING" } },
    { id: "review", type: "human_review", label: "Revisão", position, config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } } },
    { id: "out", type: "output", label: "Entrega", position, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.feedback" } },
    { id: "boss", type: "output", label: "Gestão", position, config: { target: { type: "ROLE", role: "MANAGER" }, surfaces: ["NOTIFICATION"], source: "nodeOutputs.feedback" } },
    { id: "loose", type: "wait", label: "Solta", position, config: { durationMs: 1000 } },
    { id: "end", type: "end", label: "Fim", position, config: {} },
  ],
  edges: [
    { id: "1", source: "trigger", sourceHandle: "always", target: "agent" },
    { id: "2", source: "agent", sourceHandle: "always", target: "feedback" },
    { id: "3", source: "feedback", sourceHandle: "always", target: "review" },
    { id: "4", source: "review", sourceHandle: "approved", target: "out" },
    { id: "5", source: "review", sourceHandle: "rejected", target: "end" },
    { id: "6", source: "review", sourceHandle: "escalated", target: "boss" },
    { id: "7", source: "out", sourceHandle: "always", target: "end" },
    { id: "8", source: "boss", sourceHandle: "always", target: "end" },
  ],
}

describe("summarizeWorkflow", () => {
  const summary = summarizeWorkflow(workflow, graph)

  it("responde quando começa e para quem roda", () => {
    expect(summary.starts).toBe('Quando uma interação chega com a flag "nota_ura"')
    expect(summary.who).toContain("Uma execução por colaborador")
    expect(summary.who).toContain("B2C")
  })

  it("conta o que acontece só no caminho alcançável e avisa o que está solto", () => {
    expect(summary.steps).toBe("1 análise com IA, 1 feedback gerado, 1 revisão humana")
    expect(summary.unreachable).toBe(1)
  })

  it("lista quem recebe com o cargo e o lugar da entrega", () => {
    expect(summary.recipients).toEqual(["O próprio colaborador — Acompanhamento", "Gerente — Notificação"])
  })

  it("avisa que a revisão humana pode parar o fluxo sem prazo", () => {
    expect(summary.ends).toContain("até a revisão ser decidida")
  })

  it("Agenda e Consolidado descrevem a recorrência e a estrutura", () => {
    const scheduled = summarizeWorkflow(
      { ...workflow, trigger: { kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1, frequency: { type: "DAILY" } }, consolidatedStructure: { kind: "TEAM", teamId: "t1" } },
      { nodes: [graph.nodes[0]!, graph.nodes[7]!], edges: [{ id: "x", source: "trigger", sourceHandle: "always", target: "end" }] },
    )
    expect(scheduled.starts).toContain("09:00")
    expect(scheduled.who).toContain("como uma única análise")
    expect(scheduled.steps).toBe("Nenhuma etapa entre o início e o fim")
    expect(scheduled.recipients).toEqual([])
  })

  it("Manual diz que roda para o colaborador escolhido, nunca para todos os elegíveis", () => {
    const manual = summarizeWorkflow({ ...workflow, trigger: { kind: "manual", context: "INTERACTION" } }, graph)
    expect(manual.starts).toContain("Executar agora")
    expect(manual.who).toContain("para o colaborador escolhido em Executar agora")
    expect(manual.who).toContain("B2C")
    expect(manual.who).not.toContain("elegíveis")
  })
})
