import { describe, expect, it } from "vitest"
import { evaluationInputSchema, evaluationOpen, evaluationOpenUntil, mergeEvaluation } from "./evaluation.js"

const ended = new Date("2026-11-09T12:00:00Z")

describe("avaliação do atendimento", () => {
  it("ao menos uma pergunta; estrelas de 1 a 5", () => {
    expect(evaluationInputSchema.safeParse({}).success).toBe(false)
    expect(evaluationInputSchema.safeParse({ stars: 6 }).success).toBe(false)
    expect(evaluationInputSchema.safeParse({ resolved: "PARTIAL" }).success).toBe(true)
  })

  it("aberta 24 h depois do fim; interrompido e em andamento não avaliam", () => {
    expect(evaluationOpenUntil({ endedAt: ended, endCause: "ANJO_CLOSED" })!.toISOString()).toBe("2026-11-10T12:00:00.000Z")
    expect(evaluationOpen({ endedAt: ended, endCause: "OPERATOR_CLOSED" }, new Date("2026-11-10T11:59:59Z"))).toBe(true)
    expect(evaluationOpen({ endedAt: ended, endCause: "OPERATOR_CLOSED" }, new Date("2026-11-10T12:00:00Z"))).toBe(false)
    expect(evaluationOpenUntil({ endedAt: ended, endCause: "ANJO_LOST" })).toBeNull()
    expect(evaluationOpenUntil({ endedAt: null, endCause: null })).toBeNull()
  })

  it("cada pergunta é independente: o que não veio continua como estava", () => {
    expect(mergeEvaluation({ resolved: "YES", stars: null }, { stars: 4 })).toEqual({ resolved: "YES", stars: 4 })
    expect(mergeEvaluation(null, { resolved: "NO" })).toEqual({ resolved: "NO", stars: null })
  })
})
