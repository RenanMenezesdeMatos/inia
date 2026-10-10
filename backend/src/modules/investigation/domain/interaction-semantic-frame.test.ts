import { describe, expect, it } from "vitest"
import { applyAttributionRule, assignClaimHandles, attachProceduralFindings, deriveCrossInteractionPatterns, bestPatternSupport, claimHandleSequence, PATTERN_SUPPORT_LEVELS, patternKindOf, patternSupportOf, patternSynthesisOutputSchema, promoteFindings, renderFrameExtractionInstructions, semanticAnalysisOutputSchema, supportMeets, verifySemanticFrames, verifySemanticOutput, type SemanticAnalysisOutput } from "./interaction-semantic-frame.js"
import { projectTranscript, type ProjectedInteraction } from "./transcript-projection.js"

/**
 * V1.4.0 — SEMANTIC OBSERVATION & PATTERN DISCOVERY: fixtures GENÉRICAS de conversa (nenhum padrão do H1 codificado).
 * Cada teste representa uma CLASSE de falha do benchmark: omissão/necessidade não resolvida, positivo, negativo, neutro,
 * procedimental, controle (observação local sem padrão), low-volume, referência posição × handle.
 */
const project = (entries: [ref: string, content: string][]): ReadonlyMap<string, ProjectedInteraction> => new Map(entries.map(([ref, content], index) => [ref, { interactionRef: ref, interactionId: `id-${index + 1}`, projection: projectTranscript(content) }]))
const unit = (ref: string, turn: string, speaker: string, quote: string) => ({ interactionRef: ref, turnRef: turn, speaker, quote })
const frame = (interactionRef: string, parts: Record<string, unknown[]> = {}) => ({ interactionRef, customerNeeds: [], questions: [], answers: [], agentActions: [], agentStatements: [], commitments: [], customerSignals: [], procedureAssertions: [], findings: [], ...parts })
const parse = (raw: unknown): SemanticAnalysisOutput => semanticAnalysisOutputSchema.parse(raw)

const OMISSION = "OPERADOR: Bom dia, em que posso ajudar?\nCLIENTE: Preciso mandar algum documento para a troca de titularidade?\nOPERADOR: Vou registrar a solicitação aqui.\nCLIENTE: Tá, e o documento?\nOPERADOR: O protocolo é 123. Obrigado pela ligação."
const POSITIVE = "OPERADOR: Bom dia. Antes de seguir, confirme para mim: você quer a segunda via da fatura de março, correto?\nCLIENTE: Isso.\nOPERADOR: Perfeito. Resumindo: a segunda via vai por e-mail em até 24 horas e o vencimento continua dia 10. Ficou claro?\nCLIENTE: Ficou, obrigado."
const NEGATIVE = "CLIENTE: Já é a terceira vez que eu ligo por causa disso.\nOPERADOR: Vou transferir para o setor responsável.\nCLIENTE: Mas ninguém me explica nada!\nEVENTO: [Transferência sem repasse de contexto.]"
const NEUTRAL = "OPERADOR: Bom dia, em que posso ajudar?\nCLIENTE: Quero saber o horário da loja.\nOPERADOR: Das nove às dezoito.\nCLIENTE: Obrigado."

describe("V1.4.0 §52 OMISSÃO / necessidade não resolvida — representada sem inventar fala", () => {
  it("cliente pergunta algo material, resposta parcial, interação encerra → CustomerNeed UNRESOLVED com evidência literal; finding UNRESOLVED_NEED nasce da observação; nenhuma culpa é concluída", () => {
    const projected = project([["I1", OMISSION]])
    const result = verifySemanticOutput({
      parsed: parse({ frames: [frame("I1", {
        customerNeeds: [{ id: "N1", summary: "saber se precisa enviar documento para a troca de titularidade", resolutionStatus: "UNRESOLVED", evidence: [unit("I1", "T2", "CLIENTE", "Preciso mandar algum documento para a troca de titularidade?")] }],
        questions: [{ id: "Q1", askedBy: "CLIENTE", summary: "precisa enviar documento?", evidence: [unit("I1", "T2", "CLIENTE", "Preciso mandar algum documento")] }, { id: "Q2", askedBy: "CLIENTE", summary: "repete a pergunta", evidence: [unit("I1", "T4", "CLIENTE", "Tá, e o documento?")] }],
        answers: [{ id: "R1", answersQuestionRef: "Q1", completeness: "UNRELATED", summary: "operador registra a solicitação sem responder", evidence: [unit("I1", "T3", "OPERADOR", "Vou registrar a solicitação aqui.")] }],
        customerSignals: [{ id: "S1", kind: "REPEATED_QUESTION", summary: "cliente repete a pergunta", evidence: [unit("I1", "T4", "CLIENTE", "Tá, e o documento?")] }],
        findings: [{ id: "F1", kind: "UNRESOLVED_NEED", summary: "a pergunta sobre documento ficou sem resposta na interação", observationRefs: ["N1", "R1", "S1"] }],
      })], patterns: [] }),
      projected, analyzedTranscriptCount: 1, recordedUniverseCount: 1,
    })
    const [only] = result.frames
    expect(only).toMatchObject({ interactionRef: "I1", source: "MODEL", empty: false })
    expect(only!.customerNeeds[0]).toMatchObject({ resolutionStatus: "UNRESOLVED", statusDowngraded: false, resolutionEvidence: [] })
    expect(only!.answers[0]).toMatchObject({ answersQuestionRef: "Q1", completeness: "UNRELATED" })
    expect(only!.findings[0]).toMatchObject({ kind: "UNRESOLVED_NEED", observationRefs: ["N1", "R1", "S1"], quality: { observationCount: 3, evidenceCount: 3 } })
    // Provenance até o turno: cada evidência do finding é uma unidade verificada (interação + turno + falante + trecho).
    expect(only!.findings[0]!.evidence.map((item) => `${item.interactionRef}/${item.turnRef}/${item.speaker}`)).toEqual(["I1/T2/CLIENTE", "I1/T3/OPERADOR", "I1/T4/CLIENTE"])
    expect(result.telemetry).toMatchObject({ customerNeedsCount: 1, unresolvedNeedsCount: 1, riskFindingsCount: 1, strengthFindingsCount: 0, crossInteractionPatternsCount: 0 })
    // Nenhum texto do modelo vira "operador errou": não existe campo de culpa; o frame só descreve.
    expect(JSON.stringify(only)).not.toMatch(/culpa|errou/i)
  })

  it("RESOLVED/PARTIAL sem resolutionEvidence válida cai para UNKNOWN por código (nunca promovido); UNRESOLVED não exige evidência de resolução", () => {
    const projected = project([["I1", OMISSION]])
    const result = verifySemanticOutput({ parsed: parse({ frames: [frame("I1", { customerNeeds: [
      { id: "N1", summary: "documento", resolutionStatus: "RESOLVED", evidence: [unit("I1", "T2", "CLIENTE", "Preciso mandar algum documento")], resolutionEvidence: [unit("I1", "T3", "OPERADOR", "não precisa mandar nada")] },
      { id: "N2", summary: "documento", resolutionStatus: "PARTIAL", evidence: [unit("I1", "T2", "CLIENTE", "Preciso mandar algum documento")], resolutionEvidence: [unit("I1", "T3", "OPERADOR", "Vou registrar a solicitação aqui.")] },
    ] })], patterns: [] }), projected, analyzedTranscriptCount: 1, recordedUniverseCount: 1 })
    expect(result.frames[0]!.customerNeeds.map((need) => `${need.id}:${need.resolutionStatus}:${need.statusDowngraded}`)).toEqual(["N1:UNKNOWN:true", "N2:PARTIAL:false"])
    expect(result.telemetry.drops.resolutionStatusDowngraded).toBe(1)
  })
})

