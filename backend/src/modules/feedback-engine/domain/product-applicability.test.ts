import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { analysis, CATALOG, confirmingReview, DOC, evidence, obligation, productWorld, reading, request, verifyWithReview } from "../testing/product-scenarios.js"
import { buildMonitoringBrief } from "./feedback-brief.js"
import { compositionPayloadOf, verificationFactsOf } from "./composition-prompt.js"
import { OBLIGATION_ANALYSIS_RESPONSE_SCHEMA, OBLIGATION_ANALYSIS_SYSTEM_PROMPT, obligationAnalysisContractFor } from "./obligation-analysis-prompt.js"
import { obligationReviewContractFor, OBLIGATION_REVIEW_SYSTEM_PROMPT } from "./obligation-review.js"
import { productDependentMarkdownOf } from "./feedback-view.js"
import { maskIdentifiers, productContextOf, productIdentificationViewOf } from "./product-applicability.js"
import type { VerifiedCallAnalysis } from "./call-analysis.js"

/**
 * `PRODUCT_APPLICABILITY_V1` — aplicabilidade por produto ANTES do julgamento (zero IA: as leituras do modelo são escritas aqui).
 * Cada cenário prova uma decisão do CÓDIGO a partir das leituras e da integridade: nenhuma palavra da conversa decide produto — as
 * mesmas palavras com outra leitura (negação, hipótese, outro contrato, correção) dão outra decisão, e outras palavras com a mesma
 * leitura dão a mesma. Os produtos, prefixos e procedimentos são EXEMPLOS FICTÍCIOS de teste.
 */
const effectOf = (result: VerifiedCallAnalysis, lineHandle: string) => result.criteria.find((criterion) => criterion.lineHandle === lineHandle)
const requestOf = (result: VerifiedCallAnalysis, ref = "Q1") => result.productApplicability!.requests.find((entry) => entry.ref === ref)!
const briefOf = (result: VerifiedCallAnalysis) => buildMonitoringBrief({ analysis: result, interactionId: "i-prod", label: "Segunda via", dateLabel: "21/10/2026", selectionReason: "teste", criterionKeys: new Map(), documentTitles: new Map(), documentVersions: new Map(), history: new Map(), delivered: new Set() })

const SAY = (lines: string[]) => lines.join("\n")

describe("segunda via com produto explícito e procedimento correspondente", () => {
  const transcript = SAY(["Operador: Bom dia, central empresarial.", "Cliente: Preciso da segunda via da fatura da minha linha SIP.", "Operador: Certo, vou gerar a segunda via agora.", "Cliente: Obrigado.", "Operador: Mais alguma coisa? Tenha um bom dia."])
  it("cliente diz o produto do pedido → identificado; a regra do produto é cobrada e a regra geral continua independente", () => {
    const world = productWorld(transcript)
    const SIP = world.node("SIP")
    const model = analysis([
      obligation({ id: "OBL-1", sources: [world.line(DOC.SIP)], action: "Informar o envio ao e-mail do gestor", finding: "NOT_MET", opportunityTurn: "T3", request: "Q1", productScope: [SIP] }),
      obligation({ id: "OBL-2", sources: [world.line(DOC.GERAL)], action: "Informar o protocolo", finding: "NOT_MET", opportunityTurn: "T5", request: undefined, productScope: [] }),
    ], [request("Q1", "IDENTIFIED", [SIP], [evidence({ kind: "CUSTOMER_STATEMENT", turn: "T2", speaker: "Cliente", quote: "segunda via da fatura da minha linha SIP", relation: "OBJECT_OF_REQUEST", supports: [SIP] })])])
    const { result, sentClaims } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "IDENTIFIED", [SIP], [evidence({ kind: "CUSTOMER_STATEMENT", turn: "T2", speaker: "Cliente", quote: "minha linha SIP", relation: "OBJECT_OF_REQUEST", supports: [SIP] })])]))
    expect(sentClaims.map((claim) => claim.id)).toEqual(["O1", "O2"])
    // A revisora recebe a abrangência lida (nome do cadastro) para conferir.
    expect(sentClaims[0]!.productScope).toEqual([`${SIP} SIP`])
    expect(effectOf(result, "O1")).toMatchObject({ status: "NOT_MET", confirmation: "CONFIRMED", productApplicability: { effect: "ESTABLISHED", request: "Q1" } })
    expect(effectOf(result, "O2")).toMatchObject({ status: "NOT_MET", productApplicability: { effect: "INDEPENDENT", scope: "ALL" } })
    expect(requestOf(result)).toMatchObject({ status: "IDENTIFIED", identified: SIP, possible: [SIP], conflict: false })
    expect(result.outcome).toBe("USABLE")
    expect(briefOf(result).productScope).toEqual({ identified: [{ request: "Q1", name: "SIP", kind: "PRODUCT" }], undetermined: 0, rulesNotEstablished: [] })
  })

  it("paráfrase sem o nome do produto, lida como o mesmo produto → mesma decisão (o código não procura palavras)", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: Preciso da segunda via do serviço de voz da empresa, aquele que liga pela internet.", "Operador: Certo, vou gerar a segunda via agora."]))
    const SIP = world.node("SIP")
    const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.SIP)], action: "Informar o envio ao e-mail do gestor", finding: "NOT_MET", opportunityTurn: "T3", request: "Q1", productScope: [SIP] })], [request("Q1", "IDENTIFIED", [SIP], [evidence({ kind: "CUSTOMER_STATEMENT", turn: "T2", speaker: "Cliente", quote: "serviço de voz da empresa, aquele que liga pela internet", relation: "OBJECT_OF_REQUEST", supports: [SIP] })])])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "IDENTIFIED", [SIP], [evidence({ kind: "CUSTOMER_STATEMENT", turn: "T2", speaker: "Cliente", quote: "serviço de voz da empresa", relation: "OBJECT_OF_REQUEST", supports: [SIP] })])]))
    expect(effectOf(result, "O1")).toMatchObject({ status: "NOT_MET", productApplicability: { effect: "ESTABLISHED" } })
  })

  it("o nome do produto aparece, mas negado: mesma palavra, outra leitura → não identificado; a regra do produto fica sem avaliação", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: Preciso da segunda via. Não é a linha SIP, essa eu já cancelei.", "Operador: Certo, vou gerar a segunda via agora."]))
    const SIP = world.node("SIP")
    // Leitura ERRADA da análise (declara SIP), com a única evidência lida como negação: o código fica com o que as evidências sustentam.
    const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.SIP)], action: "Informar o envio ao e-mail do gestor", finding: "NOT_MET", opportunityTurn: "T3", request: "Q1", productScope: [SIP] })], [request("Q1", "IDENTIFIED", [SIP], [evidence({ kind: "CUSTOMER_STATEMENT", turn: "T2", speaker: "Cliente", quote: "Não é a linha SIP", relation: "NEGATED", supports: [SIP] })])])
    const { result, sentClaims } = verifyWithReview(world, model, (claims) => confirmingReview(claims, []))
    expect(sentClaims).toEqual([])
    expect(requestOf(result)).toMatchObject({ status: "NOT_IDENTIFIED", possible: null, reasons: expect.arrayContaining(["DECLARED_IDENTIFICATION_WITHOUT_ESTABLISHING_EVIDENCE"]) })
    expect(requestOf(result).evidence[0]).toMatchObject({ role: "NOT_ABOUT_REQUEST", reason: "RELATION_NEGATED" })
    expect(effectOf(result, "O1")).toMatchObject({ status: "NOT_OBSERVABLE", applicability: "UNCERTAIN", guidance: null, productApplicability: { effect: "SUSPENDED", reason: "PRODUCT_NOT_IDENTIFIED" } })
    expect(effectOf(result, "O1")!.confirmationReasons).toContain("PRODUCT_APPLICABILITY_NOT_ESTABLISHED")
  })
})

describe("indício que identifica apenas uma família", () => {
  it("critério conclusivo de família: regra da família avaliada; regra de um produto da família fica suspensa", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: Segunda via, por favor. A conta é 899 1234 5678.", "Operador: De qual mês é a fatura?", "Cliente: De setembro.", "Operador: Pronto, já pode baixar."]))
    const [BASICOS, BL] = [world.node("BASICOS"), world.node("BANDA_LARGA")]
    const model = analysis([
      obligation({ id: "OBL-1", sources: [world.line(DOC.BASICOS)], action: "Confirmar o mês de referência", finding: "MET", evidence: [{ turn: "T3", speaker: "Operador", quote: "De qual mês é a fatura?", role: "CONDUCT" }], request: "Q1", productScope: [BASICOS] }),
      obligation({ id: "OBL-2", sources: [world.line(DOC.BANDA_LARGA)], action: "Orientar a emissão pelo aplicativo", finding: "NOT_MET", opportunityTurn: "T5", request: "Q1", productScope: [BL] }),
    ], [request("Q1", "FAMILY_ONLY", [BASICOS], [evidence({ kind: "IDENTIFIER", turn: "T2", speaker: "Cliente", quote: "A conta é 899 1234 5678", criterion: world.crit("Conta iniciada em 899"), conditionsHold: "YES", transcription: "CLEAR", relation: "OBJECT_OF_REQUEST", supports: [BASICOS] })])])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "FAMILY_ONLY", [BASICOS], [evidence({ kind: "IDENTIFIER", turn: "T2", speaker: "Cliente", quote: "899 1234 5678", criterion: world.crit("Conta iniciada em 899"), conditionsHold: "YES", transcription: "CLEAR", relation: "OBJECT_OF_REQUEST", supports: [BASICOS] })])]))
    expect(requestOf(result)).toMatchObject({ status: "FAMILY_ONLY", identified: BASICOS })
    expect(effectOf(result, "O1")).toMatchObject({ status: "MET", productApplicability: { effect: "ESTABLISHED" } })
    expect(effectOf(result, "O2")).toMatchObject({ status: "NOT_OBSERVABLE", productApplicability: { effect: "SUSPENDED", reason: "ONLY_FAMILY_ESTABLISHED" } })
    // O número fica registrado só com os 4 primeiros dígitos; o critério com a versão usada.
    expect(requestOf(result).evidence[0]).toMatchObject({ quote: "A conta é 899 1••• ••••", criterion: { title: "Conta iniciada em 899", version: 1, strength: "CONCLUSIVE" }, role: "ESTABLISHING", origin: "RECORDING" })
  })
})

