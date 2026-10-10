import { describe, expect, it } from "vitest"
import { normalizeForLiteralQuote } from "../../knowledge/domain/knowledge-match.js"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY } from "../domain/reliable-feedback-item.js"
import { emittedItems, nodeOutputOf } from "../domain/reliable-feedback-artifact.js"
import { verifyKnowledgeQuote } from "../domain/process-assessment.js"
import { structuredAnchorOf } from "../domain/structured-anchor.js"
import { behaviorWordingOf } from "../domain/behavior-presentation.js"
import { ruleContextOf } from "../domain/verified-omission.js"
import { detectUnsupportedEffectClaims } from "../domain/effect-claims.js"
import { validateMonitoringWording, type MonitoringWriterInput } from "../domain/reliable-writer.js"
import { presentationViolations } from "../domain/feedback-presentation.js"
import { V171E_ASSESSMENT, V171E_CONTENT, V171E_DOC_TITLE, V171E_PRESENTED, V171E_PUBLISHED, V171E_TRANSCRIPT, V171E_WRITER_RAW } from "../testing/contestacao-v171e-smoke-fixture.js"

/**
 * V1.7.1f — FINAL MONITORING HARDENING, a partir do smoke REAL da V1.7.1e (saída do especialista e do redator gravadas, sem
 * modelo): citação de lista achatada, comportamento a partir de item de lista, âncora ESTRUTURADA da regra, fato que só existe
 * em EXEMPLO e precisão da guarda de efeito garantido. Nada da confiabilidade é afrouxado.
 */
const RECAP_FLAT = "Antes de encerrar, informar: Conta analisada; Lançamento contestado; Valor; Ação realizada; Serviço cancelado, quando aplicável; Conta ajustada; Valor a pagar; Prazo; Canal de retorno; Protocolo."
const verify = (quote: string, anchorTexts: string[] = []) => verifyKnowledgeQuote({ documentTitle: V171E_DOC_TITLE, quote, presented: V171E_PRESENTED, published: V171E_PUBLISHED, anchorTexts })
const SUBJECT = "Contestação de cobrança"
const conversation = V171E_TRANSCRIPT.split("\n").map((line) => line.replace(/^(?:Operador|Cliente):\s*/, ""))

/** Redator falso = a resposta REAL do smoke, entregue pelo conteúdo do item (a ordem dos slots pode mudar com mais itens). */
function smokeWriter(captured: MonitoringWriterInput[] = []): ReliableFeedbackWriterPort {
  return {
    writeMonitoring: async (input) => {
      captured.push(input)
      const items = input.items.flatMap((item) => {
        const original = /prazo/i.test(item.requirement ?? "") ? V171E_WRITER_RAW.items[0] : /explique/i.test(item.requirement ?? "") ? V171E_WRITER_RAW.items[1] : /cancelar/i.test(item.requirement ?? "") ? V171E_WRITER_RAW.items[2] : null
        return original ? [{ ...original, slot: item.slot }] : []
      })
      return { rawOutput: { items, presentation: V171E_WRITER_RAW.presentation } }
    },
    writeIndicator: async () => { throw new Error("não usado") },
  }
}
async function replay(captured: MonitoringWriterInput[] = []) {
  const store = createInMemoryReliableFeedbackStore({ onReactivate: () => true })
  const deps: ReliableGenerationDeps = {
    enabled: true, store, writer: smokeWriter(captured), policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async () => ({ transcript: V171E_TRANSCRIPT, label: `Atendimento de 25/09/2026 · ${SUBJECT}`, otherOperatorNames: [] }),
    loadIndicatorContext: async () => null, loadPublishedKnowledge: async () => V171E_PUBLISHED, loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }), resolveDiagnosticStrategy: async () => null,
    loadRecipient: async () => ({ firstName: "Larissa" }), now: () => new Date("2026-09-25T20:42:00Z"),
  }
  const source = { kind: "monitoring", knowledgeExcerpts: V171E_PRESENTED, input: { organizationId: "org-f", operatorId: "op-f", interactionId: "int-f", structured: { evidenceFound: "x", observedBehavior: "o", relatedProcedure: V171E_DOC_TITLE, recommendation: "r", processAssessment: JSON.parse(JSON.stringify(V171E_ASSESSMENT)) } } }
  const request: ReliableGenerationRequest = { organizationId: "org-f", enrollmentId: "enr-v171e", workflowId: "wf", workflowVersionId: "v", nodeId: "gerar", sourceNodeId: "orq", sourceType: "ORCHESTRATOR", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: "op-f", interactionId: "int-f", indicatorMeasurementId: null, configuredAgentId: null }
  // O nó do Orquestrador entrega a avaliação do especialista; aqui a fonte é a mesma avaliação (Agent), sem modelo.
  const result = await generateReliableFeedback(deps, { ...request, sourceType: "AGENT" })
  const artifact = result.record.artifact!
  const byStep = (pattern: RegExp) => artifact.items.find((item) => pattern.test(item.process?.requirement ?? ""))!
  const approved = nodeOutputOf(result.record.id, artifact, artifact.items.map((item) => ({ itemIndex: item.index, status: "APPROVED_UNCHANGED" as const, finalWording: null })))
  return { result, artifact, byStep, text: approved.text }
}