describe("V1.4.0 §53/§38 POSITIVO é primeira classe — não vira RISK só porque a investigação é de performance", () => {
  it("comportamento positivo sustentado → finding STRENGTH; pattern declarado como RISK pelo modelo é corrigido para STRENGTH pela derivação (kind vem dos findings)", () => {
    const projected = project([["I1", POSITIVE], ["I2", POSITIVE]])
    const strengthFrame = (ref: string) => frame(ref, {
      agentActions: [{ id: "A1", kind: "CHECKED_UNDERSTANDING", summary: "confirma o pedido antes de seguir", evidence: [unit(ref, "T1", "OPERADOR", "confirme para mim: você quer a segunda via da fatura de março, correto?")] }, { id: "A2", kind: "SUMMARIZED", summary: "resume prazo e vencimento", evidence: [unit(ref, "T3", "OPERADOR", "Resumindo: a segunda via vai por e-mail em até 24 horas e o vencimento continua dia 10.")] }],
      findings: [{ id: "F1", kind: "STRENGTH", summary: "confirma o pedido e resume a solução", observationRefs: ["A1", "A2"] }],
    })
    const result = verifySemanticOutput({ parsed: parse({ frames: [strengthFrame("I1"), strengthFrame("I2")], patterns: [{ description: "confirma o pedido e resume a solução", kind: "RISK", findingRefs: ["I1/F1", "I2/F1"] }] }), projected, analyzedTranscriptCount: 2, recordedUniverseCount: 2 })
    expect(result.patterns[0]).toMatchObject({ kind: "STRENGTH", declaredKind: "RISK", interactionRefs: ["I1", "I2"] })
    expect(result.telemetry).toMatchObject({ strengthFindingsCount: 2, riskFindingsCount: 0, patternKindCorrected: 1, patternsByKind: { STRENGTH: 1, RISK: 0 } })
  })

  it("inverso: risco real (FRICTION/UNRESOLVED_NEED) declarado como STRENGTH pelo modelo vira RISK; STRENGTH + risco = MIXED", () => {
    expect(patternKindOf(["FRICTION"])).toBe("RISK")
    expect(patternKindOf(["UNRESOLVED_NEED", "CONTRADICTION"])).toBe("RISK")
    expect(patternKindOf(["STRENGTH", "FRICTION"])).toBe("MIXED")
    expect(patternKindOf(["PROCEDURAL_QUESTION"])).toBe("PROCEDURAL")
    expect(patternKindOf(["PROCEDURAL_QUESTION", "FRICTION"])).toBe("RISK")
    expect(patternKindOf(["CONTEXT", "OTHER"])).toBe("NEUTRAL")
    const projected = project([["I1", NEGATIVE]])
    const result = verifySemanticOutput({ parsed: parse({ frames: [frame("I1", { agentActions: [{ id: "A1", kind: "TRANSFERRED", summary: "transfere sem contexto", evidence: [unit("I1", "T2", "OPERADOR", "Vou transferir para o setor responsável.")] }], findings: [{ id: "F1", kind: "FRICTION", summary: "transferência sem repasse", observationRefs: ["A1"] }] })], patterns: [{ description: "transfere", kind: "STRENGTH", findingRefs: ["I1/F1"] }] }), projected, analyzedTranscriptCount: 1, recordedUniverseCount: 1 })
    expect(result.patterns[0]).toMatchObject({ kind: "RISK", declaredKind: "STRENGTH" })
  })
})

describe("V1.4.0 §54 NEGATIVO — problema real sustentado vira finding adequado com sinal do cliente ≠ culpa", () => {
  it("sinal DISSATISFACTION + ação TRANSFERRED + evento → finding FRICTION com 3 observações; a descrição não é causa", () => {
    const projected = project([["I1", NEGATIVE]])
    const result = verifySemanticOutput({ parsed: parse({ frames: [frame("I1", {
      customerSignals: [{ id: "S1", kind: "DISSATISFACTION", summary: "cliente diz que é a terceira ligação", evidence: [unit("I1", "T1", "CLIENTE", "Já é a terceira vez que eu ligo por causa disso.")] }, { id: "S2", kind: "DISSATISFACTION", summary: "reclama de falta de explicação", evidence: [unit("I1", "T3", "CLIENTE", "ninguém me explica nada")] }],
      agentActions: [{ id: "A1", kind: "TRANSFERRED", summary: "transfere para o setor responsável", evidence: [unit("I1", "T2", "OPERADOR", "Vou transferir para o setor responsável.")] }, { id: "A2", kind: "OTHER", summary: "transferência sem repasse de contexto (evento)", evidence: [unit("I1", "T4", "EVENTO", "[Transferência sem repasse de contexto.]")] }],
      findings: [{ id: "F1", kind: "FRICTION", summary: "cliente insatisfeito é transferido sem repasse de contexto", observationRefs: ["S1", "S2", "A1", "A2"] }],
    })], patterns: [] }), projected, analyzedTranscriptCount: 1, recordedUniverseCount: 6 })
    expect(result.frames[0]!.findings[0]).toMatchObject({ kind: "FRICTION", quality: { observationCount: 4, evidenceCount: 4 } })
    expect(result.frames[0]!.customerSignals.map((signal) => signal.signalKind)).toEqual(["DISSATISFACTION", "DISSATISFACTION"])
    expect(result.telemetry.riskFindingsCount).toBe(1)
  })
})

describe("V1.4.0 §55/§40 NEUTRO — interação sem materialidade: frame explicitamente vazio, nenhum finding forçado", () => {
  it("frame com listas vazias é válido (empty=true); interação omitida pelo modelo vira frame NOT_RETURNED vazio; ambos contam em interactionsWithoutMaterialFindings", () => {
    const projected = project([["I1", NEUTRAL], ["I2", NEUTRAL]])
    const result = verifySemanticOutput({ parsed: parse({ frames: [frame("I1")], patterns: [] }), projected, analyzedTranscriptCount: 2, recordedUniverseCount: 2 })
    expect(result.frames.map((item) => `${item.interactionRef}:${item.source}:${item.empty}`)).toEqual(["I1:MODEL:true", "I2:NOT_RETURNED:true"])
    expect(result.telemetry).toMatchObject({ semanticFramesCreated: 2, framesReturnedByModel: 1, framesNotReturned: 1, framesEmpty: 2, interactionsWithFindings: 0, interactionsWithoutMaterialFindings: 2, findingsCount: 0, crossInteractionPatternsCount: 0 })
  })

  it("observações neutras (CONTEXT) sobrevivem sem gerar risco nem força", () => {
    const projected = project([["I1", NEUTRAL]])
    const result = verifySemanticOutput({ parsed: parse({ frames: [frame("I1", { customerNeeds: [{ id: "N1", summary: "horário da loja", resolutionStatus: "RESOLVED", evidence: [unit("I1", "T2", "CLIENTE", "Quero saber o horário da loja.")], resolutionEvidence: [unit("I1", "T3", "OPERADOR", "Das nove às dezoito.")] }], findings: [{ id: "F1", kind: "CONTEXT", summary: "dúvida simples resolvida", observationRefs: ["N1"] }] })], patterns: [] }), projected, analyzedTranscriptCount: 1, recordedUniverseCount: 1 })
    expect(result.frames[0]!.customerNeeds[0]).toMatchObject({ resolutionStatus: "RESOLVED", statusDowngraded: false })
    expect(result.frames[0]!.customerNeeds[0]!.resolutionEvidence.map((item) => item.turnRef)).toEqual(["T3"])
    expect(result.telemetry).toMatchObject({ contextFindingsCount: 1, strengthFindingsCount: 0, riskFindingsCount: 0 })
  })
})

