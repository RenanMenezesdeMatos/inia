import { describe, expect, it } from "vitest"
import { PROTECTED_LEAVE, protectLeave, protectStoredLeave } from "./protected-leave.js"

/**
 * Registros gravados antes da proteção do tipo de afastamento (291bd48c, APPSEC-01) ainda têm INSS/MATERNIDADE/PATERNIDADE nos
 * fatos e no resumo: a leitura (GET da avaliação, relatório, situação inicial, narrativa) protege sem reescrever o banco.
 */
describe("tipo de afastamento protegido na leitura do que já foi gravado", () => {
  const summary = "Situação funcional em 2026-10-20: não elegível (INSS)"
  // Forma do registro gravado antes da correção: status cru nos fatos, no resumo e copiado para a justificativa.
  const legacyEvaluation = {
    id: "0b6f1c1e-1111-4222-8333-444455556666",
    evaluated_at: new Date("2026-10-20T12:00:00Z"),
    rules: [{ key: "r1", trace: { type: "GROUP", items: [{ type: "CONDITION", kind: "EMPLOYMENT", outcome: { status: "NOT_MET", summary, facts: { date: "2026-10-20", status: "INSS", basis: "STATUS" }, references: [] } }] } }],
    facts: { eligibility: { excludedByStatus: { INSS: 2, MATERNIDADE: 1, FERIAS: 3 } } },
    justification: `Regra r1: ${summary}; outra: não elegível (MATERNIDADE)`,
  }

  it("fatos, resumo e justificativa gravados com o tipo exato saem protegidos; o resto do registro fica igual", () => {
    const safe = protectStoredLeave(legacyEvaluation)
    const text = JSON.stringify(safe)
    for (const leaked of ["INSS", "MATERNIDADE", "PATERNIDADE"]) expect(text).not.toContain(leaked)
    expect(safe.rules[0]!.trace.items[0]!.outcome.summary).toBe("Situação funcional em 2026-10-20: não elegível (afastamento — motivo protegido)")
    expect(safe.rules[0]!.trace.items[0]!.outcome.facts.status).toBe(PROTECTED_LEAVE)
    expect(safe.facts.eligibility.excludedByStatus).toEqual({ [PROTECTED_LEAVE]: 3, FERIAS: 3 })
    expect(safe.evaluated_at).toBeInstanceOf(Date)
    expect(safe.id).toBe(legacyEvaluation.id)
    // Original intocado (nada é reescrito).
    expect(legacyEvaluation.rules[0]!.trace.items[0]!.outcome.facts.status).toBe("INSS")
  })

  it("registro gravado já protegido não muda; status não sensível continua visível", () => {
    const current = { summary: "Situação funcional em 2026-11-01: não elegível (afastamento — motivo protegido)", facts: { status: PROTECTED_LEAVE }, other: "não elegível (FERIAS)" }
    expect(protectStoredLeave(current)).toEqual(current)
    expect(protectStoredLeave(protectLeave({ status: "INSS" }))).toEqual({ status: PROTECTED_LEAVE })
  })
})
