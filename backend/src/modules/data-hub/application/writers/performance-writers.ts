import { AGGREGATION_STRATEGY_METADATA, checkComponentCoherence, componentValueScale, valueFromComponents } from "../../../indicators/domain/indicator-definition.js"
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
        const expected = valueFromComponents(indicator.aggregation, numerator, denominator)
        if (expected !== null && Math.abs(expected - value) > Math.max(0.1, Math.abs(expected) * 0.01)) {
          rejections.push(reject(record, "DATA_CONTRACT_VIOLATION", "value", `Valor ${value} não confere com numerador ÷ denominador (${expected.toFixed(2)}).`))
          continue
        }
      }
      if (indicator.unit === "PERCENT" && (value < 0 || value > 100)) {
        rejections.push(reject(record, "DATA_CONTRACT_VIOLATION", "value", "Percentual precisa estar entre 0 e 100."))
        continue
      }
      if (indicator.unit === "SECONDS" && value < 0) {
        rejections.push(reject(record, "DATA_CONTRACT_VIOLATION", "value", "Tempo em segundos não pode ser negativo."))
        continue
      }
      candidates.push({ ...record, personId: person.id, indicator, granularity, periodStart, periodEnd, value, numerator, denominator, sampleCount: num(record.record, "sampleCount") })
    }
    const { unique, duplicates } = dedupeByKey(candidates, (row) => `${row.personId}|${row.indicator.id}|${row.periodStart}|${row.periodEnd}`)
    ready.push(...unique)
    rejections.push(...duplicates)
    return { ready, rejections }
  },
  async apply(context, client, batch) {
    if (batch.length === 0) return emptyApply()
    const org = context.organizationId
    const result = await client.query<{ id: string; key: string; inserted: boolean }>(
      `insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity, numerator, denominator, sample_count)
       select $1, indicator_id, 'PERSON', person_id, value, period_start::timestamptz, period_end::timestamptz, $2, granularity, numerator, denominator, sample_count
       from unnest($3::uuid[], $4::uuid[], $5::numeric[], $6::text[], $7::text[], $8::text[], $9::numeric[], $10::numeric[], $11::int[])
         as t(indicator_id, person_id, value, period_start, period_end, granularity, numerator, denominator, sample_count)
       on conflict (organization_id, indicator_definition_id, subject_type, subject_id, period_start, period_end, source) do update set
         value = excluded.value, granularity = excluded.granularity, numerator = excluded.numerator, denominator = excluded.denominator, sample_count = excluded.sample_count
       where indicator_measurements.value is distinct from excluded.value or indicator_measurements.numerator is distinct from excluded.numerator
          or indicator_measurements.denominator is distinct from excluded.denominator or indicator_measurements.sample_count is distinct from excluded.sample_count
          or indicator_measurements.granularity is distinct from excluded.granularity
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
      for (const row of batch) {
        const measurementId = touchedIds.get(`${row.recordNumber}`)
        if (!measurementId || !triggeredCodes.has(row.indicator.code)) continue
        await enrollIndicatorWorkflows(client, { organizationId: org, measurementId, operatorId: row.personId, indicatorCode: row.indicator.code, value: row.value })
      }
    }
    return outcome
  },
}

// ---------------------------------------------------------------------------------------------
// OFFICIAL_INDICATOR_PERFORMANCE → employee_indicator_performance
// ---------------------------------------------------------------------------------------------
type PreparedOfficial = ValidRecord & { personId: string; indicatorId: string; subteamId: string | null; referencePeriod: string; value: number; targetValue: number | null; achievementPercent: number | null; weightPercent: number | null; quartile: string | null; numerator: number | null; denominator: number | null }

const formatNumber = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 4 })

/**
 * Numerador e denominador do fechamento (contrato @2) só existem quando a ESTRATÉGIA do indicador define
 * o valor por componentes, e precisam conferir com o valor oficial (tolerância de arredondamento). O
 * fechamento oficial nunca é corrigido nem recalculado: incoerência = registro inteiro na quarentena.
 */
function officialComponentsError(indicator: IndicatorRef, value: number, numerator: number, denominator: number): { field: string; message: string } | null {
  const strategy = AGGREGATION_STRATEGY_METADATA[indicator.aggregation]
  const coherence = checkComponentCoherence(indicator.aggregation, value, numerator, denominator)
  if (coherence === null) {
    return { field: "numerator", message: `A estratégia "${strategy.label}" do indicador "${indicator.code}" não define o valor por numerador e denominador. Envie o fechamento sem os componentes ou revise a estratégia no catálogo — nada foi gravado.` }
  }
  if (coherence.coherent) return null
  const scale = componentValueScale(indicator.aggregation)
  const formula = `${formatNumber(numerator)} ÷ ${formatNumber(denominator)}${scale !== null && scale !== 1 ? ` × ${scale}` : ""}`
  return {
    field: "value",
    message: `Valor oficial ${formatNumber(value)} não confere com numerador ÷ denominador (${formula} = ${formatNumber(Number(coherence.expected.toFixed(4)))}; tolerância ±${formatNumber(Number(coherence.tolerance.toFixed(4)))}). O fechamento não foi gravado: a INIA nunca corrige o valor oficial nem os componentes.`,
  }
}

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
        const componentsError = officialComponentsError(indicator, value, numerator, denominator)
        if (componentsError) {
          rejections.push(reject(record, "DATA_CONTRACT_VIOLATION", componentsError.field, componentsError.message))
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
      `insert into employee_indicator_performance (organization_id, person_id, indicator_definition_id, subteam_id, reference_period, value, target_value, achievement_percent, weight_percent, quartile, numerator, denominator, source)
       select $1, person_id, indicator_id, subteam_id, reference_period, value, target_value, achievement_percent, weight_percent, quartile, numerator, denominator, $2
       from unnest($3::uuid[], $4::uuid[], $5::uuid[], $6::text[], $7::numeric[], $8::numeric[], $9::numeric[], $10::numeric[], $11::text[], $12::numeric[], $13::numeric[])
         as t(person_id, indicator_id, subteam_id, reference_period, value, target_value, achievement_percent, weight_percent, quartile, numerator, denominator)
       on conflict (organization_id, person_id, indicator_definition_id, reference_period) do update set
         subteam_id = excluded.subteam_id, value = excluded.value, target_value = excluded.target_value, achievement_percent = excluded.achievement_percent,
         weight_percent = excluded.weight_percent, quartile = excluded.quartile, source = excluded.source,
         numerator = case when excluded.numerator is null and excluded.value = employee_indicator_performance.value then employee_indicator_performance.numerator else excluded.numerator end,
         denominator = case when excluded.denominator is null and excluded.value = employee_indicator_performance.value then employee_indicator_performance.denominator else excluded.denominator end
       where employee_indicator_performance.value is distinct from excluded.value or employee_indicator_performance.target_value is distinct from excluded.target_value
          or employee_indicator_performance.achievement_percent is distinct from excluded.achievement_percent or employee_indicator_performance.weight_percent is distinct from excluded.weight_percent
          or employee_indicator_performance.quartile is distinct from excluded.quartile or employee_indicator_performance.subteam_id is distinct from excluded.subteam_id
          or employee_indicator_performance.source is distinct from excluded.source
          or (excluded.numerator is not null and (employee_indicator_performance.numerator is distinct from excluded.numerator or employee_indicator_performance.denominator is distinct from excluded.denominator))
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
      `insert into employee_prv_performance (organization_id, person_id, subteam_id, reference_period, achievement_percent, quartile, source)
       select $1, person_id, subteam_id, reference_period, achievement_percent, quartile, $2
       from unnest($3::uuid[], $4::uuid[], $5::text[], $6::numeric[], $7::text[]) as t(person_id, subteam_id, reference_period, achievement_percent, quartile)
       on conflict (organization_id, person_id, reference_period) do update set
         subteam_id = excluded.subteam_id, achievement_percent = excluded.achievement_percent, quartile = excluded.quartile, source = excluded.source
       where employee_prv_performance.achievement_percent is distinct from excluded.achievement_percent or employee_prv_performance.quartile is distinct from excluded.quartile
          or employee_prv_performance.subteam_id is distinct from excluded.subteam_id or employee_prv_performance.source is distinct from excluded.source
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
