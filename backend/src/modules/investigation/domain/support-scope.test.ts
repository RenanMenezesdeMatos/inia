import { describe, expect, it } from "vitest"
import { claimScopeWithin, MAXIMUM_CLAIM_SCOPE_BY_SUPPORT, SUPPORT_SCOPES, supportScopeRank } from "./support-scope.js"
import { supportScopeIndex, TEMPORAL_SUPPORT_SCOPES } from "./temporal-semantics.js"
import { patternSupportOf } from "./interaction-semantic-frame.js"
import { classifyRepresentativeness, REPRESENTATIVE_ABSOLUTE_SAMPLE } from "./evidence-representativeness.js"
import { detectPermanentTraitLanguage } from "./evidence-gating.js"

describe("V1.4.2 — SUPPORT SCOPE (§8–§10, §16): taxonomia única de amplitude", () => {
  it("a ordem é crescente e o escopo temporal (SAMPLE/RECORDED_UNIVERSE/EMPLOYEE_PATTERN) é um subconjunto dela — mesma comparação, sem rewrite", () => {
    expect(SUPPORT_SCOPES).toEqual(["SAMPLE", "PERIOD", "RECORDED_UNIVERSE", "EMPLOYEE_PATTERN"])
    for (const scope of TEMPORAL_SUPPORT_SCOPES) expect(SUPPORT_SCOPES).toContain(scope)
    expect(supportScopeIndex("SAMPLE")).toBeLessThan(supportScopeIndex("RECORDED_UNIVERSE"))
    expect(supportScopeIndex("RECORDED_UNIVERSE")).toBeLessThan(supportScopeIndex("EMPLOYEE_PATTERN"))
    expect(supportScopeRank("PERIOD")).toBeGreaterThan(supportScopeRank("SAMPLE"))
  })

  it("cada escopo de suporte tem um teto de claim: SAMPLE → interações analisadas; PERIOD/RECORDED_UNIVERSE → período; só EMPLOYEE_PATTERN → padrão do colaborador", () => {
    expect(MAXIMUM_CLAIM_SCOPE_BY_SUPPORT).toEqual({ SAMPLE: "INTERACTION_SPECIFIC", PERIOD: "PERIOD_PATTERN", RECORDED_UNIVERSE: "PERIOD_PATTERN", EMPLOYEE_PATTERN: "EMPLOYEE_PATTERN" })
    expect(claimScopeWithin("PERIOD_PATTERN", "PERIOD_PATTERN")).toBe(true)
    expect(claimScopeWithin("EMPLOYEE_PATTERN", "PERIOD_PATTERN")).toBe(false)
    expect(claimScopeWithin("INTERACTION_SPECIFIC", "PERIOD_PATTERN")).toBe(true)
    // POPULATION é outra dimensão (pares) — nunca liberada por um teto de INTERACTION_SPECIFIC.
    expect(claimScopeWithin("POPULATION_PATTERN", "INTERACTION_SPECIFIC")).toBe(false)
    expect(claimScopeWithin("POPULATION_PATTERN", "PERIOD_PATTERN")).toBe(true)
  })
})

