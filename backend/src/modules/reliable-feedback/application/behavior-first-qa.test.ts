import { describe, expect, it } from "vitest"
import { toReliableReviewDetail } from "../../interaction-feedback/domain/review-view.js"
import { FeedbackWriterError } from "../../interaction-feedback/domain/feedback-writer-provenance.js"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import { decideReliableReview } from "./decide-reliable-review.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY } from "../domain/reliable-feedback-item.js"
import { confirmedProductsOf, nodeOutputOf, renderPublishedNarrative } from "../domain/reliable-feedback-artifact.js"
import { ruleSpecificityOf, selectOperativeRule } from "../domain/rule-selection.js"
import { avoidedPhrasesIn, presentationLabelOf, ruleActionOf } from "../domain/behavior-presentation.js"
import { gerundOf, imperativeOf, nominalizeAction, preteriteOf } from "../domain/portuguese-verbs.js"
import type { PresentedKnowledgeExcerpt, PublishedKnowledgeDocument } from "../domain/process-assessment.js"
import { V171B_LINES, V171B_TRANSCRIPT } from "../testing/contestacao-v171b-smoke-fixture.js"

/**
 * V1.7.1e — QA UX + BEHAVIOR-FIRST FEEDBACK, a partir do caso REAL da Larissa (smoke V1.7.1b/c, mesma transcrição, mesmas
 * seções do procedimento publicado). Checkpoint é linguagem interna; comportamento é a linguagem do feedback; processo é a
 * evidência. Zero modelo: o redator falha como no smoke (JSON malformado) e tudo sai pelo texto de segurança.
 */
