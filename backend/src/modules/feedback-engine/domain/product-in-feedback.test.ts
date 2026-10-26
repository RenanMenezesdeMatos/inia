import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import type { AssessedCriterion, VerifiedCallAnalysis } from "./call-analysis.js"
import { compositionPayloadOf, verificationFactsOf } from "./composition-prompt.js"
import { buildMonitoringBrief } from "./feedback-brief.js"
import { feedbackViewOf } from "./feedback-view.js"
import { phrasingProductOf, ruleScopeNamesOf } from "./product-applicability.js"

/**
 * `PRODUCT_IN_FEEDBACK_V1` (monitoria) — zero IA. Uma ligação com DOIS pedidos (Banda Larga e IP Dedicado): cada ponto leva o produto do
 * pedido dele, a regra leva o "Vale para", dois pontos da mesma seção mas de produtos diferentes nunca viram um ponto só, e o redator, o
 * verificador e a tela recebem isso.
 */
const DOC = "kb-reparo"
const quote = (turn: string, text: string) => ({ turn, speaker: "OPERADOR", quote: text, timestamp: null })
const criterion = (overrides: Partial<AssessedCriterion>): AssessedCriterion => ({
  lineHandle: "O1", lineKey: "k", documentId: DOC, documentHandle: "G1", sectionHandle: "S1", heading: "Prazo", text: "x", leadIn: null, onPath: true, origin: "ANALYSIS",
  declaredStatus: "NOT_MET", proposedStatus: "NOT_MET", status: "NOT_MET", confirmation: "CONFIRMED", confirmationReasons: [], review: null, evidenceKind: "CONDUCT_OBSERVED",
  declaredActionTense: null, evidence: [], rejectedEvidence: [], opportunityTurn: null, rationale: null, materiality: "HIGH", guidance: null, whyItMatters: null, ruleConflict: false,
  downgrades: [], contract: "OBLIGATIONS_V1", ...overrides,
}) as AssessedCriterion
const BL = criterion({ lineHandle: "O1", lineKey: "bl-prazo", text: "O prazo de reparo da Banda Larga é de 24 horas.", evidence: [quote("T6", "O prazo de reparo é de 48 horas.")], productApplicability: { version: "PRODUCT_APPLICABILITY_V3", request: "Q1", scope: ["P-BL"], effect: "ESTABLISHED", reason: null } as never })
const IPD = criterion({ lineHandle: "O2", lineKey: "ipd-prazo", text: "O prazo (SLA) de solução do IP Dedicado é de 4 horas.", evidence: [quote("T14", "O prazo de solução é de 24 horas.")], productApplicability: { version: "PRODUCT_APPLICABILITY_V3", request: "Q2", scope: ["P-IPD"], effect: "ESTABLISHED", reason: null } as never })
const RECORD = { requests: [{ ref: "Q1", identified: "P-BL", status: "IDENTIFIED", evidence: [] }, { ref: "Q2", identified: "P-IPD", status: "IDENTIFIED", evidence: [] }], catalog: { nodes: [{ handle: "P-BL", name: "Banda Larga", kind: "PRODUCT" }, { handle: "P-IPD", name: "IP Dedicado", kind: "PRODUCT" }] } }
const analysis = (criteria: AssessedCriterion[]): VerifiedCallAnalysis => ({
  transcriptStatus: "COMPLETE",
  scenario: { customerNeed: "Dois reparos", conditions: [], procedureDocumentId: DOC, procedureTitle: "Reparo", procedureVersion: 1, rulePerspective: "RULE_IN_FORCE_AT_CALL", correctPath: "", pathTaken: "…", pathAssessment: "UNKNOWN", pathEvidence: [], pathRationale: "…" },
  criteria,
  limitations: [],
  coverage: { status: "COMPLETE" },
  productApplicability: RECORD,
}) as unknown as VerifiedCallAnalysis
const briefOf = (criteria: AssessedCriterion[]) => buildMonitoringBrief({ analysis: analysis(criteria), interactionId: "i", label: "Reparo", dateLabel: "21/10/2026", selectionReason: "manual", criterionKeys: new Map(criteria.map((entry, index) => [entry.lineKey, `KC-${index}`])), documentTitles: new Map([[DOC, "Reparo"]]), documentVersions: new Map<string, number>(), history: new Map(), delivered: new Set<string>() })

