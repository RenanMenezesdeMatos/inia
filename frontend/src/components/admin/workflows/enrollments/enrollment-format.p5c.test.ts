import { describe, expect, it } from "vitest"

import { enrollmentStatusLabelOf, type WorkflowEnrollment, type WorkflowEnrollmentEvent } from "@/schemas/admin/workflow.schema"

import { blockedReasonText, blockReasonOf, BLOCKED_GUIDANCE, describeRetryEvent, enrollmentEventLabel } from "./enrollment-format"
import { blockedGuidanceOf, blockedStepText } from "./execution-links"

/**
 * P5c (`docs/qa/workflows/propostas.md`): motivo de bloqueio na tela. Antes, qualquer motivo desconhecido virava "agente inativo",
 * o que seria falso numa revisão sem revisor.
 */

const event = (payload: Record<string, unknown>) => ({ eventType: "node_blocked", payload }) as unknown as WorkflowEnrollmentEvent
const blocked = (blockedReason: string | null, blockedDetails: Record<string, unknown> | null = null) => ({ status: "blocked", blockedReason, blockedDetails, blockedNodeId: "revisao", currentNodeId: "revisao" }) as unknown as WorkflowEnrollment
const graph = { nodes: [{ id: "revisao", type: "human_review", label: "Revisão da supervisão", position: { x: 0, y: 0 }, config: {} }], edges: [] } as never

describe("P5c · motivo do bloqueio na tela", () => {
  it("reconhece os motivos de revisão", () => {
    expect(blockReasonOf("HUMAN_REVIEW_NO_REVIEWER")).toBe("HUMAN_REVIEW_NO_REVIEWER")
    expect(blockReasonOf("HUMAN_REVIEW_CONTENT_MISSING")).toBe("HUMAN_REVIEW_CONTENT_MISSING")
  })

  it("motivo desconhecido não vira agente inativo", () => {
    expect(blockReasonOf("TRIGGERING_RECORD_CANCELLED")).toBe("TRIGGERING_RECORD_CANCELLED")
    expect(blockedReasonText("TRIGGERING_RECORD_CANCELLED", null)).toMatch(/medição.*cancelada/)
    expect(BLOCKED_GUIDANCE.TRIGGERING_RECORD_CANCELLED).toMatch(/nova tentativa/)
    expect(blockReasonOf("MOTIVO_FUTURO")).toBe("UNKNOWN")
    expect(BLOCKED_GUIDANCE.UNKNOWN).not.toMatch(/agente/i)
  })

  it("controle: execução antiga sem motivo gravado continua como agente inativo", () => {
    expect(blockReasonOf(null)).toBe("AGENT_INACTIVE")
    expect(blockReasonOf("AGENT_ACCESS_NOT_AUTHORIZED")).toBe("AGENT_ACCESS_NOT_AUTHORIZED")
  })

  it("o rótulo do estado diz o motivo", () => {
    expect(enrollmentStatusLabelOf(blocked("HUMAN_REVIEW_NO_REVIEWER"))).toBe("Bloqueada — sem revisor")
    expect(enrollmentStatusLabelOf(blocked("HUMAN_REVIEW_CONTENT_MISSING"))).toBe("Bloqueada — conteúdo ausente")
  })

  it("o evento deixa de falar em etapa do agente", () => {
    expect(enrollmentEventLabel("node_blocked")).toBe("Bloqueada")
  })

  it.each([
    ["NO_ONE_IN_CHAIN", /não tem .*na hierarquia/i],
    ["REVIEWER_INACTIVE", /inativ/i],
    ["PREVIOUS_REVIEW_NOT_DECIDED", /revisão anterior/i],
    ["ONLY_THE_COLLABORATOR", /próprio colaborador/i],
  ])("sem revisor, o caso %s aparece em linguagem clara e sem citar agente", (cause, expected) => {
    const description = describeRetryEvent(event({ reason: "HUMAN_REVIEW_NO_REVIEWER", cause }))
    expect(description).toMatch(expected)
    expect(description).not.toMatch(/agente/i)
    const line = blockedStepText(blocked("HUMAN_REVIEW_NO_REVIEWER", { cause }), graph)
    expect(line).toContain("Revisão da supervisão")
    expect(line).toMatch(expected)
    expect(line).not.toMatch(/agente/i)
  })

  it("a prévia da nova tentativa usa o motivo gravado, sem falar em agente", () => {
    expect(blockedReasonText("HUMAN_REVIEW_NO_REVIEWER", { agentName: null, cause: "NO_ONE_IN_CHAIN" })).toMatch(/não tem .*na hierarquia/i)
    expect(blockedReasonText("HUMAN_REVIEW_CONTENT_MISSING", { agentName: null, cause: "VARIABLE_WITHOUT_VALUE" })).toMatch(/variável/i)
    expect(blockedReasonText("HUMAN_REVIEW_NO_REVIEWER", null)).not.toMatch(/agente/i)
  })

  it("a orientação manda ajustar a hierarquia ou o revisor e pedir nova tentativa", () => {
    expect(blockedGuidanceOf(blocked("HUMAN_REVIEW_NO_REVIEWER"))).toMatch(/hierarquia.*nova tentativa/i)
    expect(blockedGuidanceOf(blocked("HUMAN_REVIEW_CONTENT_MISSING"))).toMatch(/conteúdo.*nova tentativa/i)
  })
})
