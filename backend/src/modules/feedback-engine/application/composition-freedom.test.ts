import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { createInMemoryFeedbackMemoryStore } from "../infrastructure/in-memory-feedback-memory-store.js"
import type { InteractionForAnalysis } from "../infrastructure/postgres-engine-loaders.js"
import { fakeEngineModel, type ReviewPayload } from "../testing/fake-engine-model.js"
import { CHECKLIST_ID, CHECKLIST_V1, DOC_ID, INTERACTION_ID, PROCEDURE_V1, TRANSCRIPT } from "../testing/fixtures.js"
import { CallReviewPendingError, type AnalyzeCallDeps } from "./analyze-call.js"
import { composeFeedback } from "./compose-feedback.js"
import { generateFeedback, type GenerateFeedbackDeps, type GenerateFeedbackRequest } from "./generate-feedback.js"
import type { EngineModelPort, ModelCallMetric } from "./ports.js"

/**
 * COMPOSIÇÃO SEM RELATÓRIO AUTOMÁTICO (`FEEDBACK_COMPOSITION_V3`) e o DEFEITO REPRODUZIDO de ponta a ponta — modelo FALSO.
 *   1) a transcrição tem "A segunda via é da fatura ou do parcelamento?";
 *   2) o analisador simulado diz que a confirmação do tipo de solicitação NÃO aconteceu (omissão);
 *   3) antes: o código mantinha; 4) com o redator indisponível, o sistema escrevia "Nesta chamada, não aparece a etapa…".
 * Agora: a proposta passa pela revisão; refutada/não confirmada não vira ponto; e o sistema nunca escreve a mensagem sozinho.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATOR = "00000000-0000-4000-8000-0000000000aa"
const AGENT = "00000000-0000-4000-8000-00000000a001"
const TEMPLATE = /Nesta chamada, não aparece a etapa|O procedimento orienta|Ponto principal|Destaque:/

function setup(model: EngineModelPort) {
  const stores = createInMemoryFeedbackMemoryStore()
  const interaction: InteractionForAnalysis = { id: INTERACTION_ID, organizationId: ORG, operatorId: OPERATOR, operatorName: "Ana", startedAt: new Date("2026-09-20T13:00:00Z"), endedAt: new Date("2026-09-20T13:06:00Z"), reason: "Segunda via", channel: "VOICE", subjectCanonical: null, flags: [], transcript: { content: TRANSCRIPT, checksum: "abc" }, teamId: "t1", subteamId: null, supervisorId: null, timeZone: "America/Fortaleza" }
  const analyze: AnalyzeCallDeps = {
    memory: stores,
    model,
    loadInteraction: async () => interaction,
    loadAgent: async () => ({ id: AGENT, name: "Especialista de 2ª via", objective: null, contextPrompt: null, updatedAt: new Date("2026-09-01T00:00:00Z"), businessDomainId: null }),
    loadDocuments: async () => [
      { documentId: DOC_ID, title: "Procedimento — Segunda via de conta", version: 1, content: PROCEDURE_V1, contentHash: "h1", perspective: "RULE_IN_FORCE_AT_CALL" as const },
      { documentId: CHECKLIST_ID, title: "Checklist de Encerramento de Chamada", version: 1, content: CHECKLIST_V1, contentHash: "h2", perspective: "RULE_IN_FORCE_AT_CALL" as const },
    ],
    loadPreviousVersion: async () => null,
    now: () => new Date("2026-09-30T12:00:00Z"),
  }
  const deps: GenerateFeedbackDeps = { memory: stores, messages: stores, model, analyze, investigate: {} as never, loadDocumentTitles: async () => new Map([[DOC_ID, "Procedimento — Segunda via de conta"]]), loadAgentConfiguredAt: async () => null, now: analyze.now }
  return { stores, deps }
}
const request = (overrides: Partial<GenerateFeedbackRequest> = {}): GenerateFeedbackRequest => ({ organizationId: ORG, enrollmentId: "enr-1", workflowId: "wf-1", workflowVersionId: "v-1", nodeId: "feedback", sourceNodeId: "agent", domain: "MONITORING", sourceNodeOutput: { kind: "monitoring" }, collaboratorId: OPERATOR, interactionId: INTERACTION_ID, indicatorMeasurementId: null, configuredAgentId: AGENT, selectionReason: "Sinal: nota_ura = 2", now: new Date("2026-09-30T12:00:00Z"), ...overrides })

/** Analisador simulado: só a omissão FALSA (a confirmação do tipo está em T5). */
const falseOmission = (handle: (text: string) => string) => ({
  scenario: { customerNeed: "Segunda via", procedure: "D1", pathSections: [], correctPath: "", pathTaken: "", pathAssessment: "UNDETERMINED", pathRationale: "" },
  criteria: [{ line: handle("Confirmar se a solicitação"), status: "NOT_MET", evidenceKind: "OMISSION", evidence: [], opportunityTurn: "T5", rationale: "Não confirmou se era fatura ou parcelamento.", materiality: "HIGH", guidance: { moment: "antes de enviar", action: "confirme se é fatura ou parcelamento", ruleLines: [handle("Confirmar se a solicitação")] } }],
})
const refuteWithT5 = (payload: ReviewPayload) => ({ claims: payload.claims.map((claim) => ({ id: claim.id, verdict: "REFUTED", issues: ["ACTION_FOUND_IN_CALL"], counterEvidence: [{ turn: "T5", speaker: "OPERADOR", quote: "A segunda via é da fatura ou do parcelamento?" }] })) })

