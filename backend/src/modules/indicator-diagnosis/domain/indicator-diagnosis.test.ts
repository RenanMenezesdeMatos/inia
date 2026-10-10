import { describe, expect, it } from "vitest"
import type { RawCheckpoint } from "../../agents/domain/process-assessment-contract.js"
import { canonicalComparison, INDICATOR_CANONICAL_CONTEXT_CONTRACT, type IndicatorCanonicalContext } from "../../indicators/domain/indicator-canonical-context.js"
import { verifyProcessAssessments, type PublishedKnowledgeDocument } from "../../reliable-feedback/domain/process-assessment.js"
import { buildDiagnosisOutcome } from "./diagnosis-outcome.js"
import { buildSegments, DIAGNOSIS_MIN_SEGMENT_INTERACTIONS, INDICATOR_DIAGNOSIS_PLAN_VERSION, segmentFactText, selectDiagnosisSegment, type IndicatorDiagnosisPlan } from "./indicator-diagnosis.js"
import { buildPeerPracticeEvidence, peerFactText, PEER_MINIMUM_POPULATION, referenceGroupOf, type PeerObservationRow } from "./peer-practice-evidence.js"
import { aggregateProcessPatterns, classifyPattern, observationsFrom, practiceKeyOf, type AssessedInteraction } from "./process-patterns.js"

const DOC = "44444444-4444-4444-8444-444444444444"
const TITLE = "Contestação de Contas Móvel"
const RULE = "Antes de abrir a contestação, confirme com o cliente o valor contestado e o mês da fatura."
const published = new Map<string, PublishedKnowledgeDocument>([[DOC, { documentId: DOC, title: TITLE, content: `## Abertura\n${RULE}`, version: 2 }]])
const presented = [{ documentId: DOC, documentTitle: TITLE, heading: "Abertura", excerpt: RULE }]
const NOT_FOLLOWED_TRANSCRIPT = "CLIENTE: Quero contestar a fatura de agosto.\nOPERADOR: Vou abrir a contestação agora mesmo.\nCLIENTE: Tá bom."
const FOLLOWED_TRANSCRIPT = "CLIENTE: Quero contestar a fatura de agosto.\nOPERADOR: Antes de abrir, confirmo: o valor contestado é da fatura de agosto?\nCLIENTE: Isso."

const checkpoint = (status: "FOLLOWED" | "NOT_FOLLOWED", overrides: Partial<RawCheckpoint> = {}): RawCheckpoint => ({
  requirement: "Confirmar valor e mês antes de abrir a contestação", evidenceType: "OBSERVED", knowledgeDetailQuote: null,
  status,
  transcriptEvidence: [status === "FOLLOWED" ? "Antes de abrir, confirmo: o valor contestado é da fatura de agosto?" : "Vou abrir a contestação agora mesmo."],
  knowledgeQuote: RULE,
  guidance: { source: "OFFICIAL_PROCEDURE", text: "Confirme valor e mês antes de abrir." },
  uncertainty: null,
  ...overrides,
})
const assessed = (handle: string, status: "FOLLOWED" | "NOT_FOLLOWED" | "NONE", overrides: Partial<RawCheckpoint> = {}): AssessedInteraction => {
  const interactionId = `int-${handle}`
  const transcript = status === "FOLLOWED" ? FOLLOWED_TRANSCRIPT : NOT_FOLLOWED_TRANSCRIPT
  const checkpoints = status === "NONE" ? [] : [checkpoint(status, overrides)]
  return { handle, interactionId, label: `Atendimento ${handle}`, otherOperatorNames: [], assessment: verifyProcessAssessments({ sources: [{ sourceRef: handle, assessment: { processes: [{ documentTitle: TITLE, checkpoints }] }, presented }], interactionId, transcript, published }) }
}
const canonical = (value: number, target: number): IndicatorCanonicalContext => ({ contract: INDICATOR_CANONICAL_CONTEXT_CONTRACT, indicator: { id: "i", code: "TMA", name: "TMA", unit: "SECONDS", direction: "LOWER" }, measurement: { id: "m", subjectId: "op", value, periodStart: "2026-09-01", periodEnd: "2026-09-30", granularity: "MONTHLY" }, target: { value: target, source: "TEAM", goalId: "g" }, ...canonicalComparison(value, target, "LOWER"), provenance: { source: "indicator_measurements+goals", loadedAt: "x" } })
const segments = buildSegments([
  { key: "segunda_via", label: "Segunda via", canonical: true, interactions: 20, withTranscript: 18, averageDurationSeconds: 540 },
  { key: "contestacao", label: "Contestação", canonical: true, interactions: 8, withTranscript: 6, averageDurationSeconds: 980 },
  { key: "reparo", label: "Reparo", canonical: true, interactions: 2, withTranscript: 2, averageDurationSeconds: 1500 },
])
const plan = (overrides: Partial<IndicatorDiagnosisPlan> = {}): IndicatorDiagnosisPlan => ({
  contract: INDICATOR_DIAGNOSIS_PLAN_VERSION, measurementId: "m", collaboratorId: "op", indicator: { code: "TMA", name: "TMA", unit: "SECONDS", direction: "LOWER" },
  period: { start: "2026-09-01T03:00:00.000Z", end: "2026-10-01T03:00:00.000Z", label: "01/09/2026 a 30/09/2026" }, dimension: "SUBJECT", metric: "INTERACTION_DURATION_SECONDS",
  interactionsInPeriod: 30, overallAverageDurationSeconds: 689, segments, selectedSegment: { key: "contestacao", label: "Contestação", reason: "r" }, sample: [], sampling: null, status: "READY_FOR_ASSESSMENT", strategy: { versionId: "s1", version: 1 }, ...overrides,
})

