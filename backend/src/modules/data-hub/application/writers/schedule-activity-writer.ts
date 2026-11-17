import { normalizeScheduleActivityType, type ScheduleActivityType } from "../../../people/domain/schedule-activity.js"
import { resolveEmployees } from "../reference-resolver.js"
import { dedupeByKey, emptyApply, reject, str, type DomainWriter, type Rejection, type ValidRecord } from "./domain-writer.js"
import { withLineage } from "./master-data-writers.js"

// ---------------------------------------------------------------------------------------------
// WORK_SCHEDULE_ACTIVITIES → employee_schedule_activities (login, pausas e outras atividades por data)
// ---------------------------------------------------------------------------------------------
type PreparedActivity = ValidRecord & {
  personId: string
  matricula: string
  scheduleDate: string
  activityName: string
  activityType: ScheduleActivityType
  startTime: string
  endTime: string
  sourceUpdatedAt: string | null
  externalActivityId: string | null
  /** Alguma linha desta pessoa × data foi recusada nesta carga: o dia veio incompleto e nada dele é desativado (run-6 JA-01). */
  dayIncomplete: boolean
}

const keyOf = (row: { personId: string; scheduleDate: string; startTime: string; activityName: string }) => `${row.personId}|${row.scheduleDate}|${row.startTime}|${row.activityName}`

/**
 * A carga de uma data traz o DIA INTEIRO da pessoa. Por isso, depois do upsert, toda atividade ativa da mesma pessoa × data que não
 * veio nesta carga (outro `last_run_id`) é desativada — a pausa remarcada de 10h20 para 10h40 não fica duplicada. Dia com alguma
 * linha recusada nesta carga (atividade sem tipo) não é desativado: veio incompleto e a versão anterior fica. Nunca `delete`:
 * a linha antiga fica com `active = false` e `superseded_at`. Lotes da mesma carga não se desativam entre si (mesmo `last_run_id`).
 */
