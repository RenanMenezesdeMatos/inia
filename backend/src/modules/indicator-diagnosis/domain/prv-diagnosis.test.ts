import { describe, expect, it } from "vitest"
import { triageClosing, triageIndicator, closingTriageIssues, type ClosingTriageRule } from "./closing-triage.js"
import { interactionReuseOf, observationCompatibility, type StoredObservation } from "./observation-compatibility.js"
import { classifyOperationalPattern, dedupeByInteractionAndBehavior, summarizeOperationalPatterns, type InteractionMeta, type OperationalObservation } from "./operational-patterns.js"
import { mixShiftOf } from "./population-mix.js"
import { officialValueMovementOf, quartileMovementOf, QUARTILE_RANK, withinReferenceOf, type OfficialIndicatorSnapshot, type PrvClosing } from "./prv-closing.js"
import { buildIndicatorInvestigation, buildPrvClosingDiagnosis, prvDiagnosisIdempotencyKey, teamPatternsOf, type InvestigationInput, type SampleAccounting } from "./prv-investigation.js"

const TMA: OfficialIndicatorSnapshot = { snapshotId: "snap-tma", indicatorId: "ind-tma", indicatorCode: "TMA", indicatorName: "TMA", unit: "SECONDS", direction: "LOWER", referencePeriod: "2026-08", value: 495, target: 450, achievementPercent: 90.9, weightPercent: 25, quartile: "Q4", subteamId: null }
const closingOf = (snapshot: OfficialIndicatorSnapshot, previous: Partial<OfficialIndicatorSnapshot> | null = { value: 410, quartile: "Q2" }): PrvClosing => ({
  contract: "PRV_CLOSING_V1",
  organizationId: "org",
  personId: "person",
  referencePeriod: "2026-08",
  prv: { snapshotId: "prv", referencePeriod: "2026-08", achievementPercent: 88, quartile: "Q4" },
  indicators: [snapshot],
  previous: previous ? { referencePeriod: "2026-07", prv: null, indicators: [{ ...snapshot, snapshotId: "snap-prev", referencePeriod: "2026-07", ...previous }] } : null,
})
const RULE: ClosingTriageRule = { enabled: true, developmentQuartiles: ["Q3", "Q4"], belowTarget: false, quartileWorsened: false, recognitionQuartiles: ["Q1"] }
const strategy = (rule: ClosingTriageRule | undefined = RULE) => ({ versionId: "strategy-v1", version: 1, closingTriage: rule })

const meta = (id: string, weekday = 1, hour = 10, origin: "REUSED" | "ASSESSED" = "ASSESSED"): InteractionMeta => ({ interactionId: id, localDate: `2026-08-${String(10 + Number(id.replace(/\D/g, "") || 0)).padStart(2, "0")}`, weekday, hour, segmentKey: "CONTESTACAO", segmentLabel: "Contestação de cobrança", origin })
const obs = (id: string, status: OperationalObservation["status"], overrides: Partial<OperationalObservation> = {}): OperationalObservation => ({
  interactionId: id,
  practiceKey: "BEHAVIOR:RECAPITULATE_INTERACTION",
  behavior: "RECAPITULATE_INTERACTION",
  title: "Recapitulação",
  requirement: "Recapitular o atendimento",
  documentId: "doc",
  documentTitle: "Procedimento de Contestação",
  status,
  completeness: null,
  analyticsStatus: "VERIFIED",
  origin: "ASSESSED",
  evidence: [{ text: `Resumindo o atendimento ${id}`, truncated: false }],
  rule: { documentId: "doc", documentTitle: "Procedimento de Contestação", heading: "46. Recapitulação", quote: "Antes de encerrar, recapitule o que foi feito." },
  guidance: null,
  ...overrides,
})
const sample = (analyzed: number, overrides: Partial<SampleAccounting> = {}): SampleAccounting => ({ eligibleCount: 12, reusableCount: 0, incompatibleCount: 0, unobservedCount: 12, selectedForAssessment: analyzed, analyzedCount: analyzed, reusedObservationCount: 0, reanalyzedInteractionCount: analyzed, newObservationCount: analyzed, selectionReason: "teste", sampling: null, discarded: [], ...overrides })

