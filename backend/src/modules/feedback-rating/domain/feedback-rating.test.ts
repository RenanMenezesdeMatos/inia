import { describe, expect, it } from "vitest"

import { CONTESTATION_AUDIT_ENTITY, CONTESTATION_ORIGINS, readAgreementInputSchema, sameAgreement } from "./feedback-rating.js"

describe("concordância na ciência — contrato da escolha", () => {
  it("concordar não aceita motivo nem justificativa", () => {
    expect(readAgreementInputSchema.parse({ value: "AGREE" })).toEqual({ value: "AGREE" })
    expect(readAgreementInputSchema.safeParse({ value: "AGREE", reason: "UNCLEAR" }).success).toBe(false)
    expect(readAgreementInputSchema.safeParse({ value: "AGREE", justification: "Concordo." }).success).toBe(false)
  })

  it("discordar exige motivo da lista e justificativa aparada de 3 a 1000 caracteres", () => {
    expect(readAgreementInputSchema.parse({ value: "DISAGREE", reason: "WRONG_PROCESS", justification: "  O prazo certo é de 7 dias.  " })).toEqual({
      value: "DISAGREE",
      reason: "WRONG_PROCESS",
      justification: "O prazo certo é de 7 dias.",
    })
    expect(readAgreementInputSchema.safeParse({ value: "DISAGREE", reason: "WRONG_PROCESS" }).success).toBe(false)
    expect(readAgreementInputSchema.safeParse({ value: "DISAGREE", justification: "Sem motivo escolhido." }).success).toBe(false)
    expect(readAgreementInputSchema.safeParse({ value: "DISAGREE", reason: "WRONG_PROCESS", justification: "   " }).success).toBe(false)
    expect(readAgreementInputSchema.safeParse({ value: "DISAGREE", reason: "WRONG_PROCESS", justification: " ok " }).success).toBe(false)
    expect(readAgreementInputSchema.safeParse({ value: "DISAGREE", reason: "MADE_UP", justification: "Texto qualquer" }).success).toBe(false)
    expect(readAgreementInputSchema.safeParse({ value: "DISAGREE", reason: "OTHER", justification: "a".repeat(1001) }).success).toBe(false)
    expect(readAgreementInputSchema.safeParse({ value: "DISAGREE", reason: "OTHER", justification: "a".repeat(1000) }).success).toBe(true)
  })

  it("nada pré-escolhido: sem valor, valor desconhecido, nulo ou campo extra = inválido", () => {
    expect(readAgreementInputSchema.safeParse({}).success).toBe(false)
    expect(readAgreementInputSchema.safeParse(null).success).toBe(false)
    expect(readAgreementInputSchema.safeParse({ value: "UP" }).success).toBe(false)
    expect(readAgreementInputSchema.safeParse({ value: "NONE" }).success).toBe(false)
    expect(readAgreementInputSchema.safeParse({ value: "AGREE", personId: "3f1c2b4a-9d8e-4c7b-a6f5-1e2d3c4b5a69" }).success).toBe(false)
  })

  it("mesma escolha = mesmo valor, motivo e texto; qualquer diferença conta", () => {
    const disagree = { value: "DISAGREE" as const, reason: "UNCLEAR" as const, justification: "Não entendi o segundo ponto." }
    expect(sameAgreement({ value: "AGREE", reason: null, justification: null }, { value: "AGREE" })).toBe(true)
    expect(sameAgreement({ value: "AGREE", reason: null, justification: null }, disagree)).toBe(false)
    expect(sameAgreement(disagree, disagree)).toBe(true)
    expect(sameAgreement(disagree, { ...disagree, justification: "Outro texto." })).toBe(false)
    expect(sameAgreement(disagree, { ...disagree, reason: "OTHER" })).toBe(false)
    expect(sameAgreement(disagree, { value: "AGREE" })).toBe(false)
  })

  it("cada origem de contestação tem o seu tipo de entidade na auditoria", () => {
    expect(CONTESTATION_ORIGINS.map((origin) => CONTESTATION_AUDIT_ENTITY[origin])).toEqual(["feedback_rating", "feedback_read_agreement"])
  })
})
