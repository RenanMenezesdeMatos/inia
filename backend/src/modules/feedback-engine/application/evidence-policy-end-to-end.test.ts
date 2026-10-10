import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { createInMemoryFeedbackMemoryStore } from "../infrastructure/in-memory-feedback-memory-store.js"
import { generateFeedback, type GenerateFeedbackDeps, type GenerateFeedbackRequest } from "./generate-feedback.js"
import type { AnalyzeCallDeps } from "./analyze-call.js"
import type { EngineModelPort } from "./ports.js"
import { confirmAll, fakeEngineModel } from "../testing/fake-engine-model.js"
import { CHECKLIST_ID, CHECKLIST_V1, DOC_ID, fixtureContext, INTERACTION_ID, PROCEDURE_V1, TRANSCRIPT } from "../testing/fixtures.js"
import { memoryRowsOf } from "../domain/memory-queries.js"
import { criterionPatternsOf } from "../domain/indicator-investigation.js"
import { CALL_ANALYSIS_LOGIC_VERSION } from "../domain/versions.js"

/**
 * Defeito A (01/10) no CAMINHO COMPLETO — modelo falso, memória em RAM, zero IA: a análise lê "Enviar a segunda via" como execução
 * fora da conversa (não observável); a REVISÃO contesta o descarte mantendo a natureza "ação interna" e propõe CUMPRIDO, com fala e
 * convergência. Antes da correção: acerto confirmado, oferecido ao redator como reconhecimento e contado como cumprido na memória.
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

describe("defeito A no caminho completo: execução interna contestada pela revisão", () => {
  for (const proposed of ["MET", "PARTIAL"] as const) {
    it(`revisão propõe ${proposed} mantendo 'ação interna' → nada chega ao redator como acerto/desvio; memória conta como fora da conversa`, async () => {
      const { model, calls } = fakeEngineModel({
        analysis: (handle) => ({
          scenario: { customerNeed: "Segunda via da fatura", conditions: [{ text: "Cliente pediu a segunda via", evidence: [{ turn: "T2", speaker: "CLIENTE", quote: "Preciso da segunda via da conta." }] }], procedure: "D1", pathSections: [], correctPath: "Validar, confirmar o tipo e enviar.", pathTaken: "Validou o nome, confirmou o tipo.", pathAssessment: "UNDETERMINED", pathRationale: "", pathEvidence: [] },
          criteria: [
            { line: handle("Confirmar nome completo"), status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Me confirma seu nome completo?" }], rationale: "Confirmou o nome.", materiality: "HIGH", applicability: "APPLIES", observability: "IN_CONVERSATION" },
            { line: handle("Confirmar se a solicitação"), status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T5", speaker: "OPERADOR", quote: "A segunda via é da fatura ou do parcelamento?" }], rationale: "Confirmou o tipo.", materiality: "HIGH", applicability: "APPLIES", observability: "IN_CONVERSATION" },
            { line: handle("Enviar a segunda via"), status: "NOT_OBSERVABLE", evidenceKind: "NONE", evidence: [], rationale: "O envio acontece no sistema; a conversa não mostra.", materiality: "HIGH", itemNature: "INTERNAL_ACTION", applicability: "APPLIES", observability: "OUTSIDE_CONVERSATION" },
          ],
        }),
        review: (payload, req) => {
          const exclusions = (JSON.parse(req.contents[0]!.text.split("PROPOSTAS DA ANÁLISE A REVISAR (JSON):")[1]!) as { exclusions?: { id: string; rule: { text: string } }[] }).exclusions ?? []
          const send = exclusions.find((entry) => entry.rule.text.includes("Enviar a segunda via"))!
          return { ...confirmAll(payload), exclusions: [{ id: send.id, verdict: "CHALLENGED", proposedStatus: proposed, itemNature: "INTERNAL_ACTION", scenarioRole: "CENTRAL", issues: [], listReading: "CUMULATIVE", conditionEvidence: [{ turn: "T2", speaker: "CLIENTE", quote: "Preciso da segunda via da conta." }], evidence: [{ turn: "T7", speaker: "OPERADOR", quote: "Vou enviar por e-mail agora mesmo." }], note: "Disse que enviaria." }] }
        },
        composition: { sentences: [{ text: "Você confirmou se a segunda via era da fatura ou do parcelamento antes de seguir.", stance: "RECOGNITION", refs: ["S1"], paragraph: 1 }], card: null },
      })
      const { deps, stores } = setup(model)
      await generateFeedback(deps, request())
      expect(calls.map((call) => call.stage)).toContain("CALL_REVIEW")
      const assessment = stores.assessments.find((entry) => entry.isCurrent)!
      const send = assessment.analysis.criteria.find((criterion) => criterion.text.includes("Enviar a segunda via"))!
      expect(send).toMatchObject({ origin: "REVIEW_CHALLENGE", status: "NOT_OBSERVABLE", observability: "OUTSIDE_CONVERSATION" })
      expect(send.confirmation).not.toBe("CONFIRMED")
      expect(["DECLARED", "INTENDED", "NONE"]).toContain(send.executionClaim)
      // Conteúdo enviado ao REDATOR: a etapa não aparece como reconhecimento nem como ajuste.
      // (Ela só pode aparecer como CONTEXTO da lista de outro ponto, com o estado "não observável".)
      const composition = calls.find((call) => call.stage === "COMPOSITION")!
      const occurrences = [...composition.contents[0]!.text.matchAll(/"text": "[^"]*Enviar a segunda via[^"]*",\s*"status": "([^"]+)"/g)].map((match) => match[1])
      // V9: também chega como FATO de que a gravação não mostra a execução (nunca como acerto/ajuste).
      const notVerifiable = [...composition.contents[0]!.text.matchAll(/"action": "[^"]*Enviar a segunda via[^"]*",\s*"operatorSaidItWasDone": (true|false)/g)]
      expect(notVerifiable).toHaveLength(1)
      expect(composition.contents[0]!.text.split("Enviar a segunda via").length - 1).toBe(occurrences.length + notVerifiable.length)
      expect(occurrences.every((status) => status === "não observável na conversa")).toBe(true)
      const message = [...stores.messages.values()][0]
      if (message?.brief) {
        expect([...message.brief.strengths, ...message.brief.developments].map((finding) => finding.title)).not.toContain("Enviar a segunda via pelo canal escolhido pelo cliente")
        expect(message.brief.coverageLimits ?? []).toContainEqual(expect.objectContaining({ reason: "OUTSIDE_CONVERSATION" }))
      }
      // MEMÓRIA: a linha gravada não é cumprida/parcial; nas contagens, a etapa não entra como elegível.
      const row = assessment.criteria.find((entry) => entry.lineKey === send.lineKey)!
      expect(row.status).toBe("NOT_OBSERVABLE")
      const snapshot = await stores.currentMemory(ORG, { personIds: [OPERATOR] })
      const pattern = criterionPatternsOf(memoryRowsOf(snapshot, CALL_ANALYSIS_LOGIC_VERSION, null)).find((entry) => entry.text?.includes("Enviar a segunda via"))
      expect(pattern).toMatchObject({ met: 0, notMet: 0, partial: 0 })
    })
  }
})

/**
 * `OBLIGATION_READING_V1` (rodada real V8) no CAMINHO COMPLETO — modelo falso, memória em RAM, zero IA: a análise propõe "cumprido"
 * para o envio com a fala de INTENÇÃO lida como conduta na conversa, e o caminho como "correto"; a revisora (contrato V7) lê a prova
 * como declaração sobre algo feito fora da fala. Antes: acerto confirmado, "Condução do caso" oferecida ao redator e contagem de
 * cumprido na memória.
 */
