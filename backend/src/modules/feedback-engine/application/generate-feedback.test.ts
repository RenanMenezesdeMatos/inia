import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { createInMemoryFeedbackMemoryStore } from "../infrastructure/in-memory-feedback-memory-store.js"
import { generateFeedback, type GenerateFeedbackDeps, type GenerateFeedbackRequest } from "./generate-feedback.js"
import { analyzeCall, type AnalyzeCallDeps } from "./analyze-call.js"
import type { EngineModelPort } from "./ports.js"
import { fakeEngineModel as fakeModel } from "../testing/fake-engine-model.js"
import { CHECKLIST_ID, CHECKLIST_V1, DOC_ID, INTERACTION_ID, PROCEDURE_V1, TRANSCRIPT } from "../testing/fixtures.js"
import type { InteractionForAnalysis } from "../infrastructure/postgres-engine-loaders.js"
import type { FeedbackBestPractices } from "../../best-practices/domain/feedback-section.js"

const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATOR = "00000000-0000-4000-8000-0000000000aa"
const AGENT = "00000000-0000-4000-8000-00000000a001"

const interaction = (overrides: Partial<InteractionForAnalysis> = {}): InteractionForAnalysis => ({ id: INTERACTION_ID, organizationId: ORG, operatorId: OPERATOR, operatorName: "Ana", startedAt: new Date("2026-09-20T13:00:00Z"), endedAt: new Date("2026-09-20T13:06:00Z"), reason: "Segunda via", channel: "VOICE", subjectCanonical: null, flags: [{ name: "nota_ura", value: "2" }], transcript: { content: TRANSCRIPT, checksum: "abc" }, teamId: "t1", subteamId: null, supervisorId: "s1", timeZone: "America/Fortaleza", ...overrides })

function setup(model: EngineModelPort, overrides: Partial<InteractionForAnalysis> = {}) {
  const stores = createInMemoryFeedbackMemoryStore()
  const analyze: AnalyzeCallDeps = {
    memory: stores,
    model,
    loadInteraction: async (_org, id) => (id === INTERACTION_ID ? interaction(overrides) : null),
    loadAgent: async () => ({ id: AGENT, name: "Especialista de 2ª via", objective: "Avaliar segunda via", contextPrompt: null, updatedAt: new Date("2026-09-01T00:00:00Z"), businessDomainId: null }),
    loadDocuments: async () => [
      { documentId: DOC_ID, title: "Procedimento — Segunda via de conta", version: 1, content: PROCEDURE_V1, contentHash: "h1", perspective: "RULE_IN_FORCE_AT_CALL" },
      { documentId: CHECKLIST_ID, title: "Checklist de Encerramento de Chamada", version: 1, content: CHECKLIST_V1, contentHash: "h2", perspective: "RULE_IN_FORCE_AT_CALL" },
    ],
    loadPreviousVersion: async () => null,
    now: () => new Date("2026-09-30T12:00:00Z"),
  }
  const deps: GenerateFeedbackDeps = {
    memory: stores, messages: stores, model, analyze,
    investigate: { memory: stores, data: {} as never, analyze, strategy: async () => { throw new Error("não usado") }, now: analyze.now },
    loadDocumentTitles: async () => new Map([[DOC_ID, "Procedimento — Segunda via de conta"], [CHECKLIST_ID, "Checklist de Encerramento de Chamada"]]),
    loadAgentConfiguredAt: async () => null,
    now: analyze.now,
  }
  return { stores, deps, analyze }
}

const request = (overrides: Partial<GenerateFeedbackRequest> = {}): GenerateFeedbackRequest => ({ organizationId: ORG, enrollmentId: "enr-1", workflowId: "wf-1", workflowVersionId: "v-1", nodeId: "feedback", sourceNodeId: "agent", domain: "MONITORING", sourceNodeOutput: { kind: "monitoring", input: {} }, collaboratorId: OPERATOR, interactionId: INTERACTION_ID, indicatorMeasurementId: null, configuredAgentId: AGENT, selectionReason: "Sinal: nota_ura = 2", now: new Date("2026-09-30T12:00:00Z"), ...overrides })