function investigate(input: { snapshot?: OfficialIndicatorSnapshot; decision?: "INVESTIGATE" | "RECOGNIZE"; observations: OperationalObservation[]; interactions: InteractionMeta[]; team?: ReturnType<typeof teamPatternsOf>; mixCurrent?: Parameters<typeof mixShiftOf>[0]; mixPrevious?: Parameters<typeof mixShiftOf>[1] }) {
  const snapshot = input.snapshot ?? TMA
  const closing = closingOf(snapshot)
  const triage = triageIndicator(snapshot, closing.previous!.indicators[0]!, strategy())
  const decided = input.decision ? { ...triage, decision: input.decision } : triage
  const patterns = summarizeOperationalPatterns({ interactions: input.interactions, observations: input.observations, eligiblePopulation: 12, minimumEligible: 3 })
  const investigationInput: InvestigationInput = {
    closing,
    triage: decided,
    strategy: { versionId: "strategy-v1", version: 1 },
    snapshot: { indicatorId: snapshot.indicatorId, indicatorCode: snapshot.indicatorCode, indicatorName: snapshot.indicatorName, unit: snapshot.unit, direction: snapshot.direction, snapshotId: snapshot.snapshotId },
    window: { startDate: "2026-08-01", endDate: "2026-09-01", timeZone: "America/Sao_Paulo" },
    metric: "INTERACTION_DURATION_SECONDS",
    interactionsInPeriod: 30,
    segments: [{ key: "CONTESTACAO", label: "Contestação de cobrança", canonical: true, interactions: 12, withTranscript: 12, averageDurationSeconds: 610, sharePercent: 40, eligible: true }],
    selectedSegment: { key: "CONTESTACAO", label: "Contestação de cobrança", reason: "maior tempo" },
    overallAverageDurationSeconds: 480,
    sample: sample(input.interactions.length),
    minimumAnalyzed: 3,
    mix: input.mixCurrent ? mixShiftOf(input.mixCurrent, input.mixPrevious ?? []) : null,
    patterns,
    team: input.team ?? { status: "NOT_AVAILABLE", contributors: 0, observedInteractions: 0, behaviors: [] },
  }
  return buildIndicatorInvestigation(investigationInput)
}

