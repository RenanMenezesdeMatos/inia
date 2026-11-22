import { Sparkles, Zap } from "lucide-react"
import { describe, expect, it } from "vitest"

import type { FlowNode } from "@/schemas/admin/workflow-graph.schema"

import { NODE_COLORS, nodeColorsFor, nodeColorsOf, nodeIconOf } from "./node-visuals"

const position = { x: 0, y: 0 }
const callAgent = { id: "a", type: "action", label: "", position, config: { actionType: "CALL_AGENT" } } as FlowNode
const generateFeedback = { id: "f", type: "action", label: "", position, config: { actionType: "GENERATE_FEEDBACK" } } as FlowNode

describe("Cores e ícones das etapas", () => {
  it("Chamar agente e Gerar feedback não se confundem no canvas: cor e ícone próprios", () => {
    expect(nodeColorsOf(callAgent)).toEqual(NODE_COLORS.action)
    expect(nodeColorsOf(generateFeedback).accent).not.toBe(nodeColorsOf(callAgent).accent)
    expect(nodeIconOf(callAgent)).toBe(Zap)
    expect(nodeIconOf(generateFeedback)).toBe(Sparkles)
  })

  it("a paleta usa a mesma cor do canvas", () => {
    expect(nodeColorsFor("action", "GENERATE_FEEDBACK")).toEqual(nodeColorsOf(generateFeedback))
    expect(nodeColorsFor("action", "CALL_AGENT")).toEqual(nodeColorsOf(callAgent))
    expect(nodeColorsFor("condition")).toEqual(NODE_COLORS.condition)
  })
})
