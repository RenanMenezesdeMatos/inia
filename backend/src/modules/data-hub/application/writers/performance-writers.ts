import { AGGREGATION_STRATEGY_METADATA, componentValueScale, componentsNotDefinedMessage, componentsProblem, unitValueProblem } from "../../../indicators/domain/indicator-definition.js"
import { createEnrollmentLookups } from "../../../workflows/application/enrollment-lookups.js"
import { enrollIndicatorWorkflows } from "../../../workflows/application/indicator-enrollment.js"
import { startOfLocalDate } from "../../../workflows/application/time-window.js"
import { resolveEmployees, resolveIndicators, resolveSubteams, type IndicatorRef } from "../reference-resolver.js"
import { dedupeByKey, emptyApply, num, reject, str, type DomainWriter, type Rejection, type ValidRecord } from "./domain-writer.js"
import { withLineage } from "./master-data-writers.js"

/**
 * Writers de medição e fechamento. O writer de medições é UM para todos os indicadores — os
 * componentes exigidos vêm de `AGGREGATION_STRATEGY_METADATA` (catálogo), nunca de uma lista de
 * códigos aqui. Aplicar uma medição nova/alterada matricula Workflows por Indicador exatamente
 * como a ingestão em tempo real (`enrollIndicatorWorkflows`) — medição inalterada não rematricula.
 *
 * Todos gravam em `<tabela>_all` (o nome sem sufixo é a visão dos registros ativos): registro cancelado que chega de novo volta a valer, mesmo com o
 * mesmo valor, e conta como alterado. Pela visão, a carga diria que deu certo e o dado continuaria escondido.
 */
type PreparedMeasurement = ValidRecord & {
  personId: string
  indicator: IndicatorRef
  granularity: "DAILY" | "MONTHLY" | "CUSTOM"
  periodStart: string
  periodEnd: string
  value: number
  numerator: number | null
  denominator: number | null
  sampleCount: number | null
}

function monthEndIso(referencePeriod: string): string {
  const [year, month] = referencePeriod.split("-").map(Number) as [number, number]
  return new Date(Date.UTC(year, month, 1)).toISOString()
}

const formatNumber = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 4 })

/**
 * Numerador e denominador só existem quando a ESTRATÉGIA do indicador define o valor por componentes, e precisam conferir com o
 * valor (tolerância de arredondamento). Mesma regra e mesma mensagem na medição e no fechamento: se a carga diária aceitasse o
 * que o fechamento recusa, o indicador ficaria com histórico errado e travado. Nada é corrigido: a linha inteira vai para a quarentena.
 */
function componentsError(indicator: IndicatorRef, value: number, numerator: number, denominator: number, wording: { value: string; notSaved: string }): { field: string; message: string } | null {
  const problem = componentsProblem(indicator.aggregation, value, numerator, denominator)
  if (problem === null) return null
  if (problem.kind === "NOT_DEFINED_BY_COMPONENTS") return { field: "numerator", message: componentsNotDefinedMessage(indicator.aggregation, indicator.code) }
  const scale = componentValueScale(indicator.aggregation)
  const formula = `${formatNumber(numerator)} ÷ ${formatNumber(denominator)}${scale !== null && scale !== 1 ? ` × ${scale}` : ""}`
  return {
    field: "value",
    message: `${wording.value} ${formatNumber(value)} não confere com numerador ÷ denominador (${formula} = ${formatNumber(Number(problem.expected.toFixed(4)))}; tolerância ±${formatNumber(Number(problem.tolerance.toFixed(4)))}). ${wording.notSaved}`,
  }
}