describe("V1.7.1f — A/B) citação literal de LISTA: formatação tolerada, palavra nunca", () => {
  it("A) a mesma lista com marcadores, sem marcadores (achatada) ou com outro espaçamento é literal", () => {
    const bulleted = "Antes de encerrar, informar:\n\n- Conta analisada;\n- Lançamento contestado;\n- Valor;"
    const flat = "Antes de encerrar, informar: Conta analisada; Lançamento contestado; Valor;"
    expect(normalizeForLiteralQuote(bulleted)).toBe(normalizeForLiteralQuote(flat))
    expect(normalizeForLiteralQuote("Se o cliente não reconhecer: 1. Cancelar a recorrência")).toBe(normalizeForLiteralQuote("Se o cliente não reconhecer:\n\n1. Cancelar a recorrência"))
    expect(normalizeForLiteralQuote("- [ ] Recapitulei as ações?")).toBe(normalizeForLiteralQuote("Recapitulei   as ações?"))
    // O caso REAL: a recapitulação citada achatada pelo especialista agora é literal (antes QUOTE_NOT_LITERAL).
    expect(verify(RECAP_FLAT)).toMatchObject({ literalInPublished: true, presentedInRun: true, failure: null, heading: "46. Recapitulação obrigatória" })
    expect(verify(bulleted.replace("Valor;", "Valor"))).toMatchObject({ literalInPublished: true, failure: null })
  })
  it("B) palavra alterada, item pulado ou paráfrase continuam NÃO literais", () => {
    expect(verify(RECAP_FLAT.replace("Conta analisada", "Fatura analisada"))).toMatchObject({ failure: "QUOTE_NOT_LITERAL", applicability: "NOT_VERIFIED" })
    expect(verify(RECAP_FLAT.replace(" Lançamento contestado;", ""))).toMatchObject({ failure: "QUOTE_NOT_LITERAL" })
    expect(verify("Antes de encerrar, recapitular a conta, o valor e o protocolo.")).toMatchObject({ failure: "QUOTE_NOT_LITERAL" })
    // Hífen DENTRO da palavra não é marcador de lista: "e-mail" ≠ "e mail".
    expect(normalizeForLiteralQuote("envio por e-mail")).not.toBe(normalizeForLiteralQuote("envio por e mail"))
  })
})

