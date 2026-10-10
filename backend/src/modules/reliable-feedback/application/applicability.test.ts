import { describe, expect, it } from "vitest"
import type { RawApplicability, RawCheckpoint } from "../../agents/domain/process-assessment-contract.js"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { unsupportedSuggestedContentOf } from "../infrastructure/publish-reliable-feedback.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY, RELIABLE_FEEDBACK_PILOT_POLICY, type ReliableFeedbackPolicy } from "../domain/reliable-feedback-item.js"
import { verifyProcessAssessments, type PresentedKnowledgeExcerpt, type PublishedKnowledgeDocument } from "../domain/process-assessment.js"
import { buildApplicabilityItems } from "../domain/applicability-items.js"
import { buildProcessItems } from "../domain/process-items.js"
import { siblingDocumentTitles } from "../domain/applicability-resolution.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import { decideReliableReview } from "./decide-reliable-review.js"

/**
 * V1.7.1b (§26) — APLICABILIDADE: o mesmo processo (mudança de endereço) tem procedimentos diferentes por produto — DDR, SIP e
 * Linha Analógica, cada um com o seu prazo. O sistema nunca escolhe um documento em silêncio e a incerteza nunca vira erro do
 * operador. Zero modelo: a avaliação proposta e o redator são fixtures.
 */
const ORG = "00000000-0000-4000-8000-0000000000bb"
const OPERATOR = "11111111-1111-4111-8111-1111111111bb"
const INTERACTION = "22222222-2222-4222-8222-2222222222bb"
const DOCS = {
  DDR: { id: "33333333-3333-4333-8333-3333333333d1", title: "Mudança de Endereço — DDR", rule: "O prazo da mudança de endereço do DDR é de 5 dias." },
  SIP: { id: "33333333-3333-4333-8333-3333333333d2", title: "Mudança de Endereço — SIP", rule: "O prazo da mudança de endereço do SIP é de 3 dias." },
  ANALOG: { id: "33333333-3333-4333-8333-3333333333d3", title: "Mudança de Endereço — Linha Analógica", rule: "O prazo da mudança de endereço da Linha Analógica é de 7 dias." },
} as const
const STEPS = ["1. Confirmar o novo endereço do cliente;", "2. Informar o prazo da mudança de endereço."]
const contentOf = (doc: (typeof DOCS)[keyof typeof DOCS]) => [`# ${doc.title}`, "", "## Etapas", "", "O operador deverá:", "", ...STEPS, "", "## Prazo", "", doc.rule].join("\n")
const published = new Map<string, PublishedKnowledgeDocument>(Object.values(DOCS).map((doc) => [doc.id, { documentId: doc.id, title: doc.title, content: contentOf(doc), version: 1 }]))
const presented: PresentedKnowledgeExcerpt[] = Object.values(DOCS).map((doc) => ({ documentId: doc.id, documentTitle: doc.title, heading: "Etapas", excerpt: contentOf(doc) }))

const LINES = { address: "Vou confirmar o novo endereço do senhor agora.", deadline: "O prazo é de 5 dias.", product: "Estou vendo aqui que é um DDR." }
const transcript = (options: { product?: boolean; deadline?: string } = {}) =>
  [
    "Operador: Bom dia, em que posso ajudar?",
    "Cliente: Quero mudar o endereço do meu serviço.",
    ...(options.product ? [`Operador: ${LINES.product}`] : []),
    `Operador: ${LINES.address}`,
    "Cliente: Pode confirmar.",
    `Operador: ${options.deadline ?? LINES.deadline}`,
    "Cliente: Obrigado.",
    "Operador: Tenha um bom dia!",
  ].join("\n")

