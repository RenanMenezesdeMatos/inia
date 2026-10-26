import { describe, expect, it } from "vitest"
import type { AssessedCriterion, VerifiedCallAnalysis } from "./call-analysis.js"
import { argumentRequirementOf, buildMonitoringBrief, rulesFromSources, type SourceLineMeta } from "./feedback-brief.js"
import { feedbackViewOf } from "./feedback-view.js"
import { compositionPayloadOf } from "./composition-prompt.js"

/**
 * `ARGUMENT_REQUIREMENT_V1` (20/10/2026), zero IA. O cadastro do argumentário separa a orientação ao operador em "deve" e "pode", e a
 * análise já tratava o "pode" como opcional (nunca desvio) — mas o feedback não mostrava a diferença: a regra aparecia só com o nome do
 * argumentário, e um "pode" cumprido virava reconhecimento como se fosse exigência.
 */
const KB = "kb-ret"
const ARG = "arg-ret"
const NAME = "Retenção por troca de plano"
const meta = (documentId: string, heading: string, overrides: Partial<SourceLineMeta> = {}): SourceLineMeta => ({ documentId, documentTitle: documentId === KB ? "Retenção — procedimento" : NAME, heading, source: documentId === KB ? "KNOWLEDGE_DOCUMENT" : "ARGUMENT_SCRIPT", avoid: false, leadIn: null, condition: null, ...overrides })
const SOURCE_LINES = new Map<string, SourceLineMeta>([
  ["kb-offer", meta(KB, "3. Oferta")],
  ["ag-must", meta(ARG, "Orientação ao operador", { requirement: "REQUIRED" })],
  ["ag-may", meta(ARG, "Orientação ao operador", { requirement: "OPTIONAL" })],
  ["ag-point", meta(ARG, "Pontos obrigatórios na fala", { requirement: "REQUIRED" })],
  ["ag-avoid", meta(ARG, "Condutas ou promessas a evitar", { avoid: true })],
])
const source = (lineKey: string, text: string) => ({ handle: lineKey, lineKey, text, heading: SOURCE_LINES.get(lineKey)!.heading })
const quote = (turn: string, text: string) => ({ turn, speaker: "OPERADOR", quote: text, timestamp: null })
const criterion = (overrides: Partial<AssessedCriterion>): AssessedCriterion => ({
  lineHandle: "O1", lineKey: "k", documentId: ARG, documentHandle: "G1", sectionHandle: "S1", heading: "Orientação ao operador", text: "x", leadIn: null, onPath: true, origin: "ANALYSIS",
  declaredStatus: "NOT_MET", proposedStatus: "NOT_MET", status: "NOT_MET", confirmation: "CONFIRMED", confirmationReasons: [], review: null, evidenceKind: "CONDUCT_OBSERVED",
  declaredActionTense: null, evidence: [], rejectedEvidence: [], opportunityTurn: null, rationale: null, materiality: "HIGH", guidance: null, whyItMatters: null, ruleConflict: false,
  downgrades: [], contract: "OBLIGATIONS_V1", ...overrides,
}) as AssessedCriterion
const argumentOf = (modality: "MUST" | "MAY") => ({ scriptId: ARG, scriptName: NAME, version: 1, itemKey: `g-${modality}`, field: "GUIDANCE", modality, groupMode: null, alternatives: null, condition: null }) as unknown as AssessedCriterion["argument"]

const OFFER = criterion({ lineHandle: "O1", lineKey: "ag-must#1", status: "NOT_MET", evidence: [quote("T8", "Posso cancelar agora mesmo.")], sources: [source("ag-must", "Oferecer primeiro a migração para o plano de menor valor."), source("ag-may", "Mencionar o bônus de fidelidade."), source("kb-offer", "Apresentar a oferta de retenção antes do cancelamento.")] })
const BONUS = criterion({ lineHandle: "O2", lineKey: "ag-may", status: "MET", declaredStatus: "MET", proposedStatus: "MET", evidence: [quote("T12", "E o senhor ainda ganha o bônus de fidelidade no próximo mês.")], sources: [source("ag-may", "Mencionar o bônus de fidelidade.")] })
const GREETING = criterion({ lineHandle: "O3", lineKey: "ag-point", heading: "Pontos obrigatórios na fala", status: "MET", declaredStatus: "MET", proposedStatus: "MET", evidence: [quote("T1", "Bom dia, aqui é a Carla.")], sources: [source("ag-point", "Informar o próprio nome no início do atendimento.")] })

