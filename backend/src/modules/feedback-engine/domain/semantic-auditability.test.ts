import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { projectTranscript } from "../../investigation/domain/transcript-projection.js"
import { verifyCallAnalysis, type ModelCallAnalysis, type ModelCriterion } from "./call-analysis.js"
import type { CallReview, ClaimVerdict } from "./call-review.js"
import { obligationCriterionKeyOf } from "./criteria-identity.js"
import { buildMonitoringBrief } from "./feedback-brief.js"
import { criterionPatternsOf, type MemoryRow } from "./indicator-investigation.js"
import { buildProcedureContext } from "./procedure.js"
import { statsOf } from "../application/leadership-diagnostics.js"

/**
 * APLICABILIDADE × EVIDÊNCIA × CUMPRIMENTO (`SEMANTIC_AUDITABILITY_V1`) — testes SIMULADOS (zero IA: as leituras do modelo e da revisora
 * são escritas aqui). O que se prova é o que o CÓDIGO faz com a leitura semântica: nunca decide pelo verbo, por palavra-chave ou pelo
 * nome de um sistema; aplica as consequências lógicas (incerto ≠ não cumpriu; fora da conversa ≠ cumprido/descumprido; declaração ≠
 * execução; parte ≠ regra inteira) e as checagens objetivas de integridade (citação existe, turno, falante, oportunidade). Se o modelo
 * real faz a leitura certa é outra pergunta — só uma rodada com modelo responde (não é feita aqui).
 */
const DOC = "00000000-0000-4000-8000-00000000a001"
const INTERACTION = "00000000-0000-4000-8000-00000000a0f1"
const PROCEDURE = `# Linha bloqueada (teste)

## 1. Atendimento de linha bloqueada

- Consulte o status da linha no PLATON e verifique se há bloqueio.
- Informe ao cliente a situação da linha.
- Quando o cliente perguntar quando a linha volta a funcionar, informe o prazo de até 24 horas para o desbloqueio.
- Valide a identidade do titular perguntando o nome completo.
- Valide no ZEUS-7 se o titular está adimplente.
- Consulte o status no PLATON, verifique se há bloqueio e informe a situação ao cliente.
`
/** A MESMA regra escrita com outros verbos e outros sistemas (a leitura do modelo é a mesma — o código tem que concluir igual). */
const REWRITTEN = PROCEDURE.replaceAll("Consulte o status da linha no PLATON e verifique se há bloqueio", "Cheque no KRONOS-X se existe restrição ativa na linha")
  .replaceAll("Valide no ZEUS-7 se o titular está adimplente", "Confira na tela FINANCEIRO-ORION a adimplência do titular")
  .replaceAll("Consulte o status no PLATON, verifique se há bloqueio e informe a situação ao cliente", "Abra o KRONOS-X, confira a restrição e explique ao cliente o que encontrou")
const TRANSCRIPT = [
  "Cliente: Oi, minha linha está bloqueada e eu preciso usar hoje.",
  "Operador: Entendo. Pode me confirmar seu nome completo?",
  "Cliente: Maria Souza Lima.",
  "Operador: Obrigado, Maria. Já consultei aqui no sistema.",
  "Cliente: E quando volta a funcionar?",
  "Operador: Vou verificar isso para a senhora. A linha está com bloqueio por falta de pagamento.",
  "Cliente: Tudo bem, obrigada.",
  "Operador: Disponha, tenha um bom dia.",
].join("\n")