export const workScheduleActivitiesWriter: DomainWriter<PreparedActivity> = {
  contractKey: "WORK_SCHEDULE_ACTIVITIES",
  async prepare(context, records) {
    const { unique, duplicates } = dedupeByKey(records, (record) => `${record.record.externalEmployeeId}|${record.record.scheduleDate}|${record.record.startTime}|${record.record.activityName}`)
    const people = await resolveEmployees(context.ctx.db, context.organizationId, unique.map((record) => str(record.record, "externalEmployeeId")))
    const ready: PreparedActivity[] = []
    const rejections: Rejection[] = [...duplicates]
    // Dias (matrícula × data) com alguma linha recusada nesta carga: o dia não veio inteiro, então o que já estava gravado nele fica.
    const incompleteDays = new Set<string>()
    const dayOf = (record: ValidRecord) => `${str(record.record, "externalEmployeeId")}|${str(record.record, "scheduleDate")}`
    // Recusadas já na validação do contrato (tipo sem "Mapear códigos", horário inválido): contam se a matrícula e a data vieram.
    for (const values of context.rejectedValues ?? []) {
      const matricula = typeof values.externalEmployeeId === "string" ? values.externalEmployeeId : null
      const date = typeof values.scheduleDate === "string" ? values.scheduleDate : null
      if (matricula && date) incompleteDays.add(`${matricula}|${date}`)
    }
    for (const record of unique) {
      const matricula = str(record.record, "externalEmployeeId")!
      const person = people.get(matricula)
      if (!person) {
        rejections.push(reject(record, "DATA_EMPLOYEE_NOT_FOUND", "externalEmployeeId", `Colaborador "${matricula}" não existe na INIA.`))
        continue
      }
      const activityType = normalizeScheduleActivityType(str(record.record, "activityType"))
      if (!activityType) {
        rejections.push(reject(record, "DATA_INVALID_ENUM", "activityType", `A atividade "${str(record.record, "activityName")}" não tem tipo (login, pausa ou outra). Classifique o nome em 'Mapear códigos'.`))
        incompleteDays.add(dayOf(record))
        continue
      }
      ready.push({
        ...record,
        personId: person.id,
        matricula,
        scheduleDate: str(record.record, "scheduleDate")!,
        activityName: str(record.record, "activityName")!.trim(),
        activityType,
        startTime: str(record.record, "startTime")!,
        endTime: str(record.record, "endTime")!,
        sourceUpdatedAt: str(record.record, "sourceUpdatedAt"),
        externalActivityId: str(record.record, "externalActivityId"),
        dayIncomplete: false,
      })
    }
    for (const row of ready) row.dayIncomplete = incompleteDays.has(`${row.matricula}|${row.scheduleDate}`)
    return { ready, rejections }
  },
  async apply(context, client, batch) {
    if (batch.length === 0) return emptyApply()
    const observedAt = context.ctx.clock.now().toISOString()
    const columns = [batch.map((r) => r.personId), batch.map((r) => r.scheduleDate), batch.map((r) => r.activityType), batch.map((r) => r.activityName), batch.map((r) => r.startTime), batch.map((r) => r.endTime), batch.map((r) => r.externalActivityId), batch.map((r) => r.sourceUpdatedAt)]
    const result = await client.query<{ id: string; person_id: string; schedule_date: string; start_time: string; activity_name: string; inserted: boolean }>(
      `insert into employee_schedule_activities (organization_id, person_id, schedule_date, activity_type, activity_name, start_time, end_time, source_reference, source_updated_at, source, observed_at, last_run_id)
       select $1, person_id, schedule_date::date, activity_type, activity_name, start_time::time, end_time::time, source_reference, source_updated_at::timestamptz, $10, $11::timestamptz, $12
       from unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[]) as t(person_id, schedule_date, activity_type, activity_name, start_time, end_time, source_reference, source_updated_at)
       on conflict (person_id, schedule_date, start_time, activity_name) do update
         set activity_type = excluded.activity_type, end_time = excluded.end_time, active = true, superseded_at = null, source = excluded.source,
             source_reference = excluded.source_reference, source_updated_at = excluded.source_updated_at, observed_at = excluded.observed_at, last_run_id = excluded.last_run_id, updated_at = now()
       where employee_schedule_activities.activity_type is distinct from excluded.activity_type or employee_schedule_activities.end_time is distinct from excluded.end_time
          or not employee_schedule_activities.active or employee_schedule_activities.source_reference is distinct from excluded.source_reference
       returning id, person_id, to_char(schedule_date, 'YYYY-MM-DD') schedule_date, to_char(start_time, 'HH24:MI') start_time, activity_name, (xmax = 0) inserted`,
      [context.organizationId, ...columns, context.sourceNamespace, observedAt, context.runId],
    )
    // Linhas iguais à que já existia não passam pelo `do update`: marca a carga nelas também (senão seriam desativadas abaixo).
    await client.query(
      `update employee_schedule_activities a set last_run_id = $6, observed_at = $7::timestamptz
         from unnest($1::uuid[], $2::text[], $3::text[], $4::text[]) as t(person_id, schedule_date, start_time, activity_name)
        where a.organization_id = $5 and a.person_id = t.person_id and a.schedule_date = t.schedule_date::date and a.start_time = t.start_time::time and a.activity_name = t.activity_name
          and a.last_run_id is distinct from $6`,
      [batch.map((r) => r.personId), batch.map((r) => r.scheduleDate), batch.map((r) => r.startTime), batch.map((r) => r.activityName), context.organizationId, context.runId, observedAt],
    )
    const superseded = await client.query(
      `update employee_schedule_activities a set active = false, superseded_at = $4::timestamptz, updated_at = now()
         from (select distinct person_id, schedule_date from unnest($1::uuid[], $2::text[]) as t(person_id, schedule_date)) d
        where a.organization_id = $3 and a.person_id = d.person_id and a.schedule_date = d.schedule_date::date and a.active and a.last_run_id is distinct from $5`,
      [batch.filter((r) => !r.dayIncomplete).map((r) => r.personId), batch.filter((r) => !r.dayIncomplete).map((r) => r.scheduleDate), context.organizationId, observedAt, context.runId],
    )
    const applied = withLineage("employee_schedule_activities", batch, keyOf, result.rows.map((row) => ({ key: `${row.person_id}|${row.schedule_date}|${row.start_time}|${row.activity_name}`, id: row.id, inserted: row.inserted })))
    applied.deactivated += superseded.rowCount ?? 0
    applied.businessMaxEventTime = batch.reduce<string | null>((max, row) => (!max || row.scheduleDate > max ? row.scheduleDate : max), null)
    return applied
  },
}
