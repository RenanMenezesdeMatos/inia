import type { Database } from "../../../infrastructure/database/pool.js"
import {
  employeeIndicatorPerformanceSchema,
  employeePrvPerformanceSchema,
  type EmployeeIndicatorPerformance,
  type EmployeePrvPerformance,
} from "../domain/employee-performance-schema.js"
import { currentReferencePeriod } from "../../performance-analytics/domain/reference-period.js"
import { lastClosedReferencePeriod } from "../domain/official-closure-policy.js"

/** "AAAA-MM" do momento atual no calendário local da organização — mesma granularidade de `reference_period`. Uma implementação só (performance-analytics/domain/reference-period.ts). */
export { currentReferencePeriod }

// GUARD CENTRAL: todo leitor oficial abaixo filtra `reference_period <= lastClosedReferencePeriod`
// (official-closure-policy.ts) — o mês corrente nunca é fechamento, exista ou não a linha.

/**
 * Linha mais recente (reference_period <= agora) de performance do colaborador nesse indicador —
 * nunca calculada, só lida da fonte externa (ver employee-performance-schema.ts). null = sem
 * nenhuma linha ainda (vira a saída "Sem dados" da Condition, nunca FALSE).
 */
export async function findLatestIndicatorPerformance(
  db: Database,
  personId: string,
  indicatorCode: string,
  now: Date,
  timeZone?: string,
): Promise<EmployeeIndicatorPerformance | null> {
  const result = await db.query(
    `select eip.id, eip.person_id "personId", eip.indicator_definition_id "indicatorDefinitionId", idef.code "indicatorCode",
            eip.subteam_id "subteamId", eip.reference_period "referencePeriod", eip.value, eip.target_value "targetValue",
            eip.achievement_percent "achievementPercent", eip.weight_percent "weightPercent", eip.quartile, eip.source
     from employee_indicator_performance eip
     join indicator_definitions idef on idef.id = eip.indicator_definition_id
     where eip.person_id = $1 and idef.code = $2 and eip.reference_period <= $3
     order by eip.reference_period desc
     limit 1`,
    [personId, indicatorCode, lastClosedReferencePeriod(now, timeZone)],
  )
  return result.rows[0] ? employeeIndicatorPerformanceSchema.parse(result.rows[0]) : null
}

export async function findLatestPrvPerformance(db: Database, personId: string, now: Date, timeZone?: string): Promise<EmployeePrvPerformance | null> {
  const result = await db.query(
    `select id, person_id "personId", subteam_id "subteamId", reference_period "referencePeriod",
            achievement_percent "achievementPercent", quartile, source
     from employee_prv_performance
     where person_id = $1 and reference_period <= $2
     order by reference_period desc
     limit 1`,
    [personId, lastClosedReferencePeriod(now, timeZone)],
  )
  return result.rows[0] ? employeePrvPerformanceSchema.parse(result.rows[0]) : null
}

/**
 * Últimos N snapshots mensais (reference_period <= agora, mais recentes primeiro) de performance
 * do colaborador — usado pela Recorrência de Quartil ("Q4 em 3 dos últimos 3 fechamentos"). Só lê
 * quartile já persistido, nunca calcula — devolve quantas linhas existem de fato (pode ser menor
 * que `limit` quando o colaborador tem menos histórico do que o pedido, o que vira Sem Dados no
 * chamador, nunca uma contagem parcial silenciosa).
 */
export async function findRecentIndicatorPerformance(
  db: Database,
  personId: string,
  indicatorCode: string,
  now: Date,
  limit: number,
  timeZone?: string,
): Promise<EmployeeIndicatorPerformance[]> {
  const result = await db.query(
    `select eip.id, eip.person_id "personId", eip.indicator_definition_id "indicatorDefinitionId", idef.code "indicatorCode",
            eip.subteam_id "subteamId", eip.reference_period "referencePeriod", eip.value, eip.target_value "targetValue",
            eip.achievement_percent "achievementPercent", eip.weight_percent "weightPercent", eip.quartile, eip.source
     from employee_indicator_performance eip
     join indicator_definitions idef on idef.id = eip.indicator_definition_id
     where eip.person_id = $1 and idef.code = $2 and eip.reference_period <= $3
     order by eip.reference_period desc
     limit $4`,
    [personId, indicatorCode, lastClosedReferencePeriod(now, timeZone), limit],
  )
  return result.rows.map((row) => employeeIndicatorPerformanceSchema.parse(row))
}

export async function findRecentPrvPerformance(db: Database, personId: string, now: Date, limit: number, timeZone?: string): Promise<EmployeePrvPerformance[]> {
  const result = await db.query(
    `select id, person_id "personId", subteam_id "subteamId", reference_period "referencePeriod",
            achievement_percent "achievementPercent", quartile, source
     from employee_prv_performance
     where person_id = $1 and reference_period <= $2
     order by reference_period desc
     limit $3`,
    [personId, lastClosedReferencePeriod(now, timeZone), limit],
  )
  return result.rows.map((row) => employeePrvPerformanceSchema.parse(row))
}

export type AchievementAggregate = { avg: number | null; min: number | null; max: number | null; count: number }

/** Agrega achievement_percent das tabelas de performance dentro de uma janela [start, end) —
 * comparação lexicográfica de "AAAA-MM" funciona porque o formato é sempre zero-padded. Usado
 * pelo histórico de atingimento (Parte 33 do pedido), nunca calcula a % em si, só agrega o que
 * já veio pronto da fonte. `personIds` é sempre um array — um elemento só pro caso individual de
 * sempre, N elementos pra Unidade de Análise agregada (Parte 4/B4 da evolução de Unidade de
 * Análise): a agregação passa a somar/mediar/etc. sobre TODAS as linhas do grupo inteiro, nunca
 * uma pessoa de cada vez. */
