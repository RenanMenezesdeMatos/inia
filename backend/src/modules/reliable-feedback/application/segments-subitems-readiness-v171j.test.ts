import { describe, expect, it } from "vitest"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY } from "../domain/reliable-feedback-item.js"
import { nodeOutputOf } from "../domain/reliable-feedback-artifact.js"
import { verifyKnowledgeQuote, verifyProcessAssessments } from "../domain/process-assessment.js"
import { segmentKnowledgeQuote } from "../domain/knowledge-segments.js"
import { assessCompleteness } from "../domain/composite-checkpoint.js"
import { subItemKindOf, subItemMatches } from "../domain/subitem-semantics.js"
import { structuredAnchorOf } from "../domain/structured-anchor.js"
import { ruleContextOf } from "../domain/verified-omission.js"
import { exampleOnlyFactsIn } from "../domain/suggested-response.js"
import { toReliableReviewDetail } from "../../interaction-feedback/domain/review-view.js"
import { checkpointReadinessOf, isObservationEligibleForAnalytics, summarizeObservations } from "../../indicator-diagnosis/domain/observation-readiness.js"
import { observationsFrom } from "../../indicator-diagnosis/domain/process-patterns.js"
import { V171I_ASSESSMENT, V171I_COLLABORATOR_NAME, V171I_CONTENT, V171I_DOC_TITLE, V171I_OTHER_OPERATOR_NAMES, V171I_PRESENTED, V171I_PUBLISHED, V171I_SUBJECT, V171I_TRANSCRIPT, V171I_WRITER_RAW } from "../testing/contestacao-v171i-smoke-fixture.js"

/**
 * V1.7.1j — SEGMENTOS DA BASE, SEMÂNTICA DOS SUBITENS e PRONTIDÃO ANALÍTICA, sobre o smoke REAL da V1.7.1i (sem modelo).
 */
const MIXED = "Sempre informar prazo de forma objetiva: “A contestação foi registrada hoje e será analisada em até cinco dias úteis. O retorno será enviado por SMS.”"
const RECAP = "Antes de encerrar, informar:\n\n- Conta analisada;\n- Lançamento contestado;\n- Valor;\n- Ação realizada;\n- Serviço cancelado, quando aplicável;\n- Conta ajustada;\n- Valor a pagar;\n- Prazo;\n- Canal de retorno;\n- Protocolo."
const operatorTurns = V171I_TRANSCRIPT.split("\n").filter((line) => line.startsWith("Operador:")).map((line) => line.replace(/^Operador:\s*/, ""))
const RECAP_TURN = operatorTurns.find((line) => line.startsWith("Então, só pra gente fechar"))!
const statusOf = (completeness: ReturnType<typeof assessCompleteness>) => Object.fromEntries(completeness!.items.map((item) => [item.text, item.status]))

describe("V1.7.1j — A/B/C) trecho da base em SEGMENTOS: regra ≠ fala-modelo", () => {
  it("A) seção 35 real: a abertura é REGRA e a fala-modelo é SCRIPT_EXAMPLE (não pelo prefixo do trecho inteiro)", () => {
    expect(segmentKnowledgeQuote(V171I_CONTENT, MIXED).map((segment) => [segment.role, segment.text])).toEqual([
      ["RULE", "Sempre informar prazo de forma objetiva:"],
      ["SCRIPT_EXAMPLE", "A contestação foi registrada hoje e será analisada em até cinco dias úteis. O retorno será enviado por SMS."],
    ])
    const verified = verifyKnowledgeQuote({ documentTitle: V171I_DOC_TITLE, quote: MIXED, presented: V171I_PRESENTED, published: V171I_PUBLISHED, anchorTexts: [] })
    expect(verified).toMatchObject({ quote: "Sempre informar prazo de forma objetiva:", citedQuote: MIXED, contentKind: "RULE_CONTENT", heading: "35. Prazo da análise" })
    expect(verified.segments!.every((segment) => segment.documentOffset !== null)).toBe(true)
  })

  it("B) fato que só existe na fala-modelo (SMS, cinco dias úteis) não ganha autoridade de regra por estar colado nela", () => {
    const scope = { ruleTexts: ["Sempre informar prazo de forma objetiva:", "O operador deverá informar o prazo exibido na ferramenta."], exampleTexts: ["A contestação foi registrada hoje e será analisada em até cinco dias úteis. O retorno será enviado por SMS."], evidenceTexts: [] }
    expect(exampleOnlyFactsIn(["Informe que o retorno será enviado por SMS em até cinco dias úteis.", "", ""], scope).length).toBeGreaterThan(0)
  })

  it("C) regra normativa INDEPENDENTE sustenta o mesmo fato (só por ela)", () => {
    const scope = { ruleTexts: ["O operador deverá informar o prazo exibido na ferramenta.", "Análise de faturamento: preferencialmente em até cinco dias úteis;"], exampleTexts: ["A contestação foi registrada hoje e será analisada em até cinco dias úteis. O retorno será enviado por SMS."], evidenceTexts: [] }
    expect(exampleOnlyFactsIn(["Informe que a análise é concluída em até cinco dias úteis.", "", ""], scope)).toEqual([])
    expect(exampleOnlyFactsIn(["Informe que o retorno chega por SMS.", "", ""], scope).length).toBeGreaterThan(0)
  })

  it("pergunta PRESCRITA em item de lista abaixo de abertura normativa continua REGRA ('Perguntar: - “…”')", () => {
    const roles = segmentKnowledgeQuote(V171I_CONTENT, "Perguntar:\n\n- “As informações ficaram claras?”\n- “Ficou alguma dúvida sobre o valor que deve ser pago?”").map((segment) => segment.role)
    expect(roles).toEqual(["RULE"])
  })
})

