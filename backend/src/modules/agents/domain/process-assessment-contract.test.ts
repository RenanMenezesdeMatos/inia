import { describe, expect, it } from "vitest"
import {
  CHECKPOINT_STATUSES,
  checkpointCapacityFor,
  EVIDENCE_TYPE_MATRIX,
  PROCESS_ASSESSMENT_INSTRUCTIONS,
  PROCESS_ASSESSMENT_LIMITS,
  rawProcessAssessmentSchema,
  validateProcessAssessmentOutput,
  type PresentedExcerptForContract,
} from "./process-assessment-contract.js"
import { INDICATOR_DIAGNOSIS_INSTRUCTIONS } from "./indicator-diagnosis-contract.js"

/**
 * V1.7.1c — o contrato pedido ao modelo e o contrato aceito pelo parser saem da MESMA fonte (limites + matriz). O smoke
 * V1.7.1b morreu exatamente aí: o prompt sugeria `evidenceType: null` e não dizia os limites que o parser recusava.
 */
const DOC = "Procedimento de Teste"
const stepsDoc = (count: number): PresentedExcerptForContract => ({ documentTitle: DOC, excerpt: ["## Etapas", "", ...Array.from({ length: count }, (_, index) => `- [ ] Etapa número ${index + 1} do atendimento?`)].join("\n") })
const checkpoint = (overrides: Record<string, unknown> = {}) => ({
  requirement: "Etapa número 1 do atendimento",
  status: "FOLLOWED",
  evidenceType: "OBSERVED",
  transcriptEvidence: ["Operador: fala"],
  knowledgeQuote: "Etapa número 1 do atendimento?",
  knowledgeDetailQuote: null,
  guidance: { source: "NO_GROUNDED_GUIDANCE", text: null },
  uncertainty: null,
  ...overrides,
})
/** A etapa sem os campos indicados (campo AUSENTE ≠ campo null). */
const without = (value: Record<string, unknown>, ...keys: string[]) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))
const assessmentOf = (checkpoints: unknown[]) => ({ processes: [{ documentTitle: DOC, product: null, checkpoints }], applicability: [] })
const validate = (checkpoints: unknown[], presented: PresentedExcerptForContract[] | null = [stepsDoc(20)]) => validateProcessAssessmentOutput(assessmentOf(checkpoints), { presented })
const codesOf = (result: ReturnType<typeof validate>) => (result.ok ? result.validation.invalidItems.map((item) => item.code) : result.issues.map((issue) => issue.code))

describe("V1.7.1c — evidenceType: matriz única (§20)", () => {
  const cases: [string, string | null, boolean][] = [
    ["FOLLOWED", "OBSERVED", true],
    ["FOLLOWED", null, false],
    ["FOLLOWED", "OMISSION", false],
    ["NOT_FOLLOWED", "OMISSION", true],
    ["NOT_FOLLOWED", "OBSERVED", true],
    ["NOT_FOLLOWED", null, false],
    ["NOT_OBSERVABLE", null, true],
    ["NOT_OBSERVABLE", "OBSERVED", false],
    ["NOT_APPLICABLE", null, true],
    ["NOT_APPLICABLE", "OMISSION", false],
  ]
  it.each(cases)("%s + %s → %s", (status, evidenceType, valid) => {
    // Uma etapa válida ao lado garante que a incoerência vira ETAPA inválida (PARTIAL), não a análise inteira.
    const result = validate([checkpoint({ requirement: "Etapa válida de apoio" }), checkpoint({ status, evidenceType })])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.validation.completeness).toBe(valid ? "COMPLETE" : "PARTIAL")
    if (!valid) expect(result.validation.invalidItems[0]!.code).toBe(evidenceType === null ? "EVIDENCE_TYPE_REQUIRED" : "EVIDENCE_TYPE_NOT_ALLOWED")
  })

  it("ausente vale como null (nunca inferido): FOLLOWED sem o campo é inválido; NOT_OBSERVABLE sem o campo é válido", () => {
    expect(codesOf(validate([checkpoint({ requirement: "Apoio" }), without(checkpoint(), "evidenceType")]))).toEqual(["EVIDENCE_TYPE_REQUIRED"])
    expect(validate([without(checkpoint({ status: "NOT_OBSERVABLE", transcriptEvidence: [] }), "evidenceType")])).toMatchObject({ ok: true, validation: { completeness: "COMPLETE" } })
  })

  it("o prompt descreve exatamente a matriz (e não o texto antigo que sugeria null em qualquer status)", () => {
    for (const status of CHECKPOINT_STATUSES) {
      const allowed = EVIDENCE_TYPE_MATRIX[status].map((value) => (value === null ? "null" : `"${value}"`)).join(" ou ")
      expect(PROCESS_ASSESSMENT_INSTRUCTIONS).toContain(`${status} → ${allowed}`)
      expect(INDICATOR_DIAGNOSIS_INSTRUCTIONS).toContain(`${status} → ${allowed}`)
    }
    expect(PROCESS_ASSESSMENT_INSTRUCTIONS).not.toContain("só em NOT_FOLLOWED")
  })
})

