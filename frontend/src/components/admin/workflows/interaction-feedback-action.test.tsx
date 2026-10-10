/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { InteractionFeedbackForm } from "./node-config-panel"
import { describeNodeConfig } from "./node-visuals"
import { validateWorkflowGraph } from "@/schemas/admin/workflow-validation"
import { qaEffectSchema } from "@/schemas/admin/qa-lab.schema"
import type { FlowGraph, FlowNode, InteractionFeedbackSource } from "@/schemas/admin/workflow-graph.schema"
import type { WorkflowTrigger } from "@/schemas/admin/workflow.schema"

afterEach(cleanup)

const position = { x: 0, y: 0 }
const FLAG: WorkflowTrigger = { kind: "channel_flag", channelFlagId: "flag-1", channel: "VOICE", flagName: "Rechamada", valueType: "BOOLEAN" }
const SCHEDULE = { kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1, anchorDate: "2026-09-16" } as unknown as WorkflowTrigger
const SAMPLE = { kind: "COLLABORATOR_SAMPLE", period: "MONTH", sampleSize: 3, strategy: "DETERMINISTIC_SAMPLE" } as const
const action = (interactionSource: InteractionFeedbackSource): FlowNode => ({ id: "gerar", type: "action", label: "Gerar feedback de atendimento", position, config: { actionType: "GENERATE_INTERACTION_FEEDBACK", interactionSource } })
const graph = (...nodes: FlowNode[]): FlowGraph => ({ nodes: [{ id: "trigger", type: "trigger", label: "Gatilho", position, config: {} }, ...nodes, { id: "end", type: "end", label: "Fim", position, config: {} }], edges: [{ id: "e1", source: "trigger", target: "gerar", sourceHandle: "always" }, { id: "e2", source: "gerar", target: "end", sourceHandle: "always" }] })

describe("V1.5.10 — editor: \"Gerar feedback de atendimento\"", () => {
  it("validação espelha o publish: interação do gatilho só com Flag no modo Individual; amostra vale com agenda", () => {
    expect(validateWorkflowGraph(graph(action({ kind: "TRIGGER_INTERACTION" })), FLAG)).toEqual([])
    expect(validateWorkflowGraph(graph(action(SAMPLE)), SCHEDULE)).toEqual([])
    expect(validateWorkflowGraph(graph(action({ kind: "TRIGGER_INTERACTION" })), SCHEDULE).map((issue) => issue.nodeId)).toEqual(["gerar"])
    // Modo Consolidado sem "Aplicar individualmente": não há colaborador individual.
    expect(validateWorkflowGraph(graph(action(SAMPLE)), SCHEDULE, new Map(), new Map(), true).some((issue) => issue.nodeId === "gerar" && /colaborador individual/.test(issue.message))).toBe(true)
  })

  it("resumo do nó em linguagem de negócio (sem ids)", () => {
    expect(describeNodeConfig(action({ kind: "TRIGGER_INTERACTION" }), { triggerLabel: "Rechamada" })).toBe("Feedback de atendimento · interação do gatilho")
    expect(describeNodeConfig(action(SAMPLE), { triggerLabel: "Agenda" })).toBe('Feedback de atendimento · até 3 do período "Mês anterior" (amostra reproduzível)')
  })

  it("configuração mínima: só quais atendimentos (período, quantidade, como escolher) — nunca prompt, modelo, validadores ou política de QA", () => {
    const onChange = vi.fn()
    render(<InteractionFeedbackForm source={SAMPLE} trigger={SCHEDULE} moduleEnabled onChange={onChange} />)
    expect(screen.getByRole("combobox", { name: "Quais atendimentos" })).toHaveTextContent("Interações do colaborador no período")
    expect(screen.getByRole("combobox", { name: "Período" })).toHaveTextContent("Mês anterior")
    expect(screen.getByRole("combobox", { name: "Como escolher" })).toHaveTextContent("Amostra reproduzível")
    fireEvent.change(screen.getByLabelText("Quantidade por colaborador"), { target: { value: "40" } })
    expect(onChange).toHaveBeenLastCalledWith({ ...SAMPLE, sampleSize: 10 })
    const text = screen.getByTestId("interaction-feedback-form").textContent ?? ""
    for (const forbidden of ["prompt", "modelo", "validador", "Gemini"]) expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase())
    expect(text).toContain("QA de feedback, sem prender o Workflow")
  })

  it("módulo desligado neste ambiente: o nó avisa que não publica", () => {
    render(<InteractionFeedbackForm source={{ kind: "TRIGGER_INTERACTION" }} trigger={FLAG} moduleEnabled={false} onChange={vi.fn()} />)
    expect(screen.getByText(/desligado neste ambiente/)).toBeInTheDocument()
  })

  it("QA Lab aceita o efeito simulado (só códigos seguros)", () => {
    expect(qaEffectSchema.safeParse({ kind: "INTERACTION_FEEDBACK", id: 1, nodeId: "gerar", interactionId: "int", status: "GENERATED", notAnalyzableReason: null, feedbackStatus: "HAS_POINTS", writerInvoked: true, dispositions: { AUTO_DELIVER: 1, HOLD_FOR_QA: 0, BLOCKED: 0 }, reasons: [], policyVersion: "FEEDBACK_DELIVERY_POLICY_AUTONOMOUS_V1" }).success).toBe(true)
  })
})
