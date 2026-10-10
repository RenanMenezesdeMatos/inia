import type pg from "pg"
import { addDaysToDate } from "../../../modules/people/domain/employment-status.js"
import type { ScheduleExceptionCode } from "../../../modules/people/domain/schedule-exception.js"
import { weekdayOf, type ScheduleType } from "../../../modules/people/domain/work-schedule.js"
import { DEMO_ORGANIZATION_ID, DEMO_SOURCE } from "./demo-constants.js"
import { demoId } from "./demo-ids.js"
import type { DemoPerson } from "./structure-generator.js"

/**
 * ESCALAS na massa demo — fixtures auxiliares (operadores 0021..0025), relativas à data de
 * referência, que cobrem os casos canônicos do calendário real sem tocar nas personas narrativas.
 * O resto da massa continua SEM escala configurada (fallback legado seg–sex, marcado como tal).
 *
 *   operador0021 — 6x1, folga na QUARTA, trabalha sábado E domingo (folga em dia útil não reduz cobertura);
 *   operador0022 — 6x1, folga no domingo, trabalha sábado (sábado entra na cobertura) + 2 dias de INSS na última semana;
 *   operador0023 — 5x2 explícito segunda–sexta;
 *   operador0024 — 5x2 explícito com folga terça/quarta (trabalha sábado e domingo — 5x2 não é seg–sex por suposição);
 *   operador0025 — regime 6x1 conhecido SEM calendário (a INIA não inventa a folga: escala desconhecida);
 *   operador0026 — 5x2 explícito seg–sex + DAY OFF (vindo da Central) numa quarta programada, MAS com produção
 *                  observada naquele dia (medição do indicador de eficiência, marcado como evidência): PLANEJADO ×
 *                  OBSERVADO → dia trabalhado, divergência registrada, a exceção fica no histórico;
 *   operador0027 — 6x1 folga domingo + BANCO DE HORAS provisionado pelo Supervisor numa quinta programada, SEM
 *                  produção (exceção vence a escala; o dia sai do cálculo);
 *   operador0028 — SEM escala (fallback seg–sex), capital Fortaleza: com a política de feriado EXCLUDE o feriado
 *                  aplicável sai do fallback; com IGNORE (default) nada muda;
 *   operador0029 — 5x2 explícito seg–sex com um dia programado (D-2) SEM nenhuma produção, já CLASSIFICADO pelo
 *                  Supervisor como FALTA INJUSTIFICADA (workday_classifications): o dia continua esperado; Atendimentos
 *                  (ZERO_CONTRIBUTION) recebe 0 lógico, TMA (NO_SAMPLE) fica sem amostra — nenhuma medição sintética;
 *   operador0030 — 5x2 explícito seg–sex: FALTA INJUSTIFICADA classificada em D-3 e depois CONTRARIADA por evidência
 *                  real (a produção do dia existe): dia trabalhado, classificação preservada no histórico como superada.
 * Capital operacional (jurisdição de feriados): fixtures em Fortaleza (0023 Recife, 0024 Salvador) —
 * o 6x1 de Fortaleza (0021) tem escala explícita "trabalha" no 7 de setembro: feriado NÃO vence escala.
 * Calendário explícito: D-21 até D+14 (snapshot de horizonte). Idempotente (ids determinísticos, upsert).
 */
/** `production`: a massa gera medição (evidência) naquele dia mesmo com a exceção — divergência plano × realidade. */
export type DemoScheduleException = { offset: number; code: ScheduleExceptionCode; reason: string; origin: "CENTRAL_DATA" | "SUPERVISOR_MANUAL"; production: boolean }
/** Classificação humana já registrada na massa (revisável; `supersededReason` = já superada por fato posterior). */
export type DemoClassification = { offset: number; classification: "UNJUSTIFIED_ABSENCE" | "JUSTIFIED_ABSENCE" | "WORKED_DATA_MISSING"; reasonCode?: "ATESTADO" | "DAY_OFF" | "BANCO_HORAS" | "FOLGA_EXTRAORDINARIA" | "OTHER_JUSTIFIED"; supersededReason?: "CONTRADICTED_BY_WORK_EVIDENCE" | "SUPERSEDED_BY_AUTHORITATIVE_STATUS" }
export type DemoScheduleFixture = { operatorOrdinal: number; scheduleType: ScheduleType | null; daysOff: number[] | null; scenario: string; capital: string | null; exceptions?: DemoScheduleException[]; /** Dias programados (offset) em que a massa NÃO gera produção — pendência de reconciliação. */ missingProductionOffsets?: number[]; classifications?: DemoClassification[] }

