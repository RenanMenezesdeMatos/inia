import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { obligationReadingOf } from "./call-review.js"
import { OBLIGATION_REVIEW_PROMPT_VERSION, OBLIGATION_REVIEW_SYSTEM_PROMPT } from "./obligation-review.js"

/**
 * `OUTSIDE_DEPENDENCY_SPOKEN_PART_V1` (prompt da revisão V7, 22/10/2026) — obrigação MISTA (dizer algo ao cliente + executar no sistema):
 * a conclusão vale para a parte julgada (a dita). A marca de dependência de fora da fala é LEITURA da revisora (o prompt diz quando ela vale);
 * o código só tira a consequência — sem a marca, o desvio dito na conversa é confirmado; com ela, continua barrado.
 */
describe("obrigação mista: a parte dita é julgada pelo que a conversa mostra", () => {
  const mixed = { actPlace: "MIXED" as const, judgedPart: "Informar o canal e o prazo da segunda via" }

  it("fala que contraria o conteúdo fixado pela fonte (canal e prazo de outro produto), sem dependência de fora → o desvio é confirmado", () => {
    expect(obligationReadingOf({ status: "NOT_MET", evidenceKind: null, verdict: { ...mixed, evidenceReading: "CONTRARY_ACTION_IN_CALL", outsideDependency: false } })).toBeNull()
  })

  it("com a dependência de fora marcada pela revisora, a conclusão não é confirmada (o dito só estaria certo depois de conferir no sistema)", () => {
    expect(obligationReadingOf({ status: "MET", evidenceKind: null, verdict: { ...mixed, evidenceReading: "ACTION_IN_CALL", outsideDependency: true } })).toBe("EXECUTION_OUTSIDE_CONVERSATION")
  })

  it("o prompt da revisão diz que, em MIXED, a marca é sobre a parte julgada e que contrariar o conteúdo fixado pela fonte não depende de fora", () => {
    expect(OBLIGATION_REVIEW_PROMPT_VERSION).toBe("OBLIGATION_REVIEW_PROMPT_V7")
    expect(OBLIGATION_REVIEW_SYSTEM_PROMPT).toContain("Em MIXED, responda sobre a parte julgada (judgedPart)")
    expect(OBLIGATION_REVIEW_SYSTEM_PROMPT).toContain("a conclusão sobre a fala não depende de nada fora dela — false")
    expect(OBLIGATION_REVIEW_SYSTEM_PROMPT).toContain("Continua true quando o acerto do que foi dito depende de algo do sistema")
  })
})