describe("V1.7.1j — D/E/F/G/H) semântica dos SUBITENS: presença fácil, ausência exige detector confiável", () => {
  it("D) 'Valor' + 'R$ 9,90 por mês' (e outras formas de dinheiro) → presente", () => {
    expect(subItemKindOf("Valor")).toBe("VALUE")
    for (const said of ["É a Banca Digital, de R$ 9,90 por mês.", "Veio 9,90 na conta.", "Custa nove reais.", "A cobrança é de nove e noventa por mês."]) expect(subItemMatches("VALUE", said)).toBe(true)
    const completeness = assessCompleteness({ quote: RECAP, evidence: [{ turnRef: "T9", text: "Recapitulando: contestamos a Banca Digital de R$ 9,90 por mês." }], operatorConversation: operatorTurns, windowComplete: true })
    expect(statusOf(completeness).valor).toBe("OBSERVED")
  })

  it("E) número qualquer não é dinheiro; 'dois meses' não é prazo; prazo negado não é prazo", () => {
    for (const said of ["São 3 linhas no seu nome.", "O CPF termina em 604.", "Foram dois meses cobrados.", "às três e quinze eu retorno"]) expect(subItemMatches("VALUE", said)).toBe(false)
    expect(subItemMatches("DEADLINE", "a contestação dos dois meses tá aberta")).toBe(false)
    expect(subItemMatches("DEADLINE", "eu não sei te passar o prazo")).toBe(false)
    expect(subItemMatches("DEADLINE", "a análise sai em até 5 dias úteis")).toBe(true)
  })

  it("F) tipo sem detector confiável (ou transcrição incompleta) → UNKNOWN, nunca ausente", () => {
    const lexical = assessCompleteness({ quote: "Antes de encerrar, informar:\n- Situação cadastral;\n- Protocolo.", evidence: [{ turnRef: "T21", text: "O seu protocolo é 123." }], operatorConversation: ["O seu protocolo é 123."], windowComplete: true })
    expect(statusOf(lexical)).toMatchObject({ "situação cadastral": "UNKNOWN", protocolo: "OBSERVED" })
    const cut = assessCompleteness({ quote: RECAP, evidence: [{ turnRef: "T21", text: RECAP_TURN }], operatorConversation: operatorTurns, windowComplete: false })
    expect(cut!.counts.VERIFIED_ABSENT).toBe(0)
  })

  it("G/H) recapitulação REAL: ausência provada só com detector confiável; o item condicional OBSERVADO continua condicional", () => {
    const completeness = assessCompleteness({ quote: RECAP, evidence: [{ turnRef: "T21", text: RECAP_TURN }], operatorConversation: operatorTurns, windowComplete: true })!
    expect(completeness.status).toBe("PARTIAL")
    expect(statusOf(completeness)).toEqual({ "conta analisada": "OBSERVED_ELSEWHERE", "lançamento contestado": "OBSERVED", valor: "OBSERVED_ELSEWHERE", "ação realizada": "OBSERVED", "serviço cancelado, quando aplicável": "OBSERVED", "conta ajustada": "NOT_APPLICABLE", "valor a pagar": "NOT_APPLICABLE", prazo: "VERIFIED_ABSENT", "canal de retorno": "VERIFIED_ABSENT", protocolo: "OBSERVED" })
    expect(completeness.items.find((item) => item.text.startsWith("serviço cancelado"))).toMatchObject({ status: "OBSERVED", conditional: true })
  })
})