export async function aggregateAchievementHistory(
  db: Database,
  table: "employee_indicator_performance" | "employee_prv_performance",
  personIds: string[],
  indicatorCode: string | undefined,
  start: Date,
  end: Date,
  now: Date,
  timeZone?: string,
): Promise<AchievementAggregate> {
  const startPeriod = currentReferencePeriod(start, timeZone)
  // `end` é exclusivo como data (padrão do resto do motor) — convertido pro último dia
  // efetivamente dentro da janela antes de virar "AAAA-MM"; e limitado ao último fechamento
  // possível (guard central): uma janela que toca o mês corrente nunca lê o mês corrente.
  const lastClosed = lastClosedReferencePeriod(now, timeZone)
  const lastWindowPeriod = currentReferencePeriod(new Date(end.getTime() - 1), timeZone)
  const lastIncludedPeriod = lastWindowPeriod > lastClosed ? lastClosed : lastWindowPeriod
  const params: unknown[] = [personIds, startPeriod, lastIncludedPeriod]
  let indicatorFilter = ""
  if (table === "employee_indicator_performance") {
    indicatorFilter = `and indicator_definition_id = (select id from indicator_definitions where code = $${params.length + 1})`
    params.push(indicatorCode)
  }
  const result = await db.query<{ avg_value: string | null; min_value: string | null; max_value: string | null; sample_count: string }>(
    `select avg(achievement_percent)::numeric avg_value, min(achievement_percent)::numeric min_value,
            max(achievement_percent)::numeric max_value, count(*)::int sample_count
     from ${table}
     where person_id = any($1::uuid[]) and reference_period >= $2 and reference_period <= $3 ${indicatorFilter}`,
    params,
  )
  const row = result.rows[0]
  return {
    avg: row?.avg_value !== null && row?.avg_value !== undefined ? Number(row.avg_value) : null,
    min: row?.min_value !== null && row?.min_value !== undefined ? Number(row.min_value) : null,
    max: row?.max_value !== null && row?.max_value !== undefined ? Number(row.max_value) : null,
    count: row?.sample_count ? Number(row.sample_count) : 0,
  }
}

export type ClosuresAggregate = {
  avg: number | null
  min: number | null
  max: number | null
  sampleCount: number
  totalClosures: number
  /** Só-debug: o atingimento médio de cada fechamento encontrado (mais antigo primeiro). */
  periods?: { referencePeriod: string; avg: number | null; sampleCount: number }[]
}

/**
 * "Últimos N fechamentos" (Parte 3 do pedido de Meta/Fechamentos) — em vez de uma janela de
 * datas, pega os N `reference_period` mais recentes REALMENTE persistidos (nunca aproxima por
 * dias/mês corrido) e agrega achievement_percent sobre eles. `totalClosures` é quantos
 * fechamentos distintos foram de fato encontrados (pode ser menor que `count` quando o histórico
 * é insuficiente) — quem chama decide se isso vira Sem Dados, nunca uma média parcial disfarçada.
 */
export async function aggregateAchievementClosures(
  db: Database,
  table: "employee_indicator_performance" | "employee_prv_performance",
  personIds: string[],
  indicatorCode: string | undefined,
  count: number,
  now: Date,
  timeZone?: string,
): Promise<ClosuresAggregate> {
  const params: unknown[] = [personIds, lastClosedReferencePeriod(now, timeZone), count]
  let indicatorFilter = ""
  if (table === "employee_indicator_performance") {
    indicatorFilter = `and indicator_definition_id = (select id from indicator_definitions where code = $${params.length + 1})`
    params.push(indicatorCode)
  }
  const result = await db.query<{
    avg_value: string | null
    min_value: string | null
    max_value: string | null
    sample_count: string
    total_closures: string
    periods: { referencePeriod: string; avgValue: string | null; sampleCount: number }[] | null
  }>(
    `with recent_periods as (
       select distinct reference_period from ${table}
       where person_id = any($1::uuid[]) and reference_period <= $2 ${indicatorFilter}
       order by reference_period desc
       limit $3
     ),
     per_period as (
       select t.reference_period, avg(t.achievement_percent)::numeric avg_value, count(*)::int sample_count
       from ${table} t
       where t.person_id = any($1::uuid[]) and t.reference_period in (select reference_period from recent_periods) ${indicatorFilter}
       group by t.reference_period
     )
     select avg(t.achievement_percent)::numeric avg_value, min(t.achievement_percent)::numeric min_value,
            max(t.achievement_percent)::numeric max_value, count(*)::int sample_count,
            (select count(*) from recent_periods)::int total_closures,
            (select json_agg(json_build_object('referencePeriod', reference_period, 'avgValue', avg_value, 'sampleCount', sample_count) order by reference_period) from per_period) periods
     from ${table} t
     where t.person_id = any($1::uuid[]) and t.reference_period in (select reference_period from recent_periods) ${indicatorFilter}`,
    params,
  )
  const row = result.rows[0]
  return {
    avg: row?.avg_value !== null && row?.avg_value !== undefined ? Number(row.avg_value) : null,
    min: row?.min_value !== null && row?.min_value !== undefined ? Number(row.min_value) : null,
    max: row?.max_value !== null && row?.max_value !== undefined ? Number(row.max_value) : null,
    sampleCount: row?.sample_count ? Number(row.sample_count) : 0,
    totalClosures: row?.total_closures ? Number(row.total_closures) : 0,
    periods: (row?.periods ?? []).map((period) => ({ referencePeriod: period.referencePeriod, avg: period.avgValue !== null ? Number(period.avgValue) : null, sampleCount: Number(period.sampleCount) })),
  }
}
