import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { buildEmployeeOperationalTrends, buildStructureOperationalSummary } from "../../performance-analytics/application/operational-trend.js"
import { NON_ELIGIBLE_EMPLOYMENT_STATUSES } from "../../people/domain/employment-status.js"
import { evaluateDataCondition, type NoDataReason } from "../../workflows/application/condition-evaluator.js"
import { resolveOperationalQuartiles } from "../../workflows/application/operational-quartile-resolver.js"
import { runEmployeeRanking } from "../../workflows/application/select-employees-executor.js"
import { resolveTimeWindow } from "../../workflows/application/time-window.js"
import { resolveEligibleDaysBySubject } from "../application/operational-measurement-resolver.js"

/**
 * PROVA CONSOLIDADA — STALE / UNKNOWN em TODOS os consumidores (mesmo fake, mesma janela, mesmo relógio):
 * Condition (aggregate e quartil operacional), Ranking, quartil operacional, Analytics (perfil e
 * agregação da estrutura) e QA Lab (a prévia usa a MESMA `evaluateDataCondition` — paridade provada em
 * condition-preview-parity.test.ts). Cada motivo é distinto e NENHUM vira 0, Q4, "baixa performance" ou
 * ausência injustificada:
 *   NO_ELIGIBLE_DAYS        — não deveria produzir (férias/afastamento a janela inteira)
 *   EMPLOYMENT_STATUS_STALE — não sei se deveria (fonte de situação atrasada, dia presumido, sem medição)
 *   WORK_SCHEDULE_STALE     — não sei se deveria (fonte de escala atrasada, sem medição)
 *   WORK_SCHEDULE_UNKNOWN   — 6x1 sem folga informada e sem medição
 *   NO_VALUE                — deveria e não produziu (fontes confiáveis, sem medição)
 *   resultado real          — mediu: valor de verdade, mesmo com fonte atrasada (medição real nunca é invalidada).
 */
type Fixture = {
  periods?: { personId: string; status: string; from: string; to: string | null }[]
  days?: { personId: string; date: string; work: boolean }[]
  regimes?: { personId: string; type: "FIVE_BY_TWO" | "SIX_BY_ONE" }[]
  tma?: Record<string, Record<string, number>>
  /** Freshness das fontes da Central (última carga): STALE = 5 dias atrás (06/09) com cadência de 1 h; FRESH = 10 min atrás; ausente = sem feed (UNKNOWN). */
  statusFeed?: "STALE" | "FRESH"
  scheduleFeed?: "STALE" | "FRESH"
}

