import type { Database } from "../../../infrastructure/database/pool.js"
import { HOLIDAY_CATALOG_GAPS, HOLIDAY_CATALOG_YEARS, type HolidayCatalogGap, type HolidayVerification } from "../../../infrastructure/database/reference-data/holiday-catalog-data.js"
import { BRAZILIAN_CAPITALS, findBrazilianCapital } from "../domain/brazilian-capitals.js"

/**
 * COBERTURA DO CATÁLOGO DE FERIADOS — o que está no banco (`holiday_catalog`) por ano, escopo e força
 * de verificação, mais o REGISTRO EXPLÍCITO de lacunas (`HOLIDAY_CATALOG_GAPS`, reference data). A
 * Central/Calendário operacional mostram isto para que ninguém apresente o catálogo como "100%
 * completo" quando não é: capitais sem feriado municipal verificado, linhas SECONDARY, portarias
 * futuras não publicadas. Nada aqui inventa feriado.
 */
export type HolidayCatalogYearCoverage = {
  year: number
  national: number
  /** Capitais (das 27) cuja UF tem ao menos um feriado estadual no catálogo. */
  capitalsWithStateHoliday: number
  /** Capitais (das 27) com ao menos um feriado municipal no catálogo. */
  capitalsWithMunicipalHoliday: number
  rows: number
  byVerification: Record<HolidayVerification, number>
  /** Linhas ainda sem força de verificação registrada (seed anterior à migration 068). */
  unverifiedRows: number
}

export type HolidayCatalogGapView = HolidayCatalogGap & { label: string }

export type HolidayCatalogCoverage = {
  years: HolidayCatalogYearCoverage[]
  totalRows: number
  gaps: HolidayCatalogGapView[]
  /** Quantidade de pendências de verificação (lacunas + capitais/anos com linhas SECONDARY). */
  pendingVerifications: number
  /** Capitais sem nenhum feriado municipal no catálogo (em qualquer ano coberto). */
  capitalsWithoutMunicipalHoliday: string[]
  complete: false
}

function gapLabel(gap: HolidayCatalogGap): string {
  if (gap.scope === "NATIONAL") return "Nacional"
  if (gap.scope === "STATE") return `Estadual · ${gap.stateCode}`
  const capital = gap.capitalCode ? findBrazilianCapital(gap.capitalCode) : null
  return `Municipal · ${capital ? `${capital.name} / ${capital.stateCode}` : gap.capitalCode}`
}

export async function buildHolidayCatalogCoverage(db: Database): Promise<HolidayCatalogCoverage> {
  const result = await db.query<{ year: number; scope: string; state_code: string | null; capital_code: string | null; verification: HolidayVerification | null; n: number }>(
    `select extract(year from holiday_date)::int as year, scope, state_code, capital_code, verification, count(*)::int n
       from holiday_catalog where active group by 1, 2, 3, 4, 5`,
  )
  const years: HolidayCatalogYearCoverage[] = HOLIDAY_CATALOG_YEARS.map((year) => {
    const ofYear = result.rows.filter((row) => row.year === year)
    const states = new Set(ofYear.filter((row) => row.scope === "STATE" && row.state_code).map((row) => row.state_code))
    const capitals = new Set(ofYear.filter((row) => row.scope === "MUNICIPAL_CAPITAL" && row.capital_code).map((row) => row.capital_code))
    const byVerification: Record<HolidayVerification, number> = { OFFICIAL: 0, LEGAL_DATABASE: 0, SECONDARY: 0 }
    let unverified = 0
    for (const row of ofYear) {
      if (row.verification) byVerification[row.verification] += Number(row.n)
      else unverified += Number(row.n)
    }
    return {
      year,
      national: ofYear.filter((row) => row.scope === "NATIONAL").reduce((sum, row) => sum + Number(row.n), 0),
      capitalsWithStateHoliday: BRAZILIAN_CAPITALS.filter((capital) => states.has(capital.stateCode)).length,
      capitalsWithMunicipalHoliday: BRAZILIAN_CAPITALS.filter((capital) => capitals.has(capital.code)).length,
      rows: ofYear.reduce((sum, row) => sum + Number(row.n), 0),
      byVerification,
      unverifiedRows: unverified,
    }
  })
  const municipalAny = new Set(result.rows.filter((row) => row.scope === "MUNICIPAL_CAPITAL" && row.capital_code).map((row) => row.capital_code))
  const capitalsWithoutMunicipalHoliday = BRAZILIAN_CAPITALS.filter((capital) => !municipalAny.has(capital.code)).map((capital) => capital.code)
  const gaps = HOLIDAY_CATALOG_GAPS.map((gap) => ({ ...gap, label: gapLabel(gap) }))
  const secondaryTotal = years.reduce((sum, year) => sum + year.byVerification.SECONDARY, 0)
  return {
    years,
    totalRows: years.reduce((sum, year) => sum + year.rows, 0),
    gaps,
    pendingVerifications: gaps.length + (secondaryTotal > 0 ? 1 : 0),
    capitalsWithoutMunicipalHoliday,
    complete: false,
  }
}