const step = (overrides: Partial<RawCheckpoint> & Pick<RawCheckpoint, "requirement" | "status">): RawCheckpoint => ({ evidenceType: "OBSERVED", transcriptEvidence: [], knowledgeQuote: null, knowledgeDetailQuote: null, guidance: { source: "OFFICIAL_PROCEDURE", text: null }, uncertainty: null, ...overrides })
const CHECKPOINTS = {
  address: step({ requirement: "Confirmar o novo endereço do cliente", status: "FOLLOWED", transcriptEvidence: [LINES.address], knowledgeQuote: "Confirmar o novo endereço do cliente;" }),
  deadline: step({ requirement: "Informar o prazo da mudança de endereço", status: "NOT_FOLLOWED", transcriptEvidence: [LINES.deadline], knowledgeQuote: "Informar o prazo da mudança de endereço." }),
}
const candidates = (keys: (keyof typeof DOCS)[] = ["DDR", "SIP", "ANALOG"]) => keys.map((key) => ({ product: key === "ANALOG" ? "Linha Analógica" : key, documentTitle: DOCS[key].title, ruleQuote: DOCS[key].rule }))
const applicability = (overrides: Partial<RawApplicability> = {}): RawApplicability => ({ status: "AMBIGUOUS", resolvedProduct: null, source: "NONE", evidence: [], candidates: candidates(), operatorStatement: LINES.deadline, ...overrides })
const assessmentWith = (options: { applicability?: RawApplicability[]; product?: string | null; documentTitle?: string } = {}) => ({
  processes: [{ documentTitle: options.documentTitle ?? DOCS.DDR.title, product: options.product === undefined ? "DDR" : options.product, checkpoints: [CHECKPOINTS.address, CHECKPOINTS.deadline] }],
  applicability: options.applicability ?? [applicability()],
})
const verify = (options: Parameters<typeof assessmentWith>[0] & { transcript?: string; subject?: string | null; presented?: PresentedKnowledgeExcerpt[] } = {}) =>
  verifyProcessAssessments({ sources: [{ sourceRef: "AGENT", assessment: assessmentWith(options), presented: options.presented ?? presented }], interactionId: INTERACTION, transcript: options.transcript ?? transcript(), published, subject: options.subject ?? null })

