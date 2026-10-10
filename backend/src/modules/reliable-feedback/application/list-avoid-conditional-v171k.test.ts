import { describe, expect, it } from "vitest"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import { decideReliableItem, isVerifiedSpecificFallback, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY, type ReliableWriterOutcome } from "../domain/reliable-feedback-item.js"
import { nodeOutputOf } from "../domain/reliable-feedback-artifact.js"
import { verifyKnowledgeQuote, verifyProcessAssessments } from "../domain/process-assessment.js"
import { segmentKnowledgeQuote } from "../domain/knowledge-segments.js"
import { assessCompleteness } from "../domain/composite-checkpoint.js"
import { cancellationEvidenceOf } from "../domain/subitem-semantics.js"
import { actionRelationOf, stepActionOf } from "../domain/action-semantics.js"
import { forbiddenPhrasesOf, structuredAnchorOf } from "../domain/structured-anchor.js"
import { ruleContextOf } from "../domain/verified-omission.js"
import { toReliableReviewDetail } from "../../interaction-feedback/domain/review-view.js"
import { checkpointReadinessOf, compositeFactsOf, isObservationEligibleForAnalytics } from "../../indicator-diagnosis/domain/observation-readiness.js"
import { observationsFrom } from "../../indicator-diagnosis/domain/process-patterns.js"
import { inlineEnumerationOf, listMarkerOf, parseKnowledgeLists, structuralLinesOf } from "../../knowledge/domain/knowledge-list.js"
import { normalizeForLiteralQuote } from "../../knowledge/domain/knowledge-match.js"
import {
  V171J_ASSESSMENT, V171J_CHECKLIST_CONTENT, V171J_CHECKLIST_ID, V171J_CHECKLIST_TITLE, V171J_COLLABORATOR_NAME, V171J_CONTENT, V171J_DOC_TITLE,
  V171J_OTHER_OPERATOR_NAMES, V171J_PRESENTED, V171J_PUBLISHED, V171J_SUBJECT, V171J_TRANSCRIPT, V171J_WRITER_RAW,
} from "../testing/contestacao-v171j-smoke-fixture.js"

/**
 * V1.7.1k — ESTRUTURA CANÔNICA DE LISTA + ÂNCORA "EVITAR" + EVIDÊNCIA DO ITEM CONDICIONAL, sobre o smoke REAL da V1.7.1j
 * (SMOKE-V171J-CONTESTACAO-001; sem modelo).
 */
const RECAP = "Antes de encerrar, informar:\n\n- Conta analisada;\n- Lançamento contestado;\n- Valor;\n- Ação realizada;\n- Serviço cancelado, quando aplicável;\n- Conta ajustada;\n- Valor a pagar;\n- Prazo;\n- Canal de retorno;\n- Protocolo."
const CONFIRMATION = "Perguntar: - “As informações ficaram claras?” - “Ficou alguma dúvida sobre o valor que deve ser pago?” - “Posso esclarecer o prazo ou o acompanhamento?” - “Existe outra cobrança da mesma conta que você não reconhece?”"
const operatorTurns = V171J_TRANSCRIPT.split("\n").filter((line) => line.startsWith("Operador:")).map((line) => line.replace(/^Operador:\s*/, ""))
const RECAP_TURN = operatorTurns.find((line) => line.includes("recapitulando"))!
const AVOID_TURN = operatorTurns.find((line) => line.includes("só aguardar"))!

