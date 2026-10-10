import { describe, expect, it } from "vitest"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY } from "../domain/reliable-feedback-item.js"
import { nodeOutputOf } from "../domain/reliable-feedback-artifact.js"
import { verifyProcessAssessments } from "../domain/process-assessment.js"
import { askedItemIntentOf, askedItemMatchOf } from "../domain/action-semantics.js"
import { structuredAnchorOf } from "../domain/structured-anchor.js"
import { ruleContextOf } from "../domain/verified-omission.js"
import { observationsFrom } from "../../indicator-diagnosis/domain/process-patterns.js"
import { isObservationEligibleForAnalytics, summarizeObservations } from "../../indicator-diagnosis/domain/observation-readiness.js"
import { V171N_ASSESSMENT, V171N_COLLABORATOR_NAME, V171N_DOC_TITLE, V171N_PRESENTED, V171N_PUBLISHED, V171N_SUBJECT, V171N_TRANSCRIPT, V171N_WRITER_RAW, V171N_WRITER_SLOTS } from "../testing/contestacao-v171n-smoke-fixture.js"

/**
 * V1.7.1o — ITEM A PERGUNTAR com semântica tipada (classe de objeto + assunto + pergunta), sobre o smoke REAL da V1.7.1n
 * (SMOKE-V171N-CONTESTACAO-001; sem modelo). Único bloqueador daquele smoke: "Se a conta já foi paga" × "Você já pagou alguma
 * dessas faturas?" ia ao QA porque a checagem só comparava palavras.
 */
const ITEM = "Se a conta já foi paga"
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const match = (speech: string, preceding: string[] = []) => askedItemMatchOf(ITEM, speech, preceding)

describe("V1.7.1o — A–H) intenção tipada do item a perguntar", () => {
  it("a intenção do item vem das classes de objeto existentes (PAYMENT) + assunto (BILL)", () => {
    expect(askedItemIntentOf(ITEM)).toEqual({ classes: ["PAYMENT"], subjects: ["BILL"] })
    // Item sem classe tipada: nada muda (continua a comparação por palavras).
    expect(askedItemIntentOf("Qual cobrança não reconhece")).toBeNull()
    expect(askedItemIntentOf("Se já houve contato anterior")).toBeNull()
  })

  it("A) \"Você já pagou alguma dessas faturas?\" pergunta o item (paga × pagou, conta × faturas)", () => {
    expect(match("Entendi. Você já pagou alguma dessas faturas?")).toMatchObject({ question: "Você já pagou alguma dessas faturas?", classes: ["PAYMENT"], subject: "BILL", via: "EXPLICIT" })
  })

  it("B/D/E) passiva, singular/plural e flexões controladas (paga, pago, pagou, pagas, pagos, pagamento, pagar)", () => {
    for (const speech of ["Essas faturas já foram pagas?", "Alguma dessas contas foi paga?", "Você já pagou essa conta?", "A fatura de agosto já foi paga?", "O boleto já foi pago?", "Você já fez o pagamento da fatura?", "Os boletos já foram pagos?", "Você já pagou essa cobrança?"]) expect([speech, match(speech)?.subject ?? null]).toEqual([speech, "BILL"])
  })

  it("C) anáfora (\"alguma delas\") só com o assunto nomeado nas falas imediatamente anteriores", () => {
    const context = ["Ela veio na fatura de agosto e na de setembro.", "Entendi."]
    expect(match("Você chegou a pagar alguma delas?", context)).toMatchObject({ via: "ANAPHORA", subject: "BILL" })
    expect(match("Você chegou a pagar alguma delas?")).toBeNull()
    expect(match("Você chegou a pagar alguma delas?", ["Qual é o seu plano?", "É o controle de 20 giga."])).toBeNull()
  })

  it("F) pergunta sem relação nunca vira pagamento — ponto de interrogação sozinho não basta", () => {
    for (const speech of ["Qual cobrança você não reconhece?", "Seu telefone continua o mesmo?", "Ficou alguma dúvida?", "Quando essa cobrança apareceu?", "Essa conta é sua?"]) expect([speech, match(speech)]).toEqual([speech, null])
  })

  it("G) afirmação sobre pagamento não é pergunta ao cliente", () => {
    for (const speech of ["Eu já paguei a conta.", "A conta aparece como paga no sistema.", "O pagamento será analisado.", "Vamos verificar depois.", "A fatura de agosto foi paga, a de setembro não."]) expect([speech, match(speech)]).toEqual([speech, null])
  })

  it("H) objeto errado: só o verbo não prova a conferência da conta", () => {
    for (const speech of ["Você pagou o serviço com cartão?", "Você pagou pelo aplicativo?", "Você pagou quanto no plano?"]) expect([speech, match(speech)]).toEqual([speech, null])
  })
})

