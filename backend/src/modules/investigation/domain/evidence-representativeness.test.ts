import { describe, expect, it } from "vitest"
import { assessLedgerRepresentativeness, assessRepresentativeness, classifyRepresentativeness } from "./evidence-representativeness.js"
import type { LedgerEntry } from "./evidence-ledger.js"

const entry = (ref: string, tool: string, sampleCount: number | null, qualityStatus = "SUFFICIENT"): LedgerEntry => ({ ref, sequence: 1, round: 1, tool, capability: "x", keyArgs: "", summary: "", qualityStatus, qualityNote: null, sampleCount, periodLabel: null, preflight: false })

describe("representatividade da evidência de interação (determinística)", () => {
  it("classifica por amostra analisada × universo do período × amostra mínima", () => {
    expect(classifyRepresentativeness(0, 1267)).toBe("INSUFFICIENT")
    expect(classifyRepresentativeness(2, 1267)).toBe("ANECDOTAL") // Mariana: 2 de 1.267
    expect(classifyRepresentativeness(4, null)).toBe("ANECDOTAL") // abaixo da amostra mínima
    expect(classifyRepresentativeness(8, 10)).toBe("REPRESENTATIVE") // 80% do universo
    expect(classifyRepresentativeness(8, 100)).toBe("ANECDOTAL") // 8% do universo
    expect(classifyRepresentativeness(8, null)).toBe("REPRESENTATIVE") // universo desconhecido: amostra mínima basta
    expect(classifyRepresentativeness(40, 1267)).toBe("REPRESENTATIVE") // amostra absoluta
  })

  it("avalia só fatos de interação/transcrição do ledger; pares ignoram o universo do colaborador; NO_DATA = insuficiente", () => {
    const ledger = [entry("F1", "get_indicator_snapshot", 21), entry("F2", "find_interactions", 2), entry("F3", "analyze_interactions", 2), entry("F4", "analyze_peer_patterns", 8), entry("F5", "analyze_interactions", 0, "NO_DATA")]
    expect(assessLedgerRepresentativeness(ledger, 1267).map(({ ref, tool, analyzed, universe, level }) => ({ ref, tool, analyzed, universe, level }))).toEqual([
      { ref: "F2", tool: "find_interactions", analyzed: 2, universe: 1267, level: "ANECDOTAL" },
      { ref: "F3", tool: "analyze_interactions", analyzed: 2, universe: 1267, level: "ANECDOTAL" },
      { ref: "F4", tool: "analyze_peer_patterns", analyzed: 8, universe: null, level: "REPRESENTATIVE" },
      { ref: "F5", tool: "analyze_interactions", analyzed: 0, universe: 1267, level: "INSUFFICIENT" },
    ])
  })

  // V1.3 (§5/6/52): universo REGISTRADO ≠ universo OPERACIONAL — cobertura operacional nunca é inferida.
  it("2 de 2 registradas: cobertura registrada 100%, operacional não determinada (UNKNOWN) e continua anedótica", () => {
    const result = assessRepresentativeness({ analyzed: 2, recordedUniverse: 2, operational: { count: 1267, source: "get_indicator_snapshot", label: "contatos" } })
    expect(result.recordedCoverage).toBe(1)
    expect(result.operationalCoverage).toBeNull()
    expect(result.universeRelationship).toBe("UNKNOWN")
    expect(result.classification).toBe("ANECDOTAL")
    expect(result.reason).toContain("cobertura operacional não determinada")
  })

  it("30 de 30 registradas com 1.267 contatos: 100% do registrado ≠ 100% do operacional, mas a amostra absoluta basta", () => {
    const result = assessRepresentativeness({ analyzed: 30, recordedUniverse: 30, operational: { count: 1267, source: "get_indicator_snapshot", label: "contatos" } })
    expect(result.recordedCoverage).toBe(1)
    expect(result.operationalCoverage).toBeNull()
    expect(result.classification).toBe("REPRESENTATIVE")
  })

  it("10 de 10 registradas frente a 1.267 contatos não vinculados: rebaixada a ANECDOTAL (cobrir o registrado não prova cobrir o operacional)", () => {
    const result = assessRepresentativeness({ analyzed: 10, recordedUniverse: 10, operational: { count: 1267, source: "get_indicator_snapshot", label: "contatos" } })
    expect(result.classification).toBe("ANECDOTAL")
    expect(result.reason).toContain("rebaixada")
  })

  it("universos iguais = EXACT com cobertura operacional determinada; sem universo operacional a classificação da V1.2 permanece", () => {
    const exact = assessRepresentativeness({ analyzed: 8, recordedUniverse: 10, operational: { count: 10, source: "get_indicator_snapshot", label: "contatos" } })
    expect(exact.universeRelationship).toBe("EXACT")
    expect(exact.operationalCoverage).toBe(0.8)
    expect(exact.classification).toBe("REPRESENTATIVE")
    const unknown = assessRepresentativeness({ analyzed: 8, recordedUniverse: 10, operational: null })
    expect(unknown.universeRelationship).toBe("UNKNOWN")
    expect(unknown.operationalUniverseCount).toBeNull()
    expect(unknown.classification).toBe("REPRESENTATIVE")
  })
})
