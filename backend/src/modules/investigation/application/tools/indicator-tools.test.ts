import { describe, expect, it } from "vitest"
import type { OperationalWindowResult } from "../../../indicators/application/operational-measurement-resolver.js"
import { assessWindowQuality } from "./indicator-tools.js"
import type { IndicatorInfo } from "../tool-context.js"

const indicator: IndicatorInfo = { id: "i", code: "TMA", name: "TMA", unit: "SECONDS", direction: "LOWER", kind: "WEIGHTED_AVERAGE", dailySupported: true, unjustifiedAbsencePolicy: "NO_SAMPLE", minimumSampleSize: null, minimumCoverage: 0.6, active: true, officialClosureSupported: true }

function windowResult(overrides: Partial<Omit<OperationalWindowResult, "eligibility">> & { eligibility?: unknown }): OperationalWindowResult {
  return {
    value: 450, aggregation: "WEIGHTED_AVERAGE", kind: "WEIGHTED_AVERAGE", method: "Σ", sampleCount: 20, daysWithData: 20, numerator: 9000, denominator: 20, sampleTotal: null,
    source: "MEASUREMENT", window: { start: "", end: "" }, expectedDays: 20, coverage: 1, ignoredMeasurements: 0, unjustifiedAbsence: { days: 0, policy: "NO_SAMPLE", zeroContributionDays: 0 },
    ...(overrides as object),
  } as OperationalWindowResult
}

const eligibility = (extra: { freshness?: "FRESH" | "STALE" | "UNKNOWN"; unconfirmedDays?: number; dataSourceDelayDays?: number }): unknown => ({
  statusConfidence: { freshness: extra.freshness ?? "FRESH", unconfirmedDays: extra.unconfirmedDays ?? 0 },
  observed: { dataSourceDelayDays: extra.dataSourceDelayDays ?? 0, waitingForSourcesDays: 0, evidenceSources: { interactions: true, indicatorCodes: [] } },
})

describe("assessWindowQuality — reutiliza as semânticas existentes (cobertura, amostra, atualidade, disponibilidade)", () => {
  it("SEM DADOS por zero dias elegíveis não é performance zero", () => {
    expect(assessWindowQuality(windowResult({ value: null, noDataReason: "NO_ELIGIBLE_DAYS", sampleCount: 0 }), indicator)).toMatchObject({ status: "NO_DATA", note: expect.stringContaining("não é performance zero") })
  })

  it("cobertura abaixo da mínima do catálogo → INSUFFICIENT_COVERAGE; amostra abaixo da mínima → INSUFFICIENT_SAMPLE", () => {
    expect(assessWindowQuality(windowResult({ coverage: 0.4 }), indicator).status).toBe("INSUFFICIENT_COVERAGE")
    expect(assessWindowQuality(windowResult({ sampleCount: 2 }), { ...indicator, minimumCoverage: null, minimumSampleSize: 5 }).status).toBe("INSUFFICIENT_SAMPLE")
  })

  it("fonte de dados atrasada na janela → SOURCE_DELAY; situação funcional não confirmada (RH desatualizado) → STALE", () => {
    expect(assessWindowQuality(windowResult({ eligibility: eligibility({ dataSourceDelayDays: 2 }) }), indicator)).toMatchObject({ status: "SOURCE_DELAY", freshness: "FRESH" })
    expect(assessWindowQuality(windowResult({ eligibility: eligibility({ freshness: "STALE", unconfirmedDays: 3 }) }), indicator)).toMatchObject({ status: "STALE", freshness: "STALE" })
  })

  it("tudo em ordem → SUFFICIENT com amostra e cobertura", () => {
    expect(assessWindowQuality(windowResult({ eligibility: eligibility({}) }), indicator)).toEqual({ status: "SUFFICIENT", sampleCount: 20, coverage: 1, freshness: "FRESH" })
  })
})
