import { randomBytes } from "node:crypto"
import pg from "pg"
import { loadIndicatorOperationalDefinition, resolveEligibleDaysBySubject, resolveOperationalWindowBySubject } from "../../modules/indicators/application/operational-measurement-resolver.js"
import { classifyWorkday, loadClassificationHistory } from "../../modules/people/application/workday-classification-service.js"
import { fixedClock } from "../../shared/domain/clock.js"
import type { Database } from "./pool.js"
import { bootstrapEnvironment, type BootstrapReport } from "./bootstrap-environment.js"
import { demoWeekdayDate } from "./demo-mass/demo-work-schedules.js"
import { resolveDemoReferenceDate } from "./demo-mass/seed-demo-mass.js"
import type { DemoSeedRunReport } from "./run-demo-seed.js"

/** Banco descartável: as contas demo daqui nunca são usadas — uma senha aleatória por execução, sem depender do .env. */
const SCRATCH_DEMO_PASSWORD = randomBytes(12).toString("hex")

/**
 * Prova de que o BOOTSTRAP roda DO ZERO: cria um banco descartável, executa o bootstrap oficial
 * (migrations → reference data → demo) uma vez e de novo (idempotência), verifica invariantes
 * (27 capitais, catálogo de feriados com proveniência, massa demo, zero duplicata na 2ª rodada) e
 * derruba o banco. Usado por `npm run db:bootstrap:check` (= `db:seed:demo:check`) e pelo teste de
 * integração (seed-demo-from-scratch.test.ts, ligado por DEMO_SEED_CHECK=1). Nunca toca `inia`/`inia_test`.
 */
export type FromScratchResult = {
  database: string
  migrationsApplied: number
  first: DemoSeedRunReport
  second: DemoSeedRunReport
  bootstrap: { first: BootstrapReport; second: BootstrapReport }
  counts: { people: number; measurements: number; officialRows: number; officialRowsCurrentMonth: number; closedPeriods: string[]; capitals: number; holidays: number; holidaysWithVerification: number; scheduleExceptions: number; classifications: number; volumeMeasurements: number; volumeIndicators: number; officialWithComponents: number; officialComponentsMissing: number }
  /** A regra de FALTA INJUSTIFICADA demonstrada só com a massa oficial, logo após o bootstrap (relógio fixo no fim do dia de referência). */
  absenceProof: AbsenceProof
}

export type AbsenceProof = {
  referenceDate: string
  /** 0029 (Joana): 5 dias esperados na semana — 4 medições reais + 1 falta injustificada. */
  unjustified: { atendimentos: WindowSummary; tma: WindowSummary; eligibleDays: number; unjustifiedAbsenceDays: number; rawVolumeRows: number }
  /** Depois de FALTA INJUSTIFICADA → ATESTADO: a contribuição zero some, 4/4; nenhuma linha criada/apagada. */
  afterAtestado: { atendimentos: WindowSummary; eligibleDays: number; historyLength: number; rawVolumeRows: number }
  /** 0030: falta injustificada contrariada por evidência real — dia trabalhado, classificação no histórico. */
  lateEvidence: { workedObservedDays: number; unjustifiedAbsenceDays: number; history: { classification: string; supersededReason: string | null }[] }
}
export type WindowSummary = { value: number | null; sampleCount: number; daysWithData: number; expectedDays: number | null; policy: string; zeroContributionDays: number }


const ORG = "00000000-0000-4000-8000-000000000001"