describe("V1.7.1k — A/B/C) representação canônica de lista", () => {
  it("A) enumeração EM LINHA do Checklist real: abertura + quatro itens estruturados, com o marcador original", () => {
    expect(inlineEnumerationOf(V171J_CHECKLIST_CONTENT)).toEqual({
      leadIn: "Antes de encerrar qualquer chamada:",
      items: [
        { ordinal: 1, marker: "(1)", markerKind: "PAREN_NUMBER", text: "confirme a solução aplicada;" },
        { ordinal: 2, marker: "(2)", markerKind: "PAREN_NUMBER", text: "informe o número do protocolo;" },
        { ordinal: 3, marker: "(3)", markerKind: "PAREN_NUMBER", text: "explique o próximo passo e o prazo;" },
        { ordinal: 4, marker: "(4)", markerKind: "PAREN_NUMBER", text: "confirme se o cliente tem mais alguma dúvida." },
      ],
    })
    const [list] = parseKnowledgeLists(V171J_CHECKLIST_CONTENT)
    expect(list).toMatchObject({ leadIn: "Antes de encerrar qualquer chamada:", layout: "INLINE", ordered: true })
    expect(list!.items.map((item) => [item.position, item.marker, item.text])).toEqual([[1, "(1)", "confirme a solução aplicada;"], [2, "(2)", "informe o número do protocolo;"], [3, "(3)", "explique o próximo passo e o prazo;"], [4, "(4)", "confirme se o cliente tem mais alguma dúvida."]])
    // A etapa canônica deixa de ser NOT_A_LIST_STEP só pela formatação: citar abertura + UM item escolhe esse item.
    expect(ruleContextOf(V171J_CHECKLIST_CONTENT, "Antes de encerrar qualquer chamada: (1) confirme a solução aplicada;")).toMatchObject({ leadIn: "Antes de encerrar qualquer chamada:", listKind: "ORDERED", stepPosition: 1, stepText: "confirme a solução aplicada;" })
    expect(ruleContextOf(V171J_CHECKLIST_CONTENT, "(3) explique o próximo passo e o prazo;")).toMatchObject({ listKind: "ORDERED", stepPosition: 3, items: [{ position: 1 }, { position: 2 }, { position: 3 }, { position: 4 }] })
  })

  it("B) numeração em linhas (1. / 2) / (3)) e bullets são a mesma lista canônica", () => {
    const multiline = "## 9. Encerramento\n\nAntes de encerrar:\n\n(1) Confirmar a solução;\n(2) Informar o protocolo;\n3. Explicar o prazo;\n- Agradecer."
    const [list] = parseKnowledgeLists(multiline)
    expect(list).toMatchObject({ heading: "9. Encerramento", leadIn: "Antes de encerrar:", layout: "MULTILINE", ordered: false })
    expect(list!.items.map((item) => [item.marker, item.markerKind, item.text])).toEqual([["(1)", "PAREN_NUMBER", "Confirmar a solução;"], ["(2)", "PAREN_NUMBER", "Informar o protocolo;"], ["3.", "NUMBER_DOT", "Explicar o prazo;"], ["-", "BULLET", "Agradecer."]])
    expect(ruleContextOf(multiline, "(2) Informar o protocolo;")).toMatchObject({ heading: "9. Encerramento", leadIn: "Antes de encerrar:", stepPosition: 2, stepText: "Informar o protocolo;" })
    // A lista INTEIRA citada continua sendo a abertura (etapa composta, sem etapa única).
    expect(ruleContextOf(V171J_CONTENT, RECAP)).toMatchObject({ listKind: "NONE" })
  })

  it("C) número operacional nunca vira marcador: protocolo, telefone, data, valor, prazo", () => {
    for (const text of ["O seu protocolo é 2026 0925 4471.", "Ligue (11) 98765-4321 ou (21) 3333-4444.", "Vencimento em 25.09.2026 e 10.10.2026.", "Cobrança de R$ 12,90; 2 dias úteis; 3 parcelas.", "Prazo: 5 dias úteis; retorno em 1) dia"]) {
      expect(inlineEnumerationOf(text)).toBeNull()
      expect(structuralLinesOf(text)).toEqual([{ text, source: 0 }])
    }
    expect([listMarkerOf("2026 0925 4471"), listMarkerOf("25.09.2026 foi ativado"), listMarkerOf("12,90 por mês"), listMarkerOf("(11) 98765-4321")]).toEqual([null, null, null, null])
    // Ordinais fora de sequência também não formam lista.
    expect(inlineEnumerationOf("Opções: (2) confirmar; (4) informar.")).toBeNull()
    expect(normalizeForLiteralQuote("O protocolo é 2026 0925 4471.")).toBe("o protocolo é 2026 0925 4471.")
  })
})

describe("V1.7.1k — D/E) citação literal sobre a estrutura canônica", () => {
  const verify = (quote: string, presented = V171J_PRESENTED) => verifyKnowledgeQuote({ documentTitle: V171J_DOC_TITLE, quote, presented, published: V171J_PUBLISHED, anchorTexts: [] })
  it("D) lista de perguntas ACHATADA (itens terminando em “?”) confere literalmente", () => {
    expect(verify(CONFIRMATION)).toMatchObject({ literalInPublished: true, failure: null })
    expect(verifyKnowledgeQuote({ documentTitle: V171J_CHECKLIST_TITLE, quote: "Antes de encerrar qualquer chamada: (1) confirme a solução aplicada;", presented: V171J_PRESENTED, published: V171J_PUBLISHED, anchorTexts: [] })).toMatchObject({ documentId: V171J_CHECKLIST_ID, literalInPublished: true, leadIn: "Antes de encerrar qualquer chamada:" })
  })
  it("E) palavra trocada, item pulado no meio ou item inventado continuam NÃO literais", () => {
    expect(verify(CONFIRMATION.replace("ficaram claras", "ficaram evidentes"))).toMatchObject({ failure: "QUOTE_NOT_LITERAL" })
    expect(verify(CONFIRMATION.replace(" - “Ficou alguma dúvida sobre o valor que deve ser pago?”", ""))).toMatchObject({ failure: "QUOTE_NOT_LITERAL" })
    expect(verify(`${CONFIRMATION} - “Quer que eu repita algo?”`)).toMatchObject({ failure: "QUOTE_NOT_LITERAL" })
    expect(verifyKnowledgeQuote({ documentTitle: V171J_CHECKLIST_TITLE, quote: "(2) informe o protocolo;", presented: V171J_PRESENTED, published: V171J_PUBLISHED, anchorTexts: [] })).toMatchObject({ failure: "QUOTE_NOT_LITERAL" })
  })
})