describe("V1.7.1f — C) comportamento a partir de item de lista (sem o nome cru da etapa, sem inventar ação)", () => {
  const knowledge = { quote: "Se a conta já foi paga;", heading: "6. Escuta e identificação da solicitação", leadIn: "O operador deverá permitir que o cliente explique:", contentKind: "RULE_CONTENT" }
  it("item citado sozinho + frase de abertura da lista + pergunta do operador → comportamento concreto", () => {
    const wording = behaviorWordingOf({ section: "STRENGTH", process: { stepTitle: "Se a conta já foi paga", evidenceType: "OBSERVED_ACTION" }, knowledge }, ["Me conta: qual fatura você está contestando e o que foi que veio diferente?", "Você chegou a pagar essa fatura já?"], true)
    expect(wording).toEqual({ observed: "Você perguntou ao cliente se a conta já foi paga.", whatYouCanDo: "Continue permitindo que o cliente explique se a conta já foi paga." })
  })
  it("sem pergunta que sustente o item → nenhuma frase de comportamento (formulação conservadora de quem chama)", () => {
    expect(behaviorWordingOf({ section: "STRENGTH", process: { stepTitle: "Se a conta já foi paga", evidenceType: "OBSERVED_ACTION" }, knowledge }, ["Vou verificar aqui no sistema."], true).observed).toBeNull()
    expect(behaviorWordingOf({ section: "STRENGTH", process: { stepTitle: "Se a conta já foi paga", evidenceType: "OBSERVED_ACTION" }, knowledge }, ["Qual o seu endereço?"], true).observed).toBeNull()
  })
  it("lista achatada com circunstância: 'Como aplicar' diz quando e o quê, literal da regra", () => {
    const wording = behaviorWordingOf({ section: "OPPORTUNITY", process: { stepTitle: "Recapitulação obrigatória", evidenceType: "VERIFIED_OMISSION" }, knowledge: { quote: RECAP_FLAT, heading: "46. Recapitulação obrigatória", contentKind: "RULE_CONTENT" } }, ["Anota o protocolo, por favor."], true)
    expect(wording.whatYouCanDo).toBe("Na próxima chamada, antes de encerrar, informe: conta analisada, lançamento contestado, valor, ação realizada, serviço cancelado, quando aplicável, conta ajustada, valor a pagar, prazo, canal de retorno e protocolo.")
    // Omissão NÃO verificada nunca lista o que "faltou" (parte pode ter acontecido).
    expect(behaviorWordingOf({ section: "OPPORTUNITY", process: { stepTitle: "Recapitulação obrigatória", evidenceType: "UNVERIFIED_OMISSION" }, knowledge: { quote: RECAP_FLAT, heading: "46. Recapitulação obrigatória", contentKind: "RULE_CONTENT" } }, [], true).observed).toBeNull()
  })
})