describe("V1.4.3 — calibração do escopo (§19–§29): o 30 volta a ser teto de AMOSTRA, não piso de universo", () => {
  it("§29 fixtures genéricas A–E", () => {
    // A) 2 de 8 (universo 30): sem recorrência → SAMPLE, claim só nas interações analisadas.
    expect(patternSupportOf({ matchedTranscriptCount: 2, analyzedTranscriptCount: 8, recordedUniverseCount: 30, bucketsMatched: 2, bucketCount: 3 })).toMatchObject({ level: "REPEATED_IN_SAMPLE", scope: "SAMPLE", maximumClaimScope: "INTERACTION_SPECIFIC" })
    // B) 4 de 6 com o universo COMPLETO da janela analisado → fato exaustivo do período (RECORDED_UNIVERSE), teto PERIOD.
    expect(patternSupportOf({ matchedTranscriptCount: 4, analyzedTranscriptCount: 6, recordedUniverseCount: 6, bucketsMatched: 2, bucketCount: 3 })).toMatchObject({ level: "RECURRENT_IN_SAMPLE", scope: "RECORDED_UNIVERSE", maximumClaimScope: "PERIOD_PATTERN" })
    // C) 8 de 30 (26,7 %), representativa, recorrente em vários blocos → EMPLOYEE não é negado só porque 8 < 30 (§26).
    expect(patternSupportOf({ matchedTranscriptCount: 5, analyzedTranscriptCount: 8, recordedUniverseCount: 30, bucketsMatched: 3, bucketCount: 3 })).toMatchObject({ level: "EMPLOYEE_PATTERN_SUPPORTED", scope: "EMPLOYEE_PATTERN", maximumClaimScope: "EMPLOYEE_PATTERN" })
    // D) volume alto num único bloco → recorrência não é longitudinal (§24): PERIOD.
    expect(patternSupportOf({ matchedTranscriptCount: 12, analyzedTranscriptCount: 20, recordedUniverseCount: 60, bucketsMatched: 1, bucketCount: 3 })).toMatchObject({ level: "RECURRENT_IN_SAMPLE", scope: "PERIOD", maximumClaimScope: "PERIOD_PATTERN" })
    // E) evidência forte, representativa, recorrente e multi-bloco → EMPLOYEE possível (o escopo não é decorativo).
    expect(patternSupportOf({ matchedTranscriptCount: 18, analyzedTranscriptCount: 25, recordedUniverseCount: 90, bucketsMatched: 3, bucketCount: 3 })).toMatchObject({ level: "EMPLOYEE_PATTERN_SUPPORTED", scope: "EMPLOYEE_PATTERN" })
  })

  it("§20/§26 o 30 não é piso de universo: amostras abaixo dele sustentam EMPLOYEE quando a representatividade existente autoriza", () => {
    // 5 de 8 com universo 20 (40 % de cobertura, amostra ≥ 5) — representativa pela regra de sempre.
    expect(classifyRepresentativeness(8, 20)).toBe("REPRESENTATIVE")
    expect(patternSupportOf({ matchedTranscriptCount: 5, analyzedTranscriptCount: 8, recordedUniverseCount: 20, bucketsMatched: 2, bucketCount: 3 })).toMatchObject({ scope: "EMPLOYEE_PATTERN" })
    // Amostra anedótica (8 de 100 = 8 %) continua SAMPLE, como sempre foi — a fonte é classifyRepresentativeness (§23).
    expect(classifyRepresentativeness(8, 100)).toBe("ANECDOTAL")
    expect(patternSupportOf({ matchedTranscriptCount: 5, analyzedTranscriptCount: 8, recordedUniverseCount: 100, bucketsMatched: 3, bucketCount: 3 })).toMatchObject({ scope: "SAMPLE", maximumClaimScope: "INTERACTION_SPECIFIC" })
    // O papel legítimo do 30 (V1.2): amostra absoluta dispensa a fração do universo — inclusive com universo desconhecido.
    expect(REPRESENTATIVE_ABSOLUTE_SAMPLE).toBe(30)
    expect(classifyRepresentativeness(30, 1267)).toBe("REPRESENTATIVE")
    expect(patternSupportOf({ matchedTranscriptCount: 20, analyzedTranscriptCount: 30, recordedUniverseCount: null, bucketsMatched: 2, bucketCount: 3 })).toMatchObject({ scope: "EMPLOYEE_PATTERN" })
  })

  it("§27 EMPLOYEE não é traço eterno: linguagem de atributo permanente é rejeitada em qualquer escopo", () => {
    expect(detectPermanentTraitLanguage("No período analisado, o colaborador apresentou um padrão recorrente de interrupções")).toEqual([])
    expect(detectPermanentTraitLanguage("o colaborador é impaciente com os clientes").length).toBe(1)
    expect(detectPermanentTraitLanguage("você é assim por natureza").length).toBeGreaterThan(0)
    expect(detectPermanentTraitLanguage("sempre foi um profissional detalhista").length).toBe(1)
  })
})
