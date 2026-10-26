import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { argumentScriptSourceOf, normalizeArgumentScriptContent } from "../../argument-scripts/domain/argument-script.js"
import { projectTranscript } from "../../investigation/domain/transcript-projection.js"
import { buildProcedureContext } from "./procedure.js"
import type { ModelObligationAnalysis } from "./obligation-analysis.js"
import { OBLIGATION_ANALYSIS_SYSTEM_PROMPT } from "./obligation-analysis-prompt.js"
import { verifyObligationAnalysis } from "./obligation-verification.js"
import { obligationClaimOf, OBLIGATION_REVIEW_RESPONSE_SCHEMA, OBLIGATION_REVIEW_SYSTEM_PROMPT } from "./obligation-review.js"
import { buildMonitoringBrief } from "./feedback-brief.js"
import { feedbackViewOf } from "./feedback-view.js"
import { sourceDocuments, TRANSCRIPT } from "../testing/fixtures.js"

/**
 * Validação funcional de 20/10/2026, zero IA (as leituras do modelo são escritas aqui).
 *   - `OPTIONAL_GUIDANCE_RECOGNITION_V1`: a operadora ofereceu o Bônus Girassol (orientação "pode" do argumentário) e isso nunca chegou
 *     ao feedback — "pode" não era obrigação, e nenhuma etapa o avaliava. Agora a análise o registra feito como acerto; o código garante
 *     que um "pode" lido como não feito nunca vira desvio.
 *   - `CONDITION_EVIDENCE_REQUIRED_V1`: a revisora confirmou a multa não informada sem citar a fala da condição (campo opcional) e o
 *     desvio caiu para "não observável" — agora a fala da condição é parte obrigatória da resposta.
 */
const projection = projectTranscript(TRANSCRIPT)
const script = argumentScriptSourceOf({
  scriptId: "00000000-0000-4000-8000-00000000c601", versionId: "v1", version: 1, name: "Segunda via (teste)", areaName: "Faturamento",
  scope: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, teamName: null, subteamName: null }, subjectName: null, conversion: "NATIVE",
  content: normalizeArgumentScriptContent({ trigger: "O cliente pede a segunda via da conta.", notApplicableWhen: null, operatorGuidance: [
    { key: "g-app", text: "Orientar a consulta pelo aplicativo.", modality: "MUST" },
    { key: "g-email", text: "Oferecer o envio da conta também por e-mail.", modality: "MAY" },
    { key: "g-debito", text: "Oferecer o débito automático.", modality: "MAY" },
  ], requiredPoints: [], avoid: [], suggestedScript: null, monitoringReference: null }),
  contentHash: "s1", effectiveFrom: new Date("2026-09-01T00:00:00Z"), effectiveUntil: null, sourceDocumentId: null, sourceDocumentTitle: null, sourceReference: null,
}, null)
const context = buildProcedureContext(sourceDocuments(), [script])
const scriptHandle = context.documents.find((document) => document.kind === "ARGUMENT_SCRIPT")!.handle
const line = (text: string) => [...context.lines.values()].find((entry) => entry.text.includes(text))!.handle
type Obligation = ModelObligationAnalysis["obligations"][number]
const obligation = (overrides: Partial<Obligation>): Obligation => ({ id: "OBL-1", sources: [line("envio da conta também por e-mail")], action: "Oferecer o envio por e-mail", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding: "MET", evidence: [{ turn: "T7", speaker: "OPERADOR", quote: "Vou enviar por e-mail agora mesmo.", role: "CONDUCT" }], opportunityTurn: null, materiality: "MEDIUM", role: "SUPPORTING", rationale: "Ofereceu o envio por e-mail.", guidance: null, ...overrides })
const analysis = (obligations: Obligation[]): ModelObligationAnalysis => ({ contract: "OBLIGATIONS_V1", need: { summary: "Segunda via da fatura", conditions: [] }, sources: { primary: "D1", related: [scriptHandle], rationale: "Procedimento da segunda via." }, argumentScripts: [{ script: scriptHandle, applies: "APPLIES", evidence: [{ turn: "T2", speaker: "CLIENTE", quote: "Bom dia, é o Carlos. Preciso da segunda via da conta." }], rationale: "Pediu a segunda via." }], obligations, notAssessed: [], conduct: { pathTaken: "Validou e enviou.", assessment: "UNDETERMINED", rationale: "" }, sourceConflicts: [], limitations: [], contractViolations: [] })
const verify = (model: ModelObligationAnalysis) => verifyObligationAnalysis({ model, context, projection, transcriptStatus: "COMPLETE", interactionId: "i1", subjectAnchoredDocumentIds: [] })
const fromAnalysis = (result: ReturnType<typeof verify>) => result.criteria.filter((criterion) => criterion.origin === "ANALYSIS")