describe("V1.7.1b — resolução de aplicabilidade (§26)", () => {
  it("A) produto dito explicitamente na chamada → CONFIRMED (TRANSCRIPT); o processo do produto é avaliado normalmente", () => {
    const verified = verify({ transcript: transcript({ product: true }), applicability: [applicability({ status: "CONFIRMED", resolvedProduct: "DDR", source: "TRANSCRIPT", evidence: [LINES.product] })] })
    expect(verified.applicability![0]).toMatchObject({ status: "CONFIRMED", resolvedProduct: "DDR", source: "TRANSCRIPT", evidence: [{ quote: LINES.product }] })
    expect(verified.checkpoints.map((checkpoint) => checkpoint.status)).toEqual(["FOLLOWED", "NOT_FOLLOWED"])
    // Mesmo sem o especialista trazer a fala, a menção inequívoca na transcrição confirma.
    expect(verify({ transcript: transcript({ product: true }), applicability: [applicability({ status: "UNKNOWN" })] }).applicability![0]).toMatchObject({ status: "CONFIRMED", source: "TRANSCRIPT" })
  })

  it("B) produto no dado estruturado do atendimento (assunto registrado) → CONFIRMED (SYSTEM_DATA)", () => {
    const verified = verify({ subject: "Mudança de endereço · DDR" })
    expect(verified.applicability![0]).toMatchObject({ status: "CONFIRMED", resolvedProduct: "DDR", source: "SYSTEM_DATA" })
    expect(verified.checkpoints[1]!.status).toBe("NOT_FOLLOWED")
  })

  it("C) indício sem confirmação → INFERRED (o 'CONFIRMED' declarado nunca promove); não vira crítica ao operador", () => {
    const verified = verify({ applicability: [applicability({ status: "CONFIRMED", resolvedProduct: "DDR", source: "TRANSCRIPT", evidence: [] })] })
    expect(verified.applicability![0]).toMatchObject({ declaredStatus: "CONFIRMED", status: "INFERRED", resolvedProduct: "DDR", source: "INFERENCE" })
    expect(verified.checkpoints.map((checkpoint) => [checkpoint.status, checkpoint.statusDowngradeReason])).toEqual([["NOT_OBSERVABLE", "APPLICABILITY_NOT_CONFIRMED"], ["NOT_OBSERVABLE", "APPLICABILITY_NOT_CONFIRMED"]])
    const [item] = buildApplicabilityItems(verified, {}, 0)
    expect(item!.facts[0]!.text).toBe("Há indícios de que o produto tratado seja DDR, mas não foi possível confirmar essa identificação com os dados disponíveis.")
  })

  it("D/F) DDR, SIP e Linha Analógica plausíveis → AMBIGUOUS; nenhuma etapa vira NOT_FOLLOWED; nada é escolhido", () => {
    const verified = verify()
    expect(verified.applicability![0]).toMatchObject({ status: "AMBIGUOUS", resolvedProduct: null })
    expect(verified.applicability![0]!.candidates.map((candidate) => candidate.product)).toEqual(["DDR", "SIP", "Linha Analógica"])
    expect(verified.checkpoints.every((checkpoint) => checkpoint.status === "NOT_OBSERVABLE" && checkpoint.statusDowngradeReason === "APPLICABILITY_NOT_CONFIRMED")).toBe(true)
    expect(buildProcessItems(verified).items).toEqual([])
    expect(verified.summary).toMatchObject({ NOT_FOLLOWED: 0, applicabilityDowngrades: 2 })
  })

  it("E) sem evidência nem candidato verificado → UNKNOWN; nenhum ponto 'Vale confirmar' e nenhum produto inventado", () => {
    const verified = verify({ applicability: [applicability({ candidates: [], operatorStatement: null })] })
    expect(verified.applicability![0]).toMatchObject({ status: "UNKNOWN", resolvedProduct: null, candidates: [] })
    expect(buildApplicabilityItems(verified, {}, 0)).toEqual([])
  })

  it("G) prazo informado compatível com UM candidato → 'compatível com DDR', nunca 'correto'", () => {
    const [item] = buildApplicabilityItems(verify(), {}, 0)
    expect(item!.applicability).toMatchObject({ statementComparison: "COMPATIBLE_WITH_ONE", compatibleProducts: ["DDR"] })
    expect(item!.facts.map((fact) => [fact.role, fact.text])).toEqual([["ANALISE", "Não foi possível identificar com segurança se a solicitação estava relacionada a DDR, SIP ou Linha Analógica."], ["OPERADOR", LINES.deadline]])
  })

  it("H) prazo que não corresponde a nenhum candidato → inconsistência factual, sem fingir qual processo se aplicava", () => {
    const verified = verify({ transcript: transcript({ deadline: "O prazo é de 10 dias." }), applicability: [applicability({ operatorStatement: "O prazo é de 10 dias." })] })
    expect(verified.applicability![0]).toMatchObject({ status: "AMBIGUOUS", statementComparison: "COMPATIBLE_WITH_NONE", compatibleProducts: [] })
  })

  it("I) cada alternativa usa o PRÓPRIO documento e trecho; produto que não está no documento é recusado", () => {
    const verified = verify({ applicability: [applicability({ candidates: [...candidates(), { product: "Fibra", documentTitle: DOCS.DDR.title, ruleQuote: DOCS.DDR.rule }] })] })
    const resolution = verified.applicability![0]!
    expect(resolution.candidates.map((candidate) => [candidate.product, candidate.documentId, candidate.quote, candidate.href])).toEqual([
      ["DDR", DOCS.DDR.id, DOCS.DDR.rule, `/materiais/${DOCS.DDR.id}`],
      ["SIP", DOCS.SIP.id, DOCS.SIP.rule, `/materiais/${DOCS.SIP.id}`],
      ["Linha Analógica", DOCS.ANALOG.id, DOCS.ANALOG.rule, `/materiais/${DOCS.ANALOG.id}`],
    ])
    expect(resolution.rejectedCandidates).toEqual([{ product: "Fibra", documentTitle: DOCS.DDR.title, reason: "PRODUCT_NOT_IN_DOCUMENT" }])
  })

  it("produto confirmado: regra de OUTRO produto não se aplica (NOT_APPLICABLE), nunca 'não seguiu'", () => {
    const verified = verify({ product: "SIP", documentTitle: DOCS.SIP.title, subject: "Mudança de endereço · DDR" })
    expect(verified.checkpoints.map((checkpoint) => [checkpoint.status, checkpoint.statusDowngradeReason])).toEqual([["NOT_APPLICABLE", "APPLICABILITY_OTHER_PRODUCT"], ["NOT_APPLICABLE", "APPLICABILITY_OTHER_PRODUCT"]])
  })

  it("escolha silenciosa entre documentos IRMÃOS (sem aplicabilidade declarada): 'não seguiu' não se sustenta; 'cumpriu' vai ao QA", () => {
    expect(siblingDocumentTitles(DOCS.DDR.title, presented.map((excerpt) => excerpt.documentTitle))).toEqual([DOCS.SIP.title, DOCS.ANALOG.title])
    const verified = verify({ applicability: [], product: null })
    expect(verified.processes[0]).toMatchObject({ applicabilityMode: "UNRESOLVED_SIBLINGS" })
    expect(verified.checkpoints[1]).toMatchObject({ status: "NOT_OBSERVABLE", statusDowngradeReason: "APPLICABILITY_UNRESOLVED" })
    expect(verified.checkpoints[0]).toMatchObject({ status: "FOLLOWED", knowledge: { applicability: "LITERAL_ONLY" } })
    // Sem irmão apresentado, nada muda (retrocompatível).
    expect(verify({ applicability: [], product: null, presented: [presented[0]!] }).checkpoints[1]!.status).toBe("NOT_FOLLOWED")
  })
})

