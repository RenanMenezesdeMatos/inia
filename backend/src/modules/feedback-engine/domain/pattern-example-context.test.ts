import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { compositionPayloadOf, verificationFactsOf } from "./composition-prompt.js"
import { buildIndicatorBrief, examplePhrasingKeyOf } from "./indicator-brief.js"
import { criterionPatternsOf, referencePracticesOf, type IndicatorInvestigation, type MemoryRow } from "./indicator-investigation.js"
import { feedbackViewOf } from "./feedback-view.js"
import { nonLiteralQuotesOf } from "./literal-quotes.js"
import { memoryRowsOf, type MemorySnapshot } from "./memory-queries.js"
import { criterionProductOf, identifiedProductNamesOf, requestProductOf, scopeNamesOf } from "./product-applicability.js"
import { INDICATOR_INVESTIGATION_LOGIC_VERSION } from "./versions.js"

/**
 * `PATTERN_EXAMPLE_CONTEXT_V1` + `PRODUCT_IN_FEEDBACK_V1` — zero IA. Num padrão do indicador que junta chamadas de produtos diferentes, cada
 * fala de exemplo vai com o produto da SOLICITAÇÃO e a regra da PRÓPRIA chamada ("Vale para", "evitar", "deve/pode") e a fala do
 * argumentário da versão que ela usou. Caso real (TMA da Larissa, 22/10/2026): o padrão "prazo" juntou a chamada de IP Dedicado (disse 24
 * horas; o produto define 4) e a de Banda Larga (disse 24 horas, certo pela regra da TESTE PRODUTOS; o procedimento do Grupo pede a visita
 * em até 2 dias úteis); o redator citou a fala da Banda Larga como erro do IP Dedicado.
 */
const IPD_RULE = "O prazo (SLA) de solução do IP Dedicado é de 4 horas."
const BL_RULE = "- **Visita técnica urbana:** primeira janela disponível, em até 2 dias úteis;"
const RECORD = { requests: [{ ref: "Q1", identified: "P-BL", status: "IDENTIFIED" }, { ref: "Q2", identified: "P-IPD", status: "IDENTIFIED" }, { ref: "Q3", identified: "P-COLO", status: "UNDETERMINED" }], catalog: { nodes: [{ handle: "P-BL", name: "Banda Larga", kind: "PRODUCT" }, { handle: "P-IPD", name: "IP Dedicado", kind: "PRODUCT" }, { handle: "P-COLO", name: "Colocation", kind: "PRODUCT" }] } } as never
const row = (interactionId: string, text: string, documentTitle: string, quote: string, product: string | null, extra: Partial<MemoryRow> = {}): MemoryRow => ({
  interactionId, personId: "larissa", criterionKey: `KC-prazo#${interactionId}`, practiceKey: "KP-prazo", practiceTitle: "Prazo do reparo", documentId: `doc-${interactionId}`, documentTitle, heading: "Prazo", text, status: "NOT_MET", localDate: "2026-10-21",
  evidence: [{ turn: "T9", speaker: "OPERADOR", quote, timestamp: null }], rationale: null, guidance: null, materiality: "HIGH", ...(product ? { product } : {}), ...extra,
})
const ROWS = [
  row("ipd", IPD_RULE, "TESTE PRODUTOS · Reparo — IP Dedicado", "O protocolo é [PROTOCOLO] e o prazo de solução é de 24 horas.", "IP Dedicado", { ruleScope: ["IP Dedicado"] }),
  row("bl", BL_RULE, "Procedimento Operacional — Reparo de Banda Larga", "Chamado aberto, protocolo [PROTOCOLO]. O prazo de reparo é de 24 horas.", "Banda Larga"),
  { ...row("sip", "O prazo de solução do reparo de SIP é de 4 horas.", "TESTE PRODUTOS · Reparo — SIP", "O prazo de solução é de 24 horas.", "SIP"), status: "MET" as const },
]

