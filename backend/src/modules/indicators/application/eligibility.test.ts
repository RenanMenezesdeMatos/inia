import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { EMPLOYMENT_STATUSES, NON_ELIGIBLE_EMPLOYMENT_STATUSES } from "../../people/domain/employment-status.js"
import { evaluateDataCondition } from "../../workflows/application/condition-evaluator.js"
import { runEmployeeRanking } from "../../workflows/application/select-employees-executor.js"
import { resolveTimeWindow } from "../../workflows/application/time-window.js"
import { resolveEligibleDaysBySubject, resolveOperationalWindowBySubject } from "./operational-measurement-resolver.js"

/**
 * CALENDÁRIO REAL DE ELEGIBILIDADE — o MESMO resolvedor (resolveEligibleDaysBySubject) que
 * Condition, Ranking, quartil, Analytics e QA usam. Regra final: admitido ∧ EM_PRODUCAO ∧ escala
 * diz que trabalha ∧ sem exclusão de calendário. O fake responde ao SQL real (people.hired_at,
 * employee_status_periods, employee_schedule_days, employee_work_shifts, organization_holidays,
 * data_feeds) e simula a cláusula de elegibilidade das medições (dia não produtivo não conta).
 */
type Period = { personId: string; status: string; from: string; to: string | null }
type Day = { personId: string; date: string; work: boolean }
type Regime = { personId: string; type: "FIVE_BY_TWO" | "SIX_BY_ONE"; from?: string }
type Exception = { personId: string; date: string; code: "BANCO_HORAS" | "DAY_OFF" | "FOLGA_EXTRAORDINARIA" | "ATESTADO" | "AJUSTE_ESCALA"; active?: boolean }
type CatalogHoliday = { date: string; name?: string; scope: "NATIONAL" | "STATE" | "MUNICIPAL_CAPITAL"; stateCode?: string; capitalCode?: string }
type Fixture = {
  hiredAt?: Record<string, string>
  capital?: Record<string, string>
  periods?: Period[]
  days?: Day[]
  regimes?: Regime[]
  exceptions?: Exception[]
  /** Datas da organização (organization_holidays). */
  holidays?: string[]
  /** Catálogo-base (holiday_catalog). */
  catalog?: CatalogHoliday[]
  policy?: "IGNORE" | "EXCLUDE_APPLICABLE_HOLIDAYS"
  tma?: Record<string, Record<string, number>> // person → date → segundos
  /** OBSERVADO: interações por pessoa × data (fonte preferencial de evidência). */
  interactions?: Record<string, Record<string, number>>
  /** Indicadores marcados como prova de atividade (`proves_work_activity`) — "TMA" usa as medições de `tma` como evidência. */
  provingIndicators?: string[]
  /** Medições de OUTRO indicador marcado (código → pessoa → datas) — evidência sem ser o indicador em cálculo. */
  evidenceMeasurements?: Record<string, Record<string, string[]>>
  /** DISPONIBILIDADE: feeds relevantes da Central com política D-1/D-2 (sem feed = AVAILABILITY_UNKNOWN: nenhuma ausência é concluída). */
  availabilityFeeds?: { contract: "INTERACTIONS" | "INDICATOR_MEASUREMENTS" | "EMPLOYEES" | "EMPLOYEE_ABSENCES"; policy: { lagDays: number; availableByLocalTime: string } | null; lastSuccessAt: string | null; lastDataAt?: string | null }[]
  /** Classificações vigentes (falta injustificada / ausência justificada / dados não chegaram) por pessoa × data. */
  classifications?: { personId: string; date: string; classification: "UNJUSTIFIED_ABSENCE" | "JUSTIFIED_ABSENCE" | "WORKED_DATA_MISSING"; reasonCode?: string | null }[]
}

