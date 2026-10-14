import type pg from "pg"
import type { Database } from "../../../infrastructure/database/pool.js"
import { resolveWindowComponentsBySubject, type ComponentWindow, type WindowComponentRow } from "../../indicators/application/operational-window-components.js"
import type { MeasurementWindowRow, WindowEligibilityFacts } from "../../indicators/application/operational-measurement-resolver.js"
import { localDateOf, localDatesInWindow, resolvePreviousTimeWindow, resolveTimeWindow, type TimeWindow } from "../../workflows/application/time-window.js"
import { OPERATIONAL_COMPARISONS, operationalComparisonPeriod, type OperationalComparison } from "../domain/operational-comparison.js"

/**
 * READ MODEL OPERACIONAL do analytics da liderança (migration 136; docs/dev/escala-read-model-e-ciclo-de-vida.md, A4).
 *
 * Grão: pessoa × comparação da tela × fase (atual/anterior) — as 10 janelas que a área de Indicadores oferece. Guarda os
 * COMPONENTES BRUTOS que o resolvedor único calcula (`resolveWindowComponentsBySubject`), nunca um número final: a leitura
 * aplica `finishWindow`/`finishWindowBySubject`/`combineWindowComponents`, e somar componentes de pessoas é exato em
 * `numeric` (Σ numerador, Σ denominador, Σ valor ÷ contagem = a mesma divisão do `avg()`, mín. dos mínimos, último valor
 * por `period_end` e `id`). Este arquivo só decide o CUSTO; o número continua sendo o do caminho original.
 */
export type ReadModelPhase = "CURRENT" | "PREVIOUS"
export type ReadModelWindow = ComponentWindow & { comparison: OperationalComparison; phase: ReadModelPhase }

const windowKey = (comparison: OperationalComparison, phase: ReadModelPhase) => `${comparison}:${phase}`

/** As 10 janelas da tela no instante `now` — as mesmas funções que a área de Indicadores usa (time-window.ts). */
export function readModelWindows(now: Date, timeZone: string, comparisons: readonly OperationalComparison[] = OPERATIONAL_COMPARISONS): ReadModelWindow[] {
  return comparisons.flatMap((comparison) => {
    const period = operationalComparisonPeriod(comparison)
    return [
      { key: windowKey(comparison, "CURRENT"), comparison, phase: "CURRENT" as const, window: resolveTimeWindow(period, now, timeZone) },
      { key: windowKey(comparison, "PREVIOUS"), comparison, phase: "PREVIOUS" as const, window: resolvePreviousTimeWindow(period, now, timeZone) },
    ]
  })
}

/** Indicadores com card operacional (os de `loadDailyDefinitions` em operational-trend.ts). */
export async function loadReadModelIndicatorCodes(db: Pick<Database, "query">, organizationId: string): Promise<string[]> {
  const result = await db.query<{ code: string }>(`select code from indicator_definitions where organization_id = $1 and active and daily_supported order by code`, [organizationId])
  return result.rows.map((row) => row.code)
}

function dateBounds(window: TimeWindow, timeZone: string): { first: string | null; last: string | null } {
  const dates = localDatesInWindow(window, timeZone)
  return { first: dates[0] ?? null, last: dates[dates.length - 1] ?? null }
}

const INDICATOR_COLUMNS = [
  "avg_value",
  "min_value",
  "max_value",
  "sample_count",
  "sum_value",
  "latest_value",
  "latest_period_end",
  "latest_id",
  "weighted_sum",
  "weight_total",
  "numerator_sum",
  "denominator_sum",
  "rows_with_components",
  "sample_total",
  "days_with_data",
  "ignored_count",
  "absence_days_with_data",
] as const
const INDICATOR_TYPES: Record<(typeof INDICATOR_COLUMNS)[number], string> = {
  avg_value: "numeric",
  min_value: "numeric",
  max_value: "numeric",
  sample_count: "integer",
  sum_value: "numeric",
  latest_value: "numeric",
  latest_period_end: "timestamptz",
  latest_id: "uuid",
  weighted_sum: "numeric",
  weight_total: "numeric",
  numerator_sum: "numeric",
  denominator_sum: "numeric",
  rows_with_components: "integer",
  sample_total: "integer",
  days_with_data: "integer",
  ignored_count: "integer",
  absence_days_with_data: "integer",
}