describe("Indicator Diagnosis V1 — fechamento do PRV, triagem e agregação determinística", () => {
  it("A. campos oficiais nunca são recalculados: valor, meta, atingimento, peso e quartil seguem como vieram da fonte", () => {
    const investigation = investigate({ interactions: ["i1", "i2", "i3", "i4", "i5"].map((id) => meta(id)), observations: ["i1", "i2", "i3", "i4"].map((id) => obs(id, "NOT_FOLLOWED")).concat(obs("i5", "FOLLOWED")) })
    expect(investigation.official).toMatchObject({ value: 495, target: 450, achievementPercent: 90.9, weightPercent: 25, quartile: "Q4", withinReference: false, previous: { value: 410, quartile: "Q2" } })
    // Dentro/fora vem do atingimento OFICIAL quando existe (nunca de valor × meta recalculado).
    expect(withinReferenceOf({ achievementPercent: 101, value: 999, target: 450, direction: "LOWER" })).toBe(true)
    expect(withinReferenceOf({ achievementPercent: null, value: 495, target: 450, direction: "LOWER" })).toBe(false)
    // Anterior × atual só ORDENA valores oficiais (nenhum número novo).
    expect(officialValueMovementOf(410, 495, "LOWER")).toBe("WORSENED")
    expect(officialValueMovementOf(410, 495, "TARGET")).toBeNull()
  })

  it("B. Q1 é o melhor quartil e Q4 o pior — nunca invertido", () => {
    expect(QUARTILE_RANK.Q1).toBeLessThan(QUARTILE_RANK.Q4)
    expect(quartileMovementOf("Q2", "Q4")).toBe("WORSENED")
    expect(quartileMovementOf("Q4", "Q2")).toBe("IMPROVED")
    expect(quartileMovementOf("Q3", "Q3")).toBe("UNCHANGED")
    expect(triageIndicator({ ...TMA, quartile: "Q4" }, null, strategy()).decision).toBe("INVESTIGATE")
    expect(triageIndicator({ ...TMA, quartile: "Q1", achievementPercent: 105 }, null, strategy()).decision).toBe("RECOGNIZE")
    expect(triageIndicator({ ...TMA, quartile: "Q2", achievementPercent: 100 }, null, strategy()).decision).toBe("SKIP")
  })

  it("C. elegibilidade pela estratégia: sem estratégia, sem triagem, dados incompletos, piora de quartil, fora da meta, reconhecimento", () => {
    expect(triageIndicator(TMA, null, null)).toMatchObject({ decision: "SKIP", reasons: ["STRATEGY_NOT_CONFIGURED"] })
    expect(triageIndicator(TMA, null, { versionId: "strategy-v1", version: 1, closingTriage: undefined })).toMatchObject({ decision: "SKIP", reasons: ["TRIAGE_NOT_CONFIGURED"] })
    expect(triageIndicator({ ...TMA, quartile: null, target: null, achievementPercent: null }, null, strategy())).toMatchObject({ decision: "SKIP", reasons: ["INCOMPLETE_OFFICIAL_DATA"] })
    const worsened: ClosingTriageRule = { ...RULE, developmentQuartiles: [], quartileWorsened: true }
    expect(triageIndicator({ ...TMA, quartile: "Q3" }, { ...TMA, quartile: "Q1" }, strategy(worsened))).toMatchObject({ decision: "INVESTIGATE", reasons: ["QUARTILE_WORSENED"] })
    const below: ClosingTriageRule = { ...RULE, developmentQuartiles: [], belowTarget: true }
    expect(triageIndicator({ ...TMA, quartile: "Q2" }, null, strategy(below))).toMatchObject({ decision: "INVESTIGATE", reasons: ["BELOW_TARGET"] })
    expect(triageIndicator({ ...TMA, quartile: "Q1", achievementPercent: 80 }, null, strategy())).toMatchObject({ decision: "SKIP", reasons: ["RECOGNITION_OUTSIDE_TARGET"] })
    expect(closingTriageIssues({ ...RULE, recognitionQuartiles: ["Q4"] }).map((issue) => issue.code)).toContain("STRATEGY_TRIAGE_CONFLICT")
    expect(closingTriageIssues({ enabled: true, developmentQuartiles: [], belowTarget: false, quartileWorsened: false, recognitionQuartiles: [] }).map((issue) => issue.code)).toContain("STRATEGY_TRIAGE_WITHOUT_RULE")
    const triage = triageClosing(closingOf(TMA), new Map([["ind-tma", strategy()]]))
    expect(triage.decisions).toHaveLength(1)
  })

  it("D. amostra abaixo do mínimo = INSUFFICIENT_SAMPLE (a conclusão não inventa padrão)", () => {
    const investigation = investigate({ interactions: ["i1", "i2"].map((id) => meta(id)), observations: [obs("i1", "NOT_FOLLOWED"), obs("i2", "NOT_FOLLOWED")] })
    expect(investigation.conclusion.type).toBe("INSUFFICIENT_SAMPLE")
    expect(investigation.conclusion.developmentPatterns).toEqual([])
  })

  it("E. NOT_APPLICABLE nunca conta como gap (fora do denominador)", () => {
    const summary = summarizeOperationalPatterns({ interactions: ["i1", "i2", "i3", "i4", "i5"].map((id) => meta(id)), observations: [obs("i1", "NOT_FOLLOWED"), obs("i2", "NOT_FOLLOWED"), obs("i3", "NOT_APPLICABLE"), obs("i4", "NOT_APPLICABLE"), obs("i5", "NOT_APPLICABLE")], eligiblePopulation: 5 })
    const behavior = summary.behaviors[0]!
    expect(behavior.eligible).toBe(2)
    expect(behavior.counts).toMatchObject({ notFollowed: 2, notApplicable: 3 })
    expect(behavior.classification).toBe("INCONCLUSIVE")
  })

  it("F. NOT_OBSERVABLE nunca vira 'não seguiu'; PARTIAL conta como não seguida (nunca como seguida); pendente de revisão fica fora", () => {
    const summary = summarizeOperationalPatterns({
      interactions: ["i1", "i2", "i3", "i4", "i5", "i6"].map((id) => meta(id)),
      observations: [obs("i1", "NOT_OBSERVABLE"), obs("i2", "NOT_OBSERVABLE"), obs("i3", "NOT_OBSERVABLE"), obs("i4", "NOT_FOLLOWED", { completeness: "PARTIAL" }), obs("i5", "FOLLOWED", { completeness: "PARTIAL" }), obs("i6", "FOLLOWED", { analyticsStatus: "NEEDS_REVIEW" })],
      eligiblePopulation: 6,
    })
    const behavior = summary.behaviors[0]!
    expect(behavior.counts).toMatchObject({ followed: 0, notFollowed: 1, partial: 1, notObservable: 3, ineligible: 2 })
    expect(behavior.eligible).toBe(1)
  })

  it("G. uma chamada = UMA contribuição por comportamento, mesmo com várias fontes", () => {
    const sources = [obs("i1", "FOLLOWED"), obs("i1", "NOT_FOLLOWED", { documentTitle: "Checklist" }), obs("i1", "FOLLOWED", { documentTitle: "Jeito" })]
    expect(dedupeByInteractionAndBehavior(sources)).toHaveLength(1)
    const summary = summarizeOperationalPatterns({ interactions: [meta("i1")], observations: sources, eligiblePopulation: 1 })
    expect(summary.behaviors[0]!.eligible).toBe(1)
    expect(summary.behaviors[0]!.counts.notFollowed).toBe(1)
  })

  const stored = (overrides: Partial<StoredObservation> = {}): StoredObservation => ({ interactionId: "i1", practiceKey: "BEHAVIOR:PROVIDE_PROTOCOL", canonicalBehavior: "PROVIDE_PROTOCOL", requirement: "Forneci protocolo?", documentId: "doc", documentTitle: "Proc", documentVersion: 3, status: "FOLLOWED", completeness: null, analyticsStatus: "VERIFIED", checkpointRef: "CP-0123456789", displayContext: null, ...overrides })

  it("H. observação VERIFIED compatível (comportamento canônico, contrato V3, mesma versão publicada) é reaproveitada", () => {
    const versions = new Map([["doc", 3]])
    expect(observationCompatibility(stored(), versions)).toEqual({ compatible: true, reason: null })
    expect(interactionReuseOf("i1", [stored(), stored({ practiceKey: "BEHAVIOR:CONFIRM_UNDERSTANDING", canonicalBehavior: "CONFIRM_UNDERSTANDING" })], versions).status).toBe("REUSABLE")
    // Prontidão é outra coisa: NEEDS_REVIEW compatível = já avaliada (não reavaliar), só fica fora da contagem.
    expect(interactionReuseOf("i1", [stored({ analyticsStatus: "NEEDS_REVIEW" })], versions).status).toBe("REUSABLE")
    expect(interactionReuseOf("i9", [stored()], versions).status).toBe("NONE")
  })

  it("I. observação incompatível leva a reavaliação: versão da base mudou, contrato sem etapa endereçada (legado), documento despublicado", () => {
    expect(interactionReuseOf("i1", [stored({ documentVersion: 2 })], new Map([["doc", 3]]))).toMatchObject({ status: "INCOMPATIBLE", reasons: ["KNOWLEDGE_VERSION_CHANGED"] })
    // Cauda longa sem comportamento canônico (chave KB:) com etapa endereçada é compatível.
    expect(observationCompatibility(stored({ practiceKey: "KB:doc:abc", canonicalBehavior: null }), new Map([["doc", 3]])).compatible).toBe(true)
    expect(observationCompatibility(stored({ checkpointRef: null }), new Map([["doc", 3]])).reason).toBe("CONTRACT_BEFORE_CHECKPOINT_CATALOG")
    expect(observationCompatibility(stored(), new Map()).reason).toBe("DOCUMENT_NOT_PUBLISHED")
  })

  it("J. mudança de mix é descrita com números do sistema, sem causa", () => {
    const shift = mixShiftOf(
      [{ key: "CONT", label: "Contestação", interactions: 17, totalDurationSeconds: 17 * 620 }, { key: "SEG", label: "Segunda via", interactions: 33, totalDurationSeconds: 33 * 380 }],
      [{ key: "CONT", label: "Contestação", interactions: 9, totalDurationSeconds: 9 * 600 }, { key: "SEG", label: "Segunda via", interactions: 41, totalDurationSeconds: 41 * 370 }],
    )
    expect(shift.status).toBe("SHIFT")
    expect(shift.shifted).toMatchObject({ key: "CONT", previousSharePercent: 18, currentSharePercent: 34, changePp: 16, segmentAverageDurationSeconds: 620, othersAverageDurationSeconds: 380, longerDuration: true })
    expect(mixShiftOf([{ key: "A", label: "A", interactions: 5, totalDurationSeconds: null }], [{ key: "A", label: "A", interactions: 5, totalDurationSeconds: null }]).status).toBe("INSUFFICIENT_DATA")
    const investigation = investigate({
      interactions: ["i1", "i2", "i3"].map((id) => meta(id)),
      observations: [obs("i1", "FOLLOWED"), obs("i2", "NOT_FOLLOWED"), obs("i3", "FOLLOWED")],
      mixCurrent: [{ key: "CONTESTACAO", label: "Contestação de cobrança", interactions: 17, totalDurationSeconds: 17 * 620 }, { key: "SEG", label: "Segunda via", interactions: 33, totalDurationSeconds: 33 * 380 }],
      mixPrevious: [{ key: "CONTESTACAO", label: "Contestação de cobrança", interactions: 9, totalDurationSeconds: 9 * 600 }, { key: "SEG", label: "Segunda via", interactions: 41, totalDurationSeconds: 41 * 370 }],
    })
    expect(investigation.conclusion.type).toBe("MIX_SHIFT")
    expect(investigation.supportedFindings[0]).toContain("passou de 18% para 34%")
    expect(investigation.limitations.join(" ")).toContain("composição não demonstra causa")
    expect(investigation.unsupportedHypotheses.join(" ")).toContain("não são causa")
  })

  it("K. concentração por dia da semana só com volume e diferença material", () => {
    const ids = Array.from({ length: 14 }, (_, index) => `i${index + 1}`)
    // 10 chamadas às segundas (9 não seguidas) e 4 às quintas (todas seguidas).
    const interactions = ids.map((id, index) => meta(id, index < 10 ? 1 : 4))
    const observations = ids.map((id, index) => obs(id, index < 9 ? "NOT_FOLLOWED" : "FOLLOWED"))
    const behavior = summarizeOperationalPatterns({ interactions, observations, eligiblePopulation: 14 }).behaviors[0]!
    expect(behavior.classification).toBe("DEVELOPMENT")
    expect(behavior.concentration).toMatchObject({ dimension: "WEEKDAY", label: "segunda-feira", notFollowed: 9, eligible: 10 })
    // Mesma proporção com poucas chamadas: nenhuma concentração afirmada.
    const small = summarizeOperationalPatterns({ interactions: interactions.slice(0, 5), observations: observations.slice(0, 5), eligiblePopulation: 5 }).behaviors[0]!
    expect(small.concentration).toBeNull()
  })

  it("M. padrão do Subgrupo NÃO vira crítica individual: operador correto + grupo com gap = TEAM_ONLY", () => {
    const team = teamPatternsOf(["p1", "p2", "p3", "p4"].flatMap((person) => [1, 2].map((n) => ({ personId: person, interactionId: `${person}-${n}`, practiceKey: "BEHAVIOR:RECAPITULATE_INTERACTION", title: "Recapitulação", status: "NOT_FOLLOWED" as const }))))
    expect(team.status).toBe("AVAILABLE")
    expect(team.behaviors[0]!.classification).toBe("DEVELOPMENT")
    const investigation = investigate({ interactions: ["i1", "i2", "i3", "i4", "i5"].map((id) => meta(id)), observations: ["i1", "i2", "i3", "i4", "i5"].map((id) => obs(id, "FOLLOWED")), team })
    expect(investigation.conclusion.developmentPatterns).toEqual([])
    expect(investigation.conclusion.teamOnlyPatterns).toEqual(["BEHAVIOR:RECAPITULATE_INTERACTION"])
    expect(investigation.attribution[0]).toMatchObject({ individual: "STRENGTH", team: "DEVELOPMENT", attribution: "TEAM_ONLY" })
    expect(investigation.conclusion.type).not.toBe("ACTIONABLE_PATTERN")
    const mixed = investigate({ interactions: ["i1", "i2", "i3", "i4", "i5"].map((id) => meta(id)), observations: [obs("i1", "FOLLOWED"), obs("i2", "NOT_FOLLOWED"), obs("i3", "FOLLOWED"), obs("i4", "NOT_OBSERVABLE"), obs("i5", "NOT_FOLLOWED")], team })
    expect(mixed.attribution[0]!.attribution).toBe("TEAM_ONLY")
    expect(mixed.conclusion.developmentPatterns).toEqual([])
    expect(mixed.conclusion.teamOnlyPatterns).toEqual(["BEHAVIOR:RECAPITULATE_INTERACTION"])
    expect(mixed.unsupportedHypotheses.join(" ")).toContain("não é atribuída a ele")
    // Privacidade: agregado de menos de 4 pessoas não existe.
    expect(teamPatternsOf([{ personId: "p1", interactionId: "x", practiceKey: "k", title: "t", status: "NOT_FOLLOWED" }]).status).toBe("INSUFFICIENT_POPULATION")
  })

  it("N. sem concentração suficiente = NO_ACTIONABLE_DIAGNOSIS (2 seguidas, 2 não seguidas, 1 não observável não é padrão)", () => {
    expect(classifyOperationalPattern({ eligible: 4, followed: 2, notFollowed: 2 })).toBe("INCONCLUSIVE")
    const investigation = investigate({ interactions: ["i1", "i2", "i3", "i4", "i5"].map((id) => meta(id)), observations: [obs("i1", "FOLLOWED"), obs("i2", "FOLLOWED"), obs("i3", "NOT_FOLLOWED"), obs("i4", "NOT_FOLLOWED"), obs("i5", "NOT_OBSERVABLE")] })
    expect(investigation.conclusion.type).toBe("NO_ACTIONABLE_DIAGNOSIS")
    expect(investigation.limitations).toContain("Não foi identificado um padrão operacional recorrente suficiente para explicar o resultado deste fechamento.")
  })

  it("O. reconhecimento: práticas consistentes com resultado dentro da referência = POSITIVE_PATTERN (nunca procura gap)", () => {
    const within = { ...TMA, value: 420, achievementPercent: 107, quartile: "Q1" as const }
    const investigation = investigate({ snapshot: within, decision: "RECOGNIZE", interactions: ["i1", "i2", "i3", "i4", "i5"].map((id) => meta(id)), observations: ["i1", "i2", "i3", "i4", "i5"].map((id) => obs(id, "FOLLOWED")) })
    expect(investigation.conclusion.type).toBe("POSITIVE_PATTERN")
    expect(investigation.conclusion.strengthPatterns).toEqual(["BEHAVIOR:RECAPITULATE_INTERACTION"])
    // Reconhecimento com gap na amostra: o gap não vira ponto de desenvolvimento (a triagem não abriu investigação de desenvolvimento).
    const withGap = investigate({ snapshot: within, decision: "RECOGNIZE", interactions: ["i1", "i2", "i3", "i4", "i5"].map((id) => meta(id)), observations: ["i1", "i2", "i3", "i4", "i5"].map((id) => obs(id, "NOT_FOLLOWED")) })
    expect(withGap.conclusion.developmentPatterns).toEqual([])
  })

  it("chave de idempotência: mesmo fechamento + mesmas versões = mesma chave; outra versão de estratégia = outra", () => {
    const base = { organizationId: "org", personId: "p", referencePeriod: "2026-08", strategies: [{ indicatorCode: "TMA", strategyVersionId: "v1" }, { indicatorCode: "NPS", strategyVersionId: null }] }
    expect(prvDiagnosisIdempotencyKey(base)).toBe(prvDiagnosisIdempotencyKey({ ...base, strategies: [...base.strategies].reverse() }))
    expect(prvDiagnosisIdempotencyKey(base)).not.toBe(prvDiagnosisIdempotencyKey({ ...base, strategies: [{ indicatorCode: "TMA", strategyVersionId: "v2" }, { indicatorCode: "NPS", strategyVersionId: null }] }))
    const diagnosis = buildPrvClosingDiagnosis({ closing: closingOf(TMA), triage: triageClosing(closingOf(TMA), new Map([["ind-tma", strategy()]])), investigations: [], idempotencyKey: "k".repeat(12), generatedAt: "2026-09-29T00:00:00Z" })
    expect(diagnosis.versions).toMatchObject({ closingTriage: "CLOSING_TRIAGE_V1", operationalPattern: "OPERATIONAL_PATTERN_V1", observationCompatibility: "OBSERVATION_COMPATIBILITY_V1" })
  })
})