describe("V1.7.1j — I/J/K/L) prontidão analítica: gravada ≠ elegível", () => {
  const verified = () => verifyProcessAssessments({ sources: [{ sourceRef: "S", assessment: JSON.parse(JSON.stringify(V171I_ASSESSMENT)), presented: V171I_PRESENTED }], interactionId: "int-j", transcript: V171I_TRANSCRIPT, published: V171I_PUBLISHED, subject: V171I_SUBJECT })

  it("I/J) prova completa → VERIFIED; regra que é só EXEMPLO (apresentação) → NEEDS_REVIEW; aplicabilidade só literal → NEEDS_REVIEW", () => {
    const assessment = verified()
    const byRequirement = (pattern: RegExp) => assessment.checkpoints.find((checkpoint) => pattern.test(checkpoint.requirement))!
    expect(checkpointReadinessOf(byRequirement(/Cancelar/))).toEqual({ status: "VERIFIED", reasons: [] })
    expect(checkpointReadinessOf(byRequirement(/Apresenta/))).toEqual({ status: "NEEDS_REVIEW", reasons: ["EXAMPLE_ONLY_RULE"] })
    // V1.7.1k — a lista "Verificar" ancora pelos próprios itens reconhecidos na fala (prova VERIFIED), mas com completude
    // DESCONHECIDA nunca é gravada como cumprida nem entra no histórico.
    expect(checkpointReadinessOf(byRequirement(/Verificar/))).toEqual({ status: "VERIFIED", reasons: [] })
    expect(byRequirement(/Verificar/)).toMatchObject({ status: "FOLLOWED", completeness: { status: "UNKNOWN" }, knowledge: { structuredAnchor: { basis: "COMPOSITE_ITEMS_OBSERVED" } } })
    const observations = observationsFrom("op-j", [{ interactionId: "int-j", assessment }])
    expect(observations.find((observation) => /Apresenta/.test(observation.requirement))).toMatchObject({ status: "FOLLOWED", analyticsStatus: "NEEDS_REVIEW", analyticsReasons: ["EXAMPLE_ONLY_RULE"] })
    expect(observations.find((observation) => /Recapitula/.test(observation.requirement))).toMatchObject({ status: "NOT_FOLLOWED", completeness: "PARTIAL", analyticsStatus: "VERIFIED" })
    // Composta "cumprida" sem completude provada nunca é gravada como cumprida.
    expect(observations.some((observation) => /Verificar/.test(observation.requirement))).toBe(false)
  })

  it("K/L) 30 observações: a agregação padrão só conta VERIFIED; PARTIAL nunca conta como cumprida", () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({
      practiceKey: index < 15 ? "KB:doc:recap" : "KB:doc:presentation",
      status: index % 3 === 0 ? "NOT_FOLLOWED" : "FOLLOWED",
      completeness: index < 15 && index % 3 === 0 ? "PARTIAL" : null,
      analyticsStatus: index < 15 ? "VERIFIED" : index % 2 === 0 ? "NEEDS_REVIEW" : "VERIFIED",
    }))
    // 15 da recapitulação (todas VERIFIED) + 8 da apresentação (índices ímpares 15…29); 7 da apresentação ficam fora (NEEDS_REVIEW).
    expect(rows.filter(isObservationEligibleForAnalytics)).toHaveLength(15 + 8)
    const summary = Object.fromEntries(summarizeObservations(rows).map((entry) => [entry.practiceKey, entry]))
    expect(summary["KB:doc:recap"]).toMatchObject({ followed: 10, notFollowed: 5, partial: 5, excluded: 0 })
    expect(summary["KB:doc:presentation"]).toMatchObject({ excluded: 7 })
    expect(isObservationEligibleForAnalytics({ status: "FOLLOWED", completeness: "PARTIAL", analyticsStatus: "VERIFIED" })).toBe(false)
    expect(isObservationEligibleForAnalytics({ status: "FOLLOWED", completeness: null, analyticsStatus: null })).toBe(false)
  })
})

