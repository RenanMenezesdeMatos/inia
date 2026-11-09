import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { buildEmployeeOperationalTrends, buildStructureOperationalSummary } from "./operational-trend.js"

const NOW = new Date("2026-09-16T14:30:00-03:00")
const TZ = "America/Fortaleza"
const ORG = "org"
const PEERS: Record<string, number | null> = { a: 300, b: 400, c: 500, d: 600, e: 700, f: 800, g: 900, mariana: 1000 }

/** Fake: TMA diário (LOWER) — janela atual por operador + janela anterior (todos 10% "melhores", exceto Mariana que piorou). */
function fakeDb(options: { current?: Record<string, number | null>; dailySupported?: boolean; days?: number; minimumCoverage?: number | null; minimumSampleSize?: number | null; vacation?: string[]; currentWindowStart?: string; kind?: "WEIGHTED_AVERAGE" | "SUM" } = {}): Database {
  const current = options.current ?? PEERS
  const days = options.days ?? 5
  // Janela cujo início é anterior ao da janela ATUAL (padrão: últimos 7 dias em 16/09 = 10/09) devolve os valores "anteriores".
  const currentWindowStart = options.currentWindowStart ?? "2026-09-10"
  const rowFor = (id: string, windowStart: string) => {
    const base = current[id]
    if (base === null || base === undefined || (options.vacation ?? []).includes(id)) return null
    const value = windowStart < currentWindowStart ? (id === "mariana" ? base * 0.9 : base * 1.1) : base
    return { avg_value: String(value), min_value: String(value), max_value: String(value), sum_value: String(value * days), sample_count: String(days), numerator_sum: String(value * days), denominator_sum: String(days), rows_with_components: String(days), days_with_data: String(days) }
  }
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("select timezone from operations")) return { rows: [{ timezone: TZ }], rowCount: 1 }
      // Catálogo diário da organização numa consulta só: definição operacional + padrões de suficiência.
      if (sql.includes("from indicator_definitions where organization_id = $1 and active and daily_supported")) return { rows: options.dailySupported === false ? [] : [{ id: "i", code: "TMA", unit: "SECONDS", desired_direction: "LOWER", operational_aggregation: options.kind ?? "WEIGHTED_AVERAGE", daily_supported: true, name: "TMA", minimum_coverage: options.minimumCoverage === undefined ? "0.600" : options.minimumCoverage === null ? null : String(options.minimumCoverage), minimum_sample_size: options.minimumSampleSize ?? null }], rowCount: 1 }
      if (sql.trim().startsWith("select person_id, status, effective_from")) return { rows: (options.vacation ?? []).map((id) => ({ person_id: id, status: "FERIAS", effective_from: "2026-09-01", effective_to: "2026-09-30", effective_to_explicit: true })), rowCount: 0 }
      if (sql.includes("operational_aggregation, daily_supported from indicator_definitions")) return { rows: [{ id: "i", code: "TMA", unit: "SECONDS", desired_direction: "LOWER", operational_aggregation: options.kind ?? "WEIGHTED_AVERAGE", daily_supported: true }], rowCount: 1 }
      if (sql.includes("hired_at::text hired_at, operational_capital_code from people")) return { rows: (params?.[0] as string[]).map((id) => ({ id, organization_id: ORG, hired_at: null, operational_capital_code: null })), rowCount: 0 }
      if (sql.includes("holiday_fallback_policy from organizations")) return { rows: [{ holiday_fallback_policy: "IGNORE" }], rowCount: 1 }
      if (sql.includes("st.name subteam_name from people p")) return { rows: [{ team_id: "t", subteam_id: "st", team_name: "B2C", subteam_name: "Voz" }], rowCount: 1 }
      if (sql.includes("and subteam_id = $2")) return { rows: Object.keys(PEERS).map((id) => ({ id })), rowCount: 0 }
      if (sql.includes("from indicator_measurements")) {
        const ids = params?.[1] as string[]
        const windowStart = String(params?.[2]).slice(0, 10)
        if (sql.includes("group by m.subject_id")) return { rows: ids.flatMap((id) => (rowFor(id, windowStart) ? [{ subject_id: id, ...rowFor(id, windowStart) }] : [])), rowCount: 0 }
        // pooled: Σ componentes dos ids
        const rows = ids.map((id) => rowFor(id, windowStart)).filter((row): row is NonNullable<typeof row> => row !== null)
        if (rows.length === 0) return { rows: [{ avg_value: null, min_value: null, max_value: null, sample_count: "0" }], rowCount: 1 }
        const num = rows.reduce((sum, row) => sum + Number(row.numerator_sum), 0)
        const den = rows.reduce((sum, row) => sum + Number(row.denominator_sum), 0)
        return { rows: [{ avg_value: String(num / den), min_value: null, max_value: null, sum_value: String(num), sample_count: String(den), numerator_sum: String(num), denominator_sum: String(den), rows_with_components: String(den), days_with_data: String(days) }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
}

describe("Acompanhamento operacional na área de Indicadores (camada 1, sem LLM)", () => {
  it("Mariana: últimos 7 dias × 7 anteriores em segundos, variação de PERFORMANCE pela direção (TMA subiu = piorou), Q4 operacional entre os pares do Subgrupo, cobertura 100%", async () => {
    const trends = await buildEmployeeOperationalTrends(fakeDb(), { organizationId: ORG, personIds: ["mariana"], personId: "mariana", now: NOW, timeZone: TZ })
    const tma = trends.get("TMA")!
    expect(tma.current).toMatchObject({ value: 1000, daysWithData: 5, expectedDays: 5, coverage: 1, label: "10/09/2026 → 16/09/2026" })
    expect(tma.previous).toMatchObject({ value: 900, label: "03/09/2026 → 09/09/2026" })
    expect(tma.changePercent).toBe(11.1)
    expect(tma.performanceChangePercent).toBe(-11.1)
    expect(tma.performanceTrend).toBe("DECLINED")
    expect(tma.sufficient).toBe(true)
    expect(tma.quartile).toMatchObject({ quartile: "Q4", position: 8, rankedCount: 8, populationCount: 8, populationLabel: "Subgrupo Voz", reason: "OK" })
    expect(tma.unit).toBe("SECONDS")
    expect(tma.method).toContain("÷")
  })

  it("melhor TMA do Subgrupo = Q1 operacional e tendência IMPROVED (caiu 9%)", async () => {
    const trends = await buildEmployeeOperationalTrends(fakeDb(), { organizationId: ORG, personIds: ["a"], personId: "a", now: NOW, timeZone: TZ })
    const tma = trends.get("TMA")!
    expect(tma.quartile.quartile).toBe("Q1")
    expect(tma.performanceTrend).toBe("IMPROVED")
    expect(tma.performanceChangePercent).toBeGreaterThan(0)
  })

  it("suficiência vem do CATÁLOGO (TMA minimumCoverage = 60%): 1 de 5 dias = insuficiente; 3 de 5 = exatamente 60% = suficiente; nenhum 40% fixo", async () => {
    const low = (await buildEmployeeOperationalTrends(fakeDb({ days: 1 }), { organizationId: ORG, personIds: ["mariana"], personId: "mariana", now: NOW, timeZone: TZ })).get("TMA")!
    expect(low.minimumCoverage).toBe(0.6)
    expect(low.sufficiencyRule).toBe("COVERAGE")
    expect(low.current.coverage).toBe(0.2)
    expect(low.sufficient).toBe(false)
    expect(low.changePercent).toBeNull()
    expect(low.quartile.quartile).toBeNull()
    expect(low.quartile.reason).toBe("BELOW_MINIMUM_COVERAGE")
    const exact = (await buildEmployeeOperationalTrends(fakeDb({ days: 3 }), { organizationId: ORG, personIds: ["mariana"], personId: "mariana", now: NOW, timeZone: TZ })).get("TMA")!
    expect(exact.current.coverage).toBe(0.6)
    expect(exact.sufficient).toBe(true)
    expect(exact.quartile.quartile).toBe("Q4")
    // Catálogo sem cobertura mínima e sem mínimo de medições: nada é inventado — 1 dia com dado é dado.
    const none = (await buildEmployeeOperationalTrends(fakeDb({ days: 1, minimumCoverage: null }), { organizationId: ORG, personIds: ["mariana"], personId: "mariana", now: NOW, timeZone: TZ })).get("TMA")!
    expect(none.sufficiencyRule).toBe("NONE")
    expect(none.sufficient).toBe(true)
    // Só mínimo de medições no catálogo: vale ele (1 medição < 3).
    const sample = (await buildEmployeeOperationalTrends(fakeDb({ days: 1, minimumCoverage: null, minimumSampleSize: 3 }), { organizationId: ORG, personIds: ["mariana"], personId: "mariana", now: NOW, timeZone: TZ })).get("TMA")!
    expect(sample.sufficiencyRule).toBe("SAMPLE")
    expect(sample.sufficient).toBe(false)
  })

  it("população do quartil é explícita: pares (Subgrupo), tamanho, elegíveis, posição — colaborador de férias a janela inteira sai da população e recebe NO_ELIGIBLE_DAYS", async () => {
    const db = fakeDb({ vacation: ["g"] })
    const tma = (await buildEmployeeOperationalTrends(db, { organizationId: ORG, personIds: ["mariana"], personId: "mariana", now: NOW, timeZone: TZ })).get("TMA")!
    expect(tma.quartile).toMatchObject({ populationType: "SUBGROUP_PEERS", populationLabel: "Subgrupo Voz", populationCount: 8, eligiblePopulationCount: 7, rankedCount: 7, rank: 7, position: 7, quartile: "Q4", windowLabel: "10/09/2026 → 16/09/2026" })
    // Sem medição elegível nas duas janelas o card só existe se o indicador for do colaborador (fechamento oficial) — por isso `relevantCodes`.
    expect((await buildEmployeeOperationalTrends(db, { organizationId: ORG, personIds: ["g"], personId: "g", now: NOW, timeZone: TZ })).has("TMA")).toBe(false)
    const onVacation = (await buildEmployeeOperationalTrends(db, { organizationId: ORG, personIds: ["g"], personId: "g", now: NOW, timeZone: TZ, relevantCodes: ["TMA"] })).get("TMA")!
    expect(onVacation.current.noEligibleDays).toBe(true)
    // Precedência única (situação antes da escala): os 7 dias de calendário da janela contam como FÉRIAS.
    expect(onVacation.current.excludedByStatus).toEqual([{ status: "FERIAS", label: "FÉRIAS", days: 7 }])
    expect(onVacation.sufficient).toBe(false)
    expect(onVacation.quartile.reason).toBe("NO_ELIGIBLE_DAYS")
    expect(onVacation.quartile.quartile).toBeNull()
  })

  it("sem comparação informada = últimos 7 dias × 7 anteriores (comportamento original), com rótulos prontos pra tela", async () => {
    const tma = (await buildEmployeeOperationalTrends(fakeDb(), { organizationId: ORG, personIds: ["mariana"], personId: "mariana", now: NOW, timeZone: TZ })).get("TMA")!
    expect(tma.comparison).toMatchObject({ kind: "ROLLING_7_DAYS", currentLabel: "Últimos 7 dias", previousLabel: "7 dias anteriores", shortLabel: "7d", currentIsPartial: false })
    expect(tma).toMatchObject({ windowCalendarDays: 7, previousWindowCalendarDays: 7, currentPeriodCalendarDays: null })
  })

  it("comparação configurável: mês corrente (parcial) × mês anterior completo — janelas civis no fuso da organização, quartil na mesma janela, variação calculada entre as duas", async () => {
    const tma = (await buildEmployeeOperationalTrends(fakeDb({ currentWindowStart: "2026-09-01", days: 12, minimumCoverage: null }), { organizationId: ORG, personIds: ["mariana"], personId: "mariana", now: NOW, timeZone: TZ, comparison: "MONTH" })).get("TMA")!
    expect(tma.comparison).toMatchObject({ kind: "MONTH", label: "Mês corrente (até hoje) × mês anterior", currentLabel: "Mês corrente (até hoje)", previousLabel: "Mês anterior (completo)", currentIsPartial: true })
    // Tamanhos explícitos das janelas: 16 dias até hoje de um mês de 30, contra 31 dias completos.
    expect(tma).toMatchObject({ windowCalendarDays: 16, previousWindowCalendarDays: 31, currentPeriodCalendarDays: 30 })
    expect(tma.current.label).toBe("01/09/2026 → 16/09/2026")
    expect(tma.previous.label).toBe("01/08/2026 → 31/08/2026")
    expect(tma.current.value).toBe(1000)
    expect(tma.previous.value).toBe(900)
    expect(tma.performanceTrend).toBe("DECLINED")
    expect(tma.quartile.windowLabel).toBe("01/09/2026 → 16/09/2026")
    expect(tma.quartile.quartile).toBe("Q4")
  })

  it("comparação configurável: semana (seg–dom), bimestre e trimestre correntes × anteriores", async () => {
    const week = (await buildEmployeeOperationalTrends(fakeDb({ currentWindowStart: "2026-09-14" }), { organizationId: ORG, personIds: ["mariana"], personId: "mariana", now: NOW, timeZone: TZ, comparison: "WEEK" })).get("TMA")!
    expect(week.current.label).toBe("14/09/2026 → 16/09/2026") // 16/09/2026 é quarta-feira
    expect(week.previous.label).toBe("07/09/2026 → 13/09/2026")
    expect(week.comparison.shortLabel).toBe("semana")
    const twoMonths = (await buildEmployeeOperationalTrends(fakeDb({ currentWindowStart: "2026-09-01" }), { organizationId: ORG, personIds: ["mariana"], personId: "mariana", now: NOW, timeZone: TZ, comparison: "TWO_MONTHS" })).get("TMA")!
    expect(twoMonths.current.label).toBe("01/09/2026 → 16/09/2026")
    expect(twoMonths.previous.label).toBe("01/07/2026 → 31/08/2026")
    expect(twoMonths.comparison.label).toBe("Bimestre corrente (até hoje) × bimestre anterior")
    expect(twoMonths).toMatchObject({ windowCalendarDays: 16, previousWindowCalendarDays: 62, currentPeriodCalendarDays: 61 })
    const quarter = (await buildEmployeeOperationalTrends(fakeDb({ currentWindowStart: "2026-07-01" }), { organizationId: ORG, personIds: ["mariana"], personId: "mariana", now: NOW, timeZone: TZ, comparison: "QUARTER" })).get("TMA")!
    expect(quarter.current.label).toBe("01/07/2026 → 16/09/2026")
    expect(quarter.previous.label).toBe("01/04/2026 → 30/06/2026")
    expect(quarter.comparison.label).toBe("Trimestre corrente (até hoje) × trimestre anterior")
    expect(quarter).toMatchObject({ windowCalendarDays: 78, previousWindowCalendarDays: 91, currentPeriodCalendarDays: 92 })
  })

  it("SOMA em período corrente parcial × anterior completo nunca vira variação (17 dias × 62 dias não é queda): changeUnavailableReason = PARTIAL_PERIOD_SUM; em 'últimos 7 dias' (janelas iguais) a soma continua comparável", async () => {
    const partial = (await buildEmployeeOperationalTrends(fakeDb({ currentWindowStart: "2026-09-01", minimumCoverage: null, kind: "SUM" }), { organizationId: ORG, personIds: ["mariana"], personId: "mariana", now: NOW, timeZone: TZ, comparison: "TWO_MONTHS" })).get("TMA")!
    expect(partial.aggregation).toBe("SUM")
    expect(partial.current.value).not.toBeNull()
    expect(partial.previous.value).not.toBeNull()
    expect(partial.changePercent).toBeNull()
    expect(partial.performanceTrend).toBeNull()
    expect(partial.changeUnavailableReason).toBe("PARTIAL_PERIOD_SUM")
    const rolling = (await buildEmployeeOperationalTrends(fakeDb({ minimumCoverage: null, kind: "SUM" }), { organizationId: ORG, personIds: ["mariana"], personId: "mariana", now: NOW, timeZone: TZ })).get("TMA")!
    expect(rolling.changeUnavailableReason).toBeNull()
    expect(rolling.changePercent).not.toBeNull()
    const structure = await buildStructureOperationalSummary(fakeDb({ currentWindowStart: "2026-09-01", kind: "SUM" }), { organizationId: ORG, personIds: Object.keys(PEERS), now: NOW, timeZone: TZ, comparison: "MONTH" })
    expect(structure!.indicators[0]!.changeUnavailableReason).toBe("PARTIAL_PERIOD_SUM")
    expect(structure!.indicators[0]!.performanceTrend).toBeNull()
  })

  it("resumo da estrutura respeita a comparação escolhida (rótulos das janelas e método descrevem a comparação)", async () => {
    const summary = await buildStructureOperationalSummary(fakeDb({ currentWindowStart: "2026-07-01" }), { organizationId: ORG, personIds: Object.keys(PEERS), now: NOW, timeZone: TZ, comparison: "QUARTER" })
    expect(summary!.comparison.kind).toBe("QUARTER")
    expect(summary!.windowLabel).toBe("01/07/2026 → 16/09/2026")
    expect(summary!.previousWindowLabel).toBe("01/04/2026 → 30/06/2026")
    expect(summary!.method).toContain("trimestre corrente (até hoje) × trimestre anterior (completo)")
    expect(summary).toMatchObject({ windowCalendarDays: 78, previousWindowCalendarDays: 91, currentPeriodCalendarDays: 92 })
    expect(summary!.indicators[0]!.performanceTrend).toBe("IMPROVED")
  })

  it("indicador sem medição diária (daily_supported=false) ou sem medição do colaborador → sem card", async () => {
    expect((await buildEmployeeOperationalTrends(fakeDb({ dailySupported: false }), { organizationId: ORG, personIds: ["mariana"], personId: "mariana", now: NOW, timeZone: TZ })).size).toBe(0)
    expect((await buildEmployeeOperationalTrends(fakeDb({ current: { ...PEERS, mariana: null } }), { organizationId: ORG, personIds: ["mariana"], personId: "mariana", now: NOW, timeZone: TZ })).has("TMA")).toBe(false)
  })

  it("resumo da estrutura: valor POOLED (Σ numerador ÷ Σ denominador) dos membros, membros com dado suficiente, variação de performance", async () => {
    const summary = await buildStructureOperationalSummary(fakeDb(), { organizationId: ORG, personIds: Object.keys(PEERS), now: NOW, timeZone: TZ })
    const tma = summary!.indicators.find((indicator) => indicator.code === "TMA")!
    expect(tma.currentValue).toBe(650) // média ponderada dos 8 (mesmo peso)
    expect(tma.membersWithData).toBe(8)
    expect(tma.membersWithSufficientData).toBe(8)
    expect(tma.memberCount).toBe(8)
    expect(tma.eligibleMemberCount).toBe(8)
    expect(summary!.eligibleMemberCount).toBe(8)
    expect(tma.performanceTrend).toBe("IMPROVED") // 7 de 8 melhoraram 10%
    expect(summary!.windowLabel).toBe("10/09/2026 → 16/09/2026")
  })

  it("estrutura: 8 membros, 3 de férias a janela inteira → população elegível 5; férias nunca entram como 0 no agregado pooled", async () => {
    const summary = await buildStructureOperationalSummary(fakeDb({ vacation: ["f", "g", "mariana"] }), { organizationId: ORG, personIds: Object.keys(PEERS), now: NOW, timeZone: TZ })
    expect(summary!.memberCount).toBe(8)
    expect(summary!.eligibleMemberCount).toBe(5)
    const tma = summary!.indicators.find((indicator) => indicator.code === "TMA")!
    expect(tma.eligibleMemberCount).toBe(5)
    expect(tma.membersWithData).toBe(5)
    expect(tma.currentValue).toBe(500) // média dos 5 elegíveis (300..700), nunca puxada por 0 dos ausentes
  })
})
