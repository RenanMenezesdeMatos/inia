import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { compositionPayloadOf } from "./composition-prompt.js"
import { feedbackViewOf, subjectsViewOf } from "./feedback-view.js"
import { buildIndicatorBrief, subjectsOf } from "./indicator-brief.js"
import type { IndicatorInvestigation, SegmentComparison, SegmentEvidence } from "./indicator-investigation.js"
import { INDICATOR_INVESTIGATION_LOGIC_VERSION } from "./versions.js"

/**
 * `INDICATOR_SUBJECTS_V1` — zero IA. "Entenda este feedback" do indicador mostra os assuntos da pessoa nos dois períodos (duração,
 * variação, se havia chamadas suficientes para comparar e quantas foram analisadas). Números da localização da investigação (dados da
 * Larissa, TMA de setembro, 05/10/2026); nada vem do modelo e nada disso vai ao redator.
 */
const segment = (label: string, previous: [number, number] | null, current: [number, number] | null, overrides: Partial<SegmentComparison> = {}): SegmentComparison => ({
  key: label.toLowerCase().replace(/\s+/g, "-"),
  label,
  previous: previous ? { n: previous[0], value: previous[1] } : null,
  current: current ? { n: current[0], value: current[1] } : null,
  shareCurrent: 0,
  sharePrevious: 0,
  withinContribution: null,
  mixContribution: null,
  change: null,
  relativeChange: null,
  changeDirection: "UNKNOWN",
  sufficient: false,
  ...overrides,
})
const SEGMENTS = [
  segment("Internet móvel sem conexão", null, [2, 650]),
  segment("Contestação de cobrança", [10, 533.8], [11, 628.6363636363636], { key: "contestacao", changeDirection: "WORSE", sufficient: true }),
  segment("Segunda via", null, [1, 260]),
  segment("Plano", [1, 599], null),
]
const evidence = (overrides: Partial<SegmentEvidence>): SegmentEvidence => ({ segmentKey: "contestacao", segmentLabel: "Contestação de cobrança", focusReason: "DETERIORATED", universe: 11, analyzedCalls: 4, reusedCalls: 0, newlyAnalyzed: 4, sampleBasis: "EXISTING_MEMORY", sampleNote: "", patterns: [], pathIncorrect: 0, pathAssessed: 0, ...overrides })
const investigation = (segments: SegmentComparison[] = SEGMENTS): IndicatorInvestigation => ({
  logicVersion: INDICATOR_INVESTIGATION_LOGIC_VERSION,
  official: { indicatorId: "i", code: "TMA", name: "Tempo Médio de Atendimento", unit: "SECONDS", direction: "LOWER", sourceKind: "OFFICIAL_CLOSING", sourceRef: "c", value: 452, target: 400, withinTarget: false, gapToTarget: 52, periodStart: "2026-09-01", periodEnd: "2026-09-30", periodLabel: "setembro/2026", referencePeriod: "2026-09", previous: null, movement: null, quartile: "Q3", previousQuartile: null },
  localization: { proxy: { kind: "DURATION_SECONDS", label: "a duração média registrada das chamadas", description: "aproximação pela duração registrada das chamadas, não o valor oficial do indicador." }, windows: { current: { start: "2026-09-01", end: "2026-09-30", label: "01/09 a 30/09" }, previous: { start: "2026-08-01", end: "2026-08-31", label: "01/08 a 31/08" } }, overall: { current: null, previous: null, change: null, direction: "UNKNOWN" }, officialAgreement: "UNKNOWN", decomposition: null, segments, daily: { available: false, points: [], outliers: [], weekdays: [] }, focus: [{ key: "contestacao", label: "Contestação de cobrança", reason: "DETERIORATED" }], limitations: [] },
  // Dado real (05/10): o assunto localizado também é um recorte (R1); um recorte por dia tem outra chave e nunca vira linha de assunto.
  evidence: [evidence({ sliceRef: "R1" }), evidence({ sliceRef: "R2", segmentKey: "DAY=2026-09-28", segmentLabel: "dia 28/09", focusReason: "ATYPICAL_DAY", universe: 1, analyzedCalls: 1 })],
  reference: null,
  questions: [],
  conclusion: "PATTERN_SUPPORTED",
  limitations: [],
  budget: { maxCallAnalyses: 10, callAnalyses: 4, reusedCalls: 0, stoppedBy: null },
  strategy: { versionId: "s", configured: true },
  teamId: null,
  subteamId: null,
})

