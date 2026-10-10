import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { compositionPayloadOf } from "./composition-prompt.js"
import { absenceOfPatternStatement, buildIndicatorBrief } from "./indicator-brief.js"
import type { IndicatorInvestigation, SegmentEvidence } from "./indicator-investigation.js"
import { openQuestionsOf, type InvestigationState } from "./investigation-toolbox.js"
import { INDICATOR_INVESTIGATION_LOGIC_VERSION } from "./versions.js"

/**
 * AUSÊNCIA DE PADRÃO ≠ AUSÊNCIA DE FALHA (`ABSENCE_OF_PATTERN_V1`, `INDICATOR_INVESTIGATION_V6`) — regressão da rodada real V8, sem IA:
 * o TMA de agosto saiu com "Nas chamadas analisadas […] os atendimentos transcorreram sem desvios recorrentes de processo", a partir de
 * DUAS análises (uma delas afetada por um defeito que descartou achados). A frase nascia no brief ("nenhum desvio de processo apareceu
 * de forma recorrente") — aqui a origem é corrigida, não a redação final.
 */
const entry = (overrides: Partial<SegmentEvidence>): SegmentEvidence => ({ segmentKey: "contestacao", segmentLabel: "Contestação de cobrança", focusReason: "UNLOCATED", universe: 10, analyzedCalls: 1, reusedCalls: 1, newlyAnalyzed: 0, sampleBasis: "EXISTING_MEMORY", sampleNote: "1 de 10 chamadas do assunto Contestação de cobrança no período já tinham análise.", patterns: [], pathIncorrect: 0, pathAssessed: 0, ...overrides })
const investigationWith = (evidence: SegmentEvidence[]): IndicatorInvestigation => ({
  logicVersion: INDICATOR_INVESTIGATION_LOGIC_VERSION,
  official: { indicatorId: "i", code: "TMA", name: "Tempo Médio de Atendimento", unit: "SECONDS", direction: "LOWER", sourceKind: "OFFICIAL_CLOSING", sourceRef: "c", value: 357, target: 400, withinTarget: true, gapToTarget: null, periodStart: "2026-08-01", periodEnd: "2026-08-31", periodLabel: "agosto/2026", referencePeriod: "2026-08", previous: { value: 382, periodLabel: "julho/2026", withinTarget: true }, movement: "IMPROVED", quartile: "Q1", previousQuartile: "Q2" },
  localization: { proxy: { kind: "DURATION_SECONDS", label: "a duração média registrada das chamadas", description: "aproximação" }, windows: { current: { start: "2026-08-01", end: "2026-08-31", label: "01/08 a 31/08" }, previous: { start: "2026-07-01", end: "2026-07-31", label: "01/07 a 31/07" } }, overall: { current: { n: 13, value: 596 }, previous: { n: 1, value: 1385 }, change: -789, direction: "UNKNOWN" }, officialAgreement: "UNKNOWN", decomposition: null, segments: [], daily: { available: true, points: [], outliers: [], weekdays: [] }, focus: [], limitations: [] },
  evidence,
  reference: null,
  questions: [],
  conclusion: "RESULT_RECOGNITION",
  limitations: [],
  budget: { maxCallAnalyses: 0, callAnalyses: 0, reusedCalls: 2, stoppedBy: null },
  strategy: { versionId: "s", configured: true },
  teamId: null,
  subteamId: null,
})
const brief = (evidence: SegmentEvidence[]) => buildIndicatorBrief(investigationWith(evidence), { documentVersions: new Map(), delivered: new Set(), factualWhenInconclusive: false })

