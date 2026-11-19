import { describe, expect, it } from "vitest"

import { simulationResultSchema } from "./intervention-policy.schema"

/** Resposta de `POST /admin/intervention-policies/:id/simulate` com UMA decisão; o backend devolve a decisão inteira. */
const simulation = (decision: { status: string; effectiveEffect: string }) => ({
  simulated: true,
  effects: "NONE",
  draftIssues: [],
  evaluation: {
    policy: { id: "p-1", key: "TMA", name: "TMA", versionId: "v-1", version: 1, effectiveFrom: null },
    person: { id: "op-1", name: "Rafael Cardoso", teamName: null },
    asOf: "2026-11-19T12:00:00.000Z",
    subjectKey: "TMA",
    indicatorCode: null,
    notApplicableReason: null,
    outcome: decision.status === "NOTIFIED" ? "NOTIFIED" : "RECOMMENDED",
    selection: { status: "MATCHED", blockedBy: null, inconclusiveRules: [] },
    rules: [],
    decisions: [{ typeKey: "OBSERVAR", typeName: "Observar", ruleKey: "r1", mode: "MATCHED", note: null, alsoRequestedBy: [], assignment: null, ...decision }],
    justification: "",
  },
  report: null,
})

describe("contrato da simulação de política", () => {
  it("aceita a regra que só avisa quem lidera (decisão NOTIFIED, efeito NOTIFY)", () => {
    const parsed = simulationResultSchema.parse(simulation({ status: "NOTIFIED", effectiveEffect: "NOTIFY" }))
    expect(parsed.evaluation.decisions[0]).toMatchObject({ status: "NOTIFIED", effectiveEffect: "NOTIFY" })
  })

  it("continua aceitando recomendar e abrir, e recusa efeito ou situação que o backend não tem", () => {
    expect(simulationResultSchema.safeParse(simulation({ status: "RECOMMENDED", effectiveEffect: "RECOMMEND" })).success).toBe(true)
    expect(simulationResultSchema.safeParse(simulation({ status: "CREATED", effectiveEffect: "OPEN" })).success).toBe(true)
    expect(simulationResultSchema.safeParse(simulation({ status: "CREATED", effectiveEffect: "DISMISS" })).success).toBe(false)
    expect(simulationResultSchema.safeParse(simulation({ status: "INVENTADO", effectiveEffect: "OPEN" })).success).toBe(false)
  })
})