describe("identificador compatível com dois produtos de procedimentos diferentes", () => {
  it("nenhum dos dois procedimentos é cobrado; a regra geral continua avaliada", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: A conta é 12345678901, preciso da segunda via.", "Operador: Pronto, gerada.", "Operador: Seu protocolo é 555. Obrigado."]))
    const [BL, DDR] = [world.node("BANDA_LARGA"), world.node("DDR")]
    const model = analysis([
      obligation({ id: "OBL-1", sources: [world.line(DOC.BANDA_LARGA)], action: "Orientar pelo aplicativo", finding: "NOT_MET", opportunityTurn: "T3", request: "Q1", productScope: [BL] }),
      obligation({ id: "OBL-2", sources: [world.line(DOC.DDR)], action: "Informar o portal empresarial", finding: "NOT_MET", opportunityTurn: "T3", request: "Q1", productScope: [DDR] }),
      obligation({ id: "OBL-3", sources: [world.line(DOC.GERAL)], action: "Informar o protocolo", finding: "MET", evidence: [{ turn: "T4", speaker: "Operador", quote: "Seu protocolo é 555.", role: "CONDUCT" }], productScope: [] }),
    ], [request("Q1", "MULTIPLE_POSSIBLE", [BL, DDR], [evidence({ kind: "IDENTIFIER", turn: "T2", speaker: "Cliente", quote: "A conta é 12345678901", criterion: world.crit("Número com 11 dígitos"), conditionsHold: "YES", transcription: "CLEAR", relation: "OBJECT_OF_REQUEST", supports: [BL, DDR] })])])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "MULTIPLE_POSSIBLE", [BL, DDR], [evidence({ kind: "IDENTIFIER", turn: "T2", speaker: "Cliente", quote: "12345678901", criterion: world.crit("Número com 11 dígitos"), conditionsHold: "YES", transcription: "CLEAR", relation: "OBJECT_OF_REQUEST", supports: [BL, DDR] })])]))
    expect(requestOf(result)).toMatchObject({ status: "MULTIPLE_POSSIBLE", possible: [BL, DDR] })
    expect(effectOf(result, "O1")!.productApplicability).toMatchObject({ effect: "SUSPENDED", reason: "SEVERAL_PRODUCTS_POSSIBLE" })
    expect(effectOf(result, "O2")!.productApplicability).toMatchObject({ effect: "SUSPENDED", reason: "SEVERAL_PRODUCTS_POSSIBLE" })
    expect(effectOf(result, "O3")).toMatchObject({ status: "MET", productApplicability: { effect: "INDEPENDENT" } })
    // Nunca escolhe um dos dois como padrão: nenhum procedimento de produto chega à mensagem.
    const brief = briefOf(result)
    expect(brief.developments).toEqual([])
    expect(brief.productScope!.rulesNotEstablished.map((rule) => rule.text)).toEqual(expect.arrayContaining([expect.stringContaining("aplicativo"), expect.stringContaining("portal empresarial")]))
    // V2: o que cada produto possível pede, agrupado pelo cadastro e com o texto literal da fonte — informação, nunca avaliação.
    expect(brief.productScope!.byProduct!.map((group) => [group.products, group.rules.map((rule) => rule.text)])).toEqual([
      [["Banda larga"], [expect.stringContaining("pelo aplicativo")]],
      [["DDR"], [expect.stringContaining("portal empresarial em até 2 dias úteis")]],
    ])
    const markdown = productDependentMarkdownOf(brief.productScope!.byProduct!)!
    expect(markdown).toContain("não contam como erro nem como acerto")
    expect(markdown).toContain("**Banda larga**\n- “Orientar a emissão da segunda via pelo aplicativo.”")
    expect(markdown).toContain("**DDR**\n- “Informar que a segunda via fica no portal empresarial em até 2 dias úteis.”")
  })
})

describe("ausência de produto", () => {
  const transcript = SAY(["Operador: Bom dia.", "Cliente: Preciso da segunda via.", "Operador: Pronto, já enviei.", "Cliente: Obrigado, tchau."])
  it("preserva a avaliação independente válida: a regra geral é cobrada, a do produto fica sem avaliação e fora da mensagem", () => {
    const world = productWorld(transcript)
    const SIP = world.node("SIP")
    const model = analysis([
      obligation({ id: "OBL-1", sources: [world.line(DOC.SIP)], action: "Informar o envio ao e-mail do gestor", finding: "NOT_MET", opportunityTurn: "T3", request: "Q1", productScope: [SIP], role: "CENTRAL", evidence: [{ turn: "T2", speaker: "Cliente", quote: "Preciso da segunda via.", role: "CUSTOMER" }], guidance: { moment: "ao gerar", action: "informar o e-mail do gestor" } }),
      obligation({ id: "OBL-2", sources: [world.line(DOC.GERAL)], action: "Informar o protocolo", finding: "NOT_MET", opportunityTurn: "T3", productScope: [] }),
    ], [request("Q1", "NOT_IDENTIFIED", [], [], { product: { status: "NOT_IDENTIFIED", targets: [], evidence: [], limitations: ["O cliente não disse de qual produto era a fatura."] } })])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "NOT_IDENTIFIED", [], [])]))
    expect(effectOf(result, "O2")).toMatchObject({ status: "NOT_MET", confirmation: "CONFIRMED" })
    expect(effectOf(result, "O1")).toMatchObject({ status: "NOT_OBSERVABLE", guidance: null, productApplicability: { effect: "SUSPENDED" } })
    expect(result.outcome).toBe("PARTIAL")
    expect(result.outcomeReasons).toContain("PRODUCT_DEPENDENT_POINTS_SUSPENDED")
    expect(result.coverageLimits?.productNotEstablished).toBe(1)
    const brief = briefOf(result)
    expect(brief.developments.map((finding) => finding.title)).toEqual([expect.stringContaining("protocolo")])
    // Nem ponto em aberto (orientar misturaria produtos), nem reconhecimento: só limite de cobertura e a nota neutra (ponto central).
    expect(brief.openPoints ?? []).toEqual([])
    expect(brief.coverageLimits).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "PRODUCT_NOT_ESTABLISHED" })]))
    expect(brief.readerNotes).toContain("Parte do que o procedimento pede depende do produto do cliente, e a gravação não permitiu confirmar qual era: esses pontos não foram avaliados neste retorno.")
    // O redator e o verificador recebem a regra suspensa como "não cobrar", e nenhum produto como fato.
    const writer = compositionPayloadOf(brief).facts as Record<string, unknown>
    expect(writer.productScope).toEqual({ identified: [], undeterminedRequests: 1, rulesNotEstablished: [expect.stringContaining("e-mail do gestor do contrato")] })
    expect((verificationFactsOf(brief) as Record<string, unknown>).productScope).toEqual(writer.productScope)
    expect(requestOf(result).limitations).toEqual(["O cliente não disse de qual produto era a fatura."])
  })

  it("sem produto e sem nenhuma avaliação útil → abstenção com motivo rastreável", () => {
    const world = productWorld(transcript)
    const [SIP, DDR] = [world.node("SIP"), world.node("DDR")]
    const model = analysis([
      obligation({ id: "OBL-1", sources: [world.line(DOC.SIP)], action: "Informar o e-mail do gestor", finding: "NOT_MET", opportunityTurn: "T3", request: "Q1", productScope: [SIP] }),
      obligation({ id: "OBL-2", sources: [world.line(DOC.DDR)], action: "Informar o portal", finding: "NOT_MET", opportunityTurn: "T3", request: "Q1", productScope: [DDR] }),
    ], [request("Q1", "NOT_IDENTIFIED", [], [])])
    const { result, sentClaims } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "NOT_IDENTIFIED", [], [])]))
    expect(sentClaims).toEqual([])
    expect(result.outcome).toBe("INSUFFICIENT_EVIDENCE")
    expect(result.outcomeReasons).toEqual(["PRODUCT_NOT_ESTABLISHED"])
    expect(result.productApplicability!.counts).toMatchObject({ suspended: 2, established: 0 })
  })
})