describe("V1.7.1f — D/E) âncora ESTRUTURADA da regra (prova pelo código, nunca pela palavra do modelo)", () => {
  const cancelRule = ruleContextOf(V171E_CONTENT, "Cancelar a recorrência, quando permitido;")
  const registerRule = ruleContextOf(V171E_CONTENT, "Registrar contestação;")
  const cancelSpeech = [{ turnRef: "T15", text: "Dá pra eu cancelar essa assinatura agora pra não cobrar de novo. Você quer que eu cancele?" }, { turnRef: "T17", text: "Prontinho, cancelei a assinatura aqui." }]
  const base = { status: "FOLLOWED", contentKind: "RULE_CONTENT", documentTitle: V171E_DOC_TITLE, subject: SUBJECT, conversation }

  it("D) mesma ação com outras palavras ('cancelei a assinatura' × 'Cancelar a recorrência') → VERIFIED pela estrutura; a âncora léxica sozinha não bastava", () => {
    expect(verify("Cancelar a recorrência, quando permitido;", cancelSpeech.map((unit) => unit.text))).toMatchObject({ applicability: "LITERAL_ONLY", anchorTerms: ["cance"] })
    expect(structuredAnchorOf({ ...base, rule: cancelRule, operatorEvidence: cancelSpeech })).toMatchObject({ anchored: true, basis: "ACTION_STEP", proof: { processAnchor: "SUBJECT", actionStem: "cancel", operatorTurns: ["T15", "T17"], actionRelation: { family: "CANCEL", stepObjects: ["RECURRENCE"], objectClasses: ["RECURRENCE"], related: true } } })
    const askRule = ruleContextOf(V171E_CONTENT, "Se a conta já foi paga;")
    expect(structuredAnchorOf({ ...base, rule: askRule, operatorEvidence: [{ turnRef: "T11", text: "Você chegou a pagar essa fatura já?" }] })).toMatchObject({ anchored: true, basis: "ASKED_ITEM", proof: { itemTerms: ["paga"] } })
  })
  it("E) regra de OUTRA etapa (a fala traz a ação de outra etapa da lista) → não verifica", () => {
    // V1.7.1g — a escolha da etapa canônica vale sem o mesmo verbo, mas nunca quando a fala mostra a ação de OUTRA etapa.
    // V1.7.1i — a fala trata de OUTRO objeto (assinatura) que o da etapa (contestação): recusada antes mesmo da checagem de outra etapa.
    expect(structuredAnchorOf({ ...base, rule: registerRule, operatorEvidence: cancelSpeech })).toMatchObject({ anchored: false, failure: "OBJECT_MISMATCH", proof: { actionRelation: { mismatchedObjects: ["RECURRENCE"] } } })
  })
  it("E) mesmo documento, seção NÃO relacionada (a fala trata de outro objeto) → não verifica", () => {
    const content = `${V171E_CONTENT}\n\n## 20. Portabilidade numérica\n\nSe o cliente pedir a portabilidade:\n\n1. Cancelar a portabilidade pendente;\n2. Registrar o pedido.`
    const rule = ruleContextOf(content, "Cancelar a portabilidade pendente;")
    expect(structuredAnchorOf({ ...base, rule, operatorEvidence: cancelSpeech })).toMatchObject({ anchored: false, failure: "OBJECT_MISMATCH" })
  })
  it("E) sem processo aplicável, etapa não cumprida ou trecho de exemplo → não verifica", () => {
    expect(structuredAnchorOf({ ...base, subject: "Troca de chip", conversation: ["Oi, quero trocar o chip."], rule: cancelRule, operatorEvidence: cancelSpeech })).toMatchObject({ anchored: false, failure: "PROCESS_NOT_APPLICABLE" })
    // V1.7.1g — etapa não cumprida agora tem caminho próprio, mas a fala do operador usa o termo da própria etapa (cancelei):
    // pode ter sido cumprida — não verifica; etapa condicional ("quando permitido") também não.
    expect(structuredAnchorOf({ ...base, status: "NOT_FOLLOWED", rule: cancelRule, operatorEvidence: cancelSpeech })).toMatchObject({ anchored: false, failure: "CONDITIONAL_STEP" })
    expect(structuredAnchorOf({ ...base, contentKind: "EXAMPLE_CONTENT", rule: cancelRule, operatorEvidence: cancelSpeech })).toMatchObject({ anchored: false, failure: "NOT_RULE_CONTENT" })
  })
})