function isPool(db: Database): db is Database & pg.Pool {
  return typeof (db as Partial<pg.Pool>).totalCount === "number"
}

const textOf = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))

/**
 * Recalcula da FONTE as 10 janelas de um lote de pessoas e substitui as linhas delas numa transação — idempotente: rodar
 * de novo sobre os mesmos dados grava as mesmas linhas.
 */
export async function rebuildMemberWindows(db: Database, input: { organizationId: string; personIds: string[]; now: Date; timeZone: string; indicatorCodes: string[] }): Promise<{ windows: number; indicatorRows: number }> {
  if (input.personIds.length === 0) return { windows: 0, indicatorRows: 0 }
  const windows = readModelWindows(input.now, input.timeZone)
  const components = await resolveWindowComponentsBySubject(db, { subjectIds: input.personIds, windows, indicatorCodes: input.indicatorCodes, timeZone: input.timeZone, now: input.now })
  // A janela atual termina em "agora": a primeira medição de cada pessoa que começa a partir daqui (ainda hoje) passa a
  // entrar no caminho original quando o relógio a alcançar — a linha vale até lá.
  const validUntil = await db.query<{ subject_id: string; valid_until: string }>(
    `select subject_id, min(period_start)::text valid_until from indicator_measurements
      where subject_type = 'PERSON' and subject_id = any($1::uuid[]) and period_start >= $2::timestamptz and period_start < (($3::date + 1)::timestamp at time zone $4)
      group by subject_id`,
    [input.personIds, input.now.toISOString(), localDateOf(input.now, input.timeZone), input.timeZone],
  )
  const validUntilBy = new Map(validUntil.rows.map((row) => [row.subject_id, row.valid_until]))

  const facts = { person: [] as string[], comparison: [] as string[], phase: [] as string[], first: [] as (string | null)[], last: [] as (string | null)[], eligible: [] as number[], absence: [] as number[], validUntil: [] as (string | null)[] }
  const byKey = new Map(windows.map((entry) => [entry.key, entry]))
  for (const entry of windows) {
    const bounds = dateBounds(entry.window, input.timeZone)
    for (const personId of input.personIds) {
      const eligibility = components.eligibility.get(entry.key)?.get(personId) ?? { eligibleDays: 0, unjustifiedAbsenceDays: 0 }
      facts.person.push(personId)
      facts.comparison.push(entry.comparison)
      facts.phase.push(entry.phase)
      facts.first.push(bounds.first)
      facts.last.push(bounds.last)
      facts.eligible.push(eligibility.eligibleDays)
      facts.absence.push(eligibility.unjustifiedAbsenceDays)
      facts.validUntil.push(entry.phase === "CURRENT" ? (validUntilBy.get(personId) ?? null) : null)
    }
  }
  const rows = { person: [] as string[], comparison: [] as string[], phase: [] as string[], code: [] as string[], columns: Object.fromEntries(INDICATOR_COLUMNS.map((column) => [column, [] as (string | null)[]])) as Record<(typeof INDICATOR_COLUMNS)[number], (string | null)[]> }
  for (const row of components.rows) {
    const entry = byKey.get(row.window_key)!
    rows.person.push(row.subject_id)
    rows.comparison.push(entry.comparison)
    rows.phase.push(entry.phase)
    rows.code.push(row.indicator_code)
    for (const column of INDICATOR_COLUMNS) rows.columns[column].push(textOf((row as Record<string, unknown>)[column]))
  }

  // Com o pool, uma transação própria; com um cliente (prova dentro de transação), a transação de quem chamou.
  const owned = isPool(db)
  const client = owned ? await db.connect() : (db as unknown as pg.PoolClient)
  try {
    if (owned) await client.query("begin")
    await client.query(`delete from analytics_member_window_indicator where organization_id = $1 and person_id = any($2::uuid[])`, [input.organizationId, input.personIds])
    await client.query(`delete from analytics_member_window where organization_id = $1 and person_id = any($2::uuid[])`, [input.organizationId, input.personIds])
    await client.query(
      `insert into analytics_member_window (organization_id, person_id, comparison, phase, first_date, last_date, eligible_days, unjustified_absence_days, valid_until, built_at)
       select $1, person_id, comparison, phase, first_date, last_date, eligible_days, unjustified_absence_days, valid_until, $10
         from unnest($2::uuid[], $3::text[], $4::text[], $5::date[], $6::date[], $7::int[], $8::int[], $9::timestamptz[]) f(person_id, comparison, phase, first_date, last_date, eligible_days, unjustified_absence_days, valid_until)
        where first_date is not null`,
      [input.organizationId, facts.person, facts.comparison, facts.phase, facts.first, facts.last, facts.eligible, facts.absence, facts.validUntil, input.now.toISOString()],
    )
    if (rows.person.length > 0) {
      const columnParams = INDICATOR_COLUMNS.map((column, index) => `$${index + 6}::${INDICATOR_TYPES[column]}[]`)
      await client.query(
        `insert into analytics_member_window_indicator (organization_id, person_id, comparison, phase, indicator_code, ${INDICATOR_COLUMNS.join(", ")})
         select $1, * from unnest($2::uuid[], $3::text[], $4::text[], $5::text[], ${columnParams.join(", ")})`,
        [input.organizationId, rows.person, rows.comparison, rows.phase, rows.code, ...INDICATOR_COLUMNS.map((column) => rows.columns[column])],
      )
    }
    if (owned) await client.query("commit")
  } catch (error) {
    if (owned) await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    if (owned) client.release()
  }
  return { windows: facts.person.length, indicatorRows: rows.person.length }
}