const ORG = "00000000-0000-4000-8000-0000000000e1"
const OPERATOR = "11111111-1111-4111-8111-1111111111e1"
const INTERACTION = "22222222-2222-4222-8222-2222222222e1"
const DOC = "c8f2c818-72db-48dc-8d7d-d8a9fe861c65"
const TITLE = "Procedimento Operacional — Contestação de Contas Móvel"
const OPERATIVE = "O operador deverá informar o prazo exibido na ferramenta."
const INTRO = "Sempre informar prazo de forma objetiva:"
const EXAMPLE = "“A contestação foi registrada hoje e será analisada em até cinco dias úteis. O retorno será enviado por SMS.”"
const LISTEN_RULE = "O operador deverá permitir que o cliente explique:\n\n- Qual conta está questionando;\n- Qual cobrança não reconhece;"
const LISTEN = ["## 6. Escuta e identificação da solicitação", "", "O operador deverá permitir que o cliente explique:", "", "- Qual conta está questionando;", "- Qual cobrança não reconhece;", "- Qual valor esperava;", "", "**Exemplo:**", "", "“Para eu analisar corretamente, poderia me informar qual cobrança você não reconhece e em qual conta ela aparece?”"].join("\n")
const DIGITAL = ["## 15. Serviços digitais não reconhecidos", "", "Se o cliente não reconhecer:", "", "1. Cancelar a recorrência, quando permitido;", "2. Registrar contestação;"].join("\n")
// A seção 35 REAL: regra normativa no topo, referência operacional, abertura "Sempre informar…", exemplo e lista "Evitar".
const DEADLINE = ["## 35. Prazo da análise", "", OPERATIVE, "", "Como referência operacional:", "", "- Análise de faturamento: preferencialmente em até cinco dias úteis;", "", INTRO, "", EXAMPLE, "", "Evitar:", "", "- “É só aguardar.”", "- “Logo será resolvido.”", "- “O setor vai verificar.”", "- “Não sei o prazo.”"].join("\n")
const CONTENT = [`# ${TITLE}`, "", LISTEN, "", DIGITAL, "", DEADLINE].join("\n")
const published = new Map<string, PublishedKnowledgeDocument>([[DOC, { documentId: DOC, title: TITLE, content: CONTENT, version: 3 }]])
const presented: PresentedKnowledgeExcerpt[] = [
  { documentId: DOC, documentTitle: TITLE, heading: "6. Escuta e identificação da solicitação", excerpt: LISTEN, chunkIndex: 2 },
  { documentId: DOC, documentTitle: TITLE, heading: "15. Serviços digitais não reconhecidos", excerpt: DIGITAL, chunkIndex: 4 },
  { documentId: DOC, documentTitle: TITLE, heading: "35. Prazo da análise", excerpt: DEADLINE, chunkIndex: 7 },
]
const step = (overrides: Record<string, unknown>) => ({ evidenceType: "OBSERVED", knowledgeDetailQuote: null, guidance: { source: "OFFICIAL_PROCEDURE", text: null }, uncertainty: null, ...overrides })
/** A avaliação do especialista no smoke: citou a ABERTURA "Sempre informar…" (não a regra normativa) e a lista "Evitar". */
const assessment = () => ({
  processes: [{
    documentTitle: TITLE,
    checkpoints: [
      step({ requirement: "Informar o prazo de análise de forma objetiva", status: "NOT_FOLLOWED", transcriptEvidence: [`Operador: ${V171B_LINES.deadline}`], knowledgeQuote: INTRO }),
      step({ requirement: "Evitar frases vagas", status: "NOT_FOLLOWED", transcriptEvidence: [`Operador: ${V171B_LINES.deadline}`], knowledgeQuote: "Evitar:\n\n- “É só aguardar.”\n- “Logo será resolvido.”\n- “O setor vai verificar.”\n- “Não sei o prazo.”" }),
      step({ requirement: "Identificar a solicitação permitindo que o cliente explique", status: "FOLLOWED", transcriptEvidence: [`Operador: ${V171B_LINES.account}`, `Operador: ${V171B_LINES.charge}`], knowledgeQuote: LISTEN_RULE }),
      step({ requirement: "Cancelar a recorrência do serviço não reconhecido", status: "FOLLOWED", transcriptEvidence: [`Operador: ${V171B_LINES.authorize}`, `Operador: ${V171B_LINES.cancelled}`], knowledgeQuote: "1. Cancelar a recorrência, quando permitido;" }),
    ],
  }],
})
const malformedWriter: ReliableFeedbackWriterPort = {
  writeMonitoring: async () => { throw new FeedbackWriterError("WRITER_MALFORMED_JSON", null as never, "resposta não é JSON", { rejectedResponse: "{\"items\": [" }) },
  writeIndicator: async () => { throw new Error("não usado") },
}
function setup() {
  const store = createInMemoryReliableFeedbackStore({ onReactivate: () => true })
  const deps: ReliableGenerationDeps = {
    enabled: true, store, writer: malformedWriter, policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async () => ({ transcript: V171B_TRANSCRIPT, label: "Atendimento de 25/09/2026 · Contestação de cobrança", otherOperatorNames: [] }),
    loadIndicatorContext: async () => null, loadPublishedKnowledge: async () => published, loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }), resolveDiagnosticStrategy: async () => null,
    loadRecipient: async () => ({ firstName: "Larissa" }), now: () => new Date("2026-09-25T16:29:00Z"),
  }
  const source = { kind: "monitoring", knowledgeExcerpts: presented, input: { organizationId: ORG, operatorId: OPERATOR, interactionId: INTERACTION, structured: { evidenceFound: V171B_LINES.deadline, observedBehavior: "o", relatedProcedure: TITLE, recommendation: "r", processAssessment: assessment() } } }
  const request: ReliableGenerationRequest = { organizationId: ORG, enrollmentId: "enr-larissa-e", workflowId: "wf", workflowVersionId: "v1", nodeId: "gerar", sourceNodeId: "orq", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: OPERATOR, interactionId: INTERACTION, indicatorMeasurementId: null, configuredAgentId: null }
  return { deps, request, store }
}
const context = { collaborator: { id: OPERATOR, name: "Larissa Monteiro", jobTitle: null }, team: null, occurredAt: null, createdAt: new Date("2026-09-25T16:30:00Z"), reviewerName: null, selection: { decision: { disposition: "HOLD_FOR_QA", structural: "STRUCTURALLY_EMITTABLE", reasons: ["WRITER_NOT_PASSED", "WRITER_FALLBACK_USED", "WRITER_VALIDATION_FAILED", "KNOWLEDGE_APPLICABILITY_UNVERIFIED"], policyVersion: "RELIABLE_FEEDBACK_POLICY_AUTONOMOUS_V1", autonomyEligible: false }, deliveredAt: null } } as never
const approveAll = (artifact: Parameters<typeof nodeOutputOf>[1]) => artifact.items.map((item) => ({ itemIndex: item.index, status: "APPROVED_UNCHANGED" as const, finalWording: null }))

