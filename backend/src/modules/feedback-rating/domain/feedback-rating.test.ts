import { describe, expect, it } from "vitest"

import { feedbackRatingInputSchema, sameRating } from "./feedback-rating.js"

const SOURCE = { kind: "PUBLISHED_FEEDBACK" as const, id: "3f1c2b4a-9d8e-4c7b-a6f5-1e2d3c4b5a69" }

describe("avaliação do feedback — contrato", () => {
  it("curtir e retirar não aceitam motivo nem descrição", () => {
    expect(feedbackRatingInputSchema.parse({ source: SOURCE, value: "UP" })).toEqual({ source: SOURCE, value: "UP" })
    expect(feedbackRatingInputSchema.safeParse({ source: SOURCE, value: "UP", reason: "UNCLEAR" }).success).toBe(false)
    expect(feedbackRatingInputSchema.safeParse({ source: SOURCE, value: "NONE", comment: "x" }).success).toBe(false)
  })

  it("descurtir exige motivo da lista e descrição (aparada, 3–1000 caracteres)", () => {
    expect(feedbackRatingInputSchema.parse({ source: SOURCE, value: "DOWN", reason: "WRONG_PROCESS", comment: "  O prazo certo é de 7 dias.  " })).toEqual({
      source: SOURCE,
      value: "DOWN",
      reason: "WRONG_PROCESS",
      comment: "O prazo certo é de 7 dias.",
    })
    expect(feedbackRatingInputSchema.safeParse({ source: SOURCE, value: "DOWN", reason: "WRONG_PROCESS" }).success).toBe(false)
    expect(feedbackRatingInputSchema.safeParse({ source: SOURCE, value: "DOWN", reason: "WRONG_PROCESS", comment: "   " }).success).toBe(false)
    expect(feedbackRatingInputSchema.safeParse({ source: SOURCE, value: "DOWN", reason: "MADE_UP", comment: "Texto qualquer" }).success).toBe(false)
    expect(feedbackRatingInputSchema.safeParse({ source: SOURCE, value: "DOWN", reason: "OTHER", comment: "a".repeat(1001) }).success).toBe(false)
  })

  it("fonte precisa ser um tipo conhecido com id uuid; pessoa nunca vem do corpo", () => {
    expect(feedbackRatingInputSchema.safeParse({ source: { kind: "CHAT", id: SOURCE.id }, value: "UP" }).success).toBe(false)
    expect(feedbackRatingInputSchema.safeParse({ source: { kind: "PUBLISHED_FEEDBACK", id: "1" }, value: "UP" }).success).toBe(false)
    expect(feedbackRatingInputSchema.safeParse({ source: SOURCE, value: "UP", personId: SOURCE.id }).success).toBe(false)
  })

  it("mesma avaliação vigente = nada a gravar; qualquer diferença grava", () => {
    const down = { value: "DOWN" as const, reason: "UNCLEAR" as const, comment: "Não entendi o segundo ponto." }
    expect(sameRating(null, { source: SOURCE, value: "NONE" })).toBe(true)
    expect(sameRating(null, { source: SOURCE, value: "UP" })).toBe(false)
    expect(sameRating({ value: "UP", reason: null, comment: null }, { source: SOURCE, value: "UP" })).toBe(true)
    expect(sameRating(down, { source: SOURCE, ...down })).toBe(true)
    expect(sameRating(down, { source: SOURCE, ...down, comment: "Outro texto." })).toBe(false)
    expect(sameRating(down, { source: SOURCE, value: "UP" })).toBe(false)
    expect(sameRating({ value: "NONE", reason: null, comment: null }, { source: SOURCE, value: "NONE" })).toBe(true)
  })
})
