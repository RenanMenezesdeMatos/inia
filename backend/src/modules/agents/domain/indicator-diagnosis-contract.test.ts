import { describe, expect, it } from "vitest"
import { INDICATOR_DIAGNOSIS_INSTRUCTIONS, parseInteractionAssessments, renderDiagnosisSampleForAgent } from "./indicator-diagnosis-contract.js"

const assessment = { processes: [{ documentTitle: "Doc", checkpoints: [{ requirement: "Etapa", status: "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: ["fala"], knowledgeQuote: null, guidance: { source: "NO_GROUNDED_GUIDANCE", text: null }, uncertainty: null }] }] }

describe("V1.6.1 — contrato do Agent no diagnóstico de indicador (só o formato; a verificação é da camada de confiabilidade)", () => {
  it("aceita só atendimentos da AMOSTRA do sistema, uma vez cada; malformado = inválido (fail-closed)", () => {
    const parsed = parseInteractionAssessments([{ interactionRef: "I1", processAssessment: assessment }, { interactionRef: "I1", processAssessment: assessment }, { interactionRef: "I9", processAssessment: assessment }], ["I1", "I2"])
    expect(parsed).toMatchObject({ valid: true })
    expect(parsed.accepted.map((entry) => entry.interactionRef)).toEqual(["I1"])
    expect(parseInteractionAssessments(undefined, ["I1"])).toMatchObject({ accepted: [], valid: false })
    expect(parseInteractionAssessments([{ interactionRef: "I1", processAssessment: { processes: [{ documentTitle: "Doc", checkpoints: [{ ...assessment.processes[0]!.checkpoints[0]!, status: "CONFORME" }] }] } }], ["I1"]).valid).toBe(false)
  })
  it("a amostra chega ao Agent só com handle, data local e transcrição; o exemplo do contrato nunca usa um handle real", () => {
    const prompt = renderDiagnosisSampleForAgent({ segmentText: "Motivo investigado: Contestação — 8 de 30 atendimentos do período.", periodLabel: "01/09/2026 a 30/09/2026", sample: [{ handle: "I1", localDate: "2026-09-10", transcript: "OPERADOR: Olá." }] })
    expect(prompt).toContain("=== I1 · 2026-09-10 ===\nOPERADOR: Olá.")
    expect(prompt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
    expect(INDICATOR_DIAGNOSIS_INSTRUCTIONS).not.toMatch(/"interactionRef":\s*"I\d/)
    expect(INDICATOR_DIAGNOSIS_INSTRUCTIONS).toContain("NÃO relaciona etapas ao resultado do indicador")
  })

  it("Indicator Diagnosis V1 — um atendimento fora do contrato sai sozinho (os outros seguem); guidance null = sem orientação; todos inválidos = fail-closed", () => {
    const valid = { interactionRef: "I1", processAssessment: assessment }
    const nullGuidance = { interactionRef: "I2", processAssessment: { processes: [{ documentTitle: "Doc", checkpoints: [{ ...assessment.processes[0]!.checkpoints[0]!, guidance: null }] }] } }
    const broken = { interactionRef: "I3", processAssessment: { processes: [{ documentTitle: "Doc", checkpoints: [{ ...assessment.processes[0]!.checkpoints[0]!, status: "CONFORME" }] }] } }
    const parsed = parseInteractionAssessments([valid, nullGuidance, broken], ["I1", "I2", "I3"])
    expect(parsed.valid).toBe(true)
    expect(parsed.accepted.map((entry) => entry.interactionRef)).toEqual(["I1", "I2"])
    expect(parsed.accepted[1]!.processAssessment.processes[0]!.checkpoints[0]!.guidance).toEqual({ source: "NO_GROUNDED_GUIDANCE", text: null })
    expect(parsed.rejected.map((entry) => entry.interactionRef)).toEqual(["I3"])
    expect(parseInteractionAssessments([broken], ["I3"])).toMatchObject({ valid: false, accepted: [] })
  })
})