describe("INDICATOR_SUBJECTS_V1 — os assuntos da pessoa no 'Entenda este feedback'", () => {
  it("o brief leva os assuntos como a investigação os mediu: o investigado primeiro, depois os comparáveis, depois por volume", () => {
    const subjects = subjectsOf(investigation())!
    expect(subjects.rows.map((row) => row.label)).toEqual(["Contestação de cobrança", "Internet móvel sem conexão", "Segunda via", "Plano"])
    expect(subjects.rows[0]).toMatchObject({ focus: true, comparable: true, direction: "WORSE", analyzed: { calls: 4, universe: 11 } })
    expect(subjects.rows[1]).toMatchObject({ focus: false, comparable: false, analyzed: null })
  })

  it("na tela: duração em minutos e segundos, variação só quando compara, e o motivo quando não compara", () => {
    const view = subjectsViewOf(subjectsOf(investigation()))!
    expect(view.title).toBe("Seus assuntos no período")
    expect(view.periods).toEqual({ previous: "01/08 a 31/08", current: "01/09 a 30/09" })
    expect(view.note).toContain("não o valor oficial do indicador")
    expect(view.rows[0]).toEqual({ label: "Contestação de cobrança", previous: "8 min 54 s · 10 chamadas", current: "10 min 29 s · 11 chamadas", change: "+1 min 35 s (+17,8%)", trend: "WORSE", reading: "Piorou", focus: true, analyzed: "4 de 11 chamadas" })
    expect(view.rows[1]).toMatchObject({ previous: null, current: "10 min 50 s · 2 chamadas", change: null, trend: "NOT_COMPARED", reading: "Sem chamadas em 01/08 a 31/08" })
    expect(view.rows[2]).toMatchObject({ current: "4 min 20 s · 1 chamada" })
    expect(view.rows[3]).toMatchObject({ current: null, reading: "Sem chamadas em 01/09 a 30/09" })
  })

  it("com chamadas nos dois períodos mas abaixo do mínimo: 'Poucas chamadas para comparar'; acima de 8 assuntos, o resto é contado", () => {
    const many = Array.from({ length: 10 }, (_, index) => segment(`Assunto ${index + 1}`, [1, 300], [2, 320]))
    const view = subjectsViewOf(subjectsOf(investigation(many)))!
    expect(view.rows).toHaveLength(8)
    expect(view.hidden).toBe(2)
    expect(view.rows[0]).toMatchObject({ reading: "Poucas chamadas para comparar", change: null })
  })

  it("só nos detalhes do INDICADOR: nunca vai ao redator; investigação sem métrica por assunto não mostra nada", () => {
    const brief = buildIndicatorBrief(investigation(), { documentVersions: new Map(), delivered: new Set(), factualWhenInconclusive: false })
    expect(JSON.stringify(compositionPayloadOf(brief))).not.toContain("10 min 29 s")
    expect(JSON.stringify(compositionPayloadOf(brief))).not.toContain("\"subjects\"")
    const view = feedbackViewOf(brief, { card: "c", paragraphs: ["p"], sentences: [] })
    expect(view.subjects?.rows[0]?.label).toBe("Contestação de cobrança")
    const noProxy = investigation()
    noProxy.localization.proxy.kind = null
    expect(subjectsOf(noProxy)).toBeNull()
  })
})