function setup(content = PROCEDURE, transcript = TRANSCRIPT) {
  const context = buildProcedureContext([{ documentId: DOC, title: "Linha bloqueada", version: 1, content, contentHash: "h1", perspective: "RULE_IN_FORCE_AT_CALL", selection: "SUBJECT_ANCHOR", relevance: 1 }])
  const lines = [...context.lines.values()]
  return { context, projection: projectTranscript(transcript), L: (index: number) => lines[index]!.handle }
}
const criterion = (fields: Partial<ModelCriterion> & Pick<ModelCriterion, "line" | "status">): ModelCriterion => ({ evidenceKind: null, declaredActionTense: null, evidence: [], opportunityTurn: null, rationale: "leitura simulada", materiality: "HIGH", guidance: null, whyItMatters: null, itemNature: null, scenarioRole: "CENTRAL", ...fields })
const model = (criteria: ModelCriterion[], extra: Partial<ModelCallAnalysis> = {}): ModelCallAnalysis => ({
  scenario: { customerNeed: "Entender o bloqueio e quando a linha volta", conditions: [{ text: "Linha bloqueada", evidence: [{ turn: "T1", speaker: "CLIENTE", quote: "Oi, minha linha está bloqueada e eu preciso usar hoje." }] }], procedure: "D1", procedureRationale: null, pathSections: ["S1"], correctPath: "x", pathTaken: "y", pathAssessment: "UNDETERMINED", pathRationale: "", pathEvidence: [] },
  criteria,
  sectionDispositions: [],
  groupDispositions: [],
  sourceConflicts: [],
  limitations: [],
  contractViolations: [],
  ...extra,
})
const confirm = (id: string, fields: Partial<ClaimVerdict> = {}): [string, ClaimVerdict] => [id, { id, verdict: "CONFIRMED", issues: [], listReading: "CUMULATIVE", conditionEvidence: [], counterEvidence: [], note: null, ...fields }]
function run(analysis: ModelCallAnalysis, claims: [string, ClaimVerdict][], options: { content?: string; transcript?: string; transcriptStatus?: "COMPLETE" | "INCOMPLETE" } = {}) {
  const { context, projection } = setup(options.content, options.transcript)
  const review: CallReview = { claims: new Map(claims), path: null, lines: [], exclusions: new Map(), violations: [] }
  return verifyCallAnalysis({ model: analysis, context, projection, transcriptStatus: options.transcriptStatus ?? "COMPLETE", interactionId: INTERACTION, subjectAnchoredDocumentIds: [DOC], repairAttempted: false, review: { attempted: true, review, error: null } })
}
const briefOf = (result: ReturnType<typeof run>) => buildMonitoringBrief({ analysis: result, interactionId: INTERACTION, label: "Linha bloqueada", dateLabel: "01/10/2026", selectionReason: "teste", criterionKeys: new Map(result.criteria.map((entry) => [entry.lineKey, `KC-${entry.lineHandle}`])), documentTitles: new Map([[DOC, "Linha bloqueada"]]), documentVersions: new Map(), history: new Map(), delivered: new Set() })
const find = (result: ReturnType<typeof run>, ref: string) => result.criteria.find((entry) => entry.lineHandle === ref)!
const T2 = { turn: "T2", speaker: "OPERADOR", quote: "Entendo. Pode me confirmar seu nome completo?" }
const T4 = { turn: "T4", speaker: "OPERADOR", quote: "Já consultei aqui no sistema." }
const T5 = { turn: "T5", speaker: "CLIENTE", quote: "E quando volta a funcionar?" }
const T6_INTENT = { turn: "T6", speaker: "OPERADOR", quote: "Vou verificar isso para a senhora." }
const T6_STATUS = { turn: "T6", speaker: "OPERADOR", quote: "A linha está com bloqueio por falta de pagamento." }