function setup(options: { policy?: ReliableFeedbackPolicy; assessment?: ReturnType<typeof assessmentWith>; transcript?: string } = {}) {
  let writerCalls = 0
  const writer: ReliableFeedbackWriterPort = {
    writeMonitoring: async (input) => {
      writerCalls += 1
      return { rawOutput: { items: input.items.map((item) => { const step = item.checkpoint!.stepTitle!; return item.section === "STRENGTH" ? { slot: item.slot, observed: `Nesta chamada você cumpriu a etapa “${step}”.`, whyItMatters: "", whatYouCanDo: "" } : { slot: item.slot, observed: `Nesta chamada a etapa “${step}” não foi cumprida como o documento orienta.`, whyItMatters: "", whatYouCanDo: "" } }) } }
    },
    writeIndicator: async () => { throw new Error("não usado") },
  }
  const deps: ReliableGenerationDeps = {
    enabled: true,
    store: createInMemoryReliableFeedbackStore(),
    writer,
    policy: options.policy ?? RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async () => ({ transcript: options.transcript ?? transcript(), label: "Atendimento de 25/09/2026 · Mudança de endereço", otherOperatorNames: [] }),
    loadIndicatorContext: async () => null,
    loadPublishedKnowledge: async () => published,
    loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }),
    resolveDiagnosticStrategy: async () => null,
    loadRecipient: async () => ({ firstName: "Rafael" }),
    now: () => new Date("2026-09-25T13:00:00Z"),
  }
  const source = { kind: "monitoring", knowledgeExcerpts: presented, input: { organizationId: ORG, operatorId: OPERATOR, interactionId: INTERACTION, structured: { evidenceFound: LINES.address, observedBehavior: "o", recommendation: "r", processAssessment: options.assessment ?? assessmentWith() } } }
  const request: ReliableGenerationRequest = { organizationId: ORG, enrollmentId: "enr-app", workflowId: "wf", workflowVersionId: "v1", nodeId: "gerar", sourceNodeId: "agente", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: source, collaboratorId: OPERATOR, interactionId: INTERACTION, indicatorMeasurementId: null, configuredAgentId: null }
  return { deps, request, writerCalls: () => writerCalls }
}

