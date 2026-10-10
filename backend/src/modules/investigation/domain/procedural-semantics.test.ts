import { describe, expect, it } from "vitest"
import { compareModality, compareProcedure, compareQuantities, emptyProceduralTelemetry, evaluateCondition, evaluateProcedureAssertions, parseQuantity, proceduralCoverageOf, subjectMatchScore, verifyKnowledgeRules, type AssertionInput, type KnowledgeExcerptView, type KnowledgeRule, type ProcedureAssertionSemantics } from "./procedural-semantics.js"

const rule = (input: Partial<KnowledgeRule> & { subject: string; modality: KnowledgeRule["modality"] }): KnowledgeRule => ({ ruleRef: "KR1", documentRef: "K1", documentTitle: "Procedimento", condition: null, action: null, valueText: null, value: null, quote: "trecho", ...input })
const assertion = (input: Partial<ProcedureAssertionSemantics> & { subject: string; modality: ProcedureAssertionSemantics["modality"] }): ProcedureAssertionSemantics => ({ condition: null, action: null, valueText: null, value: null, ...input })

describe("V1.4.5 §12/§13 — prazo e range: o runtime representa o operador, o LLM não calcula", () => {
  it("reconhece EQ, LTE, GTE e RANGE, e a marcação de dias úteis", () => {
    expect(parseQuantity("48 horas")).toMatchObject({ operator: "EQ", value: 48, unit: "HOURS", businessUnit: false })
    expect(parseQuantity("até 48 horas")).toMatchObject({ operator: "LTE", value: 48, unit: "HOURS" })
    expect(parseQuantity("em até 5 dias úteis")).toMatchObject({ operator: "LTE", value: 5, unit: "DAYS", businessUnit: true })
    expect(parseQuantity("no mínimo 24 horas")).toMatchObject({ operator: "GTE", value: 24 })
    expect(parseQuantity("24 a 48 horas")).toMatchObject({ operator: "RANGE", value: 24, valueMax: 48 })
    expect(parseQuantity("assim que possível")).toBeNull()
  })

  it("§39 '48h' dentro de 'até 48h' é COMPATIBLE; '72h' é INCOMPATIBLE; 'úteis' × corridas não é comparável", () => {
    expect(compareQuantities(parseQuantity("48 horas"), parseQuantity("até 48 horas"))).toBe("COMPATIBLE")
    expect(compareQuantities(parseQuantity("72 horas"), parseQuantity("até 48 horas"))).toBe("INCOMPATIBLE")
    expect(compareQuantities(parseQuantity("48 horas"), parseQuantity("24 a 48 horas"))).toBe("COMPATIBLE")
    expect(compareQuantities(parseQuantity("2 dias"), parseQuantity("até 48 horas"))).toBe("COMPATIBLE")
    // "48 horas úteis" não é convertível em 48 horas corridas — a aplicação não inventa a equivalência.
    expect(compareQuantities(parseQuantity("48 horas úteis"), parseQuantity("até 48 horas"))).toBe("NOT_COMPARABLE")
    expect(compareQuantities(parseQuantity("R$ 50"), parseQuantity("até 48 horas"))).toBe("NOT_COMPARABLE")
  })
})