describe("execução fora da conversa × conduta na conversa (simulado)", () => {
  const { L } = setup()

  it("consulta interna NÃO verbalizada: nenhuma acusação — mesmo que a leitura proponha 'não fez', a transcrição não sustenta", () => {
    const result = run(model([criterion({ line: L(0), status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T4", observability: "OUTSIDE_CONVERSATION", applicability: "APPLIES", itemNature: "INTERNAL_ACTION" })]), [confirm(L(0))])
    expect(find(result, L(0))).toMatchObject({ status: "NOT_OBSERVABLE", observability: "OUTSIDE_CONVERSATION", executionClaim: "NONE", downgrades: ["EXECUTION_NOT_VERIFIABLE_BY_TRANSCRIPT"] })
    const brief = briefOf(result)
    expect(brief.developments).toEqual([])
    expect(brief.openPoints).toBeUndefined()
    expect(brief.coverageLimits).toEqual([expect.objectContaining({ reason: "OUTSIDE_CONVERSATION", executionClaim: "NONE" })])
    expect(result.coverageLimits).toMatchObject({ outsideConversation: 1 })
  })

  it("DECLARAÇÃO de consulta ('Já consultei aqui no sistema'): fica registrada como declaração — nunca vira execução comprovada nem elogio", () => {
    const result = run(model([criterion({ line: L(0), status: "MET", evidenceKind: "DECLARED_ACTION", declaredActionTense: "COMPLETED", evidence: [T4], observability: "OUTSIDE_CONVERSATION", applicability: "APPLIES", itemNature: "INTERNAL_ACTION" })]), [confirm(L(0))])
    expect(find(result, L(0))).toMatchObject({ status: "NOT_OBSERVABLE", executionClaim: "DECLARED", evidence: [expect.objectContaining({ turn: "T4" })] })
    expect(briefOf(result).strengths).toEqual([])
    expect(result.coverageLimits).toMatchObject({ declaredExecutions: 1 })
  })

  it("INTENÇÃO de consultar ('Vou verificar…'): intenção, não execução", () => {
    const result = run(model([criterion({ line: L(0), status: "MET", evidenceKind: "DECLARED_ACTION", declaredActionTense: "INTENDED", evidence: [T6_INTENT], observability: "OUTSIDE_CONVERSATION", applicability: "APPLIES" })]), [confirm(L(0))])
    expect(find(result, L(0))).toMatchObject({ status: "NOT_OBSERVABLE", executionClaim: "INTENDED" })
    expect(result.coverageLimits).toMatchObject({ intendedExecutions: 1 })
  })

  it("informação OBRIGATÓRIA ausente, com aplicabilidade e oportunidade comprovadas → desvio confirmado", () => {
    const result = run(model([criterion({ line: L(2), status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T6", observability: "IN_CONVERSATION", applicability: "APPLIES", condition: "o cliente perguntar quando a linha volta a funcionar", applicabilityEvidence: [T5], itemNature: "COMMUNICATION" })]), [confirm(L(2), { conditionEvidence: [T5] })])
    expect(find(result, L(2))).toMatchObject({ status: "NOT_MET", confirmation: "CONFIRMED", applicability: "APPLIES", applicabilityEvidence: [expect.objectContaining({ turn: "T5" })] })
    expect(briefOf(result).developments.map((finding) => finding.status)).toEqual(["NOT_MET"])
  })

  it("a MESMA informação dita por PARÁFRASE cumpre — o código nunca compara a fala com o texto da regra", () => {
    const transcript = TRANSCRIPT.replace("Vou verificar isso para a senhora. A linha está com bloqueio por falta de pagamento.", "Em no máximo um dia a sua linha volta a funcionar.")
    const quote = { turn: "T6", speaker: "OPERADOR", quote: "Em no máximo um dia a sua linha volta a funcionar." }
    const result = run(model([criterion({ line: L(2), status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [quote], observability: "IN_CONVERSATION", applicability: "APPLIES", condition: "o cliente perguntar quando volta", applicabilityEvidence: [T5], itemNature: "COMMUNICATION" })]), [confirm(L(2), { conditionEvidence: [T5] })], { transcript })
    expect(find(result, L(2))).toMatchObject({ status: "MET", confirmation: "CONFIRMED" })
  })

  it("aplicabilidade INCERTA nunca vira 'não cumpriu' nem 'não se aplica'", () => {
    const result = run(model([
      criterion({ line: L(2), status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T6", observability: "IN_CONVERSATION", applicability: "UNCERTAIN" }),
      criterion({ line: L(1), status: "NOT_APPLICABLE", rationale: "talvez não", observability: "IN_CONVERSATION", applicability: "UNCERTAIN" }),
    ]), [confirm(L(2))])
    expect(find(result, L(2))).toMatchObject({ status: "NOT_OBSERVABLE", downgrades: ["APPLICABILITY_UNCERTAIN"] })
    expect(find(result, L(1))).toMatchObject({ status: "NOT_OBSERVABLE", downgrades: ["APPLICABILITY_UNCERTAIN"] })
    expect(result.coverageLimits).toMatchObject({ applicabilityUncertain: 2 })
  })

  it("transcrição INCOMPLETA: omissão não se sustenta", () => {
    const result = run(model([criterion({ line: L(2), status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T6", observability: "IN_CONVERSATION", applicability: "APPLIES", condition: "pergunta", applicabilityEvidence: [T5] })]), [confirm(L(2), { conditionEvidence: [T5] })], { transcriptStatus: "INCOMPLETE" })
    expect(find(result, L(2))).toMatchObject({ status: "NOT_OBSERVABLE", downgrades: ["OMISSION_ON_INCOMPLETE_TRANSCRIPT"] })
  })

  it("o MESMO verbo em contextos diferentes: 'valide… perguntando' é conversa, 'valide no sistema' não — decide a leitura, nunca a palavra", () => {
    const result = run(model([
      criterion({ line: L(3), status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [T2], observability: "IN_CONVERSATION", applicability: "APPLIES", itemNature: "INFORMATION_REQUEST" }),
      criterion({ line: L(4), status: "MET", evidenceKind: "NONE", observability: "OUTSIDE_CONVERSATION", applicability: "APPLIES", itemNature: "INTERNAL_ACTION" }),
    ]), [confirm(L(3)), confirm(L(4))])
    expect(find(result, L(3))).toMatchObject({ status: "MET", confirmation: "CONFIRMED" })
    expect(find(result, L(4))).toMatchObject({ status: "NOT_OBSERVABLE", executionClaim: "NONE" })
    // O código segue a leitura semântica (o par de leitores é análise + revisão): mesmo texto, leitura oposta → consequência oposta.
    const flipped = run(model([criterion({ line: L(3), status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [T2], observability: "OUTSIDE_CONVERSATION", applicability: "APPLIES" })]), [confirm(L(3))])
    expect(find(flipped, L(3)).status).toBe("NOT_OBSERVABLE")
  })

  it("sistemas DESCONHECIDOS e redação inteira trocada: com a mesma leitura, a mesma conclusão (o código não lê verbos nem nomes de sistema)", () => {
    const readings = (L: (index: number) => string) => model([
      criterion({ line: L(0), status: "MET", evidenceKind: "DECLARED_ACTION", declaredActionTense: "COMPLETED", evidence: [T4], observability: "OUTSIDE_CONVERSATION", applicability: "APPLIES" }),
      criterion({ line: L(1), status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [T6_STATUS], observability: "IN_CONVERSATION", applicability: "APPLIES" }),
      criterion({ line: L(4), status: "NOT_MET", evidenceKind: "OMISSION", opportunityTurn: "T4", observability: "OUTSIDE_CONVERSATION", applicability: "APPLIES" }),
    ])
    const original = run(readings(setup().L), [confirm(setup().L(1))])
    const rewritten = run(readings(setup(REWRITTEN).L), [confirm(setup(REWRITTEN).L(1))], { content: REWRITTEN })
    const summary = (result: ReturnType<typeof run>) => result.criteria.filter((entry) => entry.origin === "ANALYSIS").map((entry) => [entry.lineHandle, entry.status, entry.executionClaim ?? null, entry.downgrades.join("+")])
    expect(summary(rewritten)).toEqual(summary(original))
    expect(summary(original)).toEqual([["L1", "NOT_OBSERVABLE", "DECLARED", "EXECUTION_NOT_VERIFIABLE_BY_TRANSCRIPT"], ["L2", "MET", null, ""], ["L5", "NOT_OBSERVABLE", "NONE", "EXECUTION_NOT_VERIFIABLE_BY_TRANSCRIPT"]])
  })
})

describe("regra COMPOSTA: cada parte com a evidência da sua natureza (simulado)", () => {
  const { L } = setup()
  const parts = (third: Record<string, unknown>) => [
    { part: "Consulte o status no PLATON", applicability: "APPLIES", observability: "OUTSIDE_CONVERSATION", status: "NOT_OBSERVABLE", evidenceKind: "NONE", evidence: [], applicabilityEvidence: [], opportunityTurn: null, rationale: "No sistema; a gravação não mostra.", itemNature: "INTERNAL_ACTION", requiredAction: null, condition: null, evidenceNeeded: "registro do sistema", declaredActionTense: null },
    { part: "verifique se há bloqueio", applicability: "APPLIES", observability: "OUTSIDE_CONVERSATION", status: "MET", evidenceKind: "DECLARED_ACTION", declaredActionTense: "COMPLETED", evidence: [T4], applicabilityEvidence: [], opportunityTurn: null, rationale: "Disse que consultou.", itemNature: "INTERNAL_ACTION", requiredAction: null, condition: null, evidenceNeeded: "registro do sistema" },
    { part: "informe a situação ao cliente", applicability: "APPLIES", observability: "IN_CONVERSATION", applicabilityEvidence: [], requiredAction: null, condition: null, evidenceNeeded: "fala do operador", declaredActionTense: null, itemNature: "COMMUNICATION", ...third },
  ] as NonNullable<ModelCriterion["obligations"]>

  it("parte interna não observável + parte comunicada: a regra NÃO fica descumprida (consulta) nem inteira cumprida (comunicação)", () => {
    const result = run(model([criterion({ line: L(5), status: "PARTIAL", observability: "IN_CONVERSATION", applicability: "APPLIES", obligations: parts({ status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [T6_STATUS], opportunityTurn: null, rationale: "Informou o bloqueio." }) })]), [confirm(`${L(5)}.3`)])
    expect(result.criteria.some((entry) => entry.lineHandle === L(5))).toBe(false)
    expect(result.composites).toEqual([expect.objectContaining({ lineHandle: L(5), parts: ["Consulte o status no PLATON", "verifique se há bloqueio", "informe a situação ao cliente"] })])
    expect([`${L(5)}.1`, `${L(5)}.2`, `${L(5)}.3`].map((ref) => [find(result, ref).status, find(result, ref).executionClaim ?? null])).toEqual([["NOT_OBSERVABLE", "NONE"], ["NOT_OBSERVABLE", "DECLARED"], ["MET", null]])
    const brief = briefOf(result)
    expect(brief.strengths).toEqual([expect.objectContaining({ title: "informe a situação ao cliente" })])
    // A regra literal inteira acompanha a parte (nunca um pedaço solto como se fosse a regra).
    expect(brief.strengths[0]!.rules[0]).toMatchObject({ text: expect.stringContaining("Consulte o status no PLATON, verifique se há bloqueio e informe a situação ao cliente"), part: "informe a situação ao cliente" })
    expect(brief.strengths[0]!.observed).toBe("A parte “informe a situação ao cliente” desta regra foi cumprida nesta chamada.")
    // Identidades diferentes na memória: o não observável de uma parte nunca contamina a série da outra.
    const parent = "KC-0123456789ab"
    expect(new Set(["Consulte o status no PLATON", "verifique se há bloqueio", "informe a situação ao cliente"].map((part) => obligationCriterionKeyOf(parent, part))).size).toBe(3)
    expect(obligationCriterionKeyOf("AG-0123456789ab", "informe a situação ao cliente")).toMatch(/^AG-[0-9a-f]{12}$/)
  })

  it("a parte comunicada FALTOU (oportunidade comprovada): o desvio é só dessa parte; a consulta continua não observável", () => {
    const transcript = TRANSCRIPT.replace(" A linha está com bloqueio por falta de pagamento.", "")
    const result = run(model([criterion({ line: L(5), status: "NOT_MET", observability: "IN_CONVERSATION", applicability: "APPLIES", obligations: parts({ status: "NOT_MET", evidenceKind: "OMISSION", evidence: [], opportunityTurn: "T6", rationale: "Não disse o que encontrou." }) })]), [confirm(`${L(5)}.3`)], { transcript })
    expect(find(result, `${L(5)}.3`)).toMatchObject({ status: "NOT_MET", confirmation: "CONFIRMED" })
    expect(find(result, `${L(5)}.1`).status).toBe("NOT_OBSERVABLE")
    const brief = briefOf(result)
    expect(brief.developments.map((finding) => finding.title)).toEqual(["informe a situação ao cliente"])
    expect(brief.developments[0]!.observed).toMatch(/A parte “informe a situação ao cliente” desta regra não aparece/)
  })

  it("parte que não é trecho LITERAL da regra é recusada (integridade) — só as partes que estão na regra viram critério", () => {
    const invented = parts({ status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [T6_STATUS], opportunityTurn: null, rationale: "x" }).map((part, index) => (index === 2 ? { ...part, part: "explique tudo com empatia" } : part))
    const result = run(model([criterion({ line: L(5), status: "NOT_OBSERVABLE", observability: "IN_CONVERSATION", applicability: "APPLIES", obligations: invented })]), [])
    expect(result.checks.contractViolations).toContain(`criteria:${L(5)}:OBLIGATION_PART_NOT_IN_RULE`)
    expect(result.criteria.filter((entry) => entry.obligation).map((entry) => entry.obligation!.part)).toEqual(["Consulte o status no PLATON", "verifique se há bloqueio"])
  })
})

describe("efeito nos diagnósticos e denominadores (simulado)", () => {
  it("não observável (inclusive fora da conversa) e não aplicável ficam FORA do denominador; só confirmadas contam", () => {
    const row = (status: MemoryRow["status"], key = "KC-aaaaaaaaaaaa"): MemoryRow => ({ interactionId: `i-${Math.random()}`, personId: "p", criterionKey: key, documentId: DOC, documentTitle: "Linha bloqueada", heading: null, text: "x", status, localDate: "2026-10-01", evidence: [], rationale: null, guidance: null, materiality: "HIGH" })
    const [pattern] = criterionPatternsOf([row("MET"), row("NOT_MET"), row("NOT_OBSERVABLE"), row("NOT_OBSERVABLE"), row("NOT_APPLICABLE")])
    expect(pattern).toMatchObject({ eligible: 2, met: 1, notMet: 1, inconclusive: 2, notApplicable: 1 })
    expect(statsOf({ calls: 5, assessed: 2, met: 1, not_met: 1, partial: 0, inconclusive: 2, not_applicable: 1, outside_conversation: 2 })).toMatchObject({ deviationRate: 50, coverageRate: 50, outsideConversation: 2 })
  })
})