describe("V1.4.0 §56/§31–§35 PROCEDIMENTAL — a afirmação é registrada; a correção NÃO é decidida na análise", () => {
  const ASSERTION = "CLIENTE: Preciso mandar algum documento?\nOPERADOR: Não precisa mandar nada, a troca é automática.\nCLIENTE: Ah, ótimo."
  it("procedureAssertion com evidência literal, knowledgeStatus NOT_CHECKED; finding PROCEDURAL_QUESTION; pattern PROCEDURAL — nenhum campo 'incorreto/divergente' existe nesta camada", () => {
    const projected = project([["I1", ASSERTION]])
    const result = verifySemanticOutput({ parsed: parse({ frames: [frame("I1", {
      customerNeeds: [{ id: "N1", summary: "saber se precisa enviar documento", resolutionStatus: "RESOLVED", evidence: [unit("I1", "T1", "CLIENTE", "Preciso mandar algum documento?")], resolutionEvidence: [unit("I1", "T2", "OPERADOR", "Não precisa mandar nada")] }],
      procedureAssertions: [{ id: "P1", summary: "operador afirma que não é necessário enviar documento e que a troca é automática", evidence: [unit("I1", "T2", "OPERADOR", "Não precisa mandar nada, a troca é automática.")] }],
      findings: [{ id: "F1", kind: "PROCEDURAL_QUESTION", summary: "afirmação normativa sobre documento a verificar contra o procedimento", observationRefs: ["P1", "N1"] }],
    })], patterns: [{ description: "afirma que não é necessário documento", kind: "RISK", findingRefs: ["I1/F1"] }] }), projected, analyzedTranscriptCount: 1, recordedUniverseCount: 1 })
    expect(result.frames[0]!.procedureAssertions[0]).toMatchObject({ kind: "PROCEDURE_ASSERTION", knowledgeStatus: "NOT_CHECKED" })
    expect(result.frames[0]!.findings[0]).toMatchObject({ kind: "PROCEDURAL_QUESTION" })
    // Kind derivado: só PROCEDURAL_QUESTION → PROCEDURAL (o "RISK" declarado não vira erro confirmado).
    expect(result.patterns[0]).toMatchObject({ kind: "PROCEDURAL", declaredKind: "RISK" })
    expect(result.telemetry).toMatchObject({ procedureAssertionsCount: 1, proceduralQuestionsCount: 1, patternsByKind: { PROCEDURAL: 1 } })
    expect(JSON.stringify(result.frames[0])).not.toMatch(/incorret|diverg|CONFIRMED_ERROR/i)
  })
})

describe("V1.4.0 §57/§20 CONTROLE — observação local sobrevive; padrão forte não (sem saber quem é controle)", () => {
  const eight = Array.from({ length: 8 }, (_, index) => [`I${index + 1}`, OMISSION] as [string, string])
  const buckets = (ref: string) => (Number(ref.slice(1)) <= 3 ? "B1" : Number(ref.slice(1)) <= 6 ? "B2" : "B3")
  const findingFrame = (ref: string) => frame(ref, { agentActions: [{ id: "A1", kind: "REQUESTED", summary: "registra a solicitação", evidence: [unit(ref, "T3", "OPERADOR", "Vou registrar a solicitação aqui.")] }], findings: [{ id: "F1", kind: "FRICTION", summary: "registra sem responder", observationRefs: ["A1"] }] })

  it("2 findings em 8 analisadas (universo 30) → pattern REPEATED_IN_SAMPLE (evidenceStrength MODERATE): sobrevive como fato de amostra, não alcança EMPLOYEE_PATTERN_SUPPORTED", () => {
    const projected = project(eight)
    const result = verifySemanticOutput({ parsed: parse({ frames: [findingFrame("I2"), findingFrame("I7"), ...eight.slice(2, 6).map(([ref]) => frame(ref))], patterns: [{ description: "registra a solicitação sem responder", kind: "RISK", findingRefs: ["I2/F1", "I7/F1"] }] }), projected, analyzedTranscriptCount: 8, recordedUniverseCount: 30, bucketOf: buckets, bucketCount: 3 })
    expect(result.patterns[0]!.support).toMatchObject({ level: "REPEATED_IN_SAMPLE", matchedTranscriptCount: 2, analyzedTranscriptCount: 8, representativeness: "REPRESENTATIVE", bucketsMatched: 2, bucketCount: 3 })
    expect(result.patterns[0]!.evidenceStrength).toBe("MODERATE")
    expect(supportMeets(result.patterns[0]!.support.level, "EMPLOYEE_PATTERN_SUPPORTED")).toBe(false)
    expect(supportMeets(result.patterns[0]!.support.level, "RECURRENT_IN_SAMPLE")).toBe(false)
  })

  it("suporte consome a representatividade existente: 4 de 8 com universo 30 e 2 blocos → EMPLOYEE_PATTERN_SUPPORTED; 4 de 8 com universo 100 (13 %) → RECURRENT_IN_SAMPLE (amostra anedótica); 4 de 8 num só bloco de 3 → RECURRENT_IN_SAMPLE; 3 de 4 com universo 4 → RECURRENT_IN_SAMPLE (cobertura total, mas abaixo da amostra mínima de 5 da representatividade existente)", () => {
    expect(patternSupportOf({ matchedTranscriptCount: 4, analyzedTranscriptCount: 8, recordedUniverseCount: 30, bucketsMatched: 2, bucketCount: 3 })).toMatchObject({ level: "EMPLOYEE_PATTERN_SUPPORTED" })
    expect(patternSupportOf({ matchedTranscriptCount: 4, analyzedTranscriptCount: 8, recordedUniverseCount: 100, bucketsMatched: 3, bucketCount: 3 })).toMatchObject({ level: "RECURRENT_IN_SAMPLE", representativeness: "ANECDOTAL" })
    expect(patternSupportOf({ matchedTranscriptCount: 4, analyzedTranscriptCount: 8, recordedUniverseCount: 30, bucketsMatched: 1, bucketCount: 3 })).toMatchObject({ level: "RECURRENT_IN_SAMPLE", reason: expect.stringContaining("1 bloco de 3") })
    expect(patternSupportOf({ matchedTranscriptCount: 3, analyzedTranscriptCount: 4, recordedUniverseCount: 4, bucketsMatched: 1, bucketCount: 1 })).toMatchObject({ level: "RECURRENT_IN_SAMPLE", representativeness: "ANECDOTAL" })
    // V1.4.2 (§11/§24): 4 de 6 com cobertura TOTAL do universo registrado prova o período (RECORDED_UNIVERSE → claim até PERIOD_PATTERN), não um traço do colaborador.
    expect(patternSupportOf({ matchedTranscriptCount: 4, analyzedTranscriptCount: 6, recordedUniverseCount: 6, bucketsMatched: 1, bucketCount: 1 })).toMatchObject({ level: "RECURRENT_IN_SAMPLE", representativeness: "REPRESENTATIVE", scope: "RECORDED_UNIVERSE", maximumClaimScope: "PERIOD_PATTERN" })
    // §58 volume baixo com cobertura total: 3 de 6 é recorrente no período registrado (fato exaustivo), nunca padrão do colaborador.
    expect(patternSupportOf({ matchedTranscriptCount: 3, analyzedTranscriptCount: 6, recordedUniverseCount: 6, bucketsMatched: 2, bucketCount: 3 })).toMatchObject({ level: "RECURRENT_IN_SAMPLE", scope: "RECORDED_UNIVERSE", reason: expect.stringContaining("todas as 6 registradas") })
    // Sem cobertura total, abaixo de 4 interações distintas continua PERIOD (não há recorrência suficiente para inferir traço).
    expect(patternSupportOf({ matchedTranscriptCount: 3, analyzedTranscriptCount: 6, recordedUniverseCount: 20, bucketsMatched: 2, bucketCount: 3 })).toMatchObject({ level: "RECURRENT_IN_SAMPLE", scope: "PERIOD", reason: expect.stringContaining("abaixo de 4 interações distintas") })
    expect(patternSupportOf({ matchedTranscriptCount: 1, analyzedTranscriptCount: 8, recordedUniverseCount: 30, bucketsMatched: 1, bucketCount: 3 })).toMatchObject({ level: "OBSERVED" })
    expect(patternSupportOf({ matchedTranscriptCount: 3, analyzedTranscriptCount: 8, recordedUniverseCount: 30, bucketsMatched: 2, bucketCount: 3 })).toMatchObject({ level: "REPEATED_IN_SAMPLE" })
    expect(PATTERN_SUPPORT_LEVELS).toEqual(["OBSERVED", "REPEATED_IN_SAMPLE", "RECURRENT_IN_SAMPLE", "EMPLOYEE_PATTERN_SUPPORTED"])
    expect(bestPatternSupport([{ kind: "RISK", supportLevel: "OBSERVED", matchedTranscriptCount: 1, analyzedTranscriptCount: 8 }, { kind: "STRENGTH", supportLevel: "RECURRENT_IN_SAMPLE", matchedTranscriptCount: 4, analyzedTranscriptCount: 8 }])).toMatchObject({ supportLevel: "RECURRENT_IN_SAMPLE" })
    expect(bestPatternSupport([])).toBeNull()
  })
})