describe("V1.7.1j — M/N) conflito com outra etapa exige AÇÃO + OBJETO", () => {
  const conversation = V171I_TRANSCRIPT.split("\n").map((line) => line.replace(/^(?:Operador|Cliente):\s*/, ""))
  const base = { contentKind: "RULE_CONTENT", documentTitle: V171I_DOC_TITLE, subject: V171I_SUBJECT, conversation, operatorConversation: operatorTurns, status: "FOLLOWED" as const }
  const registerRule = ruleContextOf(V171I_CONTENT, "2. Registrar contestação;")
  it("N) 'abrir a contestação … pro faturamento analisar': o verbo 'analisar' sozinho não é a etapa 'Analisar valores…'", () => {
    expect(structuredAnchorOf({ ...base, rule: registerRule, citedQuote: "Registrar contestação;", operatorEvidence: [{ turnRef: "T13", text: "Tá. Então eu vou abrir a contestação dos dois meses dessa assinatura pro faturamento analisar." }] })).toMatchObject({ anchored: true, basis: "CHECKPOINT_SELECTION", proof: { otherStepStems: [] } })
  })
  it("M) ação E objeto de outra etapa na mesma fala → conflito (QA)", () => {
    expect(structuredAnchorOf({ ...base, rule: registerRule, citedQuote: "Registrar contestação;", operatorEvidence: [{ turnRef: "T13", text: "Abri a contestação e cancelei a recorrência." }] })).toMatchObject({ anchored: false, failure: "EVIDENCE_MATCHES_OTHER_STEP", proof: { otherStepStems: ["cancel"] } })
  })
})

const SLOTS: [RegExp, number][] = [[/prazo/i, 0], [/Apresenta/i, 1], [/Cancelar/i, 2], [/Confirma/i, 3], [/Verificar/i, 4], [/Registrar a contesta/i, 5]]
function writer(): ReliableFeedbackWriterPort {
  return {
    writeMonitoring: async (input) => ({ rawOutput: { items: input.items.flatMap((item) => { const hit = SLOTS.find(([pattern]) => pattern.test(item.requirement ?? "")); return hit ? [{ ...V171I_WRITER_RAW.items[hit[1]]!, slot: item.slot }] : [] }), presentation: V171I_WRITER_RAW.presentation } }),
    writeIndicator: async () => { throw new Error("não usado") },
  }
}
async function replay() {
  const store = createInMemoryReliableFeedbackStore({ onReactivate: () => true })
  const deps: ReliableGenerationDeps = {
    enabled: true, store, writer: writer(), policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async () => ({ transcript: V171I_TRANSCRIPT, label: `Atendimento de 25/09/2026 · ${V171I_SUBJECT}`, otherOperatorNames: V171I_OTHER_OPERATOR_NAMES, subjectOperatorName: V171I_COLLABORATOR_NAME }),
    loadIndicatorContext: async () => null, loadPublishedKnowledge: async () => V171I_PUBLISHED, loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }), resolveDiagnosticStrategy: async () => null,
    loadRecipient: async () => ({ firstName: "Larissa" }), now: () => new Date("2026-09-25T22:29:00Z"),
  }
  const source = { kind: "monitoring", knowledgeExcerpts: V171I_PRESENTED, input: { organizationId: "org-j", operatorId: "op-j", interactionId: "int-j", structured: { evidenceFound: "x", observedBehavior: "o", relatedProcedure: V171I_DOC_TITLE, recommendation: "r", processAssessment: JSON.parse(JSON.stringify(V171I_ASSESSMENT)) } } }
  const request: ReliableGenerationRequest = { organizationId: "org-j", enrollmentId: "enr-v171i", workflowId: "wf", workflowVersionId: "v", nodeId: "gerar", sourceNodeId: "orq", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: "op-j", interactionId: "int-j", indicatorMeasurementId: null, configuredAgentId: null }
  const result = await generateReliableFeedback(deps, request)
  const artifact = result.record.artifact!
  const byStep = (pattern: RegExp) => artifact.items.find((item) => pattern.test(item.process?.requirement ?? ""))!
  const text = nodeOutputOf(result.record.id, artifact, artifact.items.map((item) => ({ itemIndex: item.index, status: "APPROVED_UNCHANGED" as const, finalWording: null }))).text
  return { store, artifact, byStep, text }
}

