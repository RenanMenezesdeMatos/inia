import { describe, expect, it } from "vitest"
import { defaultSamplingStrategy, periodDaysOf, selectSample } from "./sampling-strategy.js"

type Item = { id: string; startedAt: Date; subject: string; flagged: boolean }
const quarter = { start: new Date("2026-06-01T03:00:00Z"), end: new Date("2026-09-01T03:00:00Z") }
const month = { start: new Date("2026-06-01T03:00:00Z"), end: new Date("2026-07-01T03:00:00Z") }
const day = (iso: string) => new Date(`${iso}T12:00:00Z`)
/** 12 interações: 4 em junho, 4 em julho, 4 em agosto. */
const candidates: Item[] = ["06-02", "06-10", "06-18", "06-26", "07-03", "07-11", "07-19", "07-27", "08-04", "08-12", "08-20", "08-28"].map((d, index) => ({ id: `i${index}`, startedAt: day(`2026-${d}`), subject: index % 3 === 0 ? "fatura" : index % 3 === 1 ? "plano" : "chip", flagged: index % 4 === 0 }))
const base = { period: quarter, periodDays: periodDaysOf(quarter), startedAtOf: (item: Item) => item.startedAt, keyOf: (item: Item) => item.id, subjectOf: (item: Item) => item.subject, hasFlagOf: (item: Item) => item.flagged, dateLabelOf: (date: Date) => date.toISOString().slice(0, 10) }

describe("amostragem depende da pergunta (V1.3.2 — §19–§24, §56)", () => {
  it("regra do runtime: janela curta → RECENT; janela longa + padrão/causa → TEMPORAL_STRATIFIED; descrever/feedback de interação → RECENT mesmo em janela longa", () => {
    expect(defaultSamplingStrategy("IDENTIFY_EMPLOYEE_PATTERN", 30)).toBe("RECENT")
    expect(defaultSamplingStrategy("IDENTIFY_EMPLOYEE_PATTERN", 92)).toBe("TEMPORAL_STRATIFIED")
    expect(defaultSamplingStrategy("EXPLAIN_INDICATOR_DEVIATION", 61)).toBe("TEMPORAL_STRATIFIED")
    expect(defaultSamplingStrategy("DESCRIBE_PERFORMANCE", 92)).toBe("RECENT")
    expect(defaultSamplingStrategy("FEEDBACK_SINGLE_INTERACTION", 92)).toBe("RECENT")
  })

  it("RECENT numa janela longa entrega só o fim do período; TEMPORAL_STRATIFIED distribui 8 itens em 3 blocos (3/3/2) sem ultrapassar o teto", () => {
    const recent = selectSample({ ...base, candidates, strategy: "RECENT", limit: 8 })
    expect(recent.metadata.selectedPerBucket).toEqual([0, 4, 4])
    const stratified = selectSample({ ...base, candidates, strategy: "TEMPORAL_STRATIFIED", limit: 8 })
    expect(stratified.selected).toHaveLength(8)
    expect(stratified.metadata).toMatchObject({ strategy: "TEMPORAL_STRATIFIED", candidateCount: 12, selectedCount: 8, selectedPerBucket: [2, 3, 3] })
    expect(stratified.metadata.periodBuckets).toHaveLength(3)
    expect(stratified.metadata.periodBuckets[0]).toMatchObject({ from: "2026-06-01", candidates: 4 })
    // Dentro de cada bloco, as mais recentes primeiro; saída em ordem cronológica inversa.
    expect(stratified.selected.map((item) => item.id)).toEqual(["i11", "i10", "i9", "i7", "i6", "i5", "i3", "i2"])
  })

  it("determinismo: mesmo input → mesma amostra (inclusive com a ordem dos candidatos embaralhada)", () => {
    const a = selectSample({ ...base, candidates, strategy: "TEMPORAL_STRATIFIED", limit: 5 })
    const b = selectSample({ ...base, candidates: [...candidates].reverse(), strategy: "TEMPORAL_STRATIFIED", limit: 5 })
    expect(a.selected.map((item) => item.id)).toEqual(b.selected.map((item) => item.id))
  })

  it("nunca seleciona fora da janela nem além do teto; janela curta = 1 bloco (equivale a RECENT)", () => {
    const withOutsider = [...candidates, { id: "x", startedAt: day("2026-09-15"), subject: "fatura", flagged: false }]
    const out = selectSample({ ...base, candidates: withOutsider.filter((item) => item.startedAt < quarter.end), strategy: "TEMPORAL_STRATIFIED", limit: 100 })
    expect(out.selected).toHaveLength(12)
    expect(out.selected.every((item) => item.startedAt >= quarter.start && item.startedAt < quarter.end)).toBe(true)
    const short = selectSample({ ...base, period: month, periodDays: periodDaysOf(month), candidates: candidates.slice(0, 4), strategy: "TEMPORAL_STRATIFIED", limit: 3 })
    expect(short.metadata.periodBuckets).toHaveLength(1)
    expect(short.selected.map((item) => item.id)).toEqual(["i3", "i2", "i1"])
  })

  it("SUBJECT_STRATIFIED faz rodízio entre assuntos; FLAG_STRATIFIED entre com/sem flag", () => {
    const bySubject = selectSample({ ...base, candidates, strategy: "SUBJECT_STRATIFIED", limit: 3 })
    expect(new Set(bySubject.selected.map((item) => item.subject)).size).toBe(3)
    const byFlag = selectSample({ ...base, candidates, strategy: "FLAG_STRATIFIED", limit: 4 })
    expect(byFlag.selected.filter((item) => item.flagged)).toHaveLength(2)
  })
})