describe("dois produtos na mesma chamada", () => {
  it("cada solicitação com o seu produto e os seus procedimentos; regra de outro produto não se aplica; fontes misturadas nunca", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: Preciso da segunda via da linha SIP da empresa.", "Operador: Certo.", "Cliente: E também da banda larga da filial.", "Operador: Para a banda larga, é pelo aplicativo.", "Operador: Pronto."]))
    const [SIP, BL, DDR] = [world.node("SIP"), world.node("BANDA_LARGA"), world.node("DDR")]
    const model = analysis([
      obligation({ id: "OBL-1", sources: [world.line(DOC.SIP)], action: "Informar o e-mail do gestor", finding: "NOT_MET", opportunityTurn: "T3", request: "Q1", productScope: [SIP] }),
      obligation({ id: "OBL-2", sources: [world.line(DOC.BANDA_LARGA)], action: "Orientar pelo aplicativo", finding: "MET", evidence: [{ turn: "T5", speaker: "Operador", quote: "Para a banda larga, é pelo aplicativo.", role: "CONDUCT" }], request: "Q2", productScope: [BL] }),
      obligation({ id: "OBL-3", sources: [world.line(DOC.DDR)], action: "Informar o portal", finding: "NOT_MET", opportunityTurn: "T5", request: "Q2", productScope: [DDR] }),
      obligation({ id: "OBL-4", sources: [world.line(DOC.SIP), world.line(DOC.BANDA_LARGA)], action: "Orientar a segunda via", finding: "NOT_MET", opportunityTurn: "T6", request: "Q1", productScope: [] }),
    ], [
      request("Q1", "IDENTIFIED", [SIP], [evidence({ kind: "CUSTOMER_STATEMENT", turn: "T2", speaker: "Cliente", quote: "linha SIP da empresa", relation: "OBJECT_OF_REQUEST", supports: [SIP] })]),
      request("Q2", "IDENTIFIED", [BL], [evidence({ kind: "CUSTOMER_STATEMENT", turn: "T4", speaker: "Cliente", quote: "banda larga da filial", relation: "OBJECT_OF_REQUEST", supports: [BL] })]),
    ])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "IDENTIFIED", [SIP], [evidence({ kind: "CUSTOMER_STATEMENT", turn: "T2", speaker: "Cliente", quote: "linha SIP da empresa", relation: "OBJECT_OF_REQUEST", supports: [SIP] })]), reading("Q2", "IDENTIFIED", [BL], [evidence({ kind: "CUSTOMER_STATEMENT", turn: "T4", speaker: "Cliente", quote: "banda larga da filial", relation: "OBJECT_OF_REQUEST", supports: [BL] })])]))
    expect(effectOf(result, "O1")).toMatchObject({ status: "NOT_MET", productApplicability: { effect: "ESTABLISHED", request: "Q1" } })
    expect(effectOf(result, "O2")).toMatchObject({ status: "MET", productApplicability: { effect: "ESTABLISHED", request: "Q2" } })
    expect(effectOf(result, "O3")).toMatchObject({ status: "NOT_APPLICABLE", applicability: "DOES_NOT_APPLY", productApplicability: { effect: "OTHER_PRODUCT" } })
    expect(effectOf(result, "O4")!.productApplicability).toMatchObject({ effect: "SUSPENDED", reason: "PRODUCT_SCOPE_UNCLEAR", scope: "UNKNOWN" })
    expect(result.productApplicability!.violations).toContain("O4:MIXED_PRODUCT_SOURCES")
  })
})

describe("produto mencionado em outro contrato, hipótese ou negação", () => {
  const transcript = SAY(["Operador: Bom dia.", "Cliente: Preciso da segunda via da banda larga.", "Operador: É a do SIP?", "Cliente: Não, o SIP é de outro contrato meu; agora é só a banda larga.", "Operador: Certo, gerada."])
  it("a menção a outro produto não é o objeto do pedido: identifica o produto do pedido e a regra do outro não se aplica", () => {
    const world = productWorld(transcript)
    const [SIP, BL] = [world.node("SIP"), world.node("BANDA_LARGA")]
    const items = [
      evidence({ kind: "CUSTOMER_STATEMENT", turn: "T2", speaker: "Cliente", quote: "segunda via da banda larga", relation: "OBJECT_OF_REQUEST", supports: [BL] }),
      evidence({ kind: "OPERATOR_STATEMENT", turn: "T3", speaker: "Operador", quote: "É a do SIP?", relation: "HYPOTHETICAL", supports: [SIP] }),
      evidence({ kind: "CUSTOMER_STATEMENT", turn: "T4", speaker: "Cliente", quote: "o SIP é de outro contrato meu", relation: "OTHER_OBJECT", supports: [SIP] }),
    ]
    const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.SIP)], action: "Informar o e-mail do gestor", finding: "NOT_MET", opportunityTurn: "T5", request: "Q1", productScope: [SIP] })], [request("Q1", "IDENTIFIED", [BL], items)])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "IDENTIFIED", [BL], items)]))
    expect(requestOf(result)).toMatchObject({ status: "IDENTIFIED", identified: BL })
    expect(requestOf(result).evidence.filter((entry) => entry.reader === "ANALYSIS").map((entry) => entry.role)).toEqual(["ESTABLISHING", "NOT_ABOUT_REQUEST", "NOT_ABOUT_REQUEST"])
    expect(effectOf(result, "O1")).toMatchObject({ status: "NOT_APPLICABLE", productApplicability: { effect: "OTHER_PRODUCT" } })
  })

  it("leitura adversarial que toma a hipótese como o produto: a hipótese não estabelece e o outro produto continua possível → nada é cobrado", () => {
    const world = productWorld(transcript)
    const [SIP, BL] = [world.node("SIP"), world.node("BANDA_LARGA")]
    const items = [
      evidence({ kind: "CUSTOMER_STATEMENT", turn: "T2", speaker: "Cliente", quote: "segunda via da banda larga", relation: "OBJECT_OF_REQUEST", supports: [BL] }),
      evidence({ kind: "OPERATOR_STATEMENT", turn: "T3", speaker: "Operador", quote: "É a do SIP?", relation: "HYPOTHETICAL", supports: [SIP] }),
    ]
    const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.SIP)], action: "Informar o e-mail do gestor", finding: "NOT_MET", opportunityTurn: "T5", request: "Q1", productScope: [SIP] })], [request("Q1", "IDENTIFIED", [SIP], items)])
    // A revisora repete a mesma leitura equivocada: duas leituras erradas não estabelecem o que a evidência não sustenta.
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "IDENTIFIED", [SIP], items)]))
    // Evidência estabelece banda larga; a análise declarou SIP → fica a leitura mais restrita (as duas possíveis).
    expect(requestOf(result)).toMatchObject({ status: "MULTIPLE_POSSIBLE", possible: [BL, SIP].sort() })
    expect(effectOf(result, "O1")).toMatchObject({ status: "NOT_OBSERVABLE", productApplicability: { effect: "SUSPENDED" } })
  })
})

describe("correção posterior e evidências conflitantes", () => {
  it("o cliente corrige o produto: vale a correção; a regra do produto corrigido é a avaliada", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: É a segunda via do SIP.", "Operador: Certo.", "Cliente: Desculpa, me enganei: é da DDR.", "Operador: Pronto, gerada."]))
    const [SIP, DDR] = [world.node("SIP"), world.node("DDR")]
    const items = [
      evidence({ kind: "CUSTOMER_STATEMENT", turn: "T2", speaker: "Cliente", quote: "É a segunda via do SIP.", relation: "CORRECTED_LATER", supports: [SIP] }),
      evidence({ kind: "CUSTOMER_STATEMENT", turn: "T4", speaker: "Cliente", quote: "me enganei: é da DDR", relation: "OBJECT_OF_REQUEST", supports: [DDR] }),
    ]
    const model = analysis([
      obligation({ id: "OBL-1", sources: [world.line(DOC.DDR)], action: "Informar o portal", finding: "NOT_MET", opportunityTurn: "T5", request: "Q1", productScope: [DDR] }),
      obligation({ id: "OBL-2", sources: [world.line(DOC.SIP)], action: "Informar o e-mail do gestor", finding: "NOT_MET", opportunityTurn: "T5", request: "Q1", productScope: [SIP] }),
    ], [request("Q1", "IDENTIFIED", [DDR], items)])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "IDENTIFIED", [DDR], items)]))
    expect(requestOf(result)).toMatchObject({ status: "IDENTIFIED", identified: DDR })
    expect(effectOf(result, "O1")).toMatchObject({ status: "NOT_MET", productApplicability: { effect: "ESTABLISHED" } })
    expect(effectOf(result, "O2")).toMatchObject({ status: "NOT_APPLICABLE", productApplicability: { effect: "OTHER_PRODUCT" } })
  })

  it("evidências que estabelecem produtos incompatíveis → conflito: só a regra válida para todos os possíveis é avaliada", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: É a segunda via do SIP.", "Operador: Qual o número da conta?", "Cliente: A conta é 899 1234 5678.", "Operador: De qual mês é a fatura? Já envio ao e-mail do gestor."]))
    const [SIP, BASICOS] = [world.node("SIP"), world.node("BASICOS")]
    const items = [
      evidence({ kind: "CUSTOMER_STATEMENT", turn: "T2", speaker: "Cliente", quote: "É a segunda via do SIP.", relation: "OBJECT_OF_REQUEST", supports: [SIP] }),
      evidence({ kind: "IDENTIFIER", turn: "T4", speaker: "Cliente", quote: "A conta é 899 1234 5678.", criterion: world.crit("Conta iniciada em 899"), conditionsHold: "YES", transcription: "CLEAR", relation: "OBJECT_OF_REQUEST", supports: [BASICOS] }),
    ]
    const model = analysis([
      obligation({ id: "OBL-1", sources: [world.line(DOC.SIP)], action: "Informar o e-mail do gestor", finding: "MET", evidence: [{ turn: "T5", speaker: "Operador", quote: "Já envio ao e-mail do gestor.", role: "CONDUCT" }], request: "Q1", productScope: [SIP] }),
      obligation({ id: "OBL-2", sources: [world.line(DOC.SIP), world.line(DOC.BASICOS)], action: "Confirmar a fatura do pedido", finding: "MET", evidence: [{ turn: "T5", speaker: "Operador", quote: "De qual mês é a fatura?", role: "CONDUCT" }], request: "Q1", productScope: [], commonAcrossSources: true }),
    ], [request("Q1", "CONFLICTING", [SIP, BASICOS], items)])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "CONFLICTING", [SIP, BASICOS], items)]))
    expect(requestOf(result)).toMatchObject({ status: "CONFLICTING", conflict: true, reasons: expect.arrayContaining(["ESTABLISHING_EVIDENCE_IN_CONFLICT"]) })
    expect(effectOf(result, "O1")!.productApplicability).toMatchObject({ effect: "SUSPENDED", reason: "PRODUCT_EVIDENCE_CONFLICT" })
    expect(effectOf(result, "O1")!.status).toBe("NOT_OBSERVABLE")
    // Base que cobre todos os produtos ainda possíveis (as duas fontes pedem a mesma conduta, cada uma para o seu produto).
    expect(effectOf(result, "O2")).toMatchObject({ status: "MET", productApplicability: { effect: "ESTABLISHED", reason: "RULE_COVERS_ALL_CONFLICTING_PRODUCTS" } })
  })
})