describe("OPTIONAL_GUIDANCE_RECOGNITION_V1 — \"pode\" feito é reconhecimento; não feito nunca é desvio", () => {
  it("o prompt da análise pede o \"pode\" feito como acerto e nunca como falta", () => {
    expect(OBLIGATION_ANALYSIS_SYSTEM_PROMPT).toContain("Orientação de argumentário marcada (pode — opcional …)")
    expect(OBLIGATION_ANALYSIS_SYSTEM_PROMPT).toContain("nunca é NOT_MET, PARTIAL nem notAssessed")
  })

  it("obrigação só de \"pode\" lida como não feita (ou em parte) sai, com a nota de auditoria — diga o que disser a leitura", () => {
    for (const finding of ["NOT_MET", "PARTIAL"] as const) {
      const result = verify(analysis([obligation({ id: "OBL-1", sources: [line("débito automático")], action: "Oferecer o débito automático", finding, evidence: [], opportunityTurn: "T9" })]))
      expect(fromAnalysis(result)).toEqual([])
      expect(result.auditNotes).toContain("[O1] é orientação opcional (\"pode\") do argumentário: não ter sido feita não conta como desvio.")
      // O "pode" também não vira lacuna de cobertura (nunca é cobrado).
      expect(result.criteria.some((criterion) => criterion.text.includes("débito automático"))).toBe(false)
    }
  })

  it("junto de uma fonte obrigatória, a obrigação é da outra fonte: o desvio continua", () => {
    const result = verify(analysis([obligation({ sources: [line("Orientar a consulta pelo aplicativo"), line("débito automático")], action: "Orientar o aplicativo", finding: "NOT_MET", evidence: [], opportunityTurn: "T9" })]))
    expect(fromAnalysis(result).map((criterion) => criterion.declaredStatus)).toEqual(["NOT_MET"])
  })

  it("\"pode\" feito vira acerto do argumentário e chega ao feedback como reconhecimento marcado opcional", () => {
    // Passagem preliminar → conclusões enviadas à revisão → a revisora confirma o acerto (a fala é a própria conduta).
    const model = analysis([obligation({})])
    const sentClaims = fromAnalysis(verify(model)).map(obligationClaimOf)
    const confirmed = { id: "O1", verdict: "CONFIRMED" as const, issues: [], listReading: null, evidenceReading: "ACTION_IN_CALL" as const, outsideDependency: false, actPlace: "IN_CONVERSATION" as const, conditionEvidence: [], counterEvidence: [], note: null }
    const result = verifyObligationAnalysis({ model, context, projection, transcriptStatus: "COMPLETE", interactionId: "i1", subjectAnchoredDocumentIds: [], review: { attempted: true, review: { claims: new Map([["O1", confirmed]]), lines: [], missed: [], path: null, violations: [], contract: "V7" }, error: null, sentClaims, requested: { linesToAssess: [] } } })
    const [met] = fromAnalysis(result)
    expect(met).toMatchObject({ status: "MET", argument: expect.objectContaining({ field: "GUIDANCE", modality: "MAY" }) })
    const brief = buildMonitoringBrief({ analysis: result, interactionId: "i1", label: "Segunda via", dateLabel: "20/10/2026", selectionReason: "teste", criterionKeys: new Map(), documentTitles: new Map(), documentVersions: new Map(), history: new Map(), delivered: new Set() })
    expect(brief.strengths.map((finding) => finding.rules[0]?.requirement)).toEqual(["OPTIONAL"])
    const view = feedbackViewOf(brief, { card: "", paragraphs: [], sentences: [], communicatedRefs: brief.strengths.map((finding) => finding.ref) })
    expect(view.maintain!.evidence).toEqual([expect.objectContaining({ optional: true, quotes: [expect.objectContaining({ text: "Vou enviar por e-mail agora mesmo." })] })])
  })
})

describe("CONDITION_EVIDENCE_REQUIRED_V1 — a revisora sempre responde a fala da condição", () => {
  it("conditionEvidence é campo obrigatório de cada conclusão, e o prompt diz por quê", () => {
    const claims = (OBLIGATION_REVIEW_RESPONSE_SCHEMA as { properties: { claims: { items: { required: string[] } } } }).properties.claims.items
    expect(claims.required).toContain("conditionEvidence")
    expect(OBLIGATION_REVIEW_SYSTEM_PROMPT).toContain("conditionEvidence (obrigatório)")
    expect(OBLIGATION_REVIEW_SYSTEM_PROMPT).toContain("mesmo que a analista já a tenha citado, cite-a você")
  })
})