describe("V1.7.1f — F) fato que só existe em EXEMPLO nunca vira fato (redator, campos e apresentação)", () => {
  it("o exemplo de condução e o 'como aplicar' com 'SMS' (só na fala-modelo da seção 35) são recusados; 'cinco dias úteis' da REGRA de referência não", async () => {
    const captured: MonitoringWriterInput[] = []
    const { byStep } = await replay(captured)
    const deadline = byStep(/prazo/i)
    expect(deadline.knowledge!.sectionExamples).toEqual(["A contestação foi registrada hoje e será analisada em até cinco dias úteis. O retorno será enviado por SMS."])
    expect(deadline).toMatchObject({ wordingSource: "FALLBACK", writerViolations: ["EXAMPLE_CONTENT_AS_FACT"] })
    const writerItem = captured[0]!.items.find((item) => /prazo/i.test(item.requirement ?? ""))!
    const base = { observed: "Você disse ao cliente para esperar, sem informar o prazo.", whyItMatters: "", whatYouCanDo: "Na próxima chamada, informe o prazo exibido na ferramenta." }
    expect(validateMonitoringWording(base, writerItem, "Atendimento")).toEqual([])
    expect(validateMonitoringWording({ ...base, whatYouCanDo: "Na próxima chamada, informe o prazo e diga que o retorno sai por SMS." }, writerItem, "Atendimento")).toContain("EXAMPLE_CONTENT_AS_FACT")
    expect(validateMonitoringWording({ ...base, whatYouCanDo: "Na próxima chamada, informe que a análise leva até cinco dias úteis." }, writerItem, "Atendimento")).not.toContain("EXAMPLE_CONTENT_AS_FACT")
    // O contrato do redator diz isso explicitamente, e a orientação do especialista chega SEM a fala-modelo do documento.
    expect(captured[0]!.constraints.map((constraint) => constraint.code)).toContain("EXAMPLE_IS_NOT_FACT")
    expect(writerItem.analysis!.recommendation).not.toMatch(/SMS|registrada hoje/)
    expect(writerItem.analysis!.recommendation).toContain("“É só aguardar.”")
  })
  it("abertura/fechamento com fato de exemplo é recusado (vale a versão do sistema)", async () => {
    const { artifact } = await replay()
    const items = emittedItems(artifact, artifact.items.map((item) => ({ itemIndex: item.index, status: "APPROVED_UNCHANGED" as const, finalWording: null })))
    const context = { domain: "MONITORING" as const, label: `Atendimento de 25/09/2026 · ${SUBJECT}`, firstName: "Larissa" }
    expect(presentationViolations({ introduction: "Analisei seu atendimento sobre contestação de cobrança.", closing: "Para as próximas chamadas, o foco é informar o prazo da análise, com o retorno por SMS." }, items, context)).toContain("EXAMPLE_CONTENT_AS_FACT")
    expect(presentationViolations({ introduction: "Analisei seu atendimento sobre contestação de cobrança.", closing: "Para as próximas chamadas, o foco é informar o prazo da análise." }, items, context)).not.toContain("EXAMPLE_CONTENT_AS_FACT")
  })
})

describe("V1.7.1f — G/H) efeito garantido: precisão sem afrouxar", () => {
  it("G) 'ajuda a', 'contribui para', 'facilita' e a pergunta indireta relatada ('perguntou … o que causou') NÃO são garantia", () => {
    for (const text of [
      "Você perguntou ao cliente qual fatura ele questionava, o que causou o valor diferente e se ele já havia realizado o pagamento.",
      "Continue fazendo essas perguntas, pois elas ajudam a entender o que o cliente precisa resolver.",
      "Informar o prazo contribui para a previsibilidade e facilita a conversa.",
    ]) expect(detectUnsupportedEffectClaims(text), text).toEqual([])
  })
  it("H) garantia real continua recusada", () => {
    for (const text of ["Informar o prazo garante a satisfação do cliente.", "Isso assegura o encaminhamento.", "Isso vai evitar novas ligações.", "Isso vai reduzir as reclamações.", "O cancelamento elimina a cobrança.", "Necessariamente o cliente entende.", "O prazo sempre resulta em menos retorno.", "A demora causou a reclamação.", "Foi o que causou a reclamação."]) {
      expect(detectUnsupportedEffectClaims(text).length, text).toBeGreaterThan(0)
    }
  })
})

