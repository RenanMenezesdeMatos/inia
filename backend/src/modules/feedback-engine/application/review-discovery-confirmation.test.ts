import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { createInMemoryFeedbackMemoryStore } from "../infrastructure/in-memory-feedback-memory-store.js"
import { generateFeedback, type GenerateFeedbackDeps, type GenerateFeedbackRequest } from "./generate-feedback.js"
import type { AnalyzeCallDeps } from "./analyze-call.js"
import type { EngineModelPort } from "./ports.js"
import { confirmAll, fakeEngineModel, type ReviewPayload } from "../testing/fake-engine-model.js"
import { CHECKLIST_ID, CHECKLIST_V1, DOC_ID, INTERACTION_ID, PROCEDURE_V1, TRANSCRIPT } from "../testing/fixtures.js"

/**
 * ACHADO DA REVISÃO NÃO É DESCARTADO POR TER VINDO DA REVISÃO (`REVIEW_DISCOVERY_CONFIRMATION_V1`) — sem IA.
 *
 * DEFEITO (rodada real V9, cenário B): a revisora avaliou "(2) informe o número do protocolo" como NÃO CUMPRIDO — correto: a
 * operadora disse "já passei o contexto no protocolo" e nenhum número foi dito —, mas o código descartava TODA disposição vinda só da
 * revisão (`SINGLE_PASS_REPAIR`, sempre "não confirmada"). O ponto material sumiu do diagnóstico, da memória e da mensagem.
 * Agora: íntegro e aplicável → confirmação FOCAL (outra leitura, só dele); confirmado vira fato; sem confirmação = inconclusivo com
 * motivo (nunca ausência de falha, nunca aceito só porque a revisora afirmou).
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

/** Análise que dá conta do procedimento e NÃO olha o checklist de encerramento (como a análise da V9 não olhou a transferência). */
const analysis = (handle: (text: string) => string) => ({
  scenario: { customerNeed: "Segunda via da fatura", conditions: [{ text: "Cliente pediu a segunda via", evidence: [{ turn: "T2", speaker: "CLIENTE", quote: "Preciso da segunda via da conta." }] }], procedure: "D1", pathSections: [], correctPath: "Validar, confirmar o tipo e enviar.", pathTaken: "Validou o nome, confirmou o tipo.", pathAssessment: "UNDETERMINED", pathRationale: "", pathEvidence: [] },
  criteria: [
    { line: handle("Confirmar nome completo"), status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Me confirma seu nome completo?" }], rationale: "Confirmou o nome.", materiality: "HIGH", applicability: "APPLIES", observability: "IN_CONVERSATION" },
    { line: handle("Confirmar se a solicitação"), status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T5", speaker: "OPERADOR", quote: "A segunda via é da fatura ou do parcelamento?" }], rationale: "Confirmou o tipo.", materiality: "HIGH", applicability: "APPLIES", observability: "IN_CONVERSATION" },
  ],
})
/** A revisora dá disposição às linhas sem resposta: o protocolo NÃO foi informado (omissão no fechamento). */
const reviewWith = (protocol: Record<string, unknown>, extra: Record<string, unknown>[] = []) => (payload: ReviewPayload) => {
  const base = confirmAll(payload)
  const lines = (payload as unknown as { linesToAssess?: { id: string; rule: { text: string } }[] }).linesToAssess ?? []
  const protocolLine = lines.find((line) => line.rule.text.includes("informe o protocolo"))!
  const recapLine = lines.find((line) => line.rule.text.includes("recapitule"))
  return { ...base, linesToAssess: [...lines.filter((line) => line.id !== protocolLine.id && line.id !== recapLine?.id).map((line) => ({ id: line.id, status: "NOT_OBSERVABLE", rationale: "—" })), { id: protocolLine.id, ...protocol }, ...(recapLine ? extra.map((entry) => ({ id: recapLine.id, ...entry })) : [])] }
}
const PROTOCOL_NOT_MET = { status: "NOT_MET", applicability: "APPLIES", observability: "IN_CONVERSATION", materiality: "HIGH", evidenceKind: "OMISSION", opportunityTurn: "T9", rationale: "Nenhum protocolo foi informado antes de encerrar." }

describe("desvio encontrado só pela revisão → confirmação focal", () => {
  it("íntegro e aplicável → UMA confirmação focal só dele; confirmado = fato na memória e ponto de desenvolvimento", async () => {
    const { model, calls } = fakeEngineModel({ analysis, review: reviewWith(PROTOCOL_NOT_MET) })
    const { deps, stores } = setup(model)
    await generateFeedback(deps, request())
    const confirmation = calls.filter((call) => call.stage === "CALL_CONFIRMATION")
    expect(confirmation).toHaveLength(1)
    // A confirmação recebe SÓ o achado pendente (regra completa, foco de omissão) — nunca a análise inteira de novo.
    const sent = JSON.parse(confirmation[0]!.contents[0]!.text.split("PROPOSTAS DA ANÁLISE A REVISAR (JSON):")[1]!) as { claims: { id: string; proposedStatus: string; attention: string[]; rule: { text: string } }[]; linesToAssess?: unknown }
    expect(sent.claims).toHaveLength(1)
    expect(sent.claims[0]).toMatchObject({ proposedStatus: "NOT_MET", attention: expect.arrayContaining(["OMISSION"]) })
    expect(sent.claims[0]!.rule.text).toContain("informe o protocolo")
    expect(sent.linesToAssess).toBeUndefined()
    const assessment = stores.assessments.find((entry) => entry.isCurrent)!
    const protocol = assessment.analysis.criteria.find((criterion) => criterion.text.includes("informe o protocolo"))!
    expect(protocol).toMatchObject({ origin: "REVIEW_REPAIR", status: "NOT_MET", confirmation: "CONFIRMED" })
    expect(assessment.analysis.checks.review.discoveries).toMatchObject({ found: 1, confirmed: 1, notRun: 0 })
    const message = [...stores.messages.values()][0]!
    expect(message.brief!.developments.map((finding) => finding.title).join(" ")).toMatch(/protocolo/i)
  })

  it("confirmação indisponível (falha/orçamento) → INCONCLUSIVO com motivo; a análise conclui (nunca suspensa, nunca 'sem falha')", async () => {
    const { model, calls } = fakeEngineModel({ analysis, review: reviewWith(PROTOCOL_NOT_MET), failConfirmation: true })
    const { deps, stores } = setup(model)
    await generateFeedback(deps, request())
    expect(calls.filter((call) => call.stage === "CALL_CONFIRMATION")).toHaveLength(1)
    const assessment = stores.assessments.find((entry) => entry.isCurrent)!
    const protocol = assessment.analysis.criteria.find((criterion) => criterion.text.includes("informe o protocolo"))!
    expect(protocol).toMatchObject({ status: "NOT_OBSERVABLE", confirmation: "UNCONFIRMED", confirmationReasons: ["CONFIRMATION_NOT_RUN"] })
    expect(assessment.analysis.checks.review.discoveries).toMatchObject({ found: 1, notRun: 1, confirmation: { attempted: true, available: false, reason: "TECHNICAL" } })
    expect(assessment.analysis.auditNotes?.join(" ")).toMatch(/1 sem confirmação \(inconclusivo\)/)
    expect([...stores.messages.values()][0]!.brief!.developments.map((finding) => finding.title).join(" ")).not.toMatch(/protocolo/i)
  })

  it("a confirmação encontra o cumprimento em outro trecho → REFUTADO pela prova (o achado da revisora não é aceito só por ela)", async () => {
    const { model } = fakeEngineModel({
      analysis,
      review: reviewWith(PROTOCOL_NOT_MET),
      confirmation: (payload) => ({ claims: payload.claims.map((claim) => ({ id: claim.id, verdict: "REFUTED", issues: ["ACTION_FOUND_IN_CALL"], evidenceReading: "ACTION_IN_CALL", outsideDependency: false, counterEvidence: [{ turn: "T7", speaker: "OPERADOR", quote: "Vou enviar por e-mail agora mesmo." }] })) }),
    })
    const { deps, stores } = setup(model)
    await generateFeedback(deps, request())
    const protocol = stores.assessments.find((entry) => entry.isCurrent)!.analysis.criteria.find((criterion) => criterion.text.includes("informe o protocolo"))!
    expect(protocol).toMatchObject({ status: "NOT_OBSERVABLE", confirmation: "REFUTED" })
  })

  it("acerto só da revisão não vira reconhecimento e não gasta confirmação; ação fora da conversa nunca vai à confirmação", async () => {
    const { model, calls } = fakeEngineModel({ analysis, review: reviewWith({ status: "NOT_MET", applicability: "APPLIES", observability: "OUTSIDE_CONVERSATION", evidenceKind: "NONE", rationale: "Registrar é no sistema." }, [{ status: "MET", applicability: "APPLIES", observability: "IN_CONVERSATION", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T9", speaker: "OPERADOR", quote: "Posso ajudar em mais alguma coisa?" }], rationale: "Recapitulou." }]) })
    const { deps, stores } = setup(model)
    await generateFeedback(deps, request())
    expect(calls.filter((call) => call.stage === "CALL_CONFIRMATION")).toHaveLength(0)
    const criteria = stores.assessments.find((entry) => entry.isCurrent)!.analysis.criteria
    expect(criteria.find((criterion) => criterion.text.includes("recapitule"))).toMatchObject({ origin: "REVIEW_REPAIR", status: "NOT_OBSERVABLE", confirmationReasons: ["REVIEW_DISCOVERY_NOT_PRIORITIZED"] })
    expect(criteria.find((criterion) => criterion.text.includes("informe o protocolo"))).toMatchObject({ status: "NOT_OBSERVABLE", observability: "OUTSIDE_CONVERSATION" })
  })
})
