import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { createInMemoryFeedbackMemoryStore } from "../infrastructure/in-memory-feedback-memory-store.js"
import { verificationRecordOf } from "../infrastructure/postgres-feedback-memory-store.js"
import { generateFeedback, type GenerateFeedbackDeps, type GenerateFeedbackRequest } from "./generate-feedback.js"
import { describeCallAnalysis, type AnalyzeCallDeps } from "./analyze-call.js"
import type { EngineModelPort } from "./ports.js"
import { confirmAllObligations, fakeEngineModel, type ObligationReviewPayload } from "../testing/fake-engine-model.js"
import { CHECKLIST_ID, CHECKLIST_V1, DOC_ID, INTERACTION_ID, PROCEDURE_V1, TRANSCRIPT } from "../testing/fixtures.js"

/**
 * COERÊNCIA DO DIAGNÓSTICO, DA MEMÓRIA E DA MENSAGEM (`CALL_ANALYSIS_LOGIC_V12`) — modelo FALSO, memória em RAM, zero IA. Cada caso
 * reproduz, com as fixtures sintéticas de segunda via, um defeito da rodada real V10 (C07 e DEMO-INT-0001-08). Comprova o CÓDIGO
 * (o que ele faz com as leituras que recebe), nunca a qualidade de uma nova leitura do modelo.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATOR = "00000000-0000-4000-8000-0000000000aa"
const AGENT = "00000000-0000-4000-8000-00000000a001"
const CLOSING = "## 5. Encerramento\n\n- Confirmar se o cliente tem mais alguma dúvida.\n"

function setup(model: EngineModelPort, procedure = PROCEDURE_V1) {
  const stores = createInMemoryFeedbackMemoryStore()
  const analyze: AnalyzeCallDeps = {
    memory: stores,
    model,
    loadInteraction: async (_org, id) => (id === INTERACTION_ID ? { id: INTERACTION_ID, organizationId: ORG, operatorId: OPERATOR, operatorName: "Ana", startedAt: new Date("2026-09-20T13:00:00Z"), endedAt: new Date("2026-09-20T13:06:00Z"), reason: "Segunda via", channel: "VOICE", subjectCanonical: null, flags: [], transcript: { content: TRANSCRIPT, checksum: "abc" }, teamId: "t1", subteamId: null, supervisorId: "s1", timeZone: "America/Fortaleza" } : null),
    loadAgent: async () => ({ id: AGENT, name: "Especialista de 2ª via", objective: "Avaliar segunda via", contextPrompt: null, updatedAt: new Date("2026-09-01T00:00:00Z"), businessDomainId: null }),
    loadDocuments: async () => [
      { documentId: DOC_ID, title: "Procedimento — Segunda via de conta", version: 1, content: procedure, contentHash: "h1", perspective: "RULE_IN_FORCE_AT_CALL" },
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

type Obligation = Record<string, unknown>
const base = (handle: (text: string) => string, obligations: Obligation[], conduct = { pathTaken: "Validou o nome, confirmou o tipo e disse que enviaria.", assessment: "PARTIALLY_CORRECT", rationale: "Faltou a data de nascimento: enviou sem validar o titular." }) => ({
  need: { summary: "O cliente precisa da segunda via da fatura.", conditions: [] },
  sources: { primary: "D1", related: ["D2"], rationale: "Procedimento da segunda via." },
  argumentScripts: [],
  obligations,
  notAssessed: [],
  conduct,
  sourceConflicts: [],
  limitations: [],
})
const name = (handle: (text: string) => string): Obligation => ({ id: "OBL-NOME", sources: [handle("O operador deverá validar o titular"), handle("Confirmar nome completo")], action: "Confirmar o nome completo", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding: "MET", evidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Me confirma seu nome completo?", role: "CONDUCT" }], opportunityTurn: null, materiality: "HIGH", role: "CENTRAL", rationale: "Pediu o nome completo.", guidance: null })
const birth = (handle: (text: string) => string): Obligation => ({ id: "OBL-NASC", sources: [handle("Confirmar data de nascimento")], action: "Confirmar a data de nascimento", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding: "NOT_MET", evidence: [], opportunityTurn: "T5", materiality: "HIGH", role: "CENTRAL", rationale: "Seguiu sem pedir a data de nascimento.", guidance: { moment: "Logo depois de confirmar o nome", action: "Pedir a data de nascimento antes de seguir." } })
const send = (handle: (text: string) => string): Obligation => ({ id: "OBL-ENVIO", sources: [handle("Enviar a segunda via")], action: "Enviar a segunda via pelo canal escolhido", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "OUTSIDE_CONVERSATION", finding: "MET", evidence: [{ turn: "T7", speaker: "OPERADOR", quote: "Vou enviar por e-mail agora mesmo.", role: "CONDUCT" }], opportunityTurn: null, materiality: "HIGH", role: "CENTRAL", rationale: "Enviou por e-mail.", guidance: null })
const currentAnalysis = (stores: ReturnType<typeof createInMemoryFeedbackMemoryStore>) => stores.assessments.find((entry) => entry.isCurrent)!.analysis
const message = (stores: ReturnType<typeof createInMemoryFeedbackMemoryStore>) => [...stores.messages.values()][0]!

describe("falha material confirmada chega à mensagem; ação interna e paráfrase não viram acusação", () => {
  it("omissão confirmada → ponto de desenvolvimento com a regra e a orientação; envio só dito (fora da conversa) nem acusado nem elogiado", async () => {
    const fake = fakeEngineModel({ analysis: (handle) => base(handle, [name(handle), birth(handle), send(handle)]) })
    const { deps, stores } = setup(fake.model)
    await generateFeedback(deps, request())
    const brief = message(stores).brief!
    expect(brief.developments[0]).toMatchObject({ ref: "A1", status: "NOT_MET", guidance: { action: "Pedir a data de nascimento antes de seguir." } })
    expect(brief.developments[0]!.rules.map((rule) => rule.text).join(" ")).toContain("Confirmar data de nascimento")
    // A redação RECEBEU o ponto, e a mensagem só sai com o ponto principal coberto por orientação específica (regra de utilidade).
    const writer = fake.calls.find((call) => call.stage === "COMPOSITION")!.contents[0]!.text
    expect(writer).toContain("Confirmar data de nascimento")
    expect(message(stores).status).toBe("PUBLISHABLE")
    expect(message(stores).composition).toMatchObject({ usefulness: { primaryRef: "A1", primaryCovered: true } })
    // Execução em sistema: nem desenvolvimento nem reconhecimento; limite de cobertura (auditoria) e caminho vigente "declarada".
    const titles = [...brief.developments, ...brief.strengths].map((finding) => finding.title).join(" | ")
    expect(titles).not.toMatch(/Enviar a segunda via/)
    expect(brief.coverageLimits?.map((limit) => limit.title).join(" ")).toMatch(/Enviar a segunda via/)
    expect(currentAnalysis(stores).scenario.pathTaken).toMatch(/Enviar a segunda via.*declarada na conversa/)
  })

  it("paráfrase válida: 'não perguntou se havia dúvida' é REFUTADO pela fala com outras palavras; o acerto por paráfrase é confirmado", async () => {
    const asked = (handle: (text: string) => string, finding: "MET" | "NOT_MET"): Obligation => ({ id: "OBL-DUVIDA", sources: [handle("Confirmar se o cliente tem mais alguma dúvida")], action: "Confirmar se o cliente tem mais alguma dúvida", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding, evidence: finding === "MET" ? [{ turn: "T9", speaker: "OPERADOR", quote: "Posso ajudar em mais alguma coisa?", role: "CONDUCT" }] : [], opportunityTurn: finding === "MET" ? null : "T9", materiality: "MEDIUM", role: "SUPPORTING", rationale: finding === "MET" ? "Perguntou se havia algo mais, com outras palavras." : "Não usou a pergunta da base.", guidance: null })
    const refuting = fakeEngineModel({
      analysis: (handle) => base(handle, [name(handle), asked(handle, "NOT_MET")]),
      obligationReview: (payload: ObligationReviewPayload) => {
        const review = confirmAllObligations(payload)
        return { ...review, claims: review.claims.map((claim) => (payload.claims.find((entry) => entry.id === claim.id)!.proposedStatus === "NOT_MET" ? { ...claim, verdict: "REFUTED", issues: ["ACTION_FOUND_IN_CALL"], counterEvidence: [{ turn: "T9", speaker: "OPERADOR", quote: "Posso ajudar em mais alguma coisa?" }] } : claim)) }
      },
    })
    const first = setup(refuting.model)
    await generateFeedback(first.deps, request())
    const refuted = currentAnalysis(first.stores).criteria.find((criterion) => criterion.text.includes("mais alguma dúvida") && criterion.origin === "ANALYSIS")!
    expect(refuted).toMatchObject({ status: "NOT_OBSERVABLE", confirmation: "REFUTED" })
    expect(message(first.stores).brief!.developments.map((finding) => finding.title).join(" ")).not.toMatch(/dúvida/)

    const confirming = fakeEngineModel({ analysis: (handle) => base(handle, [name(handle), asked(handle, "MET")]) })
    const second = setup(confirming.model)
    await generateFeedback(second.deps, request())
    expect(currentAnalysis(second.stores).criteria.find((criterion) => criterion.text.includes("mais alguma dúvida") && criterion.origin === "ANALYSIS")).toMatchObject({ status: "MET", confirmation: "CONFIRMED" })
  })
})

describe("conclusão refutada sai de TODOS os campos do diagnóstico vigente (C07 V10: a justificativa do caminho mantinha a acusação)", () => {
  it("desvio refutado: status, caminho, justificativa vigente, resumo e mensagem sem a acusação; a leitura original fica só na auditoria", async () => {
    const fake = fakeEngineModel({
      analysis: (handle) => base(handle, [name(handle), birth(handle), send(handle)]),
      obligationReview: (payload: ObligationReviewPayload) => {
        const review = confirmAllObligations(payload)
        return { ...review, claims: review.claims.map((claim) => (payload.claims.find((entry) => entry.id === claim.id)!.proposedStatus === "NOT_MET" ? { ...claim, verdict: "REFUTED", issues: ["ACTION_FOUND_IN_CALL"], counterEvidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Me confirma seu nome completo?" }] } : claim)) }
      },
    })
    const { deps, stores } = setup(fake.model)
    await generateFeedback(deps, request())
    const analysis = currentAnalysis(stores)
    const refuted = analysis.criteria.find((criterion) => criterion.text.includes("Confirmar data de nascimento") && criterion.origin === "ANALYSIS")!
    expect(refuted).toMatchObject({ status: "NOT_OBSERVABLE", confirmation: "REFUTED" })
    // Caminho: nenhuma etapa MATERIAL descumprida sobrou → o "parcialmente correto" da análise não se sustenta.
    expect(analysis.scenario).toMatchObject({ declaredPathAssessment: "PARTIALLY_CORRECT", pathAssessment: "UNDETERMINED", pathRationaleSource: "FINAL_EVIDENCE" })
    expect(analysis.scenario.pathRationale).not.toContain("Faltou a data de nascimento")
    expect(analysis.scenario.pathRationale).toMatch(/não se sustentaram.*Confirmar data de nascimento/)
    expect(analysis.scenario.pathRationale).toMatch(/Não verificável pela gravação.*Enviar a segunda via/)
    // A leitura original continua rastreável (auditoria), separada do diagnóstico vigente.
    expect(analysis.scenario.analysisReading).toMatchObject({ assessment: "PARTIALLY_CORRECT", rationale: "Faltou a data de nascimento: enviou sem validar o titular." })
    expect(describeCallAnalysis(analysis)).not.toMatch(/Seguiu sem pedir a data de nascimento/)
    expect(verificationRecordOf(refuted)).toMatchObject({ confirmation: "REFUTED", declaredStatus: "NOT_MET" })
    const brief = message(stores).brief!
    expect(brief.developments.map((finding) => finding.title).join(" ")).not.toMatch(/data de nascimento/)
    expect(brief.context.join(" ")).not.toMatch(/etapas faltando/)
  })

  it("todas as conclusões confirmadas como propostas → a leitura da análise continua sendo o caminho vigente", async () => {
    const fake = fakeEngineModel({ analysis: (handle) => base(handle, [name(handle), birth(handle)], { pathTaken: "Validou só o nome.", assessment: "PARTIALLY_CORRECT", rationale: "Faltou a data de nascimento." }) })
    const { deps, stores } = setup(fake.model)
    await generateFeedback(deps, request())
    expect(currentAnalysis(stores).scenario).toMatchObject({ pathAssessment: "PARTIALLY_CORRECT", pathRationaleSource: "ANALYSIS", pathRationale: "Faltou a data de nascimento.", pathTaken: "Validou só o nome." })
  })

  it("só um desvio de BAIXA materialidade no caminho não sustenta 'etapas materiais faltando' (C07 V10: a marca na saudação)", async () => {
    const low = (handle: (text: string) => string): Obligation => ({ ...birth(handle), materiality: "LOW", role: "ROUTINE" })
    const fake = fakeEngineModel({ analysis: (handle) => base(handle, [name(handle), low(handle)], { pathTaken: "Validou o nome.", assessment: "PARTIALLY_CORRECT", rationale: "Faltou um detalhe da validação." }) })
    const { deps, stores } = setup(fake.model)
    await generateFeedback(deps, request())
    const analysis = currentAnalysis(stores)
    expect(analysis.criteria.find((criterion) => criterion.text.includes("Confirmar data de nascimento"))).toMatchObject({ status: "NOT_MET", confirmation: "CONFIRMED" })
    expect(analysis.scenario.pathAssessment).toBe("UNDETERMINED")
    expect(analysis.auditNotes).toContain("O único desvio confirmado no caminho é de baixa materialidade: não sustenta, sozinho, um desvio de caminho.")
  })
})

describe("mesma conduta em duas regras: duas bases normativas, UMA ocorrência (B V10: o protocolo nunca dito, em duas obrigações)", () => {
  const PROCEDURE = PROCEDURE_V1.replace(CLOSING, "## 5. Encerramento\n\nAntes de encerrar, informar:\n- O número do protocolo do atendimento.\n")
  const protocolHere = (handle: (text: string) => string): Obligation => ({ id: "OBL-PROT-PROC", sources: [handle("Antes de encerrar, informar"), handle("O número do protocolo do atendimento")], action: "Informar o número do protocolo antes de encerrar", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding: "NOT_MET", evidence: [], opportunityTurn: "T9", materiality: "HIGH", role: "CENTRAL", rationale: "Encerrou sem informar o número do protocolo.", guidance: { moment: "Antes de encerrar", action: "Informe o número do protocolo ao cliente." } })
  const protocolChecklist = (handle: (text: string) => string): Obligation => ({ id: "OBL-PROT-CHECK", sources: [handle("Antes de encerrar qualquer chamada")], action: "Informar o protocolo antes de encerrar qualquer chamada", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding: "NOT_MET", evidence: [], opportunityTurn: "T9", materiality: "HIGH", role: "ROUTINE", rationale: "O protocolo não foi informado.", guidance: null })
  const linking = (target: string | null) => (payload: ObligationReviewPayload) => {
    const review = confirmAllObligations(payload)
    return { ...review, claims: review.claims.map((claim) => (claim.id === "O3" ? { ...claim, sameConductAs: target } : claim)) }
  }

  it("a revisão liga as duas; o código confere o mesmo momento → um ponto na mensagem com as duas regras; contagem por regra × ocorrência", async () => {
    const fake = fakeEngineModel({ analysis: (handle) => base(handle, [name(handle), protocolHere(handle), protocolChecklist(handle)], { pathTaken: "Validou o nome e encerrou.", assessment: "PARTIALLY_CORRECT", rationale: "Faltou o protocolo." }), obligationReview: linking("O2") })
    const { deps, stores } = setup(fake.model, PROCEDURE)
    await generateFeedback(deps, request())
    const analysis = currentAnalysis(stores)
    const protocol = analysis.criteria.filter((criterion) => criterion.status === "NOT_MET")
    expect(protocol).toHaveLength(2)
    expect(new Set(protocol.map((criterion) => criterion.occurrence?.key)).size).toBe(1)
    expect(protocol[0]!.occurrence!.key).toMatch(/^OC-[0-9a-f]{12}$/)
    expect(analysis.coverage.occurrences).toMatchObject({ adverseRules: 2, adverseOccurrences: 1 })
    expect(describeCallAnalysis(analysis)).toContain("Desvios: 1 ocorrência(s) de conduta, em 2 regra(s).")
    // Memória: cada regra continua registrada (cobertura por regra), com a mesma ocorrência.
    expect(protocol.map((criterion) => verificationRecordOf(criterion).occurrence?.key)).toEqual([protocol[0]!.occurrence!.key, protocol[0]!.occurrence!.key])
    const brief = message(stores).brief!
    expect(brief.developments).toHaveLength(1)
    expect(brief.developments[0]!.rules.map((rule) => rule.documentTitle).sort()).toEqual(["Checklist de Encerramento de Chamada", "Procedimento — Segunda via de conta"])
    expect(brief.developments[0]!.criterionKeys).toHaveLength(2)
    expect(brief.developments[0]!.memberFindingKeys).toHaveLength(1)
  })

  it("ligação que a estrutura não confirma (momentos diferentes) é recusada e registrada: duas ocorrências", async () => {
    const elsewhere = (handle: (text: string) => string): Obligation => ({ ...protocolChecklist(handle), opportunityTurn: "T3" })
    const fake = fakeEngineModel({ analysis: (handle) => base(handle, [name(handle), protocolHere(handle), elsewhere(handle)], { pathTaken: "Validou o nome e encerrou.", assessment: "PARTIALLY_CORRECT", rationale: "Faltou o protocolo." }), obligationReview: linking("O2") })
    const { deps, stores } = setup(fake.model, PROCEDURE)
    await generateFeedback(deps, request())
    const analysis = currentAnalysis(stores)
    expect(analysis.criteria.filter((criterion) => criterion.occurrence?.basis === "REVIEW_SAME_CONDUCT")).toHaveLength(0)
    // A revisão existiu e podia ligar: cada regra fica com a SUA ocorrência (determinável), nunca sem registro.
    expect(analysis.criteria.filter((criterion) => criterion.status === "NOT_MET").map((criterion) => criterion.occurrence?.basis)).toEqual(["SINGLE_RULE", "SINGLE_RULE"])
    expect(analysis.coverage.occurrences).toMatchObject({ adverseRules: 2, adverseOccurrences: 2 })
    expect(analysis.auditNotes!.join(" ")).toMatch(/O3 e O2 julgam a mesma conduta.*DIFFERENT_MOMENT/)
  })
})

describe("item de lista que a análise usou e não avaliou: vai à revisão como contexto, nunca some nem vira falta por estrutura (C07 V10: 'Serviço cancelado, quando aplicável')", () => {
  const PROCEDURE = PROCEDURE_V1.replace(CLOSING, "## 5. Encerramento\n\nAntes de encerrar, informar:\n- O número do protocolo do atendimento;\n- O prazo de envio da segunda via.\n")
  const protocolOnly = (handle: (text: string) => string): Obligation => ({ id: "OBL-PROT", sources: [handle("Antes de encerrar, informar"), handle("O número do protocolo do atendimento")], action: "Informar o protocolo antes de encerrar", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding: "NOT_MET", evidence: [], opportunityTurn: "T9", materiality: "HIGH", role: "CENTRAL", rationale: "Encerrou sem informar o protocolo.", guidance: { moment: "Antes de encerrar", action: "Informe o número do protocolo." } })
  const reviewPayloadOf = (fake: ReturnType<typeof fakeEngineModel>) => JSON.parse(fake.calls.find((call) => call.stage === "CALL_REVIEW")!.contents[0]!.text.split("ANÁLISE A REVISAR (JSON):")[1]!) as { claims: { id: string }[]; listItemsInPlay?: { obligation: string; opening: string | null; items: { line: string; text: string }[] }[] }

  it("o irmão não avaliado chega à revisão junto da obrigação que usa a lista; a revisão o aponta como faltante; a confirmação focal confirma; o ponto chega à redação", async () => {
    const holder: { prazo?: string } = {}
    const fake = fakeEngineModel({
      analysis: (handle) => {
        holder.prazo = handle("O prazo de envio da segunda via")
        return base(handle, [name(handle), protocolOnly(handle)], { pathTaken: "Validou o nome e encerrou.", assessment: "PARTIALLY_CORRECT", rationale: "Faltou o protocolo." })
      },
      obligationReview: (payload: ObligationReviewPayload) => ({ ...confirmAllObligations(payload), missed: [{ sources: [holder.prazo!], action: "Informar o prazo de envio da segunda via antes de encerrar", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding: "NOT_MET", evidence: [], opportunityTurn: "T9", materiality: "HIGH", role: "CENTRAL", rationale: "O prazo de envio não foi informado no encerramento.", guidance: { moment: "Antes de encerrar", action: "Diga em quanto tempo a segunda via chega." } }] }),
    })
    const { deps, stores } = setup(fake.model, PROCEDURE)
    await generateFeedback(deps, request())
    const sent = reviewPayloadOf(fake)
    // Contexto agrupado pela obrigação (O2 = a do protocolo), com a frase que abre a lista; nenhuma disposição por item é pedida.
    expect(sent.listItemsInPlay).toEqual(expect.arrayContaining([{ obligation: "O2", action: "Informar o protocolo antes de encerrar", opening: "Antes de encerrar, informar:", items: [{ line: holder.prazo, text: expect.stringContaining("O prazo de envio da segunda via") }] }]))
    // Achado só da revisão → confirmação focal (não descartado por não estar na primeira análise) → confirmado.
    expect(fake.calls.filter((call) => call.stage === "CALL_CONFIRMATION")).toHaveLength(1)
    const analysis = currentAnalysis(stores)
    expect(analysis.criteria.find((criterion) => criterion.origin === "REVIEW_REPAIR" && (criterion.sources ?? []).some((source) => source.handle === holder.prazo))).toMatchObject({ status: "NOT_MET", confirmation: "CONFIRMED" })
    expect(analysis.coverage.listItems).toMatchObject({ raisedByReview: 1 })
    // O prazo chega ao ponto do encerramento (mesma seção do protocolo: um momento da conversa, duas regras), com a sua regra.
    const closing = message(stores).brief!.developments.find((finding) => finding.rules.some((rule) => rule.text.includes("O prazo de envio da segunda via")))
    expect(closing).toBeDefined()
    expect(closing!.rules.map((rule) => rule.text).join(" ")).toContain("O número do protocolo do atendimento")
    expect(fake.calls.find((call) => call.stage === "COMPOSITION")!.contents[0]!.text).toMatch(/prazo de envio/)
  })

  it("a revisão não aponta o item: ele não vira falha, nem acerto, nem 'não avaliado' por estrutura — só fica contado na cobertura", async () => {
    const fake = fakeEngineModel({ analysis: (handle) => base(handle, [name(handle), protocolOnly(handle)], { pathTaken: "Encerrou.", assessment: "PARTIALLY_CORRECT", rationale: "Faltou o protocolo." }) })
    const { deps, stores } = setup(fake.model, PROCEDURE)
    await generateFeedback(deps, request())
    const analysis = currentAnalysis(stores)
    expect(analysis.criteria.some((criterion) => criterion.text.includes("O prazo de envio da segunda via"))).toBe(false)
    expect(analysis.coverage.listItems).toMatchObject({ found: 2, shownToReview: 2, raisedByReview: 0 })
    expect(message(stores).brief!.developments.flatMap((finding) => finding.rules.map((rule) => rule.text)).join(" ")).not.toContain("O prazo de envio")
  })
})

describe("reconhecimento não se estende ao que ninguém avaliou; ação fora da conversa nunca vira base de elogio (C07 V10: 'as orientações ficaram bem claras', 'respaldando a verificação')", () => {
  const PROCEDURE = PROCEDURE_V1.replace(CLOSING, "## 5. Encerramento\n\nAntes de encerrar, informar:\n- O número do protocolo do atendimento;\n- O serviço cancelado, quando aplicável;\n- O prazo de envio da segunda via.\n")
  it("o ponto de reconhecimento leva os itens da mesma lista não avaliados, e a execução em sistema chega como 'não verificável' — à redação e à verificação", async () => {
    const protocolMet = (handle: (text: string) => string): Obligation => ({ id: "OBL-PROT", sources: [handle("Antes de encerrar, informar"), handle("O número do protocolo do atendimento")], action: "Informar o protocolo antes de encerrar", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding: "MET", evidence: [{ turn: "T9", speaker: "OPERADOR", quote: "Posso ajudar em mais alguma coisa?", role: "CONDUCT" }], opportunityTurn: null, materiality: "HIGH", role: "CENTRAL", rationale: "Informou no encerramento.", guidance: null })
    const fake = fakeEngineModel({ analysis: (handle) => base(handle, [name(handle), protocolMet(handle), send(handle)], { pathTaken: "Validou e encerrou.", assessment: "CORRECT", rationale: "Seguiu o procedimento." }), composition: { sentences: [{ text: "Você pediu o nome completo antes de seguir com a segunda via.", stance: "RECOGNITION", refs: ["S1"], paragraph: 1 }], card: { text: "Você confirmou o nome completo antes de seguir.", refs: ["S1"] } } })
    const { deps, stores } = setup(fake.model, PROCEDURE)
    await generateFeedback(deps, request())
    const brief = message(stores).brief!
    const closing = brief.strengths.find((finding) => finding.rules.some((rule) => rule.text.includes("O número do protocolo")))!
    expect(closing.notAssessedInSameList).toEqual([expect.stringContaining("O serviço cancelado, quando aplicável"), expect.stringContaining("O prazo de envio da segunda via")])
    const writer = fake.calls.find((call) => call.stage === "COMPOSITION")!.contents[0]!.text
    const verifier = fake.calls.find((call) => call.stage === "VERIFICATION")!.contents[0]!.text
    for (const payload of [writer, verifier]) {
      expect(payload).toMatch(/"notAssessedInSameList": \[\s*"[^"]*O serviço cancelado, quando aplicável/)
      expect(payload).toMatch(/"notVerifiableByRecording": \[\s*\{\s*"action": "[^"]*Enviar a segunda via[^"]*",\s*"operatorSaidItWasDone": true/)
    }
  })
})