describe("número incompleto ou transcrição incerta", () => {
  it("marca de perda no turno: o critério conclusivo vira só indício, mesmo que a leitura diga que o número estava claro", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: A conta é 6999 12 [inaudível].", "Operador: Certo, vou gerar."]))
    const SIP = world.node("SIP")
    const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.SIP)], action: "Informar o e-mail do gestor", finding: "NOT_MET", opportunityTurn: "T3", request: "Q1", productScope: [SIP] })], [request("Q1", "IDENTIFIED", [SIP], [evidence({ kind: "IDENTIFIER", turn: "T2", speaker: "Cliente", quote: "A conta é 6999 12", criterion: world.crit("Conta iniciada em 6999"), conditionsHold: "YES", transcription: "CLEAR", relation: "OBJECT_OF_REQUEST", supports: [SIP] })], { product: { status: "IDENTIFIED", targets: [SIP], evidence: [evidence({ kind: "IDENTIFIER", turn: "T2", speaker: "Cliente", quote: "A conta é 6999 12", criterion: world.crit("Conta iniciada em 6999"), conditionsHold: "YES", transcription: "CLEAR", relation: "OBJECT_OF_REQUEST", supports: [SIP] })], limitations: ["O número da conta foi cortado na transcrição."] } })])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, []))
    expect(requestOf(result).evidence[0]).toMatchObject({ role: "INDICATIVE", reason: "TRANSCRIPTION_NOT_RELIABLE", transcription: "PARTIAL" })
    expect(requestOf(result)).toMatchObject({ status: "NOT_IDENTIFIED", limitations: ["O número da conta foi cortado na transcrição."] })
    expect(effectOf(result, "O1")!.productApplicability!.effect).toBe("SUSPENDED")
  })

  it("número reconstruído pela leitura (não está literalmente na transcrição) é desconsiderado", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: A conta é seis nove nove nove, um dois…", "Operador: Certo, vou gerar."]))
    const SIP = world.node("SIP")
    const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.SIP)], action: "Informar o e-mail do gestor", finding: "NOT_MET", opportunityTurn: "T3", request: "Q1", productScope: [SIP] })], [request("Q1", "IDENTIFIED", [SIP], [evidence({ kind: "IDENTIFIER", turn: "T2", speaker: "Cliente", quote: "A conta é 6999 1234 5678", criterion: world.crit("Conta iniciada em 6999"), conditionsHold: "YES", transcription: "CLEAR", relation: "OBJECT_OF_REQUEST", supports: [SIP] })])])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, []))
    expect(requestOf(result).evidence[0]).toMatchObject({ role: "REJECTED", reason: "QUOTE_NOT_VERIFIED" })
    expect(effectOf(result, "O1")!.productApplicability!.effect).toBe("SUSPENDED")
  })

  it("leitura que diz transcrição parcial nunca é conclusiva", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: A conta começa com 6999, o resto eu não lembro.", "Operador: Certo, vou gerar."]))
    const SIP = world.node("SIP")
    const model = analysis([], [request("Q1", "IDENTIFIED", [SIP], [evidence({ kind: "IDENTIFIER", turn: "T2", speaker: "Cliente", quote: "A conta começa com 6999", criterion: world.crit("Conta iniciada em 6999"), conditionsHold: "UNCERTAIN", transcription: "PARTIAL", relation: "OBJECT_OF_REQUEST", supports: [SIP] })])])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, []))
    expect(requestOf(result).status).toBe("NOT_IDENTIFIED")
  })
})

describe("regra de identificação fora da vigência ou não aprovada", () => {
  it("critério citado que não foi apresentado (rascunho, vencido, de outra data) é desconsiderado", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: A conta é 6999 1234 5678.", "Operador: Certo, vou gerar."]))
    const SIP = world.node("SIP")
    const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.SIP)], action: "Informar o e-mail do gestor", finding: "NOT_MET", opportunityTurn: "T3", request: "Q1", productScope: [SIP] })], [request("Q1", "IDENTIFIED", [SIP], [evidence({ kind: "IDENTIFIER", turn: "T2", speaker: "Cliente", quote: "A conta é 6999 1234 5678.", criterion: "C9", conditionsHold: "YES", transcription: "CLEAR", relation: "OBJECT_OF_REQUEST", supports: [SIP] })])])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, []))
    expect(requestOf(result).evidence[0]).toMatchObject({ role: "REJECTED", reason: "CRITERION_NOT_IN_FORCE" })
    expect(effectOf(result, "O1")!.productApplicability!.effect).toBe("SUSPENDED")
  })

  it("critério cujo alvo não está no catálogo vigente não é apresentado; sem critério nem abrangência não há modo produto", () => {
    const orphan = { ...CATALOG.criteria[0]!, criterionId: "orphan", versionId: "orphan-v1", title: "Critério órfão", targetNodeIds: ["00000000-0000-4000-8000-000000000999"] }
    const context = productContextOf({ ...CATALOG, criteria: [...CATALOG.criteria, orphan] }, { presentedSourceIds: [DOC.SIP], metadata: [] })!
    expect(context.criteria.map((criterion) => criterion.title)).not.toContain("Critério órfão")
    expect(productContextOf({ nodes: CATALOG.nodes, criteria: [], scopes: [] }, { presentedSourceIds: [DOC.SIP], metadata: [] })).toBeNull()
    expect(productContextOf(null, { presentedSourceIds: [], metadata: [] })).toBeNull()
  })
})

describe("procedimento executado não prova o produto que valida esse mesmo procedimento", () => {
  const transcript = SAY(["Operador: Bom dia.", "Cliente: Preciso da segunda via da conta 6999 1234 5678.", "Operador: Sua conta 6999 1234 5678, vou emitir pelo portal do SIP e mandar ao e-mail do gestor.", "Cliente: Obrigado."])
  it("a conduta do operador lida como procedimento executado não estabelece o produto: a etapa feita não vira reconhecimento", () => {
    const world = productWorld(transcript)
    const SIP = world.node("SIP")
    const conduct = { turn: "T3", speaker: "Operador", quote: "vou emitir pelo portal do SIP e mandar ao e-mail do gestor", role: "CONDUCT" as const }
    const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.SIP)], action: "Informar o e-mail do gestor", finding: "MET", evidence: [conduct], request: "Q1", productScope: [SIP] })], [request("Q1", "IDENTIFIED", [SIP], [evidence({ kind: "PROCEDURE_EXECUTED", turn: "T3", speaker: "Operador", quote: "vou emitir pelo portal do SIP", relation: "OBJECT_OF_REQUEST", supports: [SIP] })])])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, []))
    expect(requestOf(result).evidence[0]).toMatchObject({ role: "INDICATIVE", reason: "PROCEDURE_IS_NOT_PROOF_OF_PRODUCT" })
    expect(effectOf(result, "O1")).toMatchObject({ status: "NOT_OBSERVABLE", productApplicability: { effect: "SUSPENDED" } })
    expect(briefOf(result).strengths).toEqual([])
  })

  it("mesma fala do operador usada como critério de identificação e como conduta da regra do produto → circular, não estabelece", () => {
    const world = productWorld(transcript)
    const SIP = world.node("SIP")
    const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.SIP)], action: "Informar o e-mail do gestor", finding: "MET", evidence: [{ turn: "T3", speaker: "Operador", quote: "mandar ao e-mail do gestor", role: "CONDUCT" }], request: "Q1", productScope: [SIP] })], [request("Q1", "IDENTIFIED", [SIP], [evidence({ kind: "OPERATOR_STATEMENT", turn: "T3", speaker: "Operador", quote: "Sua conta 6999 1234 5678", criterion: world.crit("Conta iniciada em 6999"), conditionsHold: "YES", transcription: "CLEAR", relation: "OBJECT_OF_REQUEST", supports: [SIP] })])])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, []))
    expect(requestOf(result).evidence[0]).toMatchObject({ role: "INDICATIVE", reason: "CIRCULAR_PROCEDURE_EVIDENCE" })
    // A fala do CLIENTE com o mesmo número, lida como identificador, é outra evidência (não é a conduta avaliada) e estabelece.
    const fromCustomer = analysis(model.obligations, [request("Q1", "IDENTIFIED", [SIP], [evidence({ kind: "IDENTIFIER", turn: "T2", speaker: "Cliente", quote: "conta 6999 1234 5678", criterion: world.crit("Conta iniciada em 6999"), conditionsHold: "YES", transcription: "CLEAR", relation: "OBJECT_OF_REQUEST", supports: [SIP] })])])
    const second = verifyWithReview(world, fromCustomer, (claims) => confirmingReview(claims, [reading("Q1", "IDENTIFIED", [SIP], [evidence({ kind: "IDENTIFIER", turn: "T2", speaker: "Cliente", quote: "conta 6999 1234 5678", criterion: world.crit("Conta iniciada em 6999"), conditionsHold: "YES", transcription: "CLEAR", relation: "OBJECT_OF_REQUEST", supports: [SIP] })])])).result
    expect(effectOf(second, "O1")).toMatchObject({ status: "MET", productApplicability: { effect: "ESTABLISHED" } })
  })

  it("V3: fala do operador dizendo o produto, sozinha, estabelece (os dois leitores apontam a mesma fala)", () => {
    const world = productWorld(SAY(["Operador: Vejo aqui que é o seu SIP.", "Cliente: Preciso da segunda via.", "Operador: Certo."]))
    const SIP = world.node("SIP")
    const unit = evidence({ kind: "OPERATOR_STATEMENT", turn: "T1", speaker: "Operador", quote: "Vejo aqui que é o seu SIP.", relation: "OBJECT_OF_REQUEST", supports: [SIP] })
    const model = analysis([], [request("Q1", "IDENTIFIED", [SIP], [unit])])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "IDENTIFIED", [SIP], [unit])]))
    expect(requestOf(result)).toMatchObject({ status: "IDENTIFIED", identified: SIP })
    expect(requestOf(result).evidence[0]).toMatchObject({ role: "ESTABLISHING", reason: "OPERATOR_NAMED_PRODUCT" })
  })

  it("V3: pergunta do operador sobre o produto (hipótese) não estabelece", () => {
    const world = productWorld(SAY(["Operador: É o seu SIP ou o DDR?", "Cliente: Não sei dizer.", "Operador: Certo."]))
    const SIP = world.node("SIP")
    const unit = evidence({ kind: "OPERATOR_STATEMENT", turn: "T1", speaker: "Operador", quote: "É o seu SIP ou o DDR?", relation: "HYPOTHETICAL", supports: [SIP] })
    const model = analysis([], [request("Q1", "NOT_IDENTIFIED", [], [unit])])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "NOT_IDENTIFIED", [], [unit])]))
    expect(requestOf(result)).toMatchObject({ status: "NOT_IDENTIFIED" })
    expect(requestOf(result).evidence[0]).toMatchObject({ role: "NOT_ABOUT_REQUEST" })
  })

  it("\"fala do cliente\" que na transcrição é do operador conta como fala do operador", () => {
    const world = productWorld(SAY(["Operador: É a segunda via do SIP, certo?", "Cliente: Pode ser."]))
    const SIP = world.node("SIP")
    const model = analysis([], [request("Q1", "IDENTIFIED", [SIP], [evidence({ kind: "CUSTOMER_STATEMENT", turn: "T1", speaker: null, quote: "É a segunda via do SIP", relation: "OBJECT_OF_REQUEST", supports: [SIP] })])])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, []))
    // V3: o operador confirmando o produto passa a estabelecer (aqui a revisão não leu o pedido, então nada é identificado).
    expect(requestOf(result).evidence[0]).toMatchObject({ kind: "OPERATOR_STATEMENT", role: "ESTABLISHING", reason: "OPERATOR_NAMED_PRODUCT" })
    expect(requestOf(result).status).toBe("NOT_IDENTIFIED")
  })
})