export const indicatorMeasurementsWriter: DomainWriter<PreparedMeasurement> = {
  contractKey: "INDICATOR_MEASUREMENTS",
  async prepare(context, records) {
    const db = context.ctx.db
    const [people, indicators] = await Promise.all([
      resolveEmployees(db, context.organizationId, records.map((record) => str(record.record, "externalEmployeeId"))),
      resolveIndicators(db, context.organizationId, records.map((record) => str(record.record, "indicatorCode"))),
    ])
    const ready: PreparedMeasurement[] = []
    const rejections: Rejection[] = []
    const candidates: PreparedMeasurement[] = []
    for (const record of records) {
      const matricula = str(record.record, "externalEmployeeId")!
      const person = people.get(matricula)
      if (!person) {
        rejections.push(reject(record, "DATA_EMPLOYEE_NOT_FOUND", "externalEmployeeId", `Colaborador "${matricula}" não existe na INIA.`))
        continue
      }
      const code = str(record.record, "indicatorCode")!.toUpperCase()
      const indicator = indicators.get(code)
      if (!indicator || !indicator.active) {
        rejections.push(reject(record, "DATA_INDICATOR_NOT_FOUND", "indicatorCode", `Indicador "${code}" não existe ou está inativo.`))
        continue
      }
      // Período: dia (calendário da operação) ou período explícito.
      let granularity: PreparedMeasurement["granularity"]
      let periodStart: string
      let periodEnd: string
      const date = str(record.record, "date")
      if (date) {
        granularity = (str(record.record, "granularity") as PreparedMeasurement["granularity"] | null) ?? "DAILY"
        if (granularity !== "DAILY") {
          rejections.push(reject(record, "DATA_CONTRACT_VIOLATION", "granularity", "Com `date`, a granularidade só pode ser DAILY."))
          continue
        }
        const start = startOfLocalDate(date, context.timeZone)
        periodStart = start.toISOString()
        periodEnd = new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString()
      } else {
        granularity = (str(record.record, "granularity") as PreparedMeasurement["granularity"] | null) ?? "CUSTOM"
        if (granularity === "DAILY") {
          rejections.push(reject(record, "DATA_CONTRACT_VIOLATION", "granularity", "Granularidade DAILY exige o campo `date`."))
          continue
        }
        periodStart = str(record.record, "periodStart")!
        periodEnd = str(record.record, "periodEnd")!
      }
      if (granularity === "DAILY" && !indicator.dailySupported) {
        rejections.push(reject(record, "DATA_INDICATOR_CAPABILITY", "indicatorCode", `O indicador "${code}" não tem medição operacional (diária) habilitada no catálogo.`))
        continue
      }
      // Componentes exigidos pela ESTRATÉGIA do catálogo (nunca por código de indicador).
      const strategy = AGGREGATION_STRATEGY_METADATA[indicator.aggregation]
      const missing = strategy.requiredComponents.find((component) => num(record.record, component) === null)
      if (missing) {
        rejections.push(reject(record, "DATA_COMPONENT_MISSING", missing, `A estratégia "${strategy.label}" do indicador "${code}" exige o componente "${missing}".`))
        continue
      }
      const value = num(record.record, "value")!
      const numerator = num(record.record, "numerator")
      const denominator = num(record.record, "denominator")
      if (denominator !== null && numerator !== null) {
        const issue = componentsError(indicator, value, numerator, denominator, { value: "Valor", notSaved: "A medição não foi gravada." })
        if (issue) {
          rejections.push(reject(record, "DATA_CONTRACT_VIOLATION", issue.field, issue.message))
          continue
        }
      }
      const unitProblem = unitValueProblem(indicator.unit, value)
      if (unitProblem) {
        rejections.push(reject(record, "DATA_CONTRACT_VIOLATION", "value", unitProblem))
        continue
      }
      candidates.push({ ...record, personId: person.id, indicator, granularity, periodStart, periodEnd, value, numerator, denominator, sampleCount: num(record.record, "sampleCount") })
    }
    const { unique, duplicates } = dedupeByKey(candidates, (row) => `${row.personId}|${row.indicator.id}|${row.periodStart}|${row.periodEnd}`)
    // Um a um, nunca `push(...unique)`: o preparo recebe a carga inteira (centenas de milhares de medições num arquivo) e
    // espalhar tantos argumentos estoura a pilha do V8.
    for (const row of unique) ready.push(row)
    for (const duplicate of duplicates) rejections.push(duplicate)
    return { ready, rejections }
  },
  async apply(context, client, batch) {
    if (batch.length === 0) return emptyApply()
    const org = context.organizationId
    const result = await client.query<{ id: string; key: string; inserted: boolean }>(
      `insert into indicator_measurements_all (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity, numerator, denominator, sample_count)
       select $1, indicator_id, 'PERSON', person_id, value, period_start::timestamptz, period_end::timestamptz, $2, granularity, numerator, denominator, sample_count
       from unnest($3::uuid[], $4::uuid[], $5::numeric[], $6::text[], $7::text[], $8::text[], $9::numeric[], $10::numeric[], $11::int[])
         as t(indicator_id, person_id, value, period_start, period_end, granularity, numerator, denominator, sample_count)
       on conflict (organization_id, indicator_definition_id, subject_type, subject_id, period_start, period_end, source) do update set
         value = excluded.value, granularity = excluded.granularity, numerator = excluded.numerator, denominator = excluded.denominator, sample_count = excluded.sample_count,
         cancelled_at = null, cancellation_id = null
       where indicator_measurements_all.cancelled_at is not null
          or indicator_measurements_all.value is distinct from excluded.value or indicator_measurements_all.numerator is distinct from excluded.numerator
          or indicator_measurements_all.denominator is distinct from excluded.denominator or indicator_measurements_all.sample_count is distinct from excluded.sample_count
          or indicator_measurements_all.granularity is distinct from excluded.granularity
       returning id, subject_id || '|' || indicator_definition_id || '|' || to_char(period_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' || to_char(period_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') key, (xmax = 0) inserted`,
      [org, context.sourceNamespace, batch.map((r) => r.indicator.id), batch.map((r) => r.personId), batch.map((r) => r.value), batch.map((r) => r.periodStart), batch.map((r) => r.periodEnd), batch.map((r) => r.granularity), batch.map((r) => r.numerator), batch.map((r) => r.denominator), batch.map((r) => r.sampleCount)],
    )
    const outcome = withLineage("indicator_measurements", batch, (row) => `${row.personId}|${row.indicator.id}|${row.periodStart}|${row.periodEnd}`, result.rows.map((row) => ({ key: row.key, id: row.id, inserted: row.inserted })))
    outcome.businessMaxEventTime = batch.reduce<string | null>((max, row) => (max === null || row.periodEnd > max ? row.periodEnd : max), null)

    // Mesmo caminho canônico da ingestão em tempo real: matrícula em Workflows por Indicador só
    // para medições novas/alteradas, e só quando existe Workflow publicado para o código.
    const triggered = await client.query<{ code: string }>(
      `select distinct trigger_config->>'indicatorCode' code from workflows where organization_id = $1 and active and active_version_id is not null and trigger_config->>'kind' = 'indicator'`,
      [org],
    )
    const triggeredCodes = new Set(triggered.rows.map((row) => row.code))
    if (triggeredCodes.size > 0) {
      const touchedIds = new Map(outcome.lineage.map((entry) => [`${entry.recordNumber}`, entry.entityId]))
      // Leituras da matrícula que não dependem da linha (candidatos, estratégia, grafo, estrutura, operador) uma vez por lote,
      // na transação do lote; a decisão e a gravação continuam por medição (enrollment-lookups.ts).
      const lookups = createEnrollmentLookups(client)
      for (const row of batch) {
        const measurementId = touchedIds.get(`${row.recordNumber}`)
        if (!measurementId || !triggeredCodes.has(row.indicator.code)) continue
        await enrollIndicatorWorkflows(client, { organizationId: org, measurementId, operatorId: row.personId, indicatorCode: row.indicator.code, value: row.value }, lookups)
      }
    }
    return outcome
  },
}