const TZ = "America/Fortaleza"
const ORG = "org"
const NOW = new Date("2026-09-11T23:59:59-03:00") // sexta 11/09, fim do dia (o fake filtra a janela por data civil exclusiva)
const WINDOW = resolveTimeWindow({ kind: "ROLLING_DAYS", days: 5 }, NOW, TZ) // seg 07 → sex 11
const WEEK = { "2026-09-07": 400, "2026-09-08": 420, "2026-09-09": 410, "2026-09-10": 430, "2026-09-11": 405 }
const QUERY = { kind: "INDICATOR_THRESHOLD_COUNT" as const, indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE" as const, source: "MEASUREMENT" as const, period: { kind: "ROLLING_DAYS" as const, days: 5 } }

function feedRow(contract: string, state: "STALE" | "FRESH") {
  const lastSuccess = new Date(NOW.getTime() - (state === "STALE" ? 5 * 24 * 60 : 10) * 60_000)
  return { feed_id: `feed-${contract}`, feed_name: contract, source_id: "src", source_name: "RH", source_kind: "API_PULL", contract_key: contract, source_namespace: "rh", authoritative: true, status: "ACTIVE", cadence: { kind: "INTERVAL", minutes: 60 }, expected_interval_minutes: 60, last_success_at: lastSuccess, last_data_at: lastSuccess }
}

function fakeDb(fixture: Fixture): Database {
  const inRanges = (ranges: { ids: string[]; from: string[]; to: string[] }, id: string, date: string) => ranges.ids.some((personId, index) => personId === id && ranges.from[index]! <= date && date <= ranges.to[index]!)
  const rowFor = (id: string, start: string, end: string, ranges: { ids: string[]; from: string[]; to: string[] }) => {
    const all = Object.entries(fixture.tma?.[id] ?? {}).filter(([date]) => date >= start.slice(0, 10) && date < end.slice(0, 10))
    const days = all.filter(([date]) => inRanges(ranges, id, date))
    if (all.length === 0) return null
    const sum = days.reduce((total, [, value]) => total + value, 0)
    return { avg_value: days.length ? String(sum / days.length) : null, min_value: null, max_value: null, sample_count: String(days.length), sum_value: String(sum), latest_value: null, weighted_sum: String(sum), weight_total: String(days.length), numerator_sum: String(sum), denominator_sum: String(days.length), rows_with_components: String(days.length), sample_total: String(days.length), days_with_data: String(days.length), ignored_count: String(all.length - days.length) }
  }
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("select timezone from operations")) return { rows: [{ timezone: TZ }], rowCount: 1 }
      if (sql.includes("from indicator_definitions where organization_id = $1 and active and daily_supported")) return { rows: [{ code: "TMA", name: "TMA", minimum_coverage: "0.600", minimum_sample_size: null }], rowCount: 1 }
      if (sql.includes("operational_aggregation, daily_supported from indicator_definitions")) return { rows: [{ id: "i", code: "TMA", unit: "SECONDS", desired_direction: "LOWER", operational_aggregation: "WEIGHTED_AVERAGE", daily_supported: true }], rowCount: 1 }
      if (sql.includes("desired_direction from indicator_definitions")) return { rows: [{ desired_direction: "LOWER" }], rowCount: 1 }
      if (sql.includes("hired_at::text hired_at, operational_capital_code from people")) return { rows: (params?.[0] as string[]).map((id) => ({ id, organization_id: ORG, hired_at: null, operational_capital_code: null })), rowCount: 0 }
      if (sql.includes("holiday_fallback_policy from organizations")) return { rows: [{ holiday_fallback_policy: "IGNORE" }], rowCount: 1 }
      if (sql.includes("st.name subteam_name from people p")) return { rows: [{ team_id: "t", subteam_id: "st", team_name: "B2C", subteam_name: "Voz" }], rowCount: 1 }
      if (sql.includes("and subteam_id = $2")) return { rows: Object.keys(fixture.tma ?? {}).map((id) => ({ id })), rowCount: 0 }
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
        return { rows: (fixture.regimes ?? []).filter((regime) => ids.includes(regime.personId)).map((regime) => ({ person_id: regime.personId, schedule_type: regime.type, effective_from: "2020-01-01", effective_to: null })), rowCount: 0 }
      }
      if (sql.includes("from employee_schedule_exceptions") || sql.includes("from holiday_catalog") || sql.includes("from organization_holidays")) return { rows: [], rowCount: 0 }
      if (sql.includes("from interactions where organization_id")) return { rows: [{ present: false }], rowCount: 1 }
      if (sql.includes("proves_work_activity order by code")) return { rows: [], rowCount: 0 }
      if (sql.includes("f.availability_policy") || sql.includes("availability_policy from indicator_definitions")) return { rows: [], rowCount: 0 }
      if (sql.includes("from workday_classifications c")) return { rows: [], rowCount: 0 }
      if (sql.includes("from data_feeds f join data_sources s")) {
        const contracts = params?.[1] as string[]
        if (contracts.includes("EMPLOYEES")) return { rows: fixture.statusFeed ? [feedRow("EMPLOYEES", fixture.statusFeed)] : [], rowCount: 0 }
        if (contracts.includes("WORK_SCHEDULE_DAYS")) return { rows: fixture.scheduleFeed ? [feedRow("WORK_SCHEDULE_DAYS", fixture.scheduleFeed)] : [], rowCount: 0 }
        return { rows: [], rowCount: 0 }
      }
      if (sql.includes("from indicator_measurements")) {
        const ids = params?.[1] as string[]
        expect(params?.[8]).toEqual(NON_ELIGIBLE_EMPLOYMENT_STATUSES)
        const ranges = { ids: params?.[5] as string[], from: params?.[6] as string[], to: params?.[7] as string[] }
        const start = String(params?.[2])
        const end = String(params?.[3])
        if (sql.includes("group by m.subject_id")) return { rows: ids.flatMap((id) => (rowFor(id, start, end, ranges) ? [{ subject_id: id, ...rowFor(id, start, end, ranges) }] : [])), rowCount: 0 }
        // Pooled: Σ numeradores ÷ Σ denominadores de TODOS os sujeitos com medição elegível (quem não mediu não entra como 0).
        const rows = ids.map((id) => rowFor(id, start, end, ranges)).filter((row): row is NonNullable<typeof row> => row !== null)
        const total = (key: "numerator_sum" | "denominator_sum" | "sample_count" | "days_with_data" | "ignored_count") => rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0)
        if (rows.length === 0) return { rows: [{ avg_value: null, min_value: null, max_value: null, sample_count: "0" }], rowCount: 1 }
        const pooled = { avg_value: String(total("numerator_sum") / Math.max(1, total("denominator_sum"))), min_value: null, max_value: null, sample_count: String(total("sample_count")), sum_value: String(total("numerator_sum")), latest_value: null, weighted_sum: String(total("numerator_sum")), weight_total: String(total("denominator_sum")), numerator_sum: String(total("numerator_sum")), denominator_sum: String(total("denominator_sum")), rows_with_components: String(total("sample_count")), sample_total: String(total("sample_count")), days_with_data: String(total("days_with_data")), ignored_count: String(total("ignored_count")) }
        return { rows: [pooled], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
}