/** Remove as linhas de quem não é mais membro possível (inativo, outro cargo, apagado). */
export async function deleteMemberWindows(db: Pick<Database, "query">, organizationId: string, personIds: string[]): Promise<void> {
  if (personIds.length === 0) return
  await db.query(`delete from analytics_member_window_indicator where organization_id = $1 and person_id = any($2::uuid[])`, [organizationId, personIds])
  await db.query(`delete from analytics_member_window where organization_id = $1 and person_id = any($2::uuid[])`, [organizationId, personIds])
}

// ---------------------------------------------------------------------------------------------------------------------
// LEITURA
// ---------------------------------------------------------------------------------------------------------------------

export type StructureReadModelWindows = {
  /** Fatos de elegibilidade da janela ATUAL por membro (todos os membros). */
  eligibility: Map<string, WindowEligibilityFacts>
  /** Componentes da estrutura inteira (soma dos membros) por fase × indicador. */
  pooled: Record<ReadModelPhase, Map<string, MeasurementWindowRow>>
  /** Componentes por membro na janela ATUAL, por indicador. */
  currentByMember: Map<string, MeasurementWindowRow[]>
  /** Membros calculados na hora pelo caminho original (marca pendente, linha ausente ou vencida). */
  liveMembers: number
  /** Geração do read model lida no mesmo snapshot. */
  generation: string
  /** Até quando (ms) as linhas lidas valem — a primeira medição de um membro que começa depois do cálculo; null = o dia todo. */
  validUntilMs: number | null
}

/** Acima disto, o caminho original para a estrutura inteira sai mais barato que misturar. */
const MAX_LIVE_SHARE = 0.5

/**
 * Lê as janelas de uma estrutura do read model, num ÚNICO snapshot (REPEATABLE READ somente leitura) quando recebe o pool:
 * linhas, marcas pendentes e o cálculo na hora de quem estiver pendente enxergam o mesmo banco. Devolve `null` quando a
 * organização inteira está marcada ou quando mais da metade dos membros teria de ser calculada na hora — quem chama usa o
 * caminho original.
 */