describe("V2 — fala do operador + contexto do cliente", () => {
  const reviewWith = (status: "IDENTIFIED" | "NOT_IDENTIFIED", targets: string[], units: ReturnType<typeof evidence>[]) => (claims: Parameters<Parameters<typeof verifyWithReview>[2]>[0]) => confirmingReview(claims, [reading("Q1", status, targets, units)])

  it("o cliente dá o contexto (conta da família) e o operador nomeia o produto → produto estabelecido; a regra dele é cobrada", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: Segunda via, por favor. A conta é 899 1234 5678.", "Operador: Certo, é a sua banda larga.", "Operador: Pronto, já enviei."]))
    const [BASICOS, BL] = [world.node("BASICOS"), world.node("BANDA_LARGA")]
    const units = [
      evidence({ kind: "IDENTIFIER", turn: "T2", speaker: "Cliente", quote: "A conta é 899 1234 5678", criterion: world.crit("Conta iniciada em 899"), conditionsHold: "YES", transcription: "CLEAR", relation: "OBJECT_OF_REQUEST", supports: [BASICOS] }),
      evidence({ kind: "OPERATOR_STATEMENT", turn: "T3", speaker: "Operador", quote: "é a sua banda larga", relation: "OBJECT_OF_REQUEST", supports: [BL] }),
    ]
    const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.BANDA_LARGA)], action: "Orientar a emissão pelo aplicativo", finding: "NOT_MET", opportunityTurn: "T4", request: "Q1", productScope: [BL] })], [request("Q1", "IDENTIFIED", [BL], units)])
    const { result } = verifyWithReview(world, model, reviewWith("IDENTIFIED", [BL], units))
    expect(requestOf(result)).toMatchObject({ status: "IDENTIFIED", identified: BL, possible: [BL] })
    expect(requestOf(result).evidence[1]).toMatchObject({ kind: "OPERATOR_STATEMENT", role: "ESTABLISHING", reason: "OPERATOR_WITH_CUSTOMER_CONTEXT" })
    expect(effectOf(result, "O1")).toMatchObject({ status: "NOT_MET", productApplicability: { effect: "ESTABLISHED" } })
  })

  it("contexto do cliente que só indica (indício que apenas sugere) também acompanha a fala do operador", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: É sobre o tronco chave da empresa.", "Operador: Entendi, é o seu DDR.", "Operador: A segunda via fica no portal."]))
    const [AVANCADOS, DDR] = [world.node("AVANCADOS"), world.node("DDR")]
    const units = [
      evidence({ kind: "CONTEXT", turn: "T2", speaker: "Cliente", quote: "É sobre o tronco chave da empresa.", criterion: world.crit("Tronco chave"), relation: "OBJECT_OF_REQUEST", supports: [AVANCADOS] }),
      evidence({ kind: "OPERATOR_STATEMENT", turn: "T3", speaker: "Operador", quote: "é o seu DDR", relation: "OBJECT_OF_REQUEST", supports: [DDR] }),
    ]
    const model = analysis([], [request("Q1", "IDENTIFIED", [DDR], units)])
    const { result } = verifyWithReview(world, model, reviewWith("IDENTIFIED", [DDR], units))
    expect(requestOf(result).evidence[0]).toMatchObject({ role: "INDICATIVE", reason: "CRITERION_IS_INDICATIVE" })
    expect(requestOf(result)).toMatchObject({ status: "IDENTIFIED", identified: DDR })
  })

  it("V3: o cliente não diz nada sobre o produto e o operador diz qual é → produto estabelecido; a regra dele é cobrada", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: Quero a segunda via da minha conta.", "Operador: Certo, para a sua banda larga eu envio por e-mail.", "Cliente: Obrigado."]))
    const BL = world.node("BANDA_LARGA")
    const units = [evidence({ kind: "OPERATOR_STATEMENT", turn: "T3", speaker: "Operador", quote: "para a sua banda larga", relation: "OBJECT_OF_REQUEST", supports: [BL] })]
    const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.BANDA_LARGA)], action: "Orientar a emissão pelo aplicativo", finding: "NOT_MET", opportunityTurn: "T3", request: "Q1", productScope: [BL] })], [request("Q1", "IDENTIFIED", [BL], units)])
    const { result } = verifyWithReview(world, model, reviewWith("IDENTIFIED", [BL], units))
    expect(requestOf(result)).toMatchObject({ status: "IDENTIFIED", identified: BL })
    expect(requestOf(result).evidence[0]).toMatchObject({ role: "ESTABLISHING", reason: "OPERATOR_NAMED_PRODUCT" })
    expect(effectOf(result, "O1")).toMatchObject({ status: "NOT_MET", productApplicability: { effect: "ESTABLISHED" } })
  })

  it("o contexto do cliente aponta para outro produto: vale o do cliente, a fala do operador não é promovida", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: Preciso da segunda via da conta 6999 1234 5678.", "Operador: Certo, a sua banda larga.", "Operador: Pronto."]))
    const [SIP, BL] = [world.node("SIP"), world.node("BANDA_LARGA")]
    const units = [
      evidence({ kind: "IDENTIFIER", turn: "T2", speaker: "Cliente", quote: "conta 6999 1234 5678", criterion: world.crit("Conta iniciada em 6999"), conditionsHold: "YES", transcription: "CLEAR", relation: "OBJECT_OF_REQUEST", supports: [SIP] }),
      evidence({ kind: "OPERATOR_STATEMENT", turn: "T3", speaker: "Operador", quote: "a sua banda larga", relation: "OBJECT_OF_REQUEST", supports: [BL] }),
    ]
    const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.BANDA_LARGA)], action: "Orientar a emissão pelo aplicativo", finding: "NOT_MET", opportunityTurn: "T4", request: "Q1", productScope: [BL] })], [request("Q1", "IDENTIFIED", [SIP], units)])
    const { result } = verifyWithReview(world, model, reviewWith("IDENTIFIED", [SIP], units))
    expect(requestOf(result)).toMatchObject({ status: "IDENTIFIED", identified: SIP })
    expect(requestOf(result).evidence[1]).toMatchObject({ role: "INDICATIVE" })
    expect(effectOf(result, "O1")!.productApplicability).toMatchObject({ effect: "OTHER_PRODUCT" })
  })

  it("V3: o operador dizer o produto na própria fala da conduta estabelece (\"No SIP eu mando…\")", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: É sobre o tronco chave da empresa.", "Operador: No SIP eu mando a segunda via ao e-mail do gestor.", "Cliente: Obrigado."]))
    const [AVANCADOS, SIP] = [world.node("AVANCADOS"), world.node("SIP")]
    const units = [
      evidence({ kind: "CONTEXT", turn: "T2", speaker: "Cliente", quote: "É sobre o tronco chave da empresa.", criterion: world.crit("Tronco chave"), relation: "OBJECT_OF_REQUEST", supports: [AVANCADOS] }),
      evidence({ kind: "OPERATOR_STATEMENT", turn: "T3", speaker: "Operador", quote: "No SIP eu mando a segunda via ao e-mail do gestor.", relation: "OBJECT_OF_REQUEST", supports: [SIP] }),
    ]
    const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.SIP)], action: "Informar o e-mail do gestor", finding: "MET", evidence: [{ turn: "T3", speaker: "Operador", quote: "mando a segunda via ao e-mail do gestor", role: "CONDUCT" }], request: "Q1", productScope: [SIP] })], [request("Q1", "IDENTIFIED", [SIP], units)])
    const { result } = verifyWithReview(world, model, reviewWith("IDENTIFIED", [SIP], units))
    expect(requestOf(result).evidence[1]).toMatchObject({ role: "ESTABLISHING", reason: "OPERATOR_WITH_CUSTOMER_CONTEXT" })
    expect(requestOf(result)).toMatchObject({ status: "IDENTIFIED", identified: SIP })
    expect(effectOf(result, "O1")).toMatchObject({ status: "MET", productApplicability: { effect: "ESTABLISHED" } })
  })
})