describe("PRODUCT_IN_FEEDBACK_V1 — o produto é o da solicitação, resolvido num lugar só", () => {
  it("solicitação → produto estabelecido; 'Vale para' → nomes; sem solicitação, só o produto único da chamada", () => {
    expect(identifiedProductNamesOf(RECORD)).toEqual(["Banda Larga", "IP Dedicado"])
    expect(requestProductOf(RECORD, "Q2")).toBe("IP Dedicado")
    expect(requestProductOf(RECORD, "Q3")).toBeNull()
    expect(scopeNamesOf(RECORD, ["P-IPD", "P-COLO"])).toEqual(["IP Dedicado", "Colocation"])
    expect(scopeNamesOf(RECORD, "ALL")).toEqual([])
    // Dois produtos na chamada e o critério sem solicitação: nenhum produto (nunca "o primeiro").
    expect(criterionProductOf(RECORD, { request: null })).toBeNull()
    const single = { requests: [{ ref: "Q1", identified: "P-BL", status: "IDENTIFIED" }], catalog: (RECORD as { catalog: unknown }).catalog } as never
    expect(criterionProductOf(single, { request: null })).toBe("Banda Larga")
  })

  it("a memória leva a cada linha o produto da solicitação, o 'Vale para', o item do argumentário e quando a chamada aconteceu", () => {
    const snapshot: MemorySnapshot = {
      assessments: [{ callAssessmentId: "a1", analysisRunId: "r", interactionId: "dois-pedidos", personId: "larissa", occurredAt: new Date("2026-10-21T22:00:00Z"), asOf: new Date("2026-10-22T17:00:00Z"), segmentKey: "Reparo", pathAssessment: null, outcome: "USABLE", logicVersion: "L", productRecord: RECORD } as never],
      criteria: [
        { ...ROWS[0]!, interactionId: "dois-pedidos", callAssessmentId: "a1", segmentKey: "Reparo", productApplicability: { request: "Q2", scope: ["P-IPD"] }, argumentItem: { scriptId: "arg-ipd", version: 3, field: "GUIDANCE", modality: "MUST" } },
        { ...ROWS[1]!, interactionId: "dois-pedidos", callAssessmentId: "a1", segmentKey: "Reparo", productApplicability: { request: "Q1", scope: "ALL" }, argumentItem: null },
      ],
    }
    const [ipd, bl] = memoryRowsOf(snapshot, "L", "Reparo")
    expect(ipd).toMatchObject({ product: "IP Dedicado", ruleScope: ["IP Dedicado"], argument: { scriptId: "arg-ipd", version: 3 }, occurredAt: "2026-10-21T22:00:00.000Z" })
    expect(bl).toMatchObject({ product: "Banda Larga" })
    expect(bl).not.toHaveProperty("ruleScope")
  })
})