describe("ausência de padrão numa amostra nunca vira 'sem desvios'", () => {
  it("rodada V8: 1 de 10 e 1 de 1 chamadas analisadas, sem padrão → LIMITE com universo, amostra e qualidade; nada no contexto que sustente frase de boa execução", () => {
    const result = brief([entry({ quality: { usable: 0, partial: 1, confirmedCalls: 1 } }), entry({ segmentKey: "b", segmentLabel: "Dúvida sobre fatura e segunda via", universe: 1, quality: { usable: 0, partial: 1, confirmedCalls: 1 } })])
    expect(result.context.join(" ")).not.toMatch(/nenhum desvio|sem desvio|transcorreram/i)
    expect(result.limitations).toContain("No assunto Contestação de cobrança, 1 de 10 chamada(s) gravada(s) no período foi analisada (1 com análise parcial — nem todas as etapas puderam ser avaliadas): é pouco para dizer se há ou não desvio recorrente — o que não foi visto nessa amostra não indica que as chamadas estejam sem problemas.")
    expect(result.readerNotes).toEqual(expect.arrayContaining([expect.stringContaining("é pouco para dizer se há ou não desvio recorrente")]))
    // O que vai ao REDATOR: o limite está em limitations (nunca em context), e o resultado oficial continua o único reconhecimento.
    const payload = compositionPayloadOf(result)
    expect(payload.facts.context.join(" ")).not.toMatch(/desvio/i)
    expect(payload.facts.limitations.join(" ")).toContain("não indica que as chamadas estejam sem problemas")
    expect(result.strengths.map((finding) => finding.origin)).toEqual(["INDICATOR_RESULT"])
    expect(result.strengths[0]!.observed).toBe("O resultado oficial de Tempo Médio de Atendimento em agosto/2026 foi 357 s, dentro da meta de 400 s, melhor que 382 s em julho/2026.")
  })
  it("amostra suficiente (≥ 3 chamadas com conclusões, análises completas, metade do recorte) → frase de FATO restrita à amostra, nunca 'sem desvios'", () => {
    const statement = absenceOfPatternStatement(entry({ analyzedCalls: 6, universe: 8, quality: { usable: 6, partial: 0, confirmedCalls: 6 } }))
    expect(statement).toEqual({ kind: "FACT", text: "No assunto Contestação de cobrança, nas 6 chamadas analisadas (de 8 gravadas no período), nenhuma etapa do procedimento apareceu descumprida em mais de uma chamada — isso descreve essa amostra, não o atendimento do período inteiro." })
  })
  it("análise parcial ou cobertura pequena mantém LIMITE mesmo com várias chamadas", () => {
    expect(absenceOfPatternStatement(entry({ analyzedCalls: 4, universe: 8, quality: { usable: 3, partial: 1, confirmedCalls: 4 } })).kind).toBe("LIMIT")
    expect(absenceOfPatternStatement(entry({ analyzedCalls: 3, universe: 20, quality: { usable: 3, partial: 0, confirmedCalls: 3 } })).kind).toBe("LIMIT")
  })
})

describe("resultado dentro da meta não fecha a pergunta 'há recorte materialmente pior?' quando há ferramenta para olhar", () => {
  const state = (overrides: Partial<InvestigationState>): InvestigationState => ({ officialAdverse: false, adverse: false, good: true, measurementBased: false, localized: false, whereTools: { available: ["segment_indicator", "detect_anomalies"], tried: [] }, attribution: "UNKNOWN", contextTools: { available: [], tried: [] }, workContextChecked: false, dataQuality: null, dataQualityTool: { available: false, tried: false }, slices: [], minimumAnalyzed: 3, analyzeAvailable: true, callAnalysesLeft: 1, modelBudgetExhausted: false, strengthEvidence: false, plan: "PLANNER", ...overrides })
  const where = (questions: ReturnType<typeof openQuestionsOf>) => questions.find((question) => question.kind === "WHERE")
  it("localização do sistema sem volume para comparar (julho com 1 chamada) → pergunta ABERTA e material, com as ferramentas de localização", () => {
    expect(where(openQuestionsOf(state({})))).toMatchObject({ status: "OPEN", material: true, candidateTools: ["segment_indicator", "detect_anomalies"] })
  })
  it("uma consulta feita responde (nada encontrado não vira problema); localização do sistema completa também responde; sem ferramenta = registrado", () => {
    expect(where(openQuestionsOf(state({ whereTools: { available: ["segment_indicator"], tried: ["segment_indicator"] } })))).toMatchObject({ status: "ANSWERED", material: false })
    expect(where(openQuestionsOf(state({ localizedByCode: true })))).toMatchObject({ status: "ANSWERED", material: false })
    expect(where(openQuestionsOf(state({ whereTools: { available: [], tried: [] } })))).toMatchObject({ status: "NO_TOOL", material: false })
  })
})
