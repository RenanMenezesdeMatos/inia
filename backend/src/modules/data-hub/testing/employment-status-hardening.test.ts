import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { resolveEligibleDaysBySubject, resolveOperationalWindowBySubject } from "../../indicators/application/operational-measurement-resolver.js"
import { resolveEmploymentStatusFreshness } from "../../people/application/employment-status-freshness.js"
import { applyEmployeeStatusSnapshot, loadEmploymentStatusHistory, resetEmploymentStatusProjection, resolveEmployeeStatusAt, resolveEmployeeStatusesAt, runEmploymentStatusProjection, syncAllCurrentStatuses } from "../../people/application/employment-status-service.js"
import { evaluateDataCondition } from "../../workflows/application/condition-evaluator.js"
import { resolveOperationalQuartiles } from "../../workflows/application/operational-quartile-resolver.js"
import { createDataHubContext, type DataHubContext } from "../application/data-hub-context.js"
import { createFeed, setFeedStatus, updateFeed } from "../application/feed-service.js"
import { buildOverview, lineageOf } from "../application/overview-service.js"
import { type DataFeedRow, type DataRunRow, type DataSourceRow } from "../application/records.js"
import { enqueueRun } from "../application/run-service.js"
import { executeRun } from "../application/run-pipeline.js"
import { createSource } from "../application/source-service.js"
import { CapturingLogger, FakeSftpClient, InMemorySecretStore, json, MockHttpClient } from "./fakes.js"
import { requestManualSync } from "../application/run-service.js"
import { setSourceStatus } from "../application/source-service.js"
import { resolveWorkScheduleFreshness } from "../../people/application/employment-status-freshness.js"
import { loadWorkScheduleSummary, resolveWorkScheduleHorizon } from "../../people/application/work-schedule-service.js"

/**
 * HARDENING — situação funcional × Central × elegibilidade (banco de teste real, INIA_DB_PROOF=1):
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run employment-status-hardening
 * Prova: EMPLOYEES e EMPLOYEE_ABSENCES alimentam a mesma camada; período explícito vence snapshot
 * inferido; conflito nunca é silencioso; situação por data e projeção diária; retorno não
 * inventado; freshness funcional derivada da Central; STALE vira "não sei" (nunca "não produziu")
 * sem invalidar medição real; ausência explícita continua confiável com fonte atrasada; lineage
 * chega ao período; job em lote sem N+1. Ausências @2: "Vigente? = não" desfaz o período pela
 * própria carga (auditado), cancelar o inexistente não muda nada, reenviar recria; feed @1 segue @1.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
/** Organização PRÓPRIA da prova (autoridade de feed e freshness são por organização — nada interfere na demo nem em outras provas rodando em paralelo). */
const ORG = "de00ee00-0000-4000-8000-00000000f0f0"
const OPERATION = "de00ee00-0000-4000-8000-00000000f0f1"
const TZ = "America/Fortaleza"
const NOW = new Date("2026-09-16T15:00:00-03:00")

let pool: pg.Pool
let db: Database
let ctx: DataHubContext
let source: DataSourceRow
let employeesFeed: DataFeedRow
let absencesFeed: DataFeedRow

const csv = (rows: string[][]) => new TextEncoder().encode(rows.map((row) => row.join(";")).join("\n"))
const fileFeedConfig = { connector: "FILE_UPLOAD" as const, file: { format: "CSV" as const, csv: { encoding: "utf-8" as const, delimiter: "auto" as const, hasHeader: true, skipRows: 0 }, excel: { hasHeader: true, skipRows: 0 } } }
const identity = (fields: string[]) => ({ fields: fields.map((field) => ({ target: field, source: field, transforms: [] })) })

async function run(feed: DataFeedRow, content: Uint8Array, filename: string): Promise<DataRunRow> {
  const raw = await ctx.rawObjects.put({ organizationId: ORG, sourceId: feed.sourceId, feedId: feed.id, filename, contentType: "text/csv", content })
  const { run } = await enqueueRun(ctx, { organizationId: ORG, feed, triggerKind: "FILE_UPLOAD", requestedBy: null, rawObjectId: raw.id })
  return (await executeRun(ctx, run.id))!
}

async function personId(matricula: string): Promise<string> {
  return (await db.query<{ id: string }>(`select id from people where organization_id = $1 and matricula = $2`, [ORG, matricula])).rows[0]!.id
}

async function rejections(runId: string) {
  return (await db.query<{ error_code: string; message: string }>(`select error_code, message from data_ingestion_rejections where run_id = $1 order by record_number`, [runId])).rows
}

async function cleanup() {
  await db.query(`delete from data_sources where organization_id = $1`, [ORG])
  await db.query(`delete from data_raw_objects where organization_id = $1`, [ORG])
  await db.query(`delete from indicator_measurements where organization_id = $1`, [ORG])
  await db.query(`delete from employee_status_periods where organization_id = $1`, [ORG])
  await db.query(`delete from employee_schedule_days where organization_id = $1`, [ORG])
  await db.query(`delete from employee_schedule_exceptions where organization_id = $1`, [ORG])
  await db.query(`delete from holiday_catalog where name like 'TH %'`)
  await db.query(`delete from employee_work_shifts where organization_id = $1`, [ORG])
  await db.query(`delete from organization_holidays where organization_id = $1`, [ORG])
  await db.query(`delete from audit_logs where organization_id = $1`, [ORG])
  await db.query(`delete from people where organization_id = $1`, [ORG])
  await db.query(`delete from goals where organization_id = $1`, [ORG])
  await db.query(`delete from indicator_definitions where organization_id = $1`, [ORG])
  await db.query(`delete from operations where organization_id = $1`, [ORG])
  await db.query(`delete from organizations where id = $1`, [ORG])
}

async function createOrganization() {
  await db.query(`insert into organizations (id, name, slug) values ($1, 'TH Hardening', 'th-hardening') on conflict (id) do nothing`, [ORG])
  await db.query(`insert into operations (id, organization_id, name, timezone) values ($1, $2, 'TH Operação', $3) on conflict (id) do nothing`, [OPERATION, ORG, TZ])
  await db.query(
    `insert into indicator_definitions (organization_id, code, name, unit, desired_direction, daily_supported, operational_aggregation, official_closure_supported, active)
     values ($1, 'TH_TEMPO', 'Tempo TH', 'SECONDS', 'LOWER', true, 'WEIGHTED_AVERAGE', true, true)`,
    [ORG],
  )
}