export const DEMO_SCHEDULE_FIXTURES: DemoScheduleFixture[] = [
  { operatorOrdinal: 21, scheduleType: "SIX_BY_ONE", daysOff: [3], scenario: "6x1 com folga na quarta; trabalha sábado e domingo", capital: "FORTALEZA" },
  { operatorOrdinal: 22, scheduleType: "SIX_BY_ONE", daysOff: [0], scenario: "6x1 com folga no domingo; trabalha sábado", capital: "FORTALEZA" },
  { operatorOrdinal: 23, scheduleType: "FIVE_BY_TWO", daysOff: [0, 6], scenario: "5x2 explícito segunda–sexta", capital: "RECIFE" },
  { operatorOrdinal: 24, scheduleType: "FIVE_BY_TWO", daysOff: [2, 3], scenario: "5x2 explícito com folga terça/quarta (trabalha no fim de semana)", capital: "SALVADOR" },
  { operatorOrdinal: 25, scheduleType: "SIX_BY_ONE", daysOff: null, scenario: "Regime 6x1 conhecido sem calendário — folga desconhecida", capital: "FORTALEZA" },
  { operatorOrdinal: 26, scheduleType: "FIVE_BY_TWO", daysOff: [0, 6], scenario: "5x2 seg–sex + day off numa quarta programada, com produção observada (divergência plano × realidade)", capital: "FORTALEZA", exceptions: [{ offset: -6, code: "DAY_OFF", reason: "Day off concedido pela supervisão", origin: "CENTRAL_DATA", production: true }] },
  { operatorOrdinal: 27, scheduleType: "SIX_BY_ONE", daysOff: [0], scenario: "6x1 folga domingo + banco de horas provisionado pelo Supervisor numa quinta programada, sem produção", capital: "FORTALEZA", exceptions: [{ offset: -5, code: "BANCO_HORAS", reason: "Banco de horas", origin: "SUPERVISOR_MANUAL", production: false }] },
  { operatorOrdinal: 28, scheduleType: null, daysOff: null, scenario: "Sem escala (fallback seg–sex) em Fortaleza — feriado só com política EXCLUDE", capital: "FORTALEZA" },
  { operatorOrdinal: 29, scheduleType: "FIVE_BY_TWO", daysOff: [0, 6], scenario: "5x2 seg–sex com um dia programado sem nenhuma produção, classificado como falta injustificada (Atendimentos = contribuição zero, TMA sem amostra)", capital: "FORTALEZA", missingProductionOffsets: [-2], classifications: [{ offset: -2, classification: "UNJUSTIFIED_ABSENCE" }] },
  { operatorOrdinal: 30, scheduleType: "FIVE_BY_TWO", daysOff: [0, 6], scenario: "5x2 seg–sex: falta injustificada classificada em D-3 e contrariada por evidência real posterior (dia trabalhado, histórico preservado)", capital: "FORTALEZA", classifications: [{ offset: -3, classification: "UNJUSTIFIED_ABSENCE", supersededReason: "CONTRADICTED_BY_WORK_EVIDENCE" }] },
]

/** Fuso da organização demo (mesmo offset de DEMO_TZ_OFFSET em demo-constants.ts). */
const DEMO_TIMEZONE_NAME = "America/Fortaleza"

export const DEMO_SCHEDULE_PAST_DAYS = 21
export const DEMO_SCHEDULE_FUTURE_DAYS = 14

export function demoScheduleFixtureFor(person: Pick<DemoPerson, "role" | "ordinal">): DemoScheduleFixture | null {
  if (person.role !== "OPERATOR") return null
  return DEMO_SCHEDULE_FIXTURES.find((fixture) => fixture.operatorOrdinal === person.ordinal) ?? null
}

/** Data local de uma exceção da fixture (offset em dias a partir da data de referência). */
export function demoExceptionDate(referenceDate: string, exception: DemoScheduleException): string {
  return addDaysToDate(referenceDate, exception.offset)
}

/** Datas do calendário explícito do operador (null = sem calendário: fallback legado ou regime sem folga). */
export function demoScheduleDays(fixture: DemoScheduleFixture, referenceDate: string): { date: string; scheduledToWork: boolean }[] | null {
  if (!fixture.daysOff) return null
  const days: { date: string; scheduledToWork: boolean }[] = []
  for (let offset = -DEMO_SCHEDULE_PAST_DAYS; offset <= DEMO_SCHEDULE_FUTURE_DAYS; offset += 1) {
    const date = addDaysToDate(referenceDate, offset)
    days.push({ date, scheduledToWork: !fixture.daysOff.includes(weekdayOf(date)) })
  }
  return days
}