export async function seedDemoFromScratch(adminUrl: string, log: (message: string) => void, options: { keepDatabase?: boolean } = {}): Promise<FromScratchResult> {
  const database = `inia_seed_check_${Date.now().toString(36)}`
  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  await admin.query(`create database ${database}`)
  log(`banco descartável criado: ${database}`)
  const url = new URL(adminUrl)
  url.pathname = `/${database}`
  const pool = new pg.Pool({ connectionString: url.toString() })
  try {
    const client = await pool.connect()
    try {
      // NODE_ENV "test" aqui é o contexto do CHECK (banco descartável) — a política de produção
      // continua sendo a do runner (assertDemoSeedAllowed), nunca contornada.
      const firstBootstrap = await bootstrapEnvironment(client, { nodeEnv: "test", demoPassword: SCRATCH_DEMO_PASSWORD }, log)
      log(`${firstBootstrap.migrationsApplied.length} migrations aplicadas`)
      const secondBootstrap = await bootstrapEnvironment(client, { nodeEnv: "test", demoPassword: SCRATCH_DEMO_PASSWORD }, () => {})
      if (!firstBootstrap.demo || !secondBootstrap.demo) throw new Error("bootstrap do zero: etapa demo deveria ter rodado em NODE_ENV=test")
      const [people, measurements, official, currentMonth, periods, capitals, holidays, verified, exceptions, classifications, volumeMeasurements, volumeIndicators, withComponents, componentsMissing] = await Promise.all([
        client.query<{ n: string }>(`select count(*) n from people where organization_id = $1`, [ORG]),
        client.query<{ n: string }>(`select count(*) n from indicator_measurements where organization_id = $1 and source = 'DEMO_SEED'`, [ORG]),
        client.query<{ n: string }>(`select count(*) n from employee_indicator_performance where organization_id = $1`, [ORG]),
        client.query<{ n: string }>(`select count(*) n from employee_indicator_performance where organization_id = $1 and reference_period >= to_char(now() at time zone 'America/Fortaleza', 'YYYY-MM')`, [ORG]),
        client.query<{ p: string }>(`select distinct reference_period p from employee_indicator_performance where organization_id = $1 order by 1`, [ORG]),
        client.query<{ n: string }>(`select count(*) n from brazilian_capitals`),
        client.query<{ n: string }>(`select count(*) n from holiday_catalog`),
        client.query<{ n: string }>(`select count(*) n from holiday_catalog where verification is not null and source_reference <> ''`),
        client.query<{ n: string }>(`select count(*) n from employee_schedule_exceptions where organization_id = $1`, [ORG]),
        client.query<{ n: string }>(`select count(*) n from workday_classifications where organization_id = $1`, [ORG]),
        client.query<{ n: string }>(`select count(*) n from indicator_measurements m join indicator_definitions i on i.id = m.indicator_definition_id where m.organization_id = $1 and i.code = 'ATENDIMENTOS' and m.source = 'DEMO_SEED'`, [ORG]),
        client.query<{ n: string }>(`select count(*) n from indicator_definitions where organization_id = $1 and code = 'ATENDIMENTOS' and operational_aggregation = 'SUM' and unit = 'COUNT' and daily_supported and proves_work_activity and unjustified_absence_policy = 'ZERO_CONTRIBUTION'`, [ORG]),
        // Numerador/denominador nos fechamentos demo (migration 147): gerados pela massa e preenchidos no seed SQL 001.
        client.query<{ n: string }>(`select count(*) n from employee_indicator_performance where organization_id = $1 and source = 'DEMO_SEED' and numerator is not null`, [ORG]),
        client.query<{ n: string }>(`select count(*) n from employee_indicator_performance eip join indicator_definitions i on i.id = eip.indicator_definition_id where eip.organization_id = $1 and eip.source = 'DEMO_SEED' and eip.numerator is null and i.operational_aggregation in ('RATE', 'WEIGHTED_AVERAGE')`, [ORG]),
      ])
      const absenceProof = await proveUnjustifiedAbsence(pool)
      return {
        database,
        absenceProof,
        migrationsApplied: firstBootstrap.migrationsApplied.length,
        first: firstBootstrap.demo,
        second: secondBootstrap.demo,
        bootstrap: { first: firstBootstrap, second: secondBootstrap },
        counts: {
          people: Number(people.rows[0]!.n),
          measurements: Number(measurements.rows[0]!.n),
          officialRows: Number(official.rows[0]!.n),
          officialRowsCurrentMonth: Number(currentMonth.rows[0]!.n),
          closedPeriods: periods.rows.map((row) => row.p),
          capitals: Number(capitals.rows[0]!.n),
          holidays: Number(holidays.rows[0]!.n),
          holidaysWithVerification: Number(verified.rows[0]!.n),
          scheduleExceptions: Number(exceptions.rows[0]!.n),
          classifications: Number(classifications.rows[0]!.n),
          volumeMeasurements: Number(volumeMeasurements.rows[0]!.n),
          volumeIndicators: Number(volumeIndicators.rows[0]!.n),
          officialWithComponents: Number(withComponents.rows[0]!.n),
          officialComponentsMissing: Number(componentsMissing.rows[0]!.n),
        },
      }
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
    if (!options.keepDatabase) {
      await admin.query(`drop database ${database}`)
      log(`banco descartável removido: ${database}`)
    }
    await admin.end()
  }
}

/**
 * Falta injustificada × política por indicador, provada na massa oficial recém-carregada — sem criar
 * indicador pela API, sem medição sintética. Semana civil que termina na data de referência (D-6 → D),
 * relógio fixo às 23:59 de D no fuso da organização demo.
 */
async function proveUnjustifiedAbsence(db: Database): Promise<AbsenceProof> {
  const timeZone = "America/Fortaleza"
  const referenceDate = resolveDemoReferenceDate()
  const now = fixedClock(`${referenceDate}T23:59:59-03:00`).now()
  const start = new Date(new Date(`${referenceDate}T00:00:00-03:00`).getTime() - 6 * 86_400_000)
  const window = { start, end: new Date(new Date(`${referenceDate}T00:00:00-03:00`).getTime() + 86_400_000) }
  const person = async (matricula: string) => (await db.query<{ id: string; reports_to_id: string }>(`select id, reports_to_id from people where organization_id = $1 and matricula = $2`, [ORG, matricula])).rows[0]!
  const joana = await person("DEMO-OP-0029")
  const later = await person("DEMO-OP-0030")
  const definition = async (code: string) => (await loadIndicatorOperationalDefinition(db, code))!
  const summarize = async (code: string, aggregation: "SUM" | "WEIGHTED_AVERAGE", personId: string): Promise<WindowSummary> => {
    const result = (await resolveOperationalWindowBySubject(db, { indicatorCode: code, subjectIds: [personId], window, aggregation, timeZone, now, expectedDays: 5 }, await definition(code))).get(personId)
    return { value: result?.value ?? null, sampleCount: result?.sampleCount ?? 0, daysWithData: result?.daysWithData ?? 0, expectedDays: result?.expectedDays ?? null, policy: result?.unjustifiedAbsence.policy ?? "NO_SAMPLE", zeroContributionDays: result?.unjustifiedAbsence.zeroContributionDays ?? 0 }
  }
  const rawVolume = async () => Number((await db.query<{ n: string }>(`select count(*) n from indicator_measurements m join indicator_definitions i on i.id = m.indicator_definition_id where i.code = 'ATENDIMENTOS' and m.subject_id = $1`, [joana.id])).rows[0]!.n)
  const eligibility = (await resolveEligibleDaysBySubject(db, [joana.id], window, timeZone, { now })).get(joana.id)!
  const unjustified = { atendimentos: await summarize("ATENDIMENTOS", "SUM", joana.id), tma: await summarize("TMA", "WEIGHTED_AVERAGE", joana.id), eligibleDays: eligibility.eligibleDays, unjustifiedAbsenceDays: eligibility.observed.unjustifiedAbsenceDays, rawVolumeRows: await rawVolume() }
  const absenceDate = eligibility.observed.unjustifiedAbsenceDates[0]!
  await classifyWorkday(db, { organizationId: ORG, personId: joana.id, workday: absenceDate, classification: "JUSTIFIED_ABSENCE", reasonCode: "ATESTADO", actorPersonId: joana.reports_to_id, now })
  const revised = (await resolveEligibleDaysBySubject(db, [joana.id], window, timeZone, { now })).get(joana.id)!
  const afterAtestado = { atendimentos: await summarize("ATENDIMENTOS", "SUM", joana.id), eligibleDays: revised.eligibleDays, historyLength: (await loadClassificationHistory(db, ORG, joana.id, absenceDate)).length, rawVolumeRows: await rawVolume() }
  const late = (await resolveEligibleDaysBySubject(db, [later.id], window, timeZone, { now })).get(later.id)!
  const lateDate = demoWeekdayDate(referenceDate, -3)
  const lateHistory = await loadClassificationHistory(db, ORG, later.id, lateDate)
  return { referenceDate, unjustified, afterAtestado, lateEvidence: { workedObservedDays: late.observed.workedObservedDays, unjustifiedAbsenceDays: late.observed.unjustifiedAbsenceDays, history: lateHistory.map((entry) => ({ classification: entry.classification, supersededReason: entry.supersededReason })) } }
}