// ---------------------------------------------------------------------------------------------
// OFFICIAL_INDICATOR_PERFORMANCE → employee_indicator_performance
// ---------------------------------------------------------------------------------------------
type PreparedOfficial = ValidRecord & { personId: string; indicatorId: string; subteamId: string | null; referencePeriod: string; value: number; targetValue: number | null; achievementPercent: number | null; weightPercent: number | null; quartile: string | null; numerator: number | null; denominator: number | null }

export const officialIndicatorPerformanceWriter: DomainWriter<PreparedOfficial> = {
  contractKey: "OFFICIAL_INDICATOR_PERFORMANCE",
  async prepare(context, records) {
    const { unique, duplicates } = dedupeByKey(records, (record) => `${record.record.externalEmployeeId}|${String(record.record.indicatorCode).toUpperCase()}|${record.record.referencePeriod}`)
    const db = context.ctx.db
    const [people, indicators, subteams] = await Promise.all([
      resolveEmployees(db, context.organizationId, unique.map((record) => str(record.record, "externalEmployeeId"))),
      resolveIndicators(db, context.organizationId, unique.map((record) => str(record.record, "indicatorCode"))),
      resolveSubteams(db, context.organizationId, unique.map((record) => str(record.record, "subgroupExternalCode"))),
    ])
    const ready: PreparedOfficial[] = []
    const rejections: Rejection[] = [...duplicates]
    for (const record of unique) {
      const matricula = str(record.record, "externalEmployeeId")!
      const person = people.get(matricula)
      if (!person) {
        rejections.push(reject(record, "DATA_EMPLOYEE_NOT_FOUND", "externalEmployeeId", `Colaborador "${matricula}" não existe na INIA.`))
        continue
      }
      const code = str(record.record, "indicatorCode")!.toUpperCase()
      const indicator = indicators.get(code)
      if (!indicator || !indicator.active) {
        rejections.push(reject(record, "DATA_INDICATOR_NOT_FOUND", "indicatorCode", `Indicador "${code}" não existe ou está inativo.`))
        continue
      }
      if (!indicator.officialClosureSupported) {
        rejections.push(reject(record, "DATA_INDICATOR_CAPABILITY", "indicatorCode", `O indicador "${code}" não tem fechamento oficial habilitado no catálogo.`))
        continue
      }
      const subgroupCode = str(record.record, "subgroupExternalCode")
      const subteam = subgroupCode ? subteams.get(subgroupCode) : undefined
      if (subgroupCode && !subteam) {
        rejections.push(reject(record, "DATA_SUBGROUP_NOT_FOUND", "subgroupExternalCode", `Subgrupo "${subgroupCode}" não existe na INIA.`))
        continue
      }
      const value = num(record.record, "value")!
      // Contrato @1 não conhece os componentes (o mapeamento nunca os traz); no @2 os dois vêm juntos (validação pura do contrato).
      const numerator = num(record.record, "numerator")
      const denominator = num(record.record, "denominator")
      if (numerator !== null && denominator !== null) {
        const issue = componentsError(indicator, value, numerator, denominator, { value: "Valor oficial", notSaved: "O fechamento não foi gravado: a INIA nunca corrige o valor oficial nem os componentes." })
        if (issue) {
          rejections.push(reject(record, "DATA_CONTRACT_VIOLATION", issue.field, issue.message))
          continue
        }
      }
      ready.push({ ...record, personId: person.id, indicatorId: indicator.id, subteamId: subteam?.id ?? person.subteamId, referencePeriod: str(record.record, "referencePeriod")!, value, targetValue: num(record.record, "targetValue"), achievementPercent: num(record.record, "achievementPercent"), weightPercent: num(record.record, "weightPercent"), quartile: str(record.record, "quartile"), numerator, denominator })
    }
    return { ready, rejections }
  },
  async apply(context, client, batch) {
    if (batch.length === 0) return emptyApply()
    // Componentes ausentes (contrato @1, ou @2 sem eles) não apagam os já recebidos para o MESMO valor
    // oficial; valor novo sem componentes apaga os antigos — nunca ficam incoerentes com o valor gravado.
    const result = await client.query<{ id: string; key: string; inserted: boolean }>(
      `insert into employee_indicator_performance_all (organization_id, person_id, indicator_definition_id, subteam_id, reference_period, value, target_value, achievement_percent, weight_percent, quartile, numerator, denominator, source)
       select $1, person_id, indicator_id, subteam_id, reference_period, value, target_value, achievement_percent, weight_percent, quartile, numerator, denominator, $2
       from unnest($3::uuid[], $4::uuid[], $5::uuid[], $6::text[], $7::numeric[], $8::numeric[], $9::numeric[], $10::numeric[], $11::text[], $12::numeric[], $13::numeric[])
         as t(person_id, indicator_id, subteam_id, reference_period, value, target_value, achievement_percent, weight_percent, quartile, numerator, denominator)
       on conflict (organization_id, person_id, indicator_definition_id, reference_period) do update set
         subteam_id = excluded.subteam_id, value = excluded.value, target_value = excluded.target_value, achievement_percent = excluded.achievement_percent,
         weight_percent = excluded.weight_percent, quartile = excluded.quartile, source = excluded.source,
         numerator = case when excluded.numerator is null and excluded.value = employee_indicator_performance_all.value then employee_indicator_performance_all.numerator else excluded.numerator end,
         denominator = case when excluded.denominator is null and excluded.value = employee_indicator_performance_all.value then employee_indicator_performance_all.denominator else excluded.denominator end,
         cancelled_at = null, cancellation_id = null
       where employee_indicator_performance_all.cancelled_at is not null
          or employee_indicator_performance_all.value is distinct from excluded.value or employee_indicator_performance_all.target_value is distinct from excluded.target_value
          or employee_indicator_performance_all.achievement_percent is distinct from excluded.achievement_percent or employee_indicator_performance_all.weight_percent is distinct from excluded.weight_percent
          or employee_indicator_performance_all.quartile is distinct from excluded.quartile or employee_indicator_performance_all.subteam_id is distinct from excluded.subteam_id
          or employee_indicator_performance_all.source is distinct from excluded.source
          or (excluded.numerator is not null and (employee_indicator_performance_all.numerator is distinct from excluded.numerator or employee_indicator_performance_all.denominator is distinct from excluded.denominator))
       returning id, person_id || '|' || indicator_definition_id || '|' || reference_period key, (xmax = 0) inserted`,
      [context.organizationId, context.sourceNamespace, batch.map((r) => r.personId), batch.map((r) => r.indicatorId), batch.map((r) => r.subteamId), batch.map((r) => r.referencePeriod), batch.map((r) => r.value), batch.map((r) => r.targetValue), batch.map((r) => r.achievementPercent), batch.map((r) => r.weightPercent), batch.map((r) => r.quartile), batch.map((r) => r.numerator), batch.map((r) => r.denominator)],
    )
    const outcome = withLineage("employee_indicator_performance", batch, (row) => `${row.personId}|${row.indicatorId}|${row.referencePeriod}`, result.rows.map((row) => ({ key: row.key, id: row.id, inserted: row.inserted })))
    outcome.businessMaxEventTime = batch.reduce<string | null>((max, row) => {
      const end = monthEndIso(row.referencePeriod)
      return max === null || end > max ? end : max
    }, null)
    return outcome
  },
}