describe("obrigação completa no caminho completo: declaração não vira execução; caminho não vira 'todas as etapas'", () => {
  it("diagnóstico, revisão, memória, agregação, pedido ao redator e mensagem final", async () => {
    const { model, calls } = fakeEngineModel({
      analysis: (handle) => ({
        scenario: { customerNeed: "Segunda via da fatura", conditions: [{ text: "Cliente pediu a segunda via", evidence: [{ turn: "T2", speaker: "CLIENTE", quote: "Preciso da segunda via da conta." }] }], procedure: "D1", pathSections: [fixtureContext().section("Emissão").handle], correctPath: "Confirmar o tipo e enviar.", pathTaken: "Confirmou o tipo e enviou.", pathAssessment: "CORRECT", pathRationale: "Seguiu todas as etapas.", pathEvidence: [{ turn: "T5", speaker: "OPERADOR", quote: "A segunda via é da fatura ou do parcelamento?" }] },
        criteria: [
          { line: handle("Confirmar se a solicitação"), status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T5", speaker: "OPERADOR", quote: "A segunda via é da fatura ou do parcelamento?" }], rationale: "Confirmou o tipo.", materiality: "HIGH", itemNature: "INFORMATION_REQUEST", applicability: "APPLIES", observability: "IN_CONVERSATION", lineRole: "ACTION" },
          { line: handle("Enviar a segunda via"), status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T7", speaker: "OPERADOR", quote: "Vou enviar por e-mail agora mesmo." }], rationale: "Enviou pelo canal escolhido.", materiality: "HIGH", itemNature: "COMMUNICATION", applicability: "APPLIES", observability: "IN_CONVERSATION", lineRole: "ACTION" },
          { line: handle("Informar o prazo de 2 dias"), status: "NOT_APPLICABLE", evidenceKind: "NONE", evidence: [], rationale: "Envio por e-mail, não por correio.", materiality: "LOW", applicability: "DOES_NOT_APPLY", observability: "IN_CONVERSATION", lineRole: "ACTION" },
        ],
      }),
      review: (payload) => {
        const base = confirmAll(payload)
        return { ...base, claims: base.claims.map((claim) => (payload.claims.find((entry) => entry.id === claim.id)?.rule.text.includes("Enviar a segunda via") ? { ...claim, evidenceReading: "STATEMENT_ABOUT_ACTION", outsideDependency: true } : claim)) }
      },
      composition: { sentences: [{ text: "Você confirmou se a segunda via era da fatura ou do parcelamento antes de seguir, o que evitou enviar o documento errado.", stance: "RECOGNITION", refs: ["S1"], paragraph: 1 }], card: { text: "Você confirmou o tipo de segunda via antes de seguir.", refs: ["S1"] } },
    })
    const { deps, stores } = setup(model)
    await generateFeedback(deps, request())
    const assessment = stores.assessments.find((entry) => entry.isCurrent)!
    const send = assessment.analysis.criteria.find((criterion) => criterion.text.includes("Enviar a segunda via"))!
    // Diagnóstico + revisão: não é acerto; fora da conversa; a fala fica como intenção/declaração.
    expect(send).toMatchObject({ status: "NOT_OBSERVABLE", confirmation: "UNCONFIRMED", observability: "OUTSIDE_CONVERSATION" })
    expect(send.confirmationReasons).toContain("EXECUTION_OUTSIDE_CONVERSATION")
    expect(["DECLARED", "INTENDED"]).toContain(send.executionClaim)
    // Conclusão geral: "correto" não sobrevive a uma etapa do caminho não verificável.
    expect(assessment.analysis.scenario).toMatchObject({ proposedPathAssessment: "CORRECT", pathAssessment: "UNDETERMINED", pathCompleteness: { status: "LIMITED" } })
    // Memória + agregação: nenhuma contagem de cumprido para o envio.
    expect(assessment.criteria.find((entry) => entry.lineKey === send.lineKey)!.status).toBe("NOT_OBSERVABLE")
    const snapshot = await stores.currentMemory(ORG, { personIds: [OPERATOR] })
    expect(criterionPatternsOf(memoryRowsOf(snapshot, CALL_ANALYSIS_LOGIC_VERSION, null)).find((entry) => entry.text.includes("Enviar a segunda via"))).toMatchObject({ met: 0, eligible: 0 })
    // Pedido ao redator: sem "Condução do caso" e sem o envio como reconhecimento.
    const composition = calls.find((call) => call.stage === "COMPOSITION")!.contents[0]!.text
    expect(composition).not.toContain("Condução do caso")
    expect(composition).not.toMatch(/"title": "Enviar a segunda via/)
    // Mensagem final: só o que foi observado na conversa.
    const message = [...stores.messages.values()][0]!
    expect(message.brief?.strengths.map((finding) => finding.title)).toEqual(["Confirmar se a solicitação é da fatura ou do parcelamento"])
    expect(message.message?.text ?? "").not.toMatch(/enviou|seguiu todas/i)
  })
})