const analysis = (criteria: AssessedCriterion[]): VerifiedCallAnalysis => ({
  transcriptStatus: "COMPLETE",
  scenario: { customerNeed: "Cancelar o plano", conditions: [], procedureDocumentId: KB, procedureTitle: "Retenção — procedimento", procedureVersion: 1, rulePerspective: "RULE_IN_FORCE_AT_CALL", correctPath: "", pathTaken: "…", pathAssessment: "INCORRECT", pathEvidence: [], pathRationale: "…" },
  criteria,
  limitations: [],
  coverage: { status: "COMPLETE" },
}) as unknown as VerifiedCallAnalysis
const briefOf = (criteria: AssessedCriterion[], withSources = true) => buildMonitoringBrief({
  analysis: analysis(criteria), interactionId: "i", label: "Retenção", dateLabel: "20/10/2026", selectionReason: "flag de cancelamento",
  criterionKeys: new Map(criteria.map((entry, index) => [entry.lineKey, `KC-00000000000${index}`])), documentTitles: new Map([[KB, "Retenção — procedimento"]]),
  documentVersions: new Map(), history: new Map(), delivered: new Set(), ...(withSources ? { sourceLines: SOURCE_LINES } : {}),
})

describe("ARGUMENT_REQUIREMENT_V1 — o feedback mostra o que o argumentário exige e o que é opcional", () => {
  it("lê do cadastro: ponto obrigatório e \"deve\" = obrigatório; \"pode\" = opcional; \"evitar\" e sem classificação, sem marca", () => {
    expect(argumentRequirementOf({ field: "REQUIRED_POINT", modality: null })).toBe("REQUIRED")
    expect(argumentRequirementOf({ field: "GUIDANCE", modality: "MUST" })).toBe("REQUIRED")
    expect(argumentRequirementOf({ field: "GUIDANCE", modality: "MAY" })).toBe("OPTIONAL")
    expect(argumentRequirementOf({ field: "GUIDANCE", modality: "UNSPECIFIED" })).toBeNull()
    expect(argumentRequirementOf({ field: "AVOID", modality: null })).toBeNull()
    expect(argumentRequirementOf(undefined)).toBeNull()
  })

  it("\"deve\" e \"pode\" da mesma seção do argumentário viram regras separadas, cada uma com a sua marca; a base fica sem marca", () => {
    const rules = rulesFromSources({ sources: OFFER.sources!, primary: { documentId: ARG, heading: "Orientação ao operador" }, sourceLines: SOURCE_LINES })!
    expect(rules.map((rule) => [rule.text, rule.requirement ?? null])).toEqual([
      ["Oferecer primeiro a migração para o plano de menor valor.", "REQUIRED"],
      ["Mencionar o bônus de fidelidade.", "OPTIONAL"],
      ["Apresentar a oferta de retenção antes do cancelamento.", null],
    ])
    const [avoid] = rulesFromSources({ sources: [source("ag-avoid", "Prometer isenção da multa.")], primary: { documentId: ARG, heading: "Condutas ou promessas a evitar" }, sourceLines: SOURCE_LINES })!
    expect(avoid!.requirement).toBeUndefined()
  })

  it("\"O processo orienta\" leva a marca de cada regra do argumentário", () => {
    const view = feedbackViewOf(briefOf([OFFER]), { card: "", paragraphs: [], sentences: [], communicatedRefs: ["A1"] })
    expect(view.developments[0]!.guidance.rules.map((rule) => [rule.label, rule.requirement ?? null])).toEqual([
      [`Argumentário “${NAME}”`, "REQUIRED"],
      [`Argumentário “${NAME}”`, "OPTIONAL"],
      ["Seção “Oferta”", null],
    ])
  })

  it("reconhecimento só de item \"pode\" é marcado opcional em \"O que manter\"; ponto obrigatório cumprido, não", () => {
    const brief = briefOf([BONUS, GREETING])
    const refs = brief.strengths.map((finding) => finding.ref)
    const view = feedbackViewOf(brief, { card: "", paragraphs: [], sentences: [], communicatedRefs: refs })
    const evidence = view.maintain!.evidence
    expect(evidence.find((entry) => entry.quotes.some((item) => item.text.includes("bônus")))!.optional).toBe(true)
    expect(evidence.find((entry) => entry.quotes.some((item) => item.text.includes("Carla")))!.optional).toBeUndefined()
  })

  it("o redator e o verificador veem o \"pode\" marcado como opcional; o \"deve\" segue sem marca", () => {
    const facts = compositionPayloadOf(briefOf([OFFER])).facts.developments[0] as { rule: string[] }
    expect(facts.rule.find((text) => text.includes("bônus"))).toMatch(/^\[pode — opcional: fazer é iniciativa, não fazer não é falha\]/)
    expect(facts.rule.find((text) => text.includes("migração"))).not.toContain("[pode")
  })

  it("sem a origem das linhas (regra única), a marca vem do item avaliado", () => {
    const single = briefOf([{ ...BONUS, argument: argumentOf("MAY") } as AssessedCriterion], false)
    expect(single.strengths[0]!.rules[0]!.requirement).toBe("OPTIONAL")
    const must = briefOf([{ ...OFFER, argument: argumentOf("MUST") } as AssessedCriterion], false)
    expect(must.developments[0]!.rules[0]!.requirement).toBe("REQUIRED")
  })
})