/**
 * Data de um "dia sem produção"/classificação da fixture: offset a partir da referência, recuando até um
 * dia útil (seg–sex) — a massa é regenerada em qualquer data de referência e o caso precisa cair num dia
 * PROGRAMADO do 5x2 seg–sex (numa segunda, D-2 seria sábado).
 */
export function demoWeekdayDate(referenceDate: string, offset: number): string {
  let date = addDaysToDate(referenceDate, offset)
  while (weekdayOf(date) === 0 || weekdayOf(date) === 6) date = addDaysToDate(date, -1)
  return date
}

/** Datas em que a massa NÃO gera produção para o operador (exceção sem produção, dia "sem produção" da fixture). */
export function demoNoProductionDates(fixture: DemoScheduleFixture, referenceDate: string): Set<string> {
  const dates = new Set<string>()
  for (const exception of fixture.exceptions ?? []) if (!exception.production) dates.add(demoExceptionDate(referenceDate, exception))
  for (const offset of fixture.missingProductionOffsets ?? []) dates.add(demoWeekdayDate(referenceDate, offset))
  return dates
}

/** Dias em que o operador PRODUZ na massa (só para quem tem calendário explícito): programado para trabalhar e sem "sem produção" da fixture — o gerador de medições respeita. */
export function demoScheduledWorkDates(person: Pick<DemoPerson, "role" | "ordinal">, referenceDate: string): Set<string> | null {
  const fixture = demoScheduleFixtureFor(person)
  const days = fixture ? demoScheduleDays(fixture, referenceDate) : null
  if (!days || !fixture) return null
  const skipped = demoNoProductionDates(fixture, referenceDate)
  return new Set(days.filter((day) => day.scheduledToWork && !skipped.has(day.date)).map((day) => day.date))
}