async function larissa() {
  const { deps, request, store } = setup()
  const result = await generateReliableFeedback(deps, request)
  const artifact = result.record.artifact!
  const approved = nodeOutputOf(result.record.id, artifact, approveAll(artifact))
  return { deps, store, result, artifact, approved, text: approved.text }
}

describe("V1.7.1e — seleção determinística da regra (§16/§17; I, J)", () => {
  it("I) regra normativa mais específica da MESMA seção vence a abertura genérica citada pelo especialista", () => {
    expect(ruleSpecificityOf(INTRO, "RULE_CONTENT")).toBe("INTRODUCTORY")
    expect(ruleSpecificityOf(OPERATIVE, "RULE_CONTENT")).toBe("NORMATIVE")
    expect(ruleSpecificityOf("1. Cancelar a recorrência, quando permitido;", "RULE_CONTENT")).toBe("NORMATIVE")
    expect(selectOperativeRule({ content: CONTENT, heading: "35. Prazo da análise", citedQuote: INTRO, citedKind: "RULE_CONTENT" })).toEqual({ quote: OPERATIVE, heading: "35. Prazo da análise", basis: "SECTION_NORMATIVE_RULE", replaced: "INTRODUCTORY_CITATION", selection: "RULE_SELECTION_V1" })
    // Lista "Evitar" citada: a regra normativa da seção é o que fazer NO LUGAR (evitar complementa, nunca substitui).
    expect(selectOperativeRule({ content: CONTENT, heading: "35. Prazo da análise", citedQuote: "Evitar:\n\n- “É só aguardar.”", citedKind: "DO_NOT_CONTENT" })).toMatchObject({ quote: OPERATIVE, replaced: "DO_NOT_CITATION" })
    // Citado já normativo → nenhuma troca; seção sem regra normativa → nenhuma troca (nada inventado).
    expect(selectOperativeRule({ content: CONTENT, heading: "6. Escuta e identificação da solicitação", citedQuote: LISTEN_RULE, citedKind: "RULE_CONTENT" })).toBeNull()
    expect(selectOperativeRule({ content: "## 9. Tom\n\nSempre com cordialidade:\n\n“Bom dia!”", heading: "9. Tom", citedQuote: "Sempre com cordialidade:", citedKind: "RULE_CONTENT" })).toBeNull()
  })

  it("J) exemplo NUNCA substitui regra: citado exemplo → nenhuma regra operacional; linha de exemplo nunca é candidata", () => {
    expect(ruleSpecificityOf(EXAMPLE, "EXAMPLE_CONTENT")).toBe("EXAMPLE")
    expect(selectOperativeRule({ content: CONTENT, heading: "35. Prazo da análise", citedQuote: EXAMPLE, citedKind: "EXAMPLE_CONTENT" })).toBeNull()
    const onlyExample = "## 40. Encerramento\n\nSempre encerrar com cordialidade:\n\n“O senhor deverá receber o retorno em breve.”"
    expect(selectOperativeRule({ content: onlyExample, heading: "40. Encerramento", citedQuote: "Sempre encerrar com cordialidade:", citedKind: "RULE_CONTENT" })).toBeNull()
  })

  it("proveniência: a regra operacional é LITERAL da versão publicada, na mesma seção; o trecho citado continua no item", async () => {
    const { artifact } = await larissa()
    // Ordem determinística: o ponto "evitar" (regra ancorada na fala) vem antes da abertura (regra só literal).
    const avoid = artifact.items.find((item) => item.knowledge?.contentKind === "DO_NOT_CONTENT")
    const intro = artifact.items.find((item) => item.knowledge?.quote === INTRO)
    expect(intro!.knowledge).toMatchObject({ quote: INTRO, heading: "35. Prazo da análise", version: 3, operativeRule: { quote: OPERATIVE, replaced: "INTRODUCTORY_CITATION" } })
    expect(avoid!.knowledge).toMatchObject({ contentKind: "DO_NOT_CONTENT", operativeRule: { quote: OPERATIVE, replaced: "DO_NOT_CITATION" } })
    expect(CONTENT).toContain(intro!.knowledge!.operativeRule!.quote)
    // O nome INTERNO da etapa continua no item (banco/analytics); só a apresentação muda.
    expect(intro!.process!.stepTitle).toBe("Sempre informar prazo de forma objetiva")
  })
})

