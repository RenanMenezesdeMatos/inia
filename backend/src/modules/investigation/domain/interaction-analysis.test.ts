import { describe, expect, it } from "vitest"
import { analysisCoverageOf, findingCountsOf, periodIntentOf, renderInteractionAnalysisObjective, temporalBucketCountOf, temporalCoverageOf, type InteractionAnalysisObjective } from "./interaction-analysis.js"

const objective: InteractionAnalysisObjective = {
  investigationObjective: "IDENTIFY_EMPLOYEE_PATTERN",
  question: "Existe um padrão de comportamento do colaborador?",
  requiredClaimScope: "EMPLOYEE_PATTERN",
  periodIntent: "PERIOD_EVOLUTION",
  periodLabel: "trimestre (2026-06-01 a 2026-08-31)",
  openEvidenceNeeds: [{ id: "E_REPRESENTATIVENESS", question: "A amostra representa o período?" }],
  materialQuestions: ["Há comportamento recorrente nas interações do período?"],
  materialHypotheses: [{ hypothesis: "As pausas variam com o assunto", status: "OPEN" }],
  contradictoryEvidenceSummary: [],
  analysisPurpose: "padrões de condução do atendimento",
  recordedUniverseCount: 36,
}

describe("semântica de contagem da análise de interações (V1.3.2 — §13/§17)", () => {
  it("1 de 7 analisadas com trecho verificado e universo 7 (cobertura total): é limite inferior, e a nota diz que não significa 'só 1 teve'", () => {
    const coverage = analysisCoverageOf(7, 7)
    expect(coverage.universeRelationship).toBe("FULL_COVERAGE")
    const counts = findingCountsOf(1, 1, coverage)
    expect(counts).toEqual({ matchedTranscriptCount: 1, verifiedExcerptCount: 1, matchedShareOfAnalyzedPercent: 14.3, prevalenceInUniversePercent: 14.3 })
    expect(coverage.countingNote).toContain("limite inferior")
    expect(coverage.countingNote).toContain('nunca "só N tiveram"')
  })

  it("2 de 8 analisadas com universo 30: participação só dentro da amostra; prevalência no universo = null e a nota proíbe inferir 2 de 30", () => {
    const coverage = analysisCoverageOf(8, 30)
    expect(coverage).toMatchObject({ universeRelationship: "PARTIAL_COVERAGE", analyzedShareOfUniversePercent: 26.7 })
    const counts = findingCountsOf(2, 3, coverage)
    expect(counts.matchedShareOfAnalyzedPercent).toBe(25)
    expect(counts.prevalenceInUniversePercent).toBeNull()
    expect(coverage.countingNote).toContain("NÃO representa N de 30")
  })

  it("8 de 8 analisadas = universo 8: prevalência no universo é válida (100% quando todas tiveram trecho verificado)", () => {
    const coverage = analysisCoverageOf(8, 8)
    expect(findingCountsOf(8, 10, coverage)).toMatchObject({ matchedShareOfAnalyzedPercent: 100, prevalenceInUniversePercent: 100 })
  })

  it("universo desconhecido: nenhum percentual de universo; zero analisadas: nenhum percentual", () => {
    const unknown = analysisCoverageOf(5, null)
    expect(unknown.universeRelationship).toBe("UNKNOWN")
    expect(findingCountsOf(2, 2, unknown)).toMatchObject({ matchedShareOfAnalyzedPercent: 40, prevalenceInUniversePercent: null })
    expect(findingCountsOf(0, 0, analysisCoverageOf(0, 10)).matchedShareOfAnalyzedPercent).toBeNull()
  })
})

describe("objetivo da análise de interações (V1.3.2 — §8/§9)", () => {
  it("renderiza objetivo, escopo, intenção do período, necessidades/perguntas/hipóteses abertas — sem lista de 'o que procurar'", () => {
    const text = renderInteractionAnalysisObjective(objective)
    expect(text).toContain("Identificar padrão do colaborador — Existe um padrão de comportamento do colaborador?")
    expect(text).toContain("EMPLOYEE_PATTERN")
    expect(text).toContain("evolução no período (janela longa)")
    expect(text).toContain("E_REPRESENTATIVENESS (A amostra representa o período?)")
    expect(text).toContain("Há comportamento recorrente nas interações do período?")
    expect(text).toContain("As pausas variam com o assunto [OPEN]")
    expect(text).toContain("Zero achados sustentados é uma resposta válida")
    // Nenhum vocabulário de padrão específico (silêncio/prazo/protocolo/transferência) nasce do runtime.
    expect(text.toLowerCase()).not.toMatch(/sil[êe]ncio|prazo|protocolo|transfer[êe]ncia|rechamada/)
  })

  it("intenção do período: interação em foco → específica; ≤ 35 dias → padrão; janela longa → evolução", () => {
    const pattern = { kind: "IDENTIFY_EMPLOYEE_PATTERN" as const, question: "q", requiredScope: "EMPLOYEE_PATTERN" as const, causal: true }
    expect(periodIntentOf(pattern, 30, false)).toBe("PERIOD_PATTERN")
    expect(periodIntentOf(pattern, 92, false)).toBe("PERIOD_EVOLUTION")
    expect(periodIntentOf(pattern, 92, true)).toBe("SINGLE_INTERACTION")
    expect(periodIntentOf({ ...pattern, kind: "FEEDBACK_SINGLE_INTERACTION" }, 30, false)).toBe("SINGLE_INTERACTION")
  })

  it("cobertura temporal: blocos derivados da janela (~30 dias, sem calendário) e contagem por bloco", () => {
    expect(temporalBucketCountOf(30)).toBe(1)
    expect(temporalBucketCountOf(92)).toBe(3)
    expect(temporalBucketCountOf(61)).toBe(2)
    const period = { start: new Date("2026-06-01T03:00:00Z"), end: new Date("2026-09-01T03:00:00Z") }
    const coverage = temporalCoverageOf([new Date("2026-06-03T12:00:00Z"), new Date("2026-08-20T12:00:00Z"), new Date("2026-08-31T12:00:00Z"), new Date("2026-10-01T00:00:00Z")], period, 3, (date) => date.toLocaleDateString("sv-SE", { timeZone: "America/Fortaleza" }))
    expect(coverage).toEqual({ buckets: 3, bucketsCovered: 2, perBucket: [1, 0, 2] })
  })
})
