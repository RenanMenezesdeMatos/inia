import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { ReliableGenerationResult } from "../../reliable-feedback/application/generate-reliable-feedback.js"
import { SimulationEffectSink } from "./simulation-effect-sink.js"

/**
 * V1.5.12 — QA Lab: "Gerar feedback" e o Output do artefato SIMULADOS — o trace mostra a origem escolhida, a disposição
 * (READY/HOLD/BLOCKED), o texto que seguiria e a publicação que o Output faria; nada é gravado nem entregue.
 */
const result = (disposition: "READY" | "HOLD_FOR_QA"): ReliableGenerationResult => ({
  artifactId: "sim-artifact",
  reused: false,
  reviews: [],
  record: { artifact: { items: [{}, {}], writer: { invoked: true } } } as never,
  nodeOutput: { kind: "RELIABLE_FEEDBACK_ARTIFACT", contract: "RELIABLE_FEEDBACK_ARTIFACT_V1", artifactId: "sim-artifact", domain: "MONITORING", sourceNodeId: "agent", sourceType: "AGENT", disposition, label: "Atendimento", items: disposition === "READY" ? [{ index: 0, section: "OPPORTUNITY", sectionLabel: "Ponto de desenvolvimento", wording: { observed: "o", whyItMatters: "w", whatYouCanDo: "c" }, wordingSource: "PROPOSED", qaStatus: "NOT_SELECTED_FOR_QA", facts: [], knowledge: null, grounding: "NO_GROUNDED_GUIDANCE", process: null }] : [], text: disposition === "READY" ? "texto emitível" : "", policyVersion: "P", reasons: disposition === "READY" ? ["AUTONOMY_CRITERIA_MET"] : ["FEEDBACK_KIND_NOT_RELEASED_FOR_AUTONOMY"], limitations: [] },
})

describe("V1.5.12 — QA Lab simula o feedback confiável sem efeitos reais", () => {
  it("geração: efeito RELIABLE_FEEDBACK com disposição, itens e texto que seguiria; a emissão do Output é idempotente por nó", async () => {
    const simulate = vi.fn(async () => result("READY"))
    const sink = new SimulationEffectSink([], { simulateReliableFeedback: simulate })
    sink.beginNode("feedback")
    await sink.reliableFeedback.generate({} as Database, {} as never)
    expect(sink.effects[0]).toMatchObject({ kind: "RELIABLE_FEEDBACK", nodeId: "feedback", domain: "MONITORING", sourceType: "AGENT", disposition: "READY", itemCount: 2, emittableCount: 1, writerInvoked: true, text: "texto emitível" })
    sink.beginNode("output")
    const first = await sink.reliableFeedback.publishFollowUp({} as Database, { organizationId: "o", enrollmentId: "e", nodeId: "output", recipientId: "op", artifactId: "sim-artifact" })
    const second = await sink.reliableFeedback.publishFollowUp({} as Database, { organizationId: "o", enrollmentId: "e", nodeId: "output", recipientId: "op", artifactId: "sim-artifact" })
    expect(second).toEqual({ ...first, reused: true })
    expect(sink.effects.filter((effect) => effect.kind === "RELIABLE_FEEDBACK_EMISSION")).toHaveLength(1)
    expect(await sink.findRecentCaseId()).toBe(first.caseId)
  })
  it("HOLD_FOR_QA: o trace mostra a retenção e nenhum texto seguiria", async () => {
    const sink = new SimulationEffectSink([], { simulateReliableFeedback: vi.fn(async () => result("HOLD_FOR_QA")) })
    sink.beginNode("feedback")
    await sink.reliableFeedback.generate({} as Database, {} as never)
    expect(sink.effects[0]).toMatchObject({ kind: "RELIABLE_FEEDBACK", disposition: "HOLD_FOR_QA", emittableCount: 0, text: "", reasons: ["FEEDBACK_KIND_NOT_RELEASED_FOR_AUTONOMY"] })
  })
})
