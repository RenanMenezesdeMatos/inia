import { describe, expect, it } from "vitest"
import { correctionBlockers, correctionNotices, emptyMeasurementScan, indicatorCorrectionFieldsSchema, indicatorCorrectionRequestSchema, scanMeasurement, type CorrectableValues, type CorrectionFacts } from "./indicator-correction.js"

const SUM_COUNT: CorrectableValues = { unit: "COUNT", desiredDirection: "HIGHER", operationalAggregation: "SUM" }
const WEIGHTED_SECONDS: CorrectableValues = { unit: "SECONDS", desiredDirection: "LOWER", operationalAggregation: "WEIGHTED_AVERAGE" }

const row = (value: number, numerator: number | null = null, denominator: number | null = null) => ({ subjectId: "p-1", periodStart: "2026-09-15T03:00:00.000Z", value, numerator, denominator })

function scanOf(rows: ReturnType<typeof row>[], next: CorrectableValues) {
  const scan = emptyMeasurementScan()
  for (const item of rows) scanMeasurement(scan, item, next)
  return scan
}

function facts(overrides: Partial<CorrectionFacts> = {}): CorrectionFacts {
  return {
    current: SUM_COUNT,
    next: WEIGHTED_SECONDS,
    configurationError: null,
    scan: emptyMeasurementScan(),
    goals: 0,
    closuresWithIncoherentComponents: 0,
    closuresWithUnusedComponents: 0,
    zeroContributionReset: false,
    workflows: { activePublished: [], pausedPublished: [], drafts: [], outOfScope: { activePublished: 0, pausedPublished: 0, drafts: 0 } },
    ...overrides,
  }
}

describe("varredura das medições pela estratégia e unidade novas", () => {
  it("Média ponderada e Taxa exigem numerador e denominador; a linha incompleta conta como sem componentes", () => {
    const scan = scanOf([row(10), row(10, 5), row(10, null, 5), row(450, 8100, 18)], WEIGHTED_SECONDS)
    expect(scan).toMatchObject({ total: 4, missingComponents: 3, incoherentValues: 0, unusedComponents: 0 })
    expect(scanOf([row(10)], { ...WEIGHTED_SECONDS, unit: "PERCENT", operationalAggregation: "RATE" }).missingComponents).toBe(1)
  })

  it("Soma, Média simples e Último valor não exigem nada; componentes que sobram são contados à parte", () => {
    for (const operationalAggregation of ["SUM", "AVERAGE", "LATEST"] as const) {
      expect(scanOf([row(10), row(450, 8100, 18)], { ...SUM_COUNT, operationalAggregation })).toMatchObject({ missingComponents: 0, incoherentValues: 0, unusedComponents: 1 })
    }
  })

  it("valor incoerente usa a mesma conta da carga: fator da estratégia e tolerância de arredondamento", () => {
    const scan = scanOf([row(900, 8100, 18), row(450, 8100, 18), row(450.4, 8100, 18)], WEIGHTED_SECONDS)
    expect(scan.incoherentValues).toBe(1)
    expect(scan.examples[0]).toMatchObject({ issue: "INCOHERENT_VALUE", value: 900, expected: 450 })
    // Taxa multiplica por 100: os mesmos componentes dariam 85, nunca 0,85.
    expect(scanOf([row(85, 17, 20), row(0.85, 17, 20)], { ...WEIGHTED_SECONDS, unit: "PERCENT", operationalAggregation: "RATE" }).incoherentValues).toBe(1)
    expect(scanOf([row(85, 17, 20)], WEIGHTED_SECONDS).incoherentValues).toBe(1)
    expect(scanOf([row(0, 0, 0)], WEIGHTED_SECONDS).incoherentValues).toBe(0)
  })

  it("faixa de valor vem da unidade nova", () => {
    expect(scanOf([row(150, 150, 1)], { unit: "PERCENT", desiredDirection: "HIGHER", operationalAggregation: "WEIGHTED_AVERAGE" }).outOfUnitRange).toBe(1)
    expect(scanOf([row(-5)], { ...SUM_COUNT, unit: "SECONDS" }).outOfUnitRange).toBe(1)
    expect(scanOf([row(-5)], SUM_COUNT).outOfUnitRange).toBe(0)
  })

  it("guarda poucos exemplos por problema, nunca a lista inteira", () => {
    const scan = scanOf(Array.from({ length: 50 }, () => row(10)), WEIGHTED_SECONDS)
    expect(scan.missingComponents).toBe(50)
    expect(scan.examples).toHaveLength(3)
  })
})