describe("V1.6.1 — onde investigar: decomposição por motivo (sistema, nunca o modelo)", () => {
  it("fora da meta (TMA, menor é melhor): o motivo com MAIOR excesso de tempo × volume — não o mais longo isolado nem um rótulo", () => {
    // Reparo tem a maior média, mas só 2 atendimentos transcritos (< 3) — não é elegível.
    expect(segments.find((segment) => segment.key === "reparo")!.eligible).toBe(false)
    expect(DIAGNOSIS_MIN_SEGMENT_INTERACTIONS).toBe(3)
    const selected = selectDiagnosisSegment(segments, { metric: "INTERACTION_DURATION_SECONDS", direction: "LOWER", withinTarget: false, overallAverageDurationSeconds: 689 })
    expect(selected).toMatchObject({ key: "contestacao", reason: expect.stringContaining("acima da média geral") })
    expect(selected!.reason).not.toMatch(/simples|complex|dif[íi]cil/i)
  })
  it("dentro da meta ou volume: o motivo mais representativo (mais atendimentos)", () => {
    expect(selectDiagnosisSegment(segments, { metric: "INTERACTION_DURATION_SECONDS", direction: "LOWER", withinTarget: true, overallAverageDurationSeconds: 689 })).toMatchObject({ key: "segunda_via" })
    expect(selectDiagnosisSegment(segments, { metric: "INTERACTION_COUNT", direction: "HIGHER", withinTarget: false, overallAverageDurationSeconds: null })).toMatchObject({ key: "segunda_via" })
  })
  it("nenhum motivo com 3 atendimentos transcritos → nada a investigar", () => {
    expect(selectDiagnosisSegment(buildSegments([{ key: "x", label: "X", canonical: false, interactions: 9, withTranscript: 2, averageDurationSeconds: 900 }]), { metric: "INTERACTION_DURATION_SECONDS", direction: "LOWER", withinTarget: false, overallAverageDurationSeconds: 600 })).toBeNull()
  })
  it("frase do motivo: números do sistema e a duração identificada como aproximação (nunca o TMA oficial)", () => {
    expect(segmentFactText(plan())).toBe("Motivo investigado: Contestação — 8 de 30 atendimentos do período; duração média registrada de 980 s nesse motivo e de 689 s em todos os atendimentos (duração registrada das chamadas, não o cálculo oficial do indicador).")
  })
})