/** Seis colaboradores, um por causa — quem mediu tem valor; `p` é o único com dado real. */
const POPULATION = ["p", "q", "r", "s", "ferias", "stale", "staleEscala", "unknown", "novalue"]
function scenario(): Fixture {
  const days = (personId: string, daysOff: number[]) => ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"].map((date) => ({ personId, date, work: !daysOff.includes(new Date(`${date}T00:00:00Z`).getUTCDay()) }))
  return {
    // Fontes ATRASADAS (situação e escala): tudo depois da última carga (06/09 → toda a semana) é presumido.
    statusFeed: "STALE",
    scheduleFeed: "STALE",
    periods: [{ personId: "ferias", status: "FERIAS", from: "2026-09-01", to: "2026-09-20" }],
    // `staleEscala` e `novalue` têm calendário explícito (a escala atrasada os torna presumidos); `unknown` é 6x1 sem calendário.
    days: [...days("staleEscala", [0, 6]), ...days("novalue", [0, 6]), ...days("p", [0, 6]), ...days("q", [0, 6]), ...days("r", [0, 6]), ...days("s", [0, 6])],
    regimes: [{ personId: "unknown", type: "SIX_BY_ONE" }],
    tma: { p: WEEK, q: { "2026-09-07": 500, "2026-09-08": 520 }, r: { "2026-09-07": 600 }, s: { "2026-09-07": 700 } },
  }
}

const reasonOf = async (db: Database, operatorId: string, populationIds: string[], source: "MEASUREMENT" | "OPERATIONAL_QUARTILE" = "MEASUREMENT") => {
  const result = await evaluateDataCondition(db, source === "MEASUREMENT" ? { historicalQuery: QUERY, comparator: "GT", thresholdNumeric: 300 } : { historicalQuery: { ...QUERY, source: "OPERATIONAL_QUARTILE" }, comparator: "EQUALS", thresholdText: "Q4" }, { operatorId, subjectIds: [operatorId], populationIds }, NOW, { timeZone: TZ })
  return { branch: result?.branch, reason: result?.evaluation.reason as NoDataReason | undefined, value: result?.evaluation.value }
}