function fakeDb(fixture: Fixture, tz: string): Database {
  // Simula o predicado canônico do SQL: medição DAILY conta só se o dia local está nos intervalos
  // elegíveis (person_id/from/to) que o resolvedor passou como parâmetros — nunca uma segunda regra.
  const inRanges = (ranges: { ids: string[]; from: string[]; to: string[] }, id: string, date: string) => ranges.ids.some((personId, index) => personId === id && ranges.from[index]! <= date && date <= ranges.to[index]!)
  const rowFor = (id: string, start: string, end: string, ranges: { ids: string[]; from: string[]; to: string[] }) => {
    const all = Object.entries(fixture.tma?.[id] ?? {}).filter(([date]) => date >= start.slice(0, 10) && date < end.slice(0, 10))
    const days = all.filter(([date]) => inRanges(ranges, id, date))
    if (all.length === 0) return null
    const sum = days.reduce((total, [, value]) => total + value, 0)
    const latest = days.sort(([a], [b]) => a.localeCompare(b)).at(-1)?.[1] ?? null
    return { avg_value: days.length ? String(sum / days.length) : null, min_value: null, max_value: null, sample_count: String(days.length), sum_value: String(sum), latest_value: latest === null ? null : String(latest), numerator_sum: String(sum), denominator_sum: String(days.length), rows_with_components: String(days.length), days_with_data: String(days.length), ignored_count: String(all.length - days.length) }
  }
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("select timezone from operations")) return { rows: [{ timezone: tz }], rowCount: 1 }
      if (sql.includes("operational_aggregation, daily_supported from indicator_definitions")) return { rows: [{ id: "i", code: "TMA", unit: "SECONDS", desired_direction: "LOWER", operational_aggregation: "WEIGHTED_AVERAGE", daily_supported: true }], rowCount: 1 }
      if (sql.includes("desired_direction from indicator_definitions")) return { rows: [{ desired_direction: "LOWER" }], rowCount: 1 }
      if (sql.includes("hired_at::text hired_at, operational_capital_code from people")) return { rows: (params?.[0] as string[]).map((id) => ({ id, organization_id: "org", hired_at: fixture.hiredAt?.[id] ?? null, operational_capital_code: fixture.capital?.[id] ?? null })), rowCount: 0 }
      if (sql.includes("holiday_fallback_policy from organizations")) return { rows: [{ holiday_fallback_policy: fixture.policy ?? "IGNORE" }], rowCount: 1 }
      if (sql.includes("from employee_schedule_exceptions")) {
        const ids = params?.[0] as string[]
        return { rows: (fixture.exceptions ?? []).filter((exception) => ids.includes(exception.personId) && exception.active !== false).map((exception) => ({ person_id: exception.personId, exception_date: exception.date, code: exception.code, effect: "NON_WORKING", raw_reason: null })), rowCount: 0 }
      }
      if (sql.includes("from holiday_catalog")) return { rows: (fixture.catalog ?? []).map((holiday) => ({ holiday_date: holiday.date, name: holiday.name ?? "Feriado", scope: holiday.scope, state_code: holiday.stateCode ?? null, capital_code: holiday.capitalCode ?? null })), rowCount: 0 }
      if (sql.trim().startsWith("select person_id, status, effective_from")) {
        const ids = params?.[0] as string[]
        return { rows: (fixture.periods ?? []).filter((period) => ids.includes(period.personId)).map((period) => ({ person_id: period.personId, status: period.status, effective_from: period.from, effective_to: period.to, effective_to_explicit: period.to !== null })), rowCount: 0 }
      }
      if (sql.includes("from employee_schedule_days")) {
        const ids = params?.[0] as string[]
        return { rows: (fixture.days ?? []).filter((day) => ids.includes(day.personId)).map((day) => ({ person_id: day.personId, schedule_date: day.date, scheduled_to_work: day.work, shift_start: null, shift_end: null })), rowCount: 0 }
      }
      if (sql.includes("from employee_work_shifts")) {
        const ids = params?.[0] as string[]
        return { rows: (fixture.regimes ?? []).filter((regime) => ids.includes(regime.personId)).map((regime) => ({ person_id: regime.personId, schedule_type: regime.type, effective_from: regime.from ?? "2020-01-01", effective_to: null })), rowCount: 0 }
      }
      if (sql.includes("from organization_holidays")) return { rows: (fixture.holidays ?? []).map((date) => ({ holiday_date: date, name: "Data da organização", scope: "ORGANIZATION", state_code: null, capital_code: null })), rowCount: 0 }
      if (sql.includes("f.availability_policy")) {
        return { rows: (fixture.availabilityFeeds ?? []).map((feed, index) => ({ feed_id: `feed-${index}`, feed_name: feed.contract, source_name: "Fonte", contract_key: feed.contract, status: "ACTIVE", availability_policy: feed.policy, cadence: { kind: "MANUAL" }, expected_interval_minutes: null, last_success_at: feed.lastSuccessAt ? new Date(feed.lastSuccessAt) : null, last_data_at: feed.lastDataAt ? new Date(feed.lastDataAt) : null, last_error_code: null })), rowCount: 0 }
      }
      if (sql.includes("from data_feeds f join data_sources s") || sql.includes("availability_policy from indicator_definitions")) return { rows: [], rowCount: 0 }
      if (sql.includes("from workday_classifications c")) {
        const ids = params?.[0] as string[]
        return { rows: (fixture.classifications ?? []).filter((row) => ids.includes(row.personId)).map((row, index) => ({ id: `cls-${index}`, organization_id: "org", person_id: row.personId, workday: row.date, classification: row.classification, reason_code: row.reasonCode ?? null, origin: "SUPERVISOR_MANUAL", classified_by_person_id: null, classified_by_name: null, classified_at: "2026-09-14T12:00:00Z", reconciliation_id: null, supersedes_id: null, superseded_at: null, superseded_by_person_id: null, superseded_by_name: null, superseded_reason: null })), rowCount: 0 }
      }
      // Fontes de evidência (PLANEJADO × OBSERVADO): interações existem? indicadores marcados?
      if (sql.includes("from interactions where organization_id")) return { rows: [{ present: Object.keys(fixture.interactions ?? {}).length > 0 }], rowCount: 1 }
      if (sql.includes("proves_work_activity order by code")) return { rows: (fixture.provingIndicators ?? []).map((code) => ({ code })), rowCount: 0 }
      if (sql.includes("count(*)::int total") && sql.includes("from interactions")) {
        const ids = params?.[0] as string[]
        const from = String(params?.[1])
        const to = String(params?.[2])
        return { rows: ids.flatMap((id) => Object.entries(fixture.interactions?.[id] ?? {}).filter(([date]) => date >= from && date <= to).map(([date, total]) => ({ operator_id: id, local_date: date, total }))), rowCount: 0 }
      }
      if (sql.includes("join indicator_measurements m on m.indicator_definition_id = i.id")) {
        const ids = params?.[0] as string[]
        const from = String(params?.[1])
        const to = String(params?.[2])
        const rows: { subject_id: string; local_date: string; codes: string[] }[] = []
        for (const id of ids) {
          const byDate = new Map<string, Set<string>>()
          if ((fixture.provingIndicators ?? []).includes("TMA")) for (const date of Object.keys(fixture.tma?.[id] ?? {})) byDate.set(date, new Set([...(byDate.get(date) ?? []), "TMA"]))
          for (const [code, byPerson] of Object.entries(fixture.evidenceMeasurements ?? {})) for (const date of byPerson[id] ?? []) byDate.set(date, new Set([...(byDate.get(date) ?? []), code]))
          for (const [date, codes] of byDate) if (date >= from && date <= to) rows.push({ subject_id: id, local_date: date, codes: [...codes].sort() })
        }
        return { rows, rowCount: 0 }
      }
      if (sql.includes("from indicator_measurements")) {
        const ids = params?.[1] as string[]
        expect(params?.[8]).toEqual(NON_ELIGIBLE_EMPLOYMENT_STATUSES) // política única chega ao SQL como parâmetro (linhas mensais/custom)
        expect(sql).toContain("eligible_days") // predicado canônico: intervalos elegíveis por pessoa
        const ranges = { ids: params?.[5] as string[], from: params?.[6] as string[], to: params?.[7] as string[] }
        const start = String(params?.[2])
        const end = String(params?.[3])
        if (sql.includes("group by m.subject_id")) return { rows: ids.flatMap((id) => (rowFor(id, start, end, ranges) ? [{ subject_id: id, ...rowFor(id, start, end, ranges) }] : [])), rowCount: 0 }
        return { rows: [rowFor(ids[0]!, start, end, ranges) ?? { avg_value: null, min_value: null, max_value: null, sample_count: "0" }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
}

const WEEK = { "2026-09-07": 400, "2026-09-08": 420, "2026-09-09": 410, "2026-09-10": 430, "2026-09-11": 405 }
const QUERY = { kind: "INDICATOR_THRESHOLD_COUNT" as const, indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE" as const, source: "MEASUREMENT" as const, period: { kind: "ROLLING_DAYS" as const, days: 5 } }

/** Semana civil seg 07/09 → dom 13/09 como calendário explícito, com as folgas indicadas (0 = dom … 6 = sáb). */
function weekDays(personId: string, daysOff: number[]): Day[] {
  return ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"].map((date) => ({ personId, date, work: !daysOff.includes(new Date(`${date}T00:00:00Z`).getUTCDay()) }))
}

describe.each(["America/Fortaleza", "America/Sao_Paulo", "UTC"])("dias elegíveis — situação funcional (fallback seg–sex) — %s", (tz) => {
  const NOW = new Date(`2026-09-11T18:00:00${tz === "UTC" ? "Z" : "-03:00"}`) // sexta 11/09 à tarde, no fuso
  const window = resolveTimeWindow({ kind: "ROLLING_DAYS", days: 5 }, NOW, tz) // 07/09 → 11/09

  it("sem escala configurada: fallback legado seg–sex, marcado como tal (nunca como escala confirmada)", async () => {
    const eligibility = (await resolveEligibleDaysBySubject(fakeDb({}, tz), ["p"], window, tz)).get("p")!
    expect(eligibility).toMatchObject({ calendarDays: 5, scheduledWorkDays: 5, businessDays: 5, eligibleDays: 5, excludedByScheduledDayOff: 0 })
    expect(eligibility.scheduleConfidence).toMatchObject({ basis: "LEGACY_WEEKDAY_FALLBACK", unconfirmedScheduleDays: 5, unknownScheduleDays: 0 })
  })

  it("cobertura parcial: EM_PRODUCAO seg/ter, FÉRIAS qua–sex, medição seg/ter → 2 elegíveis, 2 com dado = 100% (não 2/5)", async () => {
    const db = fakeDb({ periods: [{ personId: "p", status: "FERIAS", from: "2026-09-09", to: "2026-09-11" }], tma: { p: { "2026-09-07": 400, "2026-09-08": 420 } } }, tz)
    const eligibility = (await resolveEligibleDaysBySubject(db, ["p"], window, tz)).get("p")!
    expect(eligibility).toMatchObject({ businessDays: 5, eligibleDays: 2, excludedByStatus: { FERIAS: 3 }, eligibleDates: ["2026-09-07", "2026-09-08"] })
    const result = await evaluateDataCondition(db, { historicalQuery: { ...QUERY, minimumCoverage: 0.6 }, comparator: "GT", thresholdNumeric: 300 }, { operatorId: "p", subjectIds: ["p"] }, NOW, { organizationId: "org", timeZone: tz })
    expect(result?.branch).toBe("true")
    expect(result?.evaluation.evidence).toMatchObject({ daysWithData: 2, expectedDays: 2, coverage: 1, coverageSatisfied: true, eligibility: { businessDays: 5, eligibleDays: 2, excludedByStatus: { FERIAS: 3 } } })
  })

  it.each(EMPLOYMENT_STATUSES.filter((status) => status !== "EM_PRODUCAO"))("%s a janela inteira: 0 dias elegíveis → SEM DADOS (NO_ELIGIBLE_DAYS), nunca 0, nunca cobertura 0%", async (status) => {
    const db = fakeDb({ periods: [{ personId: "p", status, from: "2026-09-01", to: "2026-09-20" }], tma: { p: WEEK } }, tz)
    const eligibility = (await resolveEligibleDaysBySubject(db, ["p"], window, tz)).get("p")!
    expect(eligibility).toMatchObject({ eligibleDays: 0, excludedByStatus: { [status]: 5 } })
    const result = await evaluateDataCondition(db, { historicalQuery: QUERY, comparator: "GT", thresholdNumeric: 300 }, { operatorId: "p", subjectIds: ["p"] }, NOW, { organizationId: "org", timeZone: tz })
    expect(result?.branch).toBe("no_data")
    expect(result?.evaluation).toMatchObject({ reason: "NO_ELIGIBLE_DAYS", value: null })
  })

  it("regra positiva: SÓ EM_PRODUCAO produz dias elegíveis; status legado ACTIVE no banco é lido como EM_PRODUCAO", async () => {
    const db = fakeDb({ periods: [{ personId: "novo", status: "EM_PRODUCAO", from: "2026-09-01", to: null }, { personId: "legado", status: "ACTIVE", from: "2026-09-01", to: null }] }, tz)
    const eligibility = await resolveEligibleDaysBySubject(db, ["novo", "legado"], window, tz)
    expect(eligibility.get("novo")!.eligibleDays).toBe(5)
    expect(eligibility.get("legado")!.eligibleDays).toBe(5)
  })

  it("medições recebidas durante as férias ficam no banco mas NÃO contam; correção da situação (09–20 → 10–20) recalcula sem tocar a medição", async () => {
    const before = fakeDb({ periods: [{ personId: "p", status: "FERIAS", from: "2026-09-09", to: "2026-09-20" }], tma: { p: WEEK } }, tz)
    const first = (await resolveOperationalWindowBySubject(before, { indicatorCode: "TMA", subjectIds: ["p"], window, aggregation: "WEIGHTED_AVERAGE", expectedDays: 5, timeZone: tz }, { organizationId: "org" })).get("p")!
    expect(first).toMatchObject({ daysWithData: 2, expectedDays: 2, coverage: 1 })
    const corrected = fakeDb({ periods: [{ personId: "p", status: "FERIAS", from: "2026-09-10", to: "2026-09-20" }], tma: { p: WEEK } }, tz)
    const second = (await resolveOperationalWindowBySubject(corrected, { indicatorCode: "TMA", subjectIds: ["p"], window, aggregation: "WEIGHTED_AVERAGE", expectedDays: 5, timeZone: tz }, { organizationId: "org" })).get("p")!
    expect(second).toMatchObject({ daysWithData: 3, expectedDays: 3, coverage: 1 })
  })

  it("admissão + INSS combinam: admitido 08/09, INSS 10–11 → elegíveis 08 e 09", async () => {
    const db = fakeDb({ hiredAt: { p: "2026-09-08" }, periods: [{ personId: "p", status: "INSS", from: "2026-09-10", to: "2026-09-11" }] }, tz)
    const eligibility = (await resolveEligibleDaysBySubject(db, ["p"], window, tz)).get("p")!
    expect(eligibility).toMatchObject({ eligibleDays: 2, excludedBeforeHire: 1, excludedByStatus: { INSS: 2 }, eligibleDates: ["2026-09-08", "2026-09-09"] })
  })

  it("ranking e quartil: pessoa sem dia elegível (MATERNIDADE a semana toda) sai da população — nunca Q4; os outros seguem", async () => {
    const tma = { a: WEEK, b: { "2026-09-07": 500, "2026-09-08": 500 }, c: { "2026-09-07": 600 }, d: { "2026-09-07": 700 }, e: { "2026-09-07": 800 }, licenca: WEEK }
    const db = fakeDb({ periods: [{ personId: "licenca", status: "MATERNIDADE", from: "2026-08-05", to: null }], tma }, tz)
    const ranking = { source: "MEASUREMENT" as const, indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE" as const, period: { kind: "ROLLING_DAYS" as const, days: 5 }, selection: "OPERATIONAL_QUARTILE" as const, operationalQuartile: "Q4" as const, rankingBasis: "VALUE" as const }
    const result = await runEmployeeRanking(db, "org", ranking, ["a", "b", "c", "d", "e", "licenca"], NOW, { timeZone: tz })
    expect(result.rankedCount).toBe(5)
    expect(result.noDataCount).toBe(1)
    expect(result.memberIds).not.toContain("licenca")
    expect(result.memberIds).toEqual(["d", "e"])
    const quartile = await evaluateDataCondition(db, { historicalQuery: { ...QUERY, source: "OPERATIONAL_QUARTILE" }, comparator: "EQUALS", thresholdText: "Q4" }, { operatorId: "licenca", subjectIds: ["licenca"], populationIds: ["a", "b", "c", "d", "e", "licenca"] }, NOW, { organizationId: "org", timeZone: tz })
    expect(quartile?.branch).toBe("no_data")
    expect(quartile?.evaluation).toMatchObject({ reason: "NO_ELIGIBLE_DAYS", population: { evaluatedCount: 6, rankedCount: 5, noDataCount: 1 } })
  })
})

describe("dias elegíveis — escala real (calendário explícito, regime, feriado)", () => {
  const tz = "America/Fortaleza"
  const NOW = new Date("2026-09-13T21:00:00-03:00") // domingo 13/09 à noite
  const week = resolveTimeWindow({ kind: "ROLLING_DAYS", days: 7 }, NOW, tz) // seg 07/09 → dom 13/09

  it("6x1 com folga na QUARTA: 7 dias de calendário, 6 programados, quarta fora; sábado e domingo contam", async () => {
    const db = fakeDb({ days: weekDays("p", [3]) }, tz)
    const eligibility = (await resolveEligibleDaysBySubject(db, ["p"], week, tz)).get("p")!
    expect(eligibility).toMatchObject({ calendarDays: 7, scheduledWorkDays: 6, eligibleDays: 6, excludedByScheduledDayOff: 1, excludedByHoliday: 0, excludedByUnknownSchedule: 0 })
    expect(eligibility.eligibleDates).toEqual(["2026-09-07", "2026-09-08", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"])
    expect(eligibility.scheduleConfidence).toMatchObject({ basis: "EXPLICIT_SCHEDULE", unconfirmedScheduleDays: 0 })
  })

  it("6x1 com 6 medições nos 6 dias programados = cobertura 100%; folga não reduz cobertura", async () => {
    const tma = { p: { "2026-09-07": 400, "2026-09-08": 400, "2026-09-10": 400, "2026-09-11": 400, "2026-09-12": 400, "2026-09-13": 400 } }
    const db = fakeDb({ days: weekDays("p", [3]), tma }, tz)
    const result = (await resolveOperationalWindowBySubject(db, { indicatorCode: "TMA", subjectIds: ["p"], window: week, aggregation: "WEIGHTED_AVERAGE", expectedDays: 7, timeZone: tz }, { organizationId: "org" })).get("p")!
    expect(result).toMatchObject({ daysWithData: 6, expectedDays: 6, coverage: 1 })
  })

  it("6x1 + folga + INSS: 7 dias, 1 folga programada, 2 dias INSS → 4 elegíveis; 4 medições = 100%; 2 medições = 50%", async () => {
    const days = weekDays("p", [0]) // folga domingo
    const periods = [{ personId: "p", status: "INSS", from: "2026-09-08", to: "2026-09-09" }]
    const full = fakeDb({ days, periods, tma: { p: { "2026-09-07": 400, "2026-09-10": 400, "2026-09-11": 400, "2026-09-12": 400 } } }, tz)
    const eligibility = (await resolveEligibleDaysBySubject(full, ["p"], week, tz)).get("p")!
    expect(eligibility).toMatchObject({ calendarDays: 7, scheduledWorkDays: 6, excludedByScheduledDayOff: 1, excludedByStatus: { INSS: 2 }, eligibleDays: 4 })
    expect(eligibility.eligibleDates).toContain("2026-09-12") // sábado programado conta
    const complete = (await resolveOperationalWindowBySubject(full, { indicatorCode: "TMA", subjectIds: ["p"], window: week, aggregation: "WEIGHTED_AVERAGE", expectedDays: 7, timeZone: tz }, { organizationId: "org" })).get("p")!
    expect(complete).toMatchObject({ daysWithData: 4, expectedDays: 4, coverage: 1 })
    const half = fakeDb({ days, periods, tma: { p: { "2026-09-07": 400, "2026-09-10": 400 } } }, tz)
    const partial = (await resolveOperationalWindowBySubject(half, { indicatorCode: "TMA", subjectIds: ["p"], window: week, aggregation: "WEIGHTED_AVERAGE", expectedDays: 7, timeZone: tz }, { organizationId: "org" })).get("p")!
    expect(partial).toMatchObject({ daysWithData: 2, expectedDays: 4, coverage: 0.5 })
  })

  it("5x2 explícito seg–sex: 5 programados, 2 folgas; 5x2 com folga ter/qua trabalha no fim de semana", async () => {
    const db = fakeDb({ days: [...weekDays("classico", [0, 6]), ...weekDays("invertido", [2, 3])] }, tz)
    const eligibility = await resolveEligibleDaysBySubject(db, ["classico", "invertido"], week, tz)
    expect(eligibility.get("classico")).toMatchObject({ scheduledWorkDays: 5, eligibleDays: 5, excludedByScheduledDayOff: 2 })
    expect(eligibility.get("invertido")!.eligibleDates).toEqual(["2026-09-07", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"])
  })

  it("status × escala: escala diz trabalha + INSS = não elegível; folga + EM_PRODUCAO = não elegível; sábado + EM_PRODUCAO = elegível", async () => {
    const db = fakeDb({ days: weekDays("p", [3]), periods: [{ personId: "p", status: "INSS", from: "2026-09-08", to: "2026-09-08" }, { personId: "p", status: "EM_PRODUCAO", from: "2026-09-09", to: null }] }, tz)
    const eligibility = (await resolveEligibleDaysBySubject(db, ["p"], week, tz)).get("p")!
    expect(eligibility.eligibleDates).not.toContain("2026-09-08") // terça: escala trabalha, INSS
    expect(eligibility.eligibleDates).not.toContain("2026-09-09") // quarta: EM_PRODUCAO, folga programada
    expect(eligibility.eligibleDates).toContain("2026-09-12") // sábado: EM_PRODUCAO + programado
    expect(eligibility).toMatchObject({ excludedByStatus: { INSS: 1 }, excludedByScheduledDayOff: 1, eligibleDays: 5 })
  })

  it("MATERNIDADE + escala diz trabalha na terça → não elegível (status vence)", async () => {
    const db = fakeDb({ days: weekDays("p", [0]), periods: [{ personId: "p", status: "MATERNIDADE", from: "2026-08-01", to: null }] }, tz)
    const eligibility = (await resolveEligibleDaysBySubject(db, ["p"], week, tz)).get("p")!
    // Precedência única: situação vence escala — a causa é contada UMA vez por dia (7 dias, inclusive a folga).
    expect(eligibility).toMatchObject({ scheduledWorkDays: 6, eligibleDays: 0, excludedByStatus: { MATERNIDADE: 7 }, excludedByScheduledDayOff: 0 })
  })

  it("janela só com folgas programadas → NO_ELIGIBLE_DAYS (não 0, não Q4)", async () => {
    const db = fakeDb({ days: weekDays("p", [0, 1, 2, 3, 4, 5, 6]), tma: { p: WEEK } }, tz)
    const result = await evaluateDataCondition(db, { historicalQuery: { ...QUERY, period: { kind: "ROLLING_DAYS", days: 7 } }, comparator: "GT", thresholdNumeric: 300 }, { operatorId: "p", subjectIds: ["p"] }, NOW, { organizationId: "org", timeZone: tz })
    expect(result?.branch).toBe("no_data")
    expect(result?.evaluation).toMatchObject({ reason: "NO_ELIGIBLE_DAYS" })
  })

  it("regime 6x1 conhecido SEM folga informada: a INIA não inventa seg–sex — dias desconhecidos ficam fora e o motivo é WORK_SCHEDULE_UNKNOWN", async () => {
    const db = fakeDb({ regimes: [{ personId: "p", type: "SIX_BY_ONE" }] }, tz)
    const eligibility = (await resolveEligibleDaysBySubject(db, ["p"], week, tz)).get("p")!
    expect(eligibility).toMatchObject({ calendarDays: 7, scheduledWorkDays: 0, eligibleDays: 0, excludedByUnknownSchedule: 7 })
    expect(eligibility.scheduleConfidence).toMatchObject({ basis: "UNKNOWN_SCHEDULE", scheduleType: "SIX_BY_ONE", unknownScheduleDays: 7 })
    const result = await evaluateDataCondition(db, { historicalQuery: { ...QUERY, period: { kind: "ROLLING_DAYS", days: 7 } }, comparator: "GT", thresholdNumeric: 300 }, { operatorId: "p", subjectIds: ["p"] }, NOW, { organizationId: "org", timeZone: tz })
    expect(result?.branch).toBe("no_data")
    expect(result?.evaluation.reason).toBe("NO_ELIGIBLE_DAYS")
  })

  it("regime 6x1 com calendário parcial: dias com linha usam a escala; dias sem linha são desconhecidos (nunca folga, nunca seg–sex)", async () => {
    const db = fakeDb({ regimes: [{ personId: "p", type: "SIX_BY_ONE" }], days: weekDays("p", [3]).slice(0, 4) }, tz) // só seg–qui informados
    const eligibility = (await resolveEligibleDaysBySubject(db, ["p"], week, tz)).get("p")!
    expect(eligibility).toMatchObject({ scheduledWorkDays: 3, eligibleDays: 3, excludedByScheduledDayOff: 1, excludedByUnknownSchedule: 3 })
    expect(eligibility.scheduleConfidence.basis).toBe("MIXED")
  })

  it("regime 5x2 conhecido sem calendário: seg–sex como compatibilidade (mesma presunção do fallback), marcado como fallback", async () => {
    const db = fakeDb({ regimes: [{ personId: "p", type: "FIVE_BY_TWO" }] }, tz)
    const eligibility = (await resolveEligibleDaysBySubject(db, ["p"], week, tz)).get("p")!
    expect(eligibility).toMatchObject({ scheduledWorkDays: 5, eligibleDays: 5, excludedByScheduledDayOff: 2 })
    expect(eligibility.scheduleConfidence).toMatchObject({ basis: "LEGACY_WEEKDAY_FALLBACK", scheduleType: "FIVE_BY_TWO" })
  })

  it("data da organização com política EXCLUDE: vira folga SÓ no fallback legado; escala explícita 'trabalha' vence o feriado", async () => {
    const db = fakeDb({ holidays: ["2026-09-07"], policy: "EXCLUDE_APPLICABLE_HOLIDAYS", days: weekDays("escalado", [0]) }, tz)
    const eligibility = await resolveEligibleDaysBySubject(db, ["fallback", "escalado"], week, tz)
    expect(eligibility.get("fallback")).toMatchObject({ scheduledWorkDays: 4, eligibleDays: 4, excludedByHoliday: 1, excludedByScheduledDayOff: 2 })
    expect(eligibility.get("fallback")!.eligibleDates).not.toContain("2026-09-07")
    expect(eligibility.get("escalado")).toMatchObject({ scheduledWorkDays: 6, eligibleDays: 6, excludedByHoliday: 0 })
    expect(eligibility.get("escalado")!.eligibleDates).toContain("2026-09-07")
  })

  it("política IGNORE (default): feriado não altera o dia do fallback — comportamento anterior preservado", async () => {
    const db = fakeDb({ holidays: ["2026-09-07"] }, tz)
    const eligibility = (await resolveEligibleDaysBySubject(db, ["fallback"], week, tz)).get("fallback")!
    expect(eligibility).toMatchObject({ scheduledWorkDays: 5, eligibleDays: 5, excludedByHoliday: 0, holidayConfidence: { policy: "IGNORE", applicableHolidayDays: 1 } })
    expect(eligibility.eligibleDates).toContain("2026-09-07")
  })

  it("escala explícita com folga no feriado: excluída UMA vez (folga programada), não duas", async () => {
    const db = fakeDb({ holidays: ["2026-09-07"], days: weekDays("p", [1]) }, tz)
    const eligibility = (await resolveEligibleDaysBySubject(db, ["p"], week, tz)).get("p")!
    expect(eligibility).toMatchObject({ calendarDays: 7, scheduledWorkDays: 6, excludedByScheduledDayOff: 1, excludedByHoliday: 0 })
  })
})

describe("exceções individuais de calendário (banco de horas, day off, folga extraordinária)", () => {
  const tz = "America/Fortaleza"
  const NOW = new Date("2026-09-13T23:59:59-03:00") // domingo 13/09, fim do dia
  const week = resolveTimeWindow({ kind: "ROLLING_DAYS", days: 7 }, NOW, tz) // seg 07/09 → dom 13/09
  const FULL_WEEK = { ...WEEK, "2026-09-12": 415, "2026-09-13": 425 }
  const measure = async (db: Database) => (await resolveOperationalWindowBySubject(db, { indicatorCode: "TMA", subjectIds: ["p"], window: week, aggregation: "WEIGHTED_AVERAGE", expectedDays: 7, timeZone: tz }, { organizationId: "org" })).get("p")!

  it.each(["DAY_OFF", "BANCO_HORAS", "FOLGA_EXTRAORDINARIA"] as const)("%s vence a escala 'trabalha': dia sai do denominador e a medição daquele dia sai do valor (sem ser apagada)", async (code) => {
    const db = fakeDb({ days: weekDays("p", [0]), exceptions: [{ personId: "p", date: "2026-09-09", code }], tma: { p: { ...FULL_WEEK, "2026-09-09": 900 } } }, tz)
    const eligibility = (await resolveEligibleDaysBySubject(db, ["p"], week, tz)).get("p")!
    expect(eligibility).toMatchObject({ calendarDays: 7, scheduledWorkDays: 6, eligibleDays: 5, excludedByScheduleException: { [code]: 1 }, excludedByScheduledDayOff: 1 })
    expect(eligibility.eligibleDates).not.toContain("2026-09-09")
    const result = await measure(db)
    // 5 dias elegíveis com medição; a quarta (TMA 900) e o domingo (folga) ficam de fora: ignoradas, não apagadas.
    expect(result).toMatchObject({ daysWithData: 5, expectedDays: 5, coverage: 1, ignoredMeasurements: 2 })
    expect(result.value).toBeCloseTo((400 + 420 + 430 + 405 + 415) / 5, 1)
  })

  it("FÉRIAS + DAY_OFF no mesmo dia: uma única exclusão efetiva (situação vence, exceção não conta de novo)", async () => {
    const db = fakeDb({ days: weekDays("p", [0]), periods: [{ personId: "p", status: "FERIAS", from: "2026-09-09", to: "2026-09-09" }], exceptions: [{ personId: "p", date: "2026-09-09", code: "DAY_OFF" }] }, tz)
    const eligibility = (await resolveEligibleDaysBySubject(db, ["p"], week, tz)).get("p")!
    expect(eligibility).toMatchObject({ eligibleDays: 5, excludedByStatus: { FERIAS: 1 }, excludedByScheduleException: {}, excludedByScheduledDayOff: 1 })
    const total = eligibility.eligibleDays + eligibility.excludedBeforeHire + Object.values(eligibility.excludedByStatus).reduce((a, b) => a + b, 0) + Object.values(eligibility.excludedByScheduleException).reduce((a, b) => a + b, 0) + eligibility.excludedByScheduledDayOff + eligibility.excludedByHoliday + eligibility.excludedByUnknownSchedule
    expect(total).toBe(7) // totais fecham
  })

  it("exceção cancelada (active = false) não tem efeito — a linha fica, o dia volta a ser elegível", async () => {
    const db = fakeDb({ days: weekDays("p", [0]), exceptions: [{ personId: "p", date: "2026-09-09", code: "DAY_OFF", active: false }] }, tz)
    expect((await resolveEligibleDaysBySubject(db, ["p"], week, tz)).get("p")).toMatchObject({ eligibleDays: 6, excludedByScheduleException: {} })
  })

  it("exceção em dia que já era folga programada: precedência definida (exceção antes da escala) — UMA exclusão, o dia programado não muda", async () => {
    const db = fakeDb({ days: weekDays("p", [3]), exceptions: [{ personId: "p", date: "2026-09-09", code: "BANCO_HORAS" }] }, tz)
    expect((await resolveEligibleDaysBySubject(db, ["p"], week, tz)).get("p")).toMatchObject({ scheduledWorkDays: 6, eligibleDays: 6, excludedByScheduledDayOff: 0, excludedByScheduleException: { BANCO_HORAS: 1 } })
  })
})

describe("medição × calendário: só data ELEGÍVEL entra no cálculo (folga, day off, banco, férias, INSS, sábado, domingo, feriado, correção)", () => {
  const tz = "America/Fortaleza"
  const NOW = new Date("2026-09-13T23:59:59-03:00")
  const week = resolveTimeWindow({ kind: "ROLLING_DAYS", days: 7 }, NOW, tz)
  const FULL_WEEK = { ...WEEK, "2026-09-12": 415, "2026-09-13": 425 }
  const measure = async (db: Database, aggregation: "WEIGHTED_AVERAGE" | "AVERAGE" | "SUM" | "LATEST" | "COUNT" = "WEIGHTED_AVERAGE") => (await resolveOperationalWindowBySubject(db, { indicatorCode: "TMA", subjectIds: ["p"], window: week, aggregation, expectedDays: 7, timeZone: tz }, { organizationId: "org" })).get("p")

  it("folga programada (6x1 quarta) com TMA 900 na quarta: preservada, ignorada — média usa só os 6 dias programados", async () => {
    const db = fakeDb({ days: weekDays("p", [3]), tma: { p: { ...FULL_WEEK, "2026-09-09": 900 } } }, tz)
    const result = (await measure(db))!
    expect(result).toMatchObject({ daysWithData: 6, expectedDays: 6, coverage: 1, ignoredMeasurements: 1, sampleCount: 6 })
    expect(result.value).toBeCloseTo((400 + 420 + 430 + 405 + 415 + 425) / 6, 1)
  })

  it("sábado e domingo programados (6x1) entram; feriado com escala explícita 'trabalha' entra", async () => {
    const db = fakeDb({ capital: { p: "FORTALEZA" }, catalog: [{ date: "2026-09-07", scope: "NATIONAL", name: "Independência" }], policy: "EXCLUDE_APPLICABLE_HOLIDAYS", days: weekDays("p", [3]), tma: { p: FULL_WEEK } }, tz)
    const eligibility = (await resolveEligibleDaysBySubject(db, ["p"], week, tz)).get("p")!
    expect(eligibility.eligibleDates).toEqual(expect.arrayContaining(["2026-09-07", "2026-09-12", "2026-09-13"]))
    expect(eligibility).toMatchObject({ excludedByHoliday: 0, holidayConfidence: { confidence: "CAPITAL_KNOWN", applicableHolidayDays: 1 } })
    expect((await measure(db))!).toMatchObject({ daysWithData: 6, ignoredMeasurements: 1 })
  })

  it.each([["FERIAS"], ["INSS"]] as const)("%s na quarta: medição da quarta ignorada (mesma regra da situação funcional)", async (status) => {
    const db = fakeDb({ periods: [{ personId: "p", status, from: "2026-09-09", to: "2026-09-09" }], tma: { p: { ...WEEK, "2026-09-09": 900 } } }, tz)
    const result = (await measure(db))!
    expect(result).toMatchObject({ daysWithData: 4, expectedDays: 4, coverage: 1, ignoredMeasurements: 1 })
    expect(result.value).toBeCloseTo((400 + 420 + 430 + 405) / 4, 1)
  })

  it("todas as estratégias respeitam a elegibilidade: AVERAGE, SUM, LATEST e COUNT ignoram o dia de folga", async () => {
    const db = fakeDb({ days: weekDays("p", [0, 6]), tma: { p: { ...WEEK, "2026-09-12": 999, "2026-09-13": 999 } } }, tz)
    expect((await measure(db, "AVERAGE"))!.value).toBeCloseTo((400 + 420 + 410 + 430 + 405) / 5, 1)
    expect((await measure(db, "SUM"))!.value).toBe(400 + 420 + 410 + 430 + 405)
    // LATEST operacional = último valor EM DATA ELEGÍVEL (sexta 405), não a última linha física (domingo 999).
    expect((await measure(db, "LATEST"))!.value).toBe(405)
    expect((await measure(db, "COUNT"))!.value).toBe(5)
  })

  it("correção de escala: quarta 'trabalha' → 'folga' tira a medição do cálculo; reverter para 'trabalha' traz de volta — a linha nunca foi apagada", async () => {
    const tma = { p: { ...WEEK, "2026-09-09": 900 } }
    const before = (await measure(fakeDb({ days: weekDays("p", [0, 6]), tma }, tz)))!
    expect(before).toMatchObject({ daysWithData: 5, ignoredMeasurements: 0 })
    const corrected = (await measure(fakeDb({ days: weekDays("p", [0, 3, 6]), tma }, tz)))!
    expect(corrected).toMatchObject({ daysWithData: 4, expectedDays: 4, coverage: 1, ignoredMeasurements: 1 })
    expect(corrected.value).toBeCloseTo((400 + 420 + 430 + 405) / 4, 1)
    const reverted = (await measure(fakeDb({ days: weekDays("p", [0, 6]), tma }, tz)))!
    expect(reverted).toMatchObject({ daysWithData: 5, ignoredMeasurements: 0 })
    expect(reverted.value).toBe(before.value)
  })

  it("cobertura e agregado olham o MESMO universo: 7 dias, 1 folga, 1 day off, 1 INSS → 4 elegíveis; 4 medições elegíveis + 2 extras = 100% e média só dos 4", async () => {
    const db = fakeDb({
      days: weekDays("p", [0]),
      exceptions: [{ personId: "p", date: "2026-09-10", code: "DAY_OFF" }],
      periods: [{ personId: "p", status: "INSS", from: "2026-09-11", to: "2026-09-11" }],
      tma: { p: { "2026-09-07": 400, "2026-09-08": 420, "2026-09-09": 410, "2026-09-10": 900, "2026-09-11": 900, "2026-09-12": 415 } },
    }, tz)
    const eligibility = (await resolveEligibleDaysBySubject(db, ["p"], week, tz)).get("p")!
    expect(eligibility).toMatchObject({ calendarDays: 7, scheduledWorkDays: 6, eligibleDays: 4, excludedByScheduledDayOff: 1, excludedByScheduleException: { DAY_OFF: 1 }, excludedByStatus: { INSS: 1 } })
    const result = (await measure(db))!
    expect(result).toMatchObject({ daysWithData: 4, expectedDays: 4, coverage: 1, ignoredMeasurements: 2 })
    expect(result.value).toBeCloseTo((400 + 420 + 410 + 415) / 4, 1)
  })
})

describe("capital operacional × feriados aplicáveis (catálogo-base)", () => {
  const tz = "America/Fortaleza"
  const NOW = new Date("2026-09-13T23:59:59-03:00")
  const week = resolveTimeWindow({ kind: "ROLLING_DAYS", days: 7 }, NOW, tz)
  const CATALOG = [
    { date: "2026-09-07", scope: "NATIONAL" as const, name: "Independência do Brasil" },
    { date: "2026-09-08", scope: "STATE" as const, stateCode: "CE", name: "Feriado do Ceará (fixture)" },
    { date: "2026-09-09", scope: "MUNICIPAL_CAPITAL" as const, capitalCode: "FORTALEZA", name: "Feriado de Fortaleza (fixture)" },
    { date: "2026-09-10", scope: "STATE" as const, stateCode: "PE", name: "Feriado de Pernambuco (fixture)" },
  ]

  it("NATIONAL vale para todos; STATE só para a UF derivada da capital; MUNICIPAL só para a própria capital", async () => {
    const db = fakeDb({ catalog: CATALOG, policy: "EXCLUDE_APPLICABLE_HOLIDAYS", capital: { fortaleza: "FORTALEZA", recife: "RECIFE", salvador: "SALVADOR" } }, tz)
    const eligibility = await resolveEligibleDaysBySubject(db, ["fortaleza", "recife", "salvador"], week, tz)
    expect(eligibility.get("fortaleza")).toMatchObject({ excludedByHoliday: 3, eligibleDays: 2, holidayConfidence: { confidence: "CAPITAL_KNOWN", applicableHolidayDays: 3 } })
    expect(eligibility.get("recife")).toMatchObject({ excludedByHoliday: 2, eligibleDays: 3 }) // nacional + PE; CE e Fortaleza não valem
    expect(eligibility.get("salvador")).toMatchObject({ excludedByHoliday: 1, eligibleDays: 4 }) // só o nacional
  })

  it("sem capital operacional: só o feriado nacional é conhecido; estadual/municipal NÃO são inferidos (CAPITAL_UNKNOWN)", async () => {
    const db = fakeDb({ catalog: CATALOG, policy: "EXCLUDE_APPLICABLE_HOLIDAYS" }, tz)
    const eligibility = (await resolveEligibleDaysBySubject(db, ["semcapital"], week, tz)).get("semcapital")!
    expect(eligibility).toMatchObject({ excludedByHoliday: 1, eligibleDays: 4, holidayConfidence: { confidence: "CAPITAL_UNKNOWN", operationalCapitalCode: null, applicableHolidayDays: 1 } })
  })

  it("escala explícita vence qualquer feriado aplicável, mesmo com política EXCLUDE; política IGNORE não altera o fallback", async () => {
    const exclude = fakeDb({ catalog: CATALOG, policy: "EXCLUDE_APPLICABLE_HOLIDAYS", capital: { escalado: "FORTALEZA", fallback: "FORTALEZA" }, days: weekDays("escalado", [0]) }, tz)
    const withExclude = await resolveEligibleDaysBySubject(exclude, ["escalado", "fallback"], week, tz)
    expect(withExclude.get("escalado")).toMatchObject({ eligibleDays: 6, excludedByHoliday: 0 })
    expect(withExclude.get("fallback")).toMatchObject({ eligibleDays: 2, excludedByHoliday: 3 })
    const ignore = fakeDb({ catalog: CATALOG, policy: "IGNORE", capital: { fallback: "FORTALEZA" } }, tz)
    expect((await resolveEligibleDaysBySubject(ignore, ["fallback"], week, tz)).get("fallback")).toMatchObject({ eligibleDays: 5, excludedByHoliday: 0, holidayConfidence: { applicableHolidayDays: 3 } })
  })
})

describe("PLANEJADO × OBSERVADO — evidência de produção supera o plano; situação funcional continua soberana; sem circularidade", () => {
  const tz = "America/Fortaleza"
  const NOW = new Date("2026-09-13T23:59:59-03:00")
  const window = resolveTimeWindow({ kind: "ROLLING_DAYS", days: 7 }, NOW, tz) // seg 07/09 → dom 13/09
  const WEEK7 = { ...WEEK, "2026-09-12": 450, "2026-09-13": 460 }

  it("day off + produção (interação) → dia TRABALHADO: elegível, medição volta ao cálculo, exceção registrada como divergência (nunca apagada)", async () => {
    const db = fakeDb({ days: weekDays("p", [0, 6]), exceptions: [{ personId: "p", date: "2026-09-09", code: "DAY_OFF" }], tma: { p: WEEK }, interactions: { p: { "2026-09-09": 4 } } }, tz)
    const eligibility = (await resolveEligibleDaysBySubject(db, ["p"], window, tz, { now: NOW })).get("p")!
    expect(eligibility.eligibleDays).toBe(5)
    expect(eligibility.excludedByScheduleException).toEqual({})
    expect(eligibility.observed).toMatchObject({ workedObservedDays: 1, observedDates: ["2026-09-09"], workedDespitePlan: { exception: { DAY_OFF: 1 }, scheduledDayOff: 0, holiday: 0, unknownSchedule: 0 }, productionWithNonEligibleStatusDays: 0 })
    expect(eligibility.observed.evidenceSources).toEqual({ interactions: true, indicatorCodes: [] })
    const value = (await resolveOperationalWindowBySubject(db, { indicatorCode: "TMA", subjectIds: ["p"], window, aggregation: "WEIGHTED_AVERAGE", timeZone: tz, now: NOW, expectedDays: 5 }, { organizationId: "org" })).get("p")!
    expect(value.daysWithData).toBe(5)
    expect(value.ignoredMeasurements).toBe(0)
    expect(value.value).toBeCloseTo((400 + 420 + 410 + 430 + 405) / 5, 1)
  })

  it("day off + SEM produção → dia não elegível, medição daquele dia ignorada (raw preservada) — como antes", async () => {
    const db = fakeDb({ days: weekDays("p", [0, 6]), exceptions: [{ personId: "p", date: "2026-09-09", code: "DAY_OFF" }], tma: { p: WEEK }, interactions: { p: { "2026-09-08": 1 } } }, tz)
    const eligibility = (await resolveEligibleDaysBySubject(db, ["p"], window, tz, { now: NOW })).get("p")!
    expect(eligibility.eligibleDays).toBe(4)
    expect(eligibility.excludedByScheduleException).toEqual({ DAY_OFF: 1 })
    const value = (await resolveOperationalWindowBySubject(db, { indicatorCode: "TMA", subjectIds: ["p"], window, aggregation: "WEIGHTED_AVERAGE", timeZone: tz, now: NOW, expectedDays: 4 }, { organizationId: "org" })).get("p")!
    expect(value.ignoredMeasurements).toBe(1)
  })

  it("banco de horas + produção e folga 6x1 (domingo explícito) + produção → ambos elegíveis observados, com a divergência classificada", async () => {
    const db = fakeDb({ days: weekDays("p", [0]), regimes: [{ personId: "p", type: "SIX_BY_ONE" }], exceptions: [{ personId: "p", date: "2026-09-10", code: "BANCO_HORAS" }], tma: { p: WEEK7 }, interactions: { p: { "2026-09-10": 2, "2026-09-13": 1 } } }, tz)
    const eligibility = (await resolveEligibleDaysBySubject(db, ["p"], window, tz, { now: NOW })).get("p")!
    expect(eligibility.eligibleDays).toBe(7)
    expect(eligibility.observed.workedDespitePlan).toEqual({ exception: { BANCO_HORAS: 1 }, scheduledDayOff: 1, holiday: 0, unknownSchedule: 0 })
    expect(eligibility.excludedByScheduledDayOff).toBe(0)
  })

  it("INSS/FÉRIAS + produção → NÃO elegível + conflito contado; a medição fica fora do cálculo e a situação não muda", async () => {
    const db = fakeDb({ periods: [{ personId: "p", status: "INSS", from: "2026-09-09", to: "2026-09-10" }, { personId: "f", status: "FERIAS", from: "2026-09-07", to: "2026-09-13" }], tma: { p: WEEK, f: WEEK }, interactions: { p: { "2026-09-09": 3 }, f: { "2026-09-08": 2 } } }, tz)
    const eligibility = await resolveEligibleDaysBySubject(db, ["p", "f"], window, tz, { now: NOW })
    expect(eligibility.get("p")).toMatchObject({ eligibleDays: 3, excludedByStatus: { INSS: 2 } })
    expect(eligibility.get("p")!.observed.productionWithNonEligibleStatusDays).toBe(1)
    expect(eligibility.get("f")).toMatchObject({ eligibleDays: 0, excludedByStatus: { FERIAS: 7 } })
    expect(eligibility.get("f")!.observed.productionWithNonEligibleStatusDays).toBe(1)
    const values = await resolveOperationalWindowBySubject(db, { indicatorCode: "TMA", subjectIds: ["p", "f"], window, aggregation: "WEIGHTED_AVERAGE", timeZone: tz, now: NOW, expectedDays: 5 }, { organizationId: "org" })
    expect(values.get("p")!.ignoredMeasurements).toBe(2)
    expect(values.get("f")).toBeUndefined() // zero dias elegíveis: fora da população, nunca 0/Q4
  })

  it("ANTICIRCULARIDADE: o indicador em cálculo (TMA) só prova o dia se estiver marcado como evidência — sem marca, day off com TMA continua não elegível; com marca, entra", async () => {
    const fixture = { days: weekDays("p", [0, 6]), exceptions: [{ personId: "p", date: "2026-09-09", code: "DAY_OFF" as const }], tma: { p: WEEK } }
    const unmarked = (await resolveEligibleDaysBySubject(fakeDb(fixture, tz), ["p"], window, tz, { now: NOW })).get("p")!
    expect(unmarked.eligibleDays).toBe(4)
    expect(unmarked.observed).toMatchObject({ workedObservedDays: 0, evidenceSources: { interactions: false, indicatorCodes: [] } })
    const marked = (await resolveEligibleDaysBySubject(fakeDb({ ...fixture, provingIndicators: ["TMA"] }, tz), ["p"], window, tz, { now: NOW })).get("p")!
    expect(marked.eligibleDays).toBe(5)
    expect(marked.observed).toMatchObject({ workedObservedDays: 5, workedDespitePlan: { exception: { DAY_OFF: 1 } }, evidenceSources: { interactions: false, indicatorCodes: ["TMA"] } })
    // Outro indicador marcado (VOLUME) prova o dia sem que o TMA precise estar marcado.
    const other = (await resolveEligibleDaysBySubject(fakeDb({ ...fixture, provingIndicators: ["VOLUME"], evidenceMeasurements: { VOLUME: { p: ["2026-09-09"] } } }, tz), ["p"], window, tz, { now: NOW })).get("p")!
    expect(other.eligibleDays).toBe(5)
    expect(other.observed.observedDates).toEqual(["2026-09-09"])
  })

  const CLOSED_FEED = { contract: "INTERACTIONS" as const, policy: { lagDays: 1, availableByLocalTime: "11:00" }, lastSuccessAt: "2026-09-13T23:00:00-03:00" }

  it("programado sem produção: turno encerrado + fontes configuradas e FECHADAS → MISSING_EXPECTED_PRODUCTION contado (continua elegível); sem fonte → nada a cobrar", async () => {
    const withSources = (await resolveEligibleDaysBySubject(fakeDb({ days: weekDays("p", [0, 6]), interactions: { p: { "2026-09-07": 1, "2026-09-08": 1 } }, availabilityFeeds: [CLOSED_FEED] }, tz), ["p"], window, tz, { now: NOW })).get("p")!
    expect(withSources).toMatchObject({ eligibleDays: 5 })
    expect(withSources.observed).toMatchObject({ workedObservedDays: 2, missingExpectedProductionDays: 3, missingExpectedProductionDates: ["2026-09-09", "2026-09-10", "2026-09-11"] })
    const noSources = (await resolveEligibleDaysBySubject(fakeDb({ days: weekDays("p", [0, 6]), availabilityFeeds: [CLOSED_FEED] }, tz), ["p"], window, tz, { now: NOW })).get("p")!
    expect(noSources.observed).toMatchObject({ workedObservedDays: 0, missingExpectedProductionDays: 0 })
    // Dia de HOJE com turno em curso (sem shift_end informado): ainda não cobra.
    const today = (await resolveEligibleDaysBySubject(fakeDb({ days: weekDays("p", []), interactions: { p: { "2026-09-07": 1 } }, availabilityFeeds: [CLOSED_FEED] }, tz), ["p"], resolveTimeWindow({ kind: "ROLLING_DAYS", days: 1 }, new Date("2026-09-13T10:00:00-03:00"), tz), tz, { now: new Date("2026-09-13T10:00:00-03:00") })).get("p")!
    expect(today.observed.missingExpectedProductionDays).toBe(0)
  })

  it("FIM DO TURNO ≠ DADO FECHADO: sem política de disponibilidade nada é cobrado; D-1 dentro do prazo → aguardando; prazo vencido sem carga → fonte atrasada (nunca falta)", async () => {
    const fixture = { days: weekDays("p", [0, 6]), interactions: { p: { "2026-09-07": 1 } } }
    const unknown = (await resolveEligibleDaysBySubject(fakeDb(fixture, tz), ["p"], window, tz, { now: NOW })).get("p")!
    expect(unknown.observed).toMatchObject({ missingExpectedProductionDays: 0, waitingForSourcesDays: 0, dataSourceDelayDays: 0 })
    expect(unknown.eligibleDays).toBe(5)
    // Avaliado sábado 12/09 às 10:00: 07–09 já venceram (D+1 11:00) e a carga de 10/09 12:00 os cobre → prontos; 10/09 venceu sexta 11:00 sem carga → fonte atrasada; 11/09 (turno encerrado) vence sábado 11:00 → aguardando.
    const nowSaturday = new Date("2026-09-12T10:00:00-03:00")
    const waiting = (await resolveEligibleDaysBySubject(fakeDb({ ...fixture, availabilityFeeds: [{ ...CLOSED_FEED, lastSuccessAt: "2026-09-10T12:00:00-03:00" }] }, tz), ["p"], window, tz, { now: nowSaturday })).get("p")!
    expect(waiting.observed).toMatchObject({ workedObservedDays: 1, missingExpectedProductionDays: 2, missingExpectedProductionDates: ["2026-09-08", "2026-09-09"], waitingForSourcesDays: 1, dataSourceDelayDays: 1 })
    expect(waiting.eligibleDays).toBe(5)
    // Domingo à noite: todos os prazos venceram, mas a última carga foi 10/09 12:00 → 10 e 11/09 não foram entregues: FONTE ATRASADA, não ausência.
    const delayed = (await resolveEligibleDaysBySubject(fakeDb({ ...fixture, availabilityFeeds: [{ ...CLOSED_FEED, lastSuccessAt: "2026-09-10T12:00:00-03:00" }] }, tz), ["p"], window, tz, { now: NOW })).get("p")!
    expect(delayed.observed).toMatchObject({ missingExpectedProductionDays: 2, dataSourceDelayDays: 2, waitingForSourcesDays: 0 })
    // RH D-2 08:00 ainda no prazo para 11/09 (vence domingo 08:00 → já venceu às 23:59 de domingo; para 12/09 nem entra: folga). Com RH lag 3 → 11/09 ainda aguarda RH.
    const rh = (await resolveEligibleDaysBySubject(fakeDb({ ...fixture, availabilityFeeds: [CLOSED_FEED, { contract: "EMPLOYEES", policy: { lagDays: 3, availableByLocalTime: "08:00" }, lastSuccessAt: "2026-09-13T23:00:00-03:00" }] }, tz), ["p"], window, tz, { now: NOW })).get("p")!
    expect(rh.observed).toMatchObject({ missingExpectedProductionDays: 3, waitingForSourcesDays: 1 })
  })

  it("CLASSIFICAÇÃO humana: falta injustificada continua elegível (dia esperado); ausência justificada sai; dados não chegaram continua; produção real vence a classificação", async () => {
    const fixture = { days: weekDays("p", [0, 6]), interactions: { p: { "2026-09-07": 1 } }, availabilityFeeds: [CLOSED_FEED] }
    const classified = (await resolveEligibleDaysBySubject(fakeDb({ ...fixture, classifications: [{ personId: "p", date: "2026-09-08", classification: "UNJUSTIFIED_ABSENCE" }, { personId: "p", date: "2026-09-09", classification: "JUSTIFIED_ABSENCE", reasonCode: "ATESTADO" }, { personId: "p", date: "2026-09-10", classification: "WORKED_DATA_MISSING" }] }, tz), ["p"], window, tz, { now: NOW })).get("p")!
    expect(classified).toMatchObject({ eligibleDays: 4, excludedByScheduleException: { ATESTADO: 1 } })
    expect(classified.observed).toMatchObject({ unjustifiedAbsenceDays: 1, unjustifiedAbsenceDates: ["2026-09-08"], justifiedAbsenceDays: 1, workedDataMissingDays: 1, missingExpectedProductionDays: 1 })
    // Atestado posterior: 08/09 deixa de ser falta injustificada → sai do universo; nenhuma medição foi apagada (não há medição).
    const revised = (await resolveEligibleDaysBySubject(fakeDb({ ...fixture, classifications: [{ personId: "p", date: "2026-09-08", classification: "JUSTIFIED_ABSENCE", reasonCode: "ATESTADO" }] }, tz), ["p"], window, tz, { now: NOW })).get("p")!
    expect(revised).toMatchObject({ eligibleDays: 4 })
    expect(revised.observed.unjustifiedAbsenceDays).toBe(0)
    // Produção tardia em 08/09: trabalhou — a classificação (ainda vigente no banco) fica contrariada, o dia conta como trabalhado.
    const late = (await resolveEligibleDaysBySubject(fakeDb({ ...fixture, interactions: { p: { "2026-09-07": 1, "2026-09-08": 2 } }, classifications: [{ personId: "p", date: "2026-09-08", classification: "UNJUSTIFIED_ABSENCE" }] }, tz), ["p"], window, tz, { now: NOW })).get("p")!
    expect(late.observed).toMatchObject({ workedObservedDays: 2, unjustifiedAbsenceDays: 0 })
  })

  it("totais fecham com o observado: calendário = admissão + situação + exceção + desconhecido + folga + feriado + elegíveis (observados inclusos)", async () => {
    const db = fakeDb({ days: weekDays("p", [0, 6]), regimes: [{ personId: "p", type: "FIVE_BY_TWO" }], exceptions: [{ personId: "p", date: "2026-09-09", code: "ATESTADO" }, { personId: "p", date: "2026-09-10", code: "DAY_OFF" }], periods: [{ personId: "p", status: "INSS", from: "2026-09-11", to: "2026-09-11" }], tma: { p: WEEK }, interactions: { p: { "2026-09-10": 1, "2026-09-12": 1 } } }, tz)
    const e = (await resolveEligibleDaysBySubject(db, ["p"], window, tz, { now: NOW })).get("p")!
    const sum = e.excludedBeforeHire + Object.values(e.excludedByStatus).reduce((a, b) => a + (b ?? 0), 0) + Object.values(e.excludedByScheduleException).reduce((a, b) => a + (b ?? 0), 0) + e.excludedByUnknownSchedule + e.excludedByScheduledDayOff + e.excludedByHoliday + e.eligibleDays
    expect(sum).toBe(e.calendarDays)
    expect(e).toMatchObject({ eligibleDays: 4, excludedByScheduleException: { ATESTADO: 1 }, excludedByStatus: { INSS: 1 }, excludedByScheduledDayOff: 1 })
    expect(e.observed.workedDespitePlan).toEqual({ exception: { DAY_OFF: 1 }, scheduledDayOff: 1, holiday: 0, unknownSchedule: 0 })
  })
})
