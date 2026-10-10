import { describe, expect, it } from "vitest"
import { applyNeedAttributions, capClaimScopeByOwnership, emptyOutcomeAttributionTelemetry, findingOwnership, needOutcomesOf, outcomeSidecarOutputSchema, patternOwnership, resolveAgentBridge, validateNeedAttributions } from "./outcome-attribution.js"
import { deriveCrossInteractionPatterns, patternSupportOf, semanticAnalysisOutputSchema, verifySemanticFrames, type SemanticAnalysisOutput } from "./interaction-semantic-frame.js"
import { projectTranscript, type ProjectedInteraction } from "./transcript-projection.js"

/**
 * V1.4.6 — OUTCOME ATTRIBUTION: fixtures GENÉRICAS (nenhum expectedPattern do H1) para a regra central —
 * uma necessidade não resolvida é, primeiro, um RESULTADO; só com ponte verificável vira conduta do operador;
 * e só conduta do operador pode virar padrão do colaborador.
 */
const project = (entries: [ref: string, content: string][]): ReadonlyMap<string, ProjectedInteraction> => new Map(entries.map(([ref, content], index) => [ref, { interactionRef: ref, interactionId: `id-${index + 1}`, projection: projectTranscript(content) }]))
const unit = (ref: string, turn: string, speaker: string, quote: string) => ({ interactionRef: ref, turnRef: turn, speaker, quote })
const frame = (interactionRef: string, parts: Record<string, unknown[]> = {}) => ({ interactionRef, customerNeeds: [], questions: [], answers: [], agentActions: [], agentStatements: [], commitments: [], customerSignals: [], procedureAssertions: [], interactionEvents: [], findings: [], ...parts })
const parse = (raw: unknown): SemanticAnalysisOutput => semanticAnalysisOutputSchema.parse(raw)

const VISIT = "CLIENTE: A internet não volta de jeito nenhum.\nOPERADOR: Fiz o teste na linha e o sinal não chega até a sua casa; vou abrir uma visita técnica.\nOPERADOR: Agendei para quinta-feira, das 8h às 12h, e o protocolo é 4471.\nCLIENTE: Combinado."
const PARTIAL = "CLIENTE: Queria saber quando chega a segunda via e quanto vai custar.\nOPERADOR: A segunda via chega em até 48 horas.\nCLIENTE: E o custo?\nOPERADOR: Obrigado pelo contato."

const visitFrame = () => verifySemanticFrames(parse({ frames: [frame("I1", {
  customerNeeds: [{ id: "N1", summary: "ter o serviço de internet funcionando de novo", resolutionStatus: "UNRESOLVED", evidence: [unit("I1", "T1", "CLIENTE", "A internet não volta de jeito nenhum.")] }],
  agentActions: [{ id: "A1", kind: "CONSULTED", summary: "testa a linha e identifica que o sinal não chega", evidence: [unit("I1", "T2", "OPERADOR", "Fiz o teste na linha e o sinal não chega até a sua casa")] }, { id: "A2", kind: "COMMITTED", summary: "agenda visita técnica com data, janela e protocolo", evidence: [unit("I1", "T3", "OPERADOR", "Agendei para quinta-feira, das 8h às 12h, e o protocolo é 4471.")] }],
  findings: [{ id: "F1", kind: "UNRESOLVED_NEED", summary: "o serviço não voltou durante o atendimento", observationRefs: ["N1"] }, { id: "F2", kind: "STRENGTH", summary: "diagnostica e encaminha com data e protocolo", observationRefs: ["A1", "A2"] }],
})], patterns: [] }).frames, project([["I1", VISIT]]))