describe.skipIf(!ENABLED)("Hardening — situação funcional × Central de Dados × elegibilidade", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    db = pool
    ctx = createDataHubContext(db, { http: new MockHttpClient(), sftp: new FakeSftpClient(), logger: new CapturingLogger(), secrets: new InMemorySecretStore(), clock: { now: () => NOW } })
    await cleanup()
    await createOrganization()
    source = await createSource(ctx, ORG, null, { name: "TH API RH", config: { kind: "FILE_UPLOAD" } })
    employeesFeed = await setFeedStatus(ctx, ORG, null, (await createFeed(ctx, ORG, null, source.id, { feedKey: "colaboradores", name: "Colaboradores", contractKey: "EMPLOYEES", connectorConfig: fileFeedConfig, authoritative: true, sourceNamespace: "th-rh", cadence: { kind: "INTERVAL", minutes: 60 }, mapping: identity(["externalEmployeeId", "name", "role", "hiredAt", "currentStatus", "statusEffectiveFrom"]) })).id, "ACTIVATE")
    absencesFeed = await setFeedStatus(ctx, ORG, null, (await createFeed(ctx, ORG, null, source.id, { feedKey: "ausencias", name: "Ausências", contractKey: "EMPLOYEE_ABSENCES", connectorConfig: fileFeedConfig, authoritative: true, sourceNamespace: "th-rh-ausencias", cadence: { kind: "INTERVAL", minutes: 60 }, mapping: identity(["externalEmployeeId", "type", "startDate", "endDate"]) })).id, "ACTIVATE")
    const base = await run(employeesFeed, csv([["externalEmployeeId", "name", "role", "hiredAt", "currentStatus", "statusEffectiveFrom"], ["TH-OP-01", "Nathália TH", "OPERATOR", "2024-01-08", "EM PRODUÇÃO", ""], ["TH-OP-02", "Bruno TH", "OPERATOR", "2024-01-08", "EM PRODUÇÃO", ""], ["TH-OP-03", "Carla TH", "OPERATOR", "2024-01-08", "", ""], ["TH-OP-04", "Diego TH", "OPERATOR", "2024-01-08", "EM PRODUÇÃO", ""], ["TH-OP-05", "Elisa TH", "OPERATOR", "2024-01-08", "EM PRODUÇÃO", ""]]), "th-base.csv")
    expect(base.status).toBe("COMPLETED")
  }, 60_000)

  afterAll(async () => {
    if (!db) return
    await cleanup()
    await pool.end()
  })

  it("mesma camada canônica: snapshot EMPLOYEES (ATIVO → FÉRIAS) e ausência EMPLOYEE_ABSENCES viram períodos em employee_status_periods, com lineage do PERÍODO até o Run", async () => {
    const op1 = await personId("TH-OP-01")
    const op2 = await personId("TH-OP-02")
    // Snapshot: FÉRIAS sem data → vale a partir da observação (16/09), inferida.
    const snapshot = await run(employeesFeed, csv([["externalEmployeeId", "name", "role", "hiredAt", "currentStatus", "statusEffectiveFrom"], ["TH-OP-01", "Nathália TH", "OPERATOR", "2024-01-08", "FERIAS", ""]]), "th-snapshot.csv")
    expect(snapshot.status).toBe("COMPLETED")
    const history1 = (await loadEmploymentStatusHistory(db, op1)).map((period) => [period.status, period.effectiveFrom, period.effectiveTo, period.effectiveFromInferred, period.effectiveToExplicit, period.authoritative])
    expect(history1.at(-1)).toEqual(["FERIAS", "2026-09-16", null, true, false, true])
    // Ausência explícita: VACATION 04–20 para OP-02.
    const absence = await run(absencesFeed, csv([["externalEmployeeId", "type", "startDate", "endDate"], ["TH-OP-02", "FERIAS", "2026-09-04", "2026-09-20"]]), "th-absence.csv")
    expect(absence.status).toBe("COMPLETED")
    const history2 = (await loadEmploymentStatusHistory(db, op2)).map((period) => [period.status, period.effectiveFrom, period.effectiveTo, period.effectiveFromInferred, period.effectiveToExplicit])
    expect(history2).toContainEqual(["FERIAS", "2026-09-04", "2026-09-20", false, true])
    // Lineage chega ao período (não só à pessoa): fonte, feed, run, registro.
    const period = (await loadEmploymentStatusHistory(db, op2)).find((entry) => entry.status === "FERIAS")!
    const lineage = await lineageOf(ctx, ORG, "employee_status_periods", period.id)
    expect(lineage).toHaveLength(1)
    expect(lineage[0]).toMatchObject({ runId: absence.id, feedName: "Ausências", sourceName: "TH API RH", contractKey: "EMPLOYEE_ABSENCES", sourceRecordKey: "TH-OP-02", action: "INSERTED" })
    // A mesma camada alimenta a elegibilidade: OP-02 sem dias elegíveis na semana 14–18/09.
    const eligibility = await resolveEligibleDaysBySubject(db, [op1, op2], { start: new Date("2026-09-14T03:00:00Z"), end: new Date("2026-09-19T03:00:00Z") }, TZ, { now: NOW })
    expect(eligibility.get(op2)?.eligibleDays).toBe(0)
    expect(eligibility.get(op2)?.excludedByStatus).toEqual({ FERIAS: 5 })
    expect(eligibility.get(op1)?.eligibleDays).toBe(2) // 14 e 15; 16–18 em férias (snapshot)
  })

  it("precedência: ausência explícita 04–20 vence snapshot inferido ATIVO; o conflito vai para a quarentena como AVISO (registro aplicado, nada rejeitado)", async () => {
    const op2 = await personId("TH-OP-02")
    const snapshot = await run(employeesFeed, csv([["externalEmployeeId", "name", "role", "hiredAt", "currentStatus", "statusEffectiveFrom"], ["TH-OP-02", "Bruno TH (renomeado)", "OPERATOR", "2024-01-08", "EM PRODUÇÃO", ""]]), "th-conflict.csv")
    expect(snapshot.status).toBe("COMPLETED")
    expect(snapshot.recordsRejected).toBe(0)
    expect(snapshot.recordsUpdated).toBe(1) // o nome mudou
    expect(snapshot.errorCount).toBe(0)
    expect(snapshot.warningCount).toBe(1)
    const notes = await rejections(snapshot.id)
    expect(notes).toHaveLength(1)
    expect(notes[0]!.error_code).toBe("DATA_EMPLOYMENT_STATUS_CONFLICT")
    expect(notes[0]!.message).toMatch(/mantido o período existente \(período explícito e limitado vence snapshot sem intervalo\)/)
    const resolved = await resolveEmployeeStatusAt(db, op2, "2026-09-16")
    expect(resolved).toMatchObject({ status: "FERIAS", basis: "EXPLICIT_PERIOD", confirmed: true })
    // Snapshot ATIVO com data EXPLÍCITA 10/09 (em aberto) × ausência limitada 04–20: limitada vence, conflito registrado.
    const explicit = await applyEmployeeStatusSnapshot(db, { organizationId: ORG, personId: op2, status: "EM_PRODUCAO", effectiveFrom: "2026-09-10", observedAt: NOW, source: "th-rh", timeZone: TZ })
    expect(explicit.action).toBe("CONFLICT")
    expect(explicit.conflict).toMatchObject({ kept: "EXISTING", reason: "EXPLICIT_PERIOD_WINS" })
    expect((await resolveEmployeeStatusAt(db, op2, "2026-09-12")).status).toBe("FERIAS")
    // Correção explícita da própria ausência (10–20) é aplicada: mesmo nível, mesma autoridade, evidência mais nova — e o lineage registra a correção.
    const corrected = await run(absencesFeed, csv([["externalEmployeeId", "type", "startDate", "endDate"], ["TH-OP-02", "FERIAS", "2026-09-10", "2026-09-20"]]), "th-absence-fix.csv")
    expect(corrected.status).toBe("COMPLETED")
    expect(corrected.recordsUpdated).toBe(1)
    const vacation = (await loadEmploymentStatusHistory(db, op2)).find((entry) => entry.status === "FERIAS")!
    expect([vacation.effectiveFrom, vacation.effectiveTo]).toEqual(["2026-09-10", "2026-09-20"])
    expect((await lineageOf(ctx, ORG, "employee_status_periods", vacation.id)).map((entry) => entry.action)).toEqual(["UPDATED", "INSERTED"])
  })

  it("situação por data e projeção diária: 20/09 = FÉRIAS; 21/09 com retorno explícito = ATIVO; sem retorno = ATIVO presumido, NÃO confirmado", async () => {
    const op2 = await personId("TH-OP-02")
    const op3 = await personId("TH-OP-03")
    // OP-02: férias 10–20 (explícitas) e retorno explícito ATIVO desde 21 (já existente pela cauda do snapshot; reafirmado pela fonte).
    await applyEmployeeStatusSnapshot(db, { organizationId: ORG, personId: op2, status: "EM_PRODUCAO", effectiveFrom: "2026-09-21", observedAt: NOW, source: "th-rh", timeZone: TZ })
    // OP-03: SÓ uma ausência explícita 04–20 e nada depois (sem histórico anterior).
    await applyEmployeeStatusSnapshot(db, { organizationId: ORG, personId: op3, status: "FERIAS", effectiveFrom: "2026-09-04", effectiveTo: "2026-09-20", observedAt: NOW, source: "th-rh-ausencias", timeZone: TZ })
    expect((await resolveEmployeeStatusAt(db, op2, "2026-09-20"))).toMatchObject({ status: "FERIAS", basis: "EXPLICIT_PERIOD", confirmed: true })
    expect((await resolveEmployeeStatusAt(db, op2, "2026-09-21"))).toMatchObject({ status: "EM_PRODUCAO", basis: "OPEN_PERIOD", confirmed: true })
    // Sem retorno explícito: nunca inventamos ACTIVE como certeza — ATIVO presumido, confirmed=false, com o período que terminou.
    const presumed = await resolveEmployeeStatusAt(db, op3, "2026-09-21")
    expect(presumed).toMatchObject({ status: "EM_PRODUCAO", basis: "PRESUMED_AFTER_PERIOD", confirmed: false })
    expect(presumed.endedPeriod?.effectiveTo).toBe("2026-09-20")
    // Projeção em lote: "hoje" 20/09 → OP-03 FÉRIAS; "hoje" 21/09 → ATIVO (coluna útil para a UI), sem carga nova. 2× = mesmo resultado.
    await syncAllCurrentStatuses(db, ORG, TZ, new Date("2026-09-20T15:00:00-03:00"))
    expect((await db.query<{ s: string }>(`select current_employment_status s from people where id = $1`, [op3])).rows[0]!.s).toBe("FERIAS")
    const first = await syncAllCurrentStatuses(db, ORG, TZ, new Date("2026-09-21T15:00:00-03:00"))
    expect(first).toBeGreaterThanOrEqual(1)
    expect((await db.query<{ s: string }>(`select current_employment_status s from people where id = $1`, [op3])).rows[0]!.s).toBe("EM_PRODUCAO")
    expect(await syncAllCurrentStatuses(db, ORG, TZ, new Date("2026-09-21T16:00:00-03:00"))).toBe(0)
    // Volta a ausência de OP-03 para o cenário de elegibilidade (ela cobre a janela 14–18 dos testes seguintes? não: 04–20 cobre; removemos para OP-03 ser o "sem histórico").
    await db.query(`delete from employee_status_periods where person_id = $1`, [op3])
    await db.query(`update people set current_employment_status = 'ACTIVE' where id = $1`, [op3])
    // OP-04 recebe a ausência explícita 04–20 usada nos testes de elegibilidade.
    await applyEmployeeStatusSnapshot(db, { organizationId: ORG, personId: await personId("TH-OP-04"), status: "FERIAS", effectiveFrom: "2026-09-04", effectiveTo: "2026-09-20", observedAt: NOW, source: "th-rh-ausencias", timeZone: TZ })
    // O job diário só roda uma vez por dia local por organização.
    resetEmploymentStatusProjection()
    const firstRun = await runEmploymentStatusProjection(db, new Date("2026-09-21T17:00:00-03:00"))
    expect(firstRun.organizations).toBeGreaterThanOrEqual(1)
    expect((await runEmploymentStatusProjection(db, new Date("2026-09-21T18:00:00-03:00"))).organizations).toBe(0)
    resetEmploymentStatusProjection()
    // Resolução em lote de 2.000+ pessoas: UMA consulta.
    const all = (await db.query<{ id: string }>(`select id from people limit 2100`)).rows.map((row) => row.id)
    const started = Date.now()
    const batch = await resolveEmployeeStatusesAt(db, all, "2026-09-16")
    expect(batch.size).toBe(all.length)
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it("freshness funcional deriva da Central: cadência válida = FRESH; feed atrasado = STALE; a conexão da fonte não muda", async () => {
    await db.query(`update data_feeds set last_success_at = $2 where id = any($1::uuid[])`, [[employeesFeed.id, absencesFeed.id], NOW])
    const fresh = await resolveEmploymentStatusFreshness(db, ORG, NOW, TZ)
    expect(fresh.state).toBe("FRESH")
    expect(fresh.configured).toBe(true)
    expect(fresh.consideredFeedIds.sort()).toEqual([employeesFeed.id, absencesFeed.id].sort())
    // Feed de colaboradores 5 h sem carga com cadência de 1 h → STALE; a saúde da conexão da fonte permanece a mesma.
    await db.query(`update data_feeds set last_success_at = $2 where id = $1`, [employeesFeed.id, new Date(NOW.getTime() - 5 * 60 * 60 * 1000)])
    const stale = await resolveEmploymentStatusFreshness(db, ORG, NOW, TZ)
    expect(stale.state).toBe("STALE")
    expect(stale.lastSuccessLocalDate).toBe("2026-09-16")
    const health = (await db.query<{ connection_health: string; status: string }>(`select connection_health, status from data_sources where id = $1`, [source.id])).rows[0]!
    expect(health).toEqual({ connection_health: source.connectionHealth, status: "ACTIVE" })
    const overview = await buildOverview(ctx, ORG)
    expect(overview.employmentStatus.state).toBe("STALE")
    expect(overview.dataMap.find((entry) => entry.contractKey === "EMPLOYEE_ABSENCES")?.relation).toMatchObject({ kind: "COMPLEMENTS", contractKey: "EMPLOYEES" })
  })

  it("elegibilidade com fonte STALE: dias presumidos após a última carga ficam 'não confirmados'; ausência explícita continua confiável; férias não viram zero", async () => {
    const op1 = await personId("TH-OP-01")
    const op3 = await personId("TH-OP-03")
    const op4 = await personId("TH-OP-04")
    // Última carga da fonte: 14/09 (atrasada). Janela: seg 14 → sex 18.
    await db.query(`update data_feeds set last_success_at = $2 where id = any($1::uuid[])`, [[employeesFeed.id, absencesFeed.id], new Date("2026-09-14T08:00:00-03:00")])
    const now = new Date("2026-09-18T18:00:00-03:00")
    const eligibility = await resolveEligibleDaysBySubject(db, [op1, op3, op4], { start: new Date("2026-09-14T03:00:00Z"), end: new Date("2026-09-19T03:00:00Z") }, TZ, { now })
    // OP-03 (sem histórico, ATIVO presumido): 14 confirmado pela carga; 15–18 presumidos → 4 não confirmados.
    expect(eligibility.get(op3)?.statusConfidence).toMatchObject({ freshness: "STALE", unconfirmedDays: 4, lastSuccessLocalDate: "2026-09-14" })
    // OP-04 (ausência explícita 04–20 cobre a janela): zero dias elegíveis, zero não confirmados — a ausência explícita não depende de snapshot.
    expect(eligibility.get(op4)?.eligibleDays).toBe(0)
    expect(eligibility.get(op4)?.statusConfidence.unconfirmedDays).toBe(0)
    // OP-01 (férias por snapshot inferido desde 16/09): dias 14–15 elegíveis; 15 é presumido → 1 não confirmado.
    expect(eligibility.get(op1)?.eligibleDays).toBe(2)
    expect(eligibility.get(op1)?.statusConfidence.unconfirmedDays).toBe(1)
    // Com a fonte FRESH, nada é "não confirmado" (latência dentro da cadência é aceita).
    await db.query(`update data_feeds set last_success_at = $2 where id = any($1::uuid[])`, [[employeesFeed.id, absencesFeed.id], now])
    const freshEligibility = await resolveEligibleDaysBySubject(db, [op3], { start: new Date("2026-09-14T03:00:00Z"), end: new Date("2026-09-19T03:00:00Z") }, TZ, { now })
    expect(freshEligibility.get(op3)?.statusConfidence).toMatchObject({ freshness: "FRESH", unconfirmedDays: 0 })
  })

  it("Condition e Ranking: sem medição + fonte STALE = EMPLOYMENT_STATUS_STALE (não 'não produziu'); com medição real o valor permanece; férias explícitas = NO_ELIGIBLE_DAYS", async () => {
    const op3 = await personId("TH-OP-03")
    const op4 = await personId("TH-OP-04")
    const op5 = await personId("TH-OP-05")
    const indicator = (await db.query<{ id: string; code: string }>(`select id, code from indicator_definitions where organization_id = $1 and code = 'TH_TEMPO'`, [ORG])).rows[0]!
    await db.query(`update data_feeds set last_success_at = $2 where id = any($1::uuid[])`, [[employeesFeed.id, absencesFeed.id], new Date("2026-09-14T08:00:00-03:00")])
    const now = new Date("2026-09-18T18:00:00-03:00")
    // OP-05 produziu de verdade nos 5 dias: o valor existe e NÃO é invalidado pelo status stale.
    for (let day = 14; day <= 18; day += 1) {
      await db.query(
        `insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity, numerator, denominator)
         values ($1, $2, 'PERSON', $3, 400, $4::timestamptz, $4::timestamptz + interval '1 day', 'th-medicoes', 'DAILY', 4000, 10)`,
        [ORG, indicator.id, op5, `2026-09-${day}T00:00:00-03:00`],
      )
    }
    const evaluate = async (operatorId: string) => {
      const result = await evaluateDataCondition(
        db,
        { comparator: "GT", thresholdNumeric: 100, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: indicator.code, aggregation: "AVERAGE", source: "MEASUREMENT", period: { kind: "CALENDAR", unit: "WEEK", phase: "CURRENT" }, minimumCoverage: 0.6 } } as never,
        { operatorId, subjectIds: [operatorId] },
        now,
        { organizationId: ORG, timeZone: TZ },
      )
      return result!
    }
    const produced = await evaluate(op5)
    expect(produced.branch).toBe("true")
    expect((produced.evaluation.evidence as { eligibility: { statusConfidence: { freshness: string } } }).eligibility.statusConfidence.freshness).toBe("STALE")
    const unknown = await evaluate(op3)
    expect(unknown.branch).toBe("no_data")
    expect(unknown.evaluation.reason).toBe("EMPLOYMENT_STATUS_STALE")
    expect(String(unknown.evaluation.reasonText)).toMatch(/fonte de situação funcional atrasada/)
    const vacation = await evaluate(op4)
    expect(vacation.branch).toBe("no_data")
    expect(vacation.evaluation.reason).toBe("NO_ELIGIBLE_DAYS")
    // Ranking/quartil operacional: férias explícitas fora (ineligible); sem medição + stale = staleStatusIds; quem produziu entra.
    const quartiles = await resolveOperationalQuartiles(db, { organizationId: ORG, indicatorCode: indicator.code, aggregation: "AVERAGE", period: { kind: "CALENDAR", unit: "WEEK", phase: "CURRENT" }, populationIds: [op3, op4, op5], now, timeZone: TZ })
    expect(quartiles.ineligibleIds.has(op4)).toBe(true)
    expect(quartiles.staleStatusIds.has(op3)).toBe(true)
    expect(quartiles.staleStatusIds.has(op5)).toBe(false)
    expect(quartiles.statusFreshness).toBe("STALE")
    expect(quartiles.rankedCount).toBe(1)
    // Com a fonte FRESH, o mesmo OP-03 sem medição é "não produziu" (NO_VALUE) — os três estados nunca se confundem.
    await db.query(`update data_feeds set last_success_at = $2 where id = any($1::uuid[])`, [[employeesFeed.id, absencesFeed.id], now])
    const noValue = await evaluate(op3)
    expect(noValue.evaluation.reason).toBe("NO_VALUE")
  })

  // ---------------------------------------------------------------------------------------------
  // ESCALAS REAIS — WORK_SCHEDULE_DAYS via CSV e via API Pull, correção, lineage, warnings × erros
  // ---------------------------------------------------------------------------------------------
  describe("escala real (WORK_SCHEDULE_DAYS) × situação × feriado × severidades", () => {
    const WEEK = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"] // seg → dom
    const window = { start: new Date("2026-09-07T00:00:00-03:00"), end: new Date("2026-09-14T00:00:00-03:00") }
    let scheduleFeed: DataFeedRow

    it("CSV: 6x1 com folga na quarta → 6 programados; sábado/domingo contam; regime gravado na jornada; lineage do dia até o Run", async () => {
      scheduleFeed = await setFeedStatus(ctx, ORG, null, (await createFeed(ctx, ORG, null, source.id, { feedKey: "escalas", name: "Escalas de trabalho", contractKey: "WORK_SCHEDULE_DAYS", connectorConfig: fileFeedConfig, authoritative: true, sourceNamespace: "th-rh-escalas", cadence: { kind: "INTERVAL", minutes: 60 }, mapping: { fields: [{ target: "externalEmployeeId", source: "matricula", transforms: [] }, { target: "scheduleDate", source: "data", transforms: [] }, { target: "scheduledToWork", source: "trabalha", transforms: [{ kind: "BOOLEAN_MAP", trueValues: ["S", "TRABALHA"], falseValues: ["N", "FOLGA"] }] }, { target: "scheduleType", source: "escala", transforms: [] }, { target: "externalScheduleId", source: "id", transforms: [] }] } })).id, "ACTIVATE")
      const rows = WEEK.map((date, index) => ["TH-OP-05", date, date === "2026-09-09" ? "FOLGA" : "TRABALHA", "6x1", `WS-${index}`])
      const load = await run(scheduleFeed, csv([["matricula", "data", "trabalha", "escala", "id"], ...rows]), "th-escala.csv")
      expect(load.status).toBe("COMPLETED")
      expect(load.recordsInserted).toBe(7)
      const op5 = await personId("TH-OP-05")
      const eligibility = (await resolveEligibleDaysBySubject(db, [op5], window, TZ, { now: NOW })).get(op5)!
      expect(eligibility).toMatchObject({ calendarDays: 7, scheduledWorkDays: 6, eligibleDays: 6, excludedByScheduledDayOff: 1, excludedByUnknownSchedule: 0 })
      expect(eligibility.eligibleDates).toEqual(["2026-09-07", "2026-09-08", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"])
      expect(eligibility.scheduleConfidence).toMatchObject({ basis: "EXPLICIT_SCHEDULE", freshness: "FRESH", scheduleType: null })
      const day = (await db.query<{ id: string; scheduled_to_work: boolean; source_reference: string }>(`select id, scheduled_to_work, source_reference from employee_schedule_days where person_id = $1 and schedule_date = '2026-09-09'`, [op5])).rows[0]!
      expect(day.scheduled_to_work).toBe(false)
      const lineage = await lineageOf(ctx, ORG, "employee_schedule_days", day.id)
      expect(lineage.map((entry) => [entry.runId, entry.action, entry.contractKey])).toEqual([[load.id, "INSERTED", "WORK_SCHEDULE_DAYS"]])
      // Regime pela jornada (WORK_SCHEDULES.scheduleType) — metadata com vigência.
      await db.query(`insert into employee_work_shifts (organization_id, person_id, start_time, work_minutes, effective_from, schedule_type) values ($1, $2, '08:00', 360, '2026-01-01', 'SIX_BY_ONE')`, [ORG, op5])
      const summary = await loadWorkScheduleSummary(db, ORG, op5, "2026-09-07", NOW, TZ)
      expect(summary).toMatchObject({ scheduleType: "SIX_BY_ONE", scheduleTypeLabel: "6x1", basis: "EXPLICIT_SCHEDULE", nextDayOff: "2026-09-09", knownDaysAhead: 7 })
      expect(summary.origin).toMatchObject({ feedName: "Escalas de trabalho" })
    })

    it("mesma escala 2× não duplica; correção posterior (quinta trabalha → folga) muda o cálculo histórico e NUNCA apaga medição", async () => {
      const op5 = await personId("TH-OP-05")
      const again = await run(scheduleFeed, csv([["matricula", "data", "trabalha", "escala", "id"], ...WEEK.map((date, index) => ["TH-OP-05", date, date === "2026-09-09" ? "FOLGA" : "TRABALHA", "6x1", `WS-${index}`])]), "th-escala-2.csv")
      expect(again).toMatchObject({ recordsInserted: 0, recordsUpdated: 0, recordsUnchanged: 7 })
      expect((await db.query(`select 1 from employee_schedule_days where person_id = $1`, [op5])).rowCount).toBe(7)
      const indicator = (await db.query<{ id: string }>(`select id from indicator_definitions where organization_id = $1 and code = 'TH_TEMPO'`, [ORG])).rows[0]!.id
      await db.query(`insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, granularity, period_start, period_end, value, numerator, denominator, sample_count, source) values ($1, $2, 'PERSON', $3, 'DAILY', '2026-09-10T00:00:00-03:00', '2026-09-11T00:00:00-03:00', 300, 300, 1, 1, 'th-medicoes')`, [ORG, indicator, op5])
      const fix = await run(scheduleFeed, csv([["matricula", "data", "trabalha", "escala", "id"], ["TH-OP-05", "2026-09-10", "FOLGA", "6x1", "WS-3"]]), "th-escala-fix.csv")
      expect(fix).toMatchObject({ status: "COMPLETED", recordsUpdated: 1 })
      const eligibility = (await resolveEligibleDaysBySubject(db, [op5], window, TZ, { now: NOW })).get(op5)!
      expect(eligibility).toMatchObject({ scheduledWorkDays: 5, eligibleDays: 5, excludedByScheduledDayOff: 2 })
      expect((await db.query(`select 1 from indicator_measurements where subject_id = $1 and period_start = '2026-09-10T00:00:00-03:00'`, [op5])).rowCount).toBe(1)
      const lineage = await lineageOf(ctx, ORG, "employee_schedule_days", (await db.query<{ id: string }>(`select id from employee_schedule_days where person_id = $1 and schedule_date = '2026-09-10'`, [op5])).rows[0]!.id)
      expect(lineage.map((entry) => entry.action)).toEqual(["UPDATED", "INSERTED"])
    })

    it("status × escala no banco: INSS em 2 dias programados → 3 elegíveis (6 − 1 folga − 2 INSS); MATERNIDADE a semana toda → NO_ELIGIBLE_DAYS", async () => {
      const op5 = await personId("TH-OP-05")
      await applyEmployeeStatusSnapshot(db, { organizationId: ORG, personId: op5, status: "INSS", effectiveFrom: "2026-09-11", effectiveTo: "2026-09-12", observedAt: NOW, source: "th-rh-ausencias", timeZone: TZ })
      const eligibility = (await resolveEligibleDaysBySubject(db, [op5], window, TZ, { now: NOW })).get(op5)!
      expect(eligibility).toMatchObject({ scheduledWorkDays: 5, excludedByStatus: { INSS: 2 }, eligibleDays: 3 })
      const op4 = await personId("TH-OP-04")
      await applyEmployeeStatusSnapshot(db, { organizationId: ORG, personId: op4, status: "MATERNIDADE", effectiveFrom: "2026-08-01", effectiveTo: null, observedAt: NOW, source: "th-rh", timeZone: TZ })
      const condition = await evaluateDataCondition(db, { historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "TH_TEMPO", aggregation: "WEIGHTED_AVERAGE", source: "MEASUREMENT", period: { kind: "ROLLING_DAYS", days: 7 } }, comparator: "GT", thresholdNumeric: 1 }, { operatorId: op4, subjectIds: [op4] }, new Date("2026-09-13T21:00:00-03:00"), { organizationId: ORG, timeZone: TZ })
      expect(condition?.branch).toBe("no_data")
      expect(condition?.evaluation.reason).toBe("NO_ELIGIBLE_DAYS")
    })

    it("data da organização: com política IGNORE (default) não muda nada; com EXCLUDE vira folga só para quem está no fallback seg–sex; escala explícita 'trabalha' vence", async () => {
      await db.query(`insert into organization_holidays (organization_id, holiday_date, name) values ($1, '2026-09-07', 'Feriado TH')`, [ORG])
      const [op1, op5] = [await personId("TH-OP-01"), await personId("TH-OP-05")]
      const ignored = await resolveEligibleDaysBySubject(db, [op1, op5], window, TZ, { now: NOW })
      expect(ignored.get(op1)).toMatchObject({ scheduledWorkDays: 5, excludedByHoliday: 0, holidayConfidence: { policy: "IGNORE", applicableHolidayDays: 1 } })
      await db.query(`update organizations set holiday_fallback_policy = 'EXCLUDE_APPLICABLE_HOLIDAYS' where id = $1`, [ORG])
      const eligibility = await resolveEligibleDaysBySubject(db, [op1, op5], window, TZ, { now: NOW })
      expect(eligibility.get(op1)).toMatchObject({ scheduledWorkDays: 4, excludedByHoliday: 1, excludedByScheduledDayOff: 2 })
      expect(eligibility.get(op1)!.scheduleConfidence.basis).toBe("LEGACY_WEEKDAY_FALLBACK")
      expect(eligibility.get(op5)!.eligibleDates).toContain("2026-09-07")
      expect(eligibility.get(op5)!.excludedByHoliday).toBe(0)
      await db.query(`update organizations set holiday_fallback_policy = 'IGNORE' where id = $1`, [ORG])
    })

    it("API Pull: mesmo contrato, mesma camada — segunda fonte alimenta o calendário de outro colaborador; regime 6x1 sem calendário = escala desconhecida", async () => {
      const http = new MockHttpClient()
      http.on("/escalas", () => json(200, { data: WEEK.map((date) => ({ matricula: "TH-OP-01", dia: date, trabalha: date !== "2026-09-13", escala: "6x1" })) }))
      http.on("/", () => json(200, { ok: true }))
      const apiCtx = createDataHubContext(db, { http, sftp: new FakeSftpClient(), logger: new CapturingLogger(), secrets: new InMemorySecretStore(), clock: { now: () => NOW } })
      const api = await createSource(apiCtx, ORG, null, { name: "TH Workforce", config: { kind: "API_PULL", api: { baseUrl: "https://wfm.th.local", auth: { kind: "BEARER" }, headers: {}, timeoutMs: 5000 } }, secrets: { token: "th-token" } })
      await setSourceStatus(apiCtx, ORG, null, api.id, "ACTIVATE")
      const feed = await setFeedStatus(apiCtx, ORG, null, (await createFeed(apiCtx, ORG, null, api.id, { feedKey: "escalas-api", name: "Work Schedules", contractKey: "WORK_SCHEDULE_DAYS", sourceNamespace: "th-wfm", cadence: { kind: "INTERVAL", minutes: 60 }, connectorConfig: { connector: "API_PULL", api: { endpoint: "/escalas", extractPath: "data", pagination: { kind: "NONE" }, checkpoint: { kind: "NONE" } } }, mapping: { fields: [{ target: "externalEmployeeId", source: "matricula", transforms: [] }, { target: "scheduleDate", source: "dia", transforms: [] }, { target: "scheduledToWork", source: "trabalha", transforms: [] }, { target: "scheduleType", source: "escala", transforms: [] }] } })).id, "ACTIVATE")
      const queued = await requestManualSync(apiCtx, ORG, feed.id, null)
      const load = (await executeRun(apiCtx, queued.id))!
      expect(load).toMatchObject({ status: "COMPLETED", recordsInserted: 7 })
      const op1 = await personId("TH-OP-01")
      const eligibility = (await resolveEligibleDaysBySubject(db, [op1], window, TZ, { now: NOW })).get(op1)!
      expect(eligibility).toMatchObject({ scheduledWorkDays: 6, eligibleDays: 6, excludedByScheduledDayOff: 1 })
      expect(eligibility.eligibleDates).toContain("2026-09-12")
      // OP-03: regime 6x1 conhecido, nenhum calendário → desconhecido, nunca seg–sex.
      const op3 = await personId("TH-OP-03")
      await db.query(`insert into employee_work_shifts (organization_id, person_id, start_time, work_minutes, effective_from, schedule_type) values ($1, $2, '08:00', 360, '2026-01-01', 'SIX_BY_ONE')`, [ORG, op3])
      const unknown = (await resolveEligibleDaysBySubject(db, [op3], window, TZ, { now: NOW })).get(op3)!
      expect(unknown).toMatchObject({ eligibleDays: 0, excludedByUnknownSchedule: 7 })
      expect(unknown.scheduleConfidence).toMatchObject({ basis: "UNKNOWN_SCHEDULE", scheduleType: "SIX_BY_ONE" })
    })

    it("freshness da escala: feed de escala atrasado → WORK_SCHEDULE_STALE para quem não mediu (fonte de situação FRESH, conexão intocada); Central expõe 'Escalas de trabalho'", async () => {
      const op1 = await personId("TH-OP-01")
      const fresh = await resolveWorkScheduleFreshness(db, ORG, NOW, TZ)
      expect(fresh.state).toBe("FRESH")
      await db.query(`update data_feeds set last_success_at = $2 where contract_key = 'WORK_SCHEDULE_DAYS' and organization_id = $1`, [ORG, new Date("2026-09-08T09:00:00-03:00")])
      const stale = await resolveWorkScheduleFreshness(db, ORG, NOW, TZ)
      expect(stale).toMatchObject({ state: "STALE", lastSuccessLocalDate: "2026-09-08" })
      const eligibility = (await resolveEligibleDaysBySubject(db, [op1], window, TZ, { now: NOW })).get(op1)!
      expect(eligibility.statusConfidence.freshness).toBe("FRESH")
      expect(eligibility.scheduleConfidence).toMatchObject({ freshness: "STALE", unconfirmedScheduleDays: 4 }) // 09–12 elegíveis depois da última carga (13 é folga)
      const condition = await evaluateDataCondition(db, { historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "TH_TEMPO", aggregation: "WEIGHTED_AVERAGE", source: "MEASUREMENT", period: { kind: "ROLLING_DAYS", days: 7 } }, comparator: "GT", thresholdNumeric: 1 }, { operatorId: op1, subjectIds: [op1] }, new Date("2026-09-13T21:00:00-03:00"), { organizationId: ORG, timeZone: TZ })
      expect(condition?.evaluation.reason).toBe("WORK_SCHEDULE_STALE")
      const overview = await buildOverview(ctx, ORG)
      expect(overview.workSchedule.state).toBe("STALE")
      expect(overview.dataMap.find((entry) => entry.contractKey === "WORK_SCHEDULE_DAYS")).toMatchObject({ label: "Escalas de trabalho", freshness: "STALE" })
      expect(overview.cards.sourcesWithError).toBe(0)
      await db.query(`update data_feeds set last_success_at = $2 where contract_key = 'WORK_SCHEDULE_DAYS' and organization_id = $1`, [ORG, NOW])
    })

    it("severidades: uma carga PARTIAL com 1 rejeitado (erro) e 1 conflito (aviso) — errorCount=1, warningCount=1, recordsRejected=1", async () => {
      // OP-05 tem INSS 11–12 explícito (ausência autoritativa). Snapshot EMPLOYEES 'EM PRODUÇÃO' com data 11/09 perde por precedência (aviso, registro aplicado); OP-99 não existe → erro.
      const load = await run(employeesFeed, csv([["externalEmployeeId", "name", "role", "hiredAt", "currentStatus", "statusEffectiveFrom"], ["TH-OP-05", "Elisa TH", "OPERATOR", "2024-01-08", "EM PRODUÇÃO", "2026-09-11"], ["TH-OP-06", "Fulano TH", "OPERATOR", "2024-01-08", "SABATICO", ""]]), "th-mix.csv")
      expect(load).toMatchObject({ status: "PARTIAL", recordsRejected: 1, errorCount: 1, warningCount: 1 })
      const rows = await rejections(load.id)
      expect(rows.map((row) => row.error_code).sort()).toEqual(["DATA_EMPLOYMENT_STATUS_CONFLICT", "DATA_EMPLOYMENT_STATUS_UNKNOWN"])
      const overview = await buildOverview(ctx, ORG)
      expect(overview.cards.warningsToday).toBeGreaterThanOrEqual(1)
    })
  })

  describe("exceções de calendário × capital operacional × feriados aplicáveis × medição em data não elegível", () => {
    const window = { start: new Date("2026-09-07T00:00:00-03:00"), end: new Date("2026-09-14T00:00:00-03:00") }
    let exceptionsFeed: DataFeedRow
    let indicatorId: string

    it("EMPLOYEES aceita Capital operacional pelo catálogo (nome oficial normalizado; abreviação da fonte só por 'Mapear códigos'; valor desconhecido = rejeição)", async () => {
      const load = await run(employeesFeed, csv([["externalEmployeeId", "name", "role", "hiredAt", "currentStatus", "statusEffectiveFrom", "operationalCapitalCode"], ["TH-OP-01", "Nathália TH", "OPERATOR", "2024-01-08", "", "", "Fortaleza"], ["TH-OP-02", "Bruno TH", "OPERATOR", "2024-01-08", "", "", "FOR"]]), "th-capital.csv")
      // O mapeamento do feed base não inclui operationalCapitalCode: nada muda até mapear.
      expect(load.status).toBe("COMPLETED")
      const mapped = await createFeed(ctx, ORG, null, source.id, { feedKey: "colaboradores-capital", name: "Colaboradores (capital)", contractKey: "EMPLOYEES", connectorConfig: fileFeedConfig, authoritative: false, sourceNamespace: "th-rh-capital", cadence: { kind: "INTERVAL", minutes: 60 }, mapping: { fields: [...identity(["externalEmployeeId", "name", "role"]).fields, { target: "operationalCapitalCode", source: "capital", transforms: [{ kind: "CODE_MAP", map: { FOR: "FORTALEZA", "CE-FOR": "FORTALEZA" }, otherwise: "KEEP" }] }] } })
      const capitalFeed = await setFeedStatus(ctx, ORG, null, mapped.id, "ACTIVATE")
      const second = await run(capitalFeed, csv([["externalEmployeeId", "name", "role", "capital"], ["TH-OP-01", "Nathália TH", "OPERATOR", "Fortaleza"], ["TH-OP-02", "Bruno TH", "OPERATOR", "FOR"], ["TH-OP-03", "Carla TH", "OPERATOR", "Fortal"], ["TH-OP-07", "Gabi TH", "OPERATOR", "CE-FOR"], ["TH-OP-08", "Heitor TH", "OPERATOR", ""]]), "th-capital-2.csv")
      expect(second).toMatchObject({ status: "PARTIAL", recordsRejected: 1, recordsInserted: 2 })
      expect((await rejections(second.id)).map((row) => row.error_code)).toEqual(["DATA_INVALID_ENUM"])
      const rows = (await db.query<{ matricula: string; operational_capital_code: string | null }>(`select matricula, operational_capital_code from people where organization_id = $1 and matricula in ('TH-OP-01','TH-OP-02','TH-OP-03') order by matricula`, [ORG])).rows
      expect(rows.map((row) => row.operational_capital_code)).toEqual(["FORTALEZA", "FORTALEZA", null])
      const overview = await buildOverview(ctx, ORG)
      expect(overview.calendarQuality.operationalCapital).toMatchObject({ filled: 3 })
      expect(overview.calendarQuality.operationalCapital.total).toBeGreaterThanOrEqual(5)
    })

    it("catálogo-base: UF derivada da capital — feriado estadual CE vale para Fortaleza, não para quem não tem capital; escala explícita vence; política IGNORE não altera", async () => {
      await db.query(`insert into holiday_catalog (holiday_date, name, scope, state_code, source_name, source_reference) values ('2026-09-08', 'TH Feriado CE', 'STATE', 'CE', 'prova', 'https://example.test') on conflict do nothing`)
      await db.query(`insert into holiday_catalog (holiday_date, name, scope, capital_code, source_name, source_reference) values ('2026-09-10', 'TH Feriado Salvador', 'MUNICIPAL_CAPITAL', 'SALVADOR', 'prova', 'https://example.test') on conflict do nothing`)
      const [op7, op8, op5] = [await personId("TH-OP-07"), await personId("TH-OP-08"), await personId("TH-OP-05")]
      await db.query(`update people set operational_capital_code = 'FORTALEZA' where id = $1`, [op5])
      await db.query(`update organizations set holiday_fallback_policy = 'EXCLUDE_APPLICABLE_HOLIDAYS' where id = $1`, [ORG])
      const eligibility = await resolveEligibleDaysBySubject(db, [op7, op8, op5], window, TZ, { now: NOW })
      // op7 (Fortaleza, sem escala = fallback): 07/09 data da organização + 08/09 feriado CE excluídos; Salvador não vale.
      expect(eligibility.get(op7)).toMatchObject({ excludedByHoliday: 2, eligibleDays: 3, holidayConfidence: { confidence: "CAPITAL_KNOWN", operationalCapitalCode: "FORTALEZA", applicableHolidayDays: 2 } })
      // op8 (sem capital, fallback): só a data da organização é conhecida; estadual/municipal não são inferidos.
      expect(eligibility.get(op8)).toMatchObject({ excludedByHoliday: 1, eligibleDays: 4, holidayConfidence: { confidence: "CAPITAL_UNKNOWN", applicableHolidayDays: 1 } })
      // op5 (Fortaleza, escala explícita): nada excluído por feriado.
      expect(eligibility.get(op5)!.excludedByHoliday).toBe(0)
      await db.query(`update organizations set holiday_fallback_policy = 'IGNORE' where id = $1`, [ORG])
      expect((await resolveEligibleDaysBySubject(db, [op7], window, TZ, { now: NOW })).get(op7)).toMatchObject({ excludedByHoliday: 0, eligibleDays: 5 })
    })

    it("WORK_SCHEDULE_EXCEPTIONS (CSV): day off numa terça programada vence a escala; a medição da terça fica no banco e SAI do valor; lineage até o Run; 2× não duplica; 'active=false' cancela sem apagar", async () => {
      exceptionsFeed = await setFeedStatus(ctx, ORG, null, (await createFeed(ctx, ORG, null, source.id, { feedKey: "excecoes", name: "Exceções de calendário", contractKey: "WORK_SCHEDULE_EXCEPTIONS", connectorConfig: fileFeedConfig, authoritative: true, sourceNamespace: "th-rh-excecoes", cadence: { kind: "INTERVAL", minutes: 60 }, mapping: { fields: [{ target: "externalEmployeeId", source: "matricula", transforms: [] }, { target: "date", source: "data", transforms: [] }, { target: "exceptionCode", source: "tipo", transforms: [{ kind: "CODE_MAP", map: { DO: "DAY_OFF", BH: "BANCO_HORAS" }, otherwise: "KEEP" }] }, { target: "reason", source: "motivo", transforms: [] }, { target: "active", source: "vigente", transforms: [{ kind: "BOOLEAN_MAP", trueValues: ["S"], falseValues: ["N"] }] }, { target: "externalExceptionId", source: "id", transforms: [] }] } })).id, "ACTIVATE")
      const op5 = await personId("TH-OP-05")
      // Situação: limpa INSS anterior para isolar o efeito da exceção; escala da semana: só a quarta 09 e a quinta 10 são folga.
      await db.query(`delete from employee_status_periods where person_id = $1`, [op5])
      indicatorId = (await db.query<{ id: string }>(`select id from indicator_definitions where organization_id = $1 and code = 'TH_TEMPO'`, [ORG])).rows[0]!.id
      for (const [date, value] of [["2026-09-07", 400], ["2026-09-08", 900], ["2026-09-11", 420], ["2026-09-12", 410], ["2026-09-13", 430]] as const) {
        await db.query(`insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, granularity, period_start, period_end, value, numerator, denominator, sample_count, source) values ($1, $2, 'PERSON', $3, 'DAILY', $4::timestamptz, $4::timestamptz + interval '1 day', $5, $5, 1, 1, 'th-medicoes') on conflict do nothing`, [ORG, indicatorId, op5, `${date}T00:00:00-03:00`, value])
      }
      const rowsBefore = (await db.query<{ c: number }>(`select count(*)::int c from indicator_measurements where subject_id = $1`, [op5])).rows[0]!.c
      const before = (await resolveOperationalWindowBySubject(db, { indicatorCode: "TH_TEMPO", subjectIds: [op5], window, aggregation: "WEIGHTED_AVERAGE", expectedDays: 7, timeZone: TZ, now: NOW }, { organizationId: ORG })).get(op5)!
      // Quinta 10/09 é folga (corrigida na prova anterior): a medição de 300 s daquele dia já está fora — preservada, ignorada.
      expect(before).toMatchObject({ daysWithData: 5, expectedDays: 5, coverage: 1, ignoredMeasurements: 1 })
      const load = await run(exceptionsFeed, csv([["matricula", "data", "tipo", "motivo", "vigente", "id"], ["TH-OP-05", "2026-09-08", "DO", "Day off concedido", "S", "EXC-1"], ["TH-OP-05", "2026-09-08", "DO", "Day off concedido", "S", "EXC-1"], ["TH-OP-99", "2026-09-08", "DO", "", "S", "EXC-2"], ["TH-OP-04", "2026-09-08", "FERIADO", "", "S", "EXC-3"]]), "th-excecoes.csv")
      expect(load).toMatchObject({ status: "PARTIAL", recordsInserted: 1, recordsRejected: 3 })
      expect((await rejections(load.id)).map((row) => row.error_code).sort()).toEqual(["DATA_DUPLICATE", "DATA_EMPLOYEE_NOT_FOUND", "DATA_INVALID_ENUM"])
      const eligibility = (await resolveEligibleDaysBySubject(db, [op5], window, TZ, { now: NOW })).get(op5)!
      expect(eligibility).toMatchObject({ scheduledWorkDays: 5, eligibleDays: 4, excludedByScheduleException: { DAY_OFF: 1 }, excludedByScheduledDayOff: 2 })
      expect(eligibility.eligibleDates).not.toContain("2026-09-08")
      const after = (await resolveOperationalWindowBySubject(db, { indicatorCode: "TH_TEMPO", subjectIds: [op5], window, aggregation: "WEIGHTED_AVERAGE", expectedDays: 7, timeZone: TZ, now: NOW }, { organizationId: ORG })).get(op5)!
      // Terça (900 s) e quinta (300 s, folga corrigida antes) ficam fora: valor só dos 4 dias elegíveis; linhas continuam no banco.
      expect(after).toMatchObject({ daysWithData: 4, expectedDays: 4, coverage: 1, ignoredMeasurements: 2 })
      expect(after.value).toBeCloseTo((400 + 420 + 410 + 430) / 4, 1)
      expect((await db.query(`select count(*)::int c from indicator_measurements where subject_id = $1`, [op5])).rows[0]).toEqual({ c: rowsBefore }) // nenhuma linha apagada
      expect((await db.query(`select value::float value from indicator_measurements where subject_id = $1 and period_start = '2026-09-08T00:00:00-03:00'`, [op5])).rows[0]).toEqual({ value: 900 })
      const latest = (await resolveOperationalWindowBySubject(db, { indicatorCode: "TH_TEMPO", subjectIds: [op5], window: { start: window.start, end: new Date("2026-09-09T00:00:00-03:00") }, aggregation: "LATEST", expectedDays: 2, timeZone: TZ, now: NOW }, { organizationId: ORG })).get(op5)!
      expect(latest.value).toBe(400) // último valor EM DATA ELEGÍVEL (segunda), não a última linha física (terça, day off)
      const row = (await db.query<{ id: string; active: boolean; raw_reason: string }>(`select id, active, raw_reason from employee_schedule_exceptions where person_id = $1 and exception_date = '2026-09-08'`, [op5])).rows[0]!
      expect(row).toMatchObject({ active: true, raw_reason: "Day off concedido" })
      expect((await lineageOf(ctx, ORG, "employee_schedule_exceptions", row.id)).map((entry) => [entry.runId, entry.action, entry.contractKey])).toEqual([[load.id, "INSERTED", "WORK_SCHEDULE_EXCEPTIONS"]])
      const summary = await loadWorkScheduleSummary(db, ORG, op5, "2026-09-08", NOW, TZ)
      expect(summary.todayException).toMatchObject({ code: "DAY_OFF", label: "Day off" })
      expect(summary.knownUntil).toBe("2026-09-13")
      // Idempotência + cancelamento: mesma linha 2× = 1 registro; 'vigente = N' cancela sem apagar e o dia volta a ser elegível.
      const again = await run(exceptionsFeed, csv([["matricula", "data", "tipo", "motivo", "vigente", "id"], ["TH-OP-05", "2026-09-08", "DO", "Day off concedido", "S", "EXC-1"]]), "th-excecoes-2.csv")
      expect(again).toMatchObject({ recordsInserted: 0, recordsUpdated: 0, recordsUnchanged: 1 })
      const cancel = await run(exceptionsFeed, csv([["matricula", "data", "tipo", "motivo", "vigente", "id"], ["TH-OP-05", "2026-09-08", "DO", "Day off cancelado", "N", "EXC-1"]]), "th-excecoes-3.csv")
      expect(cancel).toMatchObject({ recordsUpdated: 1 })
      expect((await db.query(`select count(*)::int c from employee_schedule_exceptions where person_id = $1`, [op5])).rows[0]).toEqual({ c: 1 })
      const restored = (await resolveOperationalWindowBySubject(db, { indicatorCode: "TH_TEMPO", subjectIds: [op5], window, aggregation: "WEIGHTED_AVERAGE", expectedDays: 7, timeZone: TZ, now: NOW }, { organizationId: ORG })).get(op5)!
      expect(restored).toMatchObject({ daysWithData: 5, expectedDays: 5, ignoredMeasurements: 1 })
    })

    it("horizonte da escala ≠ freshness: calendário conhecido até 13/09 → 'termina em N dias' pelo limite configurado; Central expõe horizonte, 6x1 sem calendário e exceções", async () => {
      const horizon = await resolveWorkScheduleHorizon(db, ORG, "2026-09-10")
      expect(horizon).toMatchObject({ configured: true, coverageFrom: "2026-09-07", coverageUntil: "2026-09-13", daysRemaining: 4, warningDays: 7, endingSoon: true })
      await db.query(`update organizations set schedule_horizon_warning_days = 3 where id = $1`, [ORG])
      expect((await resolveWorkScheduleHorizon(db, ORG, "2026-09-10")).endingSoon).toBe(false)
      const overview = await buildOverview(ctx, ORG)
      expect(overview.workScheduleHorizon).toMatchObject({ coverageUntil: "2026-09-13", warningDays: 3 })
      // TH-OP-05 tem regime 6x1 com calendário; TH-OP-01 recebeu regime 6x1 sem calendário na prova de API Pull.
      expect(overview.calendarQuality.sixByOne.total).toBeGreaterThanOrEqual(1)
      expect(overview.calendarQuality).toMatchObject({ activeExceptionsAhead: 0 })
    })
  })

  it("Ausências @2: 'Vigente? = não' desfaz o período (auditado) e a situação volta ao cadastro; cancelar de novo ou o que nunca chegou não muda nada; reenviar como vigente recria; período de outra origem fica e vira aviso", async () => {
    const hire = await run(employeesFeed, csv([["externalEmployeeId", "name", "role", "hiredAt", "currentStatus", "statusEffectiveFrom"], ["TH-OP-09", "Gabriel TH", "OPERATOR", "2024-01-08", "EM PRODUÇÃO", ""]]), "th-op09.csv")
    expect(hire.status).toBe("COMPLETED")
    const op9 = await personId("TH-OP-09")
    expect(absencesFeed.contractVersion).toBe(2) // feed novo nasce na versão atual
    absencesFeed = await updateFeed(ctx, ORG, null, absencesFeed.id, { mapping: { fields: [...identity(["externalEmployeeId", "type", "startDate", "endDate"]).fields, { target: "active", source: "vigente", transforms: [] }] } })
    const header = ["externalEmployeeId", "type", "startDate", "endDate", "vigente"]
    const shape = async () => (await loadEmploymentStatusHistory(db, op9)).map((period) => [period.status, period.effectiveFrom, period.effectiveTo])
    const split = [["EM_PRODUCAO", "2026-09-16", "2026-10-04"], ["FERIAS", "2026-10-05", "2026-10-14"], ["EM_PRODUCAO", "2026-10-15", null]]

    const vacation = await run(absencesFeed, csv([header, ["TH-OP-09", "FERIAS", "2026-10-05", "2026-10-14", "S"]]), "th-op09-ferias.csv")
    expect(vacation).toMatchObject({ status: "COMPLETED", recordsInserted: 1, warningCount: 0 })
    expect(await shape()).toEqual(split)
    const vacationId = (await loadEmploymentStatusHistory(db, op9)).find((period) => period.status === "FERIAS")!.id

    // O RH cancelou as férias inteiras: a mesma fonte manda a identidade com vigente = N.
    const cancel = await run(absencesFeed, csv([header, ["TH-OP-09", "FERIAS", "2026-10-05", "2026-10-14", "N"]]), "th-op09-cancela.csv")
    expect(cancel).toMatchObject({ status: "COMPLETED", recordsRejected: 0, recordsInserted: 0, recordsUpdated: 0, recordsUnchanged: 0, recordsDeactivated: 1, warningCount: 0 })
    expect(await shape()).toEqual([["EM_PRODUCAO", "2026-09-16", null]]) // as duas metades do cadastro voltam a ser uma só
    expect(await resolveEmployeeStatusAt(db, op9, "2026-10-07")).toMatchObject({ status: "EM_PRODUCAO", basis: "OPEN_PERIOD", confirmed: true })
    const audit = (await db.query<{ entity_id: string; actor_id: string | null; payload: Record<string, unknown> }>(`select entity_id, actor_id, payload from audit_logs where organization_id = $1 and action = 'DATA_HUB_EMPLOYEE_ABSENCE_CANCELLED'`, [ORG])).rows
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      entity_id: vacationId,
      actor_id: null,
      payload: { runId: cancel.id, feedId: absencesFeed.id, contract: "EMPLOYEE_ABSENCES@2", matricula: "TH-OP-09", removed: { status: "FERIAS", effectiveFrom: "2026-10-05", effectiveTo: "2026-10-14", effectiveToExplicit: true, source: "th-rh-ausencias" }, restored: { status: "EM_PRODUCAO", effectiveFrom: "2026-09-16", effectiveTo: null } },
    })
    const current = (await loadEmploymentStatusHistory(db, op9))[0]!
    expect((await lineageOf(ctx, ORG, "employee_status_periods", current.id)).map((entry) => [entry.runId, entry.action])).toContainEqual([cancel.id, "UPDATED"])

    // Cancelar de novo e cancelar uma ausência que nunca chegou: nada muda, nada vira aviso, nada é inventado.
    const noop = await run(absencesFeed, csv([header, ["TH-OP-09", "FERIAS", "2026-10-05", "2026-10-14", "N"], ["TH-OP-09", "INSS", "2026-11-02", "", "N"]]), "th-op09-nada.csv")
    expect(noop).toMatchObject({ status: "COMPLETED", recordsRejected: 0, recordsDeactivated: 0, recordsUnchanged: 2, warningCount: 0 })
    expect(await shape()).toEqual([["EM_PRODUCAO", "2026-09-16", null]])
    expect((await db.query(`select count(*)::int c from audit_logs where organization_id = $1 and action = 'DATA_HUB_EMPLOYEE_ABSENCE_CANCELLED'`, [ORG])).rows[0]).toEqual({ c: 1 })

    // Reativar: a mesma identidade como vigente recria o período.
    const reactivate = await run(absencesFeed, csv([header, ["TH-OP-09", "FERIAS", "2026-10-05", "2026-10-14", "s"]]), "th-op09-reativa.csv")
    expect(reactivate).toMatchObject({ status: "COMPLETED", recordsInserted: 1, recordsDeactivated: 0 })
    expect(await shape()).toEqual(split)
    expect(await resolveEmployeeStatusAt(db, op9, "2026-10-07")).toMatchObject({ status: "FERIAS", basis: "EXPLICIT_PERIOD", confirmed: true })

    // Período de outra origem (ajuste manual do admin) não é cancelado pela carga: fica, e o pedido vira aviso rastreável.
    await applyEmployeeStatusSnapshot(db, { organizationId: ORG, personId: op9, status: "INSS", effectiveFrom: "2026-12-01", effectiveTo: "2026-12-20", observedAt: NOW, source: "MANUAL", timeZone: TZ, authoritative: true })
    const foreign = await run(absencesFeed, csv([header, ["TH-OP-09", "INSS", "2026-12-01", "2026-12-20", "N"]]), "th-op09-manual.csv")
    expect(foreign).toMatchObject({ status: "COMPLETED", recordsRejected: 0, recordsDeactivated: 0, recordsUnchanged: 1, warningCount: 1 })
    const notes = await rejections(foreign.id)
    expect(notes).toHaveLength(1)
    expect(notes[0]!.error_code).toBe("DATA_EMPLOYMENT_STATUS_CONFLICT")
    expect(notes[0]!.message).toMatch(/foi informado por MANUAL\. Decisão: mantido o período existente/)
    expect(await shape()).toContainEqual(["INSS", "2026-12-01", "2026-12-20"])
  })

  it("feed criado na versão 1 continua na versão 1 (sem 'Vigente?') até o mapeamento ser salvo na versão atual — a troca fica auditada", async () => {
    const legacy = await createFeed(ctx, ORG, null, source.id, { feedKey: "ausencias-v1", name: "Ausências v1", contractKey: "EMPLOYEE_ABSENCES", contractVersion: 1, connectorConfig: fileFeedConfig, sourceNamespace: "th-rh-ausencias", mapping: identity(["externalEmployeeId", "type", "startDate", "endDate", "active"]) })
    expect(legacy.contractVersion).toBe(1)
    await expect(setFeedStatus(ctx, ORG, null, legacy.id, "ACTIVATE")).rejects.toThrow(/"active" não existe no contrato EMPLOYEE_ABSENCES/)
    const kept = await setFeedStatus(ctx, ORG, null, (await updateFeed(ctx, ORG, null, legacy.id, { mapping: identity(["externalEmployeeId", "type", "startDate", "endDate"]) })).id, "ACTIVATE")
    expect(kept.contractVersion).toBe(1)
    // Carga num feed @1: lê pelo contrato @1 (o registro guarda a versão anterior), como antes.
    const load = await run(kept, csv([["externalEmployeeId", "type", "startDate", "endDate"], ["TH-OP-09", "PATERNIDADE", "2027-01-04", "2027-01-08"]]), "th-v1.csv")
    expect(load).toMatchObject({ status: "COMPLETED", contractVersion: 1, recordsInserted: 1 })
    const upgraded = await updateFeed(ctx, ORG, null, legacy.id, { contractVersion: 2, mapping: identity(["externalEmployeeId", "type", "startDate", "endDate", "active"]) })
    expect(upgraded.contractVersion).toBe(2)
    const audit = (await db.query<{ payload: Record<string, unknown> }>(`select payload from audit_logs where organization_id = $1 and entity_id = $2 and action = 'DATA_HUB_FEED_UPDATED' order by created_at desc limit 1`, [ORG, legacy.id])).rows[0]!
    expect(audit.payload).toMatchObject({ mappingChanged: true, contract: "EMPLOYEE_ABSENCES@2", previousContract: "EMPLOYEE_ABSENCES@1" })
    await expect(updateFeed(ctx, ORG, null, legacy.id, { contractVersion: 3 })).rejects.toThrow(/EMPLOYEE_ABSENCES@3/)
  })
})