describe("o que bloqueia a correção", () => {
  it("nada mudou é bloqueio; com medições em ordem, libera", () => {
    expect(correctionBlockers(facts({ next: SUM_COUNT })).map((blocker) => blocker.code)).toEqual(["NO_CHANGE"])
    expect(correctionBlockers(facts())).toEqual([])
  })

  it("explica o caminho conforme a estratégia atual aceita ou não componentes na carga", () => {
    const missing = emptyMeasurementScan()
    missing.missingComponents = 2
    const fromSum = correctionBlockers(facts({ scan: missing }))[0]!.message
    expect(fromSum).toMatch(/2 medições não têm numerador e denominador/)
    expect(fromSum).toMatch(/Enquanto a estratégia for "Soma", a carga recusa numerador e denominador/)
    const incoherent = emptyMeasurementScan()
    incoherent.incoherentValues = 1
    const fromRate = correctionBlockers(facts({ current: { ...SUM_COUNT, unit: "PERCENT", operationalAggregation: "RATE" }, scan: incoherent }))[0]!.message
    expect(fromRate).toMatch(/1 medição tem valor que não confere/)
    expect(fromRate).toMatch(/carregue de novo/)
  })

  it("Workflow ativo bloqueia mesmo quando quem consulta não o enxerga; pausado e rascunho só avisam", () => {
    const workflow = { id: "wf", name: "Fluxo", inFlightEnrollments: 0, uses: [] }
    const onlyHidden = facts({ workflows: { activePublished: [], pausedPublished: [], drafts: [], outOfScope: { activePublished: 1, pausedPublished: 0, drafts: 0 } } })
    expect(correctionBlockers(onlyHidden).map((blocker) => blocker.code)).toEqual(["ACTIVE_WORKFLOWS"])
    const notRunning = facts({ workflows: { activePublished: [], pausedPublished: [workflow], drafts: [workflow, workflow], outOfScope: { activePublished: 0, pausedPublished: 0, drafts: 1 } } })
    expect(correctionBlockers(notRunning)).toEqual([])
    expect(correctionNotices(notRunning).join(" ")).toMatch(/1 Workflow pausado depende.*3 rascunhos de Workflow usam/)
  })

  it("configuração inválida é bloqueio com a mensagem da validação do catálogo", () => {
    expect(correctionBlockers(facts({ configurationError: 'A estratégia "Taxa" só é válida para Percentual.' }))).toEqual([{ code: "INVALID_CONFIGURATION", message: 'A estratégia "Taxa" só é válida para Percentual.' }])
  })
})

describe("avisos que não bloqueiam", () => {
  it("cada consequência é dita em linguagem simples, e só quando existe", () => {
    expect(correctionNotices(facts({ next: { ...SUM_COUNT, desiredDirection: "LOWER" } }))).toEqual([])
    const unused = emptyMeasurementScan()
    unused.unusedComponents = 3
    const notices = correctionNotices(facts({ next: { ...SUM_COUNT, operationalAggregation: "LATEST", unit: "CASES" }, scan: unused, goals: 2, closuresWithIncoherentComponents: 1, closuresWithUnusedComponents: 4, zeroContributionReset: true })).join(" ")
    expect(notices).toMatch(/3 medições têm numerador e denominador que a estratégia nova não usa.*quarentena/)
    expect(notices).toMatch(/"Sem amostra"/)
    expect(notices).toMatch(/2 metas continuam com o mesmo número/)
    expect(notices).toMatch(/1 fechamento oficial tem numerador e denominador que não conferem.*O valor oficial fica como está/)
    expect(notices).toMatch(/4 fechamentos oficiais têm numerador e denominador que a estratégia nova não usa/)
    expect(notices).toMatch(/O glossário e as regras de cálculo/)
  })
})

describe("o que o corpo aceita", () => {
  it("só unidade, direção e estratégia: código e medição operacional são recusados, nunca ignorados", () => {
    expect(indicatorCorrectionFieldsSchema.parse({ unit: "SECONDS" })).toEqual({ unit: "SECONDS" })
    expect(indicatorCorrectionFieldsSchema.safeParse({ code: "OUTRO" }).success).toBe(false)
    expect(indicatorCorrectionFieldsSchema.safeParse({ dailySupported: false }).success).toBe(false)
    expect(indicatorCorrectionFieldsSchema.safeParse({ unit: "ANOS" }).success).toBe(false)
  })

  it("aplicar exige motivo e confirmação digitados", () => {
    expect(indicatorCorrectionRequestSchema.safeParse({ unit: "SECONDS", confirmation: "X" }).success).toBe(false)
    expect(indicatorCorrectionRequestSchema.safeParse({ unit: "SECONDS", reason: "curto", confirmation: "X" }).success).toBe(false)
    expect(indicatorCorrectionRequestSchema.safeParse({ unit: "SECONDS", reason: "Cadastro errado na implantação", confirmation: "  " }).success).toBe(false)
    expect(indicatorCorrectionRequestSchema.safeParse({ unit: "SECONDS", reason: "Cadastro errado na implantação", confirmation: "X" }).success).toBe(true)
  })
})
