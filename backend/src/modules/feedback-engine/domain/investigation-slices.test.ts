import { describe, expect, it } from "vitest"
import { INVESTIGATION_SLICES_VERSION, sliceLabelOf, sliceScopeOf, slicesFromToolResult, type DiscoveryContext } from "./investigation-slices.js"

const context: DiscoveryContext = { direction: "LOWER", proxyKind: "DURATION_SECONDS", minimumPerSegment: 3, formatIndicator: (value) => `${value} s`, subjectLabel: (key) => ({ fatura: "Fatura", segunda_via: "Segunda via" })[key] ?? key, ref: "F1", tool: "segment_indicator", round: 1 }
const bucketsOf = (rows: { value: string; canonical: string | null; duration: number; n: number }[]) => rows.map((row) => ({ dimensionValue: row.value, canonicalSubject: row.canonical, averageDurationSeconds: row.duration, sampleCount: row.n }))

describe("INVESTIGATION_SLICES_V2 — assunto (submotivo) e motivo como recortes", () => {
  it("o motivo é um recorte próprio, com rótulo e escopo de motivo", () => {
    expect(INVESTIGATION_SLICES_VERSION).toBe("INVESTIGATION_SLICES_V2")
    expect(sliceScopeOf([{ dimension: "SUBJECT", value: "segunda_via", label: "Segunda via" }])).toBe("No assunto Segunda via")
    expect(sliceScopeOf([{ dimension: "REASON", value: "fatura", label: "Fatura" }])).toBe("No motivo Fatura")
    expect(sliceLabelOf([{ dimension: "REASON", value: "fatura", label: "Fatura" }, { dimension: "HOUR", value: "14", label: "14" }])).toBe("motivo Fatura · faixa das 14h")
  })

  it("segment_indicator por MOTIVO abre recorte REASON pelo canônico do motivo (ou o bruto), como o assunto", () => {
    const data = { dimension: "REASON", total: { averageDurationSeconds: 300 }, buckets: bucketsOf([{ value: "fatura", canonical: "fatura", duration: 420, n: 6 }, { value: "Cobrança", canonical: null, duration: 250, n: 8 }]) }
    const slices = slicesFromToolResult(data, { dimension: "REASON" }, context)
    expect(slices).toHaveLength(1)
    expect(slices[0]!.filters).toEqual([{ dimension: "REASON", value: "fatura", label: "Fatura" }])
    expect(slices[0]!.observation).toBe("motivo Fatura: duração média registrada de 420 s em 6 chamadas, contra 300 s no conjunto do período.")
  })

  it("motivo pedido como filtro de uma segmentação por assunto vira combinação (motivo + assunto)", () => {
    const data = { dimension: "SUBJECT", total: { averageDurationSeconds: 300 }, buckets: bucketsOf([{ value: "segunda_via", canonical: "segunda_via", duration: 480, n: 4 }, { value: "Dúvida", canonical: null, duration: 200, n: 5 }]) }
    const slices = slicesFromToolResult(data, { dimension: "SUBJECT", reason: "fatura" }, context)
    expect(slices[0]!.filters).toEqual([{ dimension: "REASON", value: "fatura", label: "Fatura" }, { dimension: "SUBJECT", value: "segunda_via", label: "Segunda via" }])
  })
})
