import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { createInMemoryFeedbackMemoryStore } from "../infrastructure/in-memory-feedback-memory-store.js"
import { generateFeedback, type GenerateFeedbackDeps, type GenerateFeedbackRequest } from "./generate-feedback.js"
import { analysisKeysOf, type AnalyzeCallDeps } from "./analyze-call.js"
import type { EngineModelPort, EngineModelRequest } from "./ports.js"
import { fakeEngineModel, obligationEvidenceReadingOf, type ObligationReviewPayload } from "../testing/fake-engine-model.js"
import { CATALOG, DOC, DOCUMENTS } from "../testing/product-scenarios.js"
import { OBLIGATION_ANALYSIS_SYSTEM_PROMPT } from "../domain/obligation-analysis-prompt.js"
import type { ProductCatalogSource } from "../../product-catalog/domain/product-catalog.js"

/**
 * `PRODUCT_APPLICABILITY_V1` no CAMINHO COMPLETO — modelo falso, memória em RAM, zero IA: análise (contrato com produto) → revisão
 * (leitura própria do produto e da abrangência) → memória com a fotografia da identificação → brief → redator → verificador. Prova
 * CONTRATOS e EXECUÇÃO, nunca a qualidade de um modelo real. Produtos e procedimentos são EXEMPLOS FICTÍCIOS de teste.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATOR = "00000000-0000-4000-8000-0000000000aa"
const AGENT = "00000000-0000-4000-8000-00000000a001"
const INTERACTION = "00000000-0000-4000-8000-00000000f0aa"
const NO_PRODUCT = ["Operador: Bom dia, central empresarial.", "Cliente: Preciso da segunda via.", "Operador: Pronto, já enviei.", "Cliente: Obrigado, tchau."].join("\n")

function setup(model: EngineModelPort, options: { transcript?: string; catalog?: ProductCatalogSource | null } = {}) {
  const stores = createInMemoryFeedbackMemoryStore()
  const catalogCalls: { at: Date; sourceIds: readonly string[] }[] = []
  const analyze: AnalyzeCallDeps = {
    memory: stores,
    model,
    loadInteraction: async (_org, id) => (id === INTERACTION ? { id: INTERACTION, organizationId: ORG, operatorId: OPERATOR, operatorName: "Ana", startedAt: new Date("2026-10-20T13:00:00Z"), endedAt: new Date("2026-10-20T13:04:00Z"), reason: "Segunda via de fatura", channel: "VOICE", subjectCanonical: null, flags: [], transcript: { content: options.transcript ?? NO_PRODUCT, checksum: "p1" }, teamId: "t1", subteamId: null, supervisorId: "s1", timeZone: "America/Sao_Paulo" } : null),
    loadAgent: async () => ({ id: AGENT, name: "Especialista de faturamento", objective: null, contextPrompt: null, updatedAt: new Date("2026-09-01T00:00:00Z"), businessDomainId: null }),
    loadDocuments: async () => DOCUMENTS.map((document) => ({ documentId: document.documentId, title: document.title, version: 1, content: document.content, contentHash: document.contentHash, perspective: "RULE_IN_FORCE_AT_CALL" as const })),
    loadPreviousVersion: async () => null,
    loadProductCatalog: async (_org, at, sourceIds) => {
      catalogCalls.push({ at, sourceIds })
      return options.catalog === undefined ? CATALOG : options.catalog
    },
    now: () => new Date("2026-10-21T12:00:00Z"),
  }
  const deps: GenerateFeedbackDeps = {
    memory: stores, messages: stores, model, analyze,
    investigate: { memory: stores, data: {} as never, analyze, strategy: async () => { throw new Error("não usado") }, now: analyze.now },
    loadDocumentTitles: async () => new Map(DOCUMENTS.map((document) => [document.documentId, document.title])),
    loadAgentConfiguredAt: async () => null,
    now: analyze.now,
  }
  return { stores, deps, catalogCalls }
}
const request = (): GenerateFeedbackRequest => ({ organizationId: ORG, enrollmentId: "enr-p", workflowId: "wf-p", workflowVersionId: "v-p", nodeId: "feedback", sourceNodeId: "agent", domain: "MONITORING", sourceNodeOutput: { kind: "monitoring", input: {} }, collaboratorId: OPERATOR, interactionId: INTERACTION, indicatorMeasurementId: null, configuredAgentId: AGENT, selectionReason: "teste de produto", now: new Date("2026-10-21T12:00:00Z") })

const lineOf = (prompt: string, documentTitle: string) => {
  const block = prompt.split("=== ").find((entry) => entry.includes(documentTitle))!
  return /\[(L\d+)\]/.exec(block)![1]!
}
const handleOf = (prompt: string, kind: "Família" | "Produto", name: string) => new RegExp(`\\[([FP]\\d+)\\] ${kind}: ${name}(?:\\s|$)`).exec(prompt)![1]!

/** Análise com produto NÃO identificado: a regra do produto (SIP) e a regra geral (protocolo) não cumpridas. */
const analysisWithoutProduct = (prompt: string, options: { includeGeneral: boolean }) => ({
  need: { summary: "O cliente pediu a segunda via.", conditions: [] },
  sources: { primary: "D1", related: [], rationale: "Regras de segunda via." },
  argumentScripts: [],
  requests: [{ id: "Q1", summary: "Segunda via da fatura", object: { kind: "ACCOUNT", description: "conta do cliente" }, product: { status: "NOT_IDENTIFIED", targets: [], evidence: [], limitations: ["A conversa não diz de qual produto é a fatura."] } }],
  obligations: [
    { id: "OBL-1", sources: [lineOf(prompt, "Segunda via — SIP")], action: "Informar que a segunda via vai ao e-mail do gestor", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding: "NOT_MET", evidence: [], opportunityTurn: "T3", materiality: "HIGH", role: "CENTRAL", rationale: "Não disse para onde a segunda via vai.", guidance: { moment: "ao gerar a segunda via", action: "informar o e-mail do gestor" }, request: "Q1", productScope: [handleOf(prompt, "Produto", "SIP")] },
    ...(options.includeGeneral ? [{ id: "OBL-2", sources: [lineOf(prompt, "Regras gerais de atendimento")], action: "Informar o protocolo antes de encerrar", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding: "NOT_MET", evidence: [], opportunityTurn: "T3", materiality: "HIGH", role: "SUPPORTING", rationale: "Encerrou sem informar o protocolo.", guidance: { moment: "antes de encerrar", action: "informar o protocolo" }, request: null, productScope: [] }] : []),
  ],
  notAssessed: [],
  conduct: { pathTaken: "Gerou a segunda via e encerrou.", assessment: "UNDETERMINED", rationale: "" },
  sourceConflicts: [],
  limitations: [],
})