describe("PRODUCT_IN_FEEDBACK_V1 — monitoria com mais de um pedido", () => {
  it("cada ponto leva o produto do pedido dele e a regra o 'Vale para'; pontos de produtos diferentes não se juntam", () => {
    const brief = briefOf([BL, IPD])
    expect(brief.developments.map((finding) => [finding.product, finding.rules[0]?.appliesTo])).toEqual([["Banda Larga", ["Banda Larga"]], ["IP Dedicado", ["IP Dedicado"]]])
  })

  it("o redator e o verificador recebem o produto do ponto e '[vale para: …]' na regra", () => {
    const brief = briefOf([BL, IPD])
    for (const facts of [compositionPayloadOf(brief).facts, verificationFactsOf(brief)] as unknown as { developments: { product?: string; rule: string[] }[] }[]) {
      expect(facts.developments.map((finding) => finding.product)).toEqual(["Banda Larga", "IP Dedicado"])
      expect(facts.developments[1]!.rule[0]).toMatch(/^\[vale para: IP Dedicado\] /)
    }
  })

  it("a tela recebe o produto do ponto e o 'Vale para' da regra; ligação sem registro de produto segue como antes", () => {
    const brief = briefOf([BL, IPD])
    const view = feedbackViewOf(brief, { card: "c", paragraphs: ["p"], sentences: [], communicatedRefs: brief.developments.map((finding) => finding.ref) })
    expect(view.developments.map((detail) => [detail.product, detail.guidance.rules[0]?.appliesTo])).toEqual([["Banda Larga", ["Banda Larga"]], ["IP Dedicado", ["IP Dedicado"]]])
    const plain = buildMonitoringBrief({ ...{ analysis: { ...analysis([BL]), productApplicability: undefined } as unknown as VerifiedCallAnalysis }, interactionId: "i", label: "Reparo", dateLabel: "21/10/2026", selectionReason: "manual", criterionKeys: new Map([[BL.lineKey, "KC-0"]]), documentTitles: new Map([[DOC, "Reparo"]]), documentVersions: new Map<string, number>(), history: new Map(), delivered: new Set<string>() })
    expect(plain.developments[0]).not.toHaveProperty("product")
  })
})

describe("PRODUCT_IN_FEEDBACK_V1 — o 'Vale para' de cada regra é o da própria fonte", () => {
  const GERAL = "kb-geral"
  const DOC_IPD = "kb-ipd"
  // Cadastro: a base do IP Dedicado vale para ele; a família Dados Avançados (IP Dedicado + Colocation) para a outra base; a geral, nada.
  const record = { ...RECORD, catalog: { nodes: [...RECORD.catalog.nodes.map((node) => ({ ...node, parentHandle: node.handle === "P-IPD" ? "F-DA" : null })), { handle: "F-DA", name: "Dados Avançados", kind: "FAMILY", parentHandle: null }, { handle: "P-COLO", name: "Colocation", kind: "PRODUCT", parentHandle: "F-DA" }], scopes: [{ sourceId: DOC_IPD, assignmentId: "a1", handles: ["P-IPD"] }, { sourceId: "kb-da", assignmentId: "a2", handles: ["F-DA"] }] } } as never

  it("regra geral junto da regra do produto: só a do produto leva o selo; família vale pelos produtos dela; sem fonte cadastrada, a leitura da regra", () => {
    expect(ruleScopeNamesOf(record, ["P-IPD"], DOC_IPD, [GERAL, DOC_IPD])).toEqual(["IP Dedicado"])
    expect(ruleScopeNamesOf(record, ["P-IPD"], GERAL, [GERAL, DOC_IPD])).toEqual([])
    expect(ruleScopeNamesOf(record, ["P-IPD"], "kb-da", ["kb-da", GERAL])).toEqual(["IP Dedicado"])
    // Exceção por produto dentro de uma base geral (nenhuma fonte cadastrada): a abrangência é a que a análise leu na regra.
    expect(ruleScopeNamesOf(record, ["P-IPD"], GERAL, [GERAL])).toEqual(["IP Dedicado"])
    expect(ruleScopeNamesOf(record, "ALL", DOC_IPD, [DOC_IPD])).toEqual([])
  })

  it("na monitoria, a cobrança que juntou a regra geral com a de 4 horas mostra o selo só na regra do IP Dedicado", () => {
    const merged = criterion({ lineHandle: "O3", lineKey: "ipd-prazo#geral", documentId: DOC_IPD, text: "O prazo (SLA) de solução do IP Dedicado é de 4 horas.", evidence: [quote("T14", "O prazo de solução é de 24 horas.")], productApplicability: { version: "PRODUCT_APPLICABILITY_V3", request: "Q2", scope: ["P-IPD"], effect: "ESTABLISHED", reason: null } as never, sources: [{ handle: "L1", lineKey: "l-ipd", text: "O prazo (SLA) de solução do IP Dedicado é de 4 horas.", heading: "Reparo — IP Dedicado" }, { handle: "L2", lineKey: "l-geral", text: "Informe ao cliente o protocolo e o prazo de solução do produto.", heading: "Reparo — regras gerais (todos os produtos)" }] })
    const sourceLines = new Map([
      ["l-ipd", { documentId: DOC_IPD, documentTitle: "Reparo — IP Dedicado", heading: "Reparo — IP Dedicado", source: "KNOWLEDGE_DOCUMENT" as const, avoid: false, leadIn: null, condition: null }],
      ["l-geral", { documentId: GERAL, documentTitle: "Reparo — regras gerais", heading: "Reparo — regras gerais (todos os produtos)", source: "KNOWLEDGE_DOCUMENT" as const, avoid: false, leadIn: null, condition: null }],
    ])
    const brief = buildMonitoringBrief({ analysis: { ...analysis([merged]), productApplicability: record } as unknown as VerifiedCallAnalysis, interactionId: "i", label: "Reparo", dateLabel: "21/10/2026", selectionReason: "manual", criterionKeys: new Map([[merged.lineKey, "KC-0"]]), documentTitles: new Map([[DOC_IPD, "Reparo — IP Dedicado"], [GERAL, "Reparo — regras gerais"]]), documentVersions: new Map<string, number>(), history: new Map(), delivered: new Set<string>(), sourceLines })
    expect(brief.developments[0]!.rules.map((rule) => [rule.documentId, rule.appliesTo ?? null])).toEqual([[DOC_IPD, ["IP Dedicado"]], [GERAL, null]])
  })
})

