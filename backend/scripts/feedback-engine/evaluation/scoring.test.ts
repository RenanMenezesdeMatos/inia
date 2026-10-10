import { describe, expect, it } from "vitest"
import { scoreCase, summarize, type CaseResult, type Truth } from "./scoring.js"

/**
 * O AVALIADOR contra exemplos deliberadamente ruins: mensagens que acertam status e tom mas erram o que importa. Nenhum desses
 * pode sair como "correto" só porque a decisão (publicar) e o tom batem com o gabarito.
 */
const truth: Truth = {
  scenario: "Enviou a segunda via sem validar a data de nascimento.",
  procedure: "Segunda Via",
  path: ["PARTIALLY_CORRECT"],
  mustDeviate: [["data de nascimento"]],
  mustNotAccuse: ["protocolo"],
  mustNotCreditQuote: ["eu mesmo baixo"],
  message: { outcome: ["PUBLISHABLE"], tone: ["DEVELOPMENT", "MIXED"], mustMentionAny: ["nascimento"] },
  expectedGuidance: [["data de nascimento", "nascimento"]],
}
const analysis = (criteria: CaseResult["analysis"] extends infer A ? (A extends { criteria: infer C } ? C : never) : never): CaseResult["analysis"] => ({ outcome: "USABLE", procedure: "Procedimento — Segunda Via de Conta", pathAssessment: "PARTIALLY_CORRECT", criteria })
const deviationOnBirthDate = { text: "- Confirmar data de nascimento.", heading: "Validação do titular", status: "NOT_MET", evidence: [] as string[] }
const good: CaseResult = {
  id: "BOM",
  error: null,
  analysis: analysis([deviationOnBirthDate, { text: "- Informar o protocolo.", heading: "Encerramento", status: "MET", evidence: ["T9 OPERADOR: Seu protocolo é 123."] }]),
  message: { kind: "PUBLISHABLE", reason: null, tone: "DEVELOPMENT", card: "Confirme a data de nascimento antes de enviar a segunda via.", paragraphs: ["Você enviou a segunda via logo depois de confirmar o nome. Na próxima vez, peça a data de nascimento antes de enviar."], sentences: [{ text: "Você enviou a segunda via logo depois de confirmar o nome.", stance: "ADJUSTMENT" }, { text: "Na próxima vez, peça a data de nascimento antes de enviar.", stance: "GUIDANCE" }], developmentRules: [["- Confirmar data de nascimento."]], strengthRules: [] },
}

describe("avaliador por dimensão — status e tom certos NÃO comprovam qualidade", () => {
  it("mensagem boa: dimensões estruturais passam, mas a orientação continua para INSPEÇÃO humana (nunca 'correta' automaticamente)", () => {
    const score = scoreCase(good, truth, [])
    expect(score.dimensions.decision.status).toBe("PASS")
    expect(score.dimensions.toneAndForm.status).toBe("PASS")
    expect(score.dimensions.expectedDeviationsFound).toMatchObject({ status: "PASS", found: 1, expected: 1 })
    expect(score.dimensions.guidance.status).toBe("NEEDS_INSPECTION")
    expect(score.dimensions.guidance.signals).toEqual([])
  })

  it("acerta status/tom mas a ORIENTAÇÃO é outra coisa (desconto): não sai como correta — sinal auxiliar e consequência apontados", () => {
    const wrongGuidance: CaseResult = { ...good, id: "ORIENTAÇÃO ERRADA", message: { ...good.message!, card: "Ofereça desconto integral para encerrar.", paragraphs: ["Na próxima vez, ofereça desconto integral, o que garante a satisfação do cliente."], sentences: [{ text: "Na próxima vez, ofereça desconto integral, o que garante a satisfação do cliente.", stance: "GUIDANCE" }] } }
    const score = scoreCase(wrongGuidance, truth, [])
    expect(score.dimensions.decision.status).toBe("PASS")
    expect(score.dimensions.toneAndForm.status).toBe("PASS")
    expect(score.dimensions.guidance.status).toBe("NEEDS_INSPECTION")
    expect(score.dimensions.guidance.signals.join(" ")).toMatch(/sem relação lexical aparente/)
    expect(score.dimensions.addedConsequences.status).toBe("NEEDS_INSPECTION")
  })

  it("acerta status/tom mas acusa a etapa ERRADA e deixa passar o desvio material: acusação sem suporte + desvio não encontrado", () => {
    const wrongPoint: CaseResult = { ...good, id: "PONTO ERRADO", analysis: analysis([{ ...deviationOnBirthDate, status: "MET", evidence: ["T4 OPERADOR: Me confirma sua data de nascimento?"] }, { text: "- Informar o protocolo.", heading: "Encerramento", status: "NOT_MET", evidence: [] }]) }
    const score = scoreCase(wrongPoint, truth, [])
    expect(score.dimensions.unsupportedAccusations.status).toBe("FAIL")
    expect(score.dimensions.materialDeviationsMissed).toMatchObject({ status: "FAIL", missed: ["data de nascimento"] })
    expect(score.dimensions.decision.status).toBe("PASS")
  })

  it("reconhecimento indevido: elogia como ponto forte a etapa que o gabarito diz ser o desvio, ou credita fala do cliente", () => {
    const praised: CaseResult = { ...good, id: "ELOGIO INDEVIDO", analysis: analysis([deviationOnBirthDate, { text: "- Orientar o download.", heading: "Emissão", status: "MET", evidence: ["T6 CLIENTE: Pode deixar, eu mesmo baixo."] }]), message: { ...good.message!, tone: "MIXED", strengthRules: [["- Confirmar data de nascimento."]] } }
    const score = scoreCase(praised, truth, [])
    expect(score.dimensions.undueRecognitions.status).toBe("FAIL")
    expect(score.dimensions.undueRecognitions.items).toHaveLength(2)
  })

  it("repetição da mesma orientação é apontada (auxiliar); abstenção onde se esperava publicar é FAIL de decisão", () => {
    const repeated: CaseResult = { ...good, id: "REPETIDA", message: { ...good.message!, sentences: [{ text: "Peça a data de nascimento do titular antes de enviar a segunda via.", stance: "GUIDANCE" }, { text: "Antes de enviar a segunda via, peça a data de nascimento do titular.", stance: "GUIDANCE" }] } }
    expect(scoreCase(repeated, truth, []).dimensions.redundancyAndUtility.status).toBe("NEEDS_INSPECTION")
    const abstained: CaseResult = { ...good, id: "ABSTEVE", message: { kind: "ABSTAINED", reason: "NO_SAFE_MESSAGE", tone: null, card: null, paragraphs: [] } }
    expect(scoreCase(abstained, truth, []).dimensions.decision.status).toBe("FAIL")
  })

  it("caso usado para ajustar a implementação vira REGRESSÃO e não entra nos totais independentes", () => {
    const scores = [scoreCase(good, truth, []), scoreCase({ ...good, id: "CALIBRAÇÃO" }, { ...truth, usedForCalibration: true, calibrationNote: "ajustou o prompt" }, [])]
    const summary = summarize(scores)
    expect(summary.cases).toEqual({ independent: 1, regression: 1 })
    expect(summary.independent.decision.PASS).toBe(1)
    expect(summary.regression.decision.PASS).toBe(1)
    expect(Object.keys(summary.independent)).not.toContain("messageOk")
  })
})