describe("V1.4.5 §10 — modalidade nunca é invertida", () => {
  it("§36 OPTIONAL não vira erro; §37 REQUIRED negado explicitamente é divergência", () => {
    expect(compareModality("ASSERTED_ABSENCE_OF_REQUIREMENT", "OPTIONAL")).toBe("ALIGNED")
    expect(compareModality("ASSERTED_REQUIREMENT", "OPTIONAL")).toBe("SOFT_CONFLICT")
    expect(compareModality("ASSERTED_ABSENCE_OF_REQUIREMENT", "REQUIRED")).toBe("CONFLICT")
    expect(compareModality("ASSERTED_REQUIREMENT", "REQUIRED")).toBe("ALIGNED")
    expect(compareModality("ASSERTED_PERMISSION", "PROHIBITED")).toBe("CONFLICT")
    expect(compareModality("ASSERTED_FACT", "INFORMATIONAL")).toBe("NEUTRAL")
  })

  it("§36 a base diz que a ação é OPCIONAL e o atendimento não a fez: nenhum finding de erro", () => {
    const comparison = compareProcedure(assertion({ subject: "envio de documento", modality: "ASSERTED_ABSENCE_OF_REQUIREMENT" }), rule({ subject: "envio de documento", modality: "OPTIONAL" }), "cliente pergunta se precisa enviar documento")
    expect(comparison.status).toBe("CONSISTENT")
  })

  it("§37 a base exige sob condição sustentada e o operador nega: divergência", () => {
    const comparison = compareProcedure(assertion({ subject: "confirmacao de titularidade", modality: "ASSERTED_ABSENCE_OF_REQUIREMENT" }), rule({ subject: "confirmacao de titularidade", modality: "REQUIRED", condition: "antes de formalizar a negociacao" }), "o cliente pediu para formalizar a negociacao antes de encerrar")
    expect(comparison).toMatchObject({ status: "CONTRADICTED", conditionMatch: "MATCHED" })
  })

  it("§38 condição da regra não sustentada pelo contexto: NOT_APPLICABLE, nunca divergência", () => {
    const comparison = compareProcedure(assertion({ subject: "segunda via", modality: "ASSERTED_ABSENCE_OF_REQUIREMENT" }), rule({ subject: "segunda via", modality: "REQUIRED", condition: "para clientes com procuracao judicial em inventario" }), "cliente titular pediu a segunda via da conta do mes")
    expect(comparison).toMatchObject({ status: "NOT_APPLICABLE", conditionMatch: "UNSUPPORTED" })
    expect(evaluateCondition(rule({ subject: "x", modality: "REQUIRED" }), "qualquer contexto")).toBe("UNCONDITIONAL")
  })

  it("§39 prazo compatível é CONSISTENT; prazo fora do limite, nas mesmas condições, é CONTRADICTED", () => {
    const base = rule({ subject: "prazo de reenvio da segunda via", modality: "INFORMATIONAL", valueText: "até 48 horas", value: parseQuantity("até 48 horas") })
    const ok = compareProcedure(assertion({ subject: "prazo de reenvio da segunda via", modality: "ASSERTED_FACT", valueText: "48 horas", value: parseQuantity("48 horas") }), base, "cliente perguntou o prazo do reenvio")
    const bad = compareProcedure(assertion({ subject: "prazo de reenvio da segunda via", modality: "ASSERTED_FACT", valueText: "72 horas", value: parseQuantity("72 horas") }), base, "cliente perguntou o prazo do reenvio")
    expect(ok.status).toBe("CONSISTENT")
    expect(bad.status).toBe("CONTRADICTED")
  })

  it("§14 sem regra que sustente o assunto: INSUFFICIENT_KNOWLEDGE — nunca conhecimento geral", () => {
    expect(compareProcedure(assertion({ subject: "portabilidade numerica", modality: "ASSERTED_REQUIREMENT" }), null, "").status).toBe("INSUFFICIENT_KNOWLEDGE")
    const evaluations = evaluateProcedureAssertions(
      [{ interactionRef: "I1", assertionRef: "P1", summary: "disse que precisa de boletim de ocorrencia", semantics: assertion({ subject: "boletim de ocorrencia", modality: "ASSERTED_REQUIREMENT" }), contextText: "cliente relatou perda do aparelho" }] as AssertionInput[],
      [rule({ subject: "prazo de reenvio da segunda via", modality: "INFORMATIONAL" })],
    )
    expect(evaluations[0]).toMatchObject({ status: "INSUFFICIENT_KNOWLEDGE", rule: null })
  })

  it("§15 escolhe a regra do MESMO assunto entre várias — presença de base não é autoridade genérica", () => {
    const rules = [rule({ ruleRef: "KR1", subject: "cancelamento de plano", modality: "REQUIRED" }), rule({ ruleRef: "KR2", subject: "prazo de reenvio da segunda via de conta", modality: "INFORMATIONAL", valueText: "até 48 horas", value: parseQuantity("até 48 horas") })]
    const evaluations = evaluateProcedureAssertions([{ interactionRef: "I1", assertionRef: "P1", summary: "informou o prazo de reenvio da segunda via", semantics: assertion({ subject: "prazo de reenvio da segunda via de conta", modality: "ASSERTED_FACT", valueText: "48 horas", value: parseQuantity("48 horas") }), contextText: "cliente pediu a segunda via" }], rules)
    expect(evaluations[0]!.rule?.ruleRef).toBe("KR2")
    expect(evaluations[0]!.status).toBe("CONSISTENT")
    expect(subjectMatchScore("cancelamento de plano", rules[1]!)).toBeLessThan(0.5)
  })
})