describe("PRODUCT_IN_FEEDBACK_V1 — a fala do argumentário só é 'de um produto' quando o argumentário é", () => {
  it("argumentário geral vindo de uma chamada de IP Dedicado: fala sem produto; argumentário de produto: o do ponto, se estiver no 'Vale para'", () => {
    expect(phrasingProductOf([], "IP Dedicado")).toBeNull()
    expect(phrasingProductOf(undefined, "IP Dedicado")).toBeNull()
    expect(phrasingProductOf(["Colocation", "IP Dedicado"], "ip dedicado")).toBe("ip dedicado")
    expect(phrasingProductOf(["IP Dedicado"], "Banda Larga")).toBe("IP Dedicado")
    expect(phrasingProductOf(["Colocation", "IP Dedicado"], null)).toBe("Colocation, IP Dedicado")
  })

  it("na tela e no redator: a fala do argumentário geral do ponto de IP Dedicado não leva produto; a do argumentário do produto leva", () => {
    const base = briefOf([IPD])
    const withPhrasing = (appliesTo?: string[]) => {
      const finding = base.developments[0]!
      const rule = { ...finding.rules[0]!, phrasing: { scriptName: "Encerramento", text: "Ficou alguma dúvida?" } }
      if (appliesTo) rule.appliesTo = appliesTo
      else delete rule.appliesTo
      return { ...base, developments: [{ ...finding, rules: [rule] }] }
    }
    const view = (brief: ReturnType<typeof withPhrasing>) => feedbackViewOf(brief, { card: "c", paragraphs: ["p"], sentences: [], communicatedRefs: brief.developments.map((finding) => finding.ref) }).developments[0]!
    const facts = (brief: ReturnType<typeof withPhrasing>) => (compositionPayloadOf(brief).facts as unknown as { developments: { suggestedPhrasing?: { forProduct?: string }[] }[] }).developments[0]!.suggestedPhrasing?.[0]
    expect(view(withPhrasing())).not.toHaveProperty("suggestedResponseProduct")
    expect(facts(withPhrasing())).not.toHaveProperty("forProduct")
    expect(view(withPhrasing(["IP Dedicado"])).suggestedResponseProduct).toBe("IP Dedicado")
    expect(facts(withPhrasing(["IP Dedicado"]))?.forProduct).toBe("IP Dedicado")
  })
})
