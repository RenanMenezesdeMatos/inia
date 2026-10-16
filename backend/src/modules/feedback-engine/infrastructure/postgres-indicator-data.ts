import type { Database } from "../../../infrastructure/database/pool.js"
import { reasonKeySql, subjectKeySql } from "../../interactions/domain/interaction-subject.js"
import { loadIndicatorCanonicalContext } from "../../indicators/application/load-indicator-canonical-context.js"
import { resolveOfficialClosure } from "../../indicators/application/official-closure.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import type { Direction, OfficialFacts } from "../domain/indicator-investigation.js"
import type { SliceFilter } from "../domain/investigation-slices.js"
import type { SignalCondition } from "../../indicator-diagnosis/domain/diagnostic-strategy.js"

/**
 * LEITURAS da investigação de indicador (só leitura, escopadas à organização, quantidade FIXA de consultas por recorte —
 * nunca uma por chamada). A MEMÓRIA (avaliações de chamada) não é lida aqui: vem da porta de memória (`currentMemory`), para que
 * banco, RAM e sobreposição enxerguem as mesmas avaliações. Números oficiais vêm prontos das tabelas oficiais; métricas por assunto são DERIVADAS das chamadas
 * (duração registrada, sinal, volume) e sempre rotuladas como tal por quem as usa.
 *
 * Assunto = nível preferencial da `SUBJECT_RESOLUTION_V2` (submotivo; sem submotivo, o motivo); o motivo é o recorte `REASON`.
 */
export const segmentKeySql = (alias: string) => subjectKeySql(alias)
const direction = (value: string): Direction => (value === "LOWER" || value === "TARGET" ? value : "HIGHER")
const monthLabel = (period: string) => {
  const [year, month] = period.split("-")
  const names = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
  return `${names[Number(month) - 1] ?? month}/${year}`
}
const localDate = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/")

export type IndicatorMeta = { id: string; code: string; name: string; unit: string; direction: Direction; dailySupported: boolean }
export type IndicatorDataPort = ReturnType<typeof createPostgresIndicatorData>

/** Sinal da estratégia resolvido no catálogo (`POPULATION_SIGNAL_V2`): ids das flags + a condição de valor (null = flag sim/não). */
export type IndicatorSignal = { flagIds: string[]; condition: SignalCondition | null }
export const NO_SIGNAL: IndicatorSignal = { flagIds: [], condition: null }
const signalParams = (signal: IndicatorSignal): unknown[] => [[...signal.flagIds], signal.condition?.operator ?? null, signal.condition?.value ?? null]
/**
 * Predicado SQL ÚNICO do sinal (três parâmetros ligados a partir de `first`: ids, operador, valor). Sem condição = flag sim/não
 * verdadeira; com condição = valor numérico que a atende. Nenhum valor vira SQL.
 */
function signalPredicateSql(alias: string, first: number): string {
  const [ids, operator, value] = [`$${first}`, `$${first + 1}`, `$${first + 2}`]
  return `exists (select 1 from interaction_flags f where f.interaction_id = ${alias}.id and f.channel_flag_id = any(${ids}::uuid[]) and (case ${operator}::text when 'LTE' then f.value_numeric <= ${value}::numeric when 'LT' then f.value_numeric < ${value}::numeric when 'GTE' then f.value_numeric >= ${value}::numeric when 'GT' then f.value_numeric > ${value}::numeric when 'EQ' then f.value_numeric = ${value}::numeric else f.value_boolean is true end))`
}

