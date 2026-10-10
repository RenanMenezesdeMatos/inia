import { describe, expect, it } from "vitest"
import { summarizeToolResult } from "./tool-summaries.js"
import { deltaOf, percentOf, type ToolResult } from "../domain/tool-output.js"

const result = (data: unknown): ToolResult => ({ data, quality: { status: "SUFFICIENT", sampleCount: 7, coverage: null, freshness: null }, provenance: { population: "colaborador", filters: [], dataSource: "TEST" } })

// V1.3.1 — §2/§57: a aplicação calcula; o modelo recebe o valor pronto no ledger.
describe("derivações determinísticas no ledger (a IA interpreta, o backend calcula)", () => {
  it("6 de 7 interações com a flag: o ledger traz 85,7% pronto — nenhum cálculo pedido ao modelo", () => {
    expect(percentOf(6, 7)).toBe(85.7)
    expect(percentOf(0, 7)).toBe(0)
    expect(percentOf(6, 0)).toBeNull()
    const summary = summarizeToolResult("get_interaction_flags", result({ interactionsInSet: 7, flags: [{ flag: "tempo_silencio", count: 6, sharePercent: percentOf(6, 7) }, { flag: "rechamada", count: 1, sharePercent: percentOf(1, 7) }] }))
    expect(summary).toBe("7 interação(ões): tempo_silencio×6 (85.70%), rechamada×1 (14.30%)")
  })

  it("deltas prontos: própria × referência das comparáveis, gap × meta, anomalias em % dos dias, padrão em % das transcrições, variação do 1º ao último ponto do histórico", () => {
    expect(deltaOf(683, 600)).toEqual({ absolute: 83, percent: 13.8 })
    expect(summarizeToolResult("find_comparable_interactions", result({ comparableInteractions: 4, distinctOperators: 4, referenceAverageDurationSeconds: 683, ownAverageDurationSeconds: 1073, ownVersusReference: deltaOf(1073, 683) }))).toContain("→ própria +390 s (+57.10%)")
    expect(summarizeToolResult("get_indicator_snapshot", result({ indicator: { code: "TMA" }, operational: { formatted: "467 s", sampleCount: 21, coverage: 1 }, target: { value: 400, withinTarget: false, gap: 67, gapPercent: 16.8 }, official: null }))).toContain("meta 400 (fora, +67 / +16.80%)")
    expect(summarizeToolResult("detect_anomalies", result({ pattern: "ISOLATED_SPIKES", baseline: 464.3, anomalies: [{ date: "2026-08-03", observedValue: 501, performance: "WORSE" }], pointsAnalyzed: 21, anomalySharePercent: percentOf(1, 21) }))).toContain("1 ponto(s) fora em 21 dia(s) (4.80%)")
    // V1.3.2: "≥N de M analisadas" (limite inferior) — e só com cobertura total o percentual do período aparece.
    expect(summarizeToolResult("analyze_interactions", result({ analyzedTranscriptCount: 2, recordedUniverseCount: 2, universeRelationship: "FULL_COVERAGE", findings: [{ finding: "informa o protocolo", matchedTranscriptCount: 2, matchedShareOfAnalyzedPercent: 100, prevalenceInUniversePercent: 100 }] }))).toContain('"informa o protocolo" (trecho verificado em ≥2 de 2 analisadas; 100% do período)')
    const partial = summarizeToolResult("analyze_interactions", result({ analyzedTranscriptCount: 8, recordedUniverseCount: 30, universeRelationship: "PARTIAL_COVERAGE", analyzedShareOfUniversePercent: 26.7, temporalCoverage: { buckets: 3, bucketsCovered: 2 }, findings: [{ finding: "silêncio sem aviso", matchedTranscriptCount: 2, matchedShareOfAnalyzedPercent: 25, prevalenceInUniversePercent: null }] }))
    expect(partial).toContain("8 transcrição(ões) analisada(s) de 30 registradas no período (26.70%) · cobertura temporal 2/3 bloco(s)")
    expect(partial).toContain("(trecho verificado em ≥2 de 8 analisadas)")
    expect(partial).toContain("não é prevalência no período")
    expect(partial).not.toContain("2 de 30")
    // V1.4.2: o ledger mostra o handle CANÔNICO (SP-n/SF-n), o NÍVEL e o ESCOPO/teto de claim — o modelo seleciona o handle, não constrói ref.
    const canonical = summarizeToolResult("analyze_interactions", result({ analyzedTranscriptCount: 8, recordedUniverseCount: 30, universeRelationship: "PARTIAL_COVERAGE", findings: [{ finding: "prazos completos", matchedTranscriptCount: 4, kind: "STRENGTH", handle: "SP1", findingRefs: ["I2/F1", "I5/F1"], support: { level: "RECURRENT_IN_SAMPLE", scope: "PERIOD", maximumClaimScope: "PERIOD_PATTERN", reason: "x" }, verifiedExcerpts: [] }], semantic: { frames: [{ interactionRef: "I2", findings: [{ id: "F1", kind: "STRENGTH", summary: "informa prazo", handle: "SF1" }] }, { interactionRef: "I5", findings: [{ id: "F1", kind: "STRENGTH", summary: "informa prazo", handle: "SF2" }] }], telemetry: { semanticFramesCreated: 8, interactionsWithFindings: 2, strengthFindingsCount: 2, riskFindingsCount: 0, unresolvedNeedsCount: 0, partialNeedsCount: 0, proceduralQuestionsCount: 0, procedureAssertionsCount: 0, crossInteractionPatternsCount: 1 } } }))
    expect(canonical).toContain('SP1 "prazos completos" (STRENGTH; trecho verificado em ≥4 de 8 analisadas; nível RECURRENT_IN_SAMPLE; escopo PERIOD → claim até PERIOD_PATTERN; findings SF1, SF2)')
    expect(canonical).toContain("SF1 [STRENGTH] I2: informa prazo")
    expect(canonical).toContain("support.patternRef = SP-n ou support.findingRef = SF-n")
    expect(canonical).toContain("nunca F-n/P-n")
    expect(summarizeToolResult("get_employee_history", result({ layer: "OFFICIAL", series: [{ referencePeriod: "2026-03", value: 430 }, { referencePeriod: "2026-08", value: 491 }], changeFirstToLast: { from: 430, to: 491, absolute: 61, percent: 14.2, performance: "DECLINED" } }))).toContain("do 1º ao último ponto: 430 → 491 (+61 / +14.20%) · DECLINED")
  })
})