describe("V1.7.1c — quantidade de etapas: teto derivado do documento apresentado (§21)", () => {
  const many = (count: number) => Array.from({ length: count }, (_, index) => checkpoint({ requirement: `Etapa número ${index + 1} do atendimento`, knowledgeQuote: `Etapa número ${index + 1} do atendimento?` }))

  it("A) procedimento com 6 etapas → as 6 aceitas", () => {
    const result = validate(many(6), [stepsDoc(6)])
    expect(result).toMatchObject({ ok: true, validation: { completeness: "COMPLETE" } })
    if (result.ok) expect(result.assessment.processes[0]!.checkpoints).toHaveLength(6)
  })

  it("B) 20 etapas apresentadas → 20 avaliações (o antigo teto de 12 não corta mais nada)", () => {
    expect(checkpointCapacityFor(DOC, [stepsDoc(20)])).toEqual({ presentedSteps: 20, capacity: 20 })
    const result = validate(many(20), [stepsDoc(20)])
    expect(result).toMatchObject({ ok: true, validation: { completeness: "COMPLETE" } })
    if (result.ok) expect(result.assessment.processes[0]!.checkpoints).toHaveLength(20)
  })

  it("C) 21ª etapa que o documento apresentado não tem → rejeitada (a que não está nos trechos sai primeiro), análise PARTIAL", () => {
    const invented = checkpoint({ requirement: "Etapa inventada pelo modelo", knowledgeQuote: "Etapa que não existe no documento" })
    const checkpoints = [...many(10), invented, ...many(20).slice(10)]
    const result = validate(checkpoints, [stepsDoc(20)])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.validation.completeness).toBe("PARTIAL")
    expect(result.validation.invalidItems).toEqual([expect.objectContaining({ code: "CHECKPOINT_CAPACITY_EXCEEDED", requirement: "Etapa inventada pelo modelo", path: "processAssessment.processes.0.checkpoints.10" })])
    expect(result.assessment.processes[0]!.checkpoints).toHaveLength(20)
  })

  it("D) a mesma etapa repetida: mesmo status fica uma; status contraditórios não valem nenhuma", () => {
    const repeated = validate([checkpoint(), checkpoint(), checkpoint({ requirement: "Outra etapa" })])
    expect(codesOf(repeated)).toEqual(["CHECKPOINT_DUPLICATE"])
    if (repeated.ok) expect(repeated.assessment.processes[0]!.checkpoints).toHaveLength(2)
    const contradicted = validate([checkpoint(), checkpoint({ status: "NOT_FOLLOWED", evidenceType: "OBSERVED" }), checkpoint({ requirement: "Outra etapa" })])
    expect(codesOf(contradicted)).toEqual(["CHECKPOINT_CONFLICTING_DUPLICATE", "CHECKPOINT_CONFLICTING_DUPLICATE"])
    if (contradicted.ok) expect(contradicted.assessment.processes[0]!.checkpoints.map((entry) => entry.requirement)).toEqual(["Outra etapa"])
  })

  it("sem etapas em lista no documento vale o piso herdado; acima da trava técnica nunca", () => {
    expect(checkpointCapacityFor(DOC, [{ documentTitle: DOC, excerpt: "O operador deverá informar o prazo." }]).capacity).toBe(PROCESS_ASSESSMENT_LIMITS.checkpointsFloor)
    expect(checkpointCapacityFor(DOC, [stepsDoc(80)]).capacity).toBe(PROCESS_ASSESSMENT_LIMITS.checkpointsSafetyCap)
    expect(checkpointCapacityFor(DOC, null).capacity).toBe(PROCESS_ASSESSMENT_LIMITS.checkpointsSafetyCap)
  })
})

