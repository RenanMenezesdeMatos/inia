import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { createInMemoryFeedbackMemoryStore } from "../infrastructure/in-memory-feedback-memory-store.js"
import { generateFeedback, type GenerateFeedbackDeps, type GenerateFeedbackRequest } from "./generate-feedback.js"
import type { AnalyzeCallDeps } from "./analyze-call.js"
import type { EngineModelPort } from "./ports.js"
import { confirmAllObligations, fakeEngineModel, type ObligationReviewPayload } from "../testing/fake-engine-model.js"
import { CHECKLIST_ID, CHECKLIST_V1, DOC_ID, INTERACTION_ID, PROCEDURE_V1, TRANSCRIPT } from "../testing/fixtures.js"
import { memoryRowsOf } from "../domain/memory-queries.js"
import { CALL_ANALYSIS_LOGIC_VERSION } from "../domain/versions.js"

/**
 * CONTRATO ORIENTADO AO CASO (`OBLIGATIONS_V1`) no CAMINHO COMPLETO — modelo falso, memória em RAM, zero IA: análise por obrigação →
 * revisão por obrigação → confirmação focal do que só a revisão encontrou → memória → brief → mensagem. Comprova CONTRATOS e
 * EXECUÇÃO, nunca a qualidade de um modelo real.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATOR = "00000000-0000-4000-8000-0000000000aa"
const AGENT = "00000000-0000-4000-8000-00000000a001"

function setup(model: EngineModelPort) {
  const stores = createInMemoryFeedbackMemoryStore()
  const analyze: AnalyzeCallDeps = {
    memory: stores,
    model,
    loadInteraction: async (_org, id) => (id === INTERACTION_ID ? { id: INTERACTION_ID, organizationId: ORG, operatorId: OPERATOR, operatorName: "Ana", startedAt: new Date("2026-09-20T13:00:00Z"), endedAt: new Date("2026-09-20T13:06:00Z"), reason: "Segunda via", channel: "VOICE", subjectCanonical: null, flags: [], transcript: { content: TRANSCRIPT, checksum: "abc" }, teamId: "t1", subteamId: null, supervisorId: "s1", timeZone: "America/Fortaleza" } : null),
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
  return { stores, deps }
}
const request = (): GenerateFeedbackRequest => ({ organizationId: ORG, enrollmentId: "enr-1", workflowId: "wf-1", workflowVersionId: "v-1", nodeId: "feedback", sourceNodeId: "agent", domain: "MONITORING", sourceNodeOutput: { kind: "monitoring", input: {} }, collaboratorId: OPERATOR, interactionId: INTERACTION_ID, indicatorMeasurementId: null, configuredAgentId: AGENT, selectionReason: "teste", now: new Date("2026-09-30T12:00:00Z") })

/** Análise no contrato OBLIGATIONS_V1: nome e tipo cumpridos; data de nascimento omitida; envio só declarado (fora da conversa). */
const obligations = (handle: (text: string) => string) => ({
  need: { summary: "O cliente precisa da segunda via da fatura.", conditions: [{ text: "Pediu a segunda via", evidence: [{ turn: "T2", speaker: "CLIENTE", quote: "Preciso da segunda via da conta." }] }] },
  sources: { primary: "D1", related: ["D2"], rationale: "Procedimento da segunda via." },
  argumentScripts: [],
  obligations: [
    { id: "OBL-1", sources: [handle("O operador deverá validar o titular"), handle("Confirmar nome completo")], action: "Confirmar o nome completo", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding: "MET", evidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Me confirma seu nome completo?", role: "CONDUCT" }], opportunityTurn: null, materiality: "HIGH", role: "CENTRAL", rationale: "Pediu o nome completo.", guidance: null },
    { id: "OBL-2", sources: [handle("Confirmar data de nascimento")], action: "Confirmar a data de nascimento", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding: "NOT_MET", evidence: [], opportunityTurn: "T5", materiality: "HIGH", role: "CENTRAL", rationale: "Seguiu sem pedir a data de nascimento.", guidance: { moment: "Logo depois de confirmar o nome", action: "Pedir a data de nascimento antes de seguir." } },
    { id: "OBL-3", sources: [handle("Confirmar se a solicitação")], action: "Confirmar se é fatura ou parcelamento", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding: "MET", evidence: [{ turn: "T5", speaker: "OPERADOR", quote: "A segunda via é da fatura ou do parcelamento?", role: "CONDUCT" }], opportunityTurn: null, materiality: "HIGH", role: "CENTRAL", rationale: "Confirmou o tipo.", guidance: null },
    { id: "OBL-4", sources: [handle("Enviar a segunda via")], action: "Enviar a segunda via pelo canal escolhido", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "OUTSIDE_CONVERSATION", finding: "MET", evidence: [{ turn: "T7", speaker: "OPERADOR", quote: "Vou enviar por e-mail agora mesmo.", role: "CONDUCT" }], opportunityTurn: null, materiality: "HIGH", role: "CENTRAL", rationale: "Enviou por e-mail.", guidance: null },
  ],
  notAssessed: [],
  conduct: { pathTaken: "Validou o nome, confirmou o tipo e disse que enviaria.", assessment: "PARTIALLY_CORRECT", rationale: "Faltou a data de nascimento." },
  sourceConflicts: [],
  limitations: [],
})
/** A revisora aponta uma obrigação material de fora: o protocolo não foi informado antes de encerrar. */
const reviewWithMissedProtocol = (handleOf: (text: string) => string) => (payload: ObligationReviewPayload) => ({ ...confirmAllObligations(payload), missed: [{ sources: [handleOf("Antes de encerrar qualquer chamada"), handleOf("informe o protocolo")], action: "Informar o protocolo antes de encerrar", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding: "NOT_MET", evidence: [], opportunityTurn: "T9", materiality: "HIGH", role: "SUPPORTING", rationale: "Nenhum protocolo foi informado antes de encerrar." }] })

function handleIn(model: { calls: { stage: string; contents: { text: string }[] }[] }) {
  return (text: string) => {
    const prompt = model.calls.find((call) => call.stage === "CALL_ANALYSIS")!.contents[0]!.text
    return new RegExp(`\\[(L\\d+)\\] [^\\n]*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).exec(prompt)?.[1] ?? "L0"
  }
}

describe("contrato OBLIGATIONS_V1 no caminho completo", () => {
  it("análise por obrigação → revisão → memória e mensagem: omissão confirmada vira ponto de desenvolvimento; envio só dito não vira acerto", async () => {
    const fake = fakeEngineModel({ analysis: obligations })
    const { deps, stores } = setup(fake.model)
    await generateFeedback(deps, request())
    expect(fake.calls.map((call) => call.stage)).toEqual(["CALL_ANALYSIS", "CALL_REVIEW", "COMPOSITION", "VERIFICATION"])
    // O pedido de análise usa o contrato novo (obrigações), com a MESMA mensagem do usuário (fontes + transcrição).
    expect(fake.calls[0]!.systemPrompt).toContain("UMA OBRIGAÇÃO É COMPLETA")
    const assessment = stores.assessments.find((entry) => entry.isCurrent)!
    const byTitle = (text: string) => assessment.analysis.criteria.find((criterion) => criterion.text.includes(text))!
    expect(byTitle("Confirmar data de nascimento")).toMatchObject({ status: "NOT_MET", confirmation: "CONFIRMED", contract: "OBLIGATIONS_V1" })
    expect(byTitle("Enviar a segunda via")).toMatchObject({ status: "NOT_OBSERVABLE", observability: "OUTSIDE_CONVERSATION", executionClaim: "DECLARED" })
    // Memória coerente com o diagnóstico: o que foi confirmado conta; o envio (fora da conversa) não é acerto.
    const rows = memoryRowsOf({ assessments: [{ callAssessmentId: assessment.id, interactionId: INTERACTION_ID, personId: OPERATOR, outcome: assessment.analysis.outcome, logicVersion: assessment.analysis.logicVersion, segmentKey: null, pathAssessment: assessment.analysis.scenario.pathAssessment, rulePerspective: null, localDate: "2026-09-20" }], criteria: assessment.analysis.criteria.map((criterion) => ({ callAssessmentId: assessment.id, interactionId: INTERACTION_ID, personId: OPERATOR, criterionKey: criterion.identityKey ?? criterion.lineKey, documentId: criterion.documentId, documentTitle: "Procedimento", heading: criterion.heading, text: criterion.text, status: criterion.status, localDate: "2026-09-20", evidence: [], rationale: null, guidance: null, materiality: criterion.materiality, segmentKey: null })) } as never, CALL_ANALYSIS_LOGIC_VERSION, null)
    expect(rows.filter((row) => row.status === "MET").map((row) => row.text)).not.toEqual(expect.arrayContaining([expect.stringContaining("Enviar a segunda via")]))
    const message = [...stores.messages.values()][0]!
    expect(message.brief!.developments.map((finding) => finding.title).join(" ")).toMatch(/data de nascimento/i)
    expect(message.brief!.strengths.map((finding) => finding.title).join(" ")).not.toMatch(/Enviar a segunda via/i)
  })

  it("obrigação material que SÓ a revisão apontou → confirmação focal (só ela) → confirmada entra no diagnóstico; sem confirmação, inconclusiva", async () => {
    const holder: { handle?: (text: string) => string } = {}
    const fake = fakeEngineModel({ analysis: (handle) => obligations(handle), obligationReview: (payload) => reviewWithMissedProtocol(holder.handle!)(payload) })
    holder.handle = handleIn(fake)
    const { deps, stores } = setup(fake.model)
    await generateFeedback(deps, request())
    const confirmation = fake.calls.filter((call) => call.stage === "CALL_CONFIRMATION")
    expect(confirmation).toHaveLength(1)
    const sent = JSON.parse(confirmation[0]!.contents[0]!.text.split("CONCLUSÕES A CONFERIR (JSON):")[1]!) as { claims: { id: string; sources: { text: string }[] }[] }
    expect(sent.claims.map((claim) => claim.id)).toEqual(["R1"])
    expect(confirmation[0]!.contents[0]!.text).not.toContain("PROCEDIMENTOS DISPONÍVEIS")
    const protocol = stores.assessments.find((entry) => entry.isCurrent)!.analysis.criteria.find((criterion) => criterion.lineHandle === "R1")!
    expect(protocol).toMatchObject({ origin: "REVIEW_REPAIR", status: "NOT_MET", confirmation: "CONFIRMED" })
    expect([...stores.messages.values()][0]!.brief!.developments.map((finding) => finding.title).join(" ")).toMatch(/protocolo/i)

    const failing = fakeEngineModel({ analysis: (handle) => obligations(handle), obligationReview: (payload) => reviewWithMissedProtocol(holder.handle!)(payload), failConfirmation: true })
    holder.handle = handleIn(failing)
    const second = setup(failing.model)
    await generateFeedback(second.deps, request())
    const analysis = second.stores.assessments.find((entry) => entry.isCurrent)!.analysis
    expect(analysis.criteria.find((criterion) => criterion.lineHandle === "R1")).toMatchObject({ status: "NOT_OBSERVABLE", confirmationReasons: ["CONFIRMATION_NOT_RUN"] })
    expect(analysis.checks.review.discoveries).toMatchObject({ found: 1, notRun: 1 })
  })

  it("revisão encontra o cumprimento dito de outro jeito → desvio refutado; dependência de execução fora da fala → nada confirmado", async () => {
    const fake = fakeEngineModel({
      analysis: obligations,
      obligationReview: (payload) => {
        const base = confirmAllObligations(payload)
        return { ...base, claims: base.claims.map((claim) => {
          const sent = payload.claims.find((entry) => entry.id === claim.id)!
          if (sent.proposedStatus === "NOT_MET") return { ...claim, verdict: "REFUTED", issues: ["ACTION_FOUND_IN_CALL"], counterEvidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Me confirma seu nome completo?" }] }
          if (sent.action?.includes("tipo") || sent.action?.includes("fatura")) return { ...claim, outsideDependency: true }
          return claim
        }) }
      },
    })
    const { deps, stores } = setup(fake.model)
    await generateFeedback(deps, request())
    const criteria = stores.assessments.find((entry) => entry.isCurrent)!.analysis.criteria
    expect(criteria.find((criterion) => criterion.text.includes("Confirmar data de nascimento"))).toMatchObject({ status: "NOT_OBSERVABLE", confirmation: "REFUTED" })
    expect(criteria.find((criterion) => criterion.text.includes("Confirmar se a solicitação"))).toMatchObject({ status: "NOT_OBSERVABLE", observability: "OUTSIDE_CONVERSATION", confirmationReasons: expect.arrayContaining(["EXECUTION_OUTSIDE_CONVERSATION"]) })
  })
})