describe("DEFEITO REPRODUZIDO de ponta a ponta: omissão simulada contradita pela transcrição + redator indisponível", () => {
  it("revisão REFUTA com a fala de T5: nenhum desvio, nenhuma mensagem de acusação; a memória guarda a hipótese refutada", async () => {
    const { model, calls } = fakeEngineModel({ analysis: falseOmission, review: refuteWithT5, failComposition: true })
    const { deps, stores } = setup(model)
    const result = await generateFeedback(deps, request())
    expect(result).toMatchObject({ kind: "ABSTAINED", reason: "INSUFFICIENT_EVIDENCE:NO_CONFIRMED_FINDING" })
    expect(calls.map((call) => call.stage)).toEqual(["CALL_ANALYSIS", "CALL_REVIEW"])
    const row = stores.assessments[0]!.analysis.criteria.find((criterion) => criterion.text.includes("Confirmar se a solicitação"))!
    expect(row).toMatchObject({ proposedStatus: "NOT_MET", status: "NOT_OBSERVABLE", confirmation: "REFUTED" })
    expect(stores.assessments[0]!.criteria.find((entry) => entry.lineKey === row.lineKey)!.status).toBe("NOT_OBSERVABLE")
  })
  it("revisão INDISPONÍVEL: nada é confirmado nem gravado como resultado — a análise fica SUSPENSA, a mensagem não é decidida (falha técnica, retomável)", async () => {
    const { model } = fakeEngineModel({ analysis: falseOmission, failReview: true, failComposition: true })
    const { deps, stores } = setup(model)
    await expect(generateFeedback(deps, request())).rejects.toBeInstanceOf(CallReviewPendingError)
    expect(stores.assessments).toHaveLength(0)
    const message = [...stores.messages.values()][0]!
    expect(message.status).toBe("FAILED")
    expect(JSON.stringify(message)).not.toMatch(TEMPLATE)
    expect([...stores.runs.values()][0]).toMatchObject({ status: "FAILED", result: { checkpoint: { stage: "REVIEW_PENDING", reason: "TECHNICAL" } } })
  })
  it("mesmo se a revisão ERRASSE e confirmasse, com o redator indisponível o sistema NÃO escreve 'a etapa não aparece': abstenção técnica", async () => {
    const { model } = fakeEngineModel({ analysis: falseOmission, failComposition: true })
    const { deps, stores } = setup(model)
    const result = await generateFeedback(deps, request())
    expect(result).toMatchObject({ kind: "ABSTAINED", reason: "NO_SAFE_MESSAGE:WRITER_OUTPUT_INVALID" })
    expect(JSON.stringify(stores.messages.get(result.messageId)!.message)).not.toMatch(TEMPLATE)
  })
})

