import type pg from "pg"
import { expandHolidayRules, holidayCoverageReport, seedHolidayCatalog } from "./reference-data/holiday-catalog.js"
import { HOLIDAY_CATALOG_GAPS, HOLIDAY_CATALOG_YEARS } from "./reference-data/holiday-catalog-data.js"

/**
 * REFERENCE DATA — dados de referência que TODO ambiente precisa (não é massa demo; pode e deve
 * rodar em produção): catálogo-base de feriados 2026–2028 com proveniência e força de verificação.
 * As 27 capitais são estruturais (migration 065 — FK de people) e por isso entram pelas migrations.
 * Idempotente: repetir não duplica (chave natural) e só atualiza fonte/base legal/verificação
 * quando a regra mudou. Reaproveitado por `db:seed:reference`, `db:bootstrap` e pela prova do zero.
 */
export type ReferenceSeedReport = { holidays: { total: number; inserted: number; updated: number }; capitals: number; gaps: number; coverage: string[] }

export async function runReferenceSeed(client: Pick<pg.PoolClient, "query">, log: (message: string) => void = () => {}): Promise<ReferenceSeedReport> {
  const rows = expandHolidayRules()
  const result = await seedHolidayCatalog(client, rows)
  log(`holiday_catalog: ${result.total} linhas nas regras → ${result.inserted} inseridas, ${result.updated} atualizadas (o resto já estava igual)`)
  const report = holidayCoverageReport(rows)
  const coverage: string[] = []
  for (const year of HOLIDAY_CATALOG_YEARS) {
    const ofYear = report.filter((row) => row.year === year)
    const line = `${year}: nacionais ${ofYear[0]?.national ?? 0} · capitais com feriado estadual ${ofYear.filter((row) => row.state > 0).length}/27 · capitais com feriado municipal ${ofYear.filter((row) => row.municipal > 0).length}/27`
    coverage.push(line)
    log(line)
  }
  log(`lacunas registradas (não seedadas): ${HOLIDAY_CATALOG_GAPS.length} — ver reference-data/holiday-catalog-data.ts`)
  const capitals = await client.query<{ n: string }>(`select count(*)::text n from brazilian_capitals`)
  return { holidays: result, capitals: Number(capitals.rows[0]?.n ?? 0), gaps: HOLIDAY_CATALOG_GAPS.length, coverage }
}
