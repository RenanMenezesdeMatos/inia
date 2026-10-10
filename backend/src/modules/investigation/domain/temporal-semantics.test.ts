import { describe, expect, it } from "vitest"
import { gateSynthesis, parseSynthesisFields } from "./evidence-gating.js"
import type { LedgerEntry } from "./evidence-ledger.js"
import { absenceEstablishedBy, bucketCountsOf, bucketIndexOf, checkTemporalConclusionCompatibility, consolidatedTemporalStatus, detectChangeLanguage, detectStabilityLanguage, detectTemporalLanguage, foldTemporalClaims, emptyTemporalTelemetry, gateTemporalClaim, positionClaimedBy, renderTemporalBuckets, renderTemporalConclusion, temporalBucketsOf, temporalConclusionOf, temporalConclusionOfLedger, temporalFactsOf, temporalPositionOf, temporalSupportScopeOf, TEMPORAL_SAFE_MEANINGS, validateTemporalComparison, type BucketFindingCounts, type TemporalComparisonSignalFinding, type TemporalFact } from "./temporal-semantics.js"

const period = { start: new Date("2026-06-01T03:00:00Z"), end: new Date("2026-09-01T03:00:00Z") }
const label = (date: Date) => date.toLocaleDateString("sv-SE", { timeZone: "America/Fortaleza" })
const buckets = temporalBucketsOf(period, 3, label)
const entry = (ref: string, tool: string, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({ ref, sequence: Number(ref.slice(1)), round: 1, tool, capability: tool.includes("interaction") || tool.startsWith("analyze") ? "INTERACTION_ANALYSIS" : "INDICATOR_ANALYSIS", keyArgs: "", summary: "s", qualityStatus: "SUFFICIENT", qualityNote: null, sampleCount: 8, periodLabel: null, preflight: false, ...extra })
const comparisonEntry = (status: "DIFFERENCE_OBSERVED" | "SAMPLE_DIFFERENCE_ONLY" | "NO_DIFFERENCE_SUPPORTED", findings: TemporalComparisonSignalFinding[] = [], compared = ["B1", "B3"], analyzedBuckets = ["B1", "B2", "B3"]) =>
  // V1.4.1: as fixtures V1.3.4.x representam relações com cobertura plena (escopo EMPLOYEE_PATTERN); o escopo é explicitado nos testes novos.
  entry("F3", "analyze_interactions", { signals: { temporalCoverage: { buckets: 3, bucketsCovered: 3 }, temporalComparison: { status, comparedBuckets: compared, behavioral: true, findings: findings.map((finding) => ({ supportScope: "EMPLOYEE_PATTERN" as const, ...finding })), analyzedBuckets, bucketCount: 3 } } })
const facts = (...ledger: LedgerEntry[]): TemporalFact[] => temporalFactsOf(ledger)

describe("posição temporal vem da aplicação (§3/§4/§43) — blocos em dias locais inteiros (V1.3.4.1 §17/§18)", () => {
  it("blocos iguais da janela com datas locais INCLUSIVAS e sem sobreposição visual; a posição de uma data é calculada, nunca inferida", () => {
    expect(buckets.map((bucket) => `${bucket.ref}:${bucket.from}..${bucket.to}:${bucket.relativePosition}`)).toEqual(["B1:2026-06-01..2026-06-30:FIRST", "B2:2026-07-01..2026-07-31:MIDDLE", "B3:2026-08-01..2026-08-31:LAST"])
    expect(temporalPositionOf(new Date("2026-07-28T18:37:36Z"), period, 3, label)).toEqual({ localDate: "2026-07-28", bucketRef: "B2", bucketIndex: 1, bucketCount: 3, relativePosition: "MIDDLE" })
    expect(temporalPositionOf(new Date("2026-06-03T12:00:00Z"), period, 3, label)?.relativePosition).toBe("FIRST")
    expect(temporalPositionOf(new Date("2026-08-30T12:00:00Z"), period, 3, label)?.relativePosition).toBe("LAST")
    expect(temporalPositionOf(new Date("2026-09-05T12:00:00Z"), period, 3, label)).toBeNull()
    // Janela curta = um bloco: não existe início/meio/fim.
    expect(temporalPositionOf(new Date("2026-06-15T12:00:00Z"), { start: period.start, end: new Date("2026-07-01T03:00:00Z") }, 1, label)?.relativePosition).toBe("SINGLE")
    expect(bucketIndexOf(new Date("2026-08-31T23:00:00Z"), period, 3, label)).toBe(2)
    expect(renderTemporalBuckets(buckets)).toContain("B1 = 2026-06-01 a 2026-06-30 (início da janela) · B2 = 2026-07-01 a 2026-07-31 (meio da janela) · B3 = 2026-08-01 a 2026-08-31 (fim da janela)")
    expect(renderTemporalBuckets(buckets)).toContain("a ordem das interações no texto NÃO indica tempo")
    expect(renderTemporalBuckets(buckets.slice(0, 1))).toBe("")
  })

  it("§18 boundary: o dia local 01/07 pertence a UM único bloco (B2) — 23:59:59 local de 30/06 ainda é B1; virada de mês/ano e legenda sem intervalos sobrepostos", () => {
    expect(temporalPositionOf(new Date("2026-07-01T03:00:00Z"), period, 3, label)?.bucketRef).toBe("B2") // 00:00 local de 01/07
    expect(temporalPositionOf(new Date("2026-07-01T02:59:59Z"), period, 3, label)?.bucketRef).toBe("B1") // 23:59:59 local de 30/06
    expect(temporalPositionOf(new Date("2026-07-01T23:00:00Z"), period, 3, label)?.bucketRef).toBe("B2")
    expect(temporalPositionOf(new Date("2026-08-01T03:00:00Z"), period, 3, label)?.bucketRef).toBe("B3")
    expect(temporalPositionOf(new Date("2026-06-01T03:00:00Z"), period, 3, label)?.bucketRef).toBe("B1")
    expect(temporalPositionOf(new Date("2026-06-01T02:59:59Z"), period, 3, label)).toBeNull() // antes da janela
    for (const bucket of buckets) expect(bucket.from <= bucket.to).toBe(true)
    for (let index = 1; index < buckets.length; index += 1) expect(buckets[index]!.from > buckets[index - 1]!.to).toBe(true)
    // Virada de ano: dez/jan/fev — cada data local em exatamente um bloco, rótulos contíguos.
    const winter = { start: new Date("2025-12-01T03:00:00Z"), end: new Date("2026-03-01T03:00:00Z") }
    const winterBuckets = temporalBucketsOf(winter, 3, label)
    expect(winterBuckets.map((bucket) => `${bucket.from}..${bucket.to}`)).toEqual(["2025-12-01..2025-12-30", "2025-12-31..2026-01-29", "2026-01-30..2026-02-28"])
    expect(temporalPositionOf(new Date("2025-12-31T03:00:00Z"), winter, 3, label)?.bucketRef).toBe("B2")
    expect(temporalPositionOf(new Date("2025-12-31T02:59:59Z"), winter, 3, label)?.bucketRef).toBe("B1")
    expect(temporalPositionOf(new Date("2026-01-01T03:00:00Z"), winter, 3, label)?.bucketRef).toBe("B2")
    // Cada dia da janela cai em exatamente um bloco (varredura dia a dia).
    const seen = new Map<string, string>()
    for (let day = new Date(period.start.getTime()); day < period.end; day = new Date(day.getTime() + 24 * 60 * 60 * 1000)) {
      const position = temporalPositionOf(day, period, 3, label)!
      expect(seen.get(position.localDate) ?? position.bucketRef).toBe(position.bucketRef)
      seen.set(position.localDate, position.bucketRef)
      expect(position.localDate >= buckets[position.bucketIndex]!.from && position.localDate <= buckets[position.bucketIndex]!.to).toBe(true)
    }
    expect(seen.size).toBe(92)
  })
})

describe("léxico de relação temporal de PERÍODO (rede de segurança — a metadata é o contrato)", () => {
  it("captura posição/mudança de período e ignora eventos dentro da chamada, 'deixou de informar' e 'acompanhar a evolução'", () => {
    expect(detectTemporalLanguage("Em interações do início do trimestre sua abordagem era informal; houve uma transição clara para um modelo técnico.")).toEqual(["início do trimestre", "houve uma transição"])
    expect(detectTemporalLanguage("Nas interações iniciais (I10 e I11) você adotava uma abordagem informal.")).toEqual(["interações iniciais"])
    expect(detectTemporalLanguage("Você passou a informar o protocolo nas interações mais recentes.")).toEqual(["interações mais recentes", "passou a"])
    expect(detectTemporalLanguage("O comportamento permaneceu estável entre junho e agosto.")).toEqual(["permaneceu estável"])
    expect(detectTemporalLanguage("No início da chamada você validou o CPF; o cliente ficou cada vez mais irritado e você passou a explicar.")).toEqual([])
    expect(detectTemporalLanguage("Em 2 das 8 interações você deixou de informar o protocolo.")).toEqual([])
    expect(detectTemporalLanguage("Recomendo acompanhar a evolução nos próximos meses; a chamada ocorreu em 28/07.")).toEqual([])
    // V1.3.4.1: ausência NO PERÍODO e concentração num momento são relação; fato de amostra não é.
    expect(detectTemporalLanguage("O comportamento deixou de ocorrer em agosto.")).toEqual(["deixou de ocorrer"])
    expect(detectTemporalLanguage("A prática ficou concentrada no início do período.")).toEqual(["início do período", "concentrada no início"])
    expect(detectTemporalLanguage("O padrão apareceu em 2 das 3 interações analisadas de junho e não apareceu nas 3 analisadas de agosto.")).toEqual([])
    expect(detectTemporalLanguage("Observado apenas na amostra analisada de B1.")).toEqual([])
    expect(positionClaimedBy("no início do período")).toBe("FIRST")
    expect(positionClaimedBy("nas interações mais recentes")).toBe("LAST")
    expect(positionClaimedBy("no meio do trimestre")).toBe("MIDDLE")
    expect(positionClaimedBy("na chamada")).toBeNull()
  })
})

describe("contagens por bloco e validação da comparação declarada (§11/§13/§14; V1.3.4.1 §5–§14)", () => {
  const analyzed = [{ interactionRef: "I1", bucketRef: "B1" }, { interactionRef: "I2", bucketRef: "B1" }, { interactionRef: "I3", bucketRef: "B1" }, { interactionRef: "I4", bucketRef: "B2" }, { interactionRef: "I5", bucketRef: "B3" }, { interactionRef: "I6", bucketRef: "B3" }, { interactionRef: "I7", bucketRef: "B3" }]
  const findings = [{ verifiedExcerpts: [{ interactionRef: "I1" }, { interactionRef: "I2" }, { interactionRef: "I5" }] }, { verifiedExcerpts: [{ interactionRef: "I4" }] }]
  const counts = bucketCountsOf(findings, analyzed, buckets, { B1: 12, B2: 12, B3: 12 })

  it("contagens determinísticas por achado × bloco (matched, excerpts, participação na amostra, universo, cobertura, zero na amostra × ausência estabelecida)", () => {
    expect(counts.analyzedByBucket).toEqual({ B1: 3, B2: 1, B3: 3 })
    expect(counts.countsByFinding[0]!.map((count) => `${count.bucketRef}:${count.matchedTranscriptCount}/${count.analyzedTranscriptCount}=${count.matchedShareOfAnalyzedPercent}`)).toEqual(["B1:2/3=66.7", "B2:0/1=0", "B3:1/3=33.3"])
    expect(counts.countsByFinding[0]![1]).toMatchObject({ universeCount: 12, coveragePercent: 8.3, zeroMatchedInSample: true, absenceEstablished: false })
    expect(counts.countsByFinding[1]![0]).toMatchObject({ zeroMatchedInSample: true, absenceEstablished: false })
    // Universo desconhecido: nunca ausência.
    expect(bucketCountsOf(findings, analyzed, buckets).countsByFinding[1]![0]).toMatchObject({ universeCount: null, coveragePercent: null, absenceEstablished: false })
  })

  it("§6 regra determinística de ausência: cobertura total, ou amostra ≥ 5 cobrindo ≥ 50 % do universo — nunca com match, nunca sem universo", () => {
    expect(absenceEstablishedBy(3, 0, 3)).toBe(true)
    expect(absenceEstablishedBy(3, 0, 20)).toBe(false)
    expect(absenceEstablishedBy(5, 0, 10)).toBe(true)
    expect(absenceEstablishedBy(5, 0, 11)).toBe(false)
    expect(absenceEstablishedBy(4, 0, 4)).toBe(true)
    expect(absenceEstablishedBy(4, 0, 6)).toBe(false)
    expect(absenceEstablishedBy(3, 1, 3)).toBe(false)
    expect(absenceEstablishedBy(3, 0, null)).toBe(false)
    expect(absenceEstablishedBy(0, 0, 0)).toBe(false)
  })

  it("direção declarada é conferida contra as contagens; blocos fora de ordem/inexistentes e refs de outros blocos caem; status só é rebaixado, nunca promovido", () => {
    const valid = validateTemporalComparison({ status: "DIFFERENCE_OBSERVED", comparedBuckets: ["B1", "B3"], findings: [{ relation: "DECREASED", subjectFindingIndex: 0, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: ["I1", "I5", "I4"] }] }, 2, counts, analyzed, buckets)
    expect(valid.status).toBe("DIFFERENCE_OBSERVED")
    expect(valid.findings[0]).toMatchObject({ directionSupported: true, relationValidationStatus: "SUPPORTED", sampleDifference: true, shareDeltaPercentagePoints: -33.4, evidenceRefs: ["I1", "I5"] })
    expect(valid).toMatchObject({ analyzedBuckets: ["B1", "B2", "B3"], bucketCount: 3 })
    const wrongDirection = validateTemporalComparison({ status: "DIFFERENCE_OBSERVED", comparedBuckets: ["B1", "B3"], findings: [{ relation: "INCREASED", subjectFindingIndex: 0, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: [] }] }, 2, counts, analyzed, buckets)
    expect(wrongDirection).toMatchObject({ status: "INSUFFICIENT_EVIDENCE", downgradedReason: "nenhuma relação declarada é sustentada pelas contagens validadas" })
    expect(wrongDirection.findings[0]).toMatchObject({ directionSupported: false, relationValidationStatus: "UNSUPPORTED" })
    const reversed = validateTemporalComparison({ status: "DIFFERENCE_OBSERVED", comparedBuckets: ["B1", "B3"], findings: [{ relation: "DECREASED", subjectFindingIndex: 0, earlierBucket: "B3", laterBucket: "B1", evidenceRefs: [] }, { relation: "STABLE", subjectFindingIndex: 7, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: [] }] }, 2, counts, analyzed, buckets)
    expect(reversed.findings.map((finding) => finding.note)).toEqual(["blocos inválidos (inexistentes ou fora de ordem) ou achado inexistente", "blocos inválidos (inexistentes ou fora de ordem) ou achado inexistente"])
    const noDifference = validateTemporalComparison({ status: "NO_DIFFERENCE_SUPPORTED", comparedBuckets: ["B1", "B2", "B3"], findings: [] }, 2, counts, analyzed, buckets)
    expect(noDifference).toMatchObject({ status: "NO_DIFFERENCE_SUPPORTED", comparedBuckets: ["B1", "B2", "B3"], downgradedReason: null })
    const oneBucket = validateTemporalComparison({ status: "DIFFERENCE_OBSERVED", comparedBuckets: ["B1"], findings: [] }, 2, counts, analyzed, buckets)
    expect(oneBucket).toMatchObject({ status: "INSUFFICIENT_EVIDENCE", downgradedReason: "menos de dois blocos comparados com transcrição analisada" })
    expect(validateTemporalComparison(null, 2, counts, analyzed, buckets).status).toBe("INSUFFICIENT_EVIDENCE")
    // §14: as participações são da AMOSTRA de cada bloco (2/3, 1/3) — nunca viram "caiu de 66% para 33% no período".
    expect(valid.countsByFinding[0]![0]!.matchedShareOfAnalyzedPercent).toBe(66.7)
  })

  // Cenários V1.3.4.1: B1 2/3, B3 0/3 (universo 20 → parcial; universo 3 → cobertura total).
  const zeroLater = (universeB3: number, analyzedB3 = 3) => {
    const sample = [{ interactionRef: "I1", bucketRef: "B1" }, { interactionRef: "I2", bucketRef: "B1" }, { interactionRef: "I3", bucketRef: "B1" }, { interactionRef: "I4", bucketRef: "B2" }, { interactionRef: "I8", bucketRef: "B2" }, ...Array.from({ length: analyzedB3 }, (_, index) => ({ interactionRef: `I${5 + index}`, bucketRef: "B3" }))]
    const found = [{ verifiedExcerpts: [{ interactionRef: "I1" }, { interactionRef: "I2" }, { interactionRef: "I4" }] }, { verifiedExcerpts: [{ interactionRef: "I5" }, { interactionRef: "I6" }] }]
    return { sample, counts: bucketCountsOf(found, sample, buckets, { B1: 12, B2: 12, B3: universeB3 }) }
  }

  it("§20 CHANGED parcial: B1 2/3 × B3 0/3 com universo B3 = 20 → SAMPLE_DIFFERENCE_ONLY (zero na amostra ≠ ausência), status rebaixado; §21 cobertura total (universo B3 = 3) → SUPPORTED", () => {
    const partial = zeroLater(20)
    const declared = { status: "DIFFERENCE_OBSERVED" as const, comparedBuckets: ["B1", "B3"], findings: [{ relation: "DECREASED" as const, subjectFindingIndex: 0, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: ["I1", "I2"] }, { relation: "CHANGED" as const, subjectFindingIndex: 0, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: [] }] }
    const result = validateTemporalComparison(declared, 2, partial.counts, partial.sample, buckets)
    expect(result.status).toBe("SAMPLE_DIFFERENCE_ONLY")
    expect(result.downgradedReason).toContain("zero na amostra não é ausência")
    expect(result.findings.map((finding) => finding.relationValidationStatus)).toEqual(["SAMPLE_DIFFERENCE_ONLY", "SAMPLE_DIFFERENCE_ONLY"])
    expect(result.findings[0]).toMatchObject({ directionSupported: false, sampleDifference: true, shareDeltaPercentagePoints: -66.7 })
    expect(result.findings[0]!.relationValidationReason).toBe("B3 0 de 3 analisada(s) (universo 20) — ausência não estabelecida")
    expect(partial.counts.countsByFinding[0]![2]).toMatchObject({ zeroMatchedInSample: true, absenceEstablished: false, coveragePercent: 15 })
    const full = zeroLater(3)
    const supported = validateTemporalComparison(declared, 2, full.counts, full.sample, buckets)
    expect(supported.status).toBe("DIFFERENCE_OBSERVED")
    expect(supported.findings.map((finding) => finding.relationValidationStatus)).toEqual(["SUPPORTED", "SUPPORTED"])
    expect(full.counts.countsByFinding[0]![2]).toMatchObject({ zeroMatchedInSample: true, absenceEstablished: true, coveragePercent: 100 })
    // Amostra de 1 (sem ser o universo) não é comparável.
    const single = zeroLater(20, 1)
    expect(validateTemporalComparison(declared, 2, single.counts, single.sample, buckets).findings[0]!.relationValidationReason).toContain("amostra não comparável")
  })

  it("§22 TREND: INCREASED/DECREASED sustentado só nos extremos (B2 sem dado ou fora do sentido) NÃO é tendência; 3 momentos ordenados no mesmo sentido são", () => {
    const sample = [{ interactionRef: "I1", bucketRef: "B1" }, { interactionRef: "I2", bucketRef: "B1" }, { interactionRef: "I3", bucketRef: "B1" }, { interactionRef: "I5", bucketRef: "B3" }, { interactionRef: "I6", bucketRef: "B3" }, { interactionRef: "I7", bucketRef: "B3" }]
    const found = [{ verifiedExcerpts: [{ interactionRef: "I1" }, { interactionRef: "I2" }, { interactionRef: "I3" }, { interactionRef: "I5" }] }]
    const noMiddle = validateTemporalComparison({ status: "DIFFERENCE_OBSERVED", comparedBuckets: ["B1", "B3"], findings: [{ relation: "DECREASED", subjectFindingIndex: 0, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: [] }] }, 1, bucketCountsOf(found, sample, buckets, { B1: 12, B2: 12, B3: 12 }), sample, buckets)
    expect(noMiddle.findings[0]).toMatchObject({ relationValidationStatus: "SUPPORTED", trendSupported: false })
    const withMiddle = [...sample, { interactionRef: "I4", bucketRef: "B2" }, { interactionRef: "I8", bucketRef: "B2" }]
    const monotone = validateTemporalComparison({ status: "DIFFERENCE_OBSERVED", comparedBuckets: ["B1", "B2", "B3"], findings: [{ relation: "DECREASED", subjectFindingIndex: 0, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: [] }] }, 1, bucketCountsOf([{ verifiedExcerpts: [...found[0]!.verifiedExcerpts, { interactionRef: "I4" }] }], withMiddle, buckets, { B1: 12, B2: 12, B3: 12 }), withMiddle, buckets)
    expect(monotone.findings[0]).toMatchObject({ relationValidationStatus: "SUPPORTED", trendSupported: true }) // 100% → 50% → 33%
    const bump = validateTemporalComparison({ status: "DIFFERENCE_OBSERVED", comparedBuckets: ["B1", "B2", "B3"], findings: [{ relation: "DECREASED", subjectFindingIndex: 0, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: [] }] }, 1, bucketCountsOf([{ verifiedExcerpts: [{ interactionRef: "I1" }, { interactionRef: "I2" }, { interactionRef: "I4" }, { interactionRef: "I8" }, { interactionRef: "I5" }] }], withMiddle, buckets, { B1: 12, B2: 12, B3: 12 }), withMiddle, buckets)
    expect(bump.findings[0]).toMatchObject({ relationValidationStatus: "SUPPORTED", trendSupported: false }) // 67% → 100% → 33%: extremos caem, meio sobe
  })

  it("§23 STABLE: B1 ≈ B3 com B2 diferente (achado ausente na amostra de B2) → não sustentado; presente em B1/B2/B3 → SUPPORTED; §26 NO_DIFFERENCE declarado é rebaixado só quando uma ausência ESTABELECIDA o contradiz", () => {
    const sample = [{ interactionRef: "I1", bucketRef: "B1" }, { interactionRef: "I2", bucketRef: "B1" }, { interactionRef: "I4", bucketRef: "B2" }, { interactionRef: "I8", bucketRef: "B2" }, { interactionRef: "I5", bucketRef: "B3" }, { interactionRef: "I6", bucketRef: "B3" }]
    const universe = { B1: 12, B2: 12, B3: 12 }
    const middleDiffers = validateTemporalComparison({ status: "DIFFERENCE_OBSERVED", comparedBuckets: ["B1", "B2", "B3"], findings: [{ relation: "STABLE", subjectFindingIndex: 0, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: [] }] }, 1, bucketCountsOf([{ verifiedExcerpts: [{ interactionRef: "I1" }, { interactionRef: "I5" }] }], sample, buckets, universe), sample, buckets)
    expect(middleDiffers.findings[0]).toMatchObject({ relationValidationStatus: "INSUFFICIENT_EVIDENCE", directionSupported: false })
    expect(middleDiffers.findings[0]!.relationValidationReason).toContain("B2 0 de 2")
    const middleEstablished = validateTemporalComparison({ status: "DIFFERENCE_OBSERVED", comparedBuckets: ["B1", "B2", "B3"], findings: [{ relation: "STABLE", subjectFindingIndex: 0, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: [] }] }, 1, bucketCountsOf([{ verifiedExcerpts: [{ interactionRef: "I1" }, { interactionRef: "I5" }] }], sample, buckets, { B1: 12, B2: 2, B3: 12 }), sample, buckets)
    expect(middleEstablished.findings[0]).toMatchObject({ relationValidationStatus: "UNSUPPORTED" })
    const allPresent = validateTemporalComparison({ status: "DIFFERENCE_OBSERVED", comparedBuckets: ["B1", "B2", "B3"], findings: [{ relation: "STABLE", subjectFindingIndex: 0, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: [] }] }, 1, bucketCountsOf([{ verifiedExcerpts: [{ interactionRef: "I1" }, { interactionRef: "I4" }, { interactionRef: "I5" }] }], sample, buckets, universe), sample, buckets)
    expect(allPresent.findings[0]).toMatchObject({ relationValidationStatus: "SUPPORTED" })
    // B2 nunca analisado numa janela de 3 blocos: estabilidade B1→B3 é INSUFFICIENT (momento intermediário não comparado).
    const noMiddle = sample.filter((item) => item.bucketRef !== "B2")
    const skipped = validateTemporalComparison({ status: "DIFFERENCE_OBSERVED", comparedBuckets: ["B1", "B3"], findings: [{ relation: "STABLE", subjectFindingIndex: 0, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: [] }] }, 1, bucketCountsOf([{ verifiedExcerpts: [{ interactionRef: "I1" }, { interactionRef: "I5" }] }], noMiddle, buckets, universe), noMiddle, buckets)
    expect(skipped.findings[0]!.relationValidationReason).toContain("B2 sem transcrição analisada")
    // §26: NO_DIFFERENCE com contradição ESTABELECIDA (presente em B1, ausência estabelecida em B3 por cobertura total) → INSUFFICIENT; sem cobertura fica como declarado.
    const contradicted = validateTemporalComparison({ status: "NO_DIFFERENCE_SUPPORTED", comparedBuckets: ["B1", "B3"], findings: [] }, 1, bucketCountsOf([{ verifiedExcerpts: [{ interactionRef: "I1" }] }], sample, buckets, { B1: 12, B2: 12, B3: 2 }), sample, buckets)
    expect(contradicted).toMatchObject({ status: "INSUFFICIENT_EVIDENCE" })
    expect(contradicted.downgradedReason).toContain("ausência estabelecida em B3")
    expect(validateTemporalComparison({ status: "NO_DIFFERENCE_SUPPORTED", comparedBuckets: ["B1", "B3"], findings: [] }, 1, bucketCountsOf([{ verifiedExcerpts: [{ interactionRef: "I1" }] }], sample, buckets, universe), sample, buckets).status).toBe("NO_DIFFERENCE_SUPPORTED")
  })

  it("§24 CONCENTRATED: presente só em B1 com zeros frágeis em B2/B3 → SAMPLE_DIFFERENCE_ONLY; com ausência estabelecida nos contrastes → SUPPORTED; presente em dois blocos → UNSUPPORTED", () => {
    const sample = [{ interactionRef: "I1", bucketRef: "B1" }, { interactionRef: "I2", bucketRef: "B1" }, { interactionRef: "I4", bucketRef: "B2" }, { interactionRef: "I8", bucketRef: "B2" }, { interactionRef: "I5", bucketRef: "B3" }, { interactionRef: "I6", bucketRef: "B3" }]
    const found = [{ verifiedExcerpts: [{ interactionRef: "I1" }, { interactionRef: "I2" }] }]
    const declared = { status: "DIFFERENCE_OBSERVED" as const, comparedBuckets: ["B1", "B2", "B3"], findings: [{ relation: "CONCENTRATED" as const, subjectFindingIndex: 0, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: [] }] }
    const fragile = validateTemporalComparison(declared, 1, bucketCountsOf(found, sample, buckets, { B1: 12, B2: 12, B3: 12 }), sample, buckets)
    expect(fragile.status).toBe("SAMPLE_DIFFERENCE_ONLY")
    expect(fragile.findings[0]).toMatchObject({ relationValidationStatus: "SAMPLE_DIFFERENCE_ONLY" })
    expect(fragile.findings[0]!.relationValidationReason).toContain("observado só na amostra de B1")
    const established = validateTemporalComparison(declared, 1, bucketCountsOf(found, sample, buckets, { B1: 12, B2: 2, B3: 2 }), sample, buckets)
    expect(established.findings[0]).toMatchObject({ relationValidationStatus: "SUPPORTED" })
    const spread = validateTemporalComparison(declared, 1, bucketCountsOf([{ verifiedExcerpts: [{ interactionRef: "I1" }, { interactionRef: "I5" }] }], sample, buckets, { B1: 2, B2: 2, B3: 2 }), sample, buckets)
    expect(spread.findings[0]).toMatchObject({ relationValidationStatus: "UNSUPPORTED" })
  })

  it("§25 DIFFERENT_PATTERN: achado A positivo em B1 e achado B positivo em B3 sustentam 'padrões diferentes' sem exigir ausência de A em B3 (contraste declarado ou derivado)", () => {
    const sample = [{ interactionRef: "I1", bucketRef: "B1" }, { interactionRef: "I2", bucketRef: "B1" }, { interactionRef: "I5", bucketRef: "B3" }, { interactionRef: "I6", bucketRef: "B3" }]
    const found = [{ verifiedExcerpts: [{ interactionRef: "I1" }, { interactionRef: "I2" }, { interactionRef: "I5" }] }, { verifiedExcerpts: [{ interactionRef: "I5" }, { interactionRef: "I6" }] }]
    const counted = bucketCountsOf(found, sample, buckets, { B1: 12, B2: 12, B3: 12 })
    const declared = validateTemporalComparison({ status: "DIFFERENCE_OBSERVED", comparedBuckets: ["B1", "B3"], findings: [{ relation: "DIFFERENT_PATTERN", subjectFindingIndex: 0, contrastFindingIndex: 1, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: ["I1", "I6"] }] }, 2, counted, sample, buckets)
    expect(declared.status).toBe("DIFFERENCE_OBSERVED")
    expect(declared.findings[0]).toMatchObject({ relationValidationStatus: "SUPPORTED", contrastFindingIndex: 1 })
    const derived = validateTemporalComparison({ status: "DIFFERENCE_OBSERVED", comparedBuckets: ["B1", "B3"], findings: [{ relation: "DIFFERENT_PATTERN", subjectFindingIndex: 0, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: [] }] }, 2, counted, sample, buckets)
    expect(derived.findings[0]).toMatchObject({ relationValidationStatus: "SUPPORTED", contrastFindingIndex: 1 })
    const noContrast = validateTemporalComparison({ status: "DIFFERENCE_OBSERVED", comparedBuckets: ["B1", "B3"], findings: [{ relation: "DIFFERENT_PATTERN", subjectFindingIndex: 0, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: [] }] }, 1, bucketCountsOf([found[0]!], sample, buckets, null), sample, buckets)
    expect(noContrast.findings[0]).toMatchObject({ relationValidationStatus: "INSUFFICIENT_EVIDENCE" })
  })

  it("status consolidado da execução: DIFFERENCE > NO_DIFFERENCE > SAMPLE_DIFFERENCE_ONLY > INSUFFICIENT — diferença só na amostra nunca vira 'diferença sustentada'", () => {
    const signal = (status: "DIFFERENCE_OBSERVED" | "SAMPLE_DIFFERENCE_ONLY" | "NO_DIFFERENCE_SUPPORTED" | "INSUFFICIENT_EVIDENCE") => ({ status, comparedBuckets: ["B1", "B3"], behavioral: true, findings: [] })
    expect(consolidatedTemporalStatus([signal("SAMPLE_DIFFERENCE_ONLY"), signal("INSUFFICIENT_EVIDENCE")])).toBe("SAMPLE_DIFFERENCE_ONLY")
    expect(consolidatedTemporalStatus([signal("SAMPLE_DIFFERENCE_ONLY"), signal("NO_DIFFERENCE_SUPPORTED")])).toBe("NO_DIFFERENCE_SUPPORTED")
    expect(consolidatedTemporalStatus([signal("DIFFERENCE_OBSERVED"), signal("SAMPLE_DIFFERENCE_ONLY")])).toBe("DIFFERENCE_OBSERVED")
    expect(consolidatedTemporalStatus([])).toBeNull()
    const counts: BucketFindingCounts = { bucketRef: "B1", analyzedTranscriptCount: 3, matchedTranscriptCount: 0, verifiedExcerptCount: 0, matchedShareOfAnalyzedPercent: 0, universeCount: 20, coveragePercent: 15, zeroMatchedInSample: true, absenceEstablished: false }
    expect(counts.zeroMatchedInSample && !counts.absenceEstablished).toBe(true)
  })
})

describe("gating de claims temporais (§16–§19, §37–§45)", () => {
  const behavioralFactDifference = facts(comparisonEntry("DIFFERENCE_OBSERVED", [{ relation: "DECREASED", earlierBucket: "B1", laterBucket: "B3", directionSupported: true }]))
  const behavioralFactNoDifference = facts(comparisonEntry("NO_DIFFERENCE_SUPPORTED"))
  const base = { evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN" as const, behavioral: true, scopeSupported: true }

  it("§37 OBS_V3_1: evidência só de B2 (meio) com claim 'no início do trimestre' → WRONG_TEMPORAL_POSITION; sem metadata → TEMPORAL_RELATION_UNDECLARED", () => {
    const undeclared = gateTemporalClaim({ ...base, text: "No início do trimestre sua abordagem era mais informal", metadata: {} }, { buckets, facts: behavioralFactDifference })
    expect(undeclared).toMatchObject({ temporal: true, ok: false, reason: "TEMPORAL_RELATION_UNDECLARED" })
    const wrongPosition = gateTemporalClaim({ ...base, text: "No início do trimestre sua abordagem era mais informal", metadata: { temporalRelation: "POSITION", evidenceBuckets: ["B2"] } }, { buckets, facts: behavioralFactDifference })
    expect(wrongPosition).toMatchObject({ ok: false, reason: "WRONG_TEMPORAL_POSITION" })
    // §43: B1 = início, B3 = fim — posição coerente com o bloco passa.
    expect(gateTemporalClaim({ ...base, text: "No início do trimestre sua abordagem era mais informal", metadata: { temporalRelation: "POSITION", evidenceBuckets: ["B1"] } }, { buckets, facts: behavioralFactDifference }).ok).toBe(true)
    expect(gateTemporalClaim({ ...base, text: "Nas interações mais recentes você informou o protocolo", metadata: { temporalRelation: "POSITION", evidenceBuckets: ["B3"] } }, { buckets, facts: [] }).ok).toBe(true)
    // Janela de um bloco: não existe início/fim.
    expect(gateTemporalClaim({ ...base, text: "No início do mês…", metadata: { temporalRelation: "POSITION", evidenceBuckets: ["B1"] } }, { buckets: temporalBucketsOf({ start: period.start, end: new Date("2026-07-01T03:00:00Z") }, 1, label), facts: [] })).toMatchObject({ ok: false, reason: "INSUFFICIENT_BUCKETS" })
  })

  it("§38 transição sem relação estruturada entre blocos distintos → rejeitada; §39 mudança entre B1 e B3 com fato comparativo validado → aceita", () => {
    const sameBucket = gateTemporalClaim({ ...base, text: "Houve uma transição clara para um modelo técnico ao longo do período", metadata: { temporalRelation: "CHANGE", evidenceBuckets: ["B2"] } }, { buckets, facts: behavioralFactDifference })
    expect(sameBucket).toMatchObject({ ok: false, reason: "INSUFFICIENT_BUCKETS" })
    const noFact = gateTemporalClaim({ ...base, text: "Houve uma transição clara", metadata: { temporalRelation: "CHANGE", evidenceBuckets: ["B1", "B3"] }, evidenceRefs: ["F9"] }, { buckets, facts: behavioralFactDifference })
    expect(noFact).toMatchObject({ ok: false, reason: "NO_COMPARATIVE_EVIDENCE" })
    const trueChange = gateTemporalClaim({ ...base, text: "Houve mudança entre o primeiro e o último mês", metadata: { temporalRelation: "CHANGE", evidenceBuckets: ["B1", "B3"] } }, { buckets, facts: behavioralFactDifference })
    expect(trueChange).toMatchObject({ temporal: true, ok: true })
    // Fato que compara B1×B2 não cobre claim sobre B1×B3.
    const partial = gateTemporalClaim({ ...base, text: "Houve mudança entre o primeiro e o último mês", metadata: { temporalRelation: "CHANGE", evidenceBuckets: ["B1", "B3"] } }, { buckets, facts: facts(comparisonEntry("DIFFERENCE_OBSERVED", [{ relation: "DECREASED", earlierBucket: "B1", laterBucket: "B2", directionSupported: true }], ["B1", "B2"])) })
    expect(partial).toMatchObject({ ok: false, reason: "NO_COMPARATIVE_EVIDENCE" })
  })

  it("§40 estabilidade também exige comparação; V1.3.4.2 §4/§11/§39: 'nenhuma diferença sustentada' NÃO é estabilidade — STABILITY só com relação STABLE SUSTENTADA em todos os momentos; direção contrária ao fato → UNSUPPORTED_DIRECTION", () => {
    const noDifferenceAll = facts(comparisonEntry("NO_DIFFERENCE_SUPPORTED", [], ["B1", "B2", "B3"]))
    expect(gateTemporalClaim({ ...base, text: "O comportamento permaneceu estável", metadata: { temporalRelation: "STABILITY", evidenceBuckets: ["B1"] } }, { buckets, facts: noDifferenceAll })).toMatchObject({ ok: false, reason: "INSUFFICIENT_BUCKETS" })
    // V1.3.4.2: NO_DIFFERENCE em todos os momentos, sem relação STABLE sustentada → incompatível com "permaneceu estável" (só a formulação segura).
    expect(gateTemporalClaim({ ...base, text: "O comportamento permaneceu estável", metadata: { temporalRelation: "STABILITY", evidenceBuckets: ["B1", "B2", "B3"] } }, { buckets, facts: noDifferenceAll })).toMatchObject({ ok: false, reason: "TEMPORAL_CONCLUSION_INCOMPATIBLE", detail: expect.stringContaining("Não foi encontrada diferença temporal sustentada") })
    // §39 STABILITY validada (relação STABLE SUPPORTED pela regra específica) → pode ser expressa.
    const stableSupported = facts(comparisonEntry("NO_DIFFERENCE_SUPPORTED", [{ relation: "STABLE", earlierBucket: "B1", laterBucket: "B3", directionSupported: true, relationValidationStatus: "SUPPORTED" }], ["B1", "B2", "B3"]))
    expect(gateTemporalClaim({ ...base, text: "O comportamento permaneceu estável", metadata: { temporalRelation: "STABILITY", evidenceBuckets: ["B1", "B2", "B3"] } }, { buckets, facts: stableSupported }).ok).toBe(true)
    // V1.3.4.1 §26: NO_DIFFERENCE sobre B1×B3 com B2 analisado e não comparado NÃO libera "estável ao longo do trimestre".
    expect(gateTemporalClaim({ ...base, text: "O comportamento permaneceu estável", metadata: { temporalRelation: "STABILITY", evidenceBuckets: ["B1", "B3"] } }, { buckets, facts: behavioralFactNoDifference })).toMatchObject({ ok: false, reason: "INSUFFICIENT_BUCKETS", detail: expect.stringContaining("B2") })
    // Janela de 2 blocos: B1×B2 basta — mas ainda exige STABLE sustentado.
    const twoBuckets = temporalBucketsOf({ start: period.start, end: new Date("2026-08-01T03:00:00Z") }, 2, label)
    expect(gateTemporalClaim({ ...base, text: "O comportamento permaneceu estável", metadata: { temporalRelation: "STABILITY", evidenceBuckets: ["B1", "B2"] } }, { buckets: twoBuckets, facts: facts(comparisonEntry("NO_DIFFERENCE_SUPPORTED", [], ["B1", "B2"], ["B1", "B2"])) })).toMatchObject({ ok: false, reason: "TEMPORAL_CONCLUSION_INCOMPATIBLE" })
    expect(gateTemporalClaim({ ...base, text: "O comportamento permaneceu estável", metadata: { temporalRelation: "STABILITY", evidenceBuckets: ["B1", "B2"] } }, { buckets: twoBuckets, facts: facts(comparisonEntry("NO_DIFFERENCE_SUPPORTED", [{ relation: "STABLE", earlierBucket: "B1", laterBucket: "B2", directionSupported: true, relationValidationStatus: "SUPPORTED" }], ["B1", "B2"], ["B1", "B2"])) }).ok).toBe(true)
    expect(gateTemporalClaim({ ...base, text: "O comportamento permaneceu estável", metadata: { temporalRelation: "STABILITY", evidenceBuckets: ["B1", "B2", "B3"] } }, { buckets, facts: facts(comparisonEntry("DIFFERENCE_OBSERVED", [{ relation: "DECREASED", earlierBucket: "B1", laterBucket: "B3", directionSupported: true, relationValidationStatus: "SUPPORTED" }], ["B1", "B2", "B3"])) })).toMatchObject({ ok: false, reason: "UNSUPPORTED_DIRECTION" })
    expect(gateTemporalClaim({ ...base, text: "Seu atendimento mudou ao longo do período", metadata: { temporalRelation: "CHANGE", evidenceBuckets: ["B1", "B3"] } }, { buckets, facts: behavioralFactNoDifference })).toMatchObject({ ok: false, reason: "UNSUPPORTED_DIRECTION" })
  })

  it("V1.3.4.1 §20/§15: diferença SÓ NA AMOSTRA sustenta fato de amostra (INTERACTION_SPECIFIC, sem linguagem de período) e nunca 'deixou de ocorrer'/mudança de padrão do colaborador", () => {
    const sampleOnly = facts(comparisonEntry("SAMPLE_DIFFERENCE_ONLY", [{ relation: "DECREASED", earlierBucket: "B1", laterBucket: "B3", directionSupported: false, relationValidationStatus: "SAMPLE_DIFFERENCE_ONLY", relationValidationReason: "B3 0 de 3 analisada(s) (universo 20) — ausência não estabelecida", sampleDifference: true }]))
    const claim = (text: string, scope: "INTERACTION_SPECIFIC" | "EMPLOYEE_PATTERN", relation: "CHANGE" | "EARLIER_VS_LATER" | "TREND") => gateTemporalClaim({ ...base, text, scope, metadata: { temporalRelation: relation, evidenceBuckets: ["B1", "B3"] } }, { buckets, facts: sampleOnly })
    expect(claim("O padrão apareceu em 2 das 3 interações analisadas de junho e não apareceu nas 3 analisadas de agosto", "INTERACTION_SPECIFIC", "EARLIER_VS_LATER").ok).toBe(true)
    expect(claim("O padrão apareceu em 2 das 3 interações analisadas de junho e não apareceu nas 3 analisadas de agosto", "INTERACTION_SPECIFIC", "CHANGE").ok).toBe(true)
    expect(claim("O comportamento deixou de ocorrer em agosto", "INTERACTION_SPECIFIC", "CHANGE")).toMatchObject({ ok: false, reason: "SAMPLE_DIFFERENCE_ONLY", detail: expect.stringContaining("ausência não estabelecida") })
    expect(claim("O padrão diminuiu ao longo do período", "EMPLOYEE_PATTERN", "CHANGE")).toMatchObject({ ok: false, reason: "SAMPLE_DIFFERENCE_ONLY" })
    expect(claim("O padrão apareceu em 2 das 3 analisadas de junho e em nenhuma de agosto", "EMPLOYEE_PATTERN", "EARLIER_VS_LATER")).toMatchObject({ ok: false, reason: "SAMPLE_DIFFERENCE_ONLY" })
    // §21 cobertura total: mudança sustentada pela aplicação → claim de mudança passa (sujeita ao escopo).
    const supported = facts(comparisonEntry("DIFFERENCE_OBSERVED", [{ relation: "DECREASED", earlierBucket: "B1", laterBucket: "B3", directionSupported: true, relationValidationStatus: "SUPPORTED", sampleDifference: true }]))
    expect(gateTemporalClaim({ ...base, text: "O comportamento deixou de ocorrer em agosto", metadata: { temporalRelation: "CHANGE", evidenceBuckets: ["B1", "B3"] } }, { buckets, facts: supported }).ok).toBe(true)
    expect(gateTemporalClaim({ ...base, text: "O comportamento deixou de ocorrer em agosto", metadata: { temporalRelation: "CHANGE", evidenceBuckets: ["B1", "B3"] }, scopeSupported: false }, { buckets, facts: supported })).toMatchObject({ ok: false, reason: "INSUFFICIENT_REPRESENTATIVENESS" })
  })

  it("V1.3.4.1 §22 TREND ≠ extremos diferentes: numa janela de 3 blocos exige 3 momentos declarados e trendSupported pela aplicação", () => {
    const endpoints = facts(comparisonEntry("DIFFERENCE_OBSERVED", [{ relation: "DECREASED", earlierBucket: "B1", laterBucket: "B3", directionSupported: true, relationValidationStatus: "SUPPORTED", trendSupported: false }], ["B1", "B3"], ["B1", "B3"]))
    expect(gateTemporalClaim({ ...base, text: "Houve tendência de queda ao longo do trimestre", metadata: { temporalRelation: "TREND", evidenceBuckets: ["B1", "B3"] } }, { buckets, facts: endpoints })).toMatchObject({ ok: false, reason: "INSUFFICIENT_BUCKETS", detail: expect.stringContaining("3 momentos") })
    const threeDeclaredNoTrend = facts(comparisonEntry("DIFFERENCE_OBSERVED", [{ relation: "DECREASED", earlierBucket: "B1", laterBucket: "B3", directionSupported: true, relationValidationStatus: "SUPPORTED", trendSupported: false }], ["B1", "B2", "B3"]))
    expect(gateTemporalClaim({ ...base, text: "Houve tendência de queda ao longo do trimestre", metadata: { temporalRelation: "TREND", evidenceBuckets: ["B1", "B2", "B3"] } }, { buckets, facts: threeDeclaredNoTrend })).toMatchObject({ ok: false, reason: "INSUFFICIENT_BUCKETS", detail: expect.stringContaining("extremos") })
    const trend = facts(comparisonEntry("DIFFERENCE_OBSERVED", [{ relation: "DECREASED", earlierBucket: "B1", laterBucket: "B3", directionSupported: true, relationValidationStatus: "SUPPORTED", trendSupported: true }], ["B1", "B2", "B3"]))
    expect(gateTemporalClaim({ ...base, text: "Houve tendência de queda ao longo do trimestre", metadata: { temporalRelation: "TREND", evidenceBuckets: ["B1", "B2", "B3"] } }, { buckets, facts: trend }).ok).toBe(true)
    // A mesma evidência de extremos sustenta CHANGE (mudança entre junho e agosto), não TREND.
    expect(gateTemporalClaim({ ...base, text: "Houve mudança entre junho e agosto", metadata: { temporalRelation: "CHANGE", evidenceBuckets: ["B1", "B3"] } }, { buckets, facts: endpoints }).ok).toBe(true)
  })

  it("V1.3.4.1 §24/§25 concentração exige ausência estabelecida nos contrastes; 'observado apenas na amostra de B1' passa como fato de amostra; padrões diferentes passam sem provar ausência", () => {
    const fragile = facts(comparisonEntry("SAMPLE_DIFFERENCE_ONLY", [{ relation: "CONCENTRATED", earlierBucket: "B1", laterBucket: "B3", directionSupported: false, relationValidationStatus: "SAMPLE_DIFFERENCE_ONLY", relationValidationReason: "observado só na amostra de B1; B2 0 de 2 analisada(s) (universo 12) — ausência não estabelecida", sampleDifference: true }], ["B1", "B2", "B3"]))
    expect(gateTemporalClaim({ ...base, text: "O comportamento ficou concentrado no início do período", metadata: { temporalRelation: "TEMPORAL_CONCENTRATION", evidenceBuckets: ["B1", "B3"] } }, { buckets, facts: fragile })).toMatchObject({ ok: false, reason: "SAMPLE_DIFFERENCE_ONLY" })
    expect(gateTemporalClaim({ ...base, text: "Observado apenas na amostra analisada de junho", scope: "INTERACTION_SPECIFIC", metadata: { temporalRelation: "TEMPORAL_CONCENTRATION", evidenceBuckets: ["B1", "B3"] } }, { buckets, facts: fragile }).ok).toBe(true)
    const established = facts(comparisonEntry("DIFFERENCE_OBSERVED", [{ relation: "CONCENTRATED", earlierBucket: "B1", laterBucket: "B3", directionSupported: true, relationValidationStatus: "SUPPORTED", sampleDifference: true }], ["B1", "B2", "B3"]))
    expect(gateTemporalClaim({ ...base, text: "O comportamento ficou concentrado no início do período", metadata: { temporalRelation: "TEMPORAL_CONCENTRATION", evidenceBuckets: ["B1", "B3"] } }, { buckets, facts: established }).ok).toBe(true)
    const different = facts(comparisonEntry("DIFFERENCE_OBSERVED", [{ relation: "DIFFERENT_PATTERN", earlierBucket: "B1", laterBucket: "B3", directionSupported: true, relationValidationStatus: "SUPPORTED", sampleDifference: true }]))
    expect(gateTemporalClaim({ ...base, text: "As amostras analisadas de junho e agosto apresentam padrões diferentes", scope: "INTERACTION_SPECIFIC", metadata: { temporalRelation: "EARLIER_VS_LATER", evidenceBuckets: ["B1", "B3"] } }, { buckets, facts: different }).ok).toBe(true)
  })

  it("§24 comparação de INDICADOR não sustenta claim COMPORTAMENTAL temporal; §44 relação temporal com escopo sem representatividade → INSUFFICIENT_REPRESENTATIVENESS; §42 fato de data não é relação", () => {
    const indicatorOnly = facts(entry("F2", "compare_periods"), entry("F5", "get_employee_history"))
    expect(gateTemporalClaim({ ...base, text: "Seu atendimento mudou entre junho e agosto", metadata: { temporalRelation: "CHANGE", evidenceBuckets: ["B1", "B3"] }, evidenceRefs: ["F2", "F5"] }, { buckets, facts: indicatorOnly })).toMatchObject({ ok: false, reason: "NO_COMPARATIVE_EVIDENCE", detail: expect.stringContaining("INDICADOR") })
    expect(gateTemporalClaim({ ...base, text: "Seu atendimento mudou entre junho e agosto", metadata: { temporalRelation: "CHANGE", evidenceBuckets: ["B1", "B3"] }, scopeSupported: false }, { buckets, facts: behavioralFactDifference })).toMatchObject({ ok: false, reason: "INSUFFICIENT_REPRESENTATIVENESS" })
    expect(gateTemporalClaim({ ...base, text: "A chamada ocorreu em 28/07 e você informou o protocolo", metadata: {} }, { buckets, facts: [] })).toEqual({ temporal: false, ok: true, reason: null, detail: null })
  })
})

describe("gateSynthesis (V1.3.4) — claims temporais e varredura transversal (§20/§45/§46)", () => {
  const ledger = [entry("F1", "find_interactions"), comparisonEntry("NO_DIFFERENCE_SUPPORTED", [], ["B1", "B2", "B3"])]
  const context = { ledger, knowledgeAvailable: false, interactionUniverse: 36, temporalBuckets: buckets }

  it("OBS_V3_1 transversal: 'início do trimestre'/'transição' no texto entregue, em hipótese ou em premissa de recomendação sem claim temporal validada → TEMPORAL_CLAIM rejeitada; texto sem relação temporal passa", () => {
    const synthesis = parseSynthesisFields({ supportedHypotheses: ["Houve uma transição clara de postura (F3)"], behavioralClaims: [{ text: "Nas interações analisadas você informa o protocolo", evidenceRefs: ["F3"], scope: "INTERACTION_SPECIFIC" }], recommendationSupport: [{ text: "Manter o padrão consolidado no início do período", basis: "OBSERVED_EVIDENCE", evidenceRefs: ["F3"] }] })
    const rejected = gateSynthesis(synthesis, context, "Em interações do início do trimestre sua abordagem era mais informal; notamos uma transição para um modelo técnico.")
    // V1.3.4.2: com comparação realizada (NO_DIFFERENCE) a linguagem de mudança é INCOMPATÍVEL com a conclusão autorizada; sem comparação alguma = UNDECLARED.
    expect(rejected.filter((item) => item.kind === "TEMPORAL_CLAIM").map((item) => item.reason.split(":")[0])).toEqual(["TEMPORAL_CONCLUSION_INCOMPATIBLE", "TEMPORAL_CONCLUSION_INCOMPATIBLE", "TEMPORAL_CONCLUSION_INCOMPATIBLE"])
    expect(gateSynthesis(synthesis, context, "Nas interações analisadas de junho, julho e agosto você informa o protocolo; em 3 das 8 houve silêncio sem atualização.")).toEqual(rejected.filter((item) => item.kind === "TEMPORAL_CLAIM" && !item.reason.includes("texto entregue")))
    const notCompared = gateSynthesis(synthesis, { ...context, ledger: [entry("F1", "find_interactions"), entry("F3", "analyze_interactions")] }, "Notamos uma transição para um modelo técnico.")
    expect(notCompared.filter((item) => item.kind === "TEMPORAL_CLAIM").map((item) => item.reason.split(":")[0])).toEqual(["TEMPORAL_RELATION_UNDECLARED", "TEMPORAL_RELATION_UNDECLARED", "TEMPORAL_RELATION_UNDECLARED"])
  })

  it("§46 negative control: sem diferença real, claim de tendência (B1×B3 numa janela de 3 blocos) é rejeitada; V1.3.4.2: claim de estabilidade sobre B1×B2×B3 com fato NO_DIFFERENCE (sem STABLE sustentado) é rejeitada e o texto 'permaneceu estável' fica incompatível; com STABLE sustentado passa", () => {
    const trend = parseSynthesisFields({ behavioralClaims: [{ text: "As pausas reduziram ao longo do período", evidenceRefs: ["F3"], scope: "INTERACTION_SPECIFIC", temporalRelation: "TREND", evidenceBuckets: ["B1", "B3"] }] })
    expect(gateSynthesis(trend, context, "As pausas reduziram ao longo do período.").map((item) => [item.kind, item.reason.split(":")[0]])).toEqual([["TEMPORAL_CLAIM", "INSUFFICIENT_BUCKETS"]])
    const change = parseSynthesisFields({ behavioralClaims: [{ text: "As pausas reduziram ao longo do período", evidenceRefs: ["F3"], scope: "INTERACTION_SPECIFIC", temporalRelation: "CHANGE", evidenceBuckets: ["B1", "B3"] }] })
    expect(gateSynthesis(change, context, "As pausas reduziram ao longo do período.").map((item) => [item.kind, item.reason.split(":")[0]])).toEqual([["TEMPORAL_CLAIM", "UNSUPPORTED_DIRECTION"]])
    const stable = parseSynthesisFields({ behavioralClaims: [{ text: "O uso de pausas permaneceu estável entre junho e agosto", evidenceRefs: ["F3"], scope: "INTERACTION_SPECIFIC", temporalRelation: "STABILITY", evidenceBuckets: ["B1", "B2", "B3"] }] })
    expect(gateSynthesis(stable, context, "O uso de pausas permaneceu estável entre junho e agosto nas interações analisadas.").map((item) => [item.kind, item.reason.split(":")[0]])).toEqual([["TEMPORAL_CLAIM", "TEMPORAL_CONCLUSION_INCOMPATIBLE"], ["TEMPORAL_CLAIM", "TEMPORAL_CONCLUSION_INCOMPATIBLE"]])
    const stableLedger = [entry("F1", "find_interactions"), comparisonEntry("NO_DIFFERENCE_SUPPORTED", [{ relation: "STABLE", earlierBucket: "B1", laterBucket: "B3", directionSupported: true, relationValidationStatus: "SUPPORTED" }], ["B1", "B2", "B3"])]
    expect(gateSynthesis(stable, { ...context, ledger: stableLedger }, "O uso de pausas permaneceu estável entre junho e agosto nas interações analisadas.")).toEqual([])
    // V1.3.4.1 §26: o mesmo fato NO_DIFFERENCE (B1×B2×B3) NÃO libera "estável" declarado só sobre B1×B3.
    const partial = parseSynthesisFields({ behavioralClaims: [{ text: "O uso de pausas permaneceu estável entre junho e agosto", evidenceRefs: ["F3"], scope: "INTERACTION_SPECIFIC", temporalRelation: "STABILITY", evidenceBuckets: ["B1", "B3"] }] })
    expect(gateSynthesis(partial, context, "O uso de pausas permaneceu estável.").map((item) => [item.kind, item.reason.split(":")[0]])).toEqual([["TEMPORAL_CLAIM", "INSUFFICIENT_BUCKETS"], ["TEMPORAL_CLAIM", "TEMPORAL_CONCLUSION_INCOMPATIBLE"]]) // a claim cai e o texto fica incompatível com a conclusão autorizada
  })

  it("claim comportamental temporal apoiada só em compare_periods do indicador é recusada; com escopo EMPLOYEE_PATTERN sem amostra representativa cai antes (escopo)", () => {
    const indicatorLedger = [entry("F1", "find_interactions"), entry("F2", "compare_periods"), entry("F3", "analyze_interactions", { sampleCount: 2 })]
    const synthesis = parseSynthesisFields({ behavioralClaims: [{ text: "Seu atendimento mudou entre junho e agosto", evidenceRefs: ["F2", "F3"], scope: "INTERACTION_SPECIFIC", temporalRelation: "CHANGE", evidenceBuckets: ["B1", "B3"] }] })
    expect(gateSynthesis(synthesis, { ...context, ledger: indicatorLedger }).map((item) => item.reason.split(":")[0])).toEqual(["NO_COMPARATIVE_EVIDENCE"])
    const generalized = parseSynthesisFields({ behavioralClaims: [{ text: "Seu atendimento mudou entre junho e agosto", evidenceRefs: ["F3"], scope: "EMPLOYEE_PATTERN", temporalRelation: "CHANGE", evidenceBuckets: ["B1", "B3"] }] })
    expect(gateSynthesis(generalized, { ...context, ledger: indicatorLedger }).map((item) => item.kind)).toEqual(["BEHAVIORAL_CLAIM"])
  })

  it("telemetria: propostas = aceitas + rejeitadas, motivos contados por código", () => {
    const telemetry = foldTemporalClaims(emptyTemporalTelemetry(true, 3), { behavioralClaims: [{ temporalRelation: "STABILITY" }, { temporalRelation: "NONE" }] }, [{ kind: "TEMPORAL_CLAIM", reason: "WRONG_TEMPORAL_POSITION: x" }, { kind: "BEHAVIORAL_CLAIM", reason: "escopo" }])
    expect(telemetry).toMatchObject({ temporalClaimsProposed: 2, temporalClaimsAccepted: 1, temporalClaimsRejected: 1, rejectionReasons: expect.objectContaining({ WRONG_TEMPORAL_POSITION: 1 }) })
  })
})

describe("V1.3.4.2 — Temporal Conclusion Contract (§9–§20, §36–§40)", () => {
  const V4_STABILITY_PHRASES = [
    "Não foi identificada uma causa comportamental específica para essas pausas, pois o padrão de atendimento é estável ao longo de todo o período, sem diferenças significativas entre os meses analisados.",
    "Os dados indicam que o seu comportamento se manteve constante, sem variações estatisticamente sustentadas entre os blocos de interações analisados ao longo do trimestre.",
    "A comparação entre os blocos temporais do trimestre não apontou mudanças, mantendo a performance estável.",
    "Não foram identificadas variações ou tendências de evolução (melhora ou piora) no seu desempenho ao longo dos três meses observados, mantendo-se uma estabilidade nos comportamentos verificados.",
  ]
  const noDifference = [entry("F1", "find_interactions"), comparisonEntry("NO_DIFFERENCE_SUPPORTED", [{ relation: "STABLE", earlierBucket: "B1", laterBucket: "B3", directionSupported: false, relationValidationStatus: "INSUFFICIENT_EVIDENCE", relationValidationReason: "B3 0 de 3 analisada(s) (universo 12) — ausência não estabelecida" }], ["B1", "B3"])]
  const stableSupported = [entry("F1", "find_interactions"), comparisonEntry("NO_DIFFERENCE_SUPPORTED", [{ relation: "STABLE", earlierBucket: "B1", laterBucket: "B3", directionSupported: true, relationValidationStatus: "SUPPORTED" }], ["B1", "B2", "B3"])]
  const sampleOnly = [entry("F1", "find_interactions"), comparisonEntry("SAMPLE_DIFFERENCE_ONLY", [{ relation: "DECREASED", earlierBucket: "B1", laterBucket: "B3", directionSupported: false, relationValidationStatus: "SAMPLE_DIFFERENCE_ONLY", sampleDifference: true }])]
  const context = (ledger: LedgerEntry[]) => ({ ledger, knowledgeAvailable: false, interactionUniverse: 36, temporalBuckets: buckets })

  it("§9 a conclusão temporal é derivada por código: NO_DIFFERENCE não é SUPPORTED_RELATION; STABLE sustentado autoriza STABILITY; SAMPLE_DIFFERENCE_ONLY e INSUFFICIENT preservados; sem comparação = NOT_COMPARED; safeMeaning fixo", () => {
    expect(temporalConclusionOfLedger(noDifference)).toMatchObject({ kind: "NO_DIFFERENCE_SUPPORTED", safeMeaning: "Não foi encontrada diferença temporal sustentada nas evidências analisadas.", allowedRelations: [], refs: ["F3"] })
    expect(temporalConclusionOfLedger(stableSupported)).toMatchObject({ kind: "SUPPORTED_RELATION", allowedRelations: ["STABILITY"], supportedRelations: [{ ref: "F3", relation: "STABLE", earlierBucket: "B1", laterBucket: "B3" }] })
    expect(temporalConclusionOfLedger(sampleOnly)).toMatchObject({ kind: "SAMPLE_DIFFERENCE_ONLY", safeMeaning: "Foi observada diferença entre as amostras analisadas, sem evidência suficiente para generalizar ao período." })
    expect(temporalConclusionOfLedger([entry("F1", "find_interactions"), entry("F3", "analyze_interactions", { signals: { temporalComparison: { status: "INSUFFICIENT_EVIDENCE", comparedBuckets: [], behavioral: true, findings: [] } } })])).toMatchObject({ kind: "INSUFFICIENT_EVIDENCE", safeMeaning: "Os dados analisados não permitem concluir uma relação temporal." })
    expect(temporalConclusionOfLedger([entry("F1", "find_interactions"), entry("F2", "get_employee_history")])).toMatchObject({ kind: "NOT_COMPARED", refs: [] })
    // Relação SUPPORTED dentro de uma comparação REBAIXADA (NO_DIFFERENCE contradito por ausência estabelecida noutro achado) não é promovida — consistente com temporalFactsOf.
    expect(temporalConclusionOfLedger([entry("F1", "find_interactions"), entry("F3", "analyze_interactions", { signals: { temporalComparison: { status: "INSUFFICIENT_EVIDENCE", comparedBuckets: ["B1", "B2", "B3"], behavioral: true, findings: [{ relation: "STABLE", earlierBucket: "B1", laterBucket: "B3", directionSupported: true, relationValidationStatus: "SUPPORTED" }] } } })])).toMatchObject({ kind: "INSUFFICIENT_EVIDENCE", supportedRelations: [], allowedRelations: [] })
    expect(temporalConclusionOf(facts(comparisonEntry("DIFFERENCE_OBSERVED", [{ relation: "DECREASED", earlierBucket: "B1", laterBucket: "B3", directionSupported: true, relationValidationStatus: "SUPPORTED", trendSupported: true }])))).toMatchObject({ kind: "SUPPORTED_RELATION", allowedRelations: ["TREND", "CHANGE", "EARLIER_VS_LATER"] })
    expect(renderTemporalConclusion(temporalConclusionOfLedger(noDifference))).toContain('NÃO é "permaneceu estável"')
    expect(Object.values(TEMPORAL_SAFE_MEANINGS).every((text) => !detectStabilityLanguage(text).length && !detectChangeLanguage(text).length)).toBe(true)
  })

  it("§16/§17/§40 léxico de estabilidade: cobre as quatro famílias do V4 e não flagra 'manteve o cliente informado', 'comunicação constante', negações nem a formulação segura", () => {
    for (const phrase of V4_STABILITY_PHRASES) expect(detectStabilityLanguage(phrase).length, phrase).toBeGreaterThan(0)
    for (const safe of [
      "O operador manteve o cliente informado na chamada.",
      "O operador manteve o cliente informado durante a chamada.",
      "Útil para reforçar a importância da comunicação constante com o cliente durante o suporte.",
      "A análise não encontrou evidências de condutas repetitivas, nem de desvios constantes em relação às diretrizes.",
      "Os dados disponíveis não permitem sustentar que houve mudança ou estabilidade comportamental ao longo dos blocos temporais do trimestre.",
      "Não é possível confirmar um padrão comportamental estável e recorrente para toda a sua atuação.",
      "Não foi encontrada diferença temporal sustentada nas evidências analisadas.",
      "Você manteve regularidade nos 66 dias de trabalho observados no trimestre.",
      "identifiquei um padrão de comportamento consistente em sua forma de atender",
    ]) expect(detectStabilityLanguage(safe), safe).toEqual([])
    // Defesa secundária: a família de estabilidade também entra no léxico geral (claim sem relação declarada → UNDECLARED).
    expect(detectTemporalLanguage("O seu comportamento se manteve constante ao longo do trimestre.").length).toBeGreaterThan(0)
    expect(detectChangeLanguage("O seu comportamento se manteve constante ao longo do trimestre.")).toEqual([])
  })

  it("§14/§19/§37 NO_DIFFERENCE + as quatro frases do V4 → rejeitadas (TEMPORAL_CONCLUSION_INCOMPATIBLE) no texto entregue, em hipótese e em premissa; §20 a formulação segura passa", () => {
    for (const phrase of V4_STABILITY_PHRASES) {
      const rejected = gateSynthesis(parseSynthesisFields({ behavioralClaims: [] }), context(noDifference), phrase)
      expect(rejected.map((item) => [item.kind, item.reason.split(":")[0]]), phrase).toEqual([["TEMPORAL_CLAIM", "TEMPORAL_CONCLUSION_INCOMPATIBLE"]])
      expect(rejected[0]!.reason).toContain("Não foi encontrada diferença temporal sustentada")
    }
    const transversal = gateSynthesis(parseSynthesisFields({ supportedHypotheses: ["O comportamento permaneceu estável ao longo do trimestre (F3)"], recommendationSupport: [{ text: "Manter a performance estável observada no período", basis: "OBSERVED_EVIDENCE", evidenceRefs: ["F3"] }], behavioralClaims: [] }), context(noDifference), "Não foi encontrada diferença temporal sustentada nas evidências analisadas.")
    expect(transversal.map((item) => item.reason.split(":")[0])).toEqual(["TEMPORAL_CONCLUSION_INCOMPATIBLE", "TEMPORAL_CONCLUSION_INCOMPATIBLE"])
    expect(gateSynthesis(parseSynthesisFields({ behavioralClaims: [] }), context(noDifference), "Não foi encontrada diferença temporal sustentada nas evidências analisadas. Nas interações analisadas você informa o protocolo.")).toEqual([])
    expect(gateSynthesis(parseSynthesisFields({ behavioralClaims: [] }), context(noDifference), "Os dados não permitem sustentar que houve mudança ou estabilidade comportamental ao longo dos blocos temporais.")).toEqual([])
  })

  it("§39 STABILITY validada: com relação STABLE SUSTENTADA, 'permaneceu estável' passa no texto e a claim STABILITY é aceita", () => {
    const claim = parseSynthesisFields({ behavioralClaims: [{ text: "O uso do protocolo permaneceu estável ao longo do trimestre", evidenceRefs: ["F3"], scope: "INTERACTION_SPECIFIC", temporalRelation: "STABILITY", evidenceBuckets: ["B1", "B2", "B3"] }] })
    expect(gateSynthesis(claim, context(stableSupported), "O uso do protocolo permaneceu estável ao longo do trimestre, mantendo a performance estável.")).toEqual([])
    expect(gateSynthesis(parseSynthesisFields({ behavioralClaims: [] }), context(stableSupported), "O comportamento se manteve constante entre os meses analisados.")).toEqual([])
    // A mesma frase com o mesmo fato SEM sustentação continua rejeitada — a fonte de verdade é a conclusão, não o léxico.
    expect(gateSynthesis(claim, context(noDifference), "O uso do protocolo permaneceu estável ao longo do trimestre.").map((item) => item.reason.split(":")[0])).toEqual(["NO_COMPARATIVE_EVIDENCE", "TEMPORAL_CONCLUSION_INCOMPATIBLE"]) // B1×B3 comparados não cobrem B2; o texto fica incompatível
  })

  it("§12/§38 SAMPLE_DIFFERENCE_ONLY: 'o comportamento caiu no período' → rejeitado; 'houve diferença nas amostras analisadas' → aceito; estabilidade também incompatível", () => {
    expect(gateSynthesis(parseSynthesisFields({ behavioralClaims: [] }), context(sampleOnly), "O comportamento caiu ao longo do período.").map((item) => item.reason.split(":")[0])).toEqual(["TEMPORAL_CONCLUSION_INCOMPATIBLE"])
    expect(gateSynthesis(parseSynthesisFields({ behavioralClaims: [] }), context(sampleOnly), "Houve diferença entre as amostras analisadas de junho e agosto, sem evidência suficiente para generalizar ao período.")).toEqual([])
    expect(gateSynthesis(parseSynthesisFields({ behavioralClaims: [] }), context(sampleOnly), "O comportamento permaneceu estável no período.").map((item) => item.reason.split(":")[0])).toEqual(["TEMPORAL_CONCLUSION_INCOMPATIBLE"])
  })

  it("§18 indicador: histórico com sinal STABLE autoriza 'o indicador se manteve estável'; histórico sem STABLE não autoriza estabilidade comportamental; NOT_COMPARED + linguagem de mudança = UNDECLARED", () => {
    const stableIndicator = [entry("F1", "find_interactions"), entry("F2", "get_employee_history", { signals: { performance: "STABLE" } }), comparisonEntry("NO_DIFFERENCE_SUPPORTED")]
    expect(checkTemporalConclusionCompatibility([{ where: "texto entregue", text: "Seu TMA se manteve estável ao longo do trimestre." }], { conclusion: temporalConclusionOfLedger(stableIndicator), acceptedRelations: [], indicatorTemporalFact: true, indicatorStable: true })).toEqual([])
    expect(gateSynthesis(parseSynthesisFields({ behavioralClaims: [] }), context(stableIndicator), "Seu TMA se manteve estável ao longo do trimestre.")).toEqual([])
    const declinedIndicator = [entry("F1", "find_interactions"), entry("F2", "get_employee_history", { signals: { performance: "DECLINED" } }), comparisonEntry("NO_DIFFERENCE_SUPPORTED")]
    expect(gateSynthesis(parseSynthesisFields({ behavioralClaims: [] }), context(declinedIndicator), "Seu comportamento permaneceu estável ao longo do trimestre.").map((item) => item.reason.split(":")[0])).toEqual(["TEMPORAL_CONCLUSION_INCOMPATIBLE"])
    expect(gateSynthesis(parseSynthesisFields({ behavioralClaims: [] }), context(declinedIndicator), "O indicador piorou ao longo do período.")).toEqual([])
    expect(gateSynthesis(parseSynthesisFields({ behavioralClaims: [] }), context([entry("F1", "find_interactions"), entry("F3", "analyze_interactions")]), "O comportamento permaneceu estável ao longo do trimestre.").map((item) => item.reason.split(":")[0])).toEqual(["TEMPORAL_CONCLUSION_INCOMPATIBLE"])
    expect(gateSynthesis(parseSynthesisFields({ behavioralClaims: [] }), context([entry("F1", "find_interactions"), entry("F3", "analyze_interactions")]), "Houve uma transição clara de postura.").map((item) => item.reason.split(":")[0])).toEqual(["TEMPORAL_RELATION_UNDECLARED"])
  })

  it("telemetria: TEMPORAL_CONCLUSION_INCOMPATIBLE é contado por código", () => {
    const folded = foldTemporalClaims(emptyTemporalTelemetry(true, 3), { behavioralClaims: [] }, [{ kind: "TEMPORAL_CLAIM", reason: "TEMPORAL_CONCLUSION_INCOMPATIBLE: texto entregue afirma estabilidade" }])
    expect(folded.rejectionReasons.TEMPORAL_CONCLUSION_INCOMPATIBLE).toBe(1)
    expect(folded.temporalClaimsRejected).toBe(1)
  })
})

describe("V1.4.1 — ESCOPO DE SUPORTE da relação temporal (§25–§32): SAMPLE × RECORDED_UNIVERSE × EMPLOYEE_PATTERN", () => {
  const sample = [{ interactionRef: "I1", bucketRef: "B1" }, { interactionRef: "I2", bucketRef: "B1" }, { interactionRef: "I3", bucketRef: "B1" }, { interactionRef: "I5", bucketRef: "B3" }, { interactionRef: "I6", bucketRef: "B3" }, { interactionRef: "I7", bucketRef: "B3" }]
  const declaredChange = { status: "DIFFERENCE_OBSERVED" as const, comparedBuckets: ["B1", "B3"], findings: [{ relation: "CHANGED" as const, subjectFindingIndex: 0, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: ["I1", "I5"] }] }

  it("§31 controle de ruído: B1 2/3 × B3 3/3 (+16,7 p.p.) com universo 10 por bloco → relação CHANGED SUPPORTED mas escopo SAMPLE; a mesma diferença com cobertura total (universo 3) → RECORDED_UNIVERSE; ≥ 4 com o achado e ≥ 5 analisadas em cobertura total → EMPLOYEE_PATTERN", () => {
    const findings = [{ verifiedExcerpts: [{ interactionRef: "I1" }, { interactionRef: "I2" }, { interactionRef: "I5" }, { interactionRef: "I6" }, { interactionRef: "I7" }] }]
    const noise = validateTemporalComparison(declaredChange, 1, bucketCountsOf(findings, sample, buckets, { B1: 10, B2: 10, B3: 10 }), sample, buckets)
    expect(noise.findings[0]).toMatchObject({ relationValidationStatus: "SUPPORTED", shareDeltaPercentagePoints: 33.3, supportScope: "SAMPLE" })
    const full = validateTemporalComparison(declaredChange, 1, bucketCountsOf(findings, sample, buckets, { B1: 3, B2: 3, B3: 3 }), sample, buckets)
    expect(full.findings[0]).toMatchObject({ relationValidationStatus: "SUPPORTED", supportScope: "EMPLOYEE_PATTERN" })
    // §53 low-volume: 2/2 → 1/2 com universo total (2 por bloco): RECORDED_UNIVERSE (3 com o achado < 4) — descreve o universo registrado, não traço da pessoa.
    const low = [{ interactionRef: "I1", bucketRef: "B1" }, { interactionRef: "I2", bucketRef: "B1" }, { interactionRef: "I5", bucketRef: "B3" }, { interactionRef: "I6", bucketRef: "B3" }]
    const lowFindings = [{ verifiedExcerpts: [{ interactionRef: "I1" }, { interactionRef: "I2" }, { interactionRef: "I5" }] }]
    const lowVolume = validateTemporalComparison({ ...declaredChange, findings: [{ ...declaredChange.findings[0]!, relation: "DECREASED" }] }, 1, bucketCountsOf(lowFindings, low, buckets, { B1: 2, B2: 2, B3: 2 }), low, buckets)
    expect(lowVolume.findings[0]).toMatchObject({ relationValidationStatus: "SUPPORTED", supportScope: "RECORDED_UNIVERSE" })
    expect(temporalSupportScopeOf([])).toBe("SAMPLE")
  })

  it("§52 gating: relação sustentada com escopo SAMPLE aceita só fato de amostra (INTERACTION_SPECIFIC sem linguagem de período); 'o comportamento aumentou' (EMPLOYEE_PATTERN) → TEMPORAL_SUPPORT_SCOPE; RECORDED_UNIVERSE libera PERIOD_PATTERN mas não EMPLOYEE_PATTERN; EMPLOYEE_PATTERN libera tudo", () => {
    const fact = (scope: "SAMPLE" | "RECORDED_UNIVERSE" | "EMPLOYEE_PATTERN") => temporalFactsOf([entry("F3", "analyze_interactions", { signals: { temporalComparison: { status: "DIFFERENCE_OBSERVED", comparedBuckets: ["B1", "B3"], behavioral: true, analyzedBuckets: ["B1", "B2", "B3"], bucketCount: 3, findings: [{ relation: "INCREASED", earlierBucket: "B1", laterBucket: "B3", directionSupported: true, relationValidationStatus: "SUPPORTED", sampleDifference: true, supportScope: scope }] } } })])
    const claim = (text: string, scope: "INTERACTION_SPECIFIC" | "PERIOD_PATTERN" | "EMPLOYEE_PATTERN") => ({ text, metadata: { temporalRelation: "CHANGE" as const, evidenceBuckets: ["B1", "B3"] }, evidenceRefs: ["F3"], scope, behavioral: true, scopeSupported: true })
    expect(gateTemporalClaim(claim("Nas interações analisadas, o comportamento apareceu em 2 de 3 em B1 e em 3 de 3 em B3", "INTERACTION_SPECIFIC"), { buckets, facts: fact("SAMPLE") })).toMatchObject({ ok: true })
    expect(gateTemporalClaim(claim("O comportamento aumentou ao longo do período", "EMPLOYEE_PATTERN"), { buckets, facts: fact("SAMPLE") })).toMatchObject({ ok: false, reason: "TEMPORAL_SUPPORT_SCOPE" })
    expect(gateTemporalClaim(claim("Você passou a confirmar o pedido no período", "INTERACTION_SPECIFIC"), { buckets, facts: fact("SAMPLE") })).toMatchObject({ ok: false, reason: "TEMPORAL_SUPPORT_SCOPE" })
    expect(gateTemporalClaim(claim("Nas interações registradas do trimestre, o comportamento aumentou entre os meses", "PERIOD_PATTERN"), { buckets, facts: fact("RECORDED_UNIVERSE") })).toMatchObject({ ok: true })
    expect(gateTemporalClaim(claim("O comportamento aumentou ao longo do período", "EMPLOYEE_PATTERN"), { buckets, facts: fact("RECORDED_UNIVERSE") })).toMatchObject({ ok: false, reason: "TEMPORAL_SUPPORT_SCOPE" })
    expect(gateTemporalClaim(claim("O comportamento aumentou ao longo do período", "EMPLOYEE_PATTERN"), { buckets, facts: fact("EMPLOYEE_PATTERN") })).toMatchObject({ ok: true })
    // Conclusão temporal carrega o maior escopo; texto com "evolução positiva" sem claim aceita é incompatível quando o escopo é SAMPLE.
    const conclusion = temporalConclusionOf(fact("SAMPLE"))
    expect(conclusion).toMatchObject({ kind: "SUPPORTED_RELATION", supportScope: "SAMPLE" })
    const incompatible = checkTemporalConclusionCompatibility([{ where: "texto entregue", text: "Notei uma evolução positiva entre o primeiro e o último bloco do período." }], { conclusion, acceptedRelations: [], indicatorTemporalFact: false, indicatorStable: false })
    expect(incompatible).toHaveLength(1)
    expect(incompatible[0]).toMatchObject({ family: "CHANGE", reason: "TEMPORAL_SUPPORT_SCOPE" })
    expect(checkTemporalConclusionCompatibility([{ where: "texto entregue", text: "Notei uma evolução positiva entre o primeiro e o último bloco do período." }], { conclusion: temporalConclusionOf(fact("RECORDED_UNIVERSE")), acceptedRelations: [], indicatorTemporalFact: false, indicatorStable: false })).toEqual([])
    expect(renderTemporalConclusion(conclusion)).toContain("Escopo de suporte SAMPLE")
  })
})