describe("V1.7.1e — feedback BEHAVIOR-FIRST no caso Larissa (§9–§15, §18, §20)", () => {
  it("ponto forte: comportamento concreto (perguntas + o que identificou), fala, regra, seção e link — nunca 'você cumpriu a etapa'", async () => {
    const { text } = await larissa()
    // V1.7.2 — apresentação de supervisor: pontos cumpridos vão para "O que manter" (sem bloco por obrigação, sem placar).
    // V1.7.1f — só o item que uma PERGUNTA do operador sustenta (a cobrança foi identificada numa fala que não é pergunta).
    const maintain = text.slice(text.indexOf("## O que manter"), text.indexOf("**Materiais utilizados**"))
    // Feedback Experience V2 — as evidências de cada ponto (a narrativa já reconheceu; nada de resumo repetido).
    expect(maintain).toContain("**Cancelamento da recorrência**: Você informou ao cliente o cancelamento da recorrência.")
    expect(maintain).toContain("**Escuta e identificação da solicitação**: Você perguntou ao cliente qual conta está questionando.")
    expect(text).not.toContain("**O que você fez bem**")
    // A evidência e a base continuam no item (artefato/QA), só não viram um bloco por ponto cumprido.
    const { artifact } = await larissa()
    const escuta = artifact.items.find((item) => item.section === "STRENGTH" && item.knowledge?.heading?.includes("Escuta"))!
    expect(escuta.facts.map((fact) => fact.text)).toContain(V171B_LINES.account)
    expect(escuta.knowledge).toMatchObject({ href: `/materiais/${DOC}`, heading: "6. Escuta e identificação da solicitação" })
  })

  it("prazo: a fala, o que precisa ser ajustado, a regra NORMATIVA antes da abertura, 'evitar' como complemento, como aplicar concreto e o link", async () => {
    const { text } = await larissa()
    const block = text.slice(text.indexOf("### Prazo da análise"), text.indexOf("## O que manter"))
    expect(block).toContain(`**Na chamada**\n\n> Você disse: “${V171B_LINES.deadline}”`)
    // Feedback Experience V2 — com a fala nos detalhes, "O que aconteceu" não repete a narrativa (o texto continua no item e no QA).
    expect(block).not.toContain("**O que aconteceu**")
    expect(block).toContain(`**O processo orienta**\n\n> “${OPERATIVE}”\n>\n> “${INTRO}”`)
    expect(block).toContain(`_${TITLE} · Seção: Prazo da análise_ — [Abrir processo ↗](/materiais/${DOC})`)
    expect(block).toContain("**O procedimento pede evitar**\n\n> “É só aguardar.” · “Logo será resolvido.” · “O setor vai verificar.” · “Não sei o prazo.”")
    expect(block).toContain("**Como melhorar:** Na próxima chamada, informe o prazo exibido na ferramenta, em vez de dizer “É só aguardar”.")
    // §18 — nunca "siga o procedimento" / "observe a etapa" quando há regra operacional.
    expect(block).not.toMatch(/siga o procedimento|observe a etapa|inclua a etapa|procure ser mais claro/i)
    // O exemplo da base (cinco dias úteis, SMS) nunca vira orientação nem exemplo de condução — só aparece rotulado.
    expect(block).not.toMatch(/\*\*Como melhorar:\*\*[^\n]*(?:cinco dias|SMS)/)
    expect(block).not.toContain("cinco dias")
  })

  it("G/H) checkpoint cru nunca é copy principal: títulos são ASSUNTOS; nada de 'você cumpriu a etapa', 'Ponto forte ·' nem numeração editorial", async () => {
    const { text, artifact } = await larissa()
    // V1.7.2 — só o ponto a ajustar tem bloco próprio; os cumpridos estão em "O que manter".
    expect([...text.matchAll(/^### (.+)$/gm)].map((match) => match[1])).toEqual(["Prazo da análise"])
    expect(text).not.toMatch(/cumpriu a etapa|a etapa “|Ponto (?:forte|de desenvolvimento) ·|\*\*\d+\. |checkpoint/i)
    // Os nomes internos continuam nos itens (analytics/QA técnico).
    // V1.7.1n — o prazo não informado ("É só aguardar") deixou de ir ao QA pela palavra "prazo": a regra de frase única fica
    // VERIFICADA (polaridade) e vem antes do "evitar" só literal; os títulos exibidos não mudam.
    expect(artifact.items.map((item) => item.process!.stepTitle)).toEqual(["Sempre informar prazo de forma objetiva", "Prazo da análise", "Escuta e identificação da solicitação", "Cancelar a recorrência"])
    expect(artifact.items.map(presentationLabelOf)).toEqual(["Prazo da análise", "Prazo da análise", "Escuta e identificação da solicitação", "Cancelamento da recorrência"])
  })

  it("§22 — confiabilidade intacta: mesmas disposições e motivos (texto de segurança → QA; regra só literal continua exigindo QA)", async () => {
    const { artifact } = await larissa()
    expect(artifact.items.map((item) => item.decision.disposition)).toEqual(["HOLD_FOR_QA", "HOLD_FOR_QA", "HOLD_FOR_QA", "HOLD_FOR_QA"])
    for (const item of artifact.items) expect(item.decision.reasons).toEqual(expect.arrayContaining(["WRITER_NOT_PASSED", "WRITER_FALLBACK_USED"]))
    expect(artifact.items.map((item) => item.knowledge!.applicability)).toEqual(artifact.items.map((item) => (item.decision.reasons.includes("KNOWLEDGE_APPLICABILITY_UNVERIFIED") ? "LITERAL_ONLY" : "VERIFIED")))
    expect(artifact.items.map((item) => item.wordingSource)).toEqual(["FALLBACK", "FALLBACK", "FALLBACK", "FALLBACK"])
  })
})

describe("V1.7.1e — tela de QA: prévia completa primeiro, detalhes técnicos à parte (§2–§8, §19, §21)", () => {
  it("A/E) prévia do feedback COMPLETO pelo MESMO renderizador da publicação (o que o QA vê = o que o colaborador recebe)", async () => {
    const { store, result, artifact } = await larissa()
    const review = store.reviews.find((entry) => entry.itemIndex === 0)!
    const detail = toReliableReviewDetail(review, context, { artifact, reviews: store.reviews })
    const preview = detail.feedbackPreview!
    const expected = renderPublishedNarrative(nodeOutputOf(result.record.id, artifact, approveAll(artifact)).items, [], { presentation: nodeOutputOf(result.record.id, artifact, approveAll(artifact)).presentation ?? null, confirmedProducts: confirmedProductsOf(null) })
    expect(preview.parts.map((part) => part.markdown).join("\n\n")).toBe(expected)
    // Feedback por Flag V2 — o nome do cadastro abre a narrativa ("Larissa, você…") ou a saudação.
    expect(preview.parts[0]!.kind === "GREETING" ? preview.parts[0]!.markdown : preview.parts[0]!.markdown.split(",")[0]).toMatch(/Larissa/)
    expect(preview.pending).toBe(4)
    expect(preview.items.map((item) => [item.label, item.statusLabel, item.isCurrent])).toEqual([["Prazo da análise", "Aguardando avaliação", true], ["Prazo da análise", "Aguardando avaliação", false], ["Escuta e identificação da solicitação", "Aguardando avaliação", false], ["Cancelamento da recorrência", "Aguardando avaliação", false]])
    // O bloco composto aponta os DOIS itens (navegação entre os pontos da mesma análise).
    expect(preview.parts.find((part) => part.label === "Prazo da análise")).toMatchObject({ kind: "FINDING", itemIndexes: [0, 1] })
  })

  it("E) decisão registrada vale na prévia: rejeitado sai do texto; editado aparece com o texto do revisor", async () => {
    const { deps, store, artifact } = await larissa()
    const cancel = store.reviews.find((entry) => entry.itemIndex === 3)!
    await decideReliableReview({ store, now: deps.now }, { organizationId: ORG, reviewId: cancel.id, reviewerId: "qa-1", decision: "REJECTED", reasonCategory: "WRONG_FOCUS", comment: null })
    const listen = store.reviews.find((entry) => entry.itemIndex === 2)!
    await decideReliableReview({ store, now: deps.now }, { organizationId: ORG, reviewId: listen.id, reviewerId: "qa-1", decision: "APPROVED_EDITED", reasonCategory: "TONE", comment: null, finalWording: { observed: "Você perguntou qual conta estava sendo questionada e identificou a cobrança que o cliente não reconhecia.", whyItMatters: "", whatYouCanDo: "" } })
    const detail = toReliableReviewDetail(store.reviews[0]!, context, { artifact, reviews: store.reviews })
    const text = detail.feedbackPreview!.parts.map((part) => part.markdown).join("\n\n")
    expect(text).not.toContain("### Cancelamento da recorrência")
    expect(text).toContain("Você perguntou qual conta estava sendo questionada e identificou a cobrança que o cliente não reconhecia.")
    expect(detail.feedbackPreview!.items.map((item) => item.status)).toEqual(["PENDING_REVIEW", "PENDING_REVIEW", "APPROVED_EDITED", "REJECTED"])
    expect(detail.feedbackPreview!.pending).toBe(2)
  })

  it("B/C) motivo do QA em linguagem humana e o efeito real de cada decisão", async () => {
    const { store, artifact } = await larissa()
    const detail = toReliableReviewDetail(store.reviews[0]!, context, { artifact, reviews: store.reviews })
    expect(detail.selection.explanations).toEqual([
      "O redator automático não produziu uma resposta válida, e a INIA usou o texto de segurança — montado só com as falas da chamada e as regras do procedimento. Confira se o texto está claro e útil para o colaborador.",
      "A regra do procedimento citada existe no documento, mas não foi possível confirmar automaticamente que ela se aplica a este momento da chamada. Confira se a regra corresponde ao que aconteceu.",
    ])
    expect(detail.selection.explanations.join(" ")).not.toMatch(/WRITER_|LITERAL_ONLY|estruturalmente/)
    expect(detail.decisionEffects).toEqual({
      summary: "Você está avaliando a qualidade do feedback que a INIA pretende enviar. Aprovar não altera a evidência encontrada; apenas autoriza este texto a seguir no Workflow.",
      approve: "Autoriza este ponto, como está, a seguir no Workflow.",
      edit: "Permite ajustar a redação sem alterar os fatos suportados (falas, regra, documento). O texto editado passa pelas mesmas verificações.",
      reject: "Impede que este ponto seja enviado. Os demais pontos da análise continuam com as próprias avaliações.",
    })
  })

  it("D/F/G/H) detalhes técnicos por ponto (recolhíveis) SEPARADOS do texto; link do processo em cada achado; rótulo do comportamento", async () => {
    const { store, artifact } = await larissa()
    const detail = toReliableReviewDetail(store.reviews[0]!, context, { artifact, reviews: store.reviews })
    expect(detail.findingLabel).toBe("Prazo da análise")
    const first = detail.feedbackPreview!.items.find((item) => item.technical.knowledge?.quote === INTRO)
    expect(first!.technical).toMatchObject({
      internalStep: "Sempre informar prazo de forma objetiva",
      evidenceTypeLabel: "Ação observada na fala",
      facts: [{ speakerLabel: "Operador", text: V171B_LINES.deadline }],
      knowledge: { documentTitle: TITLE, href: `/materiais/${DOC}`, section: "Prazo da análise", version: 3, quote: INTRO, kindLabel: "Regra", operativeRule: { quote: OPERATIVE, reason: expect.stringContaining("frase de abertura") } },
      reliability: { dispositionLabel: "Selecionado para avaliação" },
      wordingSourceLabel: "Texto de segurança (sem redator)",
    })
    // Nenhum dado técnico dentro do texto do feedback.
    const text = detail.feedbackPreview!.parts.map((part) => part.markdown).join("\n\n")
    expect(text).not.toMatch(/OBSERVED_ACTION|LITERAL_ONLY|VERIFIED|evidenceType|checkpoint|RULE_SELECTION/)
    // F) cada achado com base traz o link do processo no próprio bloco.
    // V1.7.2 — nos pontos a ajustar; os cumpridos ("O que manter") trazem o documento só em "Materiais utilizados".
    for (const part of detail.feedbackPreview!.parts.filter((entry) => entry.kind === "FINDING" && entry.section === "OPPORTUNITY")) expect(part.markdown).toContain(`[Abrir processo ↗](/materiais/${DOC})`)
    expect(detail.feedbackPreview!.parts.find((entry) => entry.kind === "MATERIALS")!.markdown).toContain(`/materiais/${DOC}`)
  })
})

describe("V1.7.1e — peças determinísticas da apresentação", () => {
  it("flexão só com forma conhecida (nunca inventa): imperativo, gerúndio, pretérito, substantivo", () => {
    expect([imperativeOf("informar"), imperativeOf("explicar"), imperativeOf("agradecer"), imperativeOf("permitir"), imperativeOf("fazer"), imperativeOf("dormir")]).toEqual(["informe", "explique", "agradeça", "permita", "faça", null])
    expect([gerundOf("cancelar"), gerundOf("permitir"), gerundOf("pôr")]).toEqual(["cancelando", "permitindo", "pondo"])
    expect([preteriteOf("cancelar"), preteriteOf("fazer"), preteriteOf("valor")]).toEqual(["cancelou", "fez", null])
    expect(nominalizeAction("cancelar a recorrência")).toEqual({ phrase: "cancelamento da recorrência", article: "o" })
    expect(nominalizeAction("orientar sobre conta ajustada")).toEqual({ phrase: "orientação sobre conta ajustada", article: "a" })
    expect(nominalizeAction("qualificar o cliente")).toBeNull()
  })
  it("ação da regra e frases evitadas: literal, sem paráfrase", () => {
    expect(ruleActionOf(OPERATIVE)).toEqual({ action: "informar o prazo exibido na ferramenta", items: [], interrogativeItems: false, condition: null })
    expect(ruleActionOf(LISTEN_RULE)).toEqual({ action: "permitir que o cliente explique", items: ["qual conta está questionando", "qual cobrança não reconhece"], interrogativeItems: true, condition: null })
    // V1.7.1k — imperativo de verbo CONHECIDO = a mesma ação no infinitivo; ação composta no imperativo continua sem frase.
    expect(ruleActionOf("Ofereça o envio da segunda via")).toEqual({ action: "oferecer o envio da segunda via", items: [], interrogativeItems: false, condition: null })
    expect(ruleActionOf("Ofereça o envio da segunda via e confirme o canal escolhido")).toBeNull()
    expect(ruleActionOf("Nome do serviço")).toBeNull()
    expect(avoidedPhrasesIn([V171B_LINES.deadline], ["Evitar:\n\n- “É só aguardar.”\n- “Logo será resolvido.”"])).toEqual(["É só aguardar"])
    expect(avoidedPhrasesIn(["Vou verificar o seu prazo."], ["- “Não sei o prazo.”"])).toEqual([])
  })
})

describe("V1.7.1e — rótulo de artefatos anteriores", () => {
  it("nome gravado com numeração da lista (antes da V1.7.1d) também vira o assunto", () => {
    expect(presentationLabelOf({ section: "STRENGTH", process: { stepTitle: "1. Cancelar a recorrência, quando permitido" }, knowledge: { quote: "1. Cancelar a recorrência, quando permitido;", heading: "15. Serviços digitais não reconhecidos", leadIn: "Se o cliente não reconhecer:" } })).toBe("Cancelamento da recorrência")
  })
})