describe("V2.1 — produto e categoria na mesma leitura; evidência só com o turno; corroboração entre os leitores", () => {
  it("o cliente nomeia o produto e o modelo marca também a categoria: fica o produto, nunca 'qualquer produto da categoria'", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: Os ramais do DDR da empresa pararam de tocar.", "Operador: Vou abrir o reparo.", "Operador: O prazo é de 24 horas."]))
    const [AVANCADOS, DDR, SIP] = [world.node("AVANCADOS"), world.node("DDR"), world.node("SIP")]
    const units = [evidence({ kind: "CUSTOMER_STATEMENT", turn: "T2", speaker: "Cliente", quote: "Os ramais do DDR da empresa pararam de tocar.", relation: "OBJECT_OF_REQUEST", supports: [DDR, AVANCADOS] })]
    const model = analysis([
      obligation({ id: "OBL-1", sources: [world.line(DOC.DDR)], action: "Informar o prazo do DDR", finding: "MET", evidence: [{ turn: "T4", speaker: "Operador", quote: "O prazo é de 24 horas.", role: "CONDUCT" }], request: "Q1", productScope: [DDR] }),
      obligation({ id: "OBL-2", sources: [world.line(DOC.SIP)], action: "Informar o e-mail do gestor", finding: "NOT_MET", opportunityTurn: "T4", request: "Q1", productScope: [SIP] }),
    ], [request("Q1", "IDENTIFIED", [DDR, AVANCADOS], units)])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "IDENTIFIED", [AVANCADOS, DDR], units)]))
    expect(requestOf(result)).toMatchObject({ status: "IDENTIFIED", identified: DDR, possible: [DDR] })
    expect(requestOf(result).evidence[0]).toMatchObject({ supports: [DDR], role: "ESTABLISHING" })
    expect(effectOf(result, "O1")).toMatchObject({ status: "MET", productApplicability: { effect: "ESTABLISHED" } })
    expect(effectOf(result, "O2")!.productApplicability).toMatchObject({ effect: "OTHER_PRODUCT" })
  })

  it("a revisão aponta só o turno, sem o trecho: o trecho é o turno inteiro, tirado da gravação — a leitura não se perde", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: Quero a segunda via. É a conta da minha banda larga.", "Operador: Pronto, já pode baixar."]))
    const BL = world.node("BANDA_LARGA")
    const full = evidence({ kind: "CUSTOMER_STATEMENT", turn: "T2", speaker: "Cliente", quote: "É a conta da minha banda larga.", relation: "OBJECT_OF_REQUEST", supports: [BL] })
    const turnOnly = evidence({ kind: "CUSTOMER_STATEMENT", turn: "T2", relation: "OBJECT_OF_REQUEST", supports: [BL] })
    const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.BANDA_LARGA)], action: "Orientar a emissão pelo aplicativo", finding: "NOT_MET", opportunityTurn: "T3", request: "Q1", productScope: [BL] })], [request("Q1", "IDENTIFIED", [BL], [full])])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "IDENTIFIED", [BL], [turnOnly])]))
    expect(requestOf(result)).toMatchObject({ status: "IDENTIFIED", identified: BL })
    expect(requestOf(result).evidence.find((unit) => unit.reader === "REVIEW")).toMatchObject({ role: "ESTABLISHING", quoteFromTurn: true, quote: "Quero a segunda via. É a conta da minha banda larga.", speaker: expect.stringMatching(/cliente/i) })
    expect(effectOf(result, "O1")).toMatchObject({ status: "NOT_MET", productApplicability: { effect: "ESTABLISHED" } })
  })

  it("só o turno, mas o turno é do operador: 'fala do cliente' vira fala do operador (o falante é o do turno) — e o operador dizer o produto estabelece (V3)", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: Quero a segunda via.", "Operador: É a conta da sua banda larga."]))
    const BL = world.node("BANDA_LARGA")
    const turnOnly = evidence({ kind: "CUSTOMER_STATEMENT", turn: "T3", speaker: "Cliente", relation: "OBJECT_OF_REQUEST", supports: [BL] })
    const model = analysis([], [request("Q1", "IDENTIFIED", [BL], [turnOnly])])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "IDENTIFIED", [BL], [turnOnly])]))
    expect(requestOf(result).evidence[0]).toMatchObject({ kind: "OPERATOR_STATEMENT", role: "ESTABLISHING", reason: "OPERATOR_NAMED_PRODUCT", quoteFromTurn: true })
    expect(requestOf(result)).toMatchObject({ status: "IDENTIFIED", identified: BL })
  })

  it("sem turno e sem trecho continua sem valor (NO_QUOTE)", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: Quero a segunda via da banda larga."]))
    const BL = world.node("BANDA_LARGA")
    const nothing = evidence({ kind: "CUSTOMER_STATEMENT", relation: "OBJECT_OF_REQUEST", supports: [BL] })
    const model = analysis([], [request("Q1", "IDENTIFIED", [BL], [nothing])])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "IDENTIFIED", [BL], [nothing])]))
    expect(requestOf(result).evidence[0]).toMatchObject({ role: "REJECTED", reason: "NO_QUOTE" })
  })

  it("regra de todos os produtos junto com a de um produto numa obrigação: fica com a abrangência do produto e a mistura é registrada", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: Quero a segunda via da conta da empresa.", "Operador: Seu protocolo é 555. No SIP eu mando ao e-mail do gestor."]))
    const SIP = world.node("SIP")
    const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.GERAL), world.line(DOC.SIP)], action: "Informar o protocolo e o e-mail do gestor", finding: "MET", evidence: [{ turn: "T3", speaker: "Operador", quote: "Seu protocolo é 555.", role: "CONDUCT" }], request: "Q1", productScope: [SIP] })], [request("Q1", "NOT_IDENTIFIED", [], [])])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "NOT_IDENTIFIED", [], [])]))
    expect(effectOf(result, "O1")!.productApplicability).toMatchObject({ effect: "SUSPENDED" })
    expect(result.productApplicability!.violations).toContain("O1:GENERAL_WITH_PRODUCT_SOURCES")
  })

  it("cada leitor 'acha' o produto numa fala diferente: nenhuma é corroborada → não identificado; a regra do produto fica suspensa", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: Preciso da segunda via da conta da empresa.", "Operador: O e-mail do gestor está ativo?", "Cliente: Está sim, ele olha todo dia.", "Operador: No SIP eu mando ao e-mail do gestor."]))
    const [AVANCADOS, SIP] = [world.node("AVANCADOS"), world.node("SIP")]
    const byAnalysis = evidence({ kind: "CUSTOMER_STATEMENT", turn: "T4", speaker: "Cliente", quote: "Está sim, ele olha todo dia.", relation: "OBJECT_OF_REQUEST", supports: [AVANCADOS] })
    const byReview = evidence({ kind: "CUSTOMER_STATEMENT", turn: "T2", speaker: "Cliente", quote: "Preciso da segunda via da conta da empresa.", relation: "OBJECT_OF_REQUEST", supports: [AVANCADOS] })
    const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.SIP)], action: "Informar o e-mail do gestor", finding: "NOT_MET", opportunityTurn: "T5", request: "Q1", productScope: [SIP] })], [request("Q1", "FAMILY_ONLY", [AVANCADOS], [byAnalysis])])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "FAMILY_ONLY", [AVANCADOS], [byReview])]))
    expect(requestOf(result)).toMatchObject({ status: "NOT_IDENTIFIED", reasons: expect.arrayContaining(["ESTABLISHING_EVIDENCE_NOT_CORROBORATED", "REVIEW_DID_NOT_CONFIRM_IDENTIFICATION"]) })
    expect(requestOf(result).evidence.map((unit) => [unit.reader, unit.turn, unit.role, unit.reason])).toEqual([["ANALYSIS", "T4", "INDICATIVE", "NOT_CORROBORATED_BY_OTHER_READER"], ["REVIEW", "T2", "INDICATIVE", "NOT_CORROBORATED_BY_OTHER_READER"]])
    expect(effectOf(result, "O1")).toMatchObject({ status: "NOT_OBSERVABLE", productApplicability: { effect: "SUSPENDED" } })
  })

  it("só a categoria, sem o produto: continua família (a regra não inventa o produto)", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: É sobre o tronco chave da empresa.", "Operador: Vou abrir o reparo."]))
    const AVANCADOS = world.node("AVANCADOS")
    const units = [evidence({ kind: "CUSTOMER_STATEMENT", turn: "T2", speaker: "Cliente", quote: "É sobre o tronco chave da empresa.", relation: "OBJECT_OF_REQUEST", supports: [AVANCADOS] })]
    const model = analysis([], [request("Q1", "FAMILY_ONLY", [AVANCADOS], units)])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "FAMILY_ONLY", [AVANCADOS], units)]))
    expect(requestOf(result)).toMatchObject({ status: "FAMILY_ONLY", identified: AVANCADOS })
  })
})

