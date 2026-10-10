import type pg from "pg"
import { DEMO_ORGANIZATION_ID, DEMO_SOURCE } from "./demo-constants.js"
import { demoId } from "./demo-ids.js"
import { DEMO_CHANNEL, DEMO_FLAGS, demoFlagId } from "./flag-catalog.js"
import { DEMO_VOLUME_INDICATOR } from "./indicator-catalog.js"
import { DIAGNOSTIC_SUBGROUP, subteamKey } from "./structure-generator.js"
import { reportDiagnosticCalls, type DiagnosticCallsDbReport } from "./diagnostic-calls.js"
import { indicatorDefinitionInputSchema, validateIndicatorDefinition } from "../../../modules/indicators/domain/indicator-definition.js"
import { shiftFor } from "./interaction-generator.js"
import type { IndicatorDefinition } from "./performance-generator.js"
import type { DemoMass } from "./build-demo-mass.js"
import type { DemoPerson } from "./structure-generator.js"

/**
 * Persistência em lote da massa demo — sempre pelas tabelas/contratos reais, sempre idempotente
 * (upsert por id determinístico ou pela unique key oficial da tabela). Cada fase roda numa
 * transação própria (nunca uma transação gigante segurando 20 mil transcrições); dentro da fase,
 * inserts multi-linha via `unnest` em lotes fixos.
 */
type Client = pg.PoolClient
const BATCH = 1000
const ROLE_ORDER = ["DIRECTOR", "SENIOR_MANAGER", "MANAGER", "COORDINATOR", "SUPERVISOR", "OPERATOR"] as const