describe("V1.6.1 — padrões na amostra (contagem do sistema sobre etapas VERIFICADAS)", () => {
  it("3 de 5 não seguidas → DEVELOPMENT; a identidade é a regra da base (documento + trecho), não o texto do modelo", () => {
    const sample = [assessed("I1", "NOT_FOLLOWED"), assessed("I2", "NOT_FOLLOWED"), assessed("I3", "NOT_FOLLOWED"), assessed("I4", "FOLLOWED"), assessed("I5", "FOLLOWED", { requirement: "Outro texto para a mesma regra" })]
    const [pattern] = aggregateProcessPatterns(sample)
    expect(pattern).toMatchObject({ classification: "DEVELOPMENT", analyzed: 5, knowledgeIdentity: true, grounding: "OFFICIAL_PROCEDURE", knowledge: { documentId: DOC, applicability: "VERIFIED" } })
    expect(pattern!.notFollowed).toEqual(["I1", "I2", "I3"])
    expect(pattern!.followed).toEqual(["I4", "I5"])
    expect(pattern!.practiceKey).toMatch(/^KB:44444444-4444-4444-8444-444444444444:[0-9a-f]{16}$/)
  })
  it("seguida de forma consistente → STRENGTH; pontual ou amostra < 3 → INCONCLUSIVE", () => {
    expect(aggregateProcessPatterns([assessed("I1", "FOLLOWED"), assessed("I2", "FOLLOWED"), assessed("I3", "NONE")])[0]).toMatchObject({ classification: "STRENGTH" })
    expect(classifyPattern({ analyzed: 5, followed: 3, notFollowed: 1 })).toBe("INCONCLUSIVE")
    expect(classifyPattern({ analyzed: 5, followed: 0, notFollowed: 1 })).toBe("INCONCLUSIVE")
    expect(classifyPattern({ analyzed: 2, followed: 0, notFollowed: 2 })).toBe("INCONCLUSIVE")
  })
  it("sem regra verificada: identidade REQ (nunca comparada com pares), sem orientação", () => {
    const [pattern] = aggregateProcessPatterns([assessed("I1", "NOT_FOLLOWED", { knowledgeQuote: null }), assessed("I2", "NOT_FOLLOWED", { knowledgeQuote: null }), assessed("I3", "NOT_FOLLOWED", { knowledgeQuote: null })])
    expect(pattern).toMatchObject({ classification: "DEVELOPMENT", knowledgeIdentity: false, knowledge: null, grounding: "NO_GROUNDED_GUIDANCE", guidanceText: null })
    expect(pattern!.practiceKey.startsWith("REQ:")).toBe(true)
  })
  it("observações persistíveis: só etapa verificada com regra VERIFIED; um status por atendimento × prática", () => {
    const observations = observationsFrom("op", [assessed("I1", "NOT_FOLLOWED"), assessed("I2", "FOLLOWED"), assessed("I3", "NOT_FOLLOWED", { knowledgeQuote: null })])
    expect(observations.map((entry) => [entry.interactionId, entry.status])).toEqual([["int-I1", "NOT_FOLLOWED"], ["int-I2", "FOLLOWED"]])
    expect(observations[0]).toMatchObject({ personId: "op", documentId: DOC, documentVersion: 2 })
  })
})

