import { describe, expect, it } from "vitest"
import { assignOperationalQuartiles } from "../../../modules/indicators/domain/operational-quartile.js"
import { buildDemoMass, stubIndicatorDefinitions } from "./build-demo-mass.js"
import { dailyWindowFor, estimateDailyRows, type DailyMeasurementRow } from "./daily-measurement-generator.js"
import { demoNonProductiveDates } from "./demo-employment-status.js"
import type { DemoPerson } from "./structure-generator.js"

const REFERENCE = "2026-09-15"
const definitions = stubIndicatorDefinitions()
const mass = buildDemoMass(definitions, 20260915, REFERENCE)
const { structure, performance } = mass
const operators = structure.people.filter((person) => person.role === "OPERATOR")
const operator = (ordinal: number) => structure.byKey.get(`operator:${String(ordinal).padStart(4, "0")}`)!
const team = operators.filter((person) => person.reportsToKey === "supervisor:01")
const dailyCache = new Map<string, DailyMeasurementRow[]>()
const dailyOf = (person: DemoPerson) => {
  if (!dailyCache.has(person.id)) dailyCache.set(person.id, mass.dailyMeasurementsOf(person))
  return dailyCache.get(person.id)!
}
const isWeekend = (day: string) => [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())
const rowsSeptember = (person: DemoPerson) => dailyOf(person).filter((row) => row.day.startsWith("2026-09"))

/** A MESMA matemática do resolvedor (Σ numerador ÷ Σ denominador) sobre as linhas geradas. */
function weighted(rows: DailyMeasurementRow[], code: string, from: string, to: string): number | null {
  const inWindow = rows.filter((row) => row.indicatorCode === code && row.day >= from && row.day <= to)
  if (inWindow.length === 0) return null
  return inWindow.reduce((sum, row) => sum + row.numerator!, 0) / inWindow.reduce((sum, row) => sum + row.denominator!, 0)
}

describe("medições diárias — janela, volume e semântica", () => {
  it("180 dias corridos até a referência, só dias úteis; admitidos e afastados respeitam a própria janela", () => {
    const days = dailyWindowFor({ ...operator(1), lateHire: false, absentLastPeriod: false }, REFERENCE)
    expect(days[0]).toBe("2026-03-20")
    expect(days[days.length - 1]).toBe(REFERENCE)
    expect(days.every((day) => !isWeekend(day))).toBe(true)
    expect(days.length).toBeGreaterThanOrEqual(126)
    const late = operators.find((person) => person.lateHire)!
    expect(dailyOf(late).every((row) => row.day > late.hiredAt)).toBe(true)
    const absent = operators.find((person) => person.absentLastPeriod)!
    expect(dailyOf(absent).every((row) => row.day <= "2026-08-15")).toBe(true)
  })

  it("estimativa antes de inserir: 2.000 × ~128 dias úteis × ~5,3 indicadores ≈ 1,36 milhão (real menor por dias sem amostra)", () => {
    const estimate = estimateDailyRows(structure, definitions, REFERENCE)
    expect(estimate.operators).toBe(2000)
    expect(estimate.businessDays).toBeGreaterThanOrEqual(126)
    expect(estimate.estimatedRows).toBeGreaterThan(1_000_000)
  })

  it("componentes coerentes: TMA = Σ tempo ÷ contatos, taxas = ocorrências ÷ elegíveis × 100, backlog sem componentes; volume varia por dia", () => {
    const rows = dailyOf(operator(2))
    const tma = rows.filter((row) => row.indicatorCode === "TMA")
    expect(tma.length).toBeGreaterThan(100)
    for (const row of tma) {
      expect(row.denominator).toBeGreaterThanOrEqual(5)
      expect(Math.abs(row.numerator! / row.denominator! - row.value)).toBeLessThanOrEqual(0.5)
      expect(row.periodStart).toBe(`${row.day}T00:00:00-03:00`)
      expect(row.periodEnd).toBe(`${row.day}T23:59:59-03:00`)
    }
    expect(new Set(tma.map((row) => row.denominator)).size).toBeGreaterThan(10)
    const rate = rows.filter((row) => row.indicatorCode === "REINCIDENCIA_7D")
    for (const row of rate) expect(row.value).toBeCloseTo((row.numerator! / row.denominator!) * 100, 1)
    const backlogOwner = operators.find((person) => person.teamKey === "b2b-faturamento-empresarial")!
    const backlog = dailyOf(backlogOwner).filter((row) => row.indicatorCode === "BACKLOG")
    expect(backlog.length).toBeGreaterThan(50)
    expect(backlog.every((row) => row.numerator === null && row.denominator === null && Number.isInteger(row.value))).toBe(true)
  })

  it("qualidade e Nota URA só existem em dias com amostra (avaliações/respostas), nunca com volume inventado", () => {
    const rows = dailyOf(operator(6))
    const quality = rows.filter((row) => row.indicatorCode === "MONITORIA_QUALIDADE")
    const tma = rows.filter((row) => row.indicatorCode === "TMA")
    expect(quality.length).toBeLessThan(tma.length * 0.7)
    expect(quality.every((row) => row.sampleCount! >= 1 && row.sampleCount! <= 2)).toBe(true)
    const ura = rows.filter((row) => row.indicatorCode === "NOTA_URA")
    expect(ura.every((row) => row.sampleCount! >= 1)).toBe(true)
  })

  it("é reproduzível e determinístico por data: mudar a referência mantém os dias em comum idênticos", () => {
    const again = buildDemoMass(definitions, 20260915, REFERENCE).dailyMeasurementsOf(operator(42))
    expect(again).toEqual(dailyOf(operator(42)))
    const shifted = buildDemoMass(definitions, 20260915, "2026-09-16").dailyMeasurementsOf(operator(42))
    const common = shifted.filter((row) => row.day <= REFERENCE)
    const original = dailyOf(operator(42)).filter((row) => row.day >= "2026-03-21")
    expect(common).toEqual(original)
  })
})