export async function persistDemoWorkSchedules(client: pg.PoolClient, people: DemoPerson[], referenceDate: string): Promise<{ regimes: number; days: number; exceptions: number; capitals: number; classifications: number }> {
  let regimes = 0
  let days = 0
  let exceptions = 0
  let capitals = 0
  let classifications = 0
  const observedAt = `${referenceDate}T12:00:00-03:00`
  const peopleByKey = new Map(people.map((person) => [person.key, person]))
  for (const person of people) {
    const fixture = demoScheduleFixtureFor(person)
    if (!fixture) continue
    // Quem provisionou (fixture SUPERVISOR_MANUAL): o Supervisor direto do operador na massa.
    const supervisorId = person.reportsToKey ? (peopleByKey.get(person.reportsToKey)?.id ?? null) : null
    // Capital operacional (jurisdição de feriados) — só nas fixtures; o resto da massa fica sem (qualidade de dado visível).
    const capitalUpdate = await client.query(`update people set operational_capital_code = $2 where id = $1 and operational_capital_code is distinct from $2`, [person.id, fixture.capital])
    capitals += capitalUpdate.rowCount ?? 0
    // Regime na jornada já existente da massa (employee_work_shifts.schedule_type) — histórico pela vigência.
    if (fixture.scheduleType) {
      const updated = await client.query(`update employee_work_shifts set schedule_type = $2, updated_at = now() where id = $1 and schedule_type is distinct from $2`, [demoId(`shift:${person.key}`), fixture.scheduleType])
      regimes += updated.rowCount ?? 0
    }
    // Exceções individuais (day off / banco de horas): a escala programada NÃO é reescrita — os dois fatos coexistem.
    // Origem: da Central (source DEMO_SEED) ou provisionada pelo Supervisor (source MANUAL, created_by = supervisor).
    for (const exception of fixture.exceptions ?? []) {
      const date = demoExceptionDate(referenceDate, exception)
      const manual = exception.origin === "SUPERVISOR_MANUAL"
      await client.query(
        `insert into employee_schedule_exceptions (id, organization_id, person_id, exception_date, code, effect, raw_reason, active, source, source_reference, observed_at, origin, created_by_person_id)
         values ($1, $2, $3, $4::date, $5, 'NON_WORKING', $6, true, $7, $8, $9::timestamptz, $10, $11)
         on conflict (person_id, exception_date, code) do update set raw_reason = excluded.raw_reason, active = true, source = excluded.source, origin = excluded.origin, created_by_person_id = excluded.created_by_person_id, cancelled_at = null, cancelled_by_person_id = null, manual_override = false, updated_at = now()
         where employee_schedule_exceptions.raw_reason is distinct from excluded.raw_reason or not employee_schedule_exceptions.active or employee_schedule_exceptions.origin is distinct from excluded.origin`,
        [demoId(`schedule-exception:${person.key}:${date}:${exception.code}`), DEMO_ORGANIZATION_ID, person.id, date, exception.code, exception.reason, manual ? "MANUAL" : DEMO_SOURCE, fixture.scenario, observedAt, exception.origin, manual ? supervisorId : null],
      )
      exceptions += 1
    }
    // Classificações humanas da massa (falta injustificada etc.): uma linha por revisão, id determinístico, quem
    // classificou = Supervisor direto; a já superada carrega o motivo e o instante (como o job faria).
    for (const item of fixture.classifications ?? []) {
      const date = demoWeekdayDate(referenceDate, item.offset)
      const classifiedAt = `${addDaysToDate(date, 1)}T09:12:00-03:00`
      const supersededAt = item.supersededReason ? `${addDaysToDate(date, 1)}T15:43:00-03:00` : null
      await client.query(
        `insert into workday_classifications (id, organization_id, person_id, workday, classification, reason_code, origin, classified_by_person_id, classified_at, superseded_at, superseded_reason)
         values ($1, $2, $3, $4::date, $5, $6, 'SUPERVISOR_MANUAL', $7, $8::timestamptz, $9::timestamptz, $10)
         on conflict do nothing`,
        [demoId(`classification:${person.key}:${date}:${item.classification}`), DEMO_ORGANIZATION_ID, person.id, date, item.classification, item.reasonCode ?? null, supervisorId, classifiedAt, supersededAt, item.supersededReason ?? null],
      )
      classifications += 1
    }
    const calendar = demoScheduleDays(fixture, referenceDate)
    if (!calendar) continue
    await client.query(
      `insert into employee_schedule_days (id, organization_id, person_id, schedule_date, scheduled_to_work, shift_start, shift_end, schedule_type, source, source_reference, observed_at)
       select id, $1, $2, schedule_date::date, scheduled_to_work, case when scheduled_to_work then '08:00'::time end, case when scheduled_to_work then '14:20'::time end, $3::text, $4, source_reference, $5::timestamptz
       from unnest($6::uuid[], $7::text[], $8::boolean[], $9::text[]) as t(id, schedule_date, scheduled_to_work, source_reference)
       on conflict (person_id, schedule_date) do update set scheduled_to_work = excluded.scheduled_to_work, shift_start = excluded.shift_start, shift_end = excluded.shift_end,
         schedule_type = excluded.schedule_type, source = excluded.source, source_reference = excluded.source_reference, updated_at = now()
       where employee_schedule_days.scheduled_to_work is distinct from excluded.scheduled_to_work or employee_schedule_days.schedule_type is distinct from excluded.schedule_type`,
      [DEMO_ORGANIZATION_ID, person.id, fixture.scheduleType, DEMO_SOURCE, observedAt, calendar.map((day) => demoId(`schedule:${person.key}:${day.date}`)), calendar.map((day) => day.date), calendar.map((day) => day.scheduledToWork), calendar.map(() => fixture.scenario)],
    )
    days += calendar.length
    // Consistência da própria massa demo: uma medição DEMO_SEED gerada por um seed anterior (sem
    // calendário) num dia que agora é folga programada não seria gerada hoje — some. Só dados
    // DEMO_SEED deste operador; medição real de cliente nunca é apagada por causa de escala.
    const offDates = [...calendar.filter((day) => !day.scheduledToWork).map((day) => day.date), ...demoNoProductionDates(fixture, referenceDate)]
    if (offDates.length > 0) {
      await client.query(
        `delete from indicator_measurements m using indicator_definitions i
          where i.id = m.indicator_definition_id and m.subject_type = 'PERSON' and m.subject_id = $1 and m.source = $2 and m.granularity = 'DAILY'
            and (m.period_start at time zone $3)::date = any($4::date[])`,
        [person.id, DEMO_SOURCE, DEMO_TIMEZONE_NAME, offDates],
      )
    }
  }
  return { regimes, days, exceptions, capitals, classifications }
}