describe("V1.7.1b — 'Vale confirmar o produto' no feedback (§19–§21, §24)", () => {
  it("produto ambíguo: ponto do SISTEMA (sem redator, sem QA mesmo no piloto), tabela com as alternativas, 'não é erro' e exemplo de desambiguação", async () => {
    const { deps, request, writerCalls } = setup({ policy: RELIABLE_FEEDBACK_PILOT_POLICY })
    const result = await generateReliableFeedback(deps, request)
    expect(writerCalls()).toBe(0)
    expect(result.nodeOutput.disposition).toBe("READY")
    const [item] = result.nodeOutput.items
    expect(item).toMatchObject({ section: "ATTENTION", sectionLabel: "Vale confirmar o produto", kind: "MONITORING_APPLICABILITY_POINT" })
    expect(result.record.artifact!.items[0]!.decision).toMatchObject({ disposition: "READY", reasons: ["SYSTEM_RENDERED_NEUTRAL"] })
    const text = result.nodeOutput.text
    // Feedback Experience V2 — o nome entra como vocativo natural na abertura (sem saudação-modelo).
    expect(text).toContain("Rafael, em um ponto, o produto tratado ficou em aberto")
    expect(text).toContain("## Pontos de atenção")
    expect(text).toContain("> Você disse: “O prazo é de 5 dias.”")
    expect(text).toContain("O que você informou é compatível com o procedimento de DDR. Como o produto não foi confirmado, não dá para afirmar que era o procedimento aplicável a este atendimento.")
    expect(text).toContain("| Produto | O que a base prevê | Documento |")
    expect(text).toContain(`| SIP | “O prazo da mudança de endereço do SIP é de 3 dias.” | [${DOCS.SIP.title} ↗](/materiais/${DOCS.SIP.id}) |`)
    expect(text).toContain("este ponto não é classificado como erro")
    expect(text).toContain("**Pontos que ficaram sem avaliação:** “Confirmar o novo endereço do cliente” · “Informar o prazo da mudança de endereço”")
    expect(text).toContain("_“Antes de seguir, vou confirmar qual produto está vinculado à sua solicitação, porque o procedimento muda conforme o serviço: é DDR, SIP ou Linha Analógica?”_")
    expect(text).not.toMatch(/você errou|está correto|você acertou|não identificou o produto/i)
    // Cada alternativa carrega o próprio documento como material; o exemplo nunca traz o valor de um candidato.
    expect(text).toContain(`- [${DOCS.ANALOG.title} ↗](/materiais/${DOCS.ANALOG.id}) — utilizado em: Confirmar o produto (Linha Analógica)`)
    expect(unsupportedSuggestedContentOf(result.nodeOutput.items)).toEqual([])
    const tampered = result.nodeOutput.items.map((entry) => ({ ...entry, wording: { ...entry.wording, suggestedResponse: "Para o DDR o prazo é de 5 dias." } }))
    expect(unsupportedSuggestedContentOf(tampered)).toContain("EXAMPLE_CONTENT_AS_FACT")
  })

  it("produto confirmado: etapas avaliadas normalmente e a visão geral diz de onde veio a confirmação", async () => {
    const { deps, request } = setup({ transcript: transcript({ product: true }), assessment: assessmentWith({ applicability: [applicability({ status: "CONFIRMED", resolvedProduct: "DDR", evidence: [LINES.product] })] }) })
    const first = await generateReliableFeedback(deps, request)
    expect(first.record.artifact!.items.map((item) => item.section)).toEqual(["OPPORTUNITY", "STRENGTH"])
    // O prazo tem regra só literal (sem âncora de 2 termos na fala) → QA; aprovado, o feedback sai.
    for (const review of first.reviews) await decideReliableReview({ store: deps.store, now: deps.now }, { organizationId: ORG, reviewId: review.id, reviewerId: "qa", decision: "APPROVED_UNCHANGED" })
    const result = await generateReliableFeedback(deps, request)
    expect(result.nodeOutput.disposition).toBe("READY")
    const text = result.nodeOutput.text
    expect(text).toContain("Produto identificado: DDR (confirmado pela fala da chamada).")
    expect(text).not.toContain("Vale confirmar o produto")
  })
})