describe("motor de feedback — geração ponta a ponta (modelo falso, memória em RAM)", () => {
  it("origem legada: o motor analisa agora, grava a memória (acertos, desvios, não aplicáveis, intenção ≠ execução) e publica uma mensagem específica", async () => {
    const { model, calls } = fakeModel()
    const { deps, stores } = setup(model)
    const result = await generateFeedback(deps, request())
    expect(result.kind).toBe("PUBLISHABLE")
    if (result.kind !== "PUBLISHABLE") return
    // Análise → REVISÃO independente (uma por chamada) → redação → verificação.
    expect(calls.map((call) => `${call.stage}:${call.tag}`)).toEqual(["CALL_ANALYSIS:analysis", "CALL_REVIEW:review", "COMPOSITION:draft", "VERIFICATION:draft"])
    const statuses = Object.fromEntries(stores.assessments[0]!.criteria.map((row) => [row.status, (stores.assessments[0]!.criteria.filter((entry) => entry.status === row.status).length)]))
    expect(statuses).toMatchObject({ MET: 3, NOT_MET: 1, NOT_OBSERVABLE: 3, NOT_APPLICABLE: 2 })
    // Só o que a mensagem COMUNICOU conta (o reconhecimento S2 que o redator não usou continua na memória, não marcado como entregue).
    expect(result.nodeOutput).toMatchObject({ kind: "FEEDBACK_ENGINE_MESSAGE", disposition: "READY", findings: { developments: 1, strengths: 1 } })
    const message = stores.messages.get(result.messageId)!
    expect(message.message!.view.developments.map((detail) => detail.title)).toContain("Confirmar data de nascimento")
    expect(message.message!.text).toContain("peça a data de nascimento antes de enviar")
    expect(message.findingKeys).toHaveLength(2)
    expect(message.brief!.strengths.length).toBeGreaterThan(1)
    // Título = assunto gravado com o atendimento; a data é metadado à parte (`FEEDBACK_HEADING_V1`).
    expect(message.message!.view.heading).toEqual({ title: "Segunda via", subtitle: "Atendimento de 20/09/2026", subjectSource: "RECORDED" })
  })
  it("título: assunto canônico gravado na análise vira o nome do catálogo; assunto que é só código sem catálogo vira título neutro — a data fica separada", async () => {
    const canonical = setup(fakeModel().model, { reason: "seg via", subjectCanonical: { code: "segunda_via", name: "Segunda via de conta" } })
    canonical.deps.investigate = { ...canonical.deps.investigate, data: { subjectNames: async () => new Map([["segunda_via", "Segunda via de conta"]]) } as never }
    const named = await generateFeedback(canonical.deps, request())
    expect(canonical.stores.messages.get(named.messageId)!.brief!.heading).toEqual({ title: "Segunda via de conta", subtitle: "Atendimento de 20/09/2026", subjectSource: "CANONICAL" })
    const coded = setup(fakeModel().model, { reason: "COD_2VIA_17" })
    const neutral = await generateFeedback(coded.deps, request())
    expect(coded.stores.messages.get(neutral.messageId)!.brief!.heading).toEqual({ title: "Feedback de atendimento", subtitle: "Atendimento de 20/09/2026", subjectSource: "NONE" })
  })
  it("retry do nó: a mesma mensagem, sem nova chamada de modelo (identidade da entrega)", async () => {
    const { model, calls } = fakeModel()
    const { deps } = setup(model)
    const first = await generateFeedback(deps, request())
    const again = await generateFeedback(deps, request())
    expect(again).toMatchObject({ kind: "PUBLISHABLE", messageId: first.messageId, reused: true })
    expect(calls).toHaveLength(4)
  })
  it("análise compatível é reutilizada por outra matrícula: nenhuma análise nova, nenhuma contagem dobrada", async () => {
    const { model, calls } = fakeModel()
    const { deps, stores } = setup(model)
    await generateFeedback(deps, request())
    await generateFeedback(deps, request({ enrollmentId: "enr-2" }))
    expect(calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(1)
    expect(stores.assessments).toHaveLength(1)
  })
  it("`ONE_MONITORING_PER_CALL_V1`: chamada já monitorada (entregue) não recebe outra monitoria de outra execução — abstenção ANTES de chamar o modelo", async () => {
    const { model, calls } = fakeModel()
    const { deps, stores } = setup(model)
    const first = await generateFeedback(deps, request())
    await stores.markDelivered(ORG, first.messageId, new Date())
    const before = calls.length
    const second = await generateFeedback(deps, request({ enrollmentId: "enr-3" }))
    expect(second).toMatchObject({ kind: "ABSTAINED", reason: "CALL_ALREADY_MONITORED" })
    expect(calls.length).toBe(before)
  })
  it("chamada bem conduzida: reconhecimento específico, sem inventar ajuste", async () => {
    const { model } = fakeModel({
      analysis: (handle) => ({
        scenario: { customerNeed: "Segunda via", procedure: "D1", pathSections: [], correctPath: "Confirmar o tipo e enviar.", pathTaken: "Confirmou o tipo.", pathAssessment: "CORRECT", pathRationale: "Seguiu o caminho da emissão.", pathEvidence: [{ turn: "T5", speaker: "OPERADOR", quote: "A segunda via é da fatura ou do parcelamento?" }] },
        criteria: [{ line: handle("Confirmar se a solicitação"), status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T5", speaker: "OPERADOR", quote: "A segunda via é da fatura ou do parcelamento?" }], rationale: "Confirmou o tipo antes de enviar.", materiality: "HIGH", whyItMatters: "A etapa de emissão pede isso antes de enviar." }],
      }),
      composition: { sentences: [{ text: "Você confirmou se era fatura ou parcelamento antes de enviar, como a etapa de emissão pede.", stance: "RECOGNITION", refs: ["S1"], paragraph: 1 }], card: { text: "Boa condução: confirmou o tipo de segunda via antes de enviar.", refs: ["S1"] } },
    })
    const { deps, stores } = setup(model)
    const result = await generateFeedback(deps, request())
    expect(result.kind).toBe("PUBLISHABLE")
    const brief = stores.messages.get(result.messageId)!.brief!
    expect(brief.tone).toBe("RECOGNITION")
    expect(brief.developments).toHaveLength(0)
  })
  it("redação que não entrega o ponto principal (ref inválida) nas duas tentativas: SEM mensagem — nenhum reconhecimento de template é colado no lugar", async () => {
    const { model, calls } = fakeModel({
      analysis: (handle) => ({ scenario: { customerNeed: "Segunda via", procedure: "D1", pathSections: [], correctPath: "", pathTaken: "", pathAssessment: "UNDETERMINED", pathRationale: "" }, criteria: [{ line: handle("Confirmar se a solicitação"), status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T5", speaker: "OPERADOR", quote: "A segunda via é da fatura ou do parcelamento?" }], rationale: "Confirmou o tipo.", materiality: "HIGH" }] }),
      composition: { sentences: [{ text: "Você confirmou se era fatura ou parcelamento antes de enviar.", stance: "RECOGNITION", refs: ["S9"], paragraph: 1 }], card: { text: "Confirmou o tipo de segunda via.", refs: ["S9"] } },
    })
    const { deps, stores } = setup(model)
    const result = await generateFeedback(deps, request())
    expect(result).toMatchObject({ kind: "ABSTAINED", reason: "NO_SAFE_MESSAGE:NO_USEFUL_MESSAGE" })
    expect(calls.filter((call) => call.stage === "COMPOSITION")).toHaveLength(2)
    expect(stores.messages.get(result.messageId)!.message).toBeNull()
  })
  it("sem procedimento aplicável: a memória registra a leitura insuficiente e a mensagem se abstém (nunca um feedback genérico)", async () => {
    const { model } = fakeModel({ analysis: () => ({ scenario: { customerNeed: "Assunto fora da base", procedure: null, pathSections: [], correctPath: "", pathTaken: "", pathAssessment: "UNDETERMINED", pathRationale: "" }, criteria: [] }) })
    const { deps, stores } = setup(model)
    const result = await generateFeedback(deps, request())
    expect(result).toMatchObject({ kind: "ABSTAINED", reason: expect.stringContaining("INSUFFICIENT_EVIDENCE") })
    expect(stores.assessments[0]!.analysis.outcome).toBe("INSUFFICIENT_EVIDENCE")
  })
  it("falha do redator não apaga a análise e não entrega texto nenhum: ABSTENÇÃO com motivo técnico (nunca a mensagem 'do próprio diagnóstico' em frases prontas)", async () => {
    const { model } = fakeModel({ failComposition: true })
    const { deps, stores } = setup(model)
    const result = await generateFeedback(deps, request())
    expect(result).toMatchObject({ kind: "ABSTAINED", reason: "NO_SAFE_MESSAGE:WRITER_OUTPUT_INVALID" })
    const message = stores.messages.get(result.messageId)!
    expect(message.message).toBeNull()
    expect(JSON.stringify(message.composition)).not.toMatch(/O procedimento orienta|Ponto principal|não aparece a etapa/)
    // A análise continua na memória (com a conclusão confirmada pela revisão).
    expect(stores.assessments).toHaveLength(1)
    expect(stores.assessments[0]!.criteria.some((row) => row.status === "NOT_MET")).toBe(true)
  })
  it("a interação precisa ser do colaborador da execução (identidade verificada antes de qualquer modelo)", async () => {
    const { model, calls } = fakeModel()
    const { analyze } = setup(model, { operatorId: "outra-pessoa" })
    await expect(analyzeCall(analyze, { organizationId: ORG, interactionId: INTERACTION_ID, collaboratorId: OPERATOR, agentId: AGENT, trigger: { kind: "EVALUATION", selectionReason: "x" } })).rejects.toThrow(/não pertence ao colaborador/)
    expect(calls).toHaveLength(0)
  })
  it("reanálise mais nova substitui a vigente; uma execução ANTIGA que termina depois nunca sobrescreve a mais nova", async () => {
    const { model } = fakeModel()
    const stores = createInMemoryFeedbackMemoryStore()
    const base = setup(model).analyze
    const older = { ...base, memory: stores, now: () => new Date("2026-09-30T10:00:00Z") }
    const newer = { ...base, memory: stores, now: () => new Date("2026-09-30T11:00:00Z"), loadAgent: async () => ({ id: AGENT, name: "x", objective: null, contextPrompt: "nova orientação", updatedAt: new Date("2026-09-30T09:00:00Z"), businessDomainId: null }) }
    await analyzeCall(newer, { organizationId: ORG, interactionId: INTERACTION_ID, collaboratorId: OPERATOR, agentId: AGENT, trigger: { kind: "EVALUATION", selectionReason: "nova" } })
    await analyzeCall(older, { organizationId: ORG, interactionId: INTERACTION_ID, collaboratorId: OPERATOR, agentId: AGENT, trigger: { kind: "EVALUATION", selectionReason: "antiga" } })
    const current = stores.assessments.filter((entry) => entry.isCurrent)
    expect(current).toHaveLength(1)
    expect(current[0]!.snapshot.selectionReason).toBe("nova")
    expect(stores.assessments.find((entry) => entry.snapshot.selectionReason === "antiga")!.isCurrent).toBe(false)
  })
})

describe("BASE_PRACTICES_IN_TEXT_V1 — a prática da base vai ao redator antes da redação", () => {
  const SECTION: FeedbackBestPractices = { version: "BEST_PRACTICE_FEEDBACK_V3", title: "Oportunidades inspiradas em boas práticas", note: "…", items: [{ patternId: "p-explica", name: "Checar compreensão oferecendo explicar de outra forma", indicatorName: "Nota da URA", context: "Segunda via", association: "Nas chamadas comparáveis de Segunda via analisadas (01/09/2026 a 31/10/2026), o comportamento apareceu em 72% das chamadas com resultado bom em Nota da URA em que a situação existiu (8 operadores, 32 chamadas) e em 22% das chamadas com resultado ruim (8 operadores, 32 chamadas).", strength: "Forte", you: "Suas chamadas não estavam nesta análise: não há evidência sobre como você faz isso hoje.", youKind: "NOT_ANALYZED", howTo: "Pergunte se ficou claro.", guidance: "Ao terminar de explicar, pergunte se ficou claro e ofereça explicar de outro jeito.", suggestedPhrasing: "Ficou claro? Se quiser, eu explico de outro jeito.", notApplicableWhen: null, source: { population: "GROUP", populationName: "B2C · Atendimento Geral", context: "SUB_REASON", subjectLabel: "Segunda via", outcomeName: "Nota da URA", outcomeKind: "CALL_SIGNAL", text: "Das chamadas de Segunda via com resultado bom em Nota da URA, no seu grupo (B2C · Atendimento Geral)." } }] }
  const DRAFT = [
    { text: "Você confirmou se a segunda via era da fatura ou do parcelamento antes de enviar.", stance: "RECOGNITION", refs: ["S1"], paragraph: 1 },
    { text: "Mas enviou os dados sem confirmar a data de nascimento, que o procedimento pede junto com o nome.", stance: "ADJUSTMENT", refs: ["A1"], paragraph: 2 },
    { text: "Na próxima vez, logo depois de confirmar o nome, peça a data de nascimento antes de enviar qualquer dado da conta.", stance: "GUIDANCE", refs: ["A1"], paragraph: 2 },
  ]
  const CARD = { text: "Confirme a data de nascimento antes de enviar a segunda via.", refs: ["A1"] }
  const PRACTICE_SENTENCE = { text: "Ao terminar de explicar a segunda via, vale experimentar perguntar se ficou claro. Por exemplo: [[B1]]", stance: "GUIDANCE", refs: ["B1"], paragraph: 3 }
  const writerTurns = (calls: { stage: string; contents: { text: string }[] }[]) => calls.filter((call) => call.stage === "COMPOSITION").map((call) => call.contents[0]!.text)

  it("o redator recebe B1 com as regras, cita a prática com a fala exata e o bloco marca a citada", async () => {
    const { model, calls } = fakeModel({ composition: { sentences: [...DRAFT, PRACTICE_SENTENCE], card: CARD } })
    const { deps, stores } = setup(model)
    const inputs: unknown[] = []
    const result = await generateFeedback({ ...deps, bestPractices: async (input) => (inputs.push(input), SECTION) }, request())
    expect(result.kind).toBe("PUBLISHABLE")
    if (result.kind !== "PUBLISHABLE") return
    expect(inputs).toEqual([expect.objectContaining({ domain: "MONITORING", interactionId: INTERACTION_ID, personId: OPERATOR })])
    const [turn] = writerTurns(calls)
    expect(turn).toContain("BOAS PRÁTICAS DA BASE")
    expect(turn).toContain('"ref": "B1"')
    const message = stores.messages.get(result.messageId)!
    expect(message.brief!.basePractices).toEqual([expect.objectContaining({ ref: "B1", patternId: "p-explica", you: null })])
    expect(message.message!.text).toContain("Por exemplo: “Ficou claro? Se quiser, eu explico de outro jeito.”")
    expect(message.message!.view.bestPractices!.items[0]!.citedInText).toBe(true)
    // A prática não é ponto do caso: nada além dos achados comunicados conta como entregue.
    expect(message.findingKeys).toHaveLength(2)
  })

  it("o redator não usa a prática: a reescrita pede; sem uso, publica do mesmo jeito e o bloco não a marca", async () => {
    const { model, calls } = fakeModel({ composition: { sentences: DRAFT, card: CARD } })
    const { deps, stores } = setup(model)
    const result = await generateFeedback({ ...deps, bestPractices: async () => SECTION }, request())
    expect(result.kind).toBe("PUBLISHABLE")
    if (result.kind !== "PUBLISHABLE") return
    const turns = writerTurns(calls)
    expect(turns).toHaveLength(2)
    expect(turns[1]).toContain("boa(s) prática(s) da base para este assunto (B1")
    expect(stores.messages.get(result.messageId)!.message!.view.bestPractices!.items[0]!.citedInText).toBeUndefined()
  })

  it("sem prática disponível (ou com falha na escolha), o redator recebe o mesmo turno de antes e não há reescrita por isso", async () => {
    for (const bestPractices of [async () => null, async () => { throw new Error("banco fora") }]) {
      const { model, calls } = fakeModel()
      const { deps, stores } = setup(model)
      const result = await generateFeedback({ ...deps, bestPractices }, request())
      expect(result.kind).toBe("PUBLISHABLE")
      if (result.kind !== "PUBLISHABLE") continue
      expect(writerTurns(calls)).toHaveLength(1)
      expect(writerTurns(calls)[0]).not.toContain("BOAS PRÁTICAS DA BASE")
      expect(stores.messages.get(result.messageId)!.brief!.basePractices).toBeUndefined()
    }
  })
})
