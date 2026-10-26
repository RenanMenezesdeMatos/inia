import { afterEach, describe, expect, it } from "vitest"
import { lowReasoningStages } from "./clarification-model.js"

describe("esclarecimento — etapas com menos raciocínio (INIA_CLARIFICATION_LOW_REASONING)", () => {
  afterEach(() => {
    delete process.env.INIA_CLARIFICATION_LOW_REASONING
  })

  it("padrão: só a redação pede menos raciocínio (o planejador escolhe as seções com o raciocínio de sempre)", () => {
    expect([...lowReasoningStages()]).toEqual(["ANSWER"])
  })

  it("lista de etapas, desligado e valores desconhecidos ignorados — lido a cada chamada", () => {
    process.env.INIA_CLARIFICATION_LOW_REASONING = "answer"
    expect([...lowReasoningStages()]).toEqual(["ANSWER"])
    process.env.INIA_CLARIFICATION_LOW_REASONING = "PLANNER, ANSWER"
    expect([...lowReasoningStages()].sort()).toEqual(["ANSWER", "PLANNER"])
    process.env.INIA_CLARIFICATION_LOW_REASONING = "off"
    expect(lowReasoningStages().size).toBe(0)
    process.env.INIA_CLARIFICATION_LOW_REASONING = "TUDO"
    expect(lowReasoningStages().size).toBe(0)
  })
})