describe("V3 — confirmação do cliente, \"achei aqui\" e vários produtos na mesma ligação", () => {
  it("operador pergunta \"é a sua banda larga?\" e o cliente responde \"É sim\" → a confirmação do cliente estabelece", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: Quero a segunda via da conta de casa.", "Operador: Essa de casa é a da sua banda larga?", "Cliente: É sim.", "Operador: Pronto, já pode baixar."]))
    const BL = world.node("BANDA_LARGA")
    const units = [
      evidence({ kind: "OPERATOR_STATEMENT", turn: "T3", speaker: "Operador", quote: "Essa de casa é a da sua banda larga?", relation: "HYPOTHETICAL", supports: [BL] }),
      evidence({ kind: "CUSTOMER_STATEMENT", turn: "T4", speaker: "Cliente", quote: "É sim.", relation: "OBJECT_OF_REQUEST", supports: [BL] }),
    ]
    const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.BANDA_LARGA)], action: "Orientar a emissão pelo aplicativo", finding: "NOT_MET", opportunityTurn: "T5", request: "Q1", productScope: [BL] })], [request("Q1", "IDENTIFIED", [BL], units)])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "IDENTIFIED", [BL], units)]))
    expect(requestOf(result)).toMatchObject({ status: "IDENTIFIED", identified: BL })
    expect(requestOf(result).evidence.map((unit) => [unit.reader, unit.turn, unit.role])).toEqual(expect.arrayContaining([["ANALYSIS", "T3", "NOT_ABOUT_REQUEST"], ["ANALYSIS", "T4", "ESTABLISHING"]]))
    expect(effectOf(result, "O1")).toMatchObject({ status: "NOT_MET", productApplicability: { effect: "ESTABLISHED" } })
  })

  it("\"É o SIP?\" → \"Não sei\" → \"Achei aqui\" (sem dizer o que achou) → não identificado: a regra do SIP fica suspensa, a geral é avaliada", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: Preciso da segunda via da conta da empresa.", "Operador: É o SIP de vocês?", "Cliente: Não sei.", "Operador: Achei aqui.", "Operador: Seu protocolo é 555."]))
    const SIP = world.node("SIP")
    const units = [
      evidence({ kind: "OPERATOR_STATEMENT", turn: "T3", speaker: "Operador", quote: "É o SIP de vocês?", relation: "HYPOTHETICAL", supports: [SIP] }),
      evidence({ kind: "CUSTOMER_STATEMENT", turn: "T4", speaker: "Cliente", quote: "Não sei.", relation: "OBJECT_OF_REQUEST", supports: [] }),
      evidence({ kind: "CONTEXT", turn: "T5", speaker: "Operador", quote: "Achei aqui.", relation: "OBJECT_OF_REQUEST", supports: [] }),
    ]
    const model = analysis([
      obligation({ id: "OBL-1", sources: [world.line(DOC.SIP)], action: "Informar o e-mail do gestor", finding: "NOT_MET", opportunityTurn: "T5", request: "Q1", productScope: [SIP] }),
      obligation({ id: "OBL-2", sources: [world.line(DOC.GERAL)], action: "Informar o protocolo", finding: "MET", evidence: [{ turn: "T6", speaker: "Operador", quote: "Seu protocolo é 555.", role: "CONDUCT" }], productScope: [] }),
    ], [request("Q1", "NOT_IDENTIFIED", [], units)])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "NOT_IDENTIFIED", [], units)]))
    expect(requestOf(result)).toMatchObject({ status: "NOT_IDENTIFIED", possible: null })
    expect(effectOf(result, "O1")).toMatchObject({ status: "NOT_OBSERVABLE", productApplicability: { effect: "SUSPENDED", reason: "PRODUCT_NOT_IDENTIFIED" } })
    expect(effectOf(result, "O2")).toMatchObject({ status: "MET", productApplicability: { effect: "INDEPENDENT" } })
  })

  it("dois produtos na mesma ligação: cada regra vale só no pedido do seu produto — a mesma conduta, certa para um, não é cobrada pelo outro", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: Preciso de duas segundas vias: a da internet de casa e a outra do escritório.", "Operador: A de casa eu oriento pelo aplicativo.", "Operador: E a do escritório, é o DDR de vocês?", "Cliente: É sim.", "Operador: Essa eu também oriento pelo aplicativo."]))
    const [BL, DDR] = [world.node("BANDA_LARGA"), world.node("DDR")]
    const q1 = [evidence({ kind: "CUSTOMER_STATEMENT", turn: "T2", speaker: "Cliente", quote: "a da internet de casa", relation: "OBJECT_OF_REQUEST", supports: [BL] })]
    const q2 = [evidence({ kind: "CUSTOMER_STATEMENT", turn: "T5", speaker: "Cliente", quote: "É sim.", relation: "OBJECT_OF_REQUEST", supports: [DDR] })]
    const model = analysis([
      obligation({ id: "OBL-1", sources: [world.line(DOC.BANDA_LARGA)], action: "Orientar a emissão pelo aplicativo", finding: "MET", evidence: [{ turn: "T3", speaker: "Operador", quote: "A de casa eu oriento pelo aplicativo.", role: "CONDUCT" }], request: "Q1", productScope: [BL] }),
      obligation({ id: "OBL-2", sources: [world.line(DOC.DDR)], action: "Informar o portal empresarial", finding: "NOT_MET", opportunityTurn: "T6", request: "Q2", productScope: [DDR] }),
    ], [request("Q1", "IDENTIFIED", [BL], q1), request("Q2", "IDENTIFIED", [DDR], q2)])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "IDENTIFIED", [BL], q1), reading("Q2", "IDENTIFIED", [DDR], q2)]))
    expect(requestOf(result, "Q1")).toMatchObject({ status: "IDENTIFIED", identified: BL })
    expect(requestOf(result, "Q2")).toMatchObject({ status: "IDENTIFIED", identified: DDR })
    expect(effectOf(result, "O1")).toMatchObject({ status: "MET", productApplicability: { request: "Q1", effect: "ESTABLISHED" } })
    expect(effectOf(result, "O2")).toMatchObject({ status: "NOT_MET", productApplicability: { request: "Q2", effect: "ESTABLISHED" } })
  })

  it("regra geral que só manda seguir o procedimento do produto (productScope = as famílias): sem produto fica suspensa; com produto, é avaliada", () => {
    const say = SAY(["Operador: Bom dia.", "Cliente: Preciso da segunda via da conta da empresa.", "Operador: É o SIP de vocês?", "Cliente: Não sei.", "Operador: Vou mandar para o e-mail cadastrado."])
    const run = (status: "NOT_IDENTIFIED" | "IDENTIFIED", withProduct: boolean) => {
      const world = productWorld(say)
      const [BASICOS, AVANCADOS, SIP] = [world.node("BASICOS"), world.node("AVANCADOS"), world.node("SIP")]
      const units = withProduct ? [evidence({ kind: "CUSTOMER_STATEMENT", turn: "T2", speaker: "Cliente", quote: "Preciso da segunda via da conta da empresa.", relation: "OBJECT_OF_REQUEST", supports: [SIP] })] : []
      const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.GERAL)], action: "Seguir o procedimento do produto", finding: "NOT_MET", opportunityTurn: "T5", request: "Q1", productScope: [BASICOS, AVANCADOS] })], [request("Q1", status, withProduct ? [SIP] : [], units)])
      return verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", status, withProduct ? [SIP] : [], units)])).result
    }
    expect(effectOf(run("NOT_IDENTIFIED", false), "O1")).toMatchObject({ status: "NOT_OBSERVABLE", productApplicability: { effect: "SUSPENDED", reason: "PRODUCT_NOT_IDENTIFIED" } })
    expect(effectOf(run("IDENTIFIED", true), "O1")).toMatchObject({ status: "NOT_MET", productApplicability: { effect: "ESTABLISHED" } })
  })

  it("dois produtos na mesma ligação: a regra de um produto ligada ao pedido do outro (leitura errada) nunca é cobrada ali", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: Preciso de duas segundas vias: a da internet de casa e a outra do escritório.", "Operador: A de casa eu oriento pelo aplicativo.", "Operador: E a do escritório, é o DDR de vocês?", "Cliente: É sim."]))
    const [BL, DDR] = [world.node("BANDA_LARGA"), world.node("DDR")]
    const q1 = [evidence({ kind: "CUSTOMER_STATEMENT", turn: "T2", speaker: "Cliente", quote: "a da internet de casa", relation: "OBJECT_OF_REQUEST", supports: [BL] })]
    const q2 = [evidence({ kind: "CUSTOMER_STATEMENT", turn: "T5", speaker: "Cliente", quote: "É sim.", relation: "OBJECT_OF_REQUEST", supports: [DDR] })]
    const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.DDR)], action: "Informar o portal empresarial", finding: "NOT_MET", opportunityTurn: "T3", request: "Q1", productScope: [DDR] })], [request("Q1", "IDENTIFIED", [BL], q1), request("Q2", "IDENTIFIED", [DDR], q2)])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "IDENTIFIED", [BL], q1), reading("Q2", "IDENTIFIED", [DDR], q2)]))
    expect(effectOf(result, "O1")!.productApplicability).toMatchObject({ request: "Q1", effect: "OTHER_PRODUCT" })
    expect(effectOf(result, "O1")!.status).not.toBe("NOT_MET")
  })
})