// ---------------------------------------------------------------------------------------------
// PRV_PERFORMANCE → employee_prv_performance
// ---------------------------------------------------------------------------------------------
type PreparedPrv = ValidRecord & { personId: string; subteamId: string | null; referencePeriod: string; achievementPercent: number; quartile: string }

export const prvPerformanceWriter: DomainWriter<PreparedPrv> = {
  contractKey: "PRV_PERFORMANCE",
  async prepare(context, records) {
    const { unique, duplicates } = dedupeByKey(records, (record) => `${record.record.externalEmployeeId}|${record.record.referencePeriod}`)
    const db = context.ctx.db
    const [people, subteams] = await Promise.all([
      resolveEmployees(db, context.organizationId, unique.map((record) => str(record.record, "externalEmployeeId"))),
      resolveSubteams(db, context.organizationId, unique.map((record) => str(record.record, "subgroupExternalCode"))),
    ])
    const ready: PreparedPrv[] = []
    const rejections: Rejection[] = [...duplicates]
    for (const record of unique) {
      const matricula = str(record.record, "externalEmployeeId")!
      const person = people.get(matricula)
      if (!person) {
        rejections.push(reject(record, "DATA_EMPLOYEE_NOT_FOUND", "externalEmployeeId", `Colaborador "${matricula}" não existe na INIA.`))
        continue
      }
      const subgroupCode = str(record.record, "subgroupExternalCode")
      const subteam = subgroupCode ? subteams.get(subgroupCode) : undefined
      if (subgroupCode && !subteam) {
        rejections.push(reject(record, "DATA_SUBGROUP_NOT_FOUND", "subgroupExternalCode", `Subgrupo "${subgroupCode}" não existe na INIA.`))
        continue
      }
      ready.push({ ...record, personId: person.id, subteamId: subteam?.id ?? person.subteamId, referencePeriod: str(record.record, "referencePeriod")!, achievementPercent: num(record.record, "achievementPercent")!, quartile: str(record.record, "quartile")! })
    }
    return { ready, rejections }
  },
  async apply(context, client, batch) {
    if (batch.length === 0) return emptyApply()
    const result = await client.query<{ id: string; key: string; inserted: boolean }>(
      `insert into employee_prv_performance_all (organization_id, person_id, subteam_id, reference_period, achievement_percent, quartile, source)
       select $1, person_id, subteam_id, reference_period, achievement_percent, quartile, $2
       from unnest($3::uuid[], $4::uuid[], $5::text[], $6::numeric[], $7::text[]) as t(person_id, subteam_id, reference_period, achievement_percent, quartile)
       on conflict (organization_id, person_id, reference_period) do update set
         subteam_id = excluded.subteam_id, achievement_percent = excluded.achievement_percent, quartile = excluded.quartile, source = excluded.source,
         cancelled_at = null, cancellation_id = null
       where employee_prv_performance_all.cancelled_at is not null
          or employee_prv_performance_all.achievement_percent is distinct from excluded.achievement_percent or employee_prv_performance_all.quartile is distinct from excluded.quartile
          or employee_prv_performance_all.subteam_id is distinct from excluded.subteam_id or employee_prv_performance_all.source is distinct from excluded.source
       returning id, person_id || '|' || reference_period key, (xmax = 0) inserted`,
      [context.organizationId, context.sourceNamespace, batch.map((r) => r.personId), batch.map((r) => r.subteamId), batch.map((r) => r.referencePeriod), batch.map((r) => r.achievementPercent), batch.map((r) => r.quartile)],
    )
    const outcome = withLineage("employee_prv_performance", batch, (row) => `${row.personId}|${row.referencePeriod}`, result.rows.map((row) => ({ key: row.key, id: row.id, inserted: row.inserted })))
    outcome.businessMaxEventTime = batch.reduce<string | null>((max, row) => {
      const end = monthEndIso(row.referencePeriod)
      return max === null || end > max ? end : max
    }, null)
    return outcome
  },
}