describe("V1.0.2 — reaproveitamento versionado pela lógica de avaliação", () => {
  const versions = new Map([["doc", 3]])
  const stored = (analyticsStatus: "VERIFIED" | "NEEDS_REVIEW" | "REJECTED", assessmentLogic?: string) => ({ interactionId: "i1", practiceKey: "BEHAVIOR:INFORM_DEADLINE", canonicalBehavior: "INFORM_DEADLINE", requirement: "prazo", documentId: "doc", documentTitle: "Doc", documentVersion: 3, status: "NOT_FOLLOWED" as const, completeness: null, analyticsStatus, checkpointRef: "CP-0123456789", displayContext: assessmentLogic ? { quotes: [], rule: null, guidance: null, assessmentLogic } : null })
  it("pendência gravada por lógica ANTERIOR é reavaliada; pela lógica atual, reaproveitada; resolvida nunca depende da lógica", () => {
    expect(interactionReuseOf("i1", [stored("NEEDS_REVIEW")], versions, "PRV_DIAGNOSIS_V1_0_2")).toMatchObject({ status: "INCOMPATIBLE", reasons: ["REVIEW_PENDING_UNDER_OLDER_LOGIC"] })
    expect(interactionReuseOf("i1", [stored("NEEDS_REVIEW", "PRV_DIAGNOSIS_V1")], versions, "PRV_DIAGNOSIS_V1_0_2").status).toBe("INCOMPATIBLE")
    expect(interactionReuseOf("i1", [stored("NEEDS_REVIEW", "PRV_DIAGNOSIS_V1_0_2")], versions, "PRV_DIAGNOSIS_V1_0_2").status).toBe("REUSABLE")
    expect(interactionReuseOf("i1", [stored("VERIFIED")], versions, "PRV_DIAGNOSIS_V1_0_2").status).toBe("REUSABLE")
    expect(interactionReuseOf("i1", [stored("REJECTED")], versions, "PRV_DIAGNOSIS_V1_0_2").status).toBe("REUSABLE")
    // Uma pendência antiga basta para reavaliar a chamada inteira (a avaliação é por chamada).
    expect(interactionReuseOf("i1", [stored("VERIFIED"), { ...stored("NEEDS_REVIEW"), practiceKey: "BEHAVIOR:OPEN_ANALYSIS" }], versions, "PRV_DIAGNOSIS_V1_0_2").status).toBe("INCOMPATIBLE")
  })
})