describe("V1.4.6 §4/§5/§28 — resultado ≠ atribuição", () => {
  it("§28 visita técnica: necessidade fica UNRESOLVED, atribuição é do PROCESSO → finding neutro, nunca risco; o encaminhamento continua sendo força", () => {
    const verified = visitFrame()
    const telemetry = emptyOutcomeAttributionTelemetry()
    const attributions = validateNeedAttributions([{ interactionRef: "I1", needRef: "N1", attribution: "EXTERNAL_DEPENDENCY", bridgeRefs: ["A2"] }], verified.frames, new Set())
    applyNeedAttributions(verified.frames, attributions, telemetry)
    expect(verified.frames[0]!.customerNeeds[0]!.resolutionStatus).toBe("UNRESOLVED")
    expect(verified.frames[0]!.findings.map((finding) => `${finding.kind}:${finding.ownership}`)).toEqual(["UNRESOLVED_OUTCOME:PROCESS", "STRENGTH:AGENT"])
    expect(telemetry).toMatchObject({ needsOpen: 1, findingsNeutralized: 1, findingsAgentAttributed: 0, byAttribution: { EXTERNAL_DEPENDENCY: 1 } })
  })

  it("§31 atribuição indeterminada mantém a necessidade aberta como RESULTADO neutro (ownership INTERACTION)", () => {
    const verified = visitFrame()
    const telemetry = emptyOutcomeAttributionTelemetry()
    applyNeedAttributions(verified.frames, [], telemetry)
    expect(verified.frames[0]!.findings[0]).toMatchObject({ kind: "UNRESOLVED_OUTCOME", declaredKind: "UNRESOLVED_NEED", ownership: "INTERACTION" })
    expect(needOutcomesOf(verified.frames)).toEqual([{ interactionRef: "I1", needRef: "N1", summary: "ter o serviço de internet funcionando de novo", status: "UNRESOLVED" }])
  })

  it("§7 dependência do CLIENTE (enviar documento depois) também não é falha do operador", () => {
    const verified = visitFrame()
    const telemetry = emptyOutcomeAttributionTelemetry()
    applyNeedAttributions(verified.frames, validateNeedAttributions([{ interactionRef: "I1", needRef: "N1", attribution: "CUSTOMER_DEPENDENCY", bridgeRefs: [] }], verified.frames, new Set()), telemetry)
    expect(verified.frames[0]!.findings[0]).toMatchObject({ kind: "UNRESOLVED_OUTCOME", ownership: "CUSTOMER" })
  })
})

describe("V1.4.6 §8/§9/§29 — a ponte é obrigatória para atribuir ao operador", () => {
  const partialFrame = () => verifySemanticFrames(parse({ frames: [frame("I1", {
    customerNeeds: [{ id: "N1", summary: "saber prazo e custo da segunda via", resolutionStatus: "PARTIAL", evidence: [unit("I1", "T1", "CLIENTE", "Queria saber quando chega a segunda via e quanto vai custar.")], resolutionEvidence: [unit("I1", "T2", "OPERADOR", "A segunda via chega em até 48 horas.")] }],
    questions: [{ id: "Q1", askedBy: "CLIENTE", summary: "prazo e custo", evidence: [unit("I1", "T1", "CLIENTE", "quando chega a segunda via e quanto vai custar")] }],
    answers: [{ id: "R1", answersQuestionRef: "Q1", completeness: "PARTIAL", summary: "informa só o prazo", evidence: [unit("I1", "T2", "OPERADOR", "A segunda via chega em até 48 horas.")] }],
    findings: [{ id: "F1", kind: "UNRESOLVED_NEED", summary: "o custo ficou sem resposta", observationRefs: ["N1", "R1"] }],
  })], patterns: [] }).frames, project([["I1", PARTIAL]]))

  it("§29 resposta PARCIAL do operador é ponte válida: a necessidade aberta continua sendo risco atribuído a ele", () => {
    const verified = partialFrame()
    const telemetry = emptyOutcomeAttributionTelemetry()
    const attributions = validateNeedAttributions([{ interactionRef: "I1", needRef: "N1", attribution: "AGENT_ACTION", bridgeRefs: ["R1"] }], verified.frames, new Set())
    expect(attributions[0]).toMatchObject({ attribution: "AGENT_ACTION", bridge: "PARTIAL_ANSWER", rejectionReason: null })
    applyNeedAttributions(verified.frames, attributions, telemetry)
    expect(verified.frames[0]!.findings[0]).toMatchObject({ kind: "UNRESOLVED_NEED", ownership: "AGENT" })
    expect(telemetry).toMatchObject({ findingsAgentAttributed: 1, findingsNeutralized: 0, bridges: { PARTIAL_ANSWER: 1 } })
  })

  it("§8 AGENT_ACTION sem ponte (ou citando observação que não sustenta) é RECUSADA e vira NOT_DETERMINED", () => {
    const verified = partialFrame()
    const telemetry = emptyOutcomeAttributionTelemetry()
    const attributions = validateNeedAttributions([{ interactionRef: "I1", needRef: "N1", attribution: "AGENT_ACTION", bridgeRefs: ["Q1", "DESCONHECIDO"] }], verified.frames, new Set())
    expect(attributions[0]).toMatchObject({ declared: "AGENT_ACTION", attribution: "NOT_DETERMINED", bridge: null })
    applyNeedAttributions(verified.frames, attributions, telemetry)
    expect(verified.frames[0]!.findings[0]!.kind).toBe("UNRESOLVED_OUTCOME")
  })

  it("§9 divergência procedimental aplicável é ponte; compromisso contraditado também; necessidade/interação inexistente é ignorada", () => {
    const verified = partialFrame()
    expect(resolveAgentBridge([], { frame: verified.frames[0]!, proceduralDivergence: true })).toBe("PROCEDURAL_DIVERGENCE")
    expect(resolveAgentBridge(["Q1"], { frame: verified.frames[0]!, proceduralDivergence: false })).toBeNull()
    expect(validateNeedAttributions([{ interactionRef: "I9", needRef: "N1", attribution: "AGENT_ACTION", bridgeRefs: ["R1"] }], verified.frames, new Set())).toEqual([])
    expect(validateNeedAttributions([{ interactionRef: "I1", needRef: "N99", attribution: "AGENT_ACTION", bridgeRefs: ["R1"] }], verified.frames, new Set())).toEqual([])
  })
})

