import { describe, expect, it } from "vitest"
import { BRAZILIAN_CAPITALS } from "../../../modules/people/domain/brazilian-capitals.js"
import { easterSunday, expandHolidayRules, holidayCoverageReport, ruleDatesForYear, validateHolidayRules } from "./holiday-catalog.js"
import { CAPITAL_HOLIDAY_RULES, HOLIDAY_CATALOG_GAPS, HOLIDAY_CATALOG_YEARS, HOLIDAY_RULES, NATIONAL_HOLIDAY_RULES, STATE_HOLIDAY_RULES } from "./holiday-catalog-data.js"

describe("catálogo-base de feriados — reference data com proveniência", () => {
  it("Páscoa e móveis: Sexta-feira Santa 2026-04-03 / 2027-03-26 / 2028-04-14; Corpus Christi 2026-06-04; Carnaval 2026-02-17", () => {
    expect(easterSunday(2026)).toBe("2026-04-05")
    expect(easterSunday(2027)).toBe("2027-03-28")
    expect(easterSunday(2028)).toBe("2028-04-16")
    const goodFriday = NATIONAL_HOLIDAY_RULES.find((rule) => rule.easterOffset === -2)!
    expect(HOLIDAY_CATALOG_YEARS.map((year) => ruleDatesForYear(goodFriday, year)[0])).toEqual(["2026-04-03", "2027-03-26", "2028-04-14"])
    const corpus = STATE_HOLIDAY_RULES.find((rule) => rule.stateCode === "DF" && rule.easterOffset === 60)!
    expect(ruleDatesForYear(corpus, 2026)).toEqual(["2026-06-04"])
    const carnival = STATE_HOLIDAY_RULES.find((rule) => rule.stateCode === "RJ" && rule.easterOffset === -47)!
    expect(ruleDatesForYear(carnival, 2026)).toEqual(["2026-02-17"])
  })

  it("estrutura: NATIONAL sem UF/capital, STATE com UF válida, MUNICIPAL_CAPITAL com capital do catálogo; toda regra tem fonte", () => {
    expect(validateHolidayRules()).toEqual([])
    for (const rule of NATIONAL_HOLIDAY_RULES) expect(rule.stateCode ?? rule.capitalCode).toBeUndefined()
    for (const rule of STATE_HOLIDAY_RULES) expect(rule.stateCode).toMatch(/^[A-Z]{2}$/)
    for (const rule of CAPITAL_HOLIDAY_RULES) expect(BRAZILIAN_CAPITALS.some((capital) => capital.code === rule.capitalCode)).toBe(true)
    for (const rule of HOLIDAY_RULES) expect(rule.sourceReference).toMatch(/^https?:\/\//)
  })

  it("dez feriados nacionais por ano; nada de ponto facultativo nacional (Carnaval/Corpus Christi só onde há lei estadual/municipal)", () => {
    const rows = expandHolidayRules()
    for (const year of HOLIDAY_CATALOG_YEARS) expect(rows.filter((row) => row.scope === "NATIONAL" && row.date.startsWith(`${year}-`))).toHaveLength(10)
    expect(NATIONAL_HOLIDAY_RULES.some((rule) => /carnaval|corpus/i.test(rule.name))).toBe(false)
  })

  it("expansão sem duplicata pela chave natural (data × escopo × UF × capital × nome) e cobertura 2026–2028", () => {
    const rows = expandHolidayRules()
    const keys = new Set(rows.map((row) => `${row.date}|${row.scope}|${row.stateCode ?? ""}|${row.capitalCode ?? ""}|${row.name}`))
    expect(keys.size).toBe(rows.length)
    const report = holidayCoverageReport(rows)
    expect(report).toHaveLength(27 * 3)
    // Cobertura declarada: 24/27 capitais com feriado estadual (MT, MG e PR não têm) e 24/27 com municipal (Belém, Campo Grande e Brasília sem).
    for (const year of HOLIDAY_CATALOG_YEARS) {
      const ofYear = report.filter((row) => row.year === year)
      expect(ofYear.filter((row) => row.state === 0).map((row) => row.stateCode).sort()).toEqual(["MG", "MT", "PR"])
      expect(ofYear.filter((row) => row.municipal === 0).map((row) => row.capitalCode).sort()).toEqual(["BELEM", "BRASILIA", "CAMPO_GRANDE"])
    }
  })

  it("feriado extraordinário de um ano tem só aquela data (tricentenário de Fortaleza: 2026-04-13, nunca em 2027/2028)", () => {
    const rows = expandHolidayRules().filter((row) => row.capitalCode === "FORTALEZA" && /tricentenário/i.test(row.name))
    expect(rows.map((row) => row.date)).toEqual(["2026-04-13"])
  })

  it("SC: Data Magna transferida para o domingo seguinte quando cai em dia útil (2026→16/08, 2027→15/08, 2028→13/08)", () => {
    const rule = STATE_HOLIDAY_RULES.find((entry) => entry.stateCode === "SC")!
    expect(HOLIDAY_CATALOG_YEARS.map((year) => ruleDatesForYear(rule, year)[0])).toEqual(["2026-08-16", "2027-08-15", "2028-08-13"])
  })

  it("aplicabilidade por capital: Fortaleza recebe CE + Fortaleza; Recife recebe PE + Recife; nada cruza", () => {
    const rows = expandHolidayRules().filter((row) => row.date.startsWith("2026-"))
    const fortaleza = rows.filter((row) => row.scope === "NATIONAL" || (row.scope === "STATE" && row.stateCode === "CE") || (row.scope === "MUNICIPAL_CAPITAL" && row.capitalCode === "FORTALEZA"))
    expect(fortaleza.some((row) => row.date === "2026-03-25")).toBe(true) // Data Magna CE
    expect(fortaleza.some((row) => row.date === "2026-08-15")).toBe(true) // padroeira de Fortaleza
    expect(fortaleza.some((row) => row.date === "2026-03-06")).toBe(false) // Data Magna PE não vale em Fortaleza
    const recife = rows.filter((row) => row.scope === "NATIONAL" || (row.scope === "STATE" && row.stateCode === "PE") || (row.scope === "MUNICIPAL_CAPITAL" && row.capitalCode === "RECIFE"))
    expect(recife.some((row) => row.date === "2026-03-06")).toBe(true)
    expect(recife.some((row) => row.date === "2026-07-16")).toBe(true)
    expect(recife.some((row) => row.date === "2026-03-25")).toBe(false)
  })

  it("lacunas são explícitas: toda capital sem feriado municipal seedado tem uma entrada em HOLIDAY_CATALOG_GAPS", () => {
    const seeded = new Set(CAPITAL_HOLIDAY_RULES.map((rule) => rule.capitalCode))
    for (const capital of BRAZILIAN_CAPITALS) {
      if (!seeded.has(capital.code)) expect(HOLIDAY_CATALOG_GAPS.some((gap) => gap.capitalCode === capital.code)).toBe(true)
    }
    const seededStates = new Set(STATE_HOLIDAY_RULES.map((rule) => rule.stateCode))
    for (const capital of BRAZILIAN_CAPITALS) {
      if (!seededStates.has(capital.stateCode)) expect(HOLIDAY_CATALOG_GAPS.some((gap) => gap.stateCode === capital.stateCode)).toBe(true)
    }
  })
})
