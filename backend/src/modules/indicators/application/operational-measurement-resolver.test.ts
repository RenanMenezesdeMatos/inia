import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { eligibleDayRanges, eligibleMeasurementSql, resolveOperationalClosedMonths, resolveOperationalWindow, resolveOperationalWindowBySubject } from "./operational-measurement-resolver.js"

const WINDOW = { start: new Date("2026-09-09T03:00:00Z"), end: new Date("2026-09-15T17:30:00Z") }

/** Consultas do resolvedor de elegibilidade (pessoas, períodos, calendário, exceções, feriados, política, feeds) — vazias aqui: foco é a agregação. */
function eligibilityRows(sql: string, params: unknown[]): unknown[] | null {
  if (sql.includes("indicator_measurements")) return null
  if (sql.includes("operational_capital_code from people")) return (params[0] as string[]).map((id) => ({ id, organization_id: "org", hired_at: null, operational_capital_code: null }))
  if (sql.includes("holiday_fallback_policy from organizations")) return [{ holiday_fallback_policy: "IGNORE" }]
  if (sql.includes("from employee_status_periods") || sql.includes("from employee_schedule_days") || sql.includes("from employee_work_shifts") || sql.includes("from employee_schedule_exceptions") || sql.includes("from holiday_catalog") || sql.includes("from organization_holidays") || sql.includes("from data_feeds")) return []
  // Fontes de evidência de atividade (interações / indicadores marcados): nenhuma na fixture — só o planejado.
  if (sql.includes("from interactions where organization_id")) return [{ present: false }]
  if (sql.includes("proves_work_activity order by code")) return []
  if (sql.includes("f.availability_policy") || sql.includes("availability_policy from indicator_definitions")) return []
  if (sql.includes("from workday_classifications c")) return []
  return null
}

function fakeDb(rowsByCall: (sql: string, params: unknown[]) => unknown[]): Database {
  return { query: vi.fn(async (sql: string, params?: unknown[]) => ({ rows: eligibilityRows(sql, params ?? []) ?? rowsByCall(sql, params ?? []), rowCount: 0 })), connect: async () => { throw new Error("n/a") } } as unknown as Database
}