describe("medições diárias — coerência com o fechamento oficial (camada 2 intacta)", () => {
  it("o agregado operacional de cada mês fica a ≤ 6% do valor oficial de TMA e o oficial nunca é alterado", () => {
    let checked = 0
    for (const person of [operator(1), operator(2), operator(3), operator(4), operator(5), operator(6), operator(7), operator(9)]) {
      const rows = dailyOf(person)
      for (const official of performance.indicatorRows.filter((row) => row.personId === person.id && row.indicatorCode === "TMA")) {
        const [year, month] = official.referencePeriod.split("-")
        const aggregate = weighted(rows, "TMA", `${year}-${month}-01`, `${year}-${month}-31`)
        if (aggregate === null) continue
        expect(Math.abs(aggregate / official.value - 1)).toBeLessThanOrEqual(0.06)
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(30)
    expect(performance.indicatorRows.find((row) => row.personId === operator(2).id && row.indicatorCode === "TMA" && row.referencePeriod === "2026-08")!.quartile).toBe("Q4")
    // Setembro (mês corrente da referência) só existe na camada operacional — nunca como fechamento.
    expect(performance.indicatorRows.some((row) => row.referencePeriod === "2026-09")).toBe(false)
    expect(rowsSeptember(operator(2)).length).toBeGreaterThan(0)
  })

  it("um mês SEM fechamento oficial do indicador (lacuna) também não tem medição diária — nunca preenchido", () => {
    const person = operator(10)
    const rows = dailyOf(person)
    const spec = structure.teamByKey.get(person.teamKey!)!.spec
    const missing = spec.indicators.flatMap((indicator) =>
      mass.closedPeriods.filter((period) => !performance.indicatorRows.some((row) => row.personId === person.id && row.indicatorCode === indicator.code && row.referencePeriod === period)).map((period) => `${indicator.code}:${period}`),
    )
    expect(missing.length).toBeGreaterThan(0)
    for (const key of missing) {
      const [code, period] = key.split(":")
      expect(rows.some((row) => row.indicatorCode === code && row.day.startsWith(period!))).toBe(false)
    }
  })
})

describe("medições diárias — casos canônicos", () => {
  const last7 = { from: "2026-09-09", to: "2026-09-15" }
  const previous7 = { from: "2026-09-02", to: "2026-09-08" }
  const tma7 = (person: DemoPerson) => weighted(dailyOf(person), "TMA", last7.from, last7.to)

  // Situação não produtiva (fixtures 0011–0020, demo-employment-status.ts) NÃO gera medição — coerência
  // PLANEJADO × OBSERVADO da massa. Quem esteve fora a semana inteira sai da população operacional.
  const inLast7 = (person: DemoPerson) => ["2026-09-09", "2026-09-10", "2026-09-11", "2026-09-14", "2026-09-15"].some((day) => !demoNonProductiveDates(person, REFERENCE)(day))
  const producing = team.filter(inLast7)

  it("Mariana está no Q4 OPERACIONAL de TMA nos últimos 7 dias e Larissa no Q1, na população da Supervisora 01 (quem produziu na semana)", () => {
    const candidates = team.flatMap((person) => {
      const value = tma7(person)
      return value === null ? [] : [{ employeeId: person.key, value }]
    })
    expect(candidates).toHaveLength(producing.length)
    expect(producing.length).toBeGreaterThanOrEqual(16)
    expect(producing.length).toBeLessThan(25)
    const result = assignOperationalQuartiles(candidates, "LOWER")
    const quartileOf = (ordinal: number) => result.assignments.find((a) => a.employeeId === operator(ordinal).key)!.quartile
    expect(quartileOf(2)).toBe("Q4")
    expect(quartileOf(1)).toBe("Q1")
    expect(quartileOf(4)).toBe("Q4")
  })

  it("Beatriz evolui e Rafael cai: mês corrente vs mês anterior e últimos 30 vs 30 anteriores, na direção da persona (TMA menor = melhor)", () => {
    const beatriz = dailyOf(operator(3))
    const rafael = dailyOf(operator(4))
    expect(weighted(beatriz, "TMA", "2026-09-01", "2026-09-15")!).toBeLessThan(weighted(beatriz, "TMA", "2026-08-01", "2026-08-31")!)
    expect(weighted(rafael, "TMA", "2026-09-01", "2026-09-15")!).toBeGreaterThan(weighted(rafael, "TMA", "2026-08-01", "2026-08-31")!)
    expect(weighted(beatriz, "TMA", "2026-08-17", "2026-09-15")!).toBeLessThan(weighted(beatriz, "TMA", "2026-07-18", "2026-08-16")!)
    expect(weighted(rafael, "TMA", "2026-08-17", "2026-09-15")!).toBeGreaterThan(weighted(rafael, "TMA", "2026-07-18", "2026-08-16")!)
    expect(weighted(beatriz, "TMA", "2026-04-01", "2026-04-30")!).toBeGreaterThan(weighted(beatriz, "TMA", "2026-09-01", "2026-09-15")! * 1.25)
    expect(weighted(rafael, "TMA", "2026-09-01", "2026-09-15")!).toBeGreaterThan(weighted(rafael, "TMA", "2026-04-01", "2026-04-30")! * 1.2)
  })

  it("Diego não tem Nota URA em julho/agosto (SEM DADOS) mas tem TMA todos os dias úteis", () => {
    const rows = dailyOf(operator(6))
    expect(rows.some((row) => row.indicatorCode === "NOTA_URA" && (row.day.startsWith("2026-07") || row.day.startsWith("2026-08")))).toBe(false)
    expect(rows.some((row) => row.indicatorCode === "NOTA_URA" && row.day.startsWith("2026-06"))).toBe(true)
    expect(rows.filter((row) => row.indicatorCode === "TMA" && row.day.startsWith("2026-08"))).toHaveLength(21)
  })

  it("quem produziu na semana (Supervisora 01) tem TMA nos últimos 7 dias E nos 7 anteriores (comparação de janelas possível); quem estava em situação não produtiva a semana inteira não tem medição", () => {
    for (const person of producing) {
      expect(tma7(person)).not.toBeNull()
      if (["2026-09-02", "2026-09-03", "2026-09-04", "2026-09-07", "2026-09-08"].some((day) => !demoNonProductiveDates(person, REFERENCE)(day))) expect(weighted(dailyOf(person), "TMA", previous7.from, previous7.to)).not.toBeNull()
    }
    for (const person of team.filter((candidate) => !inLast7(candidate))) expect(tma7(person)).toBeNull()
    // INSS com medição chegando (0014): inconsistência deliberada — a medição existe, a situação é soberana.
    expect(tma7(operator(14))).not.toBeNull()
    expect(tma7(operator(15))).toBeNull() // maternidade em aberto: nada gerado
  })
})

describe("medições diárias — unidade REAL do indicador (nunca atingimento gravado em value)", () => {
  const sampleRows = operators.filter((_, index) => index % 40 === 0).flatMap((person) => dailyOf(person))
  const byCode = (code: string) => sampleRows.filter((row) => row.indicatorCode === code)

  it("TMA em segundos plausíveis (200–1.200 s), numerador = segundos totais, denominador = contatos, value = num ÷ den", () => {
    const tma = byCode("TMA")
    expect(tma.length).toBeGreaterThan(500)
    for (const row of tma) {
      expect(row.value).toBeGreaterThanOrEqual(200)
      expect(row.value).toBeLessThanOrEqual(1200)
      expect(row.numerator).toBeGreaterThan(row.value) // total de segundos do dia > TMA de uma chamada
      expect(row.denominator).toBeGreaterThanOrEqual(5)
      expect(row.sampleCount).toBe(row.denominator)
      expect(Math.abs(row.numerator! / row.denominator! - row.value)).toBeLessThanOrEqual(0.5)
    }
    // Um atingimento (≈ 80–120) nunca é confundido com o valor: nenhum TMA cai na faixa de percentual.
    expect(tma.filter((row) => row.value >= 80 && row.value <= 125)).toHaveLength(0)
  })

  it("taxas em 0–100 com ocorrências ≤ elegíveis; notas em 1–5; NPS em −100..100; backlog inteiro ≥ 0", () => {
    for (const code of ["FCR", "REINCIDENCIA_7D", "TAXA_TRANSFERENCIA", "ADERENCIA", "MONITORIA_QUALIDADE", "SLA_24H"]) {
      const rows = byCode(code)
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(row.value).toBeGreaterThanOrEqual(0)
        expect(row.value).toBeLessThanOrEqual(100)
        expect(row.numerator).toBeLessThanOrEqual(row.denominator! * (code === "MONITORIA_QUALIDADE" ? 100 : 1))
      }
    }
    for (const row of byCode("NOTA_URA")) {
      expect(row.value).toBeGreaterThanOrEqual(1)
      expect(row.value).toBeLessThanOrEqual(5)
      expect(row.sampleCount).toBeGreaterThanOrEqual(1)
    }
    const nps = operators.filter((person) => person.teamKey === "b2b-grandes-contas").slice(0, 5).flatMap((person) => dailyOf(person)).filter((row) => row.indicatorCode === "NPS")
    expect(nps.length).toBeGreaterThan(0)
    for (const row of nps) {
      expect(row.value).toBeGreaterThanOrEqual(-100)
      expect(row.value).toBeLessThanOrEqual(100)
    }
    const backlog = operators.filter((person) => person.teamKey === "b2b-faturamento-empresarial").slice(0, 5).flatMap((person) => dailyOf(person)).filter((row) => row.indicatorCode === "BACKLOG")
    expect(backlog.length).toBeGreaterThan(0)
    for (const row of backlog) {
      expect(Number.isInteger(row.value)).toBe(true)
      expect(row.value).toBeGreaterThanOrEqual(0)
    }
  })

  it("operador acima da meta de TMA (500 s) gera segundos abaixo da meta, não um percentual de atingimento", () => {
    const larissa = dailyOf(operator(1)).filter((row) => row.indicatorCode === "TMA" && row.day.startsWith("2026-08"))
    const target = 400 // meta vigente do Grupo em agosto (catálogo)
    const aggregate = larissa.reduce((sum, row) => sum + row.numerator!, 0) / larissa.reduce((sum, row) => sum + row.denominator!, 0)
    expect(aggregate).toBeLessThan(target)
    expect(aggregate).toBeGreaterThan(200)
  })
})