describe("PATTERN_EXAMPLE_CONTEXT_V1 / PRODUCT_IN_FEEDBACK_V1 — cada fala de exemplo com o produto e a regra da própria chamada", () => {
  it("o padrão guarda, em cada exemplo, o produto da solicitação e a regra avaliada naquela chamada (com o 'Vale para'); e os produtos da prática", () => {
    const [pattern] = criterionPatternsOf(ROWS)
    expect(pattern).toMatchObject({ classification: "DEVELOPMENT_PATTERN", notMet: 2, eligible: 3 })
    expect([...(pattern!.products ?? [])].sort()).toEqual(["Banda Larga", "IP Dedicado", "SIP"])
    expect(pattern!.examples.map((example) => [example.interactionId, example.product, example.rule?.text, example.rule?.appliesTo])).toEqual([["ipd", "IP Dedicado", IPD_RULE, ["IP Dedicado"]], ["bl", "Banda Larga", BL_RULE, undefined]])
  })

  const investigation = (patterns = criterionPatternsOf(ROWS)): IndicatorInvestigation => ({
    logicVersion: INDICATOR_INVESTIGATION_LOGIC_VERSION,
    official: { indicatorId: "i", code: "TMA", name: "Tempo Médio de Atendimento", unit: "SECONDS", direction: "LOWER", sourceKind: "MEASUREMENT", sourceRef: "m", value: 756, target: 400, withinTarget: false, gapToTarget: null, periodStart: "2026-10-21", periodEnd: "2026-10-21", periodLabel: "21/10/2026", referencePeriod: null, previous: null, movement: null, quartile: null, previousQuartile: null },
    localization: { proxy: { kind: "DURATION_SECONDS", label: "a duração média registrada das chamadas", description: "aproximação" }, windows: { current: { start: "2026-10-15", end: "2026-10-21", label: "15/10 a 21/10" }, previous: { start: "2026-09-17", end: "2026-10-14", label: "17/09 a 14/10" } }, overall: { current: null, previous: null, change: null, direction: "UNKNOWN" }, officialAgreement: "UNKNOWN", decomposition: null, segments: [], daily: { available: false, points: [], outliers: [], weekdays: [] }, focus: [], limitations: [] },
    evidence: [{ segmentKey: "Reparo", segmentLabel: "Reparo", focusReason: "DETERIORATED", universe: 13, analyzedCalls: 3, reusedCalls: 0, newlyAnalyzed: 3, sampleBasis: "LONGEST_DURATION", sampleNote: "3 chamadas analisadas", patterns }],
    questions: [],
    conclusion: "PATTERN_FOUND",
    limitations: [],
    budget: { maxCallAnalyses: 6, callAnalyses: 3, reusedCalls: 0, stoppedBy: null },
    strategy: { versionId: "s", configured: true },
    teamId: null,
    subteamId: null,
  } as unknown as IndicatorInvestigation)
  const briefOf = (target = investigation(), examplePhrasings?: Map<string, { name: string; text: string }>) => buildIndicatorBrief(target, { documentVersions: new Map(), delivered: new Set(), factualWhenInconclusive: false, ...(examplePhrasings ? { examplePhrasings } : {}) })

  it("o redator e o verificador recebem cada fala com o produto e a regra DELA — a da Banda Larga nunca chega como erro do IP Dedicado", () => {
    const brief = briefOf()
    const finding = brief.developments[0]!
    expect(finding.quotes.map((quote) => [quote.text, quote.call?.product, quote.call?.rule.text, quote.call?.rule.appliesTo])).toEqual([
      ["O protocolo é [PROTOCOLO] e o prazo de solução é de 24 horas.", "IP Dedicado", IPD_RULE, ["IP Dedicado"]],
      ["Chamado aberto, protocolo [PROTOCOLO]. O prazo de reparo é de 24 horas.", "Banda Larga", BL_RULE, undefined],
    ])
    for (const payload of [compositionPayloadOf(brief).facts, verificationFactsOf(brief)] as unknown as { developments: { exampleQuotes: { text: string; productInThisCall?: string; ruleInThisCall?: string }[] }[] }[]) {
      const [ipd, bl] = payload.developments[0]!.exampleQuotes
      expect(ipd).toMatchObject({ productInThisCall: "IP Dedicado", ruleInThisCall: `[vale para: IP Dedicado] [Prazo] ${IPD_RULE}` })
      expect(bl).toMatchObject({ productInThisCall: "Banda Larga", ruleInThisCall: expect.stringContaining(BL_RULE) })
      expect(bl!.ruleInThisCall).not.toContain("IP Dedicado")
    }
    // A regra da chamada vale como texto literal (a fala pode citar a regra dela entre aspas).
    expect(nonLiteralQuotesOf(`O procedimento diz “${IPD_RULE}”`, brief)).toEqual([])
    // A tela mostra o produto de cada fala de exemplo.
    const view = feedbackViewOf(brief, { card: "c", paragraphs: ["p"], sentences: [], communicatedRefs: [finding.ref] })
    const call = view.developments[0]!.call
    expect(call.kind === "QUOTES" ? call.quotes.map((quote) => quote.product) : null).toEqual(["IP Dedicado", "Banda Larga"])
  })

  it("a fala do argumentário vem de CADA chamada (a versão que ela usou), com o produto dela — nunca uma fala para o padrão inteiro", () => {
    const rows = ROWS.map((entry) => (entry.interactionId === "ipd" ? { ...entry, sourceKind: "ARGUMENT_SCRIPT" as const, argument: { scriptId: "arg-ipd", version: 3, field: "GUIDANCE", modality: "MUST" } } : entry))
    const phrasing = "Para o IP Dedicado, o prazo de solução é de 4 horas, e você acompanha pelo protocolo."
    const brief = briefOf(investigation(criterionPatternsOf(rows)), new Map([[examplePhrasingKeyOf("ipd", "arg-ipd"), { name: "Reparo de Dados Avançados", text: phrasing }]]))
    const finding = brief.developments[0]!
    expect(finding.quotes[0]!.call?.rule).toMatchObject({ requirement: "REQUIRED", phrasing: { text: phrasing } })
    expect(finding.quotes[1]!.call?.rule.phrasing).toBeUndefined()
    // Nenhuma regra do padrão carrega a fala sozinha: ela é da chamada de IP Dedicado.
    expect(finding.rules.some((rule) => rule.phrasing)).toBe(false)
    const facts = compositionPayloadOf(brief).facts as unknown as { developments: { suggestedPhrasing?: { text: string; forProduct?: string }[] }[] }
    expect(facts.developments[0]!.suggestedPhrasing).toEqual([{ from: "Argumentário: Reparo de Dados Avançados", text: phrasing, forProduct: "IP Dedicado" }])
    const view = feedbackViewOf(brief, { card: "c", paragraphs: ["p"], sentences: [], communicatedRefs: [finding.ref] })
    expect(view.developments[0]).toMatchObject({ suggestedResponse: phrasing, suggestedResponseProduct: "IP Dedicado" })
  })

  it("'evitar' e 'pode' do argumentário chegam à regra do padrão (a mesma marcação da monitoria)", () => {
    const avoid = criterionPatternsOf(ROWS.map((entry) => ({ ...entry, sourceKind: "ARGUMENT_SCRIPT" as const, argument: { scriptId: "s", version: 1, field: "AVOID", modality: null } })))
    expect(avoid[0]!.examples[0]!.rule).toMatchObject({ avoid: true })
    const optional = criterionPatternsOf(ROWS.map((entry) => ({ ...entry, sourceKind: "ARGUMENT_SCRIPT" as const, argument: { scriptId: "s", version: 1, field: "GUIDANCE", modality: "MAY" } })))
    expect(optional[0]!.examples[0]!.rule).toMatchObject({ requirement: "OPTIONAL" })
  })

  it("colegas de referência: regra de outro produto não entra; regra geral, sempre", () => {
    const person = criterionPatternsOf([row("p1", IPD_RULE, "IPD", "x", "IP Dedicado", { ruleScope: ["IP Dedicado"] }), row("p2", IPD_RULE, "IPD", "y", "IP Dedicado", { ruleScope: ["IP Dedicado"] }), row("p3", IPD_RULE, "IPD", "z", "IP Dedicado", { ruleScope: ["IP Dedicado"] })])
    const peers = (product: string, scope: string[] | undefined) => ["c1", "c2", "c3", "c4", "c5", "c6"].map((id, index) => ({ ...row(`${product}-${id}`, scope ? "Regra do produto" : "Regra geral", "Proc", "w", product, scope ? { ruleScope: scope } : {}), personId: `colega-${index % 3}`, status: "MET" as const }))
    // Colegas só com chamadas de Banda Larga e regra de Banda Larga: nada a comparar com o IP Dedicado da pessoa.
    expect(referencePracticesOf(peers("Banda Larga", ["Banda Larga"]), person, { assessments: 3, contributors: 3 })).toEqual([])
    // Mesma regra GERAL: compara.
    expect(referencePracticesOf(peers("Banda Larga", undefined), person, { assessments: 3, contributors: 3 })[0]).toMatchObject({ contrast: "REFERENCE_FOLLOWS_PERSON_MISSES" })
    // Mesmo produto da pessoa: compara, e a regra vai com o "Vale para".
    expect(referencePracticesOf(peers("IP Dedicado", ["IP Dedicado"]), person, { assessments: 3, contributors: 3 })[0]).toMatchObject({ appliesTo: ["IP Dedicado"] })
  })

  it("chamada sem produto estabelecido: a fala diz que o produto não foi estabelecido; investigação gravada antes (sem os campos) segue como antes", () => {
    const unknown = investigation(criterionPatternsOf(ROWS.map((entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "product")) as MemoryRow)))
    const facts = compositionPayloadOf(briefOf(unknown)).facts as unknown as { developments: { exampleQuotes: { productInThisCall?: string }[] }[] }
    expect(facts.developments[0]!.exampleQuotes[0]!.productInThisCall).toBe("não estabelecido")
    const legacy = investigation()
    legacy.evidence[0]!.patterns = legacy.evidence[0]!.patterns.map((pattern) => ({ ...pattern, examples: pattern.examples.map((example) => Object.fromEntries(Object.entries(example).filter(([key]) => !["product", "rule", "argument", "occurredAt"].includes(key))) as typeof example) }))
    const old = compositionPayloadOf(briefOf(legacy)).facts as unknown as { developments: { exampleQuotes: Record<string, unknown>[] }[] }
    expect(old.developments[0]!.exampleQuotes[0]).not.toHaveProperty("ruleInThisCall")
  })
})