describe("resolvedor operacional — uma query, valor + evidência", () => {
  it("pooled: usa Σ numerador ÷ Σ denominador quando todas as linhas têm componentes, e reporta janela/método/cobertura", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("operational_aggregation, daily_supported from indicator_definitions")) return [{ id: "i", code: "TMA", unit: "SECONDS", desired_direction: "LOWER", operational_aggregation: "WEIGHTED_AVERAGE", daily_supported: true }]
      if (sql.includes("select avg(m.value)")) return [{ avg_value: "500", min_value: "400", max_value: "600", sample_count: "5", sum_value: "2500", latest_value: "480", weighted_sum: "142639", weight_total: "287", numerator_sum: "142639", denominator_sum: "287", rows_with_components: "5", sample_total: "287", days_with_data: "5" }]
      throw new Error(`não roteado: ${sql.slice(0, 60)}`)
    })
    const result = await resolveOperationalWindow(db, { indicatorCode: "TMA", subjectIds: ["op-1"], window: WINDOW, aggregation: "WEIGHTED_AVERAGE", expectedDays: 5 }, { organizationId: "org" })
    expect(result.value).toBe(497.0)
    expect(result.method).toContain("÷")
    expect(result.daysWithData).toBe(5)
    expect(result.coverage).toBe(1)
    expect(result.numerator).toBe(142639)
    expect(result.denominator).toBe(287)
    expect(result.window.start).toBe(WINDOW.start.toISOString())
    // Predicado canônico: intervalos elegíveis por pessoa + situações não produtivas entram como parâmetros.
    const measurementCall = (db.query as ReturnType<typeof vi.fn>).mock.calls.find(([sql]) => String(sql).includes("from indicator_measurements"))!
    expect(String(measurementCall[0])).toContain("eligible_days")
    expect(measurementCall[1]).toHaveLength(11) // + pares pessoa × data de falta injustificada (absence_days)
  })

  it("por colaborador: uma query agrupada; quem não tem linha na janela fica fora do mapa (SEM DADOS), nunca vira zero", async () => {
    const db = fakeDb((sql, params) => {
      if (sql.includes("operational_aggregation, daily_supported")) return []
      if (sql.includes("group by m.subject_id")) {
        expect(params[1]).toEqual(["op-1", "op-2", "op-3"])
        return [
          { subject_id: "op-1", avg_value: "10", min_value: "10", max_value: "10", sample_count: "2", days_with_data: "2" },
          { subject_id: "op-2", avg_value: "20", min_value: "20", max_value: "20", sample_count: "1", days_with_data: "1" },
        ]
      }
      throw new Error(`não roteado: ${sql.slice(0, 60)}`)
    })
    const result = await resolveOperationalWindowBySubject(db, { indicatorCode: "X", subjectIds: ["op-1", "op-2", "op-3"], window: WINDOW, aggregation: "AVERAGE", expectedDays: 5 }, { organizationId: "org" })
    expect(result.get("op-1")?.value).toBe(10)
    expect(result.get("op-1")?.coverage).toBe(0.4)
    expect(result.get("op-2")?.value).toBe(20)
    expect(result.has("op-3")).toBe(false)
    expect((db.query as ReturnType<typeof vi.fn>).mock.calls.filter(([sql]) => String(sql).includes("from indicator_measurements"))).toHaveLength(1)
  })

  it("meses fechados: agregado da união (nunca média das médias) e mês esperado sem medição contado como faltante", async () => {
    const months = [
      { start: new Date("2026-08-01T03:00:00Z"), end: new Date("2026-09-01T03:00:00Z") },
      { start: new Date("2026-07-01T03:00:00Z"), end: new Date("2026-08-01T03:00:00Z") },
    ]
    const db = fakeDb((sql) => {
      if (sql.includes("operational_aggregation, daily_supported")) return [{ id: "i", code: "TMA", unit: "SECONDS", desired_direction: "LOWER", operational_aggregation: "WEIGHTED_AVERAGE", daily_supported: true }]
      if (sql.includes("with expected(month_start, month_end) as")) {
        return [{ missing_months: "1", avg_value: "450", min_value: "400", max_value: "500", sample_count: "20", numerator_sum: "90000", denominator_sum: "200", rows_with_components: "20", days_with_data: "20",
          months: [{ month_start: "2026-08-01T03:00:00.000Z", avg_value: "450", min_value: "400", max_value: "500", sample_count: "20", numerator_sum: "90000", denominator_sum: "200", rows_with_components: "20", days_with_data: "20" }, { month_start: "2026-07-01T03:00:00.000Z", avg_value: null, min_value: null, max_value: null, sample_count: "0" }] }]
      }
      throw new Error(`não roteado: ${sql.slice(0, 60)}`)
    })
    const result = await resolveOperationalClosedMonths(db, { organizationId: "org", indicatorCode: "TMA", subjectIds: ["op-1"], months, aggregation: "WEIGHTED_AVERAGE" })
    expect(result.total.value).toBe(450)
    expect(result.monthsWithData).toBe(1)
    expect(result.months[1]!.result.value).toBeNull()
  })

  it("intervalos elegíveis: datas contíguas viram um intervalo por pessoa (parâmetros compactos, nunca N datas soltas); pessoa sem dia elegível não gera intervalo", () => {
    const ranges = eligibleDayRanges(
      new Map([
        ["a", { eligibleDates: ["2026-09-07", "2026-09-08", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"] }],
        ["b", { eligibleDates: [] }],
        ["c", { eligibleDates: ["2026-09-30", "2026-10-01"] }], // vira o mês sem quebrar o intervalo
      ]),
    )
    expect(ranges).toEqual({ personIds: ["a", "a", "c"], from: ["2026-09-07", "2026-09-10", "2026-09-30"], to: ["2026-09-08", "2026-09-13", "2026-10-01"] })
    const sql = eligibleMeasurementSql({ alias: "m", timeZoneParam: "$5", personIdsParam: "$6", fromParam: "$7", toParam: "$8", statusesParam: "$9" })
    expect(sql.cte).toContain("unnest($6::uuid[], $7::date[], $8::date[])")
    expect(sql.predicate).toContain("m.granularity in ('DAILY', 'HOURLY', 'INTERACTION')")
    expect(sql.predicate).toContain("at time zone $5")
  })
})