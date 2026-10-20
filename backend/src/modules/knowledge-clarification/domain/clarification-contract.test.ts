import { describe, expect, it } from "vitest"
import { validateAnswerOutput, validatePlannerOutput, type PlannerValidationContext } from "./clarification-contract.js"
import { optionIdFor, type ClarificationStep, type KnowledgeSourceRef } from "./clarification-state.js"

/** Fontes fictícias, só para este teste. */
const ref = (documentId: string, chunkIndex: number, heading = `Seção ${chunkIndex}`): KnowledgeSourceRef => ({ documentId, documentTitle: `Base ${documentId}`, versionId: `${documentId}-v1`, heading, chunkIndex })
const baseOfZ = { ...ref("kb-z", 0), heading: "Base kb-z" }
const evidence = new Map<string, KnowledgeSourceRef>([
  ["B1", baseOfZ],
  ["K1", ref("kb-a", 0)],
  ["K2", ref("kb-a", 1)],
  ["K3", ref("kb-b", 0)],
  ["K4", ref("kb-c", 0)],
])
const readable = { bases: new Map([["B1", "kb-z"]]), sections: new Map([["K5", ref("kb-z", 3)]]) }
const context = (overrides: Partial<PlannerValidationContext> = {}): PlannerValidationContext => ({ evidence, answerable: new Set(["K1", "K2", "K3", "K4"]), readable, previousSteps: [], knownDimensions: [], pending: null, stepsRemaining: 4, allowNotApplicable: true, ...overrides })
const clarify = (options: { label: string; evidence: string[]; description?: string }[], extra: Record<string, unknown> = {}) => JSON.stringify({ decision: "CLARIFY", clarification: { dimension: "Dimensão X", question: "Qual cenário se aplica?", selectionMode: "SINGLE", options, ...extra } })
const step = (dimension: string, labels: string[]): ClarificationStep => ({ id: "step_1_aaaaaaaa", dimension, question: "?", selectionMode: "SINGLE", options: labels.map((label, index) => ({ id: optionIdFor(dimension, label), label, description: null, group: null, evidence: [ref("kb-a", index)] })), answer: null })