describe("V1.6.1 — pares: grupo de referência determinístico, só agregado, com privacidade", () => {
  const peers = Array.from({ length: 16 }, (_, index) => ({ personId: `p${String(index).padStart(2, "0")}`, value: 500 + index * 10 }))
  const period = { start: "2026-09-01T03:00:00.000Z", end: "2026-10-01T03:00:00.000Z" }
  const key = practiceKeyOf({ requirement: "x", knowledge: { documentId: DOC, documentTitle: TITLE, heading: null, version: 2, quote: RULE, literalInPublished: true, presentedInRun: true, anchorTerms: [], applicability: "VERIFIED", applicabilityBasis: "LEXICAL_ANCHOR", leadIn: null, failure: null, contentSha256: null } })
  const observation = (personId: string, index: number, status: "FOLLOWED" | "NOT_FOLLOWED", overrides: Partial<PeerObservationRow> = {}): PeerObservationRow => ({ personId, interactionId: `${personId}-${index}`, practiceKey: key, status, segmentKey: "contestacao", ...overrides })
  const topFour = ["p00", "p01", "p02", "p03"]
  const rows = topFour.flatMap((person) => [observation(person, 1, "FOLLOWED"), observation(person, 2, "FOLLOWED")])

  it("quartil de melhor resultado pela direção (menor é melhor), com a definição registrada; sem colega individual", () => {
    const reference = referenceGroupOf(peers, { direction: "LOWER", indicatorCode: "TMA", period })
    expect(reference).toMatchObject({ ok: true, members: topFour, definition: { rule: "TOP_QUARTILE_SAME_GROUP_SAME_PERIOD", eligiblePopulation: 16, referenceSize: 4 } })
    expect(referenceGroupOf(peers, { direction: "HIGHER", indicatorCode: "TMA", period })).toMatchObject({ ok: true, members: ["p15", "p14", "p13", "p12"] })
    expect(referenceGroupOf(peers, { direction: "TARGET", indicatorCode: "TMA", period })).toMatchObject({ ok: false, reason: "DIRECTION_NOT_RANKABLE" })
  })
  it("E) população abaixo do mínimo de privacidade → sem evidência de pares", () => {
    expect(PEER_MINIMUM_POPULATION).toBe(4)
    const reference = referenceGroupOf(peers.slice(0, 12), { direction: "LOWER", indicatorCode: "TMA", period })
    expect(reference).toMatchObject({ ok: false, reason: "POPULATION_BELOW_MINIMUM" })
    expect(buildPeerPracticeEvidence({ indicator: { code: "TMA", name: "TMA" }, practiceKey: key, segment: { key: "contestacao", label: "Contestação" }, own: { followed: 2, notFollowed: 3 }, reference, observations: rows, computedAt: "t" })).toMatchObject({ status: "NO_PEER_EVIDENCE", reason: "POPULATION_BELOW_MINIMUM" })
    // Pessoas contribuindo abaixo do mínimo também não gera evidência.
    const full = referenceGroupOf(peers, { direction: "LOWER", indicatorCode: "TMA", period })
    expect(buildPeerPracticeEvidence({ indicator: { code: "TMA", name: "TMA" }, practiceKey: key, segment: { key: "contestacao", label: "Contestação" }, own: { followed: 2, notFollowed: 3 }, reference: full, observations: rows.filter((row) => row.personId !== "p03"), computedAt: "t" })).toMatchObject({ status: "NO_PEER_EVIDENCE", reason: "CONTRIBUTORS_BELOW_MINIMUM" })
  })
  it("F) comparação válida → agregado aceito (frequência do grupo × sua amostra), sem causa e sem colega identificável", () => {
    const reference = referenceGroupOf(peers, { direction: "LOWER", indicatorCode: "TMA", period })
    // Fora do grupo de referência (p10) e fora do motivo não contam.
    const evidence = buildPeerPracticeEvidence({ indicator: { code: "TMA", name: "TMA" }, practiceKey: key, segment: { key: "contestacao", label: "Contestação" }, own: { followed: 2, notFollowed: 3 }, reference, observations: [...rows, observation("p10", 1, "NOT_FOLLOWED"), observation("p00", 9, "NOT_FOLLOWED", { segmentKey: "segunda_via" })], computedAt: "t" })
    expect(evidence).toMatchObject({ status: "AVAILABLE", populationSize: 4, contributors: 4, interactionCount: 8, followed: 8, prevalencePercent: 100, own: { followed: 2, observed: 5, prevalencePercent: 40 }, comparison: "HIGHER_IN_REFERENCE", privacySatisfied: true, causalClaimAllowed: false })
    const text = peerFactText(evidence as Extract<typeof evidence, { status: "AVAILABLE" }>)
    expect(text).toContain("8 de 8 atendimentos analisados de Contestação")
    expect(text).toContain("na sua amostra, em 2 de 5")
    expect(text).not.toMatch(/p0\d|reduz|caus/)
  })
  it("L) processo diferente ou motivo desconhecido → não compara", () => {
    const reference = referenceGroupOf(peers, { direction: "LOWER", indicatorCode: "TMA", period })
    const base = { indicator: { code: "TMA", name: "TMA" }, own: { followed: 2, notFollowed: 3 }, reference, observations: rows, computedAt: "t" }
    const otherKey = practiceKeyOf({ requirement: "x", knowledge: { documentId: "99999999-9999-4999-8999-999999999999", documentTitle: "Outro", heading: null, version: 1, quote: "Outra regra de outro processo.", literalInPublished: true, presentedInRun: true, anchorTerms: [], applicability: "VERIFIED", applicabilityBasis: "LEXICAL_ANCHOR", leadIn: null, failure: null, contentSha256: null } })
    expect(buildPeerPracticeEvidence({ ...base, practiceKey: otherKey, segment: { key: "contestacao", label: "Contestação" } })).toMatchObject({ status: "NO_PEER_EVIDENCE", reason: "CONTRIBUTORS_BELOW_MINIMUM" })
    expect(buildPeerPracticeEvidence({ ...base, practiceKey: "REQ:abc", segment: { key: "contestacao", label: "Contestação" } })).toMatchObject({ reason: "PRACTICE_NOT_COMPARABLE" })
    expect(buildPeerPracticeEvidence({ ...base, practiceKey: key, segment: null })).toMatchObject({ reason: "SEGMENT_NOT_COMPARABLE" })
    expect(buildPeerPracticeEvidence({ ...base, practiceKey: key, segment: { key: "segunda_via", label: "Segunda via" } })).toMatchObject({ reason: "CONTRIBUTORS_BELOW_MINIMUM" })
  })
})

