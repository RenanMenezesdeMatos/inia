import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { verifyCallAnalysis, type ModelCallAnalysis, type ScenarioRole, type VerifiedCallAnalysis } from "./call-analysis.js"
import { buildMonitoringBrief } from "./feedback-brief.js"
import { confirmingReview, fixtureContext, INTERACTION_ID, modelAnalysis } from "../testing/fixtures.js"

/**
 * O QUE O BRIEF OFERECE AO REDATOR (`STRENGTH_SELECTION_V3`) — zero IA.
 *
 * Achado da rodada real da C07 (01/10): o brief oferecia dois reconhecimentos escolhidos pela QUANTIDADE de etapas cumpridas na seção
 * ("Escuta" e "Validação", que valem para toda chamada) e a mensagem narrou essas etapas. A V2 deu bônus fixo à regra condicional —
 * também não mede o que importou. Agora a prioridade é o PAPEL NO CASO lido pela análise (central = ligado à necessidade do cliente ou à
 * decisão do caso), depois materialidade e conduta observada; nem a quantidade de itens da seção nem a condicionalidade decidem.
 */
const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, "../testing/c07-reviewed-analysis.json"), "utf8")) as { interactionId: string; analysis: VerifiedCallAnalysis; criterionKeys: Record<string, string>; documentTitles: Record<string, string> }
const briefOf = (analysis: VerifiedCallAnalysis, interactionId = fixture.interactionId, keys = fixture.criterionKeys, titles = fixture.documentTitles) => buildMonitoringBrief({ analysis, interactionId, label: "Contestação de cobrança", subjectSource: "CANONICAL", dateLabel: "21/08/2026", selectionReason: "Validação mínima (C07).", criterionKeys: new Map(Object.entries(keys)), documentTitles: new Map(Object.entries(titles)), documentVersions: new Map(), history: new Map(), delivered: new Set() })
/** A leitura de papel que uma análise V3 faria — aplicada à análise REAL revisada da C07 (só o papel muda; status e evidência não). */
const withRoles = (roles: (heading: string) => ScenarioRole | null): VerifiedCallAnalysis => ({ ...fixture.analysis, criteria: fixture.analysis.criteria.map((criterion) => ({ ...criterion, scenarioRole: roles(criterion.heading ?? "") })) })
const c07Roles = (heading: string): ScenarioRole | null => (/^(21|30|34|35)\./.test(heading) ? "CENTRAL" : /^(6|7)\./.test(heading) ? "ROUTINE" : "SUPPORTING")

describe("C07 real: o papel no caso decide o que é oferecido, não a condicionalidade nem a quantidade de itens", () => {
  it("com a leitura de papel, a conduta central vem antes da validação e da escuta; a fala da condição acompanha o ponto", () => {
    const value = briefOf(withRoles(c07Roles))
    expect(value.developments.map((finding) => finding.title)).toEqual(["Recapitulação obrigatória"])
    const titles = value.strengths.map((finding) => finding.title)
    expect(titles).toHaveLength(3)
    // As duas condutas centrais com falas DIFERENTES; a terceira (central com a mesma fala de uma já oferecida) cede a vez.
    expect(value.strengths.slice(0, 2).map((finding) => [finding.title, finding.role])).toEqual([["Cobrança após cancelamento", "CENTRAL"], ["Crédito em conta futura", "CENTRAL"]])
    expect(titles).not.toContain("Validação de segurança")
    expect(titles).not.toContain("Escuta e identificação da solicitação")
    const credit = value.strengths.find((finding) => finding.title === "Crédito em conta futura")!
    expect(credit.quotes).toEqual([
      { speaker: "OPERATOR", turn: "T12", text: "Como a fatura já foi paga, se a contestação for aprovada o valor volta como crédito na próxima fatura." },
      { speaker: "CUSTOMER", turn: "T10", text: "Já paguei, sim." },
    ])
  })

  it("sem a leitura de papel (análise anterior), a regra condicional NÃO ganha prioridade por ser condicional", () => {
    const value = briefOf(fixture.analysis)
    // A ordem cai na materialidade e na conduta observada (o mesmo para toda regra); a fala da condição continua só como contexto.
    expect(value.strengths[0]!.title).toBe("Validação de segurança")
    expect(value.strengths.some((finding) => finding.situational)).toBe(true)
  })
})