describe("contrato do planejador — validação por código", () => {
  it("opção sem evidência (ou com marcador inexistente) é REJEITADA; as demais seguem com as fontes traduzidas", () => {
    const result = validatePlannerOutput(clarify([{ label: "Cenário A", evidence: ["K1"] }, { label: "Cenário B", evidence: ["K3", "K99"] }, { label: "Cenário inventado", evidence: [] }, { label: "Outro inventado", evidence: ["K42"] }]), context())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.step!.options.map((option) => option.label)).toEqual(["Cenário A", "Cenário B"])
    expect(result.plan.step!.options[1]!.evidence).toEqual([ref("kb-b", 0)])
    expect(result.rejectedOptions.map((option) => option.label)).toEqual(["Cenário inventado", "Outro inventado"])
    expect(result.rejectedOptions[1]!.reason).toContain("K42")
  })

  it("menos de duas opções com evidência = etapa inválida (com as rejeitadas na mensagem de correção)", () => {
    const result = validatePlannerOutput(clarify([{ label: "Cenário A", evidence: ["K1"] }, { label: "Sem fonte", evidence: [] }]), context())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.code)).toContain("NOT_ENOUGH_OPTIONS")
    expect(result.issues[0]!.message).toContain("Sem fonte")
  })

  it("rótulos iguais depois de normalizar (acento, caixa, pontuação) viram UMA opção com as evidências somadas — documentos não são cenários", () => {
    const result = validatePlannerOutput(clarify([{ label: "Cenário Único", evidence: ["K1"] }, { label: "cenario unico!", evidence: ["K3"] }, { label: "Outro cenário", evidence: ["K4"] }]), context())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.step!.options).toHaveLength(2)
    expect(result.plan.step!.options[0]!.evidence.map((source) => source.documentId)).toEqual(["kb-a", "kb-b"])
    expect(result.plan.step!.options[0]!.id).toBe(optionIdFor("Dimensão X", "Cenário Único"))
  })

  it("ciclos: dimensão já respondida, dimensão informada na pergunta, opções repetidas e etapa além do limite são recusadas", () => {
    const options = [{ label: "Cenário A", evidence: ["K1"] }, { label: "Cenário B", evidence: ["K3"] }]
    const repeated = validatePlannerOutput(clarify(options), context({ previousSteps: [step("dimensão x", ["Outro 1", "Outro 2"])] }))
    expect(!repeated.ok && repeated.issues.map((issue) => issue.code)).toContain("REPEATED_DIMENSION")
    const known = validatePlannerOutput(clarify(options), context({ knownDimensions: ["Dimensão X"] }))
    expect(!known.ok && known.issues.map((issue) => issue.code)).toContain("REPEATED_DIMENSION")
    const sameOptions = validatePlannerOutput(clarify(options), context({ previousSteps: [step("Outra dimensão", ["Cenário A", "Cenário B"])] }))
    expect(!sameOptions.ok && sameOptions.issues.map((issue) => issue.code)).toContain("REPEATED_OPTIONS")
    const limit = validatePlannerOutput(clarify(options), context({ stepsRemaining: 0 }))
    expect(!limit.ok && limit.issues.map((issue) => issue.code)).toContain("STEP_LIMIT")
  })

  it("opções demais pedem uma pergunta mais ampla (nunca corte silencioso); rótulo longo pede descrição", () => {
    const many = Array.from({ length: 31 }, (_, index) => ({ label: `Cenário ${index}`, evidence: ["K1"] }))
    const tooMany = validatePlannerOutput(clarify(many), context())
    expect(!tooMany.ok && tooMany.issues.map((issue) => issue.code)).toContain("TOO_MANY_OPTIONS")
    const long = validatePlannerOutput(clarify([{ label: "x".repeat(81), evidence: ["K1"] }, { label: "A", evidence: ["K1"] }, { label: "B", evidence: ["K3"] }]), context())
    expect(!long.ok && long.issues.map((issue) => issue.code)).toContain("LABEL_TOO_LONG")
  })

  it("seleção múltipla é aceita quando a IA declara", () => {
    const result = validatePlannerOutput(clarify([{ label: "A", evidence: ["K1"] }, { label: "B", evidence: ["K3"] }], { selectionMode: "MULTIPLE" }), context())
    expect(result.ok && result.plan.step!.selectionMode).toBe("MULTIPLE")
  })

  it("ANSWER exige seções citadas válidas (deduplicadas); INSUFFICIENT exige o motivo", () => {
    const answer = validatePlannerOutput(JSON.stringify({ decision: "ANSWER", answerEvidence: ["K2", "k2", "K9"] }), context())
    expect(answer.ok && answer.plan.answerEvidence.map((item) => item.ref)).toEqual(["K2"])
    const empty = validatePlannerOutput(JSON.stringify({ decision: "ANSWER", answerEvidence: ["K9"] }), context())
    expect(!empty.ok && empty.issues.map((issue) => issue.code)).toContain("MISSING_EVIDENCE")
    const insufficient = validatePlannerOutput(JSON.stringify({ decision: "INSUFFICIENT", insufficient: { reason: "" } }), context())
    expect(!insufficient.ok && insufficient.issues.map((issue) => issue.code)).toContain("MISSING_FIELD")
  })

  it("a base inteira (B-n) sustenta uma opção, mas a resposta só cita SEÇÕES (K-n)", () => {
    const option = validatePlannerOutput(clarify([{ label: "Cenário da base", evidence: ["B1"] }, { label: "Outro", evidence: ["K3"] }]), context())
    expect(option.ok && option.plan.step!.options[0]!.evidence).toEqual([baseOfZ])
    const answer = validatePlannerOutput(JSON.stringify({ decision: "ANSWER", answerEvidence: ["B1"] }), context())
    expect(!answer.ok && answer.issues.map((issue) => issue.code)).toContain("MISSING_EVIDENCE")
  })

  it("READ: abre bases e lê seções ainda não consultadas; nada novo, ou sem consultas restantes, é recusado", () => {
    const read = validatePlannerOutput(JSON.stringify({ decision: "READ", read: ["b1", "K5", "K1", "K404"] }), context())
    expect(read.ok && read.plan.read).toEqual({ documentIds: ["kb-z"], sections: [ref("kb-z", 3)] })
    const empty = validatePlannerOutput(JSON.stringify({ decision: "READ", read: ["K1"] }), context())
    expect(!empty.ok && empty.issues.map((issue) => issue.code)).toContain("READ_EMPTY")
    const limit = validatePlannerOutput(JSON.stringify({ decision: "READ", read: ["B1"] }), context({ readable: null }))
    expect(!limit.ok && limit.issues.map((issue) => issue.code)).toContain("READ_LIMIT")
  })

  it("NOT_APPLICABLE não é aceito como resposta a uma escolha do formulário", () => {
    const result = validatePlannerOutput(JSON.stringify({ decision: "NOT_APPLICABLE" }), context({ allowNotApplicable: false }))
    expect(!result.ok && result.issues.map((issue) => issue.code)).toContain("NOT_APPLICABLE_FORBIDDEN")
  })

  it("mensagem digitada com etapa aberta: O-n viram ids da etapa; inválidos = informação de contexto; seleção única não aceita duas", () => {
    const pendingStep = step("Dimensão aberta", ["Opção 1", "Opção 2"])
    const optionRefs = new Map([["O1", pendingStep.options[0]!.id], ["O2", pendingStep.options[1]!.id]])
    const ok = validatePlannerOutput(JSON.stringify({ decision: "ANSWER", answerEvidence: ["K1"], pendingReply: { kind: "OPTIONS", optionRefs: ["o2"] } }), context({ pending: { step: pendingStep, optionRefs } }))
    expect(ok.ok && ok.plan.pendingReply).toEqual({ kind: "OPTIONS", optionIds: [pendingStep.options[1]!.id] })
    const invalid = validatePlannerOutput(JSON.stringify({ decision: "ANSWER", answerEvidence: ["K1"], pendingReply: { kind: "OPTIONS", optionRefs: ["O7"] } }), context({ pending: { step: pendingStep, optionRefs } }))
    expect(invalid.ok && invalid.plan.pendingReply).toEqual({ kind: "CONTEXT", optionIds: [] })
    const missing = validatePlannerOutput(JSON.stringify({ decision: "ANSWER", answerEvidence: ["K1"] }), context({ pending: { step: pendingStep, optionRefs } }))
    expect(missing.ok && missing.plan.pendingReply).toEqual({ kind: "CONTEXT", optionIds: [] })
    const two = validatePlannerOutput(JSON.stringify({ decision: "ANSWER", answerEvidence: ["K1"], pendingReply: { kind: "OPTIONS", optionRefs: ["O1", "O2"] } }), context({ pending: { step: pendingStep, optionRefs } }))
    expect(!two.ok && two.issues.map((issue) => issue.code)).toContain("PENDING_REPLY_INVALID")
  })

  it("JSON inválido ou fora do contrato nunca passa (com cerca de markdown tolerada)", () => {
    expect(validatePlannerOutput("não é json", context()).ok).toBe(false)
    expect(validatePlannerOutput(JSON.stringify({ decision: "TALVEZ" }), context()).ok).toBe(false)
    expect(validatePlannerOutput("```json\n{\"decision\":\"NOT_APPLICABLE\"}\n```", context()).ok).toBe(true)
  })
})