describe("V1.4.5 §8/§15 — KnowledgeRule só existe com trecho LITERAL do documento apresentado", () => {
  const excerpts: KnowledgeExcerptView[] = [{ documentRef: "K1", documentId: "doc-1", documentTitle: "Segunda Via de Conta", heading: "4 Prazos", excerpt: "O reenvio da segunda via deve ocorrer em até 48 horas após a solicitação." }]

  it("aceita a regra com trecho literal e recusa paráfrase, documento inexistente e sujeito vazio", () => {
    const telemetry = emptyProceduralTelemetry()
    const rules = verifyKnowledgeRules(
      [
        { documentRef: "K1", subject: "prazo de reenvio da segunda via", modality: "REQUIRED", condition: null, action: "reenviar a segunda via", value: "até 48 horas", quote: "em até 48 horas após a solicitação" },
        { documentRef: "K1", subject: "prazo", modality: "REQUIRED", condition: null, action: null, value: null, quote: "o reenvio ocorre em dois dias corridos" },
        { documentRef: "K9", subject: "outro", modality: "REQUIRED", condition: null, action: null, value: null, quote: "em até 48 horas após a solicitação" },
        { documentRef: "K1", subject: "   ", modality: "REQUIRED", condition: null, action: null, value: null, quote: "em até 48 horas após a solicitação" },
      ],
      excerpts,
      telemetry,
    )
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ ruleRef: "KR1", documentTitle: "Segunda Via de Conta", value: { operator: "LTE", value: 48 } })
    expect(telemetry).toMatchObject({ rulesDeclared: 4, rulesVerified: 1, rulesRejected: 3, rulesRejectionReasons: { QUOTE_NOT_LITERAL: 1, UNKNOWN_DOCUMENT: 1, EMPTY_SUBJECT: 1 } })
  })
})

describe("V1.4.5 §19/§20 — cobertura procedimental", () => {
  it("sem checklist estruturado a cobertura é PARTIAL, mesmo com várias regras verificadas", () => {
    const evaluations = evaluateProcedureAssertions(
      [{ interactionRef: "I1", assertionRef: "P1", summary: "prazo", semantics: assertion({ subject: "prazo de reenvio", modality: "ASSERTED_FACT", valueText: "48 horas", value: parseQuantity("48 horas") }), contextText: "" }],
      [rule({ subject: "prazo de reenvio", modality: "INFORMATIONAL", valueText: "até 48 horas", value: parseQuantity("até 48 horas") })],
    )
    expect(proceduralCoverageOf(evaluations)).toMatchObject({ coverage: "PARTIAL", assertionsEvaluated: 1, rulesMatched: 1, checklistAvailable: false })
    expect(proceduralCoverageOf(evaluations, true).coverage).toBe("COMPLETE")
  })
})