describe("V1.7.1j — O + replay do smoke REAL da V1.7.1i (§18)", () => {
  it("A–G: fala-modelo não vira regra; SMS e 'cinco dias' fora; valor não acusado; contestação sem QA; apresentação não elegível", async () => {
    const { artifact, byStep, text } = await replay()
    // V1.7.1k — a lista "Verificar" sai do QA (itens da fala); só a apresentação (base é exemplo) continua em QA.
    expect(artifact.findings).toMatchObject({ detected: 7, reliable: 7, blocked: 0, inFeedback: 6, heldForQa: 1 })
    const deadline = byStep(/prazo/i)
    expect(deadline).toMatchObject({ knowledge: { quote: "Sempre informar prazo de forma objetiva:", citedExamples: ["A contestação foi registrada hoje e será analisada em até cinco dias úteis. O retorno será enviado por SMS."] }, decision: { disposition: "READY" } })
    expect(deadline.proposedWording!.whatYouCanDo).toBe("Na próxima chamada, informe o prazo exibido na ferramenta.")
    expect(deadline.writerFieldValidation).toEqual(expect.arrayContaining([expect.objectContaining({ field: "whatYouCanDo", codes: ["EXAMPLE_CONTENT_AS_FACT"], action: "FALLBACK_FIELD" }), expect.objectContaining({ field: "suggestedResponse", action: "DROPPED" })]))
    // "O processo orienta" nunca traz a fala-modelo; ela aparece só rotulada como exemplo.
    const deadlineBlock = text.slice(text.indexOf("### Prazo da análise"), text.indexOf("### Recapitulação"))
    expect(deadlineBlock).toContain("_Exemplo do procedimento (ilustrativo):_ “A contestação foi registrada hoje")
    expect(deadlineBlock.slice(deadlineBlock.indexOf("**O processo orienta**"), deadlineBlock.indexOf("_Procedimento"))).not.toMatch(/SMS|cinco dias/)
    expect(deadlineBlock.slice(deadlineBlock.indexOf("**Como aplicar:**"))).not.toMatch(/SMS|cinco dias/)
    // Recapitulação: continua parcial, sem acusar o valor (dito como número fora da recapitulação).
    const recap = byStep(/Recapitula/)
    expect(recap.proposedWording!.observed).toBe("Em “Recapitulação obrigatória”, você fez parte do que o procedimento prevê, incluindo “Lançamento contestado”, “Ação realizada”, “Serviço cancelado” e “Protocolo”, mas não todos os itens previstos. Nesta chamada não apareceram “Prazo” e “Canal de retorno”. “Conta ajustada” e “Valor a pagar” não se aplicavam neste momento, porque o resultado ainda estava pendente.")
    expect(byStep(/Registrar a contesta/)).toMatchObject({ knowledge: { applicability: "VERIFIED", structuredAnchorBasis: "CHECKPOINT_SELECTION" }, decision: { disposition: "READY" } })
    expect(byStep(/Apresenta/).decision.reasons).toContain("KNOWLEDGE_RULE_IS_EXAMPLE")
    expect(text).toContain("fechar, Marina:")
  })

  it("O) o QA técnico mostra a completude e os subitens da etapa composta", async () => {
    const { store, artifact } = await replay()
    const review = store.reviews[0]!
    const context = { collaborator: { id: "op-j", name: "Larissa Monteiro", jobTitle: null }, team: null, occurredAt: null, createdAt: new Date("2026-09-25T22:29:00Z"), reviewerName: null, selection: { decision: artifact.items.find((item) => item.index === review.itemIndex)!.decision, deliveredAt: null } } as never
    const detail = toReliableReviewDetail(review, context, { artifact, reviews: store.reviews })
    const recap = detail.feedbackPreview!.items.find((item) => /Recapitula/.test(item.technical.requirement ?? ""))!
    expect(recap.technical.completeness).toEqual({ statusLabel: "Parcial", groups: [
      { label: "Observado na etapa", items: ["lançamento contestado", "ação realizada", "serviço cancelado, quando aplicável", "protocolo"] },
      { label: "Comprovadamente ausente", items: ["prazo", "canal de retorno"] },
      { label: "Não aplicável (resultado ainda pendente)", items: ["conta ajustada", "valor a pagar"] },
      { label: "Dito na chamada, fora da etapa", items: ["conta analisada", "valor"] },
    ] })
    const verify = detail.feedbackPreview!.items.find((item) => /Verificar/.test(item.technical.requirement ?? ""))!
    expect(verify.technical.completeness).toMatchObject({ statusLabel: "Desconhecida (não comprovável pela chamada)" })
  })
})
