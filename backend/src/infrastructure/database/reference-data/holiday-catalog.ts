import type pg from "pg"
import { BRAZILIAN_CAPITALS, BRAZILIAN_STATE_CODES } from "../../../modules/people/domain/brazilian-capitals.js"
import { HOLIDAY_CATALOG_YEARS, HOLIDAY_RULES, type HolidayRule, type HolidayVerification } from "./holiday-catalog-data.js"

/**
 * Expansão das regras do catálogo-base em linhas concretas por ano + carga idempotente em
 * `holiday_catalog` (chave natural: data × escopo × país × UF × capital × nome). Rodar 2× = 0
 * duplicatas; uma regra alterada atualiza fonte/base legal da linha existente; nada é apagado.
 */
export type HolidayCatalogRow = {
  date: string
  name: string
  scope: HolidayRule["scope"]
  stateCode: string | null
  capitalCode: string | null
  sourceName: string
  sourceReference: string
  legalReference: string | null
  /** Força da verificação da fonte (OFFICIAL | LEGAL_DATABASE | SECONDARY) — vai para `holiday_catalog.verification`. */
  verification: HolidayVerification
}

/** Domingo de Páscoa (calendário gregoriano — algoritmo de Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return iso(Date.UTC(year, month - 1, day))
}

function iso(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  return iso(Date.UTC(year!, month! - 1, day! + days))
}

function weekday(date: string): number {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()
}

/** Datas de uma regra num ano (0 ou 1 — regras `dates` só produzem nos anos que listam). */
export function ruleDatesForYear(rule: HolidayRule, year: number): string[] {
  if (rule.dates) return rule.dates.filter((date) => date.startsWith(`${year}-`))
  let date: string
  if (rule.easterOffset !== undefined) date = addDays(easterSunday(year), rule.easterOffset)
  else if (rule.month !== undefined && rule.day !== undefined) date = iso(Date.UTC(year, rule.month - 1, rule.day))
  else return []
  if (rule.adjust === "SUNDAY_AFTER_IF_WEEKDAY") {
    const dow = weekday(date)
    if (dow >= 1 && dow <= 5) date = addDays(date, 7 - dow)
  }
  return [date]
}

export function expandHolidayRules(rules: readonly HolidayRule[] = HOLIDAY_RULES, years: readonly number[] = HOLIDAY_CATALOG_YEARS): HolidayCatalogRow[] {
  const rows: HolidayCatalogRow[] = []
  for (const rule of rules) {
    for (const year of years) {
      for (const date of ruleDatesForYear(rule, year)) {
        rows.push({ date, name: rule.name, scope: rule.scope, stateCode: rule.stateCode ?? null, capitalCode: rule.capitalCode ?? null, sourceName: rule.sourceName, sourceReference: rule.sourceReference, legalReference: rule.legalReference ?? null, verification: rule.verification })
      }
    }
  }
  return rows
}

/** Validação estrutural das regras (mesma regra do check constraint do banco + catálogo das 27). */
export function validateHolidayRules(rules: readonly HolidayRule[] = HOLIDAY_RULES): string[] {
  const capitals = new Set(BRAZILIAN_CAPITALS.map((capital) => capital.code))
  const states = new Set(BRAZILIAN_STATE_CODES)
  const problems: string[] = []
  for (const rule of rules) {
    const label = `${rule.scope}:${rule.stateCode ?? rule.capitalCode ?? "BR"}:${rule.name}`
    if (rule.scope === "NATIONAL" && (rule.stateCode || rule.capitalCode)) problems.push(`${label}: NATIONAL não pode ter UF/capital`)
    if (rule.scope === "STATE" && (!rule.stateCode || rule.capitalCode)) problems.push(`${label}: STATE exige UF e não pode ter capital`)
    if (rule.scope === "MUNICIPAL_CAPITAL" && !rule.capitalCode) problems.push(`${label}: MUNICIPAL_CAPITAL exige capital`)
    if (rule.stateCode && !states.has(rule.stateCode)) problems.push(`${label}: UF desconhecida ${rule.stateCode}`)
    if (rule.capitalCode && !capitals.has(rule.capitalCode)) problems.push(`${label}: capital desconhecida ${rule.capitalCode}`)
    if (!rule.sourceName || !rule.sourceReference) problems.push(`${label}: sem proveniência`)
    const kinds = [rule.dates !== undefined, rule.easterOffset !== undefined, rule.month !== undefined && rule.day !== undefined].filter(Boolean).length
    if (kinds !== 1) problems.push(`${label}: regra precisa de exatamente uma forma de data (fixa | móvel | datas explícitas)`)
  }
  return problems
}

export type CoverageReportRow = { year: number; capitalCode: string; stateCode: string; national: number; state: number; municipal: number }

/** Relatório de cobertura ano × capital: quantos feriados nacionais/estaduais/municipais se aplicam. */
export function holidayCoverageReport(rows: readonly HolidayCatalogRow[] = expandHolidayRules(), years: readonly number[] = HOLIDAY_CATALOG_YEARS): CoverageReportRow[] {
  const report: CoverageReportRow[] = []
  for (const year of years) {
    const ofYear = rows.filter((row) => row.date.startsWith(`${year}-`))
    for (const capital of BRAZILIAN_CAPITALS) {
      report.push({
        year,
        capitalCode: capital.code,
        stateCode: capital.stateCode,
        national: ofYear.filter((row) => row.scope === "NATIONAL").length,
        state: ofYear.filter((row) => row.scope === "STATE" && row.stateCode === capital.stateCode).length,
        municipal: ofYear.filter((row) => row.scope === "MUNICIPAL_CAPITAL" && row.capitalCode === capital.code).length,
      })
    }
  }
  return report
}

export async function seedHolidayCatalog(client: Pick<pg.PoolClient, "query">, rows: readonly HolidayCatalogRow[] = expandHolidayRules()): Promise<{ inserted: number; updated: number; total: number }> {
  const problems = validateHolidayRules()
  if (problems.length > 0) throw new Error(`catálogo de feriados inválido:\n${problems.join("\n")}`)
  if (rows.length === 0) return { inserted: 0, updated: 0, total: 0 }
  const result = await client.query<{ inserted: boolean }>(
    `insert into holiday_catalog (holiday_date, name, scope, country_code, state_code, capital_code, source_name, source_reference, legal_reference, active, verification)
     select holiday_date::date, name, scope, 'BR', state_code, capital_code, source_name, source_reference, legal_reference, true, verification
       from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[]) as t(holiday_date, name, scope, state_code, capital_code, source_name, source_reference, legal_reference, verification)
     on conflict (holiday_date, scope, country_code, coalesce(state_code, ''), coalesce(capital_code, ''), name) do update
       set source_name = excluded.source_name, source_reference = excluded.source_reference, legal_reference = excluded.legal_reference, verification = excluded.verification, updated_at = now()
     where holiday_catalog.source_name is distinct from excluded.source_name or holiday_catalog.source_reference is distinct from excluded.source_reference or holiday_catalog.legal_reference is distinct from excluded.legal_reference or holiday_catalog.verification is distinct from excluded.verification
     returning (xmax = 0) inserted`,
    [rows.map((r) => r.date), rows.map((r) => r.name), rows.map((r) => r.scope), rows.map((r) => r.stateCode), rows.map((r) => r.capitalCode), rows.map((r) => r.sourceName), rows.map((r) => r.sourceReference), rows.map((r) => r.legalReference), rows.map((r) => r.verification)],
  )
  const inserted = result.rows.filter((row) => row.inserted).length
  return { inserted, updated: result.rows.length - inserted, total: rows.length }
}