export function createPostgresIndicatorData(db: Database) {
  return {
    timeZone: (organizationId: string) => resolveOrganizationTimezone(db, organizationId),

    async indicatorByCode(organizationId: string, code: string): Promise<IndicatorMeta | null> {
      const row = (await db.query<{ id: string; code: string; name: string; unit: string; desired_direction: string; daily_supported: boolean }>(`select id, code, name, unit, desired_direction, daily_supported from indicator_definitions where organization_id = $1 and code = $2`, [organizationId, code])).rows[0]
      return row ? { id: row.id, code: row.code, name: row.name, unit: row.unit, direction: direction(row.desired_direction), dailySupported: row.daily_supported } : null
    },
    async indicatorById(organizationId: string, id: string): Promise<IndicatorMeta | null> {
      const row = (await db.query<{ id: string; code: string; name: string; unit: string; desired_direction: string; daily_supported: boolean }>(`select id, code, name, unit, desired_direction, daily_supported from indicator_definitions where organization_id = $1 and id = $2`, [organizationId, id])).rows[0]
      return row ? { id: row.id, code: row.code, name: row.name, unit: row.unit, direction: direction(row.desired_direction), dailySupported: row.daily_supported } : null
    },

    /** Fato oficial de UMA medição (contexto canônico: valor, meta vigente, dentro/fora pela regra única). */
    async officialFromMeasurement(organizationId: string, measurementId: string, personId: string, now: Date): Promise<OfficialFacts | null> {
      const canonical = await loadIndicatorCanonicalContext(db, { organizationId, measurementId, collaboratorId: personId, now })
      if (!canonical) return null
      return {
        indicatorId: canonical.indicator.id,
        code: canonical.indicator.code,
        name: canonical.indicator.name,
        unit: canonical.indicator.unit,
        direction: canonical.indicator.direction,
        sourceKind: "MEASUREMENT",
        sourceRef: canonical.measurement.id,
        value: canonical.measurement.value,
        target: canonical.target?.value ?? null,
        withinTarget: canonical.withinTarget,
        gapToTarget: canonical.gapToTarget,
        periodStart: canonical.measurement.periodStart,
        periodEnd: canonical.measurement.periodEnd,
        periodLabel: canonical.measurement.periodStart === canonical.measurement.periodEnd ? localDate(canonical.measurement.periodStart) : `${localDate(canonical.measurement.periodStart)} a ${localDate(canonical.measurement.periodEnd)}`,
        referencePeriod: null,
        previous: null,
        movement: null,
        quartile: null,
        previousQuartile: null,
      }
    },

    /** Último fechamento OFICIAL de um indicador (≤ último mês fechado no fuso da organização) + o anterior, como vieram da fonte. */
    async officialFromClosing(organizationId: string, personId: string, indicatorId: string, now: Date, referencePeriod?: string | null): Promise<OfficialFacts | null> {
      const closure = await resolveOfficialClosure(db, organizationId, now)
      const period = referencePeriod ?? (await db.query<{ period: string | null }>(`select max(reference_period) period from employee_indicator_performance where organization_id = $1 and person_id = $2 and indicator_definition_id = $3 and reference_period <= $4`, [organizationId, personId, indicatorId, closure.lastClosedPeriod])).rows[0]?.period ?? null
      if (!period) return null
      const [year, month] = period.split("-").map(Number)
      const previousPeriod = month === 1 ? `${year! - 1}-12` : `${year}-${String(month! - 1).padStart(2, "0")}`
      const rows = (await db.query<{ id: string; reference_period: string; value: string; target_value: string | null; achievement_percent: string | null; quartile: string | null; code: string; name: string; unit: string; desired_direction: string }>(
        `select e.id, e.reference_period, e.value, e.target_value, e.achievement_percent, e.quartile, i.code, i.name, i.unit, i.desired_direction
         from employee_indicator_performance e join indicator_definitions i on i.id = e.indicator_definition_id and i.organization_id = e.organization_id
         where e.organization_id = $1 and e.person_id = $2 and e.indicator_definition_id = $3 and e.reference_period in ($4, $5)`,
        [organizationId, personId, indicatorId, period, previousPeriod],
      )).rows
      const current = rows.find((row) => row.reference_period === period)
      if (!current) return null
      const previous = rows.find((row) => row.reference_period === previousPeriod) ?? null
      const dir = direction(current.desired_direction)
      const value = Number(current.value)
      const target = current.target_value === null ? null : Number(current.target_value)
      const within = (row: typeof current) => (row.achievement_percent !== null ? Number(row.achievement_percent) >= 100 : row.target_value === null ? null : dir === "LOWER" ? Number(row.value) <= Number(row.target_value) : dir === "HIGHER" ? Number(row.value) >= Number(row.target_value) : Number(row.value) === Number(row.target_value))
      const movement = previous && dir !== "TARGET" ? (Math.abs(value - Number(previous.value)) < 1e-9 ? "UNCHANGED" : (dir === "LOWER" ? value < Number(previous.value) : value > Number(previous.value)) ? "IMPROVED" : "WORSENED") : null
      const [py, pm] = period.split("-").map(Number)
      const lastDay = new Date(Date.UTC(py!, pm!, 0)).getUTCDate()
      return {
        indicatorId,
        code: current.code,
        name: current.name,
        unit: current.unit,
        direction: dir,
        sourceKind: "OFFICIAL_CLOSING",
        sourceRef: current.id,
        value,
        target,
        withinTarget: within(current),
        gapToTarget: target !== null && within(current) === false ? Math.abs(value - target) : null,
        periodStart: `${period}-01`,
        periodEnd: `${period}-${String(lastDay).padStart(2, "0")}`,
        periodLabel: monthLabel(period),
        referencePeriod: period,
        previous: previous ? { value: Number(previous.value), periodLabel: monthLabel(previousPeriod), withinTarget: within(previous) } : null,
        movement,
        quartile: current.quartile,
        previousQuartile: previous?.quartile ?? null,
      }
    },

    /** Indicadores do último fechamento do PRV do colaborador (os que têm linha oficial na competência). */
    async closingIndicators(organizationId: string, personId: string, now: Date): Promise<{ referencePeriod: string; indicatorIds: string[] } | null> {
      const closure = await resolveOfficialClosure(db, organizationId, now)
      const period = (await db.query<{ period: string | null }>(`select max(reference_period) period from employee_indicator_performance where organization_id = $1 and person_id = $2 and reference_period <= $3`, [organizationId, personId, closure.lastClosedPeriod])).rows[0]?.period ?? null
      if (!period) return null
      const ids = (await db.query<{ indicator_definition_id: string }>(`select indicator_definition_id from employee_indicator_performance where organization_id = $1 and person_id = $2 and reference_period = $3`, [organizationId, personId, period])).rows.map((row) => row.indicator_definition_id)
      return { referencePeriod: period, indicatorIds: ids }
    },

    async placement(organizationId: string, personId: string): Promise<{ teamId: string | null; subteamId: string | null } | null> {
      const row = (await db.query<{ team_id: string | null; subteam_id: string | null }>(`select team_id, subteam_id from people where id = $1 and organization_id = $2`, [personId, organizationId])).rows[0]
      return row ? { teamId: row.team_id, subteamId: row.subteam_id } : null
    },

    async subjectNames(organizationId: string): Promise<Map<string, string>> {
      return new Map((await db.query<{ code: string; name: string }>(`select code, name from interaction_subject_definitions where organization_id = $1`, [organizationId])).rows.map((row) => [row.code, row.name]))
    },

    /** O sinal da estratégia no catálogo: flag ATIVA do tipo certo (sim/não sem condição; numérica com a condição declarada). */
    async resolveSignal(organizationId: string, signal: { flagName: string; condition: SignalCondition | null }): Promise<IndicatorSignal> {
      const flagIds = (await db.query<{ id: string }>(`select id from channel_flags where organization_id = $1 and flag_name = $2 and active and value_type = $3`, [organizationId, signal.flagName, signal.condition ? "NUMERIC" : "BOOLEAN"])).rows.map((row) => row.id)
      return { flagIds, condition: signal.condition }
    },

    /** Por assunto: chamadas, média da duração registrada e quantas com o sinal (uma consulta). */
    async segmentRows(organizationId: string, personIds: readonly string[], window: { start: Date; end: Date }, signal: IndicatorSignal): Promise<{ personId: string; key: string; n: number; avgDuration: number | null; signaled: number }[]> {
      const rows = (await db.query<{ person_id: string; segment_key: string | null; n: string; avg_duration: string | null; signaled: string }>(
        `select i.operator_id person_id, ${segmentKeySql("i")} segment_key, count(*) n, avg(extract(epoch from i.ended_at - i.started_at)) avg_duration,
                count(*) filter (where ${signalPredicateSql("i", 5)}) signaled
         from interactions i
         where i.organization_id = $1 and i.operator_id = any($2::uuid[]) and i.started_at >= $3 and i.started_at < $4
         group by 1, 2`,
        [organizationId, [...personIds], window.start, window.end, ...signalParams(signal)],
      )).rows
      return rows.filter((row) => row.segment_key !== null).map((row) => ({ personId: row.person_id, key: row.segment_key!, n: Number(row.n), avgDuration: row.avg_duration === null ? null : Number(row.avg_duration), signaled: Number(row.signaled) }))
    },

    /** Série DIÁRIA da medição da pessoa na janela (só existe para indicador com medição diária). */
    /** Medição diária da pessoa; `volume` = soma do denominador do dia (quando o indicador o registra) — base da comparabilidade de um
     * recorte por dia (quantas chamadas gravadas o dia tem frente ao volume que o indicador mediu). */
    async dailyPoints(organizationId: string, indicatorId: string, personId: string, window: { start: Date; end: Date }, timeZone: string): Promise<{ date: string; value: number; volume: number | null }[]> {
      return (await db.query<{ date: string; value: string; volume: string | null }>(
        `select to_char((m.period_start at time zone $5)::date, 'YYYY-MM-DD') date, avg(m.value) value, sum(m.denominator) volume
         from indicator_measurements m
         where m.organization_id = $1 and m.indicator_definition_id = $2 and m.subject_type = 'PERSON' and m.subject_id = $3 and m.period_start >= $4 and m.period_start < $6 and coalesce(m.granularity, 'DAILY') = 'DAILY'
         group by 1 order by 1`,
        [organizationId, indicatorId, personId, window.start, timeZone, window.end],
      )).rows.map((row) => ({ date: row.date, value: Number(row.value), volume: row.volume === null ? null : Number(row.volume) }))
    },

    /**
     * Chamadas da PRÓPRIA pessoa num recorte de investigação (qualquer combinação de assunto, motivo, dia, dia da semana, faixa horária,
     * canal, sinal — datas e horas no fuso da organização), só com transcrição, na janela do período. Uma consulta, parâmetros
     * ligados (nenhum valor vira SQL). Mesma ordem de interesse de `segmentInteractions`.
     */
    async sliceInteractions(organizationId: string, personId: string, window: { start: Date; end: Date }, filters: readonly SliceFilter[], order: "LONGEST" | "SIGNALED" | "TEMPORAL", signal: IndicatorSignal, timeZone: string): Promise<{ id: string; startedAt: Date; durationSeconds: number | null; signaled: boolean }[]> {
      const params: unknown[] = [organizationId, personId, window.start, window.end, timeZone, ...signalParams(signal)]
      const clauses: string[] = []
      for (const filter of filters) {
        params.push(filter.value)
        const value = `$${params.length}`
        if (filter.dimension === "SUBJECT") clauses.push(`${segmentKeySql("i")} = ${value}`)
        else if (filter.dimension === "REASON") clauses.push(`${reasonKeySql("i")} = ${value}`)
        else if (filter.dimension === "DAY") clauses.push(`to_char((i.started_at at time zone $5)::date, 'YYYY-MM-DD') = ${value}`)
        else if (filter.dimension === "DAY_OF_WEEK") clauses.push(`extract(isodow from i.started_at at time zone $5)::int::text = ${value}`)
        else if (filter.dimension === "HOUR") clauses.push(`extract(hour from i.started_at at time zone $5)::int = (${value})::int`)
        else if (filter.dimension === "CHANNEL") clauses.push(`i.channel = ${value}`)
        else clauses.push(`exists (select 1 from interaction_flags f join channel_flags cf on cf.id = f.channel_flag_id where f.interaction_id = i.id and cf.flag_name = ${value} and (f.value_boolean is true or f.value_numeric is not null))`)
      }
      const rows = (await db.query<{ id: string; started_at: Date; duration: string | null; signaled: boolean }>(
        `select i.id, i.started_at, extract(epoch from i.ended_at - i.started_at) duration,
                ${signalPredicateSql("i", 6)} signaled
         from interactions i
         where i.organization_id = $1 and i.operator_id = $2 and i.started_at >= $3 and i.started_at < $4 and $5::text is not null
           ${clauses.map((clause) => `and ${clause}`).join(" ")}
           and exists (select 1 from transcripts t where t.interaction_id = i.id and length(btrim(t.content)) > 0)
         order by i.started_at, i.id`,
        params,
      )).rows.map((row) => ({ id: row.id, startedAt: new Date(row.started_at), durationSeconds: row.duration === null ? null : Number(row.duration), signaled: row.signaled }))
      return orderInteractions(rows, order)
    },

    /** Chamadas do recorte (com transcrição) em ordem de interesse: maiores durações, com o sinal, ou espalhadas no tempo. */
    async segmentInteractions(organizationId: string, personId: string, window: { start: Date; end: Date }, segmentKey: string, order: "LONGEST" | "SIGNALED" | "TEMPORAL", signal: IndicatorSignal): Promise<{ id: string; startedAt: Date; durationSeconds: number | null; signaled: boolean }[]> {
      const rows = (await db.query<{ id: string; started_at: Date; duration: string | null; signaled: boolean }>(
        `select i.id, i.started_at, extract(epoch from i.ended_at - i.started_at) duration,
                ${signalPredicateSql("i", 6)} signaled
         from interactions i
         where i.organization_id = $1 and i.operator_id = $2 and i.started_at >= $3 and i.started_at < $4 and ${segmentKeySql("i")} = $5
           and exists (select 1 from transcripts t where t.interaction_id = i.id and length(btrim(t.content)) > 0)
         order by i.started_at, i.id`,
        [organizationId, personId, window.start, window.end, segmentKey, ...signalParams(signal)],
      )).rows.map((row) => ({ id: row.id, startedAt: new Date(row.started_at), durationSeconds: row.duration === null ? null : Number(row.duration), signaled: row.signaled }))
      return orderInteractions(rows, order)
    },

    /**
     * EVIDÊNCIA de chamadas de um recorte (para a chave da investigação): cada chamada com início, fim, assunto e a assinatura da
     * transcrição vigente — chamada nova, transcrição corrigida ou assunto reclassificado mudam a assinatura (submotivo nulo fica fora
     * do `concat_ws`, então a assinatura de quem não tem submotivo é a mesma de antes). Uma consulta.
     */
    async interactionEvidence(organizationId: string, personIds: readonly string[], window: { start: Date; end: Date }, detail: "FULL" | "AGGREGATE"): Promise<string> {
      if (personIds.length === 0) return "none"
      const row = (await db.query<{ n: string; signature: string | null }>(
        detail === "FULL"
          ? `select count(*) n, md5(string_agg(concat_ws('|', i.id, i.started_at, i.ended_at, i.reason, i.sub_reason, (select md5(t.content) from transcripts t where t.interaction_id = i.id order by t.version desc limit 1)), ',' order by i.id)) signature
             from interactions i where i.organization_id = $1 and i.operator_id = any($2::uuid[]) and i.started_at >= $3 and i.started_at < $4`
          : `select count(*) n, md5(string_agg(concat_ws('|', i.id, i.ended_at, i.reason, i.sub_reason), ',' order by i.id)) signature
             from interactions i where i.organization_id = $1 and i.operator_id = any($2::uuid[]) and i.started_at >= $3 and i.started_at < $4`,
        [organizationId, [...personIds], window.start, window.end],
      )).rows[0]
      return `${row?.n ?? 0}:${row?.signature ?? "none"}`
    },

    /** Colegas ATIVOS do mesmo Grupo (exclui a pessoa) — a população de comparação. */
    async teamPeers(organizationId: string, teamId: string, personId: string): Promise<string[]> {
      return (await db.query<{ id: string }>(`select id from people where organization_id = $1 and team_id = $2 and id <> $3 and active and role = 'OPERATOR'`, [organizationId, teamId, personId])).rows.map((row) => row.id)
    },

    /** Resultado OFICIAL dos colegas no mesmo indicador e competência (classificação geral, quando não há métrica por assunto). */
    async peerOfficialValues(organizationId: string, peerIds: readonly string[], indicatorId: string, referencePeriod: string): Promise<{ personId: string; value: number }[]> {
      if (peerIds.length === 0) return []
      return (await db.query<{ person_id: string; value: string }>(`select person_id, value from employee_indicator_performance where organization_id = $1 and person_id = any($2::uuid[]) and indicator_definition_id = $3 and reference_period = $4`, [organizationId, [...peerIds], indicatorId, referencePeriod])).rows.map((row) => ({ personId: row.person_id, value: Number(row.value) }))
    },
  }
}

/** Ordem de interesse (determinística): maiores durações, com o sinal, ou espalhadas no tempo (início/fim/meio). */
export function orderInteractions<T extends { id: string; startedAt: Date; durationSeconds: number | null; signaled: boolean }>(rows: readonly T[], order: "LONGEST" | "SIGNALED" | "TEMPORAL"): T[] {
  if (order === "LONGEST") return [...rows].sort((a, b) => (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0) || a.id.localeCompare(b.id))
  if (order === "SIGNALED") return [...rows].sort((a, b) => Number(b.signaled) - Number(a.signaled) || a.startedAt.getTime() - b.startedAt.getTime())
  const spread: T[] = []
  let left = 0
  let right = rows.length - 1
  while (left <= right) {
    spread.push(rows[left]!)
    if (left !== right) spread.push(rows[right]!)
    left += 1
    right -= 1
  }
  return spread
}