describe("V1.4.6 §12/§13/§27/§32 — ownership decide quem pode virar padrão do colaborador", () => {
  const supportForFour = () => patternSupportOf({ matchedTranscriptCount: 4, analyzedTranscriptCount: 8, recordedUniverseCount: 30, bucketsMatched: 2, bucketCount: 3 })

  it("o suporte da V1.4.4 continua chegando a EMPLOYEE_PATTERN — o que muda é o teto por ownership", () => {
    expect(supportForFour().maximumClaimScope).toBe("EMPLOYEE_PATTERN")
    expect(capClaimScopeByOwnership("EMPLOYEE_PATTERN", "AGENT")).toBe("EMPLOYEE_PATTERN")
    for (const ownership of ["INTERACTION", "PROCESS", "CUSTOMER", "UNKNOWN"] as const) expect(capClaimScopeByOwnership("EMPLOYEE_PATTERN", ownership)).toBe("PERIOD_PATTERN")
    expect(capClaimScopeByOwnership("PERIOD_PATTERN", "AGENT")).toBe("PERIOD_PATTERN")
  })

  it("§27/§32 4 de 8 necessidades abertas SEM atribuição: pattern de RESULTADO, teto PERIOD — nunca padrão do colaborador", () => {
    const frames = ["I1", "I2", "I3", "I4"].map((ref) => frame(ref, {
      customerNeeds: [{ id: "N1", summary: "resolver a pendência", resolutionStatus: "UNRESOLVED", evidence: [unit(ref, "T1", "CLIENTE", "A internet não volta de jeito nenhum.")] }],
      findings: [{ id: "F1", kind: "UNRESOLVED_NEED", summary: "a necessidade ficou aberta", observationRefs: ["N1"] }],
    }))
    const verified = verifySemanticFrames(parse({ frames, patterns: [] }).frames, project(frames.map((item) => [item.interactionRef as string, VISIT] as [string, string])))
    applyNeedAttributions(verified.frames, [], emptyOutcomeAttributionTelemetry())
    const patterns = deriveCrossInteractionPatterns([{ description: "necessidades que ficaram em aberto", kind: null, findingRefs: ["I1/F1", "I2/F1", "I3/F1", "I4/F1"], evidence: [], evidenceRequirement: undefined }], verified, { analyzedTranscriptCount: 8, recordedUniverseCount: 30, bucketOf: (ref) => (ref === "I1" || ref === "I2" ? "B1" : "B3"), bucketCount: 3 })
    expect(patterns[0]).toMatchObject({ kind: "OUTCOME", ownership: "INTERACTION" })
    expect(patterns[0]!.support.level).toBe("EMPLOYEE_PATTERN_SUPPORTED")
    expect(patterns[0]!.support.maximumClaimScope).toBe("PERIOD_PATTERN")
    expect(verified.telemetry.patternsScopeCappedByOwnership).toBe(1)
  })

  it("§32 as MESMAS 4 de 8 com atribuição AGENT validada seguem as regras normais de suporte/escopo", () => {
    const frames = ["I1", "I2", "I3", "I4"].map((ref) => frame(ref, {
      customerNeeds: [{ id: "N1", summary: "resolver a pendência", resolutionStatus: "PARTIAL", evidence: [unit(ref, "T1", "CLIENTE", "Queria saber quando chega a segunda via e quanto vai custar.")], resolutionEvidence: [unit(ref, "T2", "OPERADOR", "A segunda via chega em até 48 horas.")] }],
      answers: [{ id: "R1", completeness: "PARTIAL", summary: "responde só parte", evidence: [unit(ref, "T2", "OPERADOR", "A segunda via chega em até 48 horas.")] }],
      findings: [{ id: "F1", kind: "UNRESOLVED_NEED", summary: "parte da pergunta ficou sem resposta", observationRefs: ["N1", "R1"] }],
    }))
    const verified = verifySemanticFrames(parse({ frames, patterns: [] }).frames, project(frames.map((item) => [item.interactionRef as string, PARTIAL] as [string, string])))
    applyNeedAttributions(verified.frames, validateNeedAttributions(frames.map((item) => ({ interactionRef: item.interactionRef as string, needRef: "N1", attribution: "AGENT_ACTION" as const, bridgeRefs: ["R1"] })), verified.frames, new Set()), emptyOutcomeAttributionTelemetry())
    const patterns = deriveCrossInteractionPatterns([{ description: "respostas parciais deixando parte da pergunta aberta", kind: null, findingRefs: ["I1/F1", "I2/F1", "I3/F1", "I4/F1"], evidence: [], evidenceRequirement: undefined }], verified, { analyzedTranscriptCount: 8, recordedUniverseCount: 30, bucketOf: (ref) => (ref === "I1" || ref === "I2" ? "B1" : "B3"), bucketCount: 3 })
    expect(patterns[0]).toMatchObject({ kind: "RISK", ownership: "AGENT" })
    expect(patterns[0]!.support.maximumClaimScope).toBe("EMPLOYEE_PATTERN")
  })

  it("§13 pattern MISTO (conduta + resultado sem dono) não é do colaborador", () => {
    expect(patternOwnership(["AGENT", "AGENT"])).toBe("AGENT")
    expect(patternOwnership(["AGENT", "INTERACTION"])).toBe("UNKNOWN")
    expect(patternOwnership(["AGENT", "UNKNOWN"])).toBe("AGENT")
    expect(patternOwnership([])).toBe("UNKNOWN")
    expect(findingOwnership({ kind: "UNRESOLVED_OUTCOME", attribution: "CUSTOMER" }, "EXTERNAL_DEPENDENCY")).toBe("PROCESS")
    expect(findingOwnership({ kind: "PROCEDURAL_DIVERGENCE", attribution: "OPERATOR" }, null)).toBe("AGENT")
  })
})

describe("V1.4.6 §16 — o sidecar é anotação: contrato tolerante, nunca cria nada", () => {
  it("item inválido cai fora e o resto sobrevive; valor desconhecido de atribuição vira NOT_DETERMINED", () => {
    const parsed = outcomeSidecarOutputSchema.parse({
      needs: [{ interactionRef: "I1", needRef: "N1", attribution: "CULPA_DO_OPERADOR", bridgeRefs: ["R1"] }, null, { interactionRef: "I2", needRef: "N1", attribution: "process_dependency", bridgeRefs: [] }],
      assertions: [{ interactionRef: "I1", assertionRef: "P1", subject: "prazo de reenvio", modality: "ASSERTED_FACT", condition: null, action: null, value: "até 48 horas" }],
    })
    expect(parsed.needs.map((item) => item.attribution)).toEqual(["NOT_DETERMINED", "PROCESS_DEPENDENCY"])
    expect(parsed.assertions).toHaveLength(1)
    expect(outcomeSidecarOutputSchema.parse({})).toEqual({ needs: [], assertions: [] })
  })
})