describe("STALE / UNKNOWN — todos os consumidores distinguem 'não deveria', 'não sei' e 'não produziu'; nada vira 0 ou Q4", () => {
  it("resolvedor único: cada colaborador carrega a confiança das fontes e os dias presumidos/desconhecidos", async () => {
    const eligibility = await resolveEligibleDaysBySubject(fakeDb(scenario()), POPULATION, WINDOW, TZ, { now: NOW })
    expect(eligibility.get("ferias")).toMatchObject({ eligibleDays: 0, excludedByStatus: { FERIAS: 5 } })
    expect(eligibility.get("stale")!.statusConfidence).toMatchObject({ freshness: "STALE", unconfirmedDays: 5 })
    expect(eligibility.get("staleEscala")!.scheduleConfidence).toMatchObject({ freshness: "STALE", unconfirmedScheduleDays: 5, basis: "EXPLICIT_SCHEDULE" })
    expect(eligibility.get("unknown")).toMatchObject({ eligibleDays: 0, excludedByUnknownSchedule: 5 })
    expect(eligibility.get("unknown")!.scheduleConfidence).toMatchObject({ basis: "UNKNOWN_SCHEDULE", unknownScheduleDays: 5 })
  })

  it("Condition (valor): NO_ELIGIBLE_DAYS × EMPLOYMENT_STATUS_STALE × WORK_SCHEDULE_STALE × WORK_SCHEDULE_UNKNOWN × NO_VALUE × resultado real — com fonte atrasada a medição real vale", async () => {
    const base = scenario()
    // Cenários de escala (staleEscala/novalue/unknown) exigem fonte de SITUAÇÃO confiável — senão a situação atrasada tem precedência.
    const staleStatus = fakeDb(base)
    expect(await reasonOf(staleStatus, "ferias", POPULATION)).toMatchObject({ branch: "no_data", reason: "NO_ELIGIBLE_DAYS", value: null })
    expect(await reasonOf(staleStatus, "stale", POPULATION)).toMatchObject({ branch: "no_data", reason: "EMPLOYMENT_STATUS_STALE", value: null })
    expect(await reasonOf(staleStatus, "p", POPULATION)).toMatchObject({ branch: "true", value: expect.any(Number) }) // mediu: valor real, nunca degradado
    const freshStatus = fakeDb({ ...base, statusFeed: "FRESH" })
    expect(await reasonOf(freshStatus, "staleEscala", POPULATION)).toMatchObject({ branch: "no_data", reason: "WORK_SCHEDULE_STALE", value: null })
    expect(await reasonOf(freshStatus, "unknown", POPULATION)).toMatchObject({ branch: "no_data", reason: "NO_ELIGIBLE_DAYS", value: null }) // 0 dias elegíveis (6x1 sem calendário)
    const allFresh = fakeDb({ ...base, statusFeed: "FRESH", scheduleFeed: "FRESH" })
    expect(await reasonOf(allFresh, "novalue", POPULATION)).toMatchObject({ branch: "no_data", reason: "NO_VALUE", value: null })
    // Nenhum motivo devolve zero: value é sempre null quando não há resultado.
    for (const id of ["ferias", "stale", "staleEscala", "unknown", "novalue"]) expect((await reasonOf(allFresh, id, POPULATION)).value).not.toBe(0)
  })

  it("Condition (quartil operacional) e quartil: quem não mediu por STALE/UNKNOWN/férias fica FORA da população ranqueada com o motivo — nunca Q4", async () => {
    const db = fakeDb({ ...scenario(), statusFeed: "STALE", scheduleFeed: "FRESH" })
    const outcome = await resolveOperationalQuartiles(db, { indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE", period: QUERY.period, populationIds: POPULATION, now: NOW, timeZone: TZ })
    expect(outcome.rankedCount).toBe(4)
    expect([...outcome.ineligibleIds].sort()).toEqual(["ferias", "unknown"])
    expect(outcome.staleStatusIds.has("stale")).toBe(true)
    expect(outcome.staleStatusIds.has("p")).toBe(false) // mediu: entra no ranking apesar da fonte atrasada
    expect(outcome.members.get("s")?.quartile).toBe("Q4")
    for (const id of ["ferias", "stale", "staleEscala", "unknown", "novalue"]) expect(outcome.members.has(id)).toBe(false)
    expect(await reasonOf(db, "stale", POPULATION, "OPERATIONAL_QUARTILE")).toMatchObject({ branch: "no_data", reason: "EMPLOYMENT_STATUS_STALE" })
    expect(await reasonOf(db, "ferias", POPULATION, "OPERATIONAL_QUARTILE")).toMatchObject({ branch: "no_data", reason: "NO_ELIGIBLE_DAYS" })
    expect(await reasonOf(db, "unknown", POPULATION, "OPERATIONAL_QUARTILE")).toMatchObject({ branch: "no_data", reason: "NO_ELIGIBLE_DAYS" })
    const scheduleStale = fakeDb({ ...scenario(), statusFeed: "FRESH", scheduleFeed: "STALE" })
    expect(await reasonOf(scheduleStale, "staleEscala", POPULATION, "OPERATIONAL_QUARTILE")).toMatchObject({ branch: "no_data", reason: "WORK_SCHEDULE_STALE" })
    expect(await reasonOf(fakeDb({ ...scenario(), statusFeed: "FRESH", scheduleFeed: "FRESH" }), "novalue", POPULATION, "OPERATIONAL_QUARTILE")).toMatchObject({ branch: "no_data", reason: "NO_VALUE" })
    expect(await reasonOf(scheduleStale, "s", POPULATION, "OPERATIONAL_QUARTILE")).toMatchObject({ branch: "true", value: "Q4" })
  })

  it("Ranking (seleção por quartil Q4): só quem tem dado real entra; STALE/UNKNOWN/férias contam como sem dados, nunca como Q4", async () => {
    const db = fakeDb(scenario())
    const ranking = { source: "MEASUREMENT" as const, indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE" as const, period: QUERY.period, selection: "OPERATIONAL_QUARTILE" as const, operationalQuartile: "Q4" as const, rankingBasis: "VALUE" as const }
    const result = await runEmployeeRanking(db, ORG, ranking, POPULATION, NOW, { timeZone: TZ })
    expect(result.rankedCount).toBe(4)
    expect(result.memberIds).toEqual(["s"])
    for (const id of ["ferias", "stale", "staleEscala", "unknown", "novalue"]) expect(result.memberIds).not.toContain(id)
  })

  it("Analytics (perfil): a janela expõe unconfirmedDays / escala presumida / desconhecida / sem dias elegíveis — nunca valor 0", async () => {
    const trends = async (personId: string, fixture: Fixture) => (await buildEmployeeOperationalTrends(fakeDb(fixture), { organizationId: ORG, personIds: [personId], personId, now: NOW, timeZone: TZ, relevantCodes: ["TMA"] })).get("TMA")!
    const stale = await trends("stale", scenario())
    expect(stale.current).toMatchObject({ value: null, unconfirmedDays: 5, noEligibleDays: false })
    // Janela do perfil = 7 dias corridos (05/09 → 11/09): férias/desconhecido cobrem os 7; os presumidos são os 5 dias úteis depois da última carga (06/09).
    const ferias = await trends("ferias", scenario())
    expect(ferias.current).toMatchObject({ value: null, noEligibleDays: true, excludedByStatus: [{ status: "FERIAS", days: 7 }] })
    const unknown = await trends("unknown", { ...scenario(), statusFeed: "FRESH" })
    expect(unknown.current).toMatchObject({ value: null, noEligibleDays: true, excludedByUnknownSchedule: 7 })
    expect(unknown.current.schedule).toMatchObject({ basis: "UNKNOWN_SCHEDULE" })
    const staleEscala = await trends("staleEscala", { ...scenario(), statusFeed: "FRESH" })
    expect(staleEscala.current).toMatchObject({ value: null, unconfirmedDays: 0 })
    expect(staleEscala.current.schedule).toMatchObject({ freshness: "STALE", unconfirmedScheduleDays: 5 })
    const produced = await trends("p", scenario())
    expect(produced.current.value).toBeCloseTo(413, 0) // fonte atrasada, medição real: valor de verdade
    expect(produced.current.unconfirmedDays).toBe(5) // e a incerteza continua declarada ao lado
  })

  it("Structure (agregação): quem não tem dia elegível sai da população elegível; STALE/NO_VALUE continuam na população (não produziram ou não se sabe) mas nunca entram como 0 no pooled", async () => {
    const summary = await buildStructureOperationalSummary(fakeDb(scenario()), { organizationId: ORG, personIds: POPULATION, now: NOW, timeZone: TZ })
    expect(summary).not.toBeNull()
    expect(summary!.memberCount).toBe(9)
    expect(summary!.eligibleMemberCount).toBe(7) // ferias e unknown fora
    const tma = summary!.indicators.find((indicator) => indicator.code === "TMA")!
    expect(tma.membersWithData).toBe(4)
    // Pooled = Σ numerador ÷ Σ denominador só de quem mediu: (2065 + 1020 + 600 + 700) ÷ (5 + 2 + 1 + 1) — nenhum zero de quem não mediu.
    expect(tma.currentValue).toBeCloseTo((2065 + 1020 + 600 + 700) / 9, 1)
  })
})