describe("V1.4.0 §58 LOW-VOLUME — 2 chamadas no mês: contenção por código, sem compensar com inferência forte", () => {
  it("2 de 2 analisadas com universo 2 (cobertura total) NÃO chega a recorrência (≥ 3): REPEATED_IN_SAMPLE; 1 de 2 → OBSERVED", () => {
    expect(patternSupportOf({ matchedTranscriptCount: 2, analyzedTranscriptCount: 2, recordedUniverseCount: 2, bucketsMatched: 1, bucketCount: 1 })).toMatchObject({ level: "REPEATED_IN_SAMPLE", representativeness: "ANECDOTAL" })
    expect(patternSupportOf({ matchedTranscriptCount: 1, analyzedTranscriptCount: 2, recordedUniverseCount: 2, bucketsMatched: 1, bucketCount: 1 })).toMatchObject({ level: "OBSERVED" })
  })
})

describe("V1.4.0 §59/§26–§29 REFERÊNCIA — só handles; I3 é I3; handle inexistente = WRONG_INTERACTION; sem ambiguidade ordinal", () => {
  it("Model Context lista só I4, I8, I6 (sem #1/#2/#3): output I6 válido; output I3 (inexistente) → WRONG_INTERACTION e o frame/observação cai; trecho de I8 citado em I4 → WRONG_INTERACTION (nunca 'corrigido' pela busca)", () => {
    const projected = project([["I4", OMISSION], ["I8", POSITIVE], ["I6", NEUTRAL]])
    const instructions = renderFrameExtractionInstructions([...projected.keys()])
    expect(instructions).toContain("As referências válidas nesta análise são SOMENTE: I4, I8, I6")
    expect(instructions).not.toContain("interactionOrdinal")
    expect(instructions).not.toMatch(/#\d/)
    const result = verifySemanticOutput({ parsed: parse({ frames: [
      frame("I6", { customerNeeds: [{ id: "N1", summary: "horário", resolutionStatus: "UNKNOWN", evidence: [unit("I6", "T2", "CLIENTE", "Quero saber o horário da loja.")] }], findings: [{ id: "F1", kind: "CONTEXT", summary: "dúvida simples", observationRefs: ["N1"] }] }),
      frame("I3", { customerNeeds: [{ id: "N1", summary: "posição 3 usada como handle", resolutionStatus: "UNKNOWN", evidence: [unit("I3", "T2", "CLIENTE", "Quero saber o horário da loja.")] }] }),
      frame("I4", { agentActions: [{ id: "A1", kind: "SUMMARIZED", summary: "resumo (trecho de I8 citado em I4)", evidence: [unit("I4", "T3", "OPERADOR", "Resumindo: a segunda via vai por e-mail em até 24 horas")] }], findings: [{ id: "F1", kind: "STRENGTH", summary: "resume", observationRefs: ["A1"] }] }),
    ], patterns: [{ description: "dúvida simples e resumo", findingRefs: ["I6/F1", "I3/F1", "I4/F1"] }] }), projected, analyzedTranscriptCount: 3, recordedUniverseCount: 3 })
    expect(result.frames.map((item) => `${item.interactionRef}:${item.findings.length}`)).toEqual(["I4:0", "I8:0", "I6:1"])
    expect(result.telemetry.drops).toMatchObject({ frameForUnknownInteraction: 1, observationWithoutEvidence: 1, findingWithoutObservation: 1 })
    expect(result.verification.rejectionReasons.WRONG_INTERACTION).toBe(1)
    expect(result.verification.ordinalResolvedCount).toBe(0)
    expect(result.patterns[0]!.findingRefs).toEqual(["I6/F1"])
  })
})

describe("V1.4.0 §43/§15 PROVENANCE — pattern → finding → observation → turno; nada flutua", () => {
  it("pattern com findingRefs inexistentes é descartado; finding sem observationRefs válidas é descartado mesmo com evidência própria; evidência do pattern é a união (sem duplicata) da evidência dos findings", () => {
    const projected = project([["I1", POSITIVE], ["I2", POSITIVE]])
    const result = verifySemanticOutput({ parsed: parse({ frames: [
      frame("I1", { agentActions: [{ id: "A1", kind: "SUMMARIZED", summary: "resume", evidence: [unit("I1", "T3", "OPERADOR", "Resumindo: a segunda via vai por e-mail")] }], findings: [{ id: "F1", kind: "STRENGTH", summary: "resume", observationRefs: ["A1"], evidence: [unit("I1", "T3", "OPERADOR", "Resumindo: a segunda via vai por e-mail")] }, { id: "F2", kind: "STRENGTH", summary: "flutuante (sem observação)", observationRefs: [], evidence: [unit("I1", "T1", "OPERADOR", "confirme para mim")] }] }),
      frame("I2", { agentActions: [{ id: "A1", kind: "SUMMARIZED", summary: "resume", evidence: [unit("I2", "T3", "OPERADOR", "Resumindo: a segunda via vai por e-mail")] }], findings: [{ id: "F1", kind: "STRENGTH", summary: "resume", observationRefs: ["A1"] }] }),
    ], patterns: [
      { description: "resume a solução", kind: "STRENGTH", findingRefs: ["I1/F1", "I2/F1", "I2/F9"] },
      { description: "flutuante", kind: "RISK", findingRefs: ["I1/F2", "I5/F1"] },
      { description: "contrato antigo (evidência direta, sem findingRefs)", evidence: [unit("I1", "T3", "OPERADOR", "Resumindo")] },
    ] }), projected, analyzedTranscriptCount: 2, recordedUniverseCount: 2 })
    expect(result.frames[0]!.findings.map((item) => item.id)).toEqual(["F1"])
    expect(result.telemetry.drops.findingWithoutObservation).toBe(1)
    expect(result.patterns).toHaveLength(1)
    expect(result.patterns[0]).toMatchObject({ findingRefs: ["I1/F1", "I2/F1"], interactionRefs: ["I1", "I2"] })
    expect(result.patterns[0]!.evidence).toHaveLength(2)
    expect(result.telemetry).toMatchObject({ patternsDropped: 2, crossInteractionPatternsCount: 1, drops: { patternWithoutFinding: 2 } })
  })

  it("finding sem observationRefs mas com evidência própria verificada no MESMO turno de uma observação sobrevivente é ligado por código (findingsLinkedByTurn); em turno sem observação continua descartado", () => {
    const projected = project([["I1", POSITIVE]])
    const result = verifySemanticOutput({ parsed: parse({ frames: [frame("I1", {
      agentActions: [{ id: "A1", kind: "SUMMARIZED", summary: "resume", evidence: [unit("I1", "T3", "OPERADOR", "Resumindo: a segunda via vai por e-mail")] }],
      findings: [{ id: "F1", kind: "STRENGTH", summary: "resume a solução (ref omitido)", observationRefs: [], evidence: [unit("I1", "T3", "OPERADOR", "o vencimento continua dia 10")] }, { id: "F2", kind: "STRENGTH", summary: "confirma (turno sem observação)", observationRefs: [], evidence: [unit("I1", "T1", "OPERADOR", "confirme para mim")] }],
    })], patterns: [] }), projected, analyzedTranscriptCount: 1, recordedUniverseCount: 1 })
    expect(result.frames[0]!.findings.map((item) => `${item.id}:${item.observationRefs.join(",")}`)).toEqual(["F1:A1"])
    expect(result.telemetry).toMatchObject({ findingsLinkedByTurn: 1, findingsDropped: 1, drops: { findingWithoutObservation: 1 } })
    // observationRef escrito como TURNO ("T3"): resolve para a observação com evidência nesse turno; turno sem observação ("T1") não vira nada.
    const byTurn = verifySemanticOutput({ parsed: parse({ frames: [frame("I1", {
      agentActions: [{ id: "A1", kind: "SUMMARIZED", summary: "resume", evidence: [unit("I1", "T3", "OPERADOR", "Resumindo: a segunda via vai por e-mail")] }],
      findings: [{ id: "F1", kind: "STRENGTH", summary: "resume a solução", observationRefs: ["T3"] }, { id: "F2", kind: "STRENGTH", summary: "confirma", observationRefs: ["T1"] }],
    })], patterns: [] }), projected, analyzedTranscriptCount: 1, recordedUniverseCount: 1 })
    expect(byTurn.frames[0]!.findings.map((item) => `${item.id}:${item.observationRefs.join(",")}`)).toEqual(["F1:A1"])
    expect(byTurn.telemetry).toMatchObject({ findingRefsResolvedByTurn: 1, findingsDropped: 1 })
  })

  it("schema tolerante: item com kind desconhecido cai no fallback (OTHER/UNKNOWN) e sobrevive pela evidência; item malformado é ignorado sem derrubar o output", () => {
    const parsed = parse({ frames: [{ interactionRef: "I1", customerSignals: [{ id: "S1", kind: "ANGRY", summary: "irritado", evidence: [unit("I1", "T1", "CLIENTE", "Já é a terceira vez")] }, "lixo", { id: "S2" }], findings: [{ id: "F1", kind: "PROBLEM", summary: "cliente irritado", observationRefs: ["S1"] }] }], patterns: [{ description: "cliente irritado na amostra", kind: "BAD", findingRefs: ["I1/F1"] }] })
    expect(parsed.frames[0]!.customerSignals).toHaveLength(1)
    expect(parsed.frames[0]!.customerSignals[0]).toMatchObject({ kind: "OTHER" })
    expect(parsed.frames[0]!.findings[0]).toMatchObject({ kind: "OTHER" })
    expect(parsed.patterns[0]!.kind).toBeNull()
    const result = verifySemanticOutput({ parsed, projected: project([["I1", NEGATIVE]]), analyzedTranscriptCount: 1, recordedUniverseCount: 1 })
    expect(result.patterns[0]).toMatchObject({ kind: "NEUTRAL", declaredKind: null })
  })
})

describe("V1.4.1 — FINDING FORMATION: Fase B promove observações verificadas a findings, nunca inventa observação", () => {
  const OMISSION_FRAME = frame("I1", { customerNeeds: [{ id: "N1", summary: "saber se precisa enviar documento", resolutionStatus: "UNRESOLVED", evidence: [unit("I1", "T2", "CLIENTE", "Preciso mandar algum documento para a troca de titularidade?")] }], answers: [{ id: "R1", completeness: "UNRELATED", summary: "registra sem responder", evidence: [unit("I1", "T3", "OPERADOR", "Vou registrar a solicitação aqui.")] }] })
  const POSITIVE_FRAME = frame("I2", { agentActions: [{ id: "A1", kind: "CHECKED_UNDERSTANDING", summary: "confirma o pedido", evidence: [unit("I2", "T1", "OPERADOR", "confirme para mim: você quer a segunda via da fatura de março, correto?")] }, { id: "A2", kind: "SUMMARIZED", summary: "resume prazo e vencimento", evidence: [unit("I2", "T3", "OPERADOR", "Resumindo: a segunda via vai por e-mail em até 24 horas")] }] })
  const NEUTRAL_FRAME = frame("I3", { customerNeeds: [{ id: "N1", summary: "horário da loja", resolutionStatus: "RESOLVED", evidence: [unit("I3", "T2", "CLIENTE", "Quero saber o horário da loja.")], resolutionEvidence: [unit("I3", "T3", "OPERADOR", "Das nove às dezoito.")] }] })
  const projected = project([["I1", OMISSION], ["I2", POSITIVE], ["I3", NEUTRAL]])
  const phaseB = (raw: unknown) => patternSynthesisOutputSchema.parse(raw).findings

  it("§47 omissão: CustomerNeed UNRESOLVED existe, Fase A não criou finding → Fase B promove UNRESOLVED_NEED (source PHASE_B, obs N1+R1); §46 positivo: observações sustentam STRENGTH → promovida", () => {
    const verified = verifySemanticFrames(parse({ frames: [OMISSION_FRAME, POSITIVE_FRAME, NEUTRAL_FRAME], patterns: [] }).frames, projected)
    expect(verified.telemetry).toMatchObject({ phaseAFindings: 0, findingsCount: 0, interactionsWithFindings: 0 })
    const promoted = promoteFindings(phaseB({ findings: [
      { interactionRef: "I1", id: "F4", kind: "UNRESOLVED_NEED", summary: "a pergunta sobre documento ficou sem resposta", observationRefs: ["N1", "R1"] },
      { interactionRef: "I2", kind: "STRENGTH", summary: "confirma o pedido e resume a solução", observationRefs: ["A1", "A2"] },
    ], patterns: [] }), verified)
    expect(promoted.map((item) => `${item.interactionRef}/${item.id}:${item.kind}:${item.source}:${item.attribution}`)).toEqual(["I1/F4:UNRESOLVED_NEED:PHASE_B:OPERATOR", "I2/F1:STRENGTH:PHASE_B:OPERATOR"])
    expect(promoted[0]!.evidence.map((unit) => unit.turnRef)).toEqual(["T2", "T3"])
    expect(verified.telemetry).toMatchObject({ phaseAFindings: 0, phaseBPromotedFindings: 2, promotedFromObservationCount: 4, promotionRejectedCount: 0, findingsCount: 2, strengthFindingsCount: 1, riskFindingsCount: 1, interactionsWithFindings: 2, interactionsWithoutMaterialFindings: 1 })
    expect(verified.findingIndex.has("I1/F4")).toBe(true)
  })

  it("§5/§41 Fase B NÃO inventa: observationRef inexistente, interação inexistente, sem refs e duplicata são recusados com motivo; frame vazio continua vazio (FRAME_MISS)", () => {
    const verified = verifySemanticFrames(parse({ frames: [OMISSION_FRAME, frame("I2"), NEUTRAL_FRAME], patterns: [] }).frames, projected)
    const promoted = promoteFindings(phaseB({ findings: [
      { interactionRef: "I1", kind: "FRICTION", summary: "observação que a Fase A não registrou", observationRefs: ["A9"] },
      { interactionRef: "I2", kind: "STRENGTH", summary: "frame vazio: nada para promover", observationRefs: ["A1"] },
      { interactionRef: "I7", kind: "STRENGTH", summary: "interação fora da amostra", observationRefs: ["N1"] },
      { interactionRef: "I1", kind: "CONTEXT", summary: "sem refs", observationRefs: [] },
      { interactionRef: "I1", kind: "UNRESOLVED_NEED", summary: "primeira", observationRefs: ["N1"] },
      { interactionRef: "I1", kind: "UNRESOLVED_NEED", summary: "duplicata (mesmo kind + mesmas refs)", observationRefs: ["N1"] },
    ], patterns: [] }), verified)
    expect(promoted).toHaveLength(1)
    expect(verified.frames[1]!.empty).toBe(true)
    expect(verified.telemetry.promotionRejectionReasons).toEqual({ UNKNOWN_INTERACTION: 1, NO_OBSERVATION_REFS: 1, UNKNOWN_OBSERVATION: 2, DUPLICATE_FINDING: 1 })
    expect(verified.telemetry.promotionRejectedCount).toBe(5)
  })

  it("§48 neutro: observações factuais sem materialidade — Fase B sem findings promovidos é válido; UNRESOLVED_NEED sobre necessidade RESOLVED é rebaixado a CONTEXT", () => {
    const verified = verifySemanticFrames(parse({ frames: [NEUTRAL_FRAME], patterns: [] }).frames, project([["I3", NEUTRAL]]))
    expect(promoteFindings(phaseB({ findings: [], patterns: [] }), verified)).toEqual([])
    expect(verified.telemetry.interactionsWithoutMaterialFindings).toBe(1)
    const promoted = promoteFindings(phaseB({ findings: [{ interactionRef: "I3", kind: "UNRESOLVED_NEED", summary: "não fica em aberto (RESOLVED)", observationRefs: ["N1"] }], patterns: [] }), verified)
    expect(promoted[0]).toMatchObject({ kind: "CONTEXT", declaredKind: "UNRESOLVED_NEED" })
    expect(verified.telemetry.findingKindDowngraded).toBe(1)
  })
})

describe("V1.4.1 — ATRIBUIÇÃO: sinal do cliente sozinho não é RISK do operador; evento é observação; ponte causal exige os dois lados", () => {
  const REPEAT = "CLIENTE: Preciso mandar algum documento?\nOPERADOR: Vou registrar a solicitação aqui.\nCLIENTE: Tá, e o documento? Preciso mandar?\nEVENTO: [Falas sobrepostas: o operador começa a falar antes de o cliente concluir.]\nOPERADOR: Não precisa mandar nada."
  it("§44 só cliente repete pergunta (CustomerSignal) → FRICTION declarada vira INTERACTION_FRICTION (attribution CUSTOMER); pattern desses findings é INTERACTION_FRICTION, nunca RISK", () => {
    const result = verifySemanticOutput({ parsed: parse({ frames: [frame("I1", { customerSignals: [{ id: "S1", kind: "REPEATED_QUESTION", summary: "cliente repete a pergunta", evidence: [unit("I1", "T3", "CLIENTE", "Tá, e o documento? Preciso mandar?")] }], findings: [{ id: "F1", kind: "FRICTION", summary: "cliente precisou repetir", observationRefs: ["S1"] }] })], patterns: [{ description: "cliente repete a pergunta", kind: "RISK", findingRefs: ["I1/F1"] }] }), projected: project([["I1", REPEAT]]), analyzedTranscriptCount: 1, recordedUniverseCount: 1 })
    expect(result.frames[0]!.findings[0]).toMatchObject({ kind: "INTERACTION_FRICTION", declaredKind: "FRICTION", attribution: "CUSTOMER" })
    expect(result.patterns[0]).toMatchObject({ kind: "INTERACTION_FRICTION", declaredKind: "RISK" })
    expect(result.telemetry).toMatchObject({ riskFindingsCount: 0, interactionFrictionFindingsCount: 1, findingKindDowngraded: 1, patternsByKind: { RISK: 0, INTERACTION_FRICTION: 1 } })
  })

  it("§45 ponte causal: cliente repete + resposta do operador com refs verificadas → FRICTION do operador (attribution BOTH); V1.4.5 §27/§44: evento '[Falas sobrepostas]' com atribuição BOTH/UNKNOWN permanece NEUTRO — nunca sustenta atrito atribuído ao operador", () => {
    const result = verifySemanticOutput({ parsed: parse({ frames: [frame("I1", {
      customerSignals: [{ id: "S1", kind: "REPEATED_QUESTION", summary: "cliente repete a pergunta", evidence: [unit("I1", "T3", "CLIENTE", "Tá, e o documento? Preciso mandar?")] }],
      answers: [{ id: "R1", completeness: "UNRELATED", summary: "registra sem responder", evidence: [unit("I1", "T2", "OPERADOR", "Vou registrar a solicitação aqui.")] }],
      interactionEvents: [{ id: "E1", kind: "OVERLAPPING_SPEECH", attribution: "AGENT", summary: "operador fala antes de o cliente concluir", evidence: [unit("I1", "T4", "EVENTO", "[Falas sobrepostas: o operador começa a falar antes de o cliente concluir.]")] }, { id: "E2", kind: "SILENCE", attribution: "UNKNOWN", summary: "silêncio", evidence: [unit("I1", "T4", "EVENTO", "[Falas sobrepostas")] }],
      findings: [{ id: "F1", kind: "FRICTION", summary: "cliente repete e o operador responde sem tratar a pergunta", observationRefs: ["S1", "R1"] }, { id: "F2", kind: "FRICTION", summary: "sobreposição atribuída ao operador", observationRefs: ["E1"] }, { id: "F3", kind: "FRICTION", summary: "evento sem atribuição", observationRefs: ["E2"] }],
    })], patterns: [] }), projected: project([["I1", REPEAT]]), analyzedTranscriptCount: 1, recordedUniverseCount: 1 })
    // A menção no trecho verificado vence a atribuição declarada: "o operador começa a falar antes de o cliente concluir" → BOTH (lado do operador presente).
    expect(result.frames[0]!.interactionEvents.map((event) => `${event.eventKind}:${event.attribution}`)).toEqual(["OVERLAPPING_SPEECH:BOTH", "SILENCE:UNKNOWN"])
    // V1.4.5 (§27/§44): só atribuição EXPLÍCITA ao operador (AGENT) conta como lado do operador; BOTH/UNKNOWN é atrito da interação.
    expect(result.frames[0]!.findings.map((finding) => `${finding.id}:${finding.kind}:${finding.attribution}`)).toEqual(["F1:FRICTION:BOTH", "F2:INTERACTION_FRICTION:INTERACTION", "F3:INTERACTION_FRICTION:INTERACTION"])
    expect(result.telemetry.interactionEventsCount).toBe(2)
    expect(applyAttributionRule("CONTRADICTION", [{ id: "S1", kind: "CUSTOMER_SIGNAL", summary: "", evidence: [] }])).toMatchObject({ kind: "INTERACTION_FRICTION", downgraded: true })
    expect(applyAttributionRule("STRENGTH", [{ id: "S1", kind: "CUSTOMER_SIGNAL", summary: "", evidence: [] }])).toMatchObject({ kind: "STRENGTH", downgraded: false })
  })
})

describe("V1.4.2 — SUPPORT LEVEL × SUPPORT SCOPE (§8–§13, §24, §25) e handles canônicos (§2)", () => {
  it("§24 cobertura total de poucas interações: nível recorrente, escopo RECORDED_UNIVERSE, teto PERIOD_PATTERN — nunca EMPLOYEE automático", () => {
    // 4 de 6 com as 6 registradas do período analisadas: prova o período registrado, não a pessoa.
    expect(patternSupportOf({ matchedTranscriptCount: 4, analyzedTranscriptCount: 6, recordedUniverseCount: 6, bucketsMatched: 2, bucketCount: 3 })).toMatchObject({ level: "RECURRENT_IN_SAMPLE", scope: "RECORDED_UNIVERSE", maximumClaimScope: "PERIOD_PATTERN" })
    // Amostra representativa parcial COM recorrência longitudinal é inferência válida (V1.4.3 §26): EMPLOYEE.
    expect(patternSupportOf({ matchedTranscriptCount: 4, analyzedTranscriptCount: 8, recordedUniverseCount: 20, bucketsMatched: 2, bucketCount: 3 })).toMatchObject({ level: "EMPLOYEE_PATTERN_SUPPORTED", scope: "EMPLOYEE_PATTERN", maximumClaimScope: "EMPLOYEE_PATTERN" })
    // A mesma amostra parcial representativa SEM recorrência longitudinal (3 de 8, abaixo de 4 distintas) → PERIOD.
    expect(patternSupportOf({ matchedTranscriptCount: 3, analyzedTranscriptCount: 6, recordedUniverseCount: 20, bucketsMatched: 2, bucketCount: 3 })).toMatchObject({ level: "RECURRENT_IN_SAMPLE", scope: "PERIOD", maximumClaimScope: "PERIOD_PATTERN" })
    // Sem recorrência / amostra não representativa → SAMPLE (só "nas interações analisadas").
    expect(patternSupportOf({ matchedTranscriptCount: 2, analyzedTranscriptCount: 8, recordedUniverseCount: 30, bucketsMatched: 2, bucketCount: 3 })).toMatchObject({ level: "REPEATED_IN_SAMPLE", scope: "SAMPLE", maximumClaimScope: "INTERACTION_SPECIFIC" })
    expect(patternSupportOf({ matchedTranscriptCount: 4, analyzedTranscriptCount: 8, recordedUniverseCount: 100, bucketsMatched: 3, bucketCount: 3 })).toMatchObject({ level: "RECURRENT_IN_SAMPLE", scope: "SAMPLE", maximumClaimScope: "INTERACTION_SPECIFIC" })
  })

  it("§25 EMPLOYEE continua possível quando realmente sustentado: recorrência, amostra representativa, ≥ 4 interações, ≥ 2 blocos e base de generalização suficiente", () => {
    expect(patternSupportOf({ matchedTranscriptCount: 5, analyzedTranscriptCount: 8, recordedUniverseCount: 30, bucketsMatched: 3, bucketCount: 3 })).toMatchObject({ level: "EMPLOYEE_PATTERN_SUPPORTED", scope: "EMPLOYEE_PATTERN", maximumClaimScope: "EMPLOYEE_PATTERN" })
    // Amostra absoluta (30 analisadas) também sustenta, mesmo com universo registrado desconhecido.
    expect(patternSupportOf({ matchedTranscriptCount: 20, analyzedTranscriptCount: 30, recordedUniverseCount: null, bucketsMatched: 2, bucketCount: 3 })).toMatchObject({ level: "EMPLOYEE_PATTERN_SUPPORTED", scope: "EMPLOYEE_PATTERN" })
    // Um só bloco (janela pontual) ou evidência num bloco só: recorrente no período, nunca traço do colaborador.
    expect(patternSupportOf({ matchedTranscriptCount: 5, analyzedTranscriptCount: 8, recordedUniverseCount: 30, bucketsMatched: 1, bucketCount: 3 })).toMatchObject({ level: "RECURRENT_IN_SAMPLE", scope: "PERIOD", maximumClaimScope: "PERIOD_PATTERN" })
    expect(patternSupportOf({ matchedTranscriptCount: 5, analyzedTranscriptCount: 8, recordedUniverseCount: 30, bucketsMatched: 1, bucketCount: 1 })).toMatchObject({ level: "RECURRENT_IN_SAMPLE", scope: "PERIOD" })
    // Nível e escopo são dimensões distintas: o mesmo 4 de 8 muda de escopo com o universo, sem mudar a recorrência.
    expect(supportMeets("RECURRENT_IN_SAMPLE", "RECURRENT_IN_SAMPLE")).toBe(true)
  })

  it("§2/§6 handles canônicos: cada finding recebe SF-n e cada pattern SP-n numa sequência única da execução; nada renumera", () => {
    const projected = project([["I1", POSITIVE], ["I2", POSITIVE]])
    const result = verifySemanticOutput({ parsed: parse({ frames: [
      frame("I1", { agentActions: [{ id: "A1", kind: "SUMMARIZED", summary: "resume", evidence: [unit("I1", "T3", "OPERADOR", "Resumindo: a segunda via vai por e-mail")] }], findings: [{ id: "F1", kind: "STRENGTH", summary: "resume", observationRefs: ["A1"] }] }),
      frame("I2", { agentActions: [{ id: "A1", kind: "SUMMARIZED", summary: "resume", evidence: [unit("I2", "T3", "OPERADOR", "Resumindo: a segunda via vai por e-mail")] }], findings: [{ id: "F1", kind: "STRENGTH", summary: "resume", observationRefs: ["A1"] }] }),
    ], patterns: [{ description: "resume a solução", kind: "STRENGTH", findingRefs: ["I1/F1", "I2/F1"] }] }), projected, analyzedTranscriptCount: 2, recordedUniverseCount: 2 })
    assignClaimHandles(result, claimHandleSequence())
    expect(result.frames.flatMap((item) => item.findings.map((finding) => finding.handle))).toEqual(["SF1", "SF2"])
    expect(result.patterns.map((item) => item.handle)).toEqual(["SP1"])
    // Uma segunda passada não renumera o que já tem handle.
    assignClaimHandles(result, claimHandleSequence())
    expect(result.patterns[0]!.handle).toBe("SP1")
  })
})

/**
 * V1.4.5/V1.4.6 — MATERIALIDADE ANTES DE ATRIBUIR: as guardas que NEUTRALIZAM risco foram preservadas na V1.4.6 (nunca
 * criam risco, só deixam de atribuí-lo). Fixtures GENÉRICAS, nenhum expectedPattern do H1.
 */
describe("V1.4.5 §22/§23/§27 — sinal, correção e evento: materialidade antes de atribuir", () => {
  const REPEAT_OK = "CLIENTE: Quando chega a segunda via?\nOPERADOR: Em até 48 horas no e-mail cadastrado.\nCLIENTE: Quando chega mesmo?\nOPERADOR: Em até 48 horas, no mesmo e-mail."
  it("§42 cliente repete a pergunta e a resposta ligada é COMPLETE → atrito da interação, nunca risco do operador", () => {
    const result = verifySemanticFrames(parse({ frames: [frame("I1", {
      questions: [{ id: "Q1", askedBy: "CLIENTE", summary: "prazo da segunda via", components: ["prazo"], evidence: [unit("I1", "T1", "CLIENTE", "Quando chega a segunda via?")] }],
      answers: [{ id: "R1", answersQuestionRef: "Q1", completeness: "COMPLETE", coveredComponents: [1], summary: "informa o prazo", evidence: [unit("I1", "T2", "OPERADOR", "Em até 48 horas no e-mail cadastrado.")] }],
      customerSignals: [{ id: "S1", kind: "REPEATED_QUESTION", summary: "cliente repete a pergunta", evidence: [unit("I1", "T3", "CLIENTE", "Quando chega mesmo?")] }],
      findings: [{ id: "F1", kind: "FRICTION", summary: "cliente precisou repetir a pergunta", observationRefs: ["S1", "R1"] }],
    })], patterns: [] }).frames, project([["I1", REPEAT_OK]]))
    expect(result.frames[0]!.findings[0]).toMatchObject({ kind: "INTERACTION_FRICTION", declaredKind: "FRICTION" })
    expect(result.telemetry.frictionDowngradedByCompleteAnswer).toBe(1)
  })

  it("§43 correção EXPLÍCITA do operador não é contradição; duas afirmações incompatíveis em turnos distintos continuam sendo", () => {
    const CORRECTED = "OPERADOR: O prazo é de 72 horas.\nOPERADOR: Na verdade, me desculpe: o prazo correto é de 48 horas.\nCLIENTE: Entendi."
    const corrected = verifySemanticFrames(parse({ frames: [frame("I1", {
      agentStatements: [{ id: "D1", summary: "informa 72 horas", evidence: [unit("I1", "T1", "OPERADOR", "O prazo é de 72 horas.")] }, { id: "D2", summary: "corrige para 48 horas", evidence: [unit("I1", "T2", "OPERADOR", "Na verdade, me desculpe: o prazo correto é de 48 horas.")] }],
      findings: [{ id: "F1", kind: "CONTRADICTION", summary: "dois prazos diferentes", observationRefs: ["D1", "D2"] }],
    })], patterns: [] }).frames, project([["I1", CORRECTED]]))
    expect(corrected.frames[0]!.findings[0]).toMatchObject({ kind: "CONTEXT", declaredKind: "CONTRADICTION" })
    expect(corrected.telemetry.contradictionDowngradedByCorrection).toBe(1)

    const CONFLICT = "OPERADOR: O prazo é de 72 horas.\nCLIENTE: Certo.\nOPERADOR: O prazo é de 24 horas, pode aguardar."
    const conflict = verifySemanticFrames(parse({ frames: [frame("I1", {
      agentStatements: [{ id: "D1", summary: "informa 72 horas", evidence: [unit("I1", "T1", "OPERADOR", "O prazo é de 72 horas.")] }, { id: "D2", summary: "informa 24 horas", evidence: [unit("I1", "T3", "OPERADOR", "O prazo é de 24 horas, pode aguardar.")] }],
      findings: [{ id: "F1", kind: "CONTRADICTION", summary: "dois prazos incompatíveis sem correção", observationRefs: ["D1", "D2"] }],
    })], patterns: [] }).frames, project([["I1", CONFLICT]]))
    expect(conflict.frames[0]!.findings[0]).toMatchObject({ kind: "CONTRADICTION", declaredKind: null })
  })
})

describe("V1.4.5 §17/§18/§41 — findings procedimentais criados pelo runtime a partir da comparação determinística", () => {
  const PROCEDURE = "CLIENTE: Preciso enviar algum documento?\nOPERADOR: Não precisa enviar documento nenhum.\nCLIENTE: E o prazo?\nOPERADOR: O reenvio sai em 48 horas."
  const framesOf = () => verifySemanticFrames(parse({ frames: [frame("I1", {
    procedureAssertions: [
      { id: "P1", summary: "afirma que não é necessário enviar documento", subject: "envio de documento", modality: "ASSERTED_ABSENCE_OF_REQUIREMENT", evidence: [unit("I1", "T2", "OPERADOR", "Não precisa enviar documento nenhum.")] },
      { id: "P2", summary: "informa prazo de reenvio de 48 horas", subject: "prazo de reenvio", modality: "ASSERTED_FACT", value: "48 horas", evidence: [unit("I1", "T4", "OPERADOR", "O reenvio sai em 48 horas.")] },
      { id: "P3", summary: "afirma que o cliente pode pedir pelo app", subject: "pedido pelo aplicativo", modality: "ASSERTED_PERMISSION", evidence: [unit("I1", "T2", "OPERADOR", "Não precisa enviar")] },
    ],
  })], patterns: [] }).frames, project([["I1", PROCEDURE]]))

  it("CONTRADICTED vira PROCEDURAL_DIVERGENCE; CONSISTENT vira STRENGTH (§18); indeterminado não gera finding (§14/§38)", () => {
    const verified = framesOf()
    const created = attachProceduralFindings([
      { interactionRef: "I1", assertionRef: "P1", assertionSummary: "afirma que não é necessário enviar documento", status: "CONTRADICTED", reason: "a base registra REQUIRED", rule: { ruleRef: "KR1", documentTitle: "Troca de Titularidade" } },
      { interactionRef: "I1", assertionRef: "P2", assertionSummary: "informa prazo de reenvio de 48 horas", status: "CONSISTENT", reason: "48 horas está dentro de até 48 horas", rule: { ruleRef: "KR2", documentTitle: "Segunda Via" } },
      { interactionRef: "I1", assertionRef: "P3", assertionSummary: "afirma que o cliente pode pedir pelo app", status: "INSUFFICIENT_KNOWLEDGE", reason: "sem regra", rule: null },
    ], verified)
    expect(created.map((finding) => `${finding.kind}:${finding.source}`)).toEqual(["PROCEDURAL_DIVERGENCE:PROCEDURAL", "STRENGTH:PROCEDURAL"])
    expect(created[0]!.procedural).toMatchObject({ assertionRef: "P1", status: "CONTRADICTED", ruleRef: "KR1", documentTitle: "Troca de Titularidade" })
    // Provenance completa: o finding cita a observação verificada e herda o trecho literal dela.
    expect(created[0]!.observationRefs).toEqual(["P1"])
    expect(created[0]!.evidence[0]).toMatchObject({ interactionRef: "I1", quote: "Não precisa enviar documento nenhum." })
    expect(verified.telemetry.proceduralFindings).toMatchObject({ divergence: 1, consistent: 1, question: 0 })
  })

  it("NOT_APPLICABLE e INSUFFICIENT_KNOWLEDGE não produzem nenhum finding — 0 falso positivo procedimental (§49)", () => {
    const verified = framesOf()
    const created = attachProceduralFindings([
      { interactionRef: "I1", assertionRef: "P1", assertionSummary: "x", status: "NOT_APPLICABLE", reason: "condição não sustentada", rule: { ruleRef: "KR1", documentTitle: "Outro cenário" } },
      { interactionRef: "I1", assertionRef: "P2", assertionSummary: "y", status: "INSUFFICIENT_KNOWLEDGE", reason: "sem regra", rule: null },
      { interactionRef: "I1", assertionRef: "DESCONHECIDA", assertionSummary: "z", status: "CONTRADICTED", reason: "…", rule: null },
    ], verified)
    expect(created).toHaveLength(0)
    expect(verified.frames[0]!.findings).toHaveLength(0)
  })

  it("POTENTIAL_DIVERGENCE vira PROCEDURAL_QUESTION e o pattern derivado é PROCEDURAL (nunca RISK genérico)", () => {
    const verified = framesOf()
    attachProceduralFindings([{ interactionRef: "I1", assertionRef: "P1", assertionSummary: "afirma requisito sobre ação opcional", status: "POTENTIAL_DIVERGENCE", reason: "a base registra OPTIONAL", rule: { ruleRef: "KR1", documentTitle: "Base" } }], verified)
    expect(verified.frames[0]!.findings[0]!.kind).toBe("PROCEDURAL_QUESTION")
    const patterns = deriveCrossInteractionPatterns([{ description: "afirmações normativas a verificar", kind: null, findingRefs: ["I1/FP1"], evidence: [], evidenceRequirement: undefined }], verified, { analyzedTranscriptCount: 1, recordedUniverseCount: 1 })
    expect(patterns[0]!.kind).toBe("PROCEDURAL")
  })
})


// =====================================================================================================================
// V1.4.6.1 — RAW × ACEITO (§3/§8): o que o runtime aceita é exatamente o que o modelo devolveu, e o mesmo output bruto
// produz sempre o mesmo resultado. A única perda silenciosa que a auditoria encontrou (frame duplicado) agora é MEDIDA.
// =====================================================================================================================
describe("V1.4.6.1 §3/§8 — determinismo da extração e contabilidade do descarte", () => {
  const output = () => parse({ frames: [
    frame("I1", { customerNeeds: [{ id: "N1", summary: "documento", resolutionStatus: "UNRESOLVED", evidence: [unit("I1", "T2", "CLIENTE", "Preciso mandar algum documento")] }] }),
    // Segundo frame da MESMA interação: o contrato é um frame por interação — o primeiro vence e este é descartado.
    frame("I1", { agentActions: [{ id: "A1", kind: "GUIDED", summary: "registra", evidence: [unit("I1", "T3", "OPERADOR", "Vou registrar a solicitação aqui.")] }], questions: [{ id: "Q9", summary: "e o documento?", evidence: [unit("I1", "T4", "CLIENTE", "Tá, e o documento?")] }] }),
    frame("I2", { agentActions: [{ id: "A1", kind: "SUMMARIZED", summary: "resume", evidence: [unit("I2", "T3", "OPERADOR", "Resumindo: a segunda via vai por e-mail")] }] }),
  ], patterns: [] })

  it("o mesmo output bruto, verificado duas vezes, aceita exatamente os mesmos frames e observações", () => {
    const projected = project([["I1", OMISSION], ["I2", POSITIVE]])
    const first = verifySemanticOutput({ parsed: output(), projected, analyzedTranscriptCount: 2, recordedUniverseCount: 2 })
    const second = verifySemanticOutput({ parsed: output(), projected, analyzedTranscriptCount: 2, recordedUniverseCount: 2 })
    expect(JSON.stringify(second.frames)).toBe(JSON.stringify(first.frames))
    expect(second.telemetry.observationsCount).toBe(first.telemetry.observationsCount)
    expect(first.telemetry).toMatchObject({ framesReturnedByModel: 2, observationsCount: 2, observationsDropped: 0 })
  })

  it("frame duplicado: o descarte não mudou (o primeiro vence), mas as observações que iam nele passam a ser CONTADAS", () => {
    const projected = project([["I1", OMISSION], ["I2", POSITIVE]])
    const result = verifySemanticOutput({ parsed: output(), projected, analyzedTranscriptCount: 2, recordedUniverseCount: 2 })
    expect(result.frames.find((item) => item.interactionRef === "I1")!.agentActions).toEqual([])
    expect(result.telemetry.drops.duplicateFrame).toBe(1)
    expect(result.telemetry.duplicateFrameObservationsDropped).toBe(2)
  })

  it("frame vazio devolvido pelo modelo continua vazio — o runtime nunca inventa observação para preencher", () => {
    const projected = project([["I1", OMISSION], ["I2", POSITIVE]])
    const result = verifySemanticOutput({ parsed: parse({ frames: [frame("I1"), frame("I2")], patterns: [] }), projected, analyzedTranscriptCount: 2, recordedUniverseCount: 2 })
    expect(result.telemetry).toMatchObject({ framesReturnedByModel: 2, framesEmpty: 2, observationsCount: 0, observationsDropped: 0 })
    expect(result.frames.every((item) => item.empty && item.source === "MODEL")).toBe(true)
  })
})