describe("V1.7.1f — fixture do smoke real (§7): nada perdido por formatação, nada inventado", () => {
  it("recapitulação não se perde; escuta vira comportamento; prazo usa a regra operacional; SMS proibido; cancelamento declarado e AUTÔNOMO", async () => {
    const { artifact, byStep, text } = await replay()
    // Recapitulação: antes BLOQUEADA (QUOTE_NOT_LITERAL); agora regra literal e item no QA (a contraprova achou "protocolo" dito).
    const recap = byStep(/recapitula/i)
    expect(recap).toMatchObject({ section: "OPPORTUNITY", process: { evidenceType: "UNVERIFIED_OMISSION" }, knowledge: { heading: "46. Recapitulação obrigatória", applicability: "LITERAL_ONLY" }, decision: { disposition: "HOLD_FOR_QA" } })
    expect(recap.proposedWording).toEqual({ observed: "Nesta chamada não apareceu o que o procedimento orienta em “Recapitulação obrigatória”.", whyItMatters: "", whatYouCanDo: "Na próxima chamada, antes de encerrar, informe: conta analisada, lançamento contestado, valor, ação realizada, serviço cancelado, quando aplicável, conta ajustada, valor a pagar, prazo, canal de retorno e protocolo." })
    // Escuta: regra verificada pela estrutura (pergunta do operador) e texto de COMPORTAMENTO.
    expect(byStep(/explique/i)).toMatchObject({ knowledge: { applicability: "VERIFIED", applicabilityBasis: "STRUCTURED_ANCHOR" } })
    // V1.7.1h — o "o que aconteceu" do redator é específico e válido; só o "Como aplicar" genérico ("perguntas exploratórias") é
    // trocado pelo texto do sistema para esse campo (antes o item inteiro caía no texto de segurança).
    const listening = byStep(/explique/i)
    expect(listening).toMatchObject({ wordingSource: "WRITER", proposedWording: { observed: V171E_WRITER_RAW.items[1].observed } })
    expect(listening.writerFieldValidation).toEqual(expect.arrayContaining([expect.objectContaining({ field: "whatYouCanDo", codes: ["GENERIC_WORDING"] })]))
    expect(listening.proposedWording!.whatYouCanDo).not.toBe(V171E_WRITER_RAW.items[1].whatYouCanDo)
    // Cancelamento: verificado pela estrutura; texto do redator (ação DECLARADA) passa; AUTÔNOMO — QA volta a ser exceção.
    expect(byStep(/cancelar/i)).toMatchObject({ process: { evidenceType: "OBSERVED_DECLARATION" }, knowledge: { applicabilityBasis: "STRUCTURED_ANCHOR" }, wordingSource: "WRITER", decision: { disposition: "READY", reasons: ["AUTONOMY_CRITERIA_MET"] } })
    // Prazo: não cumprido não usa a âncora estruturada (continua QA); regra operacional primeiro; SMS fora.
    // V1.7.1j — "Sempre informar prazo de forma objetiva:" (regra de frase única) × "é só esperar": desvio observado verificado.
    expect(byStep(/prazo/i)).toMatchObject({ knowledge: { applicability: "VERIFIED", structuredAnchorBasis: "OBSERVED_DEVIATION", operativeRule: { quote: "O operador deverá informar o prazo exibido na ferramenta." } } })
    // V1.7.1h — aqui o NÚCLEO também falha (o "o que aconteceu" do redator traz "retorno", fato que só a fala-modelo da seção 35
    // sustenta): o item inteiro continua no texto de segurança — degradação por campo nunca salva um núcleo inválido.
    expect(byStep(/prazo/i)).toMatchObject({ wordingSource: "FALLBACK", writerFieldValidation: [{ field: "observed", codes: ["EXAMPLE_CONTENT_AS_FACT"], action: "INVALIDATED_ITEM" }], proposedWording: { whatYouCanDo: "Na próxima chamada, informe o prazo exibido na ferramenta." } })
    expect(text).not.toMatch(/SMS|registrada hoje/)
    expect(text).not.toMatch(/cumpriu a etapa|siga o que orienta o documento|inclua a etapa/)
    expect(text).toContain("### Recapitulação obrigatória")
    // V1.7.1j — o prazo (regra de frase única, desvio observado) passa a verificado.
    expect(artifact.processAssessment!.summary).toMatchObject({ knowledgeNotVerified: 0, knowledgeVerified: 3, knowledgeLiteralOnly: 1 })
  })
})