describe("V1.6.1 — resultado do diagnóstico e NO_ACTIONABLE_DIAGNOSIS", () => {
  const outcome = (sample: AssessedInteraction[], planOverrides: Partial<IndicatorDiagnosisPlan> = {}, value = 689) => buildDiagnosisOutcome({ canonical: canonical(value, 660), plan: plan(planOverrides), assessed: sample, discarded: [], patterns: aggregateProcessPatterns(sample), peers: new Map(), hadAssessments: sample.length > 0 })
  it("A) fora da meta sem padrão consistente → NO_ACTIONABLE_DIAGNOSIS com a limitação factual (sem orientação inventada)", () => {
    const result = outcome([assessed("I1", "NOT_FOLLOWED"), assessed("I2", "FOLLOWED"), assessed("I3", "NONE")])
    expect(result).toMatchObject({ status: "NO_ACTIONABLE_DIAGNOSIS", reason: "NO_CONSISTENT_PATTERN", supportedFindings: [] })
    expect(result.limitations).toContain("Não houve evidência suficiente para uma orientação específica: nenhuma etapa do processo apareceu de forma consistente na amostra analisada.")
    expect(result.unsupportedHypotheses).toContain("O comportamento observado na amostra ter causado o resultado do indicador (associação não é causa).")
  })
  it("plano não investigável (indicador não decomponível, sem atendimentos, sem motivo) → NO_ACTIONABLE com o motivo", () => {
    expect(outcome([], { status: "NOT_DECOMPOSABLE", selectedSegment: null })).toMatchObject({ status: "NO_ACTIONABLE_DIAGNOSIS", reason: "NOT_DECOMPOSABLE" })
    expect(outcome([], { status: "NO_INTERACTIONS", selectedSegment: null })).toMatchObject({ reason: "NO_INTERACTIONS" })
    expect(outcome([assessed("I1", "NOT_FOLLOWED"), assessed("I2", "NOT_FOLLOWED")])).toMatchObject({ reason: "INSUFFICIENT_SAMPLE" })
  })
  it("padrão sustentado → DEVELOPMENT_SUPPORTED, com achado N de M e as limitações (amostra, aproximação, associação ≠ causa, sem pares)", () => {
    const result = outcome([assessed("I1", "NOT_FOLLOWED"), assessed("I2", "NOT_FOLLOWED"), assessed("I3", "FOLLOWED")])
    expect(result).toMatchObject({ status: "DEVELOPMENT_SUPPORTED", reason: null, indicatorContext: { value: 689, target: 660, withinTarget: false, gapToTarget: 29, history: null } })
    expect(result.supportedFindings).toEqual(["Etapa “Confirmar valor e mês antes de abrir a contestação”: não foi identificada em 2 de 3 atendimentos analisados de Contestação."])
    expect(result.limitations).toEqual(expect.arrayContaining([
      "Foram analisados 3 de 8 atendimentos de Contestação no período; a análise não representa todos os atendimentos.",
      "Uma etapa observada nos atendimentos analisados não demonstra que ela causou o resultado do indicador.",
    ]))
    expect(result.limitations.some((line) => line.startsWith("Sem comparação com grupo de referência"))).toBe(true)
  })
  it("fora da meta com só etapas seguidas → reconhecimento, mas registra que não houve orientação específica", () => {
    const result = outcome([assessed("I1", "FOLLOWED"), assessed("I2", "FOLLOWED"), assessed("I3", "FOLLOWED")])
    expect(result.status).toBe("STRENGTH_ONLY")
    expect(result.limitations).toContain("Não houve evidência suficiente para uma orientação específica: as etapas avaliadas foram seguidas na amostra analisada.")
  })
})