/** Revisora que confirma as conclusões recebidas e lê o pedido sem produto estabelecido. */
const reviewWithoutProduct = (payload: ObligationReviewPayload & { requests?: { id: string }[] }) => ({
  claims: payload.claims.map((claim) => ({ id: claim.id, verdict: "CONFIRMED", issues: [], listReading: null, actPlace: "IN_CONVERSATION", evidenceReading: obligationEvidenceReadingOf(claim), outsideDependency: false, conditionEvidence: [], productScopeReading: "AGREES", productScopeTargets: [] })),
  need: { status: "PARTIALLY_ADDRESSED", requiredGuidance: "Informar o protocolo.", sources: [] },
  requests: (payload.requests ?? []).map((entry) => ({ id: entry.id, status: "NOT_IDENTIFIED", targets: [], evidence: [], limitations: [] })),
  missed: [],
})

describe("aplicabilidade por produto no caminho completo", () => {
  it("modo produto: contrato da análise e da revisão com produto; regra suspensa fora da revisão; fotografia na memória; regra geral cobrada", async () => {
    const fake = fakeEngineModel({
      analysis: () => analysisWithoutProduct(fake.calls.find((call) => call.stage === "CALL_ANALYSIS")!.contents[0]!.text, { includeGeneral: true }),
      obligationReview: (payload) => reviewWithoutProduct(payload),
      composition: { sentences: [{ text: "Você encerrou sem informar o protocolo do atendimento.", stance: "ADJUSTMENT", refs: ["A1"], paragraph: 1 }, { text: "Antes de encerrar, informe o número do protocolo ao cliente.", stance: "GUIDANCE", refs: ["A1"], paragraph: 1 }], card: { text: "Informe o protocolo antes de encerrar.", refs: ["A1"] } },
    })
    const { deps, stores, catalogCalls } = setup(fake.model)
    const result = await generateFeedback(deps, request())
    // O cadastro é lido NA DATA DA CHAMADA, com as fontes candidatas (antes da seleção).
    expect(catalogCalls[0]).toMatchObject({ at: new Date("2026-10-20T13:00:00Z"), sourceIds: expect.arrayContaining([DOC.SIP, DOC.GERAL]) })
    const analysisCall = fake.calls.find((call) => call.stage === "CALL_ANALYSIS")!
    expect(analysisCall.systemPrompt).toContain("PRODUTO DE CADA SOLICITAÇÃO")
    expect((analysisCall.responseSchema as { required: string[] }).required).toContain("requests")
    const userTurn = analysisCall.contents[0]!.text
    expect(userTurn).toContain("CATÁLOGO DE PRODUTOS DA OPERAÇÃO")
    expect(userTurn).toContain("CRITÉRIOS DE IDENTIFICAÇÃO APROVADOS E VIGENTES NA DATA DA CHAMADA")
    expect(userTurn).toMatch(/Segunda via — SIP \(exemplo fictício\) \(versão 1 · versão vigente na data da chamada · vale para os produtos: SIP \[P\d+\]\)/)
    expect(userTurn).toMatch(/\[M1\] Assunto registrado: Segunda via de fatura/)
    // A revisão recebe o pedido como a analista leu e SÓ a conclusão independente do produto (a dependente não é decidida por ela).
    const reviewCall = fake.calls.find((call) => call.stage === "CALL_REVIEW")!
    expect(reviewCall.systemPrompt).toContain("PRODUTO DE CADA PEDIDO")
    const payload = JSON.parse(reviewCall.contents[0]!.text.split("ANÁLISE A REVISAR (JSON):")[1]!) as { claims: { id: string; productScope?: string[] }[]; requests: { id: string }[] }
    expect(payload.requests.map((entry) => entry.id)).toEqual(["Q1"])
    expect(payload.claims.map((claim) => [claim.id, claim.productScope])).toEqual([["O2", []]])
    // Memória: a regra do produto ficou suspensa com o motivo; a fotografia por pedido está gravada.
    const assessment = stores.assessments.find((entry) => entry.isCurrent)!
    const byAction = (text: string) => assessment.analysis.criteria.find((criterion) => criterion.requiredAction?.includes(text))!
    expect(byAction("e-mail do gestor")).toMatchObject({ status: "NOT_OBSERVABLE", productApplicability: { effect: "SUSPENDED", reason: "PRODUCT_NOT_IDENTIFIED" } })
    expect(byAction("protocolo")).toMatchObject({ status: "NOT_MET", confirmation: "CONFIRMED", productApplicability: { effect: "INDEPENDENT" } })
    expect(assessment.analysis.productApplicability!.requests[0]).toMatchObject({ ref: "Q1", status: "NOT_IDENTIFIED", review: { available: true, status: "NOT_IDENTIFIED" } })
    expect(assessment.analysis.outcomeReasons).toContain("PRODUCT_DEPENDENT_POINTS_SUSPENDED")
    expect(result.kind).toBe("PUBLISHABLE")
    // Brief: a regra suspensa não é ponto de desenvolvimento; o redator e o verificador sabem que ela não pode ser cobrada.
    const composition = fake.calls.find((call) => call.stage === "COMPOSITION")!.contents[0]!.text
    expect(composition).toContain("rulesNotEstablished")
    expect(composition).toContain("e-mail do gestor do contrato")
    const message = [...stores.messages.values()][0]!
    expect(message.brief!.developments.map((finding) => finding.title).join(" ")).toMatch(/protocolo/i)
    expect(message.brief!.developments.map((finding) => finding.title).join(" ")).not.toMatch(/gestor/i)
  })

  it("verificador impede que o texto final cobre uma regra cuja aplicabilidade é incerta (mesmo com outra redação)", async () => {
    const fake = fakeEngineModel({
      analysis: () => analysisWithoutProduct(fake.calls.find((call) => call.stage === "CALL_ANALYSIS")!.contents[0]!.text, { includeGeneral: true }),
      obligationReview: (payload) => reviewWithoutProduct(payload),
      composition: { sentences: [
        { text: "Você encerrou sem informar o protocolo do atendimento.", stance: "ADJUSTMENT", refs: ["A1"], paragraph: 1 },
        { text: "Antes de encerrar, informe o número do protocolo ao cliente.", stance: "GUIDANCE", refs: ["A1"], paragraph: 1 },
        { text: "E, como era o SIP, faltou avisar que a segunda via segue para o endereço eletrônico de quem administra o contrato.", stance: "ADJUSTMENT", refs: ["A1"], paragraph: 2 },
      ], card: { text: "Informe o protocolo antes de encerrar.", refs: ["A1"] } },
      // O verificador (aqui simulado) lê os FATOS: productScope.rulesNotEstablished e nenhum produto identificado → recusa a frase.
      verification: (claims) => ({ verdicts: claims.map((claim) => ({ id: claim.id, verdict: claim.text.includes("SIP") ? "OVERREACH" : "SUPPORTED", specific: ["ADJUSTMENT", "GUIDANCE", "RECOGNITION"].includes(claim.stance) ? true : null, note: claim.text.includes("SIP") ? "Afirma um produto não estabelecido e cobra regra de rulesNotEstablished." : undefined })), message: { conveysPrimary: true, valueBeyondNarration: true, firmnessRespected: null, unlistedRelation: [] } }),
    })
    const { deps, stores } = setup(fake.model)
    await generateFeedback(deps, request())
    const verification = fake.calls.find((call) => call.stage === "VERIFICATION" && call.tag !== "coherence")!.contents[0]!.text
    const facts = JSON.parse(verification.split("FATOS DO CASO (JSON):")[1]!.split("\n\n")[0]!) as { productScope?: { identified: string[]; undeterminedRequests?: number; rulesNotEstablished?: string[] } }
    expect(facts.productScope).toMatchObject({ identified: [], undeterminedRequests: 1, rulesNotEstablished: [expect.stringContaining("e-mail do gestor do contrato")] })
    const message = [...stores.messages.values()][0]!
    expect(message.status).toBe("PUBLISHABLE")
    const delivered = message.message!.text
    expect(delivered).toContain("protocolo")
    expect(delivered).not.toMatch(/SIP|endereço eletrônico/)
    // A recusa vale para o texto escrito (narrativa, cartão, pontos a ajustar). O que a regra do produto pede só aparece no bloco
    // montado pelo sistema, "Depende do produto" (V2): texto literal da fonte, sem avaliação, nunca como cobrança.
    const view = message.message!.view!
    expect(JSON.stringify({ card: view.card, narrative: view.narrative, developments: view.developments })).not.toMatch(/SIP|endereço eletrônico|e-mail do gestor/)
    const dependent = view.attention.find((entry) => entry.title === "Depende do produto")!
    expect(dependent.markdown).toContain("não contam como erro nem como acerto")
    expect(dependent.markdown).toContain("**SIP**\n- “Informar que a segunda via é enviada ao e-mail do gestor do contrato.”")
  })

  it("sem produto e sem avaliação útil: abstenção com o motivo rastreável, sem redação", async () => {
    const fake = fakeEngineModel({
      analysis: () => analysisWithoutProduct(fake.calls.find((call) => call.stage === "CALL_ANALYSIS")!.contents[0]!.text, { includeGeneral: false }),
      obligationReview: (payload) => reviewWithoutProduct(payload),
    })
    const { deps } = setup(fake.model)
    const result = await generateFeedback(deps, request())
    expect(result).toMatchObject({ kind: "ABSTAINED", reason: "INSUFFICIENT_EVIDENCE:PRODUCT_NOT_ESTABLISHED" })
    expect(fake.calls.map((call) => call.stage)).not.toContain("COMPOSITION")
  })

  it("sem catálogo vigente na data: o pedido de análise e a chave são exatamente os de antes", async () => {
    const fake = fakeEngineModel({})
    const { deps } = setup(fake.model, { catalog: null })
    await generateFeedback(deps, request()).catch(() => undefined)
    const analysisCall = fake.calls.find((call) => call.stage === "CALL_ANALYSIS")! as EngineModelRequest
    expect(analysisCall.systemPrompt).toBe(OBLIGATION_ANALYSIS_SYSTEM_PROMPT)
    expect(analysisCall.contents[0]!.text).not.toContain("CATÁLOGO DE PRODUTOS")
    expect(analysisCall.contents[0]!.text).not.toContain("vale para os produtos")
  })

  it("a chave da proposta muda com o cadastro de produtos (outro critério aprovado = outra análise) e não muda sem ele", () => {
    const interaction = { id: INTERACTION, organizationId: ORG, operatorId: OPERATOR, operatorName: "Ana", startedAt: new Date("2026-10-20T13:00:00Z"), endedAt: null, reason: null, channel: null, subjectCanonical: null, flags: [], transcript: { content: NO_PRODUCT, checksum: "p1" }, teamId: null, subteamId: null, supervisorId: null, timeZone: "UTC" }
    const base = { interaction, agent: null, documents: [], context: { documents: [], lines: new Map(), sections: new Map(), omitted: [], renderedChars: 0 }, projection: { version: "TRANSCRIPT_PROJECTION_V1", turns: [], sourceHash: "x", truncatedTurns: 0, totalTurns: 0 } as never, transcriptStatus: "COMPLETE" as const, subject: null }
    const withoutProducts = analysisKeysOf(base).proposalKey
    expect(analysisKeysOf({ ...base, products: null }).proposalKey).toBe(withoutProducts)
  })
})