describe("situações diferentes da C07", () => {
  const { context, line } = fixtureContext()
  const verified = (criteria: ModelCallAnalysis["criteria"]) => {
    const preliminary = verifyCallAnalysis({ model: modelAnalysis({ criteria }), context, projection: fixtureContext().projection, transcriptStatus: "COMPLETE", interactionId: INTERACTION_ID, subjectAnchoredDocumentIds: [], repairAttempted: false })
    return verifyCallAnalysis({ model: modelAnalysis({ criteria }), context, projection: fixtureContext().projection, transcriptStatus: "COMPLETE", interactionId: INTERACTION_ID, subjectAnchoredDocumentIds: [], repairAttempted: false, review: { attempted: true, review: confirmingReview(preliminary), error: null } })
  }
  const keys = (analysis: VerifiedCallAnalysis) => Object.fromEntries(analysis.criteria.map((criterion) => [criterion.lineKey, `KC-${criterion.lineHandle}`]))

  it("conduta central NÃO condicional vence uma seção de rotina com mais itens cumpridos", () => {
    const analysis = verified([
      { line: line("Confirmar nome completo").handle, status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Me confirma seu nome completo?" }], opportunityTurn: null, rationale: "Validou.", materiality: "HIGH", guidance: null, whyItMatters: null, scenarioRole: "ROUTINE" },
      { line: line("Confirmar data de nascimento").handle, status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Me confirma seu nome completo?" }], opportunityTurn: null, rationale: "Validou.", materiality: "HIGH", guidance: null, whyItMatters: null, scenarioRole: "ROUTINE" },
      { line: line("Confirmar se a solicitação").handle, status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T5", speaker: "OPERADOR", quote: "A segunda via é da fatura ou do parcelamento?" }], opportunityTurn: null, rationale: "Separou fatura de parcelamento antes de enviar.", materiality: "MEDIUM", guidance: null, whyItMatters: null, scenarioRole: "CENTRAL" },
    ])
    const value = briefOf(analysis, INTERACTION_ID, keys(analysis), {})
    expect(value.strengths[0]).toMatchObject({ title: "Confirmar se a solicitação é da fatura ou do parcelamento", role: "CENTRAL" })
  })

  it("só reconhecimento quando não há ajuste: o brief não inventa correção (tom RECOGNITION)", () => {
    const analysis = verified([
      { line: line("Confirmar se a solicitação").handle, status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T5", speaker: "OPERADOR", quote: "A segunda via é da fatura ou do parcelamento?" }], opportunityTurn: null, rationale: "Separou fatura de parcelamento.", materiality: "HIGH", guidance: null, whyItMatters: null, scenarioRole: "CENTRAL" },
    ])
    const value = briefOf(analysis, INTERACTION_ID, keys(analysis), {})
    expect(value.developments).toEqual([])
    expect(value.tone).toBe("RECOGNITION")
  })

  it("ajuste central vem antes de ajuste de rotina mais 'material' pela leitura genérica", () => {
    const analysis = verified([
      { line: line("Confirmar data de nascimento").handle, status: "NOT_MET", evidenceKind: "OMISSION", evidence: [], opportunityTurn: "T4", rationale: "Não pediu a data.", materiality: "HIGH", guidance: null, whyItMatters: null, scenarioRole: "ROUTINE" },
      { line: line("Enviar a segunda via").handle, status: "NOT_MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T7", speaker: "OPERADOR", quote: "Vou enviar por e-mail agora mesmo." }], opportunityTurn: null, rationale: "Não perguntou o canal escolhido.", materiality: "MEDIUM", guidance: null, whyItMatters: null, scenarioRole: "CENTRAL" },
    ])
    const value = briefOf(analysis, INTERACTION_ID, keys(analysis), {})
    expect(value.developments.map((finding) => finding.role)).toEqual(["CENTRAL", "ROUTINE"])
  })
})