export async function readStructureWindows(
  db: Database,
  input: { organizationId: string; personIds: string[]; comparison: OperationalComparison; window: TimeWindow; previousWindow: TimeWindow; now: Date; timeZone: string; indicatorCodes: string[] },
): Promise<StructureReadModelWindows | null> {
  if (!isPool(db)) return readStructureWindowsWith(db, input)
  const client = await db.connect()
  try {
    await client.query("begin isolation level repeatable read read only")
    const result = await readStructureWindowsWith(client as unknown as Database, input)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function readStructureWindowsWith(
  db: Database,
  input: { organizationId: string; personIds: string[]; comparison: OperationalComparison; window: TimeWindow; previousWindow: TimeWindow; now: Date; timeZone: string; indicatorCodes: string[] },
): Promise<StructureReadModelWindows | null> {
  // Em sequência: com o pool, `db` é UM cliente dentro da transação.
  const marks = await db.query<{ person_id: string | null }>(`select distinct person_id from analytics_operational_dirty where organization_id = $1 and (person_id is null or person_id = any($2::uuid[]))`, [input.organizationId, input.personIds])
  const factRows = await db.query<{ person_id: string; phase: ReadModelPhase; first_date: string; last_date: string; eligible_days: number; unjustified_absence_days: number; valid_until: string | null }>(
    `select person_id, phase, first_date::text, last_date::text, eligible_days, unjustified_absence_days, valid_until::text
       from analytics_member_window where organization_id = $1 and comparison = $2 and person_id = any($3::uuid[])`,
    [input.organizationId, input.comparison, input.personIds],
  )
  const state = await db.query<{ generation: string }>(`select generation::text from analytics_rollup_state where organization_id = $1`, [input.organizationId])
  if (marks.rows.some((row) => row.person_id === null)) return null
  const dirty = new Set(marks.rows.map((row) => row.person_id!))
  const expected: Record<ReadModelPhase, { first: string | null; last: string | null }> = { CURRENT: dateBounds(input.window, input.timeZone), PREVIOUS: dateBounds(input.previousWindow, input.timeZone) }
  const facts = new Map<string, Partial<Record<ReadModelPhase, (typeof factRows.rows)[number]>>>()
  for (const row of factRows.rows) facts.set(row.person_id, { ...facts.get(row.person_id), [row.phase]: row })
  const nowMs = input.now.getTime()
  const fresh: string[] = []
  const live: string[] = []
  for (const personId of input.personIds) {
    const entry = facts.get(personId)
    const usable =
      !dirty.has(personId) &&
      (["CURRENT", "PREVIOUS"] as const).every((phase) => entry?.[phase] && entry[phase]!.first_date === expected[phase].first && entry[phase]!.last_date === expected[phase].last) &&
      (entry!.CURRENT!.valid_until === null || nowMs <= new Date(entry!.CURRENT!.valid_until).getTime())
    if (usable) fresh.push(personId)
    else live.push(personId)
  }
  if (live.length > 0 && live.length > input.personIds.length * MAX_LIVE_SHARE) return null

  const eligibility = new Map<string, WindowEligibilityFacts>()
  let validUntilMs: number | null = null
  for (const personId of fresh) {
    const until = facts.get(personId)!.CURRENT!.valid_until
    if (until !== null) validUntilMs = Math.min(validUntilMs ?? Number.POSITIVE_INFINITY, new Date(until).getTime())
    const current = facts.get(personId)!.CURRENT!
    eligibility.set(personId, { eligibleDays: current.eligible_days, unjustifiedAbsenceDays: current.unjustified_absence_days })
  }
  let liveRows: WindowComponentRow[] = []
  if (live.length > 0) {
    const computed = await resolveWindowComponentsBySubject(db, {
      subjectIds: live,
      windows: [
        { key: "CURRENT", window: input.window },
        { key: "PREVIOUS", window: input.previousWindow },
      ],
      indicatorCodes: input.indicatorCodes,
      timeZone: input.timeZone,
      now: input.now,
    })
    for (const personId of live) eligibility.set(personId, computed.eligibility.get("CURRENT")!.get(personId) ?? { eligibleDays: 0, unjustifiedAbsenceDays: 0 })
    liveRows = computed.rows
  }
  // A ordem dos membros no mapa segue a da estrutura (a mesma do mapa de elegibilidade do caminho original).
  const ordered = new Map(input.personIds.map((personId) => [personId, eligibility.get(personId)!]))

  const liveParams = INDICATOR_COLUMNS.filter((column) => column !== "avg_value" && column !== "days_with_data").map((column) => ({ column, values: liveRows.map((row) => textOf((row as Record<string, unknown>)[column])) }))
  const columnRefs = liveParams.map(({ column }, index) => `$${index + 6}::${INDICATOR_TYPES[column]}[]`)
  const pooled = await db.query<MeasurementWindowRow & { phase: ReadModelPhase; indicator_code: string }>(
      `with stored as (
         select phase, indicator_code, ${liveParams.map(({ column }) => column).join(", ")}
           from analytics_member_window_indicator
          where organization_id = $1 and comparison = $2 and person_id = any($3::uuid[]) and indicator_code = any($5::text[])
       ),
       live as (
         select * from unnest($4::text[], $${liveParams.length + 6}::text[], ${columnRefs.join(", ")}) l(phase, indicator_code, ${liveParams.map(({ column }) => column).join(", ")})
       ),
       all_rows as (select * from stored union all select * from live)
       select phase, indicator_code,
              case when sum(sample_count) > 0 then sum(sum_value) / sum(sample_count)::numeric end avg_value,
              min(min_value) min_value, max(max_value) max_value, coalesce(sum(sample_count), 0)::int sample_count, sum(sum_value) sum_value,
              (array_agg(latest_value order by latest_period_end desc, latest_id desc) filter (where latest_id is not null))[1] latest_value,
              sum(weighted_sum) weighted_sum, sum(weight_total) weight_total, sum(numerator_sum) numerator_sum, sum(denominator_sum) denominator_sum,
              coalesce(sum(rows_with_components), 0)::int rows_with_components, sum(sample_total)::int sample_total,
              coalesce(sum(ignored_count), 0)::int ignored_count, coalesce(sum(absence_days_with_data), 0)::int absence_days_with_data
         from all_rows group by phase, indicator_code`,
      [input.organizationId, input.comparison, fresh, liveRows.map((row) => row.window_key), input.indicatorCodes, ...liveParams.map(({ values }) => values), liveRows.map((row) => row.indicator_code)],
  )
  const members = await db.query<MeasurementWindowRow & { indicator_code: string }>(
      `select person_id subject_id, indicator_code, ${INDICATOR_COLUMNS.filter((column) => column !== "latest_period_end" && column !== "latest_id").join(", ")}
         from analytics_member_window_indicator
        where organization_id = $1 and comparison = $2 and phase = 'CURRENT' and person_id = any($3::uuid[]) and indicator_code = any($4::text[])`,
      [input.organizationId, input.comparison, fresh, input.indicatorCodes],
  )
  const pooledByPhase: Record<ReadModelPhase, Map<string, MeasurementWindowRow>> = { CURRENT: new Map(), PREVIOUS: new Map() }
  for (const row of pooled.rows) pooledByPhase[row.phase].set(row.indicator_code, row)
  const currentByMember = new Map<string, MeasurementWindowRow[]>()
  const pushMember = (code: string, row: MeasurementWindowRow) => {
    const list = currentByMember.get(code) ?? []
    list.push(row)
    currentByMember.set(code, list)
  }
  for (const row of members.rows) pushMember(row.indicator_code, row)
  for (const row of liveRows) if (row.window_key === "CURRENT") pushMember(row.indicator_code, row)
  return { eligibility: ordered, pooled: pooledByPhase, currentByMember, liveMembers: live.length, generation: state.rows[0]?.generation ?? "0", validUntilMs }
}
