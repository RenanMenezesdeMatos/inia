import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createDataHubContext, type DataHubContext } from "../../data-hub/application/data-hub-context.js"
import { createFeed, setFeedStatus } from "../../data-hub/application/feed-service.js"
import { buildCalendarQuality } from "../../data-hub/application/overview-service.js"
import type { DataFeedRow, DataRunRow, DataSourceRow } from "../../data-hub/application/records.js"
import { executeRun } from "../../data-hub/application/run-pipeline.js"
import { enqueueRun } from "../../data-hub/application/run-service.js"
import { createSource } from "../../data-hub/application/source-service.js"
import { CapturingLogger, FakeSftpClient, InMemorySecretStore, MockHttpClient } from "../../data-hub/testing/fakes.js"
import { resolveEligibleDaysBySubject, resolveOperationalWindowBySubject } from "../../indicators/application/operational-measurement-resolver.js"
import { buildNotificationSummary } from "../../notifications/application/build-notification-summary.js"
import { PgNotificationsRepository } from "../../notifications/application/notifications-repository.js"
import { buildPendingActions, decideWorkdayReconciliation } from "../../pending-actions/application/build-pending-actions.js"
import { PgPendingActionsRepository } from "../../pending-actions/application/pending-actions-repository.js"
import { evaluateDataCondition } from "../../workflows/application/condition-evaluator.js"
import { cancelScheduleException, loadScheduleExceptionAudit, provisionScheduleExceptions } from "../application/schedule-exception-service.js"
import { syncScheduleHorizonAlerts } from "../application/schedule-horizon-alert-service.js"
import { buildTeamCalendar } from "../application/team-calendar.js"
import { reconcileOrganizationWorkdays, resolveReconciliation } from "../application/workday-reconciliation-service.js"
import { classificationHistoryForTeam, classifyForTeam } from "../application/team-calendar.js"
import { loadClassificationHistory } from "../application/workday-classification-service.js"
import { updateIndicatorDefinition } from "../../indicators/application/indicator-definition-service.js"
import { fixedClock } from "../../../shared/domain/clock.js"
import { PgAnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"

/**
 * PLANEJADO × OBSERVADO — prova contra o banco de teste real (INIA_DB_PROOF=1):
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run workday-reconciliation-proof
 * Cobre a lista essencial da rodada: programado + produção → trabalhou; programado sem produção →
 * pendência só depois do turno; day off/banco/folga 6x1 + produção → elegível observado com divergência;
 * INSS/férias + produção → não elegível + inconsistência; produção atrasada → pendência auto-resolvida;
 * Supervisor provisiona antes (aplicada) e cancela (cálculo reverte); Central × Supervisor em conflito
 * → aviso auditável, nunca sobrescrita; resolução da pendência (não trabalhou / dados não chegaram /
 * corrigir escala); alerta de horizonte idempotente e resolvido quando o calendário avança;
 * nenhuma medição bruta apagada em momento algum.
 * Último hardening (migration 069): fim do turno ≠ dado fechado — política de disponibilidade D-1/D-2
 * por feed (a organização de teste tem políticas "mesmo dia até 14:30" para os cenários base), pendência
 * só depois das fontes fecharem; classificação humana revisável (falta injustificada / ausência
 * justificada / dados não chegaram) com histórico; política por indicador (contribuição zero × sem
 * amostra) sem medição sintética; dado tardio e RH tardio superam a classificação preservando o
 * histórico; fonte atrasada gera alerta administrativo, nunca pendência por pessoa; permissão 403.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "de00ee00-0000-4000-8000-00000000f1f0"
const OPERATION = "de00ee00-0000-4000-8000-00000000f1f1"
const TZ = "America/Fortaleza"
/** Quarta 16/09 15:00 local — turno 08:00–14:20 já encerrado. */
const NOW = new Date("2026-09-16T15:00:00-03:00")
const MID_SHIFT = new Date("2026-09-16T13:00:00-03:00")
const WEEK = { start: new Date("2026-09-14T03:00:00Z"), end: new Date("2026-09-17T03:00:00Z") } // seg 14 → qua 16

let pool: pg.Pool
let db: Database
let ctx: DataHubContext
let source: DataSourceRow
let exceptionsFeed: DataFeedRow
let availabilitySource: DataSourceRow
let measurementsFeed: DataFeedRow
let interactionsFeed: DataFeedRow
let indicatorId: string
const ids: Record<"admin" | "adminAccount" | "legacyAdmin" | "legacyAdminAccount" | "sup" | "sup2" | "a" | "b" | "c" | "d" | "e" | "f", string> = { admin: "", adminAccount: "", legacyAdmin: "", legacyAdminAccount: "", sup: "", sup2: "", a: "", b: "", c: "", d: "", e: "", f: "" }

const csv = (rows: string[][]) => new TextEncoder().encode(rows.map((row) => row.join(";")).join("\n"))
const fileFeedConfig = { connector: "FILE_UPLOAD" as const, file: { format: "CSV" as const, csv: { encoding: "utf-8" as const, delimiter: "auto" as const, hasHeader: true, skipRows: 0 }, excel: { hasHeader: true, skipRows: 0 } } }

async function runFeed(feed: DataFeedRow, content: Uint8Array, filename: string): Promise<DataRunRow> {
  const raw = await ctx.rawObjects.put({ organizationId: ORG, sourceId: feed.sourceId, feedId: feed.id, filename, contentType: "text/csv", content })
  const { run } = await enqueueRun(ctx, { organizationId: ORG, feed, triggerKind: "FILE_UPLOAD", requestedBy: null, rawObjectId: raw.id })
  return (await executeRun(ctx, run.id))!
}

async function measure(personId: string, date: string, value: number, source = "th-vol"): Promise<void> {
  await db.query(
    `insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, granularity, period_start, period_end, value, numerator, denominator, sample_count, source)
     values ($1, $2, 'PERSON', $3, 'DAILY', $4::timestamptz, $4::timestamptz + interval '1 day', $5, $5, 1, 1, $6) on conflict do nothing`,
    [ORG, indicatorId, personId, `${date}T00:00:00-03:00`, value, source],
  )
}

async function interaction(personId: string, date: string, key: string): Promise<void> {
  await db.query(`insert into interactions (organization_id, operator_id, reason, channel, started_at, ended_at, external_id) values ($1, $2, 'Atendimento', 'VOICE', $3::timestamptz, $3::timestamptz + interval '5 minutes', $4) on conflict do nothing`, [ORG, personId, `${date}T10:00:00-03:00`, key])
}

async function schedule(personId: string, dates: string[], work: boolean): Promise<void> {
  for (const date of dates) {
    await db.query(
      `insert into employee_schedule_days (organization_id, person_id, schedule_date, scheduled_to_work, shift_start, shift_end, schedule_type, source, observed_at)
       values ($1, $2, $3::date, $4, case when $4 then '08:00'::time end, case when $4 then '14:20'::time end, 'FIVE_BY_TWO', 'th-escala', now())
       on conflict (person_id, schedule_date) do update set scheduled_to_work = excluded.scheduled_to_work, shift_end = excluded.shift_end`,
      [ORG, personId, date, work],
    )
  }
}

async function rawCount(): Promise<number> {
  return (await db.query<{ c: number }>(`select count(*)::int c from indicator_measurements where organization_id = $1`, [ORG])).rows[0]!.c
}

async function reconciliations(personId: string) {
  return (await db.query<{ workday: string; kind: string; status: string; resolution: string | null }>(`select to_char(workday, 'YYYY-MM-DD') workday, kind, status, resolution from workday_reconciliations where person_id = $1 order by workday, kind`, [personId])).rows
}

async function alerts(recipientId: string, type: string) {
  return (await db.query<{ status: string; title: string; description: string; dedupe_key: string }>(`select status::text, title, description, dedupe_key from alerts where recipient_id = $1 and alert_type = $2 order by created_at`, [recipientId, type])).rows
}

async function cleanup() {
  await db.query(`update workday_reconciliations set classification_id = null where organization_id = $1`, [ORG])
  await db.query(`delete from workday_classifications where organization_id = $1`, [ORG])
  await db.query(`delete from workday_reconciliations where organization_id = $1`, [ORG])
  await db.query(`delete from alerts where organization_id = $1`, [ORG])
  await db.query(`delete from data_sources where organization_id = $1`, [ORG])
  await db.query(`delete from data_raw_objects where organization_id = $1`, [ORG])
  await db.query(`delete from interactions where organization_id = $1`, [ORG])
  await db.query(`delete from indicator_measurements where organization_id = $1`, [ORG])
  await db.query(`delete from employee_status_periods where organization_id = $1`, [ORG])
  await db.query(`delete from employee_schedule_days where organization_id = $1`, [ORG])
  await db.query(`delete from employee_schedule_exceptions where organization_id = $1`, [ORG])
  await db.query(`delete from employee_work_shifts where organization_id = $1`, [ORG])
  await db.query(`delete from audit_logs where organization_id = $1`, [ORG])
  await db.query(`delete from access_role_assignments where organization_id = $1`, [ORG])
  await db.query(`delete from user_accounts where organization_id = $1`, [ORG])
  await db.query(`update people set reports_to_id = null where organization_id = $1`, [ORG])
  await db.query(`delete from people where organization_id = $1`, [ORG])
  await db.query(`delete from indicator_definitions where organization_id = $1`, [ORG])
  await db.query(`delete from operations where organization_id = $1`, [ORG])
  await db.query(`delete from organizations where id = $1`, [ORG])
}

async function person(matricula: string, name: string, role: string, reportsTo: string | null): Promise<string> {
  const result = await db.query<{ id: string }>(`insert into people (organization_id, name, role, matricula, hired_at, active, reports_to_id, job_title) values ($1, $2, $3, $4, '2024-01-08', true, $5, $3) returning id`, [ORG, name, role, matricula, reportsTo])
  return result.rows[0]!.id
}

function viewer(personId: string, role: AuthTokenPayload["role"], sub?: string): AuthTokenPayload {
  return { sub, personId, organizationId: ORG, role, email: `${personId}@th.local`, name: "viewer" } as unknown as AuthTokenPayload
}

/** V1.5.8: acesso amplo = CONTA com papel (nunca o nível hierárquico). Devolve o id da conta. */
async function accountWithRole(personId: string, roleCode: string | null): Promise<string> {
  const account = (await db.query<{ id: string }>(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, 'x') returning id`, [ORG, personId, `${personId}@th.local`])).rows[0]!.id
  if (roleCode) await db.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, $3, 'ORGANIZATION', now())`, [ORG, account, roleCode])
  return account
}

describe.skipIf(!ENABLED)("PLANEJADO × OBSERVADO — reconciliação, provisionamento, conflito e pendência (banco real)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    db = pool
    ctx = createDataHubContext(db, { http: new MockHttpClient(), sftp: new FakeSftpClient(), logger: new CapturingLogger(), secrets: new InMemorySecretStore(), clock: { now: () => NOW } })
    await cleanup()
    await db.query(`insert into organizations (id, name, slug, schedule_horizon_warning_days) values ($1, 'TH Reconciliação', 'th-reconciliacao', 7) on conflict (id) do nothing`, [ORG])
    await db.query(`insert into operations (id, organization_id, name, timezone) values ($1, $2, 'TH Operação', $3) on conflict (id) do nothing`, [OPERATION, ORG, TZ])
    indicatorId = (await db.query<{ id: string }>(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction, daily_supported, operational_aggregation, official_closure_supported, active, proves_work_activity) values ($1, 'TH_VOL', 'Atendimentos TH', 'COUNT', 'HIGHER', true, 'SUM', false, true, true) returning id`, [ORG])).rows[0]!.id
    await db.query(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction, daily_supported, operational_aggregation, official_closure_supported, active) values ($1, 'TH_QUAL', 'Qualidade TH', 'PERCENT', 'HIGHER', true, 'WEIGHTED_AVERAGE', false, true)`, [ORG])
    ids.admin = await person("TH-ADM", "Admin TH", "ADMIN", null)
    ids.adminAccount = await accountWithRole(ids.admin, "ADMINISTRADOR_GERAL")
    // Nível hierárquico legado "ADMIN" SEM papel: não recebe avisos administrativos nem vê calendário de ninguém.
    ids.legacyAdmin = await person("TH-ADM-LEGADO", "Admin Legado TH", "ADMIN", null)
    ids.legacyAdminAccount = await accountWithRole(ids.legacyAdmin, null)
    ids.sup = await person("TH-SUP", "Supervisora TH", "SUPERVISOR", null)
    ids.a = await person("TH-A", "Ana TH", "OPERATOR", ids.sup)
    ids.b = await person("TH-B", "Bia TH", "OPERATOR", ids.sup)
    ids.c = await person("TH-C", "Caio TH", "OPERATOR", ids.sup)
    ids.d = await person("TH-D", "Dani TH", "OPERATOR", ids.sup)
    ids.e = await person("TH-E", "Edu TH", "OPERATOR", ids.sup)
    ids.sup2 = await person("TH-SUP2", "Supervisor Outro TH", "SUPERVISOR", null)
    // DISPONIBILIDADE: feeds relevantes com política explícita ("mesmo dia até 14:30", carregados às 15:00 de
    // quarta) — sem eles nenhuma ausência seria concluída (AVAILABILITY_UNKNOWN). Cenários D-1/D-2 mudam a política adiante.
    availabilitySource = await createSource(ctx, ORG, null, { name: "TH Operacional", config: { kind: "FILE_UPLOAD" } })
    const feedOf = async (feedKey: string, contractKey: string, fields: { target: string; source: string }[]) =>
      setFeedStatus(ctx, ORG, null, (await createFeed(ctx, ORG, null, availabilitySource.id, { feedKey, name: feedKey, contractKey, connectorConfig: fileFeedConfig, availabilityPolicy: { lagDays: 0, availableByLocalTime: "14:30" }, mapping: { fields: fields.map((field) => ({ ...field, transforms: [] })) } })).id, "ACTIVATE")
    measurementsFeed = await feedOf("medicoes", "INDICATOR_MEASUREMENTS", [{ target: "externalEmployeeId", source: "m" }, { target: "indicatorCode", source: "i" }, { target: "date", source: "d" }, { target: "value", source: "v" }])
    interactionsFeed = await feedOf("interacoes", "INTERACTIONS", [{ target: "externalInteractionId", source: "id" }, { target: "externalEmployeeId", source: "m" }, { target: "reason", source: "r" }, { target: "startedAt", source: "s" }, { target: "endedAt", source: "e" }])
    await db.query(`update data_feeds set last_success_at = $2, last_data_at = $2 where id = any($1::uuid[])`, [[measurementsFeed.id, interactionsFeed.id], NOW])
    const week = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"]
    for (const id of [ids.a, ids.b, ids.c, ids.d, ids.e]) await schedule(id, week, true)
    await schedule(ids.b, ["2026-09-13"], false) // domingo de folga explícita (6x1)
    await schedule(ids.b, ["2026-09-12"], true)
    await db.query(`insert into employee_status_periods (organization_id, person_id, status, effective_from, effective_to, effective_to_explicit, source, observed_at) values ($1, $2, 'INSS', '2026-09-10', '2026-09-20', true, 'th-rh', now())`, [ORG, ids.c])
    // OBSERVADO: A produziu seg 14 (medição do indicador marcado) — ter 15 sem nada; B produziu no domingo de folga (interação); C (INSS) tem medição.
    await measure(ids.a, "2026-09-14", 52)
    await interaction(ids.b, "2026-09-13", "th-b-dom")
    await measure(ids.b, "2026-09-14", 40)
    await measure(ids.b, "2026-09-16", 41)
    await measure(ids.c, "2026-09-15", 30)
    await measure(ids.e, "2026-09-14", 20)
    await measure(ids.e, "2026-09-15", 20)
    await measure(ids.e, "2026-09-16", 20)
    // Medição de indicador NÃO marcado (qualidade) na terça de A: não prova presença.
    const qual = (await db.query<{ id: string }>(`select id from indicator_definitions where organization_id = $1 and code = 'TH_QUAL'`, [ORG])).rows[0]!.id
    await db.query(`insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, granularity, period_start, period_end, value, source) values ($1, $2, 'PERSON', $3, 'DAILY', '2026-09-15T00:00:00-03:00', '2026-09-16T00:00:00-03:00', 88, 'th-qual')`, [ORG, qual, ids.a])
  }, 60_000)

  afterAll(async () => {
    if (!db) return
    await cleanup()
    await pool.end()
  })

  let rawBefore = 0

  it("programado + produção → trabalhou; programado sem produção ANTES do fim do turno → sem pendência; DEPOIS do turno → pendência para o Supervisor (alerta idempotente); medição de indicador não marcado não prova presença", async () => {
    rawBefore = await rawCount()
    const early = await reconcileOrganizationWorkdays(db, ORG, TZ, MID_SHIFT, { lookbackDays: 4 })
    // 13:00 da quarta: a quarta ainda está em curso (turno até 14:20) → só seg/ter contam.
    const afterEarly = await reconciliations(ids.a)
    expect(afterEarly.map((row) => [row.workday, row.kind, row.status])).toEqual([["2026-09-15", "MISSING_EXPECTED_PRODUCTION", "OPEN"]]) // terça: qualidade não prova
    expect(early.opened).toBeGreaterThanOrEqual(1)
    const late = await reconcileOrganizationWorkdays(db, ORG, TZ, NOW, { lookbackDays: 4 })
    const afterLate = await reconciliations(ids.a)
    expect(afterLate.map((row) => [row.workday, row.status])).toEqual([["2026-09-15", "OPEN"], ["2026-09-16", "OPEN"]])
    expect(late.opened).toBeGreaterThanOrEqual(1)
    const again = await reconcileOrganizationWorkdays(db, ORG, TZ, NOW, { lookbackDays: 4 })
    expect(again).toMatchObject({ opened: 0, noted: 0, autoResolved: 0 })
    const supAlerts = await alerts(ids.sup, "WORKDAY_MISSING_PRODUCTION")
    expect(supAlerts.filter((alert) => alert.description.includes("Ana TH em 15/09"))).toHaveLength(1)
    expect(supAlerts[0]!.title).toBe("Produção não identificada após o fechamento das fontes")
    const snapshotAvailability = (await db.query<{ snapshot: { availability?: { state: string } } }>(`select snapshot from workday_reconciliations where person_id = $1 and workday = '2026-09-15'`, [ids.a])).rows[0]!.snapshot
    expect(snapshotAvailability.availability?.state).toBe("READY")
    // Elegibilidade: seg (observado) e ter (planejado, sem produção) continuam elegíveis — nada vira exceção sozinho.
    const eligibility = (await resolveEligibleDaysBySubject(db, [ids.a], WEEK, TZ, { now: NOW })).get(ids.a)!
    expect(eligibility.eligibleDays).toBe(3)
    expect(eligibility.observed).toMatchObject({ workedObservedDays: 1, missingExpectedProductionDays: 2, evidenceSources: { interactions: true, indicatorCodes: ["TH_VOL"] } })
  })

  it("folga 6x1 (domingo explícito) + produção → elegível observado + divergência NOTED (alerta INFO); INSS + produção → não elegível + inconsistência (situação não muda)", async () => {
    const b = await reconciliations(ids.b)
    expect(b.find((row) => row.workday === "2026-09-13")).toMatchObject({ kind: "PRODUCTION_ON_NON_WORKING_DAY", status: "NOTED" })
    const sunday = (await resolveEligibleDaysBySubject(db, [ids.b], { start: new Date("2026-09-13T03:00:00Z"), end: new Date("2026-09-14T03:00:00Z") }, TZ, { now: NOW })).get(ids.b)!
    expect(sunday).toMatchObject({ eligibleDays: 1, excludedByScheduledDayOff: 0 })
    expect(sunday.observed.workedDespitePlan.scheduledDayOff).toBe(1)
    expect((await alerts(ids.sup, "WORKDAY_PRODUCTION_DIVERGENCE"))[0]?.description).toMatch(/Bia TH em 13\/09/)
    const c = await reconciliations(ids.c)
    expect(c).toContainEqual({ workday: "2026-09-15", kind: "PRODUCTION_WITH_NON_ELIGIBLE_STATUS", status: "NOTED", resolution: null })
    const cEligibility = (await resolveEligibleDaysBySubject(db, [ids.c], WEEK, TZ, { now: NOW })).get(ids.c)!
    expect(cEligibility).toMatchObject({ eligibleDays: 0, excludedByStatus: { INSS: 3 } })
    expect(cEligibility.observed.productionWithNonEligibleStatusDays).toBe(1)
    const status = (await db.query<{ status: string }>(`select status from employee_status_periods where person_id = $1`, [ids.c])).rows
    expect(status).toEqual([{ status: "INSS" }])
    // Nenhuma pendência de produção para quem não deveria produzir.
    expect(c.filter((row) => row.kind === "MISSING_EXPECTED_PRODUCTION")).toHaveLength(0)
    expect((await alerts(ids.sup, "WORKDAY_STATUS_INCONSISTENCY"))[0]?.title).toMatch(/Inconsistência/)
  })

  it("produção chega atrasada → pendência resolvida automaticamente (PRODUCTION_RECEIVED_AFTER_ALERT) e alerta encerrado", async () => {
    await measure(ids.a, "2026-09-15", 47, "th-vol-atrasada")
    const report = await reconcileOrganizationWorkdays(db, ORG, TZ, NOW, { lookbackDays: 4 })
    expect(report.autoResolved).toBe(1)
    const rows = await reconciliations(ids.a)
    expect(rows.find((row) => row.workday === "2026-09-15")).toMatchObject({ status: "RESOLVED", resolution: "PRODUCTION_RECEIVED_AFTER_ALERT" })
    const resolvedAlert = (await alerts(ids.sup, "WORKDAY_MISSING_PRODUCTION")).find((alert) => alert.dedupe_key.endsWith(`${ids.a}:2026-09-15`))
    expect(resolvedAlert?.status).toBe("RESOLVED")
    const snapshot = (await db.query<{ snapshot: { receivedAfterAlert?: boolean } }>(`select snapshot from workday_reconciliations where person_id = $1 and workday = '2026-09-15'`, [ids.a])).rows[0]!.snapshot
    expect(snapshot.receivedAfterAlert).toBe(true)
  })

  it("Supervisor provisiona ANTES (atestado qui–sex) → exceção aplicada com auditoria e origem; cancela → cálculo reverte; nada apagado", async () => {
    const outcome = await provisionScheduleExceptions(db, { organizationId: ORG, personId: ids.a, code: "ATESTADO", from: "2026-09-17", to: "2026-09-18", actorPersonId: ids.sup })
    expect(outcome.created).toHaveLength(2)
    expect(outcome.created[0]).toMatchObject({ origin: "SUPERVISOR_MANUAL", active: true, label: "Atestado", createdByPersonId: ids.sup })
    const ahead = { start: new Date("2026-09-17T03:00:00Z"), end: new Date("2026-09-19T03:00:00Z") }
    const applied = (await resolveEligibleDaysBySubject(db, [ids.a], ahead, TZ, { now: NOW })).get(ids.a)!
    expect(applied).toMatchObject({ eligibleDays: 0, excludedByScheduleException: { ATESTADO: 2 } })
    // Idempotente: provisionar de novo não duplica.
    const again = await provisionScheduleExceptions(db, { organizationId: ORG, personId: ids.a, code: "ATESTADO", from: "2026-09-17", to: "2026-09-18", actorPersonId: ids.sup })
    expect(again.created).toHaveLength(0)
    expect(again.unchanged).toHaveLength(2)
    const cancelled = await cancelScheduleException(db, { organizationId: ORG, exceptionId: outcome.created[0]!.id, actorPersonId: ids.sup })
    expect(cancelled).toMatchObject({ active: false, cancelledByPersonId: ids.sup, manualOverride: false })
    const reverted = (await resolveEligibleDaysBySubject(db, [ids.a], ahead, TZ, { now: NOW })).get(ids.a)!
    expect(reverted).toMatchObject({ eligibleDays: 1, excludedByScheduleException: { ATESTADO: 1 } })
    const audit = await loadScheduleExceptionAudit(db, ORG, outcome.created[0]!.id)
    expect(audit.map((entry) => entry.action)).toEqual(["SCHEDULE_EXCEPTION_PROVISIONED", "SCHEDULE_EXCEPTION_CANCELLED"])
    expect(audit[1]!.payload).toMatchObject({ before: { active: true }, after: { active: false } })
    expect((await db.query<{ c: number }>(`select count(*)::int c from employee_schedule_exceptions where person_id = $1`, [ids.a])).rows[0]!.c).toBe(2)
  })

  it("pendência classificada pelo Supervisor: AUSÊNCIA JUSTIFICADA (banco de horas) → classificação auditável, dia fora do cálculo, NENHUMA exceção criada; TRABALHOU — DADOS NÃO CHEGARAM → nada inventado (NO_VALUE); CORRIGIR PLANEJAMENTO → override AJUSTE_ESCALA", async () => {
    const d = await reconciliations(ids.d)
    expect(d.map((row) => [row.workday, row.status])).toEqual([["2026-09-14", "OPEN"], ["2026-09-15", "OPEN"], ["2026-09-16", "OPEN"]])
    const idOf = async (workday: string) => (await db.query<{ id: string }>(`select id from workday_reconciliations where person_id = $1 and workday = $2::date`, [ids.d, workday])).rows[0]!.id
    const repository = new PgPendingActionsRepository(db)
    const supervisor = { personId: ids.sup, organizationId: ORG }
    // A fila do Supervisor lista as pendências de produção com a MESMA definição de "pendente".
    const queue = await buildPendingActions(repository, supervisor)
    expect(queue.pending.filter((item) => item.kind === "WORKDAY_RECONCILIATION" && item.operator?.personId === ids.d)).toHaveLength(3)
    expect(await repository.countPending(ids.sup, ORG)).toBe(queue.pending.length)
    // Outro viewer não vê (autorização = destinatário).
    expect((await buildPendingActions(repository, { personId: ids.admin, organizationId: ORG })).pending).toHaveLength(0)
    const exceptionsBefore = (await db.query<{ c: number }>(`select count(*)::int c from employee_schedule_exceptions where person_id = $1`, [ids.d])).rows[0]!.c
    const justified = await decideWorkdayReconciliation(repository, (input) => resolveReconciliation(db, input), supervisor, await idOf("2026-09-14"), { resolution: "JUSTIFIED_ABSENCE", reasonCode: "BANCO_HORAS" })
    expect(justified).toMatchObject({ status: "DECIDED", resolution: "JUSTIFIED_ABSENCE", resolutionLabel: "Ausência justificada", resolutionException: null, classification: { classification: "JUSTIFIED_ABSENCE", reasonCode: "BANCO_HORAS", label: "Ausência justificada · Banco de horas" } })
    // Classificação ≠ exceção de calendário: a escala continua dizendo "trabalha" e nenhuma exceção nasceu.
    expect((await db.query<{ c: number }>(`select count(*)::int c from employee_schedule_exceptions where person_id = $1`, [ids.d])).rows[0]!.c).toBe(exceptionsBefore)
    const dataMissing = await decideWorkdayReconciliation(repository, (input) => resolveReconciliation(db, input), supervisor, await idOf("2026-09-15"), { resolution: "WORKED_DATA_MISSING" })
    expect(dataMissing).toMatchObject({ status: "DECIDED", resolution: "WORKED_DATA_MISSING", resolutionException: null, classification: { classification: "WORKED_DATA_MISSING" } })
    const corrected = await decideWorkdayReconciliation(repository, (input) => resolveReconciliation(db, input), supervisor, await idOf("2026-09-16"), { resolution: "SCHEDULE_CORRECTED" })
    expect(corrected.resolutionException?.code).toBe("AJUSTE_ESCALA")
    const eligibility = (await resolveEligibleDaysBySubject(db, [ids.d], WEEK, TZ, { now: NOW })).get(ids.d)!
    expect(eligibility).toMatchObject({ eligibleDays: 1, eligibleDates: ["2026-09-15"], excludedByScheduleException: { BANCO_HORAS: 1, AJUSTE_ESCALA: 1 } })
    expect(eligibility.observed).toMatchObject({ justifiedAbsenceDays: 1, workedDataMissingDays: 1, unjustifiedAbsenceDays: 0 })
    // Terça continua esperada como trabalhada e SEM medição: Condition devolve NO_VALUE, nunca zero.
    const condition = await evaluateDataCondition(db, { historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "TH_VOL", aggregation: "SUM", source: "MEASUREMENT", period: { kind: "ROLLING_DAYS", days: 3 } }, comparator: "GT", thresholdNumeric: 0 }, { operatorId: ids.d, subjectIds: [ids.d] }, NOW, { timeZone: TZ })
    expect(condition?.branch).toBe("no_data")
    expect(condition?.evaluation.reason).toBe("NO_VALUE")
    // Idempotente: repetir a mesma decisão devolve o estado; "corrigir planejamento" já decidido é recusado.
    await expect(decideWorkdayReconciliation(repository, (input) => resolveReconciliation(db, input), supervisor, await idOf("2026-09-14"), { resolution: "JUSTIFIED_ABSENCE", reasonCode: "BANCO_HORAS" })).resolves.toMatchObject({ status: "DECIDED" })
    await expect(decideWorkdayReconciliation(repository, (input) => resolveReconciliation(db, input), supervisor, await idOf("2026-09-16"), { resolution: "WORKED_DATA_MISSING" })).rejects.toMatchObject({ code: "PENDING_ACTION_ALREADY_DECIDED" })
    // Escala de origem NÃO adulterada pelo "corrigir planejamento".
    expect((await db.query<{ scheduled_to_work: boolean }>(`select scheduled_to_work from employee_schedule_days where person_id = $1 and schedule_date = '2026-09-16'`, [ids.d])).rows[0]).toEqual({ scheduled_to_work: true })
    // O sino do Supervisor aponta a pendência resolvida como decidida.
    const bell = await buildNotificationSummary(new PgNotificationsRepository(db), repository, supervisor)
    const item = bell.items.find((entry) => entry.kind === "WORKDAY_RECONCILIATION" && entry.description.includes("Ausência justificada"))
    expect(item?.resolved).toBe(true)
  })

  it("FALTA INJUSTIFICADA é revisável e nunca cria medição: Produção (ZERO_CONTRIBUTION) recebe 0 lógico, TMA/Qualidade (NO_SAMPLE) não; atestado posterior remove a contribuição zero; histórico com as duas decisões; auditoria temporal", async () => {
    const analytics = new PgAnalyticsReadRepository(db)
    const sup = viewer(ids.sup, "SUPERVISOR")
    const raw = await rawCount()
    // 14/09 de Dani: Ausência justificada (banco) → revisada para FALTA INJUSTIFICADA pelo Calendário da equipe.
    const revised = await classifyForTeam(db, analytics, sup, { personId: ids.d, date: "2026-09-14", classification: "UNJUSTIFIED_ABSENCE" })
    expect(revised.changed).toBe(true)
    expect(revised.previous).toMatchObject({ classification: "JUSTIFIED_ABSENCE", reasonCode: "BANCO_HORAS" })
    expect(revised.current).toMatchObject({ classification: "UNJUSTIFIED_ABSENCE", supersedesId: revised.previous!.id, classifiedByPersonId: ids.sup })
    // O dia CONTINUA esperado/elegível (não sai do universo operacional).
    const eligibility = (await resolveEligibleDaysBySubject(db, [ids.d], WEEK, TZ, { now: NOW })).get(ids.d)!
    expect(eligibility).toMatchObject({ eligibleDays: 2, eligibleDates: ["2026-09-14", "2026-09-15"] })
    expect(eligibility.observed).toMatchObject({ unjustifiedAbsenceDays: 1, unjustifiedAbsenceDates: ["2026-09-14"] })
    // Política por indicador: Produção (soma de contagens) com CONTRIBUIÇÃO ZERO — configuração, nunca `if code === …`.
    await updateIndicatorDefinition(db, ORG, indicatorId, { unjustifiedAbsencePolicy: "ZERO_CONTRIBUTION" })
    // TMA com contribuição zero é bloqueado pela validação (um zero seria valor inventado).
    const qualId = (await db.query<{ id: string }>(`select id from indicator_definitions where organization_id = $1 and code = 'TH_QUAL'`, [ORG])).rows[0]!.id
    await expect(updateIndicatorDefinition(db, ORG, qualId, { unjustifiedAbsencePolicy: "ZERO_CONTRIBUTION" })).rejects.toMatchObject({ code: "INDICATOR_INVALID_CONFIGURATION" })
    const window3 = { kind: "INDICATOR_THRESHOLD_COUNT" as const, aggregation: "SUM" as const, source: "MEASUREMENT" as const, period: { kind: "ROLLING_DAYS" as const, days: 3 } }
    const production = await evaluateDataCondition(db, { historicalQuery: { ...window3, indicatorCode: "TH_VOL" }, comparator: "GT", thresholdNumeric: 0 }, { operatorId: ids.d, subjectIds: [ids.d] }, NOW, { timeZone: TZ })
    // Produção = 0 é resultado CONHECIDO (não "sem dados"): a falta injustificada penaliza a produção.
    expect(production?.branch).toBe("false")
    expect(production?.evaluation.value).toBe(0)
    const quality = await evaluateDataCondition(db, { historicalQuery: { ...window3, indicatorCode: "TH_QUAL", aggregation: "WEIGHTED_AVERAGE" }, comparator: "GT", thresholdNumeric: 0 }, { operatorId: ids.d, subjectIds: [ids.d] }, NOW, { timeZone: TZ })
    expect(quality?.branch).toBe("no_data")
    expect(quality?.evaluation.reason).toBe("NO_VALUE")
    // Ranking/quartil: Dani entra na população de Produção com 0 (resultado conhecido), sem linha em indicator_measurements.
    const bySubject = await resolveOperationalWindowBySubject(db, { indicatorCode: "TH_VOL", subjectIds: [ids.d, ids.e], window: WEEK, aggregation: "SUM", timeZone: TZ, now: NOW, expectedDays: 3 })
    expect(bySubject.get(ids.d)).toMatchObject({ value: 0, daysWithData: 1, unjustifiedAbsence: { days: 1, policy: "ZERO_CONTRIBUTION", zeroContributionDays: 1 } })
    expect(bySubject.get(ids.e)?.value).toBe(60)
    expect(await rawCount()).toBe(raw)
    // Atestado chega depois: FALTA INJUSTIFICADA → ATESTADO. A contribuição zero deixa de existir; nada apagado.
    const atestado = await classifyForTeam(db, analytics, sup, { personId: ids.d, date: "2026-09-14", classification: "JUSTIFIED_ABSENCE", reasonCode: "ATESTADO" })
    expect(atestado.current).toMatchObject({ classification: "JUSTIFIED_ABSENCE", reasonCode: "ATESTADO", label: "Ausência justificada · Atestado" })
    const afterAtestado = await evaluateDataCondition(db, { historicalQuery: { ...window3, indicatorCode: "TH_VOL" }, comparator: "GT", thresholdNumeric: 0 }, { operatorId: ids.d, subjectIds: [ids.d] }, NOW, { timeZone: TZ })
    expect(afterAtestado?.branch).toBe("no_data")
    expect((await resolveEligibleDaysBySubject(db, [ids.d], WEEK, TZ, { now: NOW })).get(ids.d)).toMatchObject({ eligibleDays: 1, excludedByScheduleException: { ATESTADO: 1, AJUSTE_ESCALA: 1 } })
    expect(await rawCount()).toBe(raw)
    // Histórico: as três decisões, em ordem, com quem/quando/por quê — nada sobrescrito, nada apagado.
    const history = await classificationHistoryForTeam(db, analytics, sup, { personId: ids.d, date: "2026-09-14" })
    expect(history.map((entry) => [entry.classification, entry.reasonCode, entry.supersededReason])).toEqual([
      ["JUSTIFIED_ABSENCE", "BANCO_HORAS", "REVISED"],
      ["UNJUSTIFIED_ABSENCE", null, "REVISED"],
      ["JUSTIFIED_ABSENCE", "ATESTADO", null],
    ])
    expect(history[1]!.supersededByPersonId).toBe(ids.sup)
    expect(history[1]!.supersededAt).not.toBeNull()
    // Sem dado clínico em lugar nenhum: a tabela não tem coluna para isso; o motivo é só ATESTADO.
    const columns = (await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'workday_classifications'`)).rows.map((row) => row.column_name)
    expect(columns.some((column) => /cid|diagn|document|note|descr/i.test(column))).toBe(false)
    const audit = (await db.query<{ action: string }>(`select action from audit_logs where organization_id = $1 and entity_type = 'workday_classification' and entity_id = any($2::uuid[]) order by created_at`, [ORG, history.map((entry) => entry.id)])).rows.map((row) => row.action)
    expect(audit).toEqual(["WORKDAY_CLASSIFIED", "WORKDAY_CLASSIFICATION_REVISED", "WORKDAY_CLASSIFICATION_REVISED"])
    // A reconciliação do dia reflete a classificação vigente.
    expect((await reconciliations(ids.d)).find((row) => row.workday === "2026-09-14")).toMatchObject({ status: "RESOLVED", resolution: "JUSTIFIED_ABSENCE" })
    // Permissão: outro Supervisor (fora do escopo) não classifica nem lê o histórico de Dani; Admin pode.
    await expect(classifyForTeam(db, analytics, viewer(ids.sup2, "SUPERVISOR"), { personId: ids.d, date: "2026-09-14", classification: "WORKED_DATA_MISSING" })).rejects.toMatchObject({ code: "STRUCTURE_ACCESS_DENIED" })
    await expect(classificationHistoryForTeam(db, analytics, viewer(ids.sup2, "SUPERVISOR"), { personId: ids.d, date: "2026-09-14" })).rejects.toMatchObject({ code: "STRUCTURE_ACCESS_DENIED" })
    expect((await classificationHistoryForTeam(db, analytics, viewer(ids.admin, "ADMIN", ids.adminAccount), { personId: ids.d, date: "2026-09-14" })).length).toBe(3)
    // V1.5.8: o nível hierárquico "ADMIN" sem `calendar.manage` não é bypass.
    await expect(classificationHistoryForTeam(db, analytics, viewer(ids.legacyAdmin, "ADMIN", ids.legacyAdminAccount), { personId: ids.d, date: "2026-09-14" })).rejects.toMatchObject({ code: "STRUCTURE_ACCESS_DENIED" })
  })

  it("DADO TARDIO vence a classificação: falta injustificada + produção chega depois → WORKED_OBSERVED, classificação preservada como contrariada, Supervisor avisado; RH TARDIO: férias vence 'dados não chegaram' e o dia deixa de contar", async () => {
    const analytics = new PgAnalyticsReadRepository(db)
    const sup = viewer(ids.sup, "SUPERVISOR")
    // Bia 15/09: programada, sem produção (14 e 16 têm) → pendência aberta → Supervisor classifica falta injustificada.
    expect((await reconciliations(ids.b)).find((row) => row.workday === "2026-09-15")).toMatchObject({ kind: "MISSING_EXPECTED_PRODUCTION", status: "OPEN" })
    const unjustified = await classifyForTeam(db, analytics, sup, { personId: ids.b, date: "2026-09-15", classification: "UNJUSTIFIED_ABSENCE" })
    expect((await reconciliations(ids.b)).find((row) => row.workday === "2026-09-15")).toMatchObject({ status: "RESOLVED", resolution: "UNJUSTIFIED_ABSENCE" })
    // Produção real chega depois (interação): o job marca a classificação como contrariada — nunca apaga.
    await interaction(ids.b, "2026-09-15", "th-b-ter-tardia")
    const report = await reconcileOrganizationWorkdays(db, ORG, TZ, NOW, { lookbackDays: 4 })
    expect(report.supersededClassifications).toBe(1)
    const history = await loadClassificationHistory(db, ORG, ids.b, "2026-09-15")
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ id: unjustified.current.id, supersededReason: "CONTRADICTED_BY_WORK_EVIDENCE", supersededByPersonId: null })
    expect(history[0]!.supersededAt).not.toBeNull()
    const day = (await resolveEligibleDaysBySubject(db, [ids.b], WEEK, TZ, { now: NOW })).get(ids.b)!
    expect(day.observed).toMatchObject({ workedObservedDays: 3, unjustifiedAbsenceDays: 0 })
    expect((await db.query<{ snapshot: { receivedAfterAlert?: boolean; classificationSuperseded?: string } }>(`select snapshot from workday_reconciliations where person_id = $1 and workday = '2026-09-15'`, [ids.b])).rows[0]!.snapshot).toMatchObject({ receivedAfterAlert: true, classificationSuperseded: "CONTRADICTED_BY_WORK_EVIDENCE" })
    expect((await alerts(ids.sup, "WORKDAY_CLASSIFICATION_SUPERSEDED"))[0]?.title).toBe("Produção recebida após a classificação")
    // Idempotente: rodar de novo não supera nada nem avisa de novo.
    expect((await reconcileOrganizationWorkdays(db, ORG, TZ, NOW, { lookbackDays: 4 })).supersededClassifications).toBe(0)
    expect(await alerts(ids.sup, "WORKDAY_CLASSIFICATION_SUPERSEDED")).toHaveLength(1)
    // RH tardio: Dani 15/09 estava "trabalhou — dados não chegaram"; a fonte autoritativa informa FÉRIAS → a situação prevalece.
    await db.query(`insert into employee_status_periods (organization_id, person_id, status, effective_from, effective_to, effective_to_explicit, source, observed_at) values ($1, $2, 'FERIAS', '2026-09-15', '2026-09-15', true, 'th-rh', now())`, [ORG, ids.d])
    const late = await reconcileOrganizationWorkdays(db, ORG, TZ, NOW, { lookbackDays: 4 })
    expect(late.supersededClassifications).toBe(1)
    const dani = await loadClassificationHistory(db, ORG, ids.d, "2026-09-15")
    expect(dani.map((entry) => [entry.classification, entry.supersededReason])).toEqual([["WORKED_DATA_MISSING", "SUPERSEDED_BY_AUTHORITATIVE_STATUS"]])
    const daniDays = (await resolveEligibleDaysBySubject(db, [ids.d], WEEK, TZ, { now: NOW })).get(ids.d)!
    expect(daniDays).toMatchObject({ eligibleDays: 0, excludedByStatus: { FERIAS: 1 }, excludedByScheduleException: { ATESTADO: 1, AJUSTE_ESCALA: 1 } })
    expect((await alerts(ids.sup, "WORKDAY_CLASSIFICATION_SUPERSEDED")).map((alert) => alert.title)).toContain("Situação funcional recebida após a classificação")
    // RH confirmando EM_PRODUCAO não apaga o atestado de 14/09 (justificativa manual continua vigente).
    await db.query(`insert into employee_status_periods (organization_id, person_id, status, effective_from, effective_to, effective_to_explicit, source, observed_at) values ($1, $2, 'EM_PRODUCAO', '2026-09-14', '2026-09-14', true, 'th-rh', now())`, [ORG, ids.d])
    await reconcileOrganizationWorkdays(db, ORG, TZ, NOW, { lookbackDays: 4 })
    expect((await loadClassificationHistory(db, ORG, ids.d, "2026-09-14")).at(-1)).toMatchObject({ classification: "JUSTIFIED_ABSENCE", reasonCode: "ATESTADO", supersededReason: null })
  })

  it("Supervisor provisiona pelo Calendário DEPOIS do alerta → pendência auto-resolvida como PLAN_UPDATED_AFTER_ALERT; Calendário da equipe mostra os estados; autorização pelo escopo", async () => {
    const analytics = new PgAnalyticsReadRepository(db)
    const sup = viewer(ids.sup, "SUPERVISOR")
    await provisionScheduleExceptions(db, { organizationId: ORG, personId: ids.a, code: "DAY_OFF", from: "2026-09-16", to: "2026-09-16", actorPersonId: ids.sup })
    const report = await reconcileOrganizationWorkdays(db, ORG, TZ, NOW, { lookbackDays: 4 })
    expect(report.autoResolved).toBe(1)
    expect((await reconciliations(ids.a)).find((row) => row.workday === "2026-09-16")).toMatchObject({ status: "RESOLVED", resolution: "PLAN_UPDATED_AFTER_ALERT" })
    const calendar = await buildTeamCalendar(db, analytics, sup, { anchorId: null, from: "2026-09-13", to: "2026-09-18", now: NOW })
    expect(calendar.people.map((person) => person.name)).toEqual(["Ana TH", "Bia TH", "Caio TH", "Dani TH", "Edu TH"])
    expect(calendar.pagination).toEqual({ page: 1, pageSize: 10, total: 5, totalPeople: 5 })
    expect(calendar.provisionablePeople.map((person) => person.name)).toEqual(["Ana TH", "Bia TH", "Caio TH", "Dani TH", "Edu TH"])
    expect(calendar.filterOptions.attention.map((entry) => entry.code)).toEqual(["MISSING_PRODUCTION", "WAITING_FOR_DATA", "DATA_SOURCE_DELAY", "UNJUSTIFIED_ABSENCE", "DIVERGENCE", "CONFLICT"])
    // Filtros + paginação (mesmo padrão das listagens administrativas): página 2 de 2 em 2; busca sem acento;
    // "atenção" por inconsistência (Caio: produção com INSS); o seletor de provisionar continua com todos.
    const page2 = await buildTeamCalendar(db, analytics, sup, { anchorId: null, from: "2026-09-13", to: "2026-09-18", now: NOW, page: 2, pageSize: 2 })
    expect(page2.people.map((person) => person.name)).toEqual(["Caio TH", "Dani TH"])
    expect(page2.pagination).toEqual({ page: 2, pageSize: 2, total: 5, totalPeople: 5 })
    expect(page2.provisionablePeople).toHaveLength(5)
    const searched = await buildTeamCalendar(db, analytics, sup, { anchorId: null, from: "2026-09-13", to: "2026-09-18", now: NOW, filters: { search: "DANI" } })
    expect(searched.people.map((person) => person.name)).toEqual(["Dani TH"])
    expect(searched.pagination).toMatchObject({ total: 1, totalPeople: 5 })
    const byTeam = await buildTeamCalendar(db, analytics, sup, { anchorId: null, from: "2026-09-13", to: "2026-09-18", now: NOW, filters: { teamId: calendar.people[0]!.teamId ?? undefined } })
    expect(byTeam.pagination.total).toBe(calendar.people.filter((person) => person.teamId === calendar.people[0]!.teamId).length)
    expect(byTeam.filterOptions.teams.map((team) => team.id)).toEqual([...new Set(calendar.people.map((person) => person.teamId).filter(Boolean))].sort())
    expect((await buildTeamCalendar(db, analytics, sup, { anchorId: null, from: "2026-09-13", to: "2026-09-18", now: NOW, filters: { teamId: "00000000-0000-4000-8000-0000000000ff" } })).pagination).toMatchObject({ total: 0, totalPeople: 5 })
    // "Escalados para hoje" = dia de HOJE elegível (NOW = 16/09): Dani está de folga, Caio em INSS → fora; com o período
    // visível SEM hoje, o backend resolve só o dia de hoje e chega ao mesmo resultado.
    const todayIn = await buildTeamCalendar(db, analytics, sup, { anchorId: null, from: "2026-09-13", to: "2026-09-18", now: NOW, filters: { scheduledToday: true } })
    const expectedToday = calendar.people.filter((person) => person.days.find((day) => day.date === calendar.today)!.eligible).map((person) => person.name)
    expect(todayIn.people.map((person) => person.name)).toEqual(expectedToday)
    expect(expectedToday).not.toContain("Dani TH")
    expect(expectedToday).not.toContain("Caio TH")
    const todayOut = await buildTeamCalendar(db, analytics, sup, { anchorId: null, from: "2026-09-07", to: "2026-09-12", now: NOW, filters: { scheduledToday: true } })
    expect(todayOut.people.map((person) => person.name)).toEqual(expectedToday)
    expect((await buildTeamCalendar(db, analytics, sup, { anchorId: null, from: "2026-09-13", to: "2026-09-18", now: NOW, filters: { scheduledToday: false } })).people.map((person) => person.name)).toEqual(calendar.people.map((person) => person.name).filter((name) => !expectedToday.includes(name)))
    const conflicted = await buildTeamCalendar(db, analytics, sup, { anchorId: null, from: "2026-09-13", to: "2026-09-18", now: NOW, filters: { attention: ["CONFLICT"] } })
    expect(conflicted.people.map((person) => person.name)).toEqual(["Caio TH"])
    const dani = calendar.people.find((person) => person.name === "Dani TH")!
    expect(dani.days.map((day) => [day.date, day.state])).toEqual([
      ["2026-09-13", "PLANNED_NON_WORKING"],
      ["2026-09-14", "CLASSIFIED_JUSTIFIED_ABSENCE"],
      ["2026-09-15", "NON_ELIGIBLE_EMPLOYMENT_STATUS"],
      ["2026-09-16", "PLANNED_NON_WORKING"],
      ["2026-09-17", "PLANNED_WORK"],
      ["2026-09-18", "PLANNED_WORK"],
    ])
    expect(dani.days[1]!.classification).toMatchObject({ classification: "JUSTIFIED_ABSENCE", reasonCode: "ATESTADO", label: "Ausência justificada · Atestado", classifiedByName: "Supervisora TH", contradictedBy: null })
    expect(dani.days[1]!.availability).toMatchObject({ state: "READY", label: "Dados fechados" })
    expect(dani.days[4]!.availability.state).toBe("WAITING_FOR_SOURCES") // política "mesmo dia": o prazo de quinta ainda não venceu — e o dia nem fechou (PLANNED_WORK)
    expect(calendar.classifications.map((entry) => entry.code)).toEqual(["UNJUSTIFIED_ABSENCE", "JUSTIFIED_ABSENCE", "WORKED_DATA_MISSING"])
    expect(calendar.justifiedReasons.map((entry) => entry.code)).toEqual(["ATESTADO", "DAY_OFF", "BANCO_HORAS", "FOLGA_EXTRAORDINARIA", "OTHER_JUSTIFIED"])
    const ana = calendar.people.find((person) => person.name === "Ana TH")!
    expect(ana.days.map((day) => [day.date, day.state])).toEqual([
      ["2026-09-13", "PLANNED_NON_WORKING"],
      ["2026-09-14", "WORKED_OBSERVED"],
      ["2026-09-15", "WORKED_OBSERVED"],
      ["2026-09-16", "PLANNED_NON_WORKING"],
      ["2026-09-17", "PLANNED_WORK"], // atestado cancelado pelo Supervisor
      ["2026-09-18", "PLANNED_NON_WORKING"], // atestado vigente
    ])
    expect(ana.days[3]!.exception).toMatchObject({ code: "DAY_OFF", origin: "SUPERVISOR_MANUAL" })
    expect(ana.days[3]!.reconciliation).toMatchObject({ kind: "MISSING_EXPECTED_PRODUCTION", status: "RESOLVED", resolution: "PLAN_UPDATED_AFTER_ALERT" })
    expect(ana.days[4]!.cancelledExceptions).toBe(1)
    const bia = calendar.people.find((person) => person.name === "Bia TH")!
    expect(bia.days[0]).toMatchObject({ state: "WORKED_OBSERVED", overridesPlan: true, plannedCause: "SCHEDULED_DAY_OFF" })
    expect(bia.days[0]!.reconciliation).toMatchObject({ kind: "PRODUCTION_ON_NON_WORKING_DAY" })
    const caio = calendar.people.find((person) => person.name === "Caio TH")!
    expect(caio.days[2]).toMatchObject({ state: "NON_ELIGIBLE_EMPLOYMENT_STATUS", conflict: "PRODUCTION_WITH_NON_ELIGIBLE_STATUS", status: { code: "INSS" } })
    expect(calendar.evidenceSources).toEqual({ interactions: true, indicatorCodes: ["TH_VOL"], enabled: true })
    // Fora do escopo: um operador não provisiona para colegas; âncora fora da subárvore → 403.
    await expect(buildTeamCalendar(db, analytics, viewer(ids.a, "OPERATOR"), { anchorId: ids.sup, from: "2026-09-14", to: "2026-09-16", now: NOW })).rejects.toMatchObject({ code: "STRUCTURE_ACCESS_DENIED" })
  })

  it("Central × Supervisor: exceção da Central cancelada pelo Supervisor não é reativada em silêncio; Central cancelando o que o Supervisor registrou vira AVISO — auditável, nada sobrescrito", async () => {
    source = await createSource(ctx, ORG, null, { name: "TH RH", config: { kind: "FILE_UPLOAD" } })
    exceptionsFeed = await setFeedStatus(ctx, ORG, null, (await createFeed(ctx, ORG, null, source.id, { feedKey: "excecoes", name: "Exceções de calendário", contractKey: "WORK_SCHEDULE_EXCEPTIONS", connectorConfig: fileFeedConfig, authoritative: true, sourceNamespace: "th-rh-excecoes", cadence: { kind: "INTERVAL", minutes: 60 }, mapping: { fields: [{ target: "externalEmployeeId", source: "matricula", transforms: [] }, { target: "date", source: "data", transforms: [] }, { target: "exceptionCode", source: "tipo", transforms: [] }, { target: "active", source: "vigente", transforms: [{ kind: "BOOLEAN_MAP", trueValues: ["S"], falseValues: ["N"] }] }] } })).id, "ACTIVATE")
    const header = ["matricula", "data", "tipo", "vigente"]
    // 1) Central cria DAY_OFF para E na sexta 18.
    const load = await runFeed(exceptionsFeed, csv([header, ["TH-E", "2026-09-18", "DAY_OFF", "S"]]), "th-exc-1.csv")
    if (load.status !== "COMPLETED") throw new Error(`carga falhou: ${load.errorCode ?? ""} ${load.errorMessage ?? ""}`)
    const central = (await db.query<{ id: string; origin: string; active: boolean }>(`select id, origin, active from employee_schedule_exceptions where person_id = $1 and exception_date = '2026-09-18'`, [ids.e])).rows[0]!
    expect(central).toMatchObject({ origin: "CENTRAL_DATA", active: true })
    // 2) Supervisor cancela: override manual registrado.
    const cancelled = await cancelScheduleException(db, { organizationId: ORG, exceptionId: central.id, actorPersonId: ids.sup })
    expect(cancelled).toMatchObject({ active: false, manualOverride: true })
    // 3) Central reenvia vigente: NÃO reativa; aviso DATA_SCHEDULE_EXCEPTION_CONFLICT (registro aplicado com aviso, zero rejeição).
    const resend = await runFeed(exceptionsFeed, csv([header, ["TH-E", "2026-09-18", "DAY_OFF", "S"]]), "th-exc-2.csv")
    if (resend.status !== "COMPLETED") throw new Error(`reenvio falhou: ${resend.errorCode ?? ""} ${resend.errorMessage ?? ""}`)
    expect(resend.recordsRejected).toBe(0)
    expect(resend.warningCount).toBe(1)
    const notes = (await db.query<{ error_code: string; message: string }>(`select error_code, message from data_ingestion_rejections where run_id = $1`, [resend.id])).rows
    expect(notes[0]).toMatchObject({ error_code: "DATA_SCHEDULE_EXCEPTION_CONFLICT" })
    expect(notes[0]!.message).toMatch(/Supervisor cancelou a exceção/)
    expect((await db.query<{ active: boolean }>(`select active from employee_schedule_exceptions where id = $1`, [central.id])).rows[0]).toEqual({ active: false })
    // 4) Central concorda (cancelado): sem aviso, linha volta a ser da Central.
    const agree = await runFeed(exceptionsFeed, csv([header, ["TH-E", "2026-09-18", "DAY_OFF", "N"]]), "th-exc-3.csv")
    expect(agree.warningCount).toBe(0)
    expect((await db.query<{ manual_override: boolean; origin: string }>(`select manual_override, origin from employee_schedule_exceptions where id = $1`, [central.id])).rows[0]).toEqual({ manual_override: false, origin: "CENTRAL_DATA" })
    // 5) Supervisor registra BANCO_HORAS para E em 17; Central manda o mesmo cancelado → aviso, registro do Supervisor mantido.
    await provisionScheduleExceptions(db, { organizationId: ORG, personId: ids.e, code: "BANCO_HORAS", from: "2026-09-17", to: "2026-09-17", actorPersonId: ids.sup })
    const conflict = await runFeed(exceptionsFeed, csv([header, ["TH-E", "2026-09-17", "BANCO_HORAS", "N"]]), "th-exc-4.csv")
    expect(conflict.warningCount).toBe(1)
    expect((await db.query<{ active: boolean; origin: string }>(`select active, origin from employee_schedule_exceptions where person_id = $1 and exception_date = '2026-09-17'`, [ids.e])).rows[0]).toEqual({ active: true, origin: "SUPERVISOR_MANUAL" })
    // Qualidade na Central: exceções por origem e conflitos visíveis.
    const quality = await buildCalendarQuality(ctx, ORG, "2026-09-16")
    expect(quality.exceptionsByOrigin.supervisor).toBeGreaterThanOrEqual(2)
    expect(quality.exceptionsByOrigin.conflictWarnings30d).toBe(2)
    expect(quality.reconciliation.evidenceSources).toEqual({ interactions: true, indicatorCodes: ["TH_VOL"], enabled: true })
    expect(quality.holidayCatalog.complete).toBe(false)
    expect(quality.holidayCatalog.gaps.length).toBeGreaterThan(0)
    // Freshness ≠ SLA: por fonte relevante a política e o estado do dia de referência; classificações contadas.
    expect(quality.dataAvailability.sources.map((entry) => [entry.group, entry.policyLabel, entry.state])).toEqual(expect.arrayContaining([["WORK_ACTIVITY", "No mesmo dia até 14:30", "READY"]]))
    expect(quality.dataAvailability.unknownPolicy).toBe(0)
    expect(quality.classifications).toMatchObject({ justifiedAbsences: 1, revised: 2, contradictedByEvidence: 1, supersededByStatus: 1 })
    expect(quality.classifications.lateDataAutoResolved).toBeGreaterThanOrEqual(2)
  })

  it("DISPONIBILIDADE D-1/D-2: fim do turno não cria ausência; produção D+1 11:00 e interações D+2 08:00 → aguardando até o ÚLTIMO prazo; RH D-1 atrasado → alerta de fonte (nunca pendência por pessoa); carga chega → alerta resolvido e pendência abre", async () => {
    // Fabi (Supervisor 2): entra agora, programada seg–qua, sem nenhuma produção. Políticas mudam para D-1/D-2.
    ids.f = await person("TH-F", "Fabi TH", "OPERATOR", ids.sup2)
    await schedule(ids.f, ["2026-09-14", "2026-09-15", "2026-09-16"], true)
    await ctx.db.query(`update data_feeds set availability_policy = $2 where id = $1`, [measurementsFeed.id, JSON.stringify({ lagDays: 1, availableByLocalTime: "11:00" })])
    await ctx.db.query(`update data_feeds set availability_policy = $2 where id = $1`, [interactionsFeed.id, JSON.stringify({ lagDays: 2, availableByLocalTime: "08:00" })])
    const days = async () => (await resolveEligibleDaysBySubject(db, [ids.f], WEEK, TZ, { now: NOW })).get(ids.f)!
    // Quarta 16/09 15:00: seg 14 → prazos 15/09 11:00 e 16/09 08:00 venceram e a carga de 15:00 os cobre → fontes fechadas → sem produção;
    // ter 15 → interações só em 17/09 08:00 → AGUARDANDO; qua 16 → AGUARDANDO. Nenhuma falta prematura.
    let f = await days()
    expect(f.observed).toMatchObject({ missingExpectedProductionDays: 1, missingExpectedProductionDates: ["2026-09-14"], waitingForSourcesDays: 2, dataSourceDelayDays: 0 })
    expect(f.eligibleDays).toBe(3)
    // RH (EMPLOYEES) D-1 08:00 com última carga em 14/09 09:00: para seg 14 o prazo (15/09 08:00) venceu sem carga → FONTE ATRASADA, não ausência.
    const rhSource = await createSource(ctx, ORG, null, { name: "TH RH Colaboradores", config: { kind: "FILE_UPLOAD" } })
    const rhFeed = await setFeedStatus(ctx, ORG, null, (await createFeed(ctx, ORG, null, rhSource.id, { feedKey: "colaboradores", name: "Colaboradores", contractKey: "EMPLOYEES", connectorConfig: fileFeedConfig, availabilityPolicy: { lagDays: 1, availableByLocalTime: "08:00" }, mapping: { fields: [{ target: "externalEmployeeId", source: "m", transforms: [] }, { target: "name", source: "n", transforms: [] }, { target: "role", source: "r", transforms: [] }] } })).id, "ACTIVATE")
    await ctx.db.query(`update data_feeds set last_success_at = '2026-09-14T09:00:00-03:00' where id = $1`, [rhFeed.id])
    f = await days()
    expect(f.observed).toMatchObject({ missingExpectedProductionDays: 0, dataSourceDelayDays: 1, waitingForSourcesDays: 2 })
    const report = await reconcileOrganizationWorkdays(db, ORG, TZ, NOW, { lookbackDays: 4 })
    expect((await reconciliations(ids.f)).filter((row) => row.kind === "MISSING_EXPECTED_PRODUCTION")).toHaveLength(0)
    expect(report.delayed).toBeGreaterThanOrEqual(1)
    expect(report.availabilityAlerts.created).toBeGreaterThanOrEqual(1)
    const delayedAlerts = await alerts(ids.admin, "DATA_SOURCE_AVAILABILITY_DELAYED")
    expect(await alerts(ids.legacyAdmin, "DATA_SOURCE_AVAILABILITY_DELAYED")).toEqual([])
    expect(delayedAlerts.some((alert) => alert.title.includes("14/09") && alert.title.includes("Colaboradores") && alert.status !== "RESOLVED")).toBe(true)
    expect(await alerts(ids.sup2, "WORKDAY_MISSING_PRODUCTION")).toHaveLength(0)
    // A carga do RH chega (após o prazo): fonte fechada → pendência de seg 14 abre para o Supervisor 2 e o alerta de fonte é resolvido.
    await ctx.db.query(`update data_feeds set last_success_at = $2 where id = $1`, [rhFeed.id, NOW])
    const after = await reconcileOrganizationWorkdays(db, ORG, TZ, NOW, { lookbackDays: 4 })
    expect(after.opened).toBeGreaterThanOrEqual(1)
    expect((await reconciliations(ids.f)).map((row) => [row.workday, row.status])).toEqual([["2026-09-14", "OPEN"]])
    expect((await alerts(ids.admin, "DATA_SOURCE_AVAILABILITY_DELAYED")).filter((alert) => alert.title.includes("Colaboradores") && alert.status !== "RESOLVED")).toHaveLength(0)
    expect((await alerts(ids.sup2, "WORKDAY_MISSING_PRODUCTION"))[0]?.description).toMatch(/Fabi TH em 14\/09/)
    // Calendário da equipe do Supervisor 2 diferencia "aguardando dados" de "sem produção · classificar".
    const calendar = await buildTeamCalendar(db, new PgAnalyticsReadRepository(db), viewer(ids.sup2, "SUPERVISOR"), { anchorId: null, from: "2026-09-14", to: "2026-09-16", now: NOW })
    const fabi = calendar.people.find((person) => person.name === "Fabi TH")!
    expect(fabi.days.map((day) => [day.date, day.state, day.availability.state])).toEqual([
      ["2026-09-14", "MISSING_EXPECTED_PRODUCTION", "READY"],
      ["2026-09-15", "WAITING_FOR_SOURCES", "WAITING_FOR_SOURCES"],
      ["2026-09-16", "WAITING_FOR_SOURCES", "WAITING_FOR_SOURCES"],
    ])
    expect(fabi.days[1]!.availability).toMatchObject({ decidedBy: "WORK_ACTIVITY", workActivityExpectedAt: new Date("2026-09-17T08:00:00-03:00").toISOString() })
    // Fonte sem política → AVAILABILITY_UNKNOWN: nenhuma pendência nasce (a INIA não assume D+1).
    await ctx.db.query(`update data_feeds set availability_policy = null where id = $1`, [interactionsFeed.id])
    f = await days()
    expect(f.observed).toMatchObject({ missingExpectedProductionDays: 0, waitingForSourcesDays: 0, dataSourceDelayDays: 0 })
    // Restaura as políticas "mesmo dia" (usadas pelos cenários anteriores) — inclusive para o feed de RH.
    await ctx.db.query(`update data_feeds set availability_policy = $2, last_success_at = $3 where id = any($1::uuid[])`, [[measurementsFeed.id, interactionsFeed.id, rhFeed.id], JSON.stringify({ lagDays: 0, availableByLocalTime: "14:30" }), NOW])
  })

  it("UPGRADE sem DELETE: 10 pendências abertas por regra anterior são reavaliadas pela regra atual — 2 aguardando, 2 fonte atrasada, 2 situação não produtiva, 1 trabalhou, 1 justificada → 8 resolvidas com motivo, 2 mantidas; segunda rodada: 0 mudanças", async () => {
    const clock = fixedClock(NOW)
    // Políticas D-1 11:00 com última carga em 15/09 12:00: 14/09 fechado (READY), 15/09 vencido sem carga (DELAYED), 16/09 ainda no prazo (WAITING).
    await ctx.db.query(`update data_feeds set availability_policy = $2, last_success_at = '2026-09-15T12:00:00-03:00', last_data_at = null where id = any($1::uuid[])`, [[measurementsFeed.id, interactionsFeed.id], JSON.stringify({ lagDays: 1, availableByLocalTime: "11:00" })])
    const sup3 = await person("TH-SUP3", "Supervisor Legado TH", "SUPERVISOR", null)
    const legacy: { id: string; workday: string; expect: string }[] = []
    const cases: [string, string][] = [["2026-09-16", "SOURCES_STILL_OPEN"], ["2026-09-16", "SOURCES_STILL_OPEN"], ["2026-09-15", "DATA_SOURCE_DELAYED"], ["2026-09-15", "DATA_SOURCE_DELAYED"], ["2026-09-14", "STATUS_NON_PRODUCTIVE"], ["2026-09-14", "STATUS_NON_PRODUCTIVE"], ["2026-09-14", "PRODUCTION_RECEIVED_AFTER_ALERT"], ["2026-09-14", "JUSTIFIED_ABSENCE"], ["2026-09-14", "OPEN"], ["2026-09-14", "OPEN"]]
    for (const [index, [workday, expected]] of cases.entries()) {
      const id = await person(`TH-L${index + 1}`, `Legado ${index + 1} TH`, "OPERATOR", sup3)
      await schedule(id, ["2026-09-14", "2026-09-15", "2026-09-16"], true)
      if (expected === "STATUS_NON_PRODUCTIVE") await db.query(`insert into employee_status_periods (organization_id, person_id, status, effective_from, effective_to, effective_to_explicit, source, observed_at) values ($1, $2, 'INSS', '2026-09-14', '2026-09-14', true, 'th-rh', now())`, [ORG, id])
      if (expected === "PRODUCTION_RECEIVED_AFTER_ALERT") await measure(id, "2026-09-14", 33, "th-vol-legado")
      // Quem tem a pendência legada em 15 ou 16 produziu em 14 (só a data legada está em jogo).
      if (workday !== "2026-09-14") await measure(id, "2026-09-14", 30, "th-vol-legado")
      if (expected === "JUSTIFIED_ABSENCE") await db.query(`insert into workday_classifications (organization_id, person_id, workday, classification, reason_code, classified_by_person_id, classified_at) values ($1, $2, '2026-09-14', 'JUSTIFIED_ABSENCE', 'ATESTADO', $3, $4)`, [ORG, id, sup3, new Date("2026-09-15T09:00:00-03:00")])
      // A pendência "legada": aberta pela regra anterior (fim do turno = cobrança), com alerta no sino do Supervisor.
      const alert = await db.query<{ id: string }>(`insert into alerts (organization_id, recipient_id, title, description, severity, alert_type, dedupe_key, created_at) values ($1, $2, 'Produção não identificada', 'legado', 'MEDIUM', 'WORKDAY_MISSING_PRODUCTION', $3, '2026-09-14T15:00:00-03:00') returning id`, [ORG, sup3, `workday_reconciliation:MISSING_EXPECTED_PRODUCTION:${id}:${workday}`])
      await db.query(`insert into workday_reconciliations (organization_id, person_id, workday, kind, status, snapshot, recipient_person_id, alert_id, detected_at) values ($1, $2, $3::date, 'MISSING_EXPECTED_PRODUCTION', 'OPEN', '{"legacyRule":"shift-end"}'::jsonb, $4, $5, '2026-09-14T15:00:00-03:00')`, [ORG, id, workday, sup3, alert.rows[0]!.id])
      legacy.push({ id, workday, expect: expected })
    }
    const rowsOf = async () => (await db.query<{ person_id: string; status: string; resolution: string | null; snapshot: { reviewedByCurrentRule?: { resolution: string; reason: string } }; alert_status: string }>(`select r.person_id, r.status, r.resolution, r.snapshot, a.status::text alert_status from workday_reconciliations r join alerts a on a.id = r.alert_id where r.recipient_person_id = $1 order by r.person_id`, [sup3])).rows
    const before = await rowsOf()
    expect(before.filter((row) => row.status === "OPEN")).toHaveLength(10)
    const first = await reconcileOrganizationWorkdays(db, ORG, TZ, clock.now(), { lookbackDays: 4 })
    const after = await rowsOf()
    const byPerson = new Map(after.map((row) => [row.person_id, row]))
    for (const entry of legacy) {
      const row = byPerson.get(entry.id)!
      if (entry.expect === "OPEN") {
        expect(row).toMatchObject({ status: "OPEN", resolution: null, alert_status: "OPEN" })
      } else {
        expect(row).toMatchObject({ status: "RESOLVED", resolution: entry.expect, alert_status: "RESOLVED" })
        if (entry.expect !== "PRODUCTION_RECEIVED_AFTER_ALERT") expect(row.snapshot.reviewedByCurrentRule?.reason).toBeTruthy()
      }
    }
    expect(after.filter((row) => row.status === "RESOLVED")).toHaveLength(8)
    expect(after.filter((row) => row.status === "OPEN")).toHaveLength(2)
    expect(first).toMatchObject({ opened: 0, autoResolved: 1, reviewedLegacy: 7 })
    // Nada apagado: as 10 linhas continuam; o alerta de FONTE atrasada (15/09) existe para os administradores.
    expect((await db.query<{ c: number }>(`select count(*)::int c from workday_reconciliations where recipient_person_id = $1`, [sup3])).rows[0]!.c).toBe(10)
    expect((await alerts(ids.admin, "DATA_SOURCE_AVAILABILITY_DELAYED")).some((alert) => alert.title.includes("15/09") && alert.status !== "RESOLVED")).toBe(true)
    // Segunda rodada (mesmo relógio): idempotente — zero mudanças.
    const second = await reconcileOrganizationWorkdays(db, ORG, TZ, clock.now(), { lookbackDays: 4 })
    expect(second).toMatchObject({ opened: 0, autoResolved: 0, reviewedLegacy: 0, supersededClassifications: 0 })
    expect(await rowsOf()).toEqual(after)
    // Timestamps de negócio vieram do Clock, não do relógio do banco.
    expect((await db.query<{ n: number }>(`select count(*)::int n from workday_reconciliations where recipient_person_id = $1 and status = 'RESOLVED' and resolved_at = $2`, [sup3, NOW])).rows[0]!.n).toBe(8)
    await ctx.db.query(`update data_feeds set availability_policy = $2, last_success_at = $3 where id = any($1::uuid[])`, [[measurementsFeed.id, interactionsFeed.id], JSON.stringify({ lagDays: 0, availableByLocalTime: "14:30" }), NOW])
  })

  it("horizonte da escala: calendário até 18/09 com aviso de 7 dias → alerta administrativo idempotente; calendário avança → alerta anterior resolvido", async () => {
    const first = await syncScheduleHorizonAlerts(db, ORG, "2026-09-16")
    expect(first.horizon).toMatchObject({ coverageUntil: "2026-09-18", daysRemaining: 3, endingSoon: true })
    expect(first.created).toBe(1)
    const adminAlerts = await alerts(ids.admin, "WORK_SCHEDULE_HORIZON")
    expect(await alerts(ids.legacyAdmin, "WORK_SCHEDULE_HORIZON")).toEqual([])
    expect(adminAlerts).toHaveLength(1)
    expect(adminAlerts[0]!.description).toMatch(/somente até 18\/09\. Restam 3 dias de calendário conhecido/)
    const again = await syncScheduleHorizonAlerts(db, ORG, "2026-09-16")
    expect(again.created).toBe(0)
    expect((await alerts(ids.admin, "WORK_SCHEDULE_HORIZON")).length).toBe(1)
    // Novo calendário chega (até 30/10): horizonte avança, aviso anterior encerrado, nenhum novo.
    await schedule(ids.a, ["2026-10-30"], true)
    const advanced = await syncScheduleHorizonAlerts(db, ORG, "2026-09-16")
    expect(advanced.horizon.endingSoon).toBe(false)
    expect(advanced.resolved).toBe(1)
    expect((await alerts(ids.admin, "WORK_SCHEDULE_HORIZON"))[0]!.status).toBe("RESOLVED")
  })

  it("nenhuma medição bruta foi apagada em toda a prova; valores só olham dias elegíveis", async () => {
    const rawAfter = await rawCount()
    expect(rawAfter).toBe(rawBefore + 6) // só a carga atrasada de A e as 5 medições dos casos legados entraram; nada saiu
    const values = await resolveOperationalWindowBySubject(db, { indicatorCode: "TH_VOL", subjectIds: [ids.a, ids.c, ids.e], window: WEEK, aggregation: "SUM", timeZone: TZ, now: NOW, expectedDays: 3 })
    expect(values.get(ids.a)).toMatchObject({ value: 99, daysWithData: 2 }) // 52 + 47 (qua virou day off — sem medição mesmo)
    expect(values.get(ids.c)).toBeUndefined() // INSS: fora, medição ignorada, não apagada
    expect((await db.query<{ c: number }>(`select count(*)::int c from indicator_measurements where subject_id = $1`, [ids.c])).rows[0]!.c).toBe(1)
  })
})