describe("conjunto coerente, reparo limitado e afirmações proibidas", () => {
  const base = { sentences: [
    { text: "Você confirmou se a segunda via era da fatura ou do parcelamento antes de enviar.", stance: "RECOGNITION", refs: ["S1"], paragraph: 1 },
    { text: "Ao enviar sem a data de nascimento, você pulou a segunda confirmação do titular.", stance: "ADJUSTMENT", refs: ["A1"], paragraph: 2 },
    { text: "Isso vale só quando o cliente ainda não confirmou o cadastro por outro canal.", stance: "CONTEXT", refs: ["A1"], paragraph: 2 },
    { text: "Na próxima vez, logo depois do nome, peça a data de nascimento antes de enviar qualquer dado da conta.", stance: "GUIDANCE", refs: ["A1"], paragraph: 2 },
  ], card: { text: "Peça a data de nascimento antes de enviar a segunda via.", refs: ["A1"] } }
  it("frase removida deixa a seguinte sem referente ('Isso…'): a montagem não vale — abstenção, sem coerência presumida", async () => {
    const { model, calls } = fakeEngineModel({
      composition: base,
      verification: (claims) => ({ verdicts: claims.map((claim) => ({ id: claim.id, verdict: claim.id === "F2" ? "UNSUPPORTED_ADDITION" : "SUPPORTED", specific: true })) }),
    })
    const { deps, stores } = setup(model)
    const result = await generateFeedback(deps, request())
    expect(result).toMatchObject({ kind: "ABSTAINED", reason: "NO_SAFE_MESSAGE:INCOHERENT_AFTER_REMOVAL" })
    expect(calls.filter((call) => call.stage === "COMPOSITION")).toHaveLength(2)
    const audit = stores.messages.get(result.messageId)!.composition as { coherence: { danglingAfterRemoval: string[] } }
    expect(audit.coherence.danglingAfterRemoval).toEqual(["F3"])
  })
  it("frase removida sem pendência aparente: o CONJUNTO é conferido (1 chamada) — incoerente (condição perdida) = sem mensagem; coerente = publica só o que foi verificado", async () => {
    const drop = (claims: { id: string }[]) => ({ verdicts: claims.map((claim) => ({ id: claim.id, verdict: claim.id === "F4" ? "UNSUPPORTED_ADDITION" : "SUPPORTED", specific: true })) })
    const incoherent = fakeEngineModel({ composition: { ...base, sentences: base.sentences.filter((_, index) => index !== 2).concat([{ text: "O cadastro sem confirmação vale só por e-mail.", stance: "CONTEXT", refs: ["A1"], paragraph: 3 }]) }, verification: drop, coherence: { coherent: false, problems: [{ kind: "LOST_CONDITION", note: "a orientação perdeu a condição" }] } })
    const first = setup(incoherent.model)
    expect(await generateFeedback(first.deps, request())).toMatchObject({ kind: "ABSTAINED", reason: "NO_SAFE_MESSAGE:INCOHERENT_AFTER_REMOVAL" })
    expect(incoherent.calls.filter((call) => call.tag === "coherence")).toHaveLength(1)
    const coherent = fakeEngineModel({ composition: { ...base, sentences: base.sentences.filter((_, index) => index !== 2).concat([{ text: "O cadastro sem confirmação vale só por e-mail.", stance: "CONTEXT", refs: ["A1"], paragraph: 3 }]) }, verification: drop })
    const second = setup(coherent.model)
    const published = await generateFeedback(second.deps, request())
    expect(published.kind).toBe("PUBLISHABLE")
    const message = second.stores.messages.get(published.messageId)!.message!
    expect(message.sentences.every((sentence) => sentence.source === "WRITER")).toBe(true)
    expect(message.text).not.toContain("O cadastro sem confirmação")
    expect(message.text).not.toMatch(TEMPLATE)
  })
  it("afirmação PROIBIDA pela estratégia (texto configurado pela operação) nunca passa, mesmo 'sustentada' pelo verificador", async () => {
    const { brief } = await (async () => {
      const { model } = fakeEngineModel()
      const { deps, stores } = setup(model)
      const result = await generateFeedback(deps, request())
      return { brief: stores.messages.get(result.messageId)!.brief! }
    })()
    const constrained = { ...brief, prohibitedClaims: ["reduzirá a rechamada"] }
    const writer = fakeEngineModel({ composition: { sentences: [{ text: "Pedir a data de nascimento logo depois do nome reduzirá a rechamada.", stance: "GUIDANCE", refs: ["A1"], paragraph: 1 }], card: { text: "Peça a data de nascimento antes de enviar.", refs: ["A1"] } } })
    const metrics: ModelCallMetric[] = []
    const { message, audit } = await composeFeedback(writer.model, constrained, metrics)
    expect(message).toBeNull()
    expect(audit.decisions.find((decision) => decision.id === "F1")!.reasons).toContain("PROHIBITED_CLAIM")
    expect(JSON.stringify(writer.calls.find((call) => call.stage === "COMPOSITION")!.contents[0]!.text)).toContain("reduzirá a rechamada")
  })
})
