import { describe, expect, it } from "vitest"
import { evaluateStop, extractStopDeclaration, STATE_MARKER, type SufficiencyContext } from "./evidence-sufficiency.js"
import { assessLedgerRepresentativeness } from "./evidence-representativeness.js"
import { resolveInvestigationObjective } from "./investigation-objective.js"
import type { LedgerEntry } from "./evidence-ledger.js"
import type { ToolKey } from "./tool-catalog.js"

const entry = (ref: string, tool: string, sampleCount: number | null, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({ ref, sequence: 1, round: 1, tool, capability: tool.includes("interaction") || tool.startsWith("analyze") ? "INTERACTION_ANALYSIS" : "INDICATOR_ANALYSIS", keyArgs: "", summary: `fato ${ref}`, qualityStatus: "SUFFICIENT", qualityNote: null, sampleCount, periodLabel: null, preflight: false, ...extra })
const snapshot = entry("F1", "get_indicator_snapshot", 21, { signals: { withinTarget: false } })
const comparison = entry("F2", "compare_periods", 21, { signals: { performance: "IMPROVED" } })
const population = entry("F3", "compare_population", 24, { signals: { performance: "WORSE_THAN_REFERENCE" } })
const twoCalls = entry("F4", "analyze_interactions", 2)
const ALL_TOOLS: ToolKey[] = ["compare_periods", "compare_population", "segment_indicator", "find_interactions", "get_interaction_context", "analyze_interactions", "get_interaction_flags", "find_comparable_interactions", "analyze_peer_patterns", "query_knowledge", "get_employee_history"]

function context(overrides: Partial<SufficiencyContext> & Pick<SufficiencyContext, "objective" | "ledger">): SufficiencyContext {
  return { assessments: assessLedgerRepresentativeness(overrides.ledger, overrides.interactionsInPeriod ?? null, null), interactionsInPeriod: null, transcriptInFocus: false, knowledgeAvailable: true, availableTools: ALL_TOOLS, roundsRemaining: 2, budgetRemaining: 6, ...overrides }
}

const declaration = (extra: Record<string, unknown> = {}) => ({ proposedAction: "STOP" as const, supportedClaims: [], unresolvedQuestions: [], hypotheses: [], contradictoryEvidence: [], dataLimitations: [], additionalEvidenceCouldChangeConclusion: false, additionalEvidenceCouldIncreaseRequiredScope: false, ...extra })

describe("investigation objective (derivado pelo runtime)", () => {
  it("interação → FEEDBACK_SINGLE_INTERACTION (INTERACTION_SPECIFIC); PROCESS_AUDIT pelo contrato; indicador fora da meta → EXPLAIN (causal); dentro da meta ou 'qual foi' → DESCRIBE; 'costuma' → EMPLOYEE_PATTERN; 'comparado ao subgrupo' → POPULATION", () => {
    expect(resolveInvestigationObjective({ interactionId: "i", indicatorCode: null })).toMatchObject({ kind: "FEEDBACK_SINGLE_INTERACTION", requiredScope: "INTERACTION_SPECIFIC", causal: false })
    expect(resolveInvestigationObjective({ interactionId: "i", indicatorCode: null, outputContract: "PROCESS_AUDIT" }).kind).toBe("PROCESS_AUDIT")
    expect(resolveInvestigationObjective({ interactionId: null, indicatorCode: "TMA" })).toMatchObject({ kind: "EXPLAIN_INDICATOR_DEVIATION", requiredScope: null, causal: true })
    expect(resolveInvestigationObjective({ interactionId: null, indicatorCode: "TMA", withinTarget: true }).kind).toBe("DESCRIBE_PERFORMANCE")
    expect(resolveInvestigationObjective({ interactionId: null, indicatorCode: "TMA", query: "Qual foi meu TMA em agosto?" }).kind).toBe("DESCRIBE_PERFORMANCE")
    expect(resolveInvestigationObjective({ interactionId: null, indicatorCode: "TMA", query: "Eu costumo demorar no fechamento?" })).toMatchObject({ kind: "IDENTIFY_EMPLOYEE_PATTERN", requiredScope: "EMPLOYEE_PATTERN" })
    expect(resolveInvestigationObjective({ interactionId: null, indicatorCode: "TMA", query: "Como estou comparado ao subgrupo?" })).toMatchObject({ kind: "COMPARE_WITH_POPULATION", requiredScope: "POPULATION_PATTERN" })
    expect(resolveInvestigationObjective({ interactionId: null, indicatorCode: null, query: "Por que meu TMA subiu?" })).toMatchObject({ kind: "MULTI_DOMAIN_DIAGNOSIS", causal: true })
  })
})

describe("evidence sufficiency controller — o modelo propõe, o runtime decide", () => {
  it("§49 chamada única (INTERACTION_SPECIFIC): transcrição + procedimento bastam — STOP aceito como ANSWER_SUFFICIENT sem pedir comparáveis", () => {
    const objective = resolveInvestigationObjective({ interactionId: "i", indicatorCode: null })
    const result = evaluateStop(declaration({ supportedClaims: [{ text: "na interação você não informou o prazo", scope: "INTERACTION_SPECIFIC", evidenceRefs: ["TRANSCRICAO"] }] }), context({ objective, ledger: [entry("F1", "get_interaction_context", 1)], transcriptInFocus: true, interactionsInPeriod: 25 }))
    expect(result).toMatchObject({ accepted: true, reason: "ANSWER_SUFFICIENT", status: "SUFFICIENT", rejections: [] })
    expect(result.needs.map((need) => [need.id, need.status])).toEqual([["E_BEHAVIORAL_EVIDENCE", "SATISFIED"], ["E_PROCEDURE", "SATISFIED"]])
  })

  it("§50 padrão do colaborador (EMPLOYEE_PATTERN) com 1 interação: STOP cedo é REJEITADO (representatividade aberta, find_interactions/analyze_interactions disponíveis)", () => {
    const objective = resolveInvestigationObjective({ interactionId: "i", indicatorCode: null, query: "isso é um padrão dela?" })
    const result = evaluateStop(declaration(), context({ objective, ledger: [entry("F1", "get_interaction_context", 1)], transcriptInFocus: true, interactionsInPeriod: 25 }))
    expect(result.accepted).toBe(false)
    expect(result.rejections.map((item) => item.needId)).toContain("E_REPRESENTATIVENESS")
    expect(result.rejections[0]!.candidateTools).toEqual(expect.arrayContaining(["find_interactions", "analyze_interactions"]))
  })

  it("§54 padrão do colaborador com só 2 interações registradas (universo < amostra mínima): não há loop — INSUFFICIENT_DATA", () => {
    const objective = resolveInvestigationObjective({ interactionId: null, indicatorCode: "TMA", query: "ela costuma demorar?" })
    const result = evaluateStop(declaration(), context({ objective, ledger: [snapshot, comparison, twoCalls], interactionsInPeriod: 2 }))
    expect(result).toMatchObject({ accepted: true, reason: "INSUFFICIENT_DATA", status: "INSUFFICIENT_DATA" })
    expect(result.needs.find((need) => need.id === "E_REPRESENTATIVENESS")).toMatchObject({ status: "BLOCKED", blockedBy: "NO_DATA" })
    expect(result.limitations.some((item) => item.includes("não existem"))).toBe(true)
  })

  it("§13 TMA alto (EXPLAIN): indicador + comparação respondem 'como está' mas não 'por quê' — com interações disponíveis o STOP é rejeitado; sem interações termina INSUFFICIENT_DATA", () => {
    const objective = resolveInvestigationObjective({ interactionId: null, indicatorCode: "TMA" })
    const withInteractions = evaluateStop(declaration(), context({ objective, ledger: [snapshot, comparison, population], interactionsInPeriod: 2 }))
    expect(withInteractions.accepted).toBe(false)
    expect(withInteractions.rejections.map((item) => item.needId)).toEqual(["E_BEHAVIORAL_EVIDENCE"])
    const noInteractions = evaluateStop(declaration(), context({ objective, ledger: [snapshot, comparison, population], interactionsInPeriod: 0 }))
    expect(noInteractions).toMatchObject({ accepted: true, reason: "INSUFFICIENT_DATA" })
    const analyzed = evaluateStop(declaration({ supportedClaims: [{ text: "nas 2 interações analisadas você confirmou dados duas vezes", scope: "INTERACTION_SPECIFIC", evidenceRefs: ["F4"] }] }), context({ objective, ledger: [snapshot, comparison, population, twoCalls], interactionsInPeriod: 2 }))
    expect(analyzed).toMatchObject({ accepted: true, reason: "ANSWER_SUFFICIENT" })
  })

  it("§51 hipótese MATERIAL não testada com Tool capaz (complexidade do assunto → segment_indicator): STOP rejeitado; §52 hipótese imaterial não bloqueia", () => {
    const objective = resolveInvestigationObjective({ interactionId: null, indicatorCode: "TMA" })
    const ledger = [snapshot, comparison, population, twoCalls]
    const material = evaluateStop(declaration({ hypotheses: [{ hypothesis: "o TMA pode estar concentrado em um único assunto", status: "OPEN", material: true, evidenceRefs: [], candidateTools: ["segment_indicator"] }] }), context({ objective, ledger, interactionsInPeriod: 2 }))
    expect(material.accepted).toBe(false)
    expect(material.rejections[0]).toMatchObject({ needId: "H1", candidateTools: ["segment_indicator"] })
    const immaterial = evaluateStop(declaration({ hypotheses: [{ hypothesis: "talvez o cliente estivesse com pressa", status: "OPEN", material: false, evidenceRefs: [], candidateTools: ["analyze_interactions"] }] }), context({ objective, ledger, interactionsInPeriod: 2 }))
    expect(immaterial).toMatchObject({ accepted: true, reason: "ANSWER_SUFFICIENT" })
    expect(immaterial.hypotheses).toHaveLength(1)
  })

  it("§53 evidência conflitante OPEN com Tool capaz bloqueia o STOP; CONTEXTUALIZED (ou sem Tool) não bloqueia e vira limitação declarada", () => {
    const objective = resolveInvestigationObjective({ interactionId: null, indicatorCode: "TMA" })
    const ledger = [snapshot, comparison, population, twoCalls]
    const open = evaluateStop(declaration({ contradictoryEvidence: [{ description: "F4 mostra demora de procedimento; F3 mostra execução excelente noutras chamadas", refs: ["F4", "F3"], status: "OPEN", candidateTools: [] }] }), context({ objective, ledger, interactionsInPeriod: 2 }))
    expect(open.accepted).toBe(false)
    expect(open.rejections[0]!.needId).toBe("C1")
    const contextualized = evaluateStop(declaration({ contradictoryEvidence: [{ description: "…", refs: ["F4"], status: "CONTEXTUALIZED", candidateTools: [] }] }), context({ objective, ledger, interactionsInPeriod: 2 }))
    expect(contextualized.accepted).toBe(true)
    const noTool = evaluateStop(declaration({ contradictoryEvidence: [{ description: "conflito X", refs: ["F4"], status: "OPEN", candidateTools: [] }] }), context({ objective, ledger, interactionsInPeriod: 2, availableTools: ["compare_periods"] }))
    expect(noTool.accepted).toBe(true)
    expect(noTool.limitations.some((item) => item.includes("conflito X"))).toBe(true)
  })

  it("§55 orçamento/rodadas esgotados com lacuna material aberta: motivo = limite (nunca ANSWER_SUFFICIENT) e a lacuna vira limitação", () => {
    const objective = resolveInvestigationObjective({ interactionId: null, indicatorCode: "TMA" })
    const budget = evaluateStop(declaration(), context({ objective, ledger: [snapshot, comparison], interactionsInPeriod: 10, roundsRemaining: 1, budgetRemaining: 0 }))
    expect(budget).toMatchObject({ accepted: true, reason: "INVESTIGATION_TOOL_BUDGET", status: "LIMITED" })
    expect(budget.limitations.some((item) => item.startsWith("não investigado por limite"))).toBe(true)
    const rounds = evaluateStop(declaration(), context({ objective, ledger: [snapshot, comparison], interactionsInPeriod: 10, roundsRemaining: 0, budgetRemaining: 5 }))
    expect(rounds.reason).toBe("MAX_PLANNING_ROUNDS")
  })

  it("§18 lacuna material sem nenhuma Tool autorizada → NO_MORE_SUPPORTED_PATHS (não desperdiça rodada)", () => {
    const objective = resolveInvestigationObjective({ interactionId: null, indicatorCode: "TMA" })
    const result = evaluateStop(declaration(), context({ objective, ledger: [snapshot, comparison], interactionsInPeriod: 10, availableTools: ["compare_periods", "compare_population"] }))
    expect(result).toMatchObject({ accepted: true, reason: "NO_MORE_SUPPORTED_PATHS", status: "NO_PATH" })
    expect(result.needs.find((need) => need.id === "E_BEHAVIORAL_EVIDENCE")).toMatchObject({ status: "BLOCKED", blockedBy: "NO_TOOL" })
  })

  it("§24 evidência verdadeira não autoriza generalização: claim EMPLOYEE_PATTERN com 2 de 25 interações → STOP rejeitado enquanto houver interações e Tools; com universo pequeno vira limitação", () => {
    const objective = resolveInvestigationObjective({ interactionId: null, indicatorCode: "TMA" })
    const claim = { text: "você costuma repetir a confirmação", scope: "EMPLOYEE_PATTERN" as const, evidenceRefs: ["F4"] }
    const rejected = evaluateStop(declaration({ supportedClaims: [claim] }), context({ objective, ledger: [snapshot, comparison, twoCalls], interactionsInPeriod: 25 }))
    expect(rejected.accepted).toBe(false)
    expect(rejected.rejections[0]!.needId).toBe("E_CLAIM_SCOPE")
    const limited = evaluateStop(declaration({ supportedClaims: [claim] }), context({ objective, ledger: [snapshot, comparison, twoCalls], interactionsInPeriod: 2 }))
    expect(limited.accepted).toBe(true)
    expect(limited.limitations.some((item) => item.includes("nas interações analisadas"))).toBe(true)
  })

  it("§35 chat simples ('qual foi meu TMA?'): objetivo DESCRIBE — comparação e causa não são necessidades materiais, STOP aceito só com o indicador", () => {
    const objective = resolveInvestigationObjective({ interactionId: null, indicatorCode: "TMA", query: "qual foi meu TMA?" })
    expect(evaluateStop(declaration(), context({ objective, ledger: [snapshot], interactionsInPeriod: 25 }))).toMatchObject({ accepted: true, reason: "ANSWER_SUFFICIENT" })
  })

  it("declaração: extrai a linha INVESTIGATION_STATE_JSON (notas antes), tolera ausência/JSON inválido e ferramentas desconhecidas", () => {
    const parsed = extractStopDeclaration(`Notas: F1.\n${STATE_MARKER} {"proposedAction":"STOP","hypotheses":[{"hypothesis":"x","status":"OPEN","material":true,"candidateTools":["segment_indicator","ferramenta_inexistente"]}],"dataLimitations":["a"]}`)
    expect(parsed.present).toBe(true)
    expect(parsed.notes).toBe("Notas: F1.")
    expect(parsed.declaration?.hypotheses[0]?.candidateTools).toEqual(["segment_indicator", "synthesize_evidence"])
    expect(extractStopDeclaration("só notas")).toMatchObject({ present: false, declaration: null, notes: "só notas" })
    expect(extractStopDeclaration(`x\n${STATE_MARKER} {inválido`).present).toBe(false)
  })
})

describe("V1.3.2 — cobertura temporal, contexto do sinal e orçamento de hipóteses (comportamento, nunca Tool específica)", () => {
  const patternObjective = resolveInvestigationObjective({ interactionId: null, indicatorCode: null, query: "Identifique os padrões de comportamento recorrentes deste colaborador no período." })
  const representative = (extra: Partial<LedgerEntry> = {}) => [entry("F1", "find_interactions", 36), entry("F2", "analyze_interactions", 8, { signals: { temporalCoverage: { buckets: 3, bucketsCovered: 1 } }, ...extra })]

  it("§57 janela longa + padrão: STOP com transcrições representativas MAS só do fim da janela é recusado — existe fonte temporal autorizada e a evolução é material", () => {
    const ctx = context({ objective: patternObjective, ledger: representative(), interactionsInPeriod: 36, periodIntent: "PERIOD_EVOLUTION" })
    ctx.assessments = [{ ref: "F2", tool: "analyze_interactions", analyzed: 8, analyzedCount: 8, recordedUniverseCount: 36, recordedCoverage: 0.22, operationalUniverseCount: null, operationalCoverage: null, universeRelationship: "UNKNOWN", level: "REPRESENTATIVE", classification: "REPRESENTATIVE", reason: "x", universe: 36 }]
    const result = evaluateStop(declaration({ supportedClaims: [{ text: "nas analisadas há pausas", scope: "INTERACTION_SPECIFIC", evidenceRefs: ["F2"] }] }), ctx)
    expect(result.accepted).toBe(false)
    const rejection = result.rejections.find((item) => item.needId === "E_TEMPORAL_COVERAGE")!
    expect(rejection).toBeDefined()
    expect(rejection.candidateTools.length).toBeGreaterThan(0)
    // Evidência que atravessa a janela (transcrições em ≥ 2 blocos) satisfaz a COBERTURA — mas (V1.3.4) cobertura ≠ comparação:
    // padrão numa janela longa ainda precisa de E_TEMPORAL_COMPARISON (os blocos foram comparados?), que só a análise comportamental satisfaz.
    const spread = context({ objective: patternObjective, ledger: representative({ signals: { temporalCoverage: { buckets: 3, bucketsCovered: 3 } } }), interactionsInPeriod: 36, periodIntent: "PERIOD_EVOLUTION" })
    spread.assessments = ctx.assessments
    const spreadResult = evaluateStop(declaration({ supportedClaims: [{ text: "nas analisadas há pausas", scope: "INTERACTION_SPECIFIC", evidenceRefs: ["F2"] }] }), spread)
    expect(spreadResult.needs.find((need) => need.id === "E_TEMPORAL_COVERAGE")?.status).toBe("SATISFIED")
    expect(spreadResult.accepted).toBe(false)
    expect(spreadResult.rejections.map((item) => item.needId)).toEqual(["E_TEMPORAL_COMPARISON"])
    // Comparação feita e SEM diferença sustentada satisfaz (§26/§41): STOP aceito — não se procura tendência até inventar.
    const compared = context({ objective: patternObjective, ledger: representative({ signals: { temporalCoverage: { buckets: 3, bucketsCovered: 3 }, temporalComparison: { status: "NO_DIFFERENCE_SUPPORTED", comparedBuckets: ["B1", "B2", "B3"], behavioral: true, findings: [] } } }), interactionsInPeriod: 36, periodIntent: "PERIOD_EVOLUTION", temporalBuckets: 3 })
    compared.assessments = ctx.assessments
    expect(evaluateStop(declaration({ supportedClaims: [{ text: "nas analisadas há pausas", scope: "INTERACTION_SPECIFIC", evidenceRefs: ["F2"] }] }), compared)).toMatchObject({ accepted: true, reason: "ANSWER_SUFFICIENT" })
    // V1.3.4.2 §6/§7 (fixture V4): status "STABLE" não é mais alias de NO_DIFFERENCE — a Tool devolve INSUFFICIENT_EVIDENCE com a relação
    // STABLE INSUFFICIENT; a necessidade NÃO é satisfeita e o STOP não pode usar esse "STABLE" como no-difference válido.
    const relationAsStatus = context({ objective: patternObjective, ledger: representative({ signals: { temporalCoverage: { buckets: 3, bucketsCovered: 3 }, temporalComparison: { status: "INSUFFICIENT_EVIDENCE", comparedBuckets: ["B1", "B3"], behavioral: true, analyzedBuckets: ["B1", "B2", "B3"], bucketCount: 3, findings: [{ relation: "STABLE", earlierBucket: "B1", laterBucket: "B3", directionSupported: false, relationValidationStatus: "INSUFFICIENT_EVIDENCE", relationValidationReason: "B3 0 de 3 analisada(s) (universo 12) — ausência não estabelecida" }] } } }), interactionsInPeriod: 36, periodIntent: "PERIOD_EVOLUTION" })
    relationAsStatus.assessments = ctx.assessments
    const relationAsStatusResult = evaluateStop(declaration({ supportedClaims: [{ text: "nas analisadas há pausas", scope: "INTERACTION_SPECIFIC", evidenceRefs: ["F2"] }], proposedStopReason: "ANSWER_SUFFICIENT" }), relationAsStatus)
    expect(relationAsStatusResult.needs.find((need) => need.id === "E_TEMPORAL_COMPARISON")?.status).toBe("OPEN")
    expect(relationAsStatusResult.accepted).toBe(false)
    expect(relationAsStatusResult.rejections.map((item) => item.needId)).toEqual(["E_TEMPORAL_COMPARISON"])
    // Histórico do INDICADOR satisfaz a cobertura, mas não a comparação COMPORTAMENTAL de um padrão do colaborador (§24).
    const history = context({ objective: patternObjective, ledger: [...representative(), entry("F3", "get_employee_history", 3)], interactionsInPeriod: 36, periodIntent: "PERIOD_EVOLUTION" })
    history.assessments = ctx.assessments
    const historyResult = evaluateStop(declaration({ supportedClaims: [{ text: "nas analisadas há pausas", scope: "INTERACTION_SPECIFIC", evidenceRefs: ["F2"] }] }), history)
    expect(historyResult.needs.find((need) => need.id === "E_TEMPORAL_COVERAGE")?.status).toBe("SATISFIED")
    expect(historyResult.rejections.map((item) => item.needId)).toEqual(["E_TEMPORAL_COMPARISON"])
    // Sem nenhuma fonte capaz (nem histórico, nem interações): BLOCKED NO_TOOL → NO_MORE_SUPPORTED_PATHS, nunca loop.
    const noPath = context({ objective: patternObjective, ledger: [], interactionsInPeriod: 36, periodIntent: "PERIOD_EVOLUTION", availableTools: ["query_knowledge"] })
    expect(evaluateStop(declaration(), noPath).needs.find((need) => need.id === "E_TEMPORAL_COVERAGE")).toMatchObject({ status: "BLOCKED", blockedBy: "NO_TOOL" })
  })

  it("§58 negative control: janela curta (padrão, não evolução) com amostra representativa — STOP cedo aceito sem exigir flags/histórico/segmentação", () => {
    const ctx = context({ objective: patternObjective, ledger: [entry("F1", "find_interactions", 12), entry("F2", "analyze_interactions", 11)], interactionsInPeriod: 12, periodIntent: "PERIOD_PATTERN" })
    ctx.assessments = [{ ref: "F2", tool: "analyze_interactions", analyzed: 11, analyzedCount: 11, recordedUniverseCount: 12, recordedCoverage: 0.92, operationalUniverseCount: null, operationalCoverage: null, universeRelationship: "UNKNOWN", level: "REPRESENTATIVE", classification: "REPRESENTATIVE", reason: "x", universe: 12 }]
    const result = evaluateStop(declaration({ supportedClaims: [{ text: "nas interações analisadas não há sinal recorrente", scope: "EMPLOYEE_PATTERN", evidenceRefs: ["F2"] }] }), ctx)
    expect(result).toMatchObject({ accepted: true, reason: "ANSWER_SUFFICIENT" })
    expect(result.needs.map((need) => need.id)).not.toContain("E_TEMPORAL_COVERAGE")
  })

  it("§38 sinal que trouxe a interação (genérico, qualquer flag): feedback de UMA interação com só a transcrição/contexto → STOP recusado até contextualizar o sinal; sem flag, nada muda", () => {
    const single = resolveInvestigationObjective({ interactionId: "i", indicatorCode: null })
    const onlyContext = [entry("F1", "get_interaction_context", 1, { preflight: true })]
    const withFlag = evaluateStop(declaration({ supportedClaims: [{ text: "nesta interação você não recapitulou", scope: "INTERACTION_SPECIFIC", evidenceRefs: ["TRANSCRICAO"] }] }), context({ objective: single, ledger: onlyContext, transcriptInFocus: true, interactionsInPeriod: 25, signalFlag: "qualquer_sinal" }))
    expect(withFlag.accepted).toBe(false)
    expect(withFlag.rejections.map((item) => item.needId)).toEqual(["E_SIGNAL_CONTEXT"])
    const contextualized = evaluateStop(declaration({ supportedClaims: [{ text: "nesta interação você não recapitulou", scope: "INTERACTION_SPECIFIC", evidenceRefs: ["TRANSCRICAO"] }] }), context({ objective: single, ledger: [...onlyContext, entry("F2", "find_interactions", 25)], transcriptInFocus: true, interactionsInPeriod: 25, signalFlag: "qualquer_sinal" }))
    expect(contextualized).toMatchObject({ accepted: true, reason: "ANSWER_SUFFICIENT" })
    const noFlag = evaluateStop(declaration({ supportedClaims: [{ text: "x", scope: "INTERACTION_SPECIFIC", evidenceRefs: ["TRANSCRICAO"] }] }), context({ objective: single, ledger: onlyContext, transcriptInFocus: true, interactionsInPeriod: 25 }))
    expect(noFlag.needs.map((need) => need.id)).not.toContain("E_SIGNAL_CONTEXT")
  })

  it("§40 orçamento de hipóteses: só as 4 primeiras perguntas/hipóteses materiais abertas bloqueiam; o excedente fica registrado como imaterial", () => {
    const questions = Array.from({ length: 6 }, (_, index) => ({ question: `pergunta ${index + 1}`, material: true, candidateTools: ["find_interactions"] }))
    const result = evaluateStop(declaration({ unresolvedQuestions: questions }), context({ objective: patternObjective, ledger: [entry("F1", "find_interactions", 12)], interactionsInPeriod: 12, periodIntent: "PERIOD_PATTERN" }))
    const modelNeeds = result.needs.filter((need) => need.source === "MODEL")
    expect(modelNeeds.filter((need) => need.material)).toHaveLength(4)
    expect(modelNeeds.filter((need) => !need.material).map((need) => need.id)).toEqual(["Q5", "Q6"])
    expect(result.rejections.filter((item) => item.needId.startsWith("Q"))).toHaveLength(4)
  })
})

describe("V1.3.4 — E_TEMPORAL_COMPARISON nasce e se resolve por semântica, nunca por Tool fixa", () => {
  const patternObjective = resolveInvestigationObjective({ interactionId: null, indicatorCode: null, query: "Identifique os padrões de comportamento recorrentes deste colaborador no período." })
  const representative = () => [entry("F1", "find_interactions", 36), entry("F2", "analyze_interactions", 8, { signals: { temporalCoverage: { buckets: 3, bucketsCovered: 3 } } })]
  const assessments = [{ ref: "F2", tool: "analyze_interactions", analyzed: 8, analyzedCount: 8, recordedUniverseCount: 36, recordedCoverage: 0.22, operationalUniverseCount: null, operationalCoverage: null, universeRelationship: "UNKNOWN" as const, level: "REPRESENTATIVE" as const, classification: "REPRESENTATIVE" as const, reason: "x", universe: 36 }]

  it("§8-D padrão numa janela longa exige comparação; §8-B/C hipótese ou afirmação temporal declarada também a faz nascer numa janela curta", () => {
    const long = evaluateStop(declaration(), context({ objective: patternObjective, ledger: representative(), interactionsInPeriod: 36, periodIntent: "PERIOD_EVOLUTION", temporalBuckets: 3 }))
    expect(long.needs.map((need) => need.id)).toContain("E_TEMPORAL_COMPARISON")
    const shortNoTemporal = evaluateStop(declaration({ supportedClaims: [{ text: "nas analisadas informa o protocolo", scope: "INTERACTION_SPECIFIC", evidenceRefs: ["F2"] }] }), context({ objective: patternObjective, ledger: representative(), interactionsInPeriod: 12, periodIntent: "PERIOD_PATTERN", temporalBuckets: 1 }))
    expect(shortNoTemporal.needs.map((need) => need.id)).not.toContain("E_TEMPORAL_COMPARISON")
    const shortTemporalClaim = evaluateStop(declaration({ supportedClaims: [{ text: "passou a informar o protocolo nas interações mais recentes", scope: "INTERACTION_SPECIFIC", evidenceRefs: ["F2"], temporalRelation: "CHANGE", evidenceBuckets: ["B1"] }] }), context({ objective: patternObjective, ledger: representative(), interactionsInPeriod: 12, periodIntent: "PERIOD_PATTERN", temporalBuckets: 1 }))
    const need = shortTemporalClaim.needs.find((item) => item.id === "E_TEMPORAL_COMPARISON")!
    // Janela de um bloco: não há momentos a comparar — BLOCKED por dados, nunca loop.
    expect(need).toMatchObject({ status: "BLOCKED", blockedBy: "NO_DATA" })
    const hypothesisOnly = evaluateStop(declaration({ hypotheses: [{ hypothesis: "o comportamento evoluiu ao longo do período", status: "OPEN", material: true, evidenceRefs: [], candidateTools: ["analyze_interactions"] }] }), context({ objective: patternObjective, ledger: representative(), interactionsInPeriod: 36, periodIntent: "PERIOD_EVOLUTION", temporalBuckets: 3 }))
    expect(hypothesisOnly.needs.map((need) => need.id)).toContain("E_TEMPORAL_COMPARISON")
  })

  it("§8 não nasce em FEEDBACK_SINGLE_INTERACTION só porque a conversa/afirmação menciona o passado; §42 um fato de data não exige comparação", () => {
    const single = resolveInvestigationObjective({ interactionId: "i", indicatorCode: null })
    const result = evaluateStop(declaration({ supportedClaims: [{ text: "o cliente disse que ligou na semana passada; nesta interação você passou a oferecer o app", scope: "INTERACTION_SPECIFIC", evidenceRefs: ["TRANSCRICAO"] }] }), context({ objective: single, ledger: [entry("F1", "get_interaction_context", 1, { preflight: true })], transcriptInFocus: true, interactionsInPeriod: 25 }))
    expect(result.needs.map((need) => need.id)).not.toContain("E_TEMPORAL_COMPARISON")
    const dateFact = evaluateStop(declaration({ supportedClaims: [{ text: "a chamada ocorreu em 28/07 e informa o protocolo", scope: "INTERACTION_SPECIFIC", evidenceRefs: ["F2"] }] }), context({ objective: patternObjective, ledger: representative(), interactionsInPeriod: 12, periodIntent: "PERIOD_PATTERN", temporalBuckets: 1 }))
    expect(dateFact.needs.map((need) => need.id)).not.toContain("E_TEMPORAL_COMPARISON")
  })

  it("§25/§26 STOP não é ANSWER_SUFFICIENT com cobertura satisfeita e comparação aberta; diferença observada OU nenhuma diferença satisfazem; indicador só satisfaz objetivo causal de indicador", () => {
    const open = context({ objective: patternObjective, ledger: representative(), interactionsInPeriod: 36, periodIntent: "PERIOD_EVOLUTION", temporalBuckets: 3 })
    open.assessments = assessments
    const openResult = evaluateStop(declaration({ supportedClaims: [{ text: "nas analisadas há pausas", scope: "EMPLOYEE_PATTERN", evidenceRefs: ["F2"] }] }), open)
    expect(openResult.accepted).toBe(false)
    expect(openResult.rejections.map((item) => item.needId)).toEqual(["E_TEMPORAL_COMPARISON"])
    const withDifference = context({ objective: patternObjective, ledger: [entry("F1", "find_interactions", 36), entry("F2", "analyze_interactions", 8, { signals: { temporalCoverage: { buckets: 3, bucketsCovered: 3 }, temporalComparison: { status: "DIFFERENCE_OBSERVED", comparedBuckets: ["B1", "B3"], behavioral: true, findings: [{ relation: "DECREASED", earlierBucket: "B1", laterBucket: "B3", directionSupported: true }] } } })], interactionsInPeriod: 36, periodIntent: "PERIOD_EVOLUTION", temporalBuckets: 3 })
    withDifference.assessments = assessments
    expect(evaluateStop(declaration({ supportedClaims: [{ text: "nas analisadas há pausas", scope: "EMPLOYEE_PATTERN", evidenceRefs: ["F2"] }] }), withDifference)).toMatchObject({ accepted: true, reason: "ANSWER_SUFFICIENT" })
    // Objetivo CAUSAL de indicador numa janela longa: histórico/compare_periods do indicador satisfazem a comparação (a claim comportamental é gatilhada na síntese).
    const causal = resolveInvestigationObjective({ interactionId: null, indicatorCode: "TMA" })
    const causalCtx = context({ objective: causal, ledger: [entry("F1", "get_indicator_snapshot", 20, { capability: "INDICATOR_ANALYSIS" }), entry("F2", "compare_periods", 2), entry("F3", "find_interactions", 30), entry("F4", "analyze_interactions", 8, { signals: { temporalCoverage: { buckets: 3, bucketsCovered: 3 } } })], interactionsInPeriod: 30, periodIntent: "PERIOD_EVOLUTION", temporalBuckets: 3 })
    expect(evaluateStop(declaration(), causalCtx).needs.find((need) => need.id === "E_TEMPORAL_COMPARISON")).toMatchObject({ status: "SATISFIED", evidenceRefs: ["F2"] })
  })
})