describe("V1.7.1c — texto opcional × obrigatório (§22)", () => {
  it("A/B) opcional ausente ou null → válido", () => {
    expect(validate([without(checkpoint(), "knowledgeDetailQuote", "uncertainty")])).toMatchObject({ ok: true, validation: { completeness: "COMPLETE", normalizations: [] } })
    expect(validate([checkpoint({ uncertainty: null })])).toMatchObject({ ok: true, validation: { completeness: "COMPLETE" } })
  })

  it("C) opcional \"\" → null (registrado), fala vazia removida da lista — nada muda de sentido", () => {
    const result = validate([checkpoint({ uncertainty: "", knowledgeDetailQuote: "  ", guidance: { source: "NO_GROUNDED_GUIDANCE", text: "" }, transcriptEvidence: ["Operador: fala", ""] })])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [normalized] = result.assessment.processes[0]!.checkpoints
    expect(normalized).toMatchObject({ uncertainty: null, knowledgeDetailQuote: null, guidance: { text: null }, transcriptEvidence: ["Operador: fala"] })
    expect(result.validation.completeness).toBe("COMPLETE")
    expect(result.validation.normalizations.map((entry) => entry.code).sort()).toEqual(["EMPTY_LIST_ITEM_REMOVED", "EMPTY_OPTIONAL_TEXT_TO_NULL", "EMPTY_OPTIONAL_TEXT_TO_NULL", "EMPTY_OPTIONAL_TEXT_TO_NULL"])
  })

  it("D) obrigatório \"\" → etapa inválida; se nada sobra, a avaliação inteira é inválida", () => {
    expect(codesOf(validate([checkpoint({ requirement: "Apoio" }), checkpoint({ requirement: "" })]))).toEqual(["CHECKPOINT_SCHEMA_INVALID"])
    const onlyInvalid = validate([checkpoint({ requirement: "" })])
    expect(onlyInvalid.ok).toBe(false)
    expect(codesOf(onlyInvalid)[0]).toBe("NO_VALID_CHECKPOINT")
  })
})

describe("V1.7.1c — envelope × etapas (§9/§10)", () => {
  it("envelope inválido (sem objeto, mais processos que o limite, aplicabilidade fora do contrato) → avaliação inválida", () => {
    expect(validateProcessAssessmentOutput(undefined, { presented: null })).toMatchObject({ ok: false, issues: [{ code: "PROCESS_ASSESSMENT_MISSING" }] })
    const tooMany = { processes: Array.from({ length: PROCESS_ASSESSMENT_LIMITS.processes + 1 }, () => ({ documentTitle: DOC, checkpoints: [checkpoint()] })) }
    expect(validateProcessAssessmentOutput(tooMany, { presented: null }).ok).toBe(false)
    const badApplicability = { ...assessmentOf([checkpoint()]), applicability: [{ status: "TALVEZ" }] }
    expect(validateProcessAssessmentOutput(badApplicability, { presented: null })).toMatchObject({ ok: false, issues: expect.arrayContaining([expect.objectContaining({ code: "APPLICABILITY_INVALID" })]) })
  })

  it("etapa inválida não some: fica em invalidItems com caminho e motivo; a leitura posterior preserva a validação", () => {
    const result = validate([checkpoint(), checkpoint({ requirement: "Etapa com falas demais", transcriptEvidence: ["a", "b", "c", "d", "e"] })])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.validation.invalidItems).toEqual([expect.objectContaining({ path: "processAssessment.processes.0.checkpoints.1", code: "CHECKPOINT_SCHEMA_INVALID", requirement: "Etapa com falas demais", issues: [expect.objectContaining({ path: "processAssessment.processes.0.checkpoints.1.transcriptEvidence", code: "TOO_BIG" })] })])
    const stored = rawProcessAssessmentSchema.parse(JSON.parse(JSON.stringify(result.assessment)))
    expect(stored.validation).toMatchObject({ completeness: "PARTIAL", invalidItems: [{ code: "CHECKPOINT_SCHEMA_INVALID" }] })
  })

  it("o prompt declara todos os limites que o parser aplica (mesma fonte)", () => {
    const L = PROCESS_ASSESSMENT_LIMITS
    for (const text of [`de 1 a ${L.transcriptEvidence} falas`, `"requirement" ${L.requirementChars} caracteres`, `${L.quoteChars}`, `"uncertainty" ${L.uncertaintyChars}`, `até ${L.checkpointsSafetyCap} por processo`, `até ${L.processes} processos`, `nunca "" (texto vazio)`]) {
      expect(PROCESS_ASSESSMENT_INSTRUCTIONS).toContain(text)
      expect(INDICATOR_DIAGNOSIS_INSTRUCTIONS).toContain(text)
    }
  })
})