export type PersistReport = {
  people: Record<string, number>
  users: number
  operations: number
  teams: number
  subteams: number
  goals: number
  workShifts: number
  periods: number
  indicatorPerformanceRows: number
  prvRows: number
  dailyMeasurements: number
  dailyFirstDay: string | null
  dailyLastDay: string | null
  dailyDaysWithData: number
  dailyByIndicator: Record<string, number>
  interactions: number
  interactionsFlagged: number
  interactionsByLength: Record<string, number>
  flagRows: number
  flagsByName: Record<string, number>
  transcriptBytes: number
  canonicalInteractions: number
  /** Lote externo de 90 chamadas (diagnostic-calls.ts), contado no banco. */
  diagnosticCalls: DiagnosticCallsDbReport
  /** População do Subgrupo "Diagnóstico IA — Operadores com gravações" (personas + legados reposicionados). */
  diagnosticSubgroup: { operators: number; interactions: number; transcripts: number }
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

async function transaction<T>(client: Client, work: () => Promise<T>): Promise<T> {
  await client.query("begin")
  try {
    const result = await work()
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback")
    throw error
  }
}

/**
 * Garante a definição do indicador de volume da massa (`DEMO_VOLUME_INDICATOR`) — mesma linha que a
 * tela Indicadores gravaria (validada pelo domínio do catálogo antes do insert). Idempotente por
 * (organização, código); nunca altera uma definição já existente (o admin pode tê-la editado).
 */
export async function ensureDemoVolumeIndicator(client: Client): Promise<{ created: boolean; id: string }> {
  const input = validateIndicatorDefinition(indicatorDefinitionInputSchema.parse({ ...DEMO_VOLUME_INDICATOR, minimumSampleSize: null, availabilityPolicy: null, active: true }))
  const inserted = await client.query<{ id: string }>(
    `insert into indicator_definitions (id, organization_id, code, name, unit, desired_direction, daily_supported, operational_aggregation, minimum_sample_size, minimum_coverage, official_closure_supported, active, proves_work_activity, unjustified_absence_policy)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, $12, $13) on conflict (organization_id, code) do nothing returning id`,
    [demoId(`indicator:${input.code}`), DEMO_ORGANIZATION_ID, input.code, input.name, input.unit, input.desiredDirection, input.dailySupported, input.operationalAggregation, input.minimumSampleSize, input.minimumCoverage, input.officialClosureSupported, input.provesWorkActivity, input.unjustifiedAbsencePolicy],
  )
  if (inserted.rows[0]) return { created: true, id: inserted.rows[0].id }
  const existing = await client.query<{ id: string }>(`select id from indicator_definitions where organization_id = $1 and code = $2`, [DEMO_ORGANIZATION_ID, input.code])
  return { created: false, id: existing.rows[0]!.id }
}

export async function loadIndicatorDefinitions(client: Client): Promise<Map<string, IndicatorDefinition>> {
  const result = await client.query<IndicatorDefinition>(
    `select id, code, unit, desired_direction direction, operational_aggregation kind, daily_supported "dailySupported" from indicator_definitions where organization_id = $1 and active`,
    [DEMO_ORGANIZATION_ID],
  )
  return new Map(result.rows.map((row) => [row.code, row]))
}

/**
 * Garante o catálogo de flags e devolve nome → id. TODAS as flags da massa passam pelo
 * `on conflict do nothing`: uma flag "pré-existente" (`existing: true`) é reutilizada pelo nome
 * quando já está no banco (dev) e CRIADA quando não está — `tdna`, por exemplo, nunca foi
 * inserida por migration (a 019 só a referencia), então um banco recém-migrado (inia_test, check
 * do zero) não a tem. O reset continua removendo só as flags marcadas `existing: false`.
 */
export async function ensureChannelFlags(client: Client): Promise<Map<string, string>> {
  await transaction(client, async () => {
    for (const flag of DEMO_FLAGS) {
      await client.query(
        `insert into channel_flags (id, organization_id, channel, flag_name, value_type, description, active)
         values ($1, $2, $3, $4, $5, $6, true)
         on conflict (organization_id, channel, flag_name) do nothing`,
        [demoFlagId(flag.name), DEMO_ORGANIZATION_ID, DEMO_CHANNEL, flag.name, flag.valueType, flag.description],
      )
    }
  })
  const result = await client.query<{ id: string; flag_name: string; value_type: string }>(
    `select id, flag_name, value_type from channel_flags where organization_id = $1 and channel = $2 and active`,
    [DEMO_ORGANIZATION_ID, DEMO_CHANNEL],
  )
  const byName = new Map(result.rows.map((row) => [row.flag_name, row.id]))
  const missing = DEMO_FLAGS.filter((flag) => !byName.has(flag.name)).map((flag) => flag.name)
  if (missing.length > 0) throw new Error(`Flags de canal ausentes após garantir catálogo: ${missing.join(", ")}`)
  return byName
}

export async function persistStructure(client: Client, mass: DemoMass): Promise<void> {
  const { structure } = mass
  await transaction(client, async () => {
    for (const operation of structure.operations.filter((candidate) => !candidate.existing)) {
      await client.query(
        `insert into operations (id, organization_id, name) values ($1, $2, $3) on conflict (id) do update set name = excluded.name`,
        [operation.id, DEMO_ORGANIZATION_ID, operation.name],
      )
    }
    await client.query(
      `insert into teams (id, organization_id, operation_id, name)
       select * from unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[])
       on conflict (id) do update set name = excluded.name, operation_id = excluded.operation_id`,
      [structure.teams.map((team) => team.id), structure.teams.map(() => DEMO_ORGANIZATION_ID), structure.teams.map((team) => team.operationId), structure.teams.map((team) => team.name)],
    )
    await client.query(
      `insert into subteams (id, organization_id, team_id, name)
       select * from unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[])
       on conflict (id) do update set name = excluded.name, team_id = excluded.team_id`,
      [structure.subteams.map((subteam) => subteam.id), structure.subteams.map(() => DEMO_ORGANIZATION_ID), structure.subteams.map((subteam) => subteam.teamId), structure.subteams.map((subteam) => subteam.name)],
    )

    for (const role of ROLE_ORDER) {
      const people = structure.people.filter((person) => person.role === role && !person.adopted)
      // Pessoas legadas adotadas (legacy-adoption.ts): já existem — só posição na estrutura;
      // nome, cargo e admissão/matrícula existentes ficam (preenche só o que era nulo).
      const adopted = structure.people.filter((person) => person.role === role && person.adopted)
      for (const person of adopted) {
        // Reposicionado no Subgrupo de diagnóstico: só um cargo que a PRÓPRIA massa escreveu para o Grupo
        // antigo ("Operadora de Atendimento — B2B · …") é trocado pelo do Grupo novo; cargo digitado fica.
        const replaceableJobTitle = person.adopted?.relocatedFrom?.seedJobTitle ?? null
        await client.query(
          `update people set team_id = $2, subteam_id = $3, reports_to_id = $4, role = $5, active = true,
             hired_at = coalesce(hired_at, $6::date), matricula = coalesce(matricula, $7),
             job_title = case when job_title is null or job_title = $9 then $8 else job_title end
           where id = $1`,
          [
            person.id,
            person.teamKey ? structure.teamByKey.get(person.teamKey)!.id : null,
            person.subteamKey ? structure.subteamByKey.get(person.subteamKey)!.id : null,
            person.reportsToKey ? structure.byKey.get(person.reportsToKey)!.id : null,
            person.role, person.hiredAt, person.matricula, person.jobTitle, replaceableJobTitle,
          ],
        )
      }
      for (const batch of chunks(people, BATCH)) {
        await client.query(
          `insert into people (id, organization_id, team_id, subteam_id, name, role, job_title, matricula, reports_to_id, hired_at, active)
           select id, $1, team_id, subteam_id, name, role, job_title, matricula, reports_to_id, hired_at, true
           from unnest($2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::text[], $7::text[], $8::text[], $9::uuid[], $10::date[])
             as t(id, team_id, subteam_id, name, role, job_title, matricula, reports_to_id, hired_at)
           on conflict (id) do update set
             team_id = excluded.team_id, subteam_id = excluded.subteam_id, name = excluded.name, role = excluded.role,
             job_title = excluded.job_title, matricula = excluded.matricula, reports_to_id = excluded.reports_to_id,
             hired_at = excluded.hired_at, active = true`,
          [
            DEMO_ORGANIZATION_ID,
            batch.map((person) => person.id),
            batch.map((person) => (person.teamKey ? structure.teamByKey.get(person.teamKey)!.id : null)),
            batch.map((person) => (person.subteamKey ? structure.subteamByKey.get(person.subteamKey)!.id : null)),
            batch.map((person) => person.name),
            batch.map((person) => person.role),
            batch.map((person) => person.jobTitle),
            batch.map((person) => person.matricula),
            batch.map((person) => (person.reportsToKey ? structure.byKey.get(person.reportsToKey)!.id : null)),
            batch.map((person) => person.hiredAt),
          ],
        )
      }
    }
  })
}

/** Contas de acesso — o hash bcrypt vem de fora (mesmo `hashPassword` do cadastro real) e só é gravado na criação. */
export async function persistUserAccounts(client: Client, mass: DemoMass, passwordHash: string): Promise<void> {
  await transaction(client, async () => {
    for (const batch of chunks(mass.structure.people.filter((person) => !person.adopted), BATCH)) {
      await client.query(
        `insert into user_accounts (id, organization_id, person_id, email, password_hash, active)
         select id, $1, person_id, email, $2, true from unnest($3::uuid[], $4::uuid[], $5::text[]) as t(id, person_id, email)
         on conflict (person_id) do update set email = excluded.email, active = true, updated_at = now()`,
        [DEMO_ORGANIZATION_ID, passwordHash, batch.map((person) => demoId(`user:${person.key}`)), batch.map((person) => person.id), batch.map((person) => person.email)],
      )
    }
    // Adotados: a conta que já existe (e-mail próprio) é preservada; quem não tinha login ganha um `.demo`. A senha só é
    // definida em conta que nunca entrou: as contas das migrations nascem com senha aleatória e passam a usar a senha demo.
    const adopted = mass.structure.people.filter((person) => person.adopted)
    if (adopted.length > 0) {
      await client.query(
        `insert into user_accounts (id, organization_id, person_id, email, password_hash, active)
         select id, $1, person_id, email, $2, true from unnest($3::uuid[], $4::uuid[], $5::text[]) as t(id, person_id, email)
         on conflict (person_id) do update set active = true, updated_at = now(),
           password_hash = case when user_accounts.last_login_at is null then excluded.password_hash else user_accounts.password_hash end`,
        [DEMO_ORGANIZATION_ID, passwordHash, adopted.map((person) => demoId(`user:${person.key}`)), adopted.map((person) => person.id), adopted.map((person) => person.email)],
      )
    }
    const operators = mass.structure.people.filter((person) => person.role === "OPERATOR" && !person.adopted)
    for (const batch of chunks(operators, BATCH)) {
      await client.query(
        `insert into employee_work_shifts (id, organization_id, person_id, start_time, work_minutes, effective_from)
         select id, $1, person_id, start_time::time, work_minutes, effective_from::date
         from unnest($2::uuid[], $3::uuid[], $4::text[], $5::int[], $6::text[]) as t(id, person_id, start_time, work_minutes, effective_from)
         on conflict (id) do update set start_time = excluded.start_time, work_minutes = excluded.work_minutes, updated_at = now()`,
        [
          DEMO_ORGANIZATION_ID,
          batch.map((person) => demoId(`shift:${person.key}`)),
          batch.map((person) => person.id),
          batch.map((person) => shiftFor(person).startTime),
          batch.map((person) => shiftFor(person).workMinutes),
          batch.map((person) => person.hiredAt),
        ],
      )
    }
    // Adotados: jornada só pra quem não tem nenhuma (as legadas vêm da migration 042 e ficam).
    for (const person of mass.structure.people.filter((candidate) => candidate.role === "OPERATOR" && candidate.adopted)) {
      await client.query(
        `insert into employee_work_shifts (id, organization_id, person_id, start_time, work_minutes, effective_from)
         select $1, $2, $3, $4::time, $5, $6::date where not exists (select 1 from employee_work_shifts where person_id = $3)`,
        [demoId(`shift:${person.key}`), DEMO_ORGANIZATION_ID, person.id, shiftFor(person).startTime, shiftFor(person).workMinutes, person.hiredAt],
      )
    }
  })
}

export type OfficialPersistReport = { indicatorRowsInserted: number; indicatorRowsKept: number; prvRowsInserted: number; prvRowsKept: number }

/**
 * FECHAMENTO OFICIAL = SNAPSHOT AS-SUPPLIED. Metas são configuração (upsert); fechamentos de indicador
 * e PRV são INSERT-ONLY: uma (pessoa, indicador, competência) / (pessoa, competência) que já existe no
 * banco — venha do seed SQL, de ingestão, de QA ou de uma carga anterior desta massa — NUNCA é reescrita
 * por nova carga, mudança de gerador ou mudança de estrutura. "Criar snapshot novo" (competência que
 * ainda não existia) é a única escrita; "mutar snapshot antigo" não existe aqui. Para regerar de
 * verdade: `db:seed:demo:reset` + seed. (A coorte do quartil e o catálogo de cada competência vêm da
 * posição VIGENTE nela — `placementAt` — então nem a geração muda com a estrutura atual.)
 */
export async function persistPerformance(client: Client, mass: DemoMass): Promise<OfficialPersistReport> {
  const { goals, indicatorRows, prvRows } = mass.performance
  const report: OfficialPersistReport = { indicatorRowsInserted: 0, indicatorRowsKept: 0, prvRowsInserted: 0, prvRowsKept: 0 }
  await transaction(client, async () => {
    await client.query(
      `insert into goals (id, organization_id, indicator_definition_id, subject_type, subject_id, target_value, valid_from, valid_until)
       select id, $1, indicator_definition_id, subject_type, subject_id, target_value, valid_from::date, valid_until::date
       from unnest($2::uuid[], $3::uuid[], $4::text[], $5::uuid[], $6::numeric[], $7::text[], $8::text[]) as t(id, indicator_definition_id, subject_type, subject_id, target_value, valid_from, valid_until)
       on conflict (id) do update set target_value = excluded.target_value, valid_from = excluded.valid_from, valid_until = excluded.valid_until`,
      [DEMO_ORGANIZATION_ID, goals.map((g) => g.id), goals.map((g) => g.indicatorDefinitionId), goals.map((g) => g.subjectType), goals.map((g) => g.subjectId), goals.map((g) => g.targetValue), goals.map((g) => g.validFrom), goals.map((g) => g.validUntil)],
    )
  })
  for (const batch of chunks(indicatorRows, BATCH)) {
    await transaction(client, async () => {
      const inserted = await client.query(
        `insert into employee_indicator_performance (id, organization_id, person_id, indicator_definition_id, subteam_id, reference_period, value, target_value, achievement_percent, weight_percent, quartile, source)
         select id, $1, person_id, indicator_definition_id, subteam_id, reference_period, value, target_value, achievement_percent, weight_percent, quartile, $2
         from unnest($3::uuid[], $4::uuid[], $5::uuid[], $6::uuid[], $7::text[], $8::numeric[], $9::numeric[], $10::numeric[], $11::numeric[], $12::text[])
           as t(id, person_id, indicator_definition_id, subteam_id, reference_period, value, target_value, achievement_percent, weight_percent, quartile)
         on conflict (organization_id, person_id, indicator_definition_id, reference_period) do nothing`,
        [
          DEMO_ORGANIZATION_ID, DEMO_SOURCE,
          batch.map((r) => r.id), batch.map((r) => r.personId), batch.map((r) => r.indicatorDefinitionId), batch.map((r) => r.subteamId), batch.map((r) => r.referencePeriod),
          batch.map((r) => r.value), batch.map((r) => r.targetValue), batch.map((r) => r.achievementPercent), batch.map((r) => r.weightPercent), batch.map((r) => r.quartile),
        ],
      )
      report.indicatorRowsInserted += inserted.rowCount ?? 0
      report.indicatorRowsKept += batch.length - (inserted.rowCount ?? 0)
    })
  }
  for (const batch of chunks(prvRows, BATCH)) {
    await transaction(client, async () => {
      const inserted = await client.query(
        `insert into employee_prv_performance (id, organization_id, person_id, subteam_id, reference_period, achievement_percent, quartile, source)
         select id, $1, person_id, subteam_id, reference_period, achievement_percent, quartile, $2
         from unnest($3::uuid[], $4::uuid[], $5::uuid[], $6::text[], $7::numeric[], $8::text[]) as t(id, person_id, subteam_id, reference_period, achievement_percent, quartile)
         on conflict (organization_id, person_id, reference_period) do nothing`,
        [DEMO_ORGANIZATION_ID, DEMO_SOURCE, batch.map((r) => r.id), batch.map((r) => r.personId), batch.map((r) => r.subteamId), batch.map((r) => r.referencePeriod), batch.map((r) => r.achievementPercent), batch.map((r) => r.quartile)],
      )
      report.prvRowsInserted += inserted.rowCount ?? 0
      report.prvRowsKept += batch.length - (inserted.rowCount ?? 0)
    })
  }
  return report
}

export type DailyPersistStats = { rows: number; operators: number }

/**
 * Medições operacionais DIÁRIAS (camada 1) — geradas por operador sob demanda e gravadas em
 * lotes de `BATCH` linhas via unnest. Antes, remove qualquer medição MENSAL DEMO_SEED do
 * operador (espelho do fechamento usado até esta evolução): a camada operacional é diária; o
 * mensal oficial continua em employee_indicator_performance, intocado.
 */
export async function persistDailyMeasurements(client: Client, mass: DemoMass, operatorsPerBatch = 50, onProgress?: (done: number, total: number) => void): Promise<DailyPersistStats> {
  const operators = mass.structure.people.filter((person: DemoPerson) => person.role === "OPERATOR")
  // Adotados vão num lote próprio: a massa NÃO gera medição num dia × indicador em que o
  // operador já tem medição de outra fonte (chamada real, QA, seed antigo) — o dado existente vale.
  const batches = [...chunks(operators.filter((operator) => !operator.adopted), operatorsPerBatch), ...chunks(operators.filter((operator) => operator.adopted), operatorsPerBatch)]
  let done = 0
  let rowsPersisted = 0
  for (const batch of batches) {
    const rows = batch.flatMap((operator) => mass.dailyMeasurementsOf(operator))
    const onlyWhereEmpty = batch.some((operator) => operator.adopted)
    await transaction(client, async () => {
      await client.query(`delete from indicator_measurements where subject_type = 'PERSON' and subject_id = any($1::uuid[]) and source = $2 and granularity = 'MONTHLY'`, [batch.map((operator) => operator.id), DEMO_SOURCE])
      for (const part of chunks(rows, 5000)) {
        await client.query(
          // Auditoria de storage (hardening, Parte G): o heap de indicator_measurements cresceu por
          // churn de upsert — cada reseed reescrevia 1,1 M linhas idênticas (tupla morta + 4 índices).
          // O `where ... is distinct from` faz o UPDATE só quando algo mudou de fato: reseed
          // idempotente = zero escrita, zero bloat. Nenhum índice criado ou removido.
          `insert into indicator_measurements as m (id, organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity, numerator, denominator, sample_count)
           select id, $1, indicator_definition_id, 'PERSON', person_id, value, period_start::timestamptz, period_end::timestamptz, $2, 'DAILY', numerator, denominator, sample_count
           from unnest($3::uuid[], $4::uuid[], $5::uuid[], $6::numeric[], $7::text[], $8::text[], $9::numeric[], $10::numeric[], $11::int[]) as t(id, indicator_definition_id, person_id, value, period_start, period_end, numerator, denominator, sample_count)
           ${onlyWhereEmpty ? `where not exists (select 1 from indicator_measurements x where x.organization_id = $1 and x.subject_type = 'PERSON' and x.subject_id = t.person_id and x.indicator_definition_id = t.indicator_definition_id and x.source <> $2 and x.period_start < t.period_end::timestamptz and x.period_end > t.period_start::timestamptz)` : ""}
           on conflict (organization_id, indicator_definition_id, subject_type, subject_id, period_start, period_end, source) do update set
             value = excluded.value, granularity = excluded.granularity, numerator = excluded.numerator, denominator = excluded.denominator, sample_count = excluded.sample_count
           where (m.value, m.granularity, m.numerator, m.denominator, m.sample_count) is distinct from (excluded.value, excluded.granularity, excluded.numerator, excluded.denominator, excluded.sample_count)`,
          [DEMO_ORGANIZATION_ID, DEMO_SOURCE, part.map((r) => r.id), part.map((r) => r.indicatorDefinitionId), part.map((r) => r.personId), part.map((r) => r.value), part.map((r) => r.periodStart), part.map((r) => r.periodEnd), part.map((r) => r.numerator), part.map((r) => r.denominator), part.map((r) => r.sampleCount)],
        )
      }
    })
    rowsPersisted += rows.length
    done += batch.length
    onProgress?.(done, operators.length)
  }
  return { rows: rowsPersisted, operators: operators.length }
}


/** Interações + transcrições + flags, operador a operador em lotes de `operatorsPerBatch` (geração sob demanda). */
export async function persistInteractions(client: Client, mass: DemoMass, flagIds: Map<string, string>, operatorsPerBatch = 100, onProgress?: (done: number, total: number) => void): Promise<void> {
  const operators = mass.structure.people.filter((person: DemoPerson) => person.role === "OPERATOR")
  let done = 0
  for (const batch of chunks(operators, operatorsPerBatch)) {
    const rows = batch.flatMap((operator) => mass.interactionsOf(operator))
    await transaction(client, async () => {
      await client.query(
        `insert into interactions (id, organization_id, operator_id, reason, channel, started_at, ended_at, external_id)
         select id, $1, operator_id, reason, channel, started_at::timestamptz, ended_at::timestamptz, external_id
         from unnest($2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]) as t(id, operator_id, reason, channel, started_at, ended_at, external_id)
         on conflict (id) do update set operator_id = excluded.operator_id, reason = excluded.reason, channel = excluded.channel, started_at = excluded.started_at, ended_at = excluded.ended_at, external_id = excluded.external_id`,
        [DEMO_ORGANIZATION_ID, rows.map((r) => r.id), rows.map((r) => r.operatorId), rows.map((r) => r.reason), rows.map((r) => r.channel), rows.map((r) => r.startedAt), rows.map((r) => r.endedAt), rows.map((r) => r.externalId)],
      )
      for (const part of chunks(rows, 250)) {
        await client.query(
          `insert into transcripts (id, organization_id, interaction_id, version, content, language, confidence)
           select id, $1, interaction_id, 1, content, 'pt-BR', confidence
           from unnest($2::uuid[], $3::uuid[], $4::text[], $5::numeric[]) as t(id, interaction_id, content, confidence)
           on conflict (interaction_id, version) do update set content = excluded.content, confidence = excluded.confidence`,
          [DEMO_ORGANIZATION_ID, part.map((r) => demoId(`transcript:${r.externalId}`)), part.map((r) => r.id), part.map((r) => r.transcript.content), part.map((r) => r.transcript.confidence)],
        )
      }
      const flagRows = rows.flatMap((row) =>
        Object.entries(row.flags).map(([name, value]) => {
          const channelFlagId = flagIds.get(name)
          if (!channelFlagId) throw new Error(`Flag "${name}" não está no catálogo do canal ${DEMO_CHANNEL}`)
          return { id: demoId(`flag:${row.externalId}:${name}`), interactionId: row.id, channelFlagId, receivedAt: row.endedAt, valueBoolean: typeof value === "boolean" ? value : null, valueNumeric: typeof value === "number" ? value : null }
        }),
      )
      // Reprocessar substitui as flags da interação (uma flag que deixou de existir no gerador some).
      await client.query(`delete from interaction_flags where interaction_id = any($1::uuid[])`, [rows.map((r) => r.id)])
      for (const part of chunks(flagRows, BATCH)) {
        await client.query(
          `insert into interaction_flags (id, organization_id, interaction_id, channel_flag_id, value_boolean, value_numeric, received_at)
           select id, $1, interaction_id, channel_flag_id, value_boolean, value_numeric, received_at::timestamptz
           from unnest($2::uuid[], $3::uuid[], $4::uuid[], $5::boolean[], $6::numeric[], $7::text[]) as t(id, interaction_id, channel_flag_id, value_boolean, value_numeric, received_at)
           on conflict (interaction_id, channel_flag_id) do update set value_boolean = excluded.value_boolean, value_numeric = excluded.value_numeric, received_at = excluded.received_at`,
          [DEMO_ORGANIZATION_ID, part.map((r) => r.id), part.map((r) => r.interactionId), part.map((r) => r.channelFlagId), part.map((r) => r.valueBoolean), part.map((r) => r.valueNumeric), part.map((r) => r.receivedAt)],
        )
      }
    })
    done += batch.length
    onProgress?.(done, operators.length)
  }
}

/** Relatório contado NO BANCO após a carga — nunca números hardcoded. */
export async function reportDemoMass(client: Client, mass: DemoMass): Promise<PersistReport> {
  const personIds = mass.structure.people.map((person) => person.id)
  const operatorIds = mass.structure.people.filter((person) => person.role === "OPERATOR").map((person) => person.id)
  const one = async <T extends pg.QueryResultRow>(sql: string, params: unknown[]): Promise<T> => (await client.query<T>(sql, params)).rows[0]!
  const people = await client.query<{ role: string; count: string }>(`select role, count(*)::text from people where id = any($1::uuid[]) group by role`, [personIds])
  const users = await one<{ count: string }>(`select count(*)::text from user_accounts where person_id = any($1::uuid[])`, [personIds])
  const teams = await one<{ count: string }>(`select count(*)::text from teams where id = any($1::uuid[])`, [mass.structure.teams.map((team) => team.id)])
  const subteams = await one<{ count: string }>(`select count(*)::text from subteams where id = any($1::uuid[])`, [mass.structure.subteams.map((subteam) => subteam.id)])
  const operations = await one<{ count: string }>(`select count(*)::text from operations where id = any($1::uuid[])`, [mass.structure.operations.map((operation) => operation.id)])
  const goals = await one<{ count: string }>(`select count(*)::text from goals where id = any($1::uuid[])`, [mass.performance.goals.map((goal) => goal.id)])
  const shifts = await one<{ count: string }>(`select count(*)::text from employee_work_shifts where person_id = any($1::uuid[])`, [operatorIds])
  const perf = await one<{ count: string; periods: string }>(`select count(*)::text, count(distinct reference_period)::text periods from employee_indicator_performance where person_id = any($1::uuid[]) and source = $2`, [operatorIds, DEMO_SOURCE])
  const prv = await one<{ count: string }>(`select count(*)::text from employee_prv_performance where person_id = any($1::uuid[]) and source = $2`, [operatorIds, DEMO_SOURCE])
  const measurements = await one<{ count: string; first_day: string | null; last_day: string | null; days: string }>(
    `select count(*)::text, min(period_start)::date::text first_day, max(period_start)::date::text last_day, count(distinct period_start::date)::text days
     from indicator_measurements where subject_type = 'PERSON' and subject_id = any($1::uuid[]) and source = $2 and granularity = 'DAILY'`,
    [operatorIds, DEMO_SOURCE],
  )
  const measurementsByIndicator = await client.query<{ code: string; count: string }>(
    `select i.code, count(*)::text from indicator_measurements m join indicator_definitions i on i.id = m.indicator_definition_id
     where m.subject_type = 'PERSON' and m.subject_id = any($1::uuid[]) and m.source = $2 and m.granularity = 'DAILY' group by i.code order by 1`,
    [operatorIds, DEMO_SOURCE],
  )
  const interactions = await one<{ count: string; flagged: string; bytes: string; canonical: string }>(
    `select count(*)::text, count(*) filter (where exists (select 1 from interaction_flags f where f.interaction_id = i.id))::text flagged,
            coalesce(sum(octet_length(t.content)), 0)::text bytes, count(*) filter (where i.external_id like 'DEMO-QA-INTERACTION-%')::text canonical
     from interactions i left join transcripts t on t.interaction_id = i.id
     where i.operator_id = any($1::uuid[]) and i.external_id like 'DEMO-%'`,
    [operatorIds],
  )
  const byLength = await client.query<{ bucket: string; count: string }>(
    `select case when extract(epoch from (ended_at - started_at)) <= 360 then 'CURTA (≤6 min)' when extract(epoch from (ended_at - started_at)) <= 840 then 'MEDIA (6–14 min)' else 'LONGA (>14 min)' end bucket, count(*)::text
     from interactions where operator_id = any($1::uuid[]) and external_id like 'DEMO-%' group by 1`,
    [operatorIds],
  )
  const flags = await client.query<{ flag_name: string; count: string }>(
    `select cf.flag_name, count(*)::text from interaction_flags f join channel_flags cf on cf.id = f.channel_flag_id join interactions i on i.id = f.interaction_id
     where i.operator_id = any($1::uuid[]) and i.external_id like 'DEMO-%' group by cf.flag_name order by 1`,
    [operatorIds],
  )
  const diagnosticCalls = await reportDiagnosticCalls(client, mass.diagnosticCalls)
  const diagnosticSubteam = mass.structure.subteamByKey.get(subteamKey(DIAGNOSTIC_SUBGROUP.teamKey, DIAGNOSTIC_SUBGROUP.name))
  const diagnosticSubgroup = await one<{ operators: string; interactions: string; transcripts: string }>(
    `select count(distinct p.id)::text operators, count(distinct i.id)::text interactions, count(distinct t.interaction_id)::text transcripts
     from people p left join interactions i on i.operator_id = p.id left join transcripts t on t.interaction_id = i.id
     where p.subteam_id = $1 and p.role = 'OPERATOR' and p.active`,
    [diagnosticSubteam?.id ?? null],
  )
  return {
    diagnosticCalls,
    diagnosticSubgroup: { operators: Number(diagnosticSubgroup.operators), interactions: Number(diagnosticSubgroup.interactions), transcripts: Number(diagnosticSubgroup.transcripts) },
    people: Object.fromEntries(people.rows.map((row) => [row.role, Number(row.count)])),
    users: Number(users.count),
    operations: Number(operations.count),
    teams: Number(teams.count),
    subteams: Number(subteams.count),
    goals: Number(goals.count),
    workShifts: Number(shifts.count),
    periods: Number(perf.periods),
    indicatorPerformanceRows: Number(perf.count),
    prvRows: Number(prv.count),
    dailyMeasurements: Number(measurements.count),
    dailyFirstDay: measurements.first_day,
    dailyLastDay: measurements.last_day,
    dailyDaysWithData: Number(measurements.days),
    dailyByIndicator: Object.fromEntries(measurementsByIndicator.rows.map((row) => [row.code, Number(row.count)])),
    interactions: Number(interactions.count),
    interactionsFlagged: Number(interactions.flagged),
    interactionsByLength: Object.fromEntries(byLength.rows.map((row) => [row.bucket, Number(row.count)])),
    flagRows: flags.rows.reduce((sum, row) => sum + Number(row.count), 0),
    flagsByName: Object.fromEntries(flags.rows.map((row) => [row.flag_name, Number(row.count)])),
    transcriptBytes: Number(interactions.bytes),
    canonicalInteractions: Number(interactions.canonical),
  }
}