describe("contrato da resposta final — fontes citadas", () => {
  const sections = new Map([["K2", ref("kb-a", 1)], ["K3", ref("kb-b", 0)]])

  it("marcadores no texto viram [1], [2]… na ordem em que aparecem; a lista de fontes segue a numeração", () => {
    const result = validateAnswerOutput(JSON.stringify({ answer: "Primeiro passo [K3].\n- Item com duas fontes [K2, K3]", sources: ["K2", "K3"], limitations: null }), sections)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toBe("Primeiro passo [1].\n- Item com duas fontes [2][1]")
    expect(result.sources).toEqual([ref("kb-b", 0), ref("kb-a", 1)])
  })

  it("marcador fora das seções lidas invalida a resposta (nunca uma fonte inventada na tela)", () => {
    const result = validateAnswerOutput(JSON.stringify({ answer: "Algo [K7].", sources: ["K2"] }), sections)
    expect(result.ok).toBe(false)
  })

  it("resposta vazia ou sem nenhuma seção citada é inválida", () => {
    expect(validateAnswerOutput(JSON.stringify({ answer: "", sources: ["K2"] }), sections).ok).toBe(false)
    expect(validateAnswerOutput(JSON.stringify({ answer: "Sem fonte.", sources: [] }), sections).ok).toBe(false)
  })
})