describe("revisão independente da identificação e da abrangência", () => {
  const transcript = SAY(["Operador: Bom dia.", "Cliente: Preciso da segunda via da minha linha SIP.", "Operador: Certo, vou gerar."])
  const setup = () => {
    const world = productWorld(transcript)
    const SIP = world.node("SIP")
    const items = [evidence({ kind: "CUSTOMER_STATEMENT", turn: "T2", speaker: "Cliente", quote: "minha linha SIP", relation: "OBJECT_OF_REQUEST", supports: [SIP] })]
    const model = analysis([
      obligation({ id: "OBL-1", sources: [world.line(DOC.SIP)], action: "Informar o e-mail do gestor", finding: "NOT_MET", opportunityTurn: "T3", request: "Q1", productScope: [SIP] }),
      obligation({ id: "OBL-2", sources: [world.line(DOC.GERAL)], action: "Informar o protocolo", finding: "NOT_MET", opportunityTurn: "T3", productScope: [] }),
    ], [request("Q1", "IDENTIFIED", [SIP], items)])
    return { world, SIP, items, model }
  }
  it("a revisora não confirma o produto → a leitura mais restrita vale: a regra do produto fica suspensa", () => {
    const { world, model } = setup()
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "NOT_IDENTIFIED", [], [])]))
    expect(requestOf(result)).toMatchObject({ status: "NOT_IDENTIFIED", reasons: expect.arrayContaining(["REVIEW_DID_NOT_CONFIRM_IDENTIFICATION"]), review: { available: true, status: "NOT_IDENTIFIED" } })
    expect(effectOf(result, "O1")!.productApplicability!.effect).toBe("SUSPENDED")
    expect(effectOf(result, "O2")!.status).toBe("NOT_MET")
  })
  it("a revisora não leu o pedido → nada estreita sem o segundo leitor", () => {
    const { world, model } = setup()
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, []))
    expect(requestOf(result).reasons).toContain("REVIEW_DID_NOT_READ_REQUEST")
    expect(effectOf(result, "O1")!.productApplicability!.effect).toBe("SUSPENDED")
  })
  it("a revisora lê que uma regra de fonte geral só vale para um produto (texto da seção) → estreita; incerta → suspensa", () => {
    const { world, model, items, SIP } = setup()
    const narrowed = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "IDENTIFIED", [SIP], items)], { O2: { reading: "DEPENDS_ON_PRODUCT", targets: [world.node("DDR")] } })).result
    expect(effectOf(narrowed, "O2")).toMatchObject({ status: "NOT_APPLICABLE", productApplicability: { effect: "OTHER_PRODUCT" } })
    const unclear = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "IDENTIFIED", [SIP], items)], { O2: { reading: "UNCLEAR" } })).result
    expect(effectOf(unclear, "O2")!.productApplicability).toMatchObject({ effect: "SUSPENDED", reason: "PRODUCT_SCOPE_UNCLEAR" })
  })
  it("a leitura nunca alarga o cadastro: produto declarado fora da abrangência da fonte = abrangência incerta", () => {
    const { world, items, SIP } = setup()
    const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.SIP)], action: "Informar o e-mail do gestor", finding: "NOT_MET", opportunityTurn: "T3", request: "Q1", productScope: [world.node("BANDA_LARGA")] })], [request("Q1", "IDENTIFIED", [SIP], items)])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "IDENTIFIED", [SIP], items)]))
    expect(effectOf(result, "O1")!.productApplicability).toMatchObject({ effect: "SUSPENDED", reason: "PRODUCT_SCOPE_UNCLEAR" })
    expect(result.productApplicability!.violations).toContain("O1:PRODUCT_SCOPE_OUTSIDE_SOURCE")
  })
})

describe("leitura para a liderança e privacidade", () => {
  it("visão em linguagem simples: o que foi identificado, com que evidência, e o que ficou sem avaliação", () => {
    const world = productWorld(SAY(["Operador: Bom dia.", "Cliente: A conta é 899 1234 5678, preciso da segunda via.", "Operador: Pronto."]))
    const [BASICOS, BL] = [world.node("BASICOS"), world.node("BANDA_LARGA")]
    const items = [evidence({ kind: "IDENTIFIER", turn: "T2", speaker: "Cliente", quote: "A conta é 899 1234 5678", criterion: world.crit("Conta iniciada em 899"), conditionsHold: "YES", transcription: "CLEAR", relation: "OBJECT_OF_REQUEST", supports: [BASICOS] })]
    const model = analysis([obligation({ id: "OBL-1", sources: [world.line(DOC.BANDA_LARGA)], action: "Orientar pelo aplicativo", finding: "NOT_MET", opportunityTurn: "T3", request: "Q1", productScope: [BL] })], [request("Q1", "FAMILY_ONLY", [BASICOS], items)])
    const { result } = verifyWithReview(world, model, (claims) => confirmingReview(claims, [reading("Q1", "FAMILY_ONLY", [BASICOS], items)]))
    const view = productIdentificationViewOf(result.productApplicability!)
    expect(view.requests[0]).toMatchObject({ label: "Família identificada: Produtos básicos (produto ainda indefinido)", possible: ["Banda larga", "Linha analógica"] })
    expect(view.requests[0]!.evidence[0]).toMatchObject({ kind: "Número ou dado citado", quote: "A conta é 899 1••• ••••", roleLabel: "sustenta", criterion: { title: "Conta iniciada em 899", version: 1, conclusive: true } })
    expect(view.rules).toEqual([expect.objectContaining({ products: ["Banda larga"], effect: "SUSPENDED", reason: "só a família foi identificada e a regra é de um produto dela" })])
    expect(JSON.stringify(result.productApplicability)).not.toContain("1234 5678")
  })

  it("mascaramento guarda só os 4 primeiros dígitos de números longos e preserva o resto do texto", () => {
    expect(maskIdentifiers("conta 6999.1234-5678 e protocolo 555")).toBe("conta 6999.••••-•••• e protocolo 555")
    expect(maskIdentifiers("dia 12/10")).toBe("dia 12/10")
  })
})

describe("sem catálogo, nada muda; o código não conhece produtos", () => {
  it("contrato sem modo produto é exatamente o anterior; com modo produto, pede solicitações e abrangência", () => {
    expect(obligationAnalysisContractFor(false)).toMatchObject({ systemPrompt: OBLIGATION_ANALYSIS_SYSTEM_PROMPT, schema: OBLIGATION_ANALYSIS_RESPONSE_SCHEMA })
    expect(obligationReviewContractFor(false).systemPrompt).toBe(OBLIGATION_REVIEW_SYSTEM_PROMPT)
    const product = obligationAnalysisContractFor(true)
    expect(product.systemPrompt).toContain("PRODUTO DE CADA SOLICITAÇÃO")
    expect(product.systemPrompt).toContain("O procedimento que o operador executou SEM dizer o produto nunca prova o produto")
    // V4: a confirmação do cliente à pergunta de sim ou não vale; "achei aqui" sem dizer o que achou, não; vários produtos por pedido.
    expect(product.systemPrompt).toContain("que o cliente CONFIRMA na resposta")
    expect(product.systemPrompt).toContain("sem dizer o que achou não estabelece produto nenhum")
    expect(product.systemPrompt).toContain("a mesma ligação pode ter pedidos de produtos diferentes")
    expect(product.systemPrompt).toContain("é avaliada só no pedido desse produto, com o request dele")
    expect(product.systemPrompt).toContain("regra que vale para dois pedidos = uma obrigação por pedido")
    expect(product.systemPrompt).toContain("Regra geral que só manda seguir o procedimento DO PRODUTO")
    const review = obligationReviewContractFor(true).systemPrompt
    expect(review).toContain("O cliente que CONFIRMA a pergunta de sim ou não do operador sobre o produto")
    expect(review).toContain("\"achei aqui\" sem dizer o que achou não estabelece")
    expect(review).toContain("a mesma ligação pode ter pedidos de produtos diferentes")
    expect((product.schema as { required: string[] }).required).toContain("requests")
    const obligationItem = (product.schema as { properties: { obligations: { items: { required: string[] } } } }).properties.obligations.items
    expect(obligationItem.required).toEqual(expect.arrayContaining(["request", "productScope"]))
    expect(obligationReviewContractFor(true).systemPrompt).toContain("PRODUTO DE CADA PEDIDO")
  })

  it("nenhum produto, prefixo ou procedimento de exemplo aparece no código do motor ou do catálogo (fora de comentários)", () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const files = [join(here, "product-applicability.ts"), join(here, "obligation-verification.ts"), join(here, "obligation-analysis-prompt.ts"), join(here, "obligation-review.ts"), join(here, "feedback-brief.ts"), join(here, "composition-prompt.ts"), join(here, "../../product-catalog/domain/product-catalog.ts"), join(here, "../../product-catalog/infrastructure/product-catalog-loaders.ts")]
    for (const file of files) {
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
      for (const term of ["SIP", "DDR", "banda larga", "Banda larga", "6999", "899", "0800", "FWT"]) expect(new RegExp(`(?<![\\p{L}\\p{N}])${term}(?![\\p{L}\\p{N}])`, "u").test(code), `${file} contém "${term}"`).toBe(false)
    }
  })
})