const deviation = { status: "NOT_FOLLOWED", declaredEvidenceType: "OBSERVED", documentTitle: V171J_DOC_TITLE, subject: V171J_SUBJECT, conversation: operatorTurns, operatorConversation: operatorTurns }
const avoidRule = ruleContextOf(V171J_CONTENT, "- “É só aguardar.”", "51. Frases que devem ser evitadas")

describe("V1.7.1k — F/G/H) EVITAR é regra procedimental — só para comportamento proibido observado", () => {
  it("F) formulação proibida dita pelo operador → NÃO cumprida VERIFICADA (sem igualdade total)", () => {
    expect(avoidRule).toMatchObject({ heading: "51. Frases que devem ser evitadas", listKind: "UNORDERED" })
    expect(forbiddenPhrasesOf("“É só aguardar.”")).toEqual(["É só aguardar"])
    expect(structuredAnchorOf({ ...deviation, contentKind: "DO_NOT_CONTENT", rule: avoidRule, citedQuote: "- “É só aguardar.”", operatorEvidence: [{ turnRef: "T17", text: AVOID_TURN }] })).toMatchObject({ anchored: true, basis: "AVOIDED_PHRASE_OBSERVED", proof: { avoidedPhrases: ["É só aguardar"], operatorTurns: ["T17"], processAnchor: "SUBJECT" } })
    // A lista "Evitar:" citada inteira também ancora pela formulação que apareceu.
    const whole = ruleContextOf(V171J_CONTENT, "Evitar:\n\n- “É só aguardar.”\n- “Logo será resolvido.”")
    expect(structuredAnchorOf({ ...deviation, contentKind: "DO_NOT_CONTENT", rule: whole, citedQuote: "Evitar:\n\n- “É só aguardar.”\n- “Logo será resolvido.”", operatorEvidence: [{ turnRef: "T17", text: AVOID_TURN }] })).toMatchObject({ anchored: true, basis: "AVOIDED_PHRASE_OBSERVED" })
    // Fala sem a formulação → não verifica.
    expect(structuredAnchorOf({ ...deviation, contentKind: "DO_NOT_CONTENT", rule: avoidRule, citedQuote: "- “É só aguardar.”", operatorEvidence: [{ turnRef: "T19", text: "Isso varia um pouco, mas pode ficar tranquila que eles dão um retorno." }] })).toMatchObject({ anchored: false, failure: "AVOIDED_CONTENT_NOT_OBSERVED" })
    // Termos em comum NÃO bastam para "evitar" (a âncora léxica não vale para esse conteúdo).
    expect(verifyKnowledgeQuote({ documentTitle: V171J_DOC_TITLE, quote: "- “Não posso fazer nada.”", presented: V171J_PRESENTED, published: V171J_PUBLISHED, anchorTexts: ["Eu posso fazer isso agora, nada demais."] })).toMatchObject({ contentKind: "DO_NOT_CONTENT", applicability: "LITERAL_ONLY", applicabilityBasis: null })
  })
  it("G) EVITAR nunca sustenta etapa CUMPRIDA", () => {
    expect(structuredAnchorOf({ ...deviation, status: "FOLLOWED", contentKind: "DO_NOT_CONTENT", rule: avoidRule, citedQuote: "- “É só aguardar.”", operatorEvidence: [{ turnRef: "T19", text: "Isso varia um pouco." }] })).toMatchObject({ anchored: false, failure: "AVOID_CANNOT_SUPPORT_FOLLOWED" })
    const assessment = { processes: [{ documentTitle: V171J_DOC_TITLE, checkpoints: [{ requirement: "Evitou dizer É só aguardar", status: "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: ["Operador: Isso varia um pouco, mas pode ficar tranquila que eles dão um retorno."], knowledgeQuote: "- “É só aguardar.”", knowledgeDetailQuote: null, guidance: { source: "OFFICIAL_PROCEDURE", text: null }, uncertainty: null }] }] }
    const verified = verifyProcessAssessments({ sources: [{ sourceRef: "S", assessment: assessment as never, presented: V171J_PRESENTED }], interactionId: "i", transcript: V171J_TRANSCRIPT, published: V171J_PUBLISHED, subject: V171J_SUBJECT })
    expect(verified.checkpoints[0]!.knowledge).toMatchObject({ applicability: "LITERAL_ONLY", structuredAnchor: { failure: "AVOID_CANNOT_SUPPORT_FOLLOWED" } })
  })
  it("H) RULE e AVOID ficam com papéis separados (segmentos e texto)", () => {
    expect(new Set(segmentKnowledgeQuote(V171J_CONTENT, "Evitar:\n\n- “É só aguardar.”").map((segment) => segment.role))).toEqual(new Set(["AVOID"]))
    expect(segmentKnowledgeQuote(V171J_CONTENT, "O operador deverá informar o prazo exibido na ferramenta.").map((segment) => segment.role)).toEqual(["RULE"])
  })
})

describe("V1.7.1k — I/J/K) item condicional com evidência; ação × estado", () => {
  it("I) “serviço cancelado, quando aplicável” dito na recapitulação → OBSERVADO e condicional; sem evidência → CONDITIONAL", () => {
    const completeness = assessCompleteness({ quote: RECAP, evidence: [{ turnRef: "T21", text: RECAP_TURN }], operatorConversation: operatorTurns, windowComplete: true })!
    expect(completeness.status).toBe("PARTIAL")
    expect(completeness.items.find((item) => item.text.startsWith("serviço cancelado"))).toMatchObject({ status: "OBSERVED", conditional: true, agency: "STATE_ONLY", observedTurns: ["T21"] })
    expect(completeness.items.find((item) => item.text === "valor")).toMatchObject({ status: "OBSERVED" })
    const withoutCancellation = assessCompleteness({ quote: RECAP, evidence: [{ turnRef: "T21", text: "Recapitulando: a contestação das cobranças de R$ 12,90 está aberta e o seu protocolo é 2026 0925 4471." }], operatorConversation: ["Recapitulando: a contestação das cobranças de R$ 12,90 está aberta e o seu protocolo é 2026 0925 4471."], windowComplete: true })!
    expect(withoutCancellation.items.find((item) => item.text.startsWith("serviço cancelado"))).toMatchObject({ status: "CONDITIONAL", conditional: true })
  })
  it("J) ativa, passiva e particípio representam o mesmo estado — só com o objeto na fala", () => {
    expect(cancellationEvidenceOf("Já desativei a renovação dela aqui.")).toMatchObject({ observed: true, agency: "OPERATOR_ACTION" })
    expect(cancellationEvidenceOf("Eu já tirei a renovação.")).toMatchObject({ observed: true, agency: "OPERATOR_ACTION" })
    expect(cancellationEvidenceOf("A renovação foi desativada.")).toMatchObject({ observed: true, agency: "STATE_ONLY" })
    expect(cancellationEvidenceOf("a renovação do pacote já foi tirada")).toMatchObject({ observed: true, agency: "STATE_ONLY" })
    expect(cancellationEvidenceOf("A assinatura ficou desativada.")).toMatchObject({ observed: true, agency: "STATE_ONLY" })
    // Particípio de outra ação ou sem o objeto: nada.
    expect(cancellationEvidenceOf("Ele foi ativado pelo aplicativo no dia 14 de julho.")).toMatchObject({ observed: false, agency: null })
    expect(cancellationEvidenceOf("Ele foi cancelado no sistema da loja.")).toMatchObject({ observed: false })
  })
  it("K) estado descrito ≠ ação do operador quando não é provável", () => {
    const step = stepActionOf("1. Cancelar a recorrência, quando permitido;")
    expect(actionRelationOf(step, ["A renovação foi desativada."])).toMatchObject({ related: true, verbForms: [], stateForms: ["desativada"], agency: "STATE_ONLY" })
    expect(actionRelationOf(step, ["Desativei a renovação."])).toMatchObject({ related: true, agency: "OPERATOR_ACTION" })
    // Na etapa, o estado sozinho é declaração (nunca "ação observada").
    const assessment = { processes: [{ documentTitle: V171J_DOC_TITLE, checkpoints: [{ requirement: "Cancelar a recorrência", status: "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: ["Operador: A renovação já foi tirada, a partir de agora não entra mais na sua fatura."], knowledgeQuote: "1. Cancelar a recorrência, quando permitido;", knowledgeDetailQuote: null, guidance: { source: "OFFICIAL_PROCEDURE", text: null }, uncertainty: null }] }] }
    const transcript = `${V171J_TRANSCRIPT}\nOperador: A renovação já foi tirada, a partir de agora não entra mais na sua fatura.`
    const verified = verifyProcessAssessments({ sources: [{ sourceRef: "S", assessment: assessment as never, presented: V171J_PRESENTED }], interactionId: "i", transcript, published: V171J_PUBLISHED, subject: V171J_SUBJECT })
    expect(verified.checkpoints[0]).toMatchObject({ status: "FOLLOWED", evidenceType: "OBSERVED_DECLARATION", knowledge: { applicability: "VERIFIED", structuredAnchor: { basis: "CHECKPOINT_SELECTION", proof: { actionRelation: { agency: "STATE_ONLY" } } } } })
  })
})

describe("V1.7.1k — L) lista “Verificar:”: itens da fala são observados; o resto não manda a lista ao QA", () => {
  const verifyList = "Verificar:\n\n- Nome do serviço;\n- Valor;\n- Data de ativação;\n- Canal de contratação;\n- Recorrência;\n- Histórico de confirmação;\n- Linha em que foi ativado;\n- Cobranças anteriores."
  const run = (speech: string) => {
    const assessment = { processes: [{ documentTitle: V171J_DOC_TITLE, checkpoints: [{ requirement: "Verificar o serviço", status: "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: [`Operador: ${speech}`], knowledgeQuote: verifyList, knowledgeDetailQuote: null, guidance: { source: "OFFICIAL_PROCEDURE", text: null }, uncertainty: null }] }] }
    const presented = [...V171J_PRESENTED, { documentId: V171J_PRESENTED[0]!.documentId, documentTitle: V171J_DOC_TITLE, heading: "15. Serviços digitais não reconhecidos", excerpt: verifyList, chunkIndex: 26 }]
    return verifyProcessAssessments({ sources: [{ sourceRef: "S", assessment: assessment as never, presented }], interactionId: "i", transcript: `${V171J_TRANSCRIPT}\nOperador: ${speech}`, published: V171J_PUBLISHED, subject: V171J_SUBJECT }).checkpoints[0]!
  }
  it("≥ 2 itens reconhecidos por detector tipado ancoram a etapa; completude continua DESCONHECIDA e fora do histórico", () => {
    const checkpoint = run("Encontrei: é um pacote de R$ 12,90 por mês, ativado pelo aplicativo no dia 14 de julho, e aparece nas contas de agosto e de setembro.")
    expect(checkpoint).toMatchObject({ status: "FOLLOWED", completeness: { status: "UNKNOWN", family: "VERIFY" }, knowledge: { applicability: "VERIFIED", structuredAnchor: { basis: "COMPOSITE_ITEMS_OBSERVED" } } })
    expect(checkpoint.completeness!.items.filter((item) => item.status === "OBSERVED").map((item) => item.text)).toEqual(expect.arrayContaining(["valor", "data de ativação", "recorrência", "cobranças anteriores"]))
    expect(isObservationEligibleForAnalytics({ status: "FOLLOWED", completeness: "UNKNOWN", analyticsStatus: checkpointReadinessOf(checkpoint).status })).toBe(false)
    expect(observationsFrom("op", [{ interactionId: "i", assessment: { version: "PROCESS_ASSESSMENT_VERIFICATION_V1" as never, processes: [], checkpoints: [checkpoint], summary: {} as never } }]).some((observation) => observation.status === "FOLLOWED")).toBe(false)
  })
  it("um item só (ou nenhum) não ancora: continua só literal (QA)", () => {
    expect(run("Achei aqui o pacote de R$ 12,90.")).toMatchObject({ knowledge: { applicability: "LITERAL_ONLY" } })
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// M/N — replay do smoke REAL da V1.7.1j
// ---------------------------------------------------------------------------------------------------------------------

/** O redator real respondeu por slot (ordem dos itens daquela execução): mapeia pelo requisito. */
const SLOTS: [RegExp, number][] = [[/^Explicar prazo/i, 0], [/aguardar/i, 1], [/próximo passo/i, 2], [/Cancelar/i, 3], [/Registrar/i, 4], [/alguma dúvida/i, 5], [/solução aplicada/i, 6], [/protocolo/i, 7]]
function writer(): ReliableFeedbackWriterPort {
  return {
    writeMonitoring: async (input) => ({ rawOutput: { items: input.items.flatMap((item) => { const hit = SLOTS.find(([pattern]) => pattern.test(item.requirement ?? "")); return hit ? [{ ...V171J_WRITER_RAW.items[hit[1]]!, slot: item.slot }] : [] }), presentation: V171J_WRITER_RAW.presentation } }),
    writeIndicator: async () => { throw new Error("não usado") },
  }
}
async function replay() {
  const store = createInMemoryReliableFeedbackStore({ onReactivate: () => true })
  const deps: ReliableGenerationDeps = {
    enabled: true, store, writer: writer(), policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async () => ({ transcript: V171J_TRANSCRIPT, label: `Atendimento de 25/09/2026 · ${V171J_SUBJECT}`, otherOperatorNames: V171J_OTHER_OPERATOR_NAMES, subjectOperatorName: V171J_COLLABORATOR_NAME }),
    loadIndicatorContext: async () => null, loadPublishedKnowledge: async () => V171J_PUBLISHED, loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }), resolveDiagnosticStrategy: async () => null,
    loadRecipient: async () => ({ firstName: "Larissa" }), now: () => new Date("2026-09-25T23:03:00Z"),
  }
  const source = { kind: "monitoring", knowledgeExcerpts: V171J_PRESENTED, input: { organizationId: "org-k", operatorId: "op-k", interactionId: "int-k", structured: { evidenceFound: "x", observedBehavior: "o", relatedProcedure: V171J_DOC_TITLE, recommendation: "r", processAssessment: JSON.parse(JSON.stringify(V171J_ASSESSMENT)) } } }
  const request: ReliableGenerationRequest = { organizationId: "org-k", enrollmentId: "enr-k", workflowId: "wf", workflowVersionId: "v1", nodeId: "gerar", sourceNodeId: "orq", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: "op-k", interactionId: "int-k", indicatorMeasurementId: null, configuredAgentId: null }
  const result = await generateReliableFeedback(deps, request)
  const artifact = result.record.artifact!
  const byStep = (pattern: RegExp) => artifact.items.find((item) => pattern.test(item.process?.requirement ?? ""))!
  const text = nodeOutputOf(result.record.id, artifact, artifact.items.map((item) => ({ itemIndex: item.index, status: "APPROVED_UNCHANGED" as const, finalWording: null }))).text
  return { store, artifact, byStep, text }
}
const verified = () => verifyProcessAssessments({ sources: [{ sourceRef: "S", assessment: JSON.parse(JSON.stringify(V171J_ASSESSMENT)), presented: V171J_PRESENTED }], interactionId: "int-k", transcript: V171J_TRANSCRIPT, published: V171J_PUBLISHED, subject: V171J_SUBJECT })

describe("V1.7.1k — M) replay do smoke REAL da V1.7.1j (A–I)", () => {
  it("checklist, evitar, confirmação, condicional, recapitulação e valor", async () => {
    const { artifact, byStep, text } = await replay()
    // Antes: 5 prontos / 4 em QA / 1 bloqueado. Agora: 9 prontos, 1 em QA (a confirmação que o redator real nunca recebeu — estava
    // bloqueada no smoke —, com o texto de segurança conservador), 0 bloqueados.
    // V1.7.1m — fontes do MESMO comportamento convergem: "explique o próximo passo e o prazo" reforça "Explicar prazo" e o "(4)
    // confirme se o cliente tem mais alguma dúvida" reforça a confirmação de entendimento (10 fontes → 8 comportamentos).
    expect(artifact.findings).toMatchObject({ detected: 8, reliable: 8, blocked: 0, inFeedback: 7, heldForQa: 1, collapsedDuplicates: 2 })
    // A/B/C — checklist em linha reconhecido: nenhum item vai ao QA por NOT_A_LIST_STEP.
    expect(byStep(/número do protocolo/)).toMatchObject({ knowledge: { applicability: "VERIFIED", structuredAnchorBasis: "CHECKPOINT_SELECTION", step: "informe o número do protocolo;" }, decision: { disposition: "READY" } })
    expect(byStep(/solução aplicada/)).toMatchObject({ knowledge: { applicability: "VERIFIED", structuredAnchorBasis: "CHECKPOINT_SELECTION" }, wordingSource: "FALLBACK", decision: { disposition: "READY", reasons: ["AUTONOMY_CRITERIA_MET", "VERIFIED_SPECIFIC_FALLBACK"] } })
    expect(byStep(/solução aplicada/).proposedWording!.observed).toBe("Você confirmou a solução aplicada.")
    expect(byStep(/próximo passo/)).toBeUndefined()
    expect(byStep(/^Explicar prazo/)!.process!.behavior).toMatchObject({ code: "INFORM_DEADLINE", sources: [{ role: "SUPPORTING", quote: "explique o próximo passo e o prazo;", addsFacets: ["NEXT_STEP"] }] })
    // D — "é só aguardar" verificado como comportamento inadequado observado (seção 51, a APRESENTADA ao especialista).
    expect(byStep(/aguardar/)).toMatchObject({ section: "OPPORTUNITY", knowledge: { applicability: "VERIFIED", structuredAnchorBasis: "AVOIDED_PHRASE_OBSERVED", contentKind: "DO_NOT_CONTENT", heading: "51. Frases que devem ser evitadas" }, decision: { disposition: "READY" } })
    // E — confirmação de entendimento: a lista achatada confere (nada de QUOTE_NOT_LITERAL); a âncora léxica verifica.
    expect(byStep(/Confirmação de entendimento/)).toMatchObject({ knowledge: { applicability: "VERIFIED" }, wordingSource: "FALLBACK", decision: { disposition: "HOLD_FOR_QA", reasons: ["WRITER_FALLBACK_USED", "WRITER_VALIDATION_FAILED"] } })
    // F/G/H — recapitulação parcial; serviço cancelado observado (condicional); valor observado.
    const recap = byStep(/Recapitula/)
    expect(recap).toMatchObject({ wordingSource: "SYSTEM", process: { completeness: { status: "PARTIAL", observed: ["lançamento contestado", "valor", "ação realizada", "serviço cancelado, quando aplicável", "protocolo"], absent: ["prazo", "canal de retorno"] } } })
    expect(recap.proposedWording!.observed).toBe("Em “Recapitulação obrigatória”, você fez parte do que o procedimento prevê, incluindo “Lançamento contestado”, “Valor”, “Ação realizada”, “Serviço cancelado” e “Protocolo”, mas não todos os itens previstos. Nesta chamada não apareceram “Prazo” e “Canal de retorno”. “Conta ajustada” e “Valor a pagar” não se aplicavam neste momento, porque o resultado ainda estava pendente.")
    // I — nenhuma ausência falsa nova; exemplo da base nunca como fato.
    expect(text).not.toMatch(/não apareceram[^.]*(?:Serviço cancelado|Valor”(?! a pagar))/)
    expect(text).not.toMatch(/SMS/)
    for (const line of text.split("\n").filter((entry) => entry.startsWith("**Como aplicar:**") || entry.startsWith("**Para manter:**"))) expect(line).not.toMatch(/cinco dias|5 dias/)
    expect(text.split("\n").filter((entry) => /cinco dias/.test(entry)).every((entry) => entry.startsWith("_Exemplo do procedimento (ilustrativo):_"))).toBe(true)
    // RULE e AVOID em papéis separados: a regra no "O processo orienta", a formulação em "O procedimento pede evitar".
    const avoidBlock = text.slice(text.indexOf("### Frases que devem ser evitadas"), text.indexOf("### Recapitulação"))
    expect(avoidBlock).toContain("**O procedimento pede evitar**\n\n> “É só aguardar.”")
    expect(avoidBlock.slice(avoidBlock.indexOf("**O processo orienta**"), avoidBlock.indexOf("**O procedimento pede evitar**"))).not.toContain("É só aguardar")
    // Abertura não se repete quando a citação já começa por ela.
    expect(text).not.toContain("Antes de encerrar qualquer chamada: … Antes de encerrar qualquer chamada:")
  })
})

describe("V1.7.1k — N) prontidão analítica continua conservadora", () => {
  it("só vira VERIFIED o que ganhou prova; o resto continua fora", () => {
    const assessment = verified()
    const observations = observationsFrom("op-k", [{ interactionId: "int-k", assessment }])
    const summary = observations.map((observation) => [observation.requirement.slice(0, 40), observation.status, observation.completeness, observation.analyticsStatus])
    expect(summary).toEqual(expect.arrayContaining([
      ["Cancelar a recorrência, quando permitido", "FOLLOWED", null, "VERIFIED"],
      ["Evitar a frase É só aguardar", "NOT_FOLLOWED", null, "VERIFIED"],
      ["Recapitulação obrigatória informando pra", "NOT_FOLLOWED", "PARTIAL", "VERIFIED"],
      ["Confirmação de entendimento", "FOLLOWED", null, "VERIFIED"],
      ["informe o número do protocolo", "FOLLOWED", null, "VERIFIED"],
    ]))
    // V1.7.1m — uma observação por atendimento × comportamento (as fontes que reforçam vão como linhagem).
    expect(observations).toHaveLength(8)
    // Nenhuma etapa cumprida com completude não provada; nada promovido sem âncora.
    expect(observations.some((observation) => observation.status === "FOLLOWED" && observation.completeness && observation.completeness !== "COMPLETE")).toBe(false)
    for (const checkpoint of assessment.checkpoints) {
      const readiness = checkpointReadinessOf(checkpoint)
      expect(readiness.status === "VERIFIED").toBe(checkpoint.knowledge?.applicability === "VERIFIED" && checkpoint.knowledge.contentKind !== "EXAMPLE_CONTENT")
    }
  })
  it("§15 — visão analítica da recapitulação: serviço cancelado foi INFORMADO; só o comprovadamente ausente é 'não informado'", () => {
    const recap = observationsFrom("op-k", [{ interactionId: "int-k", assessment: verified() }]).find((observation) => /Recapitula/.test(observation.requirement))!
    expect(recap.subItems).toEqual(expect.arrayContaining([{ text: "serviço cancelado, quando aplicável", status: "OBSERVED", conditional: true, agency: "STATE_ONLY" }, { text: "valor", status: "OBSERVED" }]))
    const facts = compositeFactsOf(recap.subItems)
    expect(facts.informed).toEqual(expect.arrayContaining(["serviço cancelado, quando aplicável", "valor", "protocolo", "conta analisada"]))
    expect(facts.notInformed).toEqual(["prazo", "canal de retorno"])
    expect(facts.notInformed).not.toContain("serviço cancelado, quando aplicável")
  })
})

describe("V1.7.1k — §12) texto de segurança específico e validado não manda sozinho o item ao QA", () => {
  // O item emitido carrega campos a mais (texto, decisão); a decisão só lê os campos do rascunho.
  const item = async () => ({ ...(await replay()).byStep(/solução aplicada/), analysis: null }) as never as Parameters<typeof decideReliableItem>[0]
  const outcome = (overrides: Partial<ReliableWriterOutcome>): ReliableWriterOutcome => ({ invoked: true, writerError: null, source: "FALLBACK", violations: ["GENERIC_WORDING"], wording: { observed: "Você confirmou a solução aplicada.", whyItMatters: "", whatYouCanDo: "" }, claimModes: { effect: "POTENTIAL_ONLY", action: "DECLARED_ONLY" }, fallbackCheck: { specific: true, violations: [] }, ...overrides })
  it("só copy genérica + fallback específico/validado + regra e evidência verificadas → READY", async () => {
    const draft = await item()
    expect(isVerifiedSpecificFallback(draft, outcome({}))).toBe(true)
    expect(decideReliableItem(draft, outcome({}), RELIABLE_FEEDBACK_AUTONOMOUS_POLICY)).toMatchObject({ disposition: "READY", reasons: ["AUTONOMY_CRITERIA_MET", "VERIFIED_SPECIFIC_FALLBACK"] })
  })
  it("núcleo inválido por outro motivo, item ausente, fallback conservador, fallback inválido ou regra não verificada → QA", async () => {
    const draft = await item()
    for (const bad of [outcome({ violations: ["EVIDENCE_ALTERATION"] }), outcome({ violations: ["SCHEMA"] }), outcome({ fallbackCheck: { specific: false, violations: [] } }), outcome({ fallbackCheck: { specific: true, violations: ["GENERIC_WORDING"] } }), outcome({ writerError: "WRITER_TIMEOUT" })]) {
      expect(decideReliableItem(draft, bad, RELIABLE_FEEDBACK_AUTONOMOUS_POLICY).disposition).toBe("HOLD_FOR_QA")
    }
    expect(decideReliableItem({ ...draft, knowledge: { ...draft.knowledge!, applicability: "LITERAL_ONLY" } }, outcome({}), RELIABLE_FEEDBACK_AUTONOMOUS_POLICY)).toMatchObject({ disposition: "HOLD_FOR_QA", reasons: expect.arrayContaining(["WRITER_FALLBACK_USED", "KNOWLEDGE_APPLICABILITY_UNVERIFIED"]) })
  })
})

describe("V1.7.1k — §16) QA técnico: completude e prontidão analítica nos detalhes recolhidos", () => {
  it("a recapitulação mostra a completude e a prontidão; a confirmação pendente também", async () => {
    const { store, artifact } = await replay()
    const review = store.reviews[0]!
    const context = { collaborator: { id: "op-k", name: "Larissa Monteiro", jobTitle: null }, team: null, occurredAt: null, createdAt: new Date("2026-09-25T23:04:00Z"), reviewerName: null, selection: { decision: artifact.items.find((entry) => entry.index === review.itemIndex)!.decision, deliveredAt: null } } as never
    const detail = toReliableReviewDetail(review, context, { artifact, reviews: store.reviews })
    const recap = detail.feedbackPreview!.items.find((entry) => /Recapitula/.test(entry.technical.internalStep ?? ""))!
    expect(recap.technical.completeness).toMatchObject({ statusLabel: "Parcial" })
    expect(recap.technical.completeness!.groups.find((group) => group.label === "Observado na etapa")!.items).toContain("serviço cancelado, quando aplicável")
    expect(recap.technical.analyticReadiness).toEqual({ statusLabel: "Verificada", reasons: [], eligibleLabel: "Entra no histórico analítico" })
    const confirmation = detail.feedbackPreview!.items.find((entry) => /Confirmação de entendimento/.test(entry.technical.internalStep ?? ""))!
    expect(confirmation.technical.analyticReadiness).toMatchObject({ statusLabel: "Verificada" })
  })
})
