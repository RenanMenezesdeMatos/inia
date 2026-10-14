import pg from "pg"
import { isDeepStrictEqual } from "node:util"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { fixedClock } from "../../../shared/domain/clock.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { localDateOf, resolvePreviousTimeWindow, resolveTimeWindow, startOfLocalDate } from "../../workflows/application/time-window.js"
import { PgAnalyticsReadRepository } from "../application/analytics-read-repository.js"
import { runAnalyticsRollup } from "../application/analytics-rollup.js"
import { buildStructureOperationalSummary } from "../application/operational-trend.js"
import { OPERATIONAL_COMPARISONS, operationalComparisonPeriod } from "../domain/operational-comparison.js"
import { isUncommittedVersion, loadAnalyticsVersion } from "../infrastructure/analytics-versions.js"
import { OrganizationPeopleGraphCache } from "../infrastructure/organization-people-graph.js"
import { loadReadModelIndicatorCodes, readStructureWindows, rebuildMemberWindows } from "../infrastructure/operational-read-model.js"
import { compareAiMonthSpend, compareInteractionDayCounts, compareOfficialViews, compareStructureSummaries, compareViewerScopes, scopeSubjects, structureSubjectCases } from "./read-model-equality.js"

/**
 * PROVA no banco de TESTE real (massa demo + cenários de borda) do read model do analytics da liderança
 * (docs/dev/escala-read-model-e-ciclo-de-vida.md): cada caminho novo dá o MESMO resultado do caminho original.
 *  - escopo do viewer derivado do grafo em cache × consultas originais, para todas as pessoas; versão STRUCTURE sobe por
 *    trigger e o grafo nunca fica velho;
 *  - `person_daily_activity` × contagem bruta de interações; trigger em insert;
 *  - resumo operacional da estrutura: original × read model para cenários de borda (férias, 6x1 com produção na folga,
 *    falta injustificada com contribuição zero, LATEST empatado, linhas HOURLY/CUSTOM, medição futura de hoje, pessoa sem
 *    medição), com e sem membros pendentes, com marca da organização inteira; rebuild idempotente; triggers de marcação;
 *  - a organização inteira: rebuild completo e todas as estruturas (líderes, Grupos, Subgrupos) nas comparações da tela.
 * Tudo dentro de uma transação revertida ao final.
 *
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run analytics-read-model-proof
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const id = (n: number) => `7b000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const SUPERVISOR = id(1)
const OPERATORS = [id(11), id(12), id(13), id(14), id(15), id(16)]
const [O1, O2, O3, O4, O5, O6] = OPERATORS as [string, string, string, string, string, string]

let pool: pg.Pool
let client: pg.PoolClient
let db: Database
let timeZone: string
let now: Date
let today: string
type Definitions = { sum: { id: string; code: string }; latest: { id: string; code: string }; rate: { id: string; code: string }; weighted: { id: string; code: string } }
let definitions: Definitions

const addDays = (date: string, days: number) => {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10)
}
const dayStart = (date: string) => startOfLocalDate(date, timeZone)
const DAY_MS = 86_400_000

async function measurement(personId: string, definitionId: string, start: Date, end: Date, value: number, extra: { numerator?: number; denominator?: number; granularity?: string; source?: string } = {}) {
  await client.query(
    `insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity, numerator, denominator, sample_count)
     values ($1, $2, 'PERSON', $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [ORG, definitionId, personId, value, start.toISOString(), end.toISOString(), extra.source ?? "PROOF_READ_MODEL", extra.granularity ?? "DAILY", extra.numerator ?? null, extra.denominator ?? null, extra.denominator ?? null],
  )
}

async function daily(personId: string, date: string, k: number) {
  const start = dayStart(date)
  const end = new Date(start.getTime() + DAY_MS - 1)
  await measurement(personId, definitions.sum.id, start, end, k + 3)
  await measurement(personId, definitions.rate.id, start, end, (k / 20) * 100, { numerator: k, denominator: 20 })
  await measurement(personId, definitions.weighted.id, start, end, 300 + k, { numerator: (300 + k) * 10, denominator: 10 })
  await measurement(personId, definitions.latest.id, start, end, k * 2)
}

async function compareScenario(at: Date, expectLive: number | "fallback") {
  for (const comparison of OPERATIONAL_COMPARISONS) {
    const input = { organizationId: ORG, personIds: OPERATORS, now: at, timeZone, comparison }
    const expected = await buildStructureOperationalSummary(db, input, { source: "raw" })
    const actual = await buildStructureOperationalSummary(db, input, { source: "read-model" })
    expect(isDeepStrictEqual(expected, actual), `${comparison}: ${JSON.stringify(expected)} ≠ ${JSON.stringify(actual)}`).toBe(true)
    const period = operationalComparisonPeriod(comparison)
    const model = await readStructureWindows(db, { organizationId: ORG, personIds: OPERATORS, comparison, window: resolveTimeWindow(period, at, timeZone), previousWindow: resolvePreviousTimeWindow(period, at, timeZone), now: at, timeZone, indicatorCodes: await loadReadModelIndicatorCodes(db, ORG) })
    if (expectLive === "fallback") expect(model).toBeNull()
    else expect(model?.liveMembers).toBe(expectLive)
  }
}

describe.skipIf(!ENABLED)("read model do analytics da liderança — prova no banco de teste", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.activeDatabaseUrl, max: 2 })
    client = await pool.connect()
    db = client as unknown as Database
    await client.query("begin")
    timeZone = await resolveOrganizationTimezone(db, ORG)
    today = localDateOf(new Date(), timeZone)
    // Meio-dia local de hoje: determinístico (nunca cruza a meia-noite durante a prova).
    now = new Date(dayStart(today).getTime() + 12 * 3_600_000)
    await client.query(`delete from analytics_operational_dirty where organization_id = $1`, [ORG])
    const pick = async (where: string) => (await client.query<{ id: string; code: string }>(`select id, code from indicator_definitions where organization_id = $1 and active and daily_supported and ${where} order by code limit 1`, [ORG])).rows[0]!
    definitions = {
      sum: await pick(`operational_aggregation = 'SUM' and unjustified_absence_policy = 'ZERO_CONTRIBUTION'`),
      latest: await pick(`operational_aggregation = 'LATEST'`),
      rate: await pick(`operational_aggregation = 'RATE'`),
      weighted: await pick(`operational_aggregation = 'WEIGHTED_AVERAGE'`),
    }
    await client.query(`insert into people (id, organization_id, name, role, active, hired_at) values ($1, $2, 'Prova Supervisora RM', 'SUPERVISOR', true, '2020-01-01')`, [SUPERVISOR, ORG])
    for (const [index, operatorId] of OPERATORS.entries()) {
      await client.query(`insert into people (id, organization_id, name, role, reports_to_id, active, hired_at) values ($1, $2, $3, 'OPERATOR', $4, true, '2020-01-01')`, [operatorId, ORG, `Prova Operador RM ${index + 1}`, SUPERVISOR])
    }
    // O1 normal; O2 igual mas em FÉRIAS no meio; O3 6x1 com produção numa folga; O4 falta injustificada sem medição; O5
    // linhas HOURLY/CUSTOM e uma medição que começa depois de "agora"; O6 sem medição.
    for (let k = 0; k <= 100; k += 1) {
      const date = addDays(today, -k)
      await daily(O1, date, k)
      await daily(O2, date, k)
      if (k !== 4) await daily(O4, date, k)
      if (k % 3 !== 0) await daily(O3, date, k)
    }
    await client.query(`insert into employee_status_periods (organization_id, person_id, status, effective_from, effective_to, effective_to_explicit, source) values ($1, $2, 'FERIAS', $3, $4, true, 'PROOF_READ_MODEL')`, [ORG, O2, addDays(today, -10), addDays(today, -3)])
    await client.query(`insert into employee_work_shifts (organization_id, person_id, start_time, work_minutes, effective_from, schedule_type) values ($1, $2, '08:00', 480, $3, 'SIX_BY_ONE')`, [ORG, O3, addDays(today, -120)])
    for (let k = 0; k <= 100; k += 1) {
      await client.query(`insert into employee_schedule_days (organization_id, person_id, schedule_date, scheduled_to_work, source) values ($1, $2, $3, $4, 'PROOF_READ_MODEL')`, [ORG, O3, addDays(today, -k), k % 7 !== 2])
    }
    await client.query(
      `insert into interactions (organization_id, operator_id, external_id, started_at, ended_at, channel, reason) values ($1, $2, 'proof-rm-dayoff', $3, $4, 'VOICE', 'prova')`,
      [ORG, O3, new Date(dayStart(addDays(today, -2)).getTime() + 10 * 3_600_000).toISOString(), new Date(dayStart(addDays(today, -2)).getTime() + 10.2 * 3_600_000).toISOString()],
    )
    await client.query(`insert into workday_classifications (organization_id, person_id, workday, classification, origin) values ($1, $2, $3, 'UNJUSTIFIED_ABSENCE', 'SUPERVISOR_MANUAL')`, [ORG, O4, addDays(today, -4)])
    for (let k = 0; k <= 40; k += 1) {
      const base = dayStart(addDays(today, -k)).getTime()
      await measurement(O5, definitions.weighted.id, new Date(base + 10 * 3_600_000), new Date(base + 11 * 3_600_000), 280 + k, { numerator: (280 + k) * 4, denominator: 4, granularity: "HOURLY" })
      await measurement(O5, definitions.latest.id, new Date(base + 14 * 3_600_000), new Date(base + 15 * 3_600_000), k, { granularity: "HOURLY" })
    }
    // CUSTOM atravessando duas janelas (de ontem 18h até hoje 6h) e uma medição que começa hoje às 15h (depois de "agora").
    await measurement(O5, definitions.sum.id, new Date(dayStart(today).getTime() - 6 * 3_600_000), new Date(dayStart(today).getTime() + 6 * 3_600_000), 9, { granularity: "CUSTOM" })
    await measurement(O5, definitions.sum.id, new Date(dayStart(today).getTime() + 15 * 3_600_000), new Date(dayStart(today).getTime() + 16 * 3_600_000), 4, { granularity: "HOURLY" })
  }, 120_000)

  afterAll(async () => {
    await client?.query("rollback")
    client?.release()
    await pool?.end()
  })

  it("triggers marcam as pessoas cujo cálculo mudou (medição, situação, escala, classificação, atividade nova, admissão)", async () => {
    const marks = await client.query<{ person_id: string; reason: string }>(`select distinct person_id, reason from analytics_operational_dirty where organization_id = $1 and person_id = any($2::uuid[])`, [ORG, OPERATORS])
    const has = (personId: string, reason: string) => marks.rows.some((row) => row.person_id === personId && row.reason === reason)
    expect(has(O1, "MEASUREMENT")).toBe(true)
    expect(has(O2, "EMPLOYMENT_STATUS")).toBe(true)
    expect(has(O3, "SCHEDULE")).toBe(true)
    expect(has(O3, "SCHEDULE_REGIME")).toBe(true)
    expect(has(O3, "ACTIVITY")).toBe(true)
    expect(has(O4, "WORKDAY_CLASSIFICATION")).toBe(true)
    expect(has(O6, "PERSON")).toBe(true)
    await client.query(`update people set hired_at = '2019-06-01' where id = $1`, [O6])
    const hired = await client.query(`select 1 from analytics_operational_dirty where person_id = $1 and reason = 'PERSON'`, [O6])
    expect(hired.rowCount).toBeGreaterThanOrEqual(2)
    const activity = await client.query<{ interaction_count: number }>(`select interaction_count from person_daily_activity where person_id = $1 and local_date = $2`, [O3, addDays(today, -2)])
    expect(activity.rows[0]?.interaction_count).toBe(1)
  })

  it("cenários de borda: original × read model idênticos em todas as comparações, sem pendência (todos do read model)", async () => {
    await rebuildMemberWindows(db, { organizationId: ORG, personIds: OPERATORS, now, timeZone, indicatorCodes: await loadReadModelIndicatorCodes(db, ORG) })
    await client.query(`delete from analytics_operational_dirty where organization_id = $1`, [ORG])
    await compareScenario(now, 0)
  }, 120_000)

  it("rebuild é idempotente: rodar de novo grava as mesmas linhas", async () => {
    const snapshot = async () =>
      (
        await client.query(
          `select w.person_id, w.comparison, w.phase, w.first_date::text, w.last_date::text, w.eligible_days, w.unjustified_absence_days, w.valid_until::text,
                  coalesce(json_agg(to_jsonb(i) - 'organization_id' order by i.indicator_code) filter (where i.person_id is not null), '[]') indicators
             from analytics_member_window w left join analytics_member_window_indicator i using (organization_id, person_id, comparison, phase)
            where w.organization_id = $1 and w.person_id = any($2::uuid[]) group by 1, 2, 3, 4, 5, 6, 7, 8 order by 1, 2, 3`,
          [ORG, OPERATORS],
        )
      ).rows
    const before = await snapshot()
    await rebuildMemberWindows(db, { organizationId: ORG, personIds: OPERATORS, now, timeZone, indicatorCodes: await loadReadModelIndicatorCodes(db, ORG) })
    expect(await snapshot()).toEqual(before)
    expect(before.length).toBe(OPERATORS.length * OPERATIONAL_COMPARISONS.length * 2)
    // A medição que começa depois de "agora" (hoje 15h) limita a validade da janela atual de O5.
    expect(before.find((row) => row.person_id === O5 && row.phase === "CURRENT")?.valid_until).not.toBeNull()
    // Os cenários chegam ao read model: falta injustificada de O4 nos últimos 7 dias, férias de O2 tirando dias elegíveis.
    const rolling = (personId: string) => before.find((row) => row.person_id === personId && row.comparison === "ROLLING_7_DAYS" && row.phase === "CURRENT")!
    expect(rolling(O4).unjustified_absence_days).toBe(1)
    expect(rolling(O2).eligible_days).toBeLessThan(rolling(O1).eligible_days)
    expect((rolling(O4).indicators as { indicator_code: string; absence_days_with_data: number }[]).find((row) => row.indicator_code === definitions.sum.code)?.absence_days_with_data).toBe(0)
  }, 120_000)

  it("pessoa pendente é calculada na hora (mesmo snapshot) e o número continua idêntico", async () => {
    await measurement(O1, definitions.weighted.id, dayStart(today), new Date(dayStart(today).getTime() + DAY_MS - 1), 999, { numerator: 9990, denominator: 10, source: "PROOF_READ_MODEL_LATE" })
    await compareScenario(now, 1)
    await client.query(`delete from analytics_operational_dirty where organization_id = $1`, [ORG])
    await rebuildMemberWindows(db, { organizationId: ORG, personIds: [O1], now, timeZone, indicatorCodes: await loadReadModelIndicatorCodes(db, ORG) })
    await compareScenario(now, 0)
  }, 120_000)

  it("medição que começa depois do cálculo: quando o relógio a alcança, a pessoa passa para o caminho original", async () => {
    await compareScenario(new Date(dayStart(today).getTime() + 16 * 3_600_000), 1)
  }, 120_000)

  it("marca da organização inteira (feriado) → caminho original para a estrutura, mesmo número", async () => {
    await client.query(`insert into organization_holidays (organization_id, holiday_date, name, scope, active) values ($1, $2, 'Feriado da prova', 'ORGANIZATION', true)`, [ORG, addDays(today, -30)])
    await compareScenario(now, "fallback")
  }, 120_000)

  it("escopo: grafo em cache × consultas originais para todas as pessoas; trocar o gestor anota a versão e o grafo acompanha", async () => {
    const result = await compareViewerScopes(db, ORG, await scopeSubjects(db, ORG))
    expect(result.mismatches).toEqual([])
    const cache = new OrganizationPeopleGraphCache()
    const repository = new PgAnalyticsReadRepository(db, { peopleGraphCache: cache })
    expect((await repository.loadDirectReports(ORG, SUPERVISOR)).map((person) => person.id)).toContain(O5)
    await client.query(`update people set reports_to_id = null where id = $1`, [O5])
    // A versão sobe no COMMIT (141); até lá, esta transação enxerga a própria pendência e nunca recebe o grafo anterior.
    // O que acontece entre conexões está em analytics-versions-proof.
    expect(isUncommittedVersion(await loadAnalyticsVersion(db, ORG, "STRUCTURE"))).toBe(true)
    expect((await repository.loadDirectReports(ORG, SUPERVISOR)).map((person) => person.id)).not.toContain(O5)
    await client.query(`update people set reports_to_id = $2 where id = $1`, [O5, SUPERVISOR])
  }, 300_000)

  it("atividade diária = contagem bruta de interações (tabela inteira e leitura da evidência)", async () => {
    const result = await compareInteractionDayCounts(db, ORG, { firstDate: addDays(today, -400), lastDate: addDays(today, 30) })
    expect(result.mismatches).toEqual([])
  }, 120_000)

  it("camada oficial: com cache = sem cache; corrigir o fechamento oficial sobe a versão e o cache acompanha", async () => {
    const cases = (await structureSubjectCases(db, ORG)).filter((entry) => entry.label.startsWith("DIRECTOR") || entry.label.startsWith("SENIOR_MANAGER"))
    const before = await compareOfficialViews(db, ORG, now, cases)
    expect(before.mismatches).toEqual([])
    const row = (await client.query<{ id: string; person_id: string; achievement_percent: string }>(`select id, person_id, achievement_percent::text from employee_indicator_performance where organization_id = $1 and achievement_percent is not null order by reference_period desc, id limit 1`, [ORG])).rows[0]!
    await client.query(`update employee_indicator_performance set achievement_percent = achievement_percent + 7 where id = $1`, [row.id])
    // Sem limpar o cache: só a versão OFFICIAL (pendente nesta transação até o commit) impede servir o valor antigo.
    const after = await compareOfficialViews(db, ORG, now, cases, { clearCache: false })
    expect(after.mismatches).toEqual([])
  }, 600_000)

  it("gasto do mês de IA: resumo diário mantido por trigger = soma original, em qualquer instante", async () => {
    const insert = (at: Date, cost: string | null, costStatus: string) =>
      client.query(
        `insert into ai_usage_events (organization_id, occurred_at, use_case, origin, provider_key, model_name, correlation_id, cost, currency, cost_status, pricing_source, status, routing_mode, route_reason)
         values ($1, $2, 'PROOF_READ_MODEL', 'ADMIN_TEST', 'GOOGLE_GENAI', 'prova', gen_random_uuid(), $3, $4, $5, 'TABLE', 'SUCCESS', 'LEGACY', 'prova')`,
        [ORG, at.toISOString(), cost, cost === null ? null : "USD", costStatus],
      )
    await insert(new Date(dayStart(today).getTime() + 9 * 3_600_000), "0.001234567891", "EXACT")
    await insert(new Date(dayStart(today).getTime() + 11 * 3_600_000), null, "UNKNOWN")
    await insert(new Date(dayStart(addDays(today, -1)).getTime() + 23 * 3_600_000), "0.5", "ESTIMATED")
    const events = await client.query<{ occurred_at: Date }>(`select occurred_at from ai_usage_events where organization_id = $1 order by occurred_at`, [ORG])
    const instants = [now, ...events.rows.flatMap((row) => [row.occurred_at, new Date(row.occurred_at.getTime() - 1), new Date(row.occurred_at.getTime() + 3_600_000)])]
    expect((await compareAiMonthSpend(db, ORG, instants, { useCases: ["PROOF_READ_MODEL"] })).mismatches).toEqual([])
    const day = await client.query(`select currency, cost_sum::text, event_count, unknown_success_count from ai_usage_daily where organization_id = $1 and use_case = 'PROOF_READ_MODEL' and local_date = $2 order by currency nulls last`, [ORG, today])
    expect(day.rows).toEqual([
      { currency: "USD", cost_sum: "0.001234567891", event_count: 1, unknown_success_count: 0 },
      { currency: null, cost_sum: null, event_count: 1, unknown_success_count: 1 },
    ])
  })

  it("organização inteira: rebuild completo e todas as estruturas idênticas (7 dias e mês)", async () => {
    await client.query(`delete from organization_holidays where name = 'Feriado da prova'`)
    await runAnalyticsRollup(db, { organizationId: ORG, forceFull: true, clock: fixedClock(now) })
    const left = await client.query(`select count(*)::int total from analytics_operational_dirty where organization_id = $1 and person_id is null`, [ORG])
    expect(left.rows[0]?.total).toBe(0)
    const cases = await structureSubjectCases(db, ORG)
    expect(cases.length).toBeGreaterThan(10)
    const result = await compareStructureSummaries(db, ORG, now, cases, ["ROLLING_7_DAYS", "MONTH"])
    expect(result.mismatches).toEqual([])
    expect(result.fallbacks).toBe(0)
  }, 900_000)
})