describe("V1.7.1o — âncora ASKED_ITEM usa a intenção tipada (e continua exigindo pergunta)", () => {
  const content = V171N_PUBLISHED.get(V171N_PRESENTED.find((excerpt) => excerpt.heading.startsWith("6."))!.documentId)!.content
  const rule = ruleContextOf(content, "- Se a conta já foi paga;", "6. Escuta e identificação da solicitação")
  const anchor = (text: string, turns?: { turnRef: string; text: string }[]) => structuredAnchorOf({ status: "FOLLOWED", declaredEvidenceType: "OBSERVED", contentKind: "RULE_CONTENT", rule, citedQuote: "- Se a conta já foi paga;", documentTitle: V171N_DOC_TITLE, subject: V171N_SUBJECT, operatorEvidence: [{ turnRef: "T9", text }], conversation: [text], operatorConversation: [text], ...(turns ? { turns } : {}) })
  it("a pergunta real do smoke ancora a etapa; afirmação e pergunta de outro assunto continuam ITEM_NOT_ASKED", () => {
    expect(rule).toMatchObject({ leadIn: "O operador deverá permitir que o cliente explique:", stepText: "Se a conta já foi paga;" })
    expect(anchor("Entendi. Você já pagou alguma dessas faturas?")).toMatchObject({ anchored: true, basis: "ASKED_ITEM", proof: { askedIntent: [{ classes: ["PAYMENT"], subject: "BILL", via: "EXPLICIT" }] } })
    expect(anchor("Você chegou a pagar alguma delas?", [{ turnRef: "T7", text: "Ela veio na fatura de agosto e na de setembro." }, { turnRef: "T8", text: "Eu não baixei nada disso." }, { turnRef: "T9", text: "Você chegou a pagar alguma delas?" }])).toMatchObject({ anchored: true, basis: "ASKED_ITEM" })
    expect(anchor("A conta aparece como paga no sistema.")).toMatchObject({ anchored: false, failure: "ITEM_NOT_ASKED" })
    expect(anchor("Você pagou o serviço com cartão?")).toMatchObject({ anchored: false, failure: "ITEM_NOT_ASKED" })
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// I/J — replay do smoke REAL da V1.7.1n (avaliação V3 do especialista, resposta real do redator)
// ---------------------------------------------------------------------------------------------------------------------
const verified = () => verifyProcessAssessments({ sources: [{ sourceRef: "S", assessment: clone(V171N_ASSESSMENT), presented: V171N_PRESENTED }], interactionId: "int-o", transcript: V171N_TRANSCRIPT, published: V171N_PUBLISHED, subject: V171N_SUBJECT, coveragePlan: true })

function writer(): ReliableFeedbackWriterPort & { requested: string[] } {
  const requested: string[] = []
  const bySlot = new Map(V171N_WRITER_RAW.items.map((item) => [item.slot, item]))
  return {
    requested,
    writeMonitoring: async (input) => {
      requested.push(...input.items.map((item) => item.requirement ?? ""))
      return { rawOutput: { items: input.items.flatMap((item) => { const original = bySlot.get(V171N_WRITER_SLOTS[item.requirement ?? ""] ?? ""); return original ? [{ ...original, slot: item.slot }] : [] }), presentation: V171N_WRITER_RAW.presentation } }
    },
    writeIndicator: async () => { throw new Error("não usado") },
  }
}
async function replay() {
  const store = createInMemoryReliableFeedbackStore({ onReactivate: () => true })
  const port = writer()
  const deps: ReliableGenerationDeps = {
    enabled: true, store, writer: port, policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async () => ({ transcript: V171N_TRANSCRIPT, label: `Atendimento de 26/09/2026 · ${V171N_SUBJECT}`, otherOperatorNames: [], subjectOperatorName: V171N_COLLABORATOR_NAME }),
    loadIndicatorContext: async () => null, loadPublishedKnowledge: async () => V171N_PUBLISHED, loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }), resolveDiagnosticStrategy: async () => null,
    loadRecipient: async () => ({ firstName: "Larissa" }), now: () => new Date("2026-09-27T00:00:00Z"),
  }
  const source = { kind: "monitoring", knowledgeExcerpts: V171N_PRESENTED, input: { organizationId: "org-o", operatorId: "op-o", interactionId: "int-o", structured: { evidenceFound: "x", observedBehavior: "o", relatedProcedure: V171N_DOC_TITLE, recommendation: "r", processAssessment: clone(V171N_ASSESSMENT) } } }
  const request: ReliableGenerationRequest = { organizationId: "org-o", enrollmentId: "enr-o", workflowId: "wf", workflowVersionId: "v1", nodeId: "gerar", sourceNodeId: "orq", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: "op-o", interactionId: "int-o", indicatorMeasurementId: null, configuredAgentId: null }
  const result = await generateReliableFeedback(deps, request)
  const artifact = result.record.artifact!
  const text = nodeOutputOf(result.record.id, artifact, artifact.items.map((item) => ({ itemIndex: item.index, status: "APPROVED_UNCHANGED" as const, finalWording: null }))).text
  return { store, artifact, text, requested: port.requested }
}

describe("V1.7.1o — I/J) replay do smoke REAL da V1.7.1n", () => {
  it("I) o checkpointRef continua a identidade: a pergunta só PROVA a etapa já escolhida", () => {
    const payment = verified().checkpoints.find((checkpoint) => checkpoint.source?.ref === "CP-8651ee6f0b")!
    expect(payment).toMatchObject({ requirement: "Se a conta já foi paga;", status: "FOLLOWED", source: { ref: "CP-8651ee6f0b", canonicalBehavior: "CHECK_PAYMENT", quoteMatch: "EXACT" }, canonical: { behavior: "CHECK_PAYMENT", role: "PRIMARY" }, knowledge: { applicability: "VERIFIED", applicabilityBasis: "STRUCTURED_ANCHOR", structuredAnchor: { basis: "ASKED_ITEM", proof: { askedIntent: [{ classes: ["PAYMENT"], subject: "BILL", via: "EXPLICIT" }] } } } })
    expect(payment.transcriptEvidence.map((unit) => unit.quote)).toEqual(["Entendi. Você já pagou alguma dessas faturas?"])
  })

  it("J) 10 pontos prontos, 0 QA, 0 bloqueados; os demais comportamentos não mudam", async () => {
    const { artifact, text, store, requested } = await replay()
    expect(artifact.findings).toMatchObject({ detected: 10, reliable: 10, inFeedback: 10, heldForQa: 0, blocked: 0 })
    expect(store.reviews).toEqual([])
    expect(requested).toHaveLength(8)
    expect(artifact.items.map((item) => [item.process?.behavior?.code ?? item.process?.stepTitle, item.process?.status, item.decision?.disposition])).toEqual([
      ["INFORM_DEADLINE", "NOT_FOLLOWED", "READY"],
      ["RECAPITULATE_INTERACTION", "NOT_FOLLOWED", "READY"],
      ["IDENTIFY_CHARGE", "FOLLOWED", "READY"],
      ["CHECK_PAYMENT", "FOLLOWED", "READY"],
      ["Serviços digitais não reconhecidos", "FOLLOWED", "READY"],
      ["CANCEL_RECURRING_SERVICE", "FOLLOWED", "READY"],
      ["REGISTER_DISPUTE", "FOLLOWED", "READY"],
      ["CONFIRM_UNDERSTANDING", "FOLLOWED", "READY"],
      ["CONFIRM_SOLUTION", "FOLLOWED", "READY"],
      ["PROVIDE_PROTOCOL", "FOLLOWED", "READY"],
    ])
    const titles = [...text.matchAll(/^### (.+)$/gm)].map((found) => found[1])
    expect(new Set(titles).size).toBe(titles.length)
    // V1.7.2 — apresentação de supervisor: pontos cumpridos vão para "O que manter" (sem bloco por obrigação, sem placar).
    expect(text).toContain("verificou se a conta já tinha sido paga")
  })

  it("analytics: as 9 observações do smoke VERIFIED e elegíveis; Verificação do pagamento = 1 contribuição", () => {
    const observations = observationsFrom("op-o", [{ interactionId: "int-o", assessment: verified() }])
    expect(observations.map((observation) => [observation.canonicalBehavior, observation.checkpointRef, observation.status, observation.analyticsStatus])).toEqual([
      ["IDENTIFY_CHARGE", "CP-4a48ba4db9", "FOLLOWED", "VERIFIED"],
      ["CHECK_PAYMENT", "CP-8651ee6f0b", "FOLLOWED", "VERIFIED"],
      ["CANCEL_RECURRING_SERVICE", "CP-b9a41387af", "FOLLOWED", "VERIFIED"],
      ["REGISTER_DISPUTE", "CP-a91b89a0e2", "FOLLOWED", "VERIFIED"],
      ["INFORM_DEADLINE", "CP-a60913570d", "NOT_FOLLOWED", "VERIFIED"],
      ["RECAPITULATE_INTERACTION", "CP-08ba2d72ba", "NOT_FOLLOWED", "VERIFIED"],
      ["CONFIRM_UNDERSTANDING", "CP-c8acf59578", "FOLLOWED", "VERIFIED"],
      ["CONFIRM_SOLUTION", "CP-b9db6af3ba", "FOLLOWED", "VERIFIED"],
      ["PROVIDE_PROTOCOL", "CP-8eaac52713", "FOLLOWED", "VERIFIED"],
    ])
    expect(observations.every(isObservationEligibleForAnalytics)).toBe(true)
    expect(summarizeObservations(observations).find((entry) => entry.practiceKey === "BEHAVIOR:CHECK_PAYMENT")).toEqual({ practiceKey: "BEHAVIOR:CHECK_PAYMENT", followed: 1, notFollowed: 0, partial: 0, excluded: 0 })
  })
})
