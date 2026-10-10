import type { Database } from "../../../infrastructure/database/pool.js"
import { localDateOf, localDatesInWindow } from "../../workflows/application/time-window.js"
import { resolveEmploymentStatusFreshness, resolveWorkScheduleFreshness, type EmploymentFreshnessState, type EmploymentStatusFreshness } from "../../people/application/employment-status-freshness.js"
import { evidenceRank, isOperationallyEligibleStatus, NON_ELIGIBLE_EMPLOYMENT_STATUSES, toCanonicalEmploymentStatus, type EmploymentStatus } from "../../people/domain/employment-status.js"
import { applicableHolidayDates, holidayConfidenceFor, type ApplicableHoliday, type HolidayConfidence, type HolidayScope } from "../../people/domain/holiday-applicability.js"
import { type ScheduleException, type ScheduleExceptionCode } from "../../people/domain/schedule-exception.js"
import { evidenceSourcesEnabled, type WorkActivityEvidence, type WorkActivityEvidenceSources } from "../../people/domain/work-activity-evidence.js"
import { DEFAULT_HOLIDAY_FALLBACK_POLICY, resolveScheduledDay, type HolidayFallbackPolicy, type ScheduleBasis, type ScheduleDay, type ScheduleType } from "../../people/domain/work-schedule.js"
import { resolveWorkday, type ResolvedWorkday } from "../../people/domain/workday-resolution.js"
import type { WorkdayAvailabilityState, WorkdayDataAvailability } from "../../people/domain/workday-data-availability.js"
import type { WorkdayClassificationRef } from "../../people/domain/workday-classification.js"
import { availabilityByDate, loadDataAvailabilityContext, type DataAvailabilityContext } from "../../people/application/data-availability-service.js"
import { listActiveClassifications } from "../../people/application/workday-classification-service.js"
import { applyZeroContribution, combineWindowComponents, type AggregatedWindowValue, type MeasurementAggregation, type OperationalAggregationKind, type RawWindowComponents, type UnjustifiedAbsencePolicy } from "../domain/operational-aggregation.js"

/**
 * Resolvedor ÚNICO de medições operacionais (camada 1, `indicator_measurements`). Uma query por
 * janela — pooled (a estrutura inteira como uma unidade, modo Consolidado/Condition) ou agrupada
 * por colaborador (Ranking/quartil, N colaboradores em lote, nunca N+1). Devolve, além do valor,
 * a evidência do cálculo (janela, método, amostra, dias com dado, cobertura, numerador/
 * denominador) — é o que o QA Lab mostra.
 */
export type IndicatorOperationalDefinition = {
  id: string
  code: string
  unit: string
  direction: "HIGHER" | "LOWER" | "TARGET"
  kind: OperationalAggregationKind
  dailySupported: boolean
  /** Como uma FALTA INJUSTIFICADA confirmada entra neste indicador (operational-aggregation.ts). */
  unjustifiedAbsencePolicy: UnjustifiedAbsencePolicy
}

export type OperationalWindowInput = {
  indicatorCode: string
  subjectIds: string[]
  window: { start: Date; end: Date }
  aggregation: MeasurementAggregation
  /** Dias úteis esperados na janela (só metadata de cobertura — nunca vira regra silenciosa). */
  expectedDays?: number
  /** Timezone IANA da organização — define o "dia local" ao contar dias com medição. */
  timeZone?: string
  /** "Agora" da avaliação (freshness da fonte de situação funcional) — padrão: relógio real. */
  now?: Date
  /** Memo por request da resolução de dias de trabalho (ver `WorkdayResolutionCache`) — opcional, nunca muda o resultado. */
  workdayCache?: WorkdayResolutionCache
}

/**
 * Elegibilidade de UM colaborador numa janela — resultado rico do resolvedor único
 * (`resolveEligibleDaysBySubject`): contagens (produção) + datas (trace/testes).
 *
 * REGRA FINAL (única, usada por Condition/Ranking/quartil/Analytics/QA) — PLANEJADO × OBSERVADO
 * (people/domain/workday-resolution.ts): um dia é elegível somente se
 *   A. a pessoa já estava admitida (`people.hired_at`);
 *   B. a situação funcional na data era EM_PRODUCAO (people/domain/employment-status.ts) — SOBERANA:
 *      produção observada com situação não produtiva NÃO torna o dia elegível (vira conflito);
 *   C. houve EVIDÊNCIA de atividade (interação do colaborador ou medição de indicador marcado como
 *      prova — people/domain/work-activity-evidence.ts): trabalhou, mesmo que o plano dissesse folga/
 *      day off/banco de horas (o plano fica registrado em `observed.workedDespitePlan`); OU, sem evidência,
 *   D. não existe exceção individual NON_WORKING (banco de horas, day off, folga extraordinária,
 *      atestado, ajuste de escala — people/domain/schedule-exception.ts) — a exceção vence a escala;
 *   E. a escala dizia que ela deveria trabalhar (people/domain/work-schedule.ts — calendário
 *      explícito > regime 6x1 sem folga informada = desconhecido > fallback legado seg–sex);
 *   F. no fallback, não há feriado aplicável à capital operacional com política EXCLUDE
 *      (people/domain/holiday-applicability.ts) — escala explícita sempre vence feriado.
 * A causa de exclusão é contada UMA vez por dia, nesta precedência (admissão > situação > exceção >
 * escala > feriado > escala desconhecida) — totais fecham. Não elegível ≠ performance zero.
 * MEDIÇÕES de datas não elegíveis ficam FORA de todo cálculo operacional (numerador, denominador,
 * amostra, média, soma, último valor) e continuam no banco — ver `eligibleMeasurementSql`.
 */
export type EligibilityResult = {
  /** Dias do calendário local dentro da janela (todos, inclusive fim de semana). */
  calendarDays: number
  /** Dias em que a escala (explícita ou fallback) previa trabalho. */
  scheduledWorkDays: number
  /** Compatibilidade: mesmo valor de `scheduledWorkDays` (consumidores anteriores liam "dias úteis"). */
  businessDays: number
  eligibleDays: number
  excludedBeforeHire: number
  /** Dias programados para trabalho excluídos por situação funcional, por status (ex.: FERIAS: 3, INSS: 2). */
  excludedByStatus: Partial<Record<EmploymentStatus, number>>
  /** Exceções individuais NON_WORKING (banco de horas, day off, folga extraordinária) em dias que seriam elegíveis, por código. */
  excludedByScheduleException: Partial<Record<ScheduleExceptionCode, number>>
  /** Folgas programadas (escala explícita) ou fim de semana do fallback legado. */
  excludedByScheduledDayOff: number
  /** Feriado aplicável tratado como folga — só no fallback legado com política EXCLUDE (escala explícita vence feriado). */
  excludedByHoliday: number
  /** Regime 6x1 conhecido sem a folga informada nessa data: a INIA não inventa — o dia fica fora, sem virar "deveria produzir". */
  excludedByUnknownSchedule: number
  eligibleDates: string[]
  /** OBSERVADO: dias com evidência de atividade, plano superado pela realidade, produção ausente/inconsistente. */
  observed: EligibilityObservedSummary
  /**
   * Confiança do estado funcional por trás dos dias ELEGÍVEIS: a Central sabe quando a fonte de
   * situação carregou pela última vez. Se ela está ATRASADA (fora da cadência) e um dia elegível
   * é posterior à última carga sem ausência explícita cobrindo-o, a INIA não sabe com segurança
   * se a pessoa deveria ter produzido — `unconfirmedDays` conta esses dias. FRESH/UNKNOWN nunca
   * marcam dia como não confirmado (latência dentro da cadência é aceita; sem feed = legado).
   */
  statusConfidence: EligibilityStatusConfidence
  /** Mesma filosofia para a escala: de onde veio o calendário e quanto dele é incerto. */
  scheduleConfidence: EligibilityScheduleConfidence
  /** Feriados: política da organização, capital operacional e se estadual/municipal puderam ser determinados. */
  holidayConfidence: EligibilityHolidayConfidence
}

export type EligibilityObservedSummary = {
  /** Dias elegíveis com evidência confiável de atividade (subconjunto de `eligibleDates`). */
  workedObservedDays: number
  observedDates: string[]
  /** Dias trabalhados que o PLANO dizia "não trabalha" — preservados como divergência plano × realidade. */
  workedDespitePlan: { exception: Partial<Record<ScheduleExceptionCode, number>>; scheduledDayOff: number; holiday: number; unknownSchedule: number }
  /** Programado, turno encerrado, fontes de evidência existem e nada foi observado (continua elegível; vira pendência). */
  missingExpectedProductionDays: number
  missingExpectedProductionDates: string[]
  /** Produção observada com situação funcional não produtiva (INSS, férias…): inconsistência — a situação não muda. */
  productionWithNonEligibleStatusDays: number
  evidenceSources: WorkActivityEvidenceSources
  /** Turno encerrado e os dados que poderiam explicar o dia ainda não deveriam ter chegado (D-1/D-2, RH): elegível, sem cobrança. */
  waitingForSourcesDays: number
  /** Prazo vencido e fonte relevante não entregou: problema de dado (alerta administrativo), nunca ausência do colaborador. */
  dataSourceDelayDays: number
  /** CLASSIFICAÇÃO humana: falta injustificada (continua elegível — política por indicador decide zero × sem amostra). */
  unjustifiedAbsenceDays: number
  unjustifiedAbsenceDates: string[]
  /** Ausência justificada classificada depois do fato (não elegível; contada em excludedByClassification). */
  justifiedAbsenceDays: number
  /** "Trabalhou — dados não chegaram": elegível, nada inventado. */
  workedDataMissingDays: number
}

export type EligibilityHolidayConfidence = {
  policy: HolidayFallbackPolicy
  operationalCapitalCode: string | null
  /** CAPITAL_UNKNOWN: só feriados nacionais e datas da organização são conhecidos — estadual/municipal não são inferidos. */
  confidence: HolidayConfidence
  /** Dias da janela com feriado aplicável (informativo — feriado não é folga automática). */
  applicableHolidayDays: number
}

export type EligibilityStatusConfidence = {
  freshness: EmploymentFreshnessState
  unconfirmedDays: number
  unconfirmedDates: string[]
  /** Dia local da última carga bem-sucedida da fonte de situação (null = nunca/não configurada). */
  lastSuccessLocalDate: string | null
}

export type EligibilityScheduleConfidence = {
  freshness: EmploymentFreshnessState
  /** Base predominante da escala na janela: EXPLICIT_SCHEDULE | LEGACY_WEEKDAY_FALLBACK | UNKNOWN_SCHEDULE | MIXED. */
  basis: ScheduleBasis | "MIXED"
  scheduleType: ScheduleType | null
  /** Dias elegíveis cuja escala é só presumida (fallback ou calendário anterior à última carga de uma fonte atrasada). */
  unconfirmedScheduleDays: number
  /** = excludedByUnknownSchedule (regime 6x1 sem folga informada). */
  unknownScheduleDays: number
  lastSuccessLocalDate: string | null
}

export type OperationalWindowResult = AggregatedWindowValue & {
  source: "MEASUREMENT"
  window: { start: string; end: string }
  /** Dias ELEGÍVEIS da janela (ver EligibilityResult) — denominador da cobertura. Estrutura pooled: dias úteis da janela. */
  expectedDays: number | null
  /** daysWithData ÷ expectedDays (0..1), null quando expectedDays não foi informado. */
  coverage: number | null
  /** Detalhe da elegibilidade (só quando resolvida por colaborador). */
  eligibility?: EligibilityResult
  /** Colaborador sem NENHUM dia elegível na janela (situação não produtiva/folga a janela inteira, ou antes da admissão): SEM DADOS, nunca 0 nem Q4. */
  noDataReason?: "NO_ELIGIBLE_DAYS"
  /** Medições da janela em datas NÃO elegíveis — preservadas no banco, fora de todo cálculo (só contagem, nunca linha a linha). */
  ignoredMeasurements: number
  /**
   * FALTA INJUSTIFICADA confirmada em dias elegíveis da janela: com política ZERO_CONTRIBUTION o
   * indicador recebe contribuição lógica 0 por dia sem medição (`zeroContributionDays`) — nunca uma
   * linha em indicator_measurements; com NO_SAMPLE nada entra (não existe amostra).
   */
  unjustifiedAbsence: { days: number; policy: UnjustifiedAbsencePolicy; zeroContributionDays: number }
}

/** Fallback documentado (organization-timezone.ts) — nunca UTC silencioso. */
const DEFAULT_TIMEZONE = "America/Fortaleza"

const DEFAULT_DEFINITION: Pick<IndicatorOperationalDefinition, "kind" | "dailySupported" | "direction" | "unjustifiedAbsencePolicy"> = { kind: "AVERAGE", dailySupported: false, direction: "HIGHER", unjustifiedAbsencePolicy: "NO_SAMPLE" }

export async function loadIndicatorOperationalDefinition(db: Database, indicatorCode: string): Promise<IndicatorOperationalDefinition | null> {
  const result = await db.query<{ id: string; code: string; unit: string; desired_direction: string; operational_aggregation: string | null; daily_supported: boolean | null; unjustified_absence_policy?: string | null }>(
    `select id, code, unit, desired_direction, unjustified_absence_policy, operational_aggregation, daily_supported from indicator_definitions where code = $1 order by created_at limit 1`,
    [indicatorCode],
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    id: row.id,
    code: row.code,
    unit: row.unit,
    direction: (row.desired_direction as IndicatorOperationalDefinition["direction"]) ?? DEFAULT_DEFINITION.direction,
    kind: (row.operational_aggregation as OperationalAggregationKind | null) ?? DEFAULT_DEFINITION.kind,
    dailySupported: row.daily_supported ?? DEFAULT_DEFINITION.dailySupported,
    unjustifiedAbsencePolicy: row.unjustified_absence_policy === "ZERO_CONTRIBUTION" ? "ZERO_CONTRIBUTION" : "NO_SAMPLE",
  }
}

/** Terceiro parâmetro das janelas: só a estratégia (compatibilidade) ou a definição inteira (aplica a política de falta injustificada). */
export type WindowDefinitionParam = OperationalAggregationKind | Pick<IndicatorOperationalDefinition, "kind" | "unjustifiedAbsencePolicy">

async function resolveDefinitionParam(db: Database, indicatorCode: string, param: WindowDefinitionParam | undefined): Promise<Pick<IndicatorOperationalDefinition, "kind" | "unjustifiedAbsencePolicy">> {
  if (param && typeof param === "object") return param
  if (param) return { kind: param, unjustifiedAbsencePolicy: "NO_SAMPLE" }
  const loaded = await loadIndicatorOperationalDefinition(db, indicatorCode)
  return { kind: loaded?.kind ?? DEFAULT_DEFINITION.kind, unjustifiedAbsencePolicy: loaded?.unjustifiedAbsencePolicy ?? DEFAULT_DEFINITION.unjustifiedAbsencePolicy }
}

type RawRow = {
  subject_id?: string
  avg_value: string | null
  min_value: string | null
  max_value: string | null
  sample_count: string
  sum_value?: string | null
  latest_value?: string | null
  weighted_sum?: string | null
  weight_total?: string | null
  numerator_sum?: string | null
  denominator_sum?: string | null
  rows_with_components?: string | null
  sample_total?: string | null
  days_with_data?: string | null
  ignored_count?: string | null
  absence_days_with_data?: string | null
}

const num = (value: string | null | undefined): number | null => (value === null || value === undefined ? null : Number(value))

function ignoredOf(row: RawRow | undefined): number {
  return row?.ignored_count !== undefined && row?.ignored_count !== null ? Number(row.ignored_count) : 0
}

/** Dias de falta injustificada que JÁ têm medição elegível deste indicador (não recebem zero por cima). */
function absenceDaysWithDataOf(row: RawRow | undefined): number {
  return row?.absence_days_with_data !== undefined && row?.absence_days_with_data !== null ? Number(row.absence_days_with_data) : 0
}

function toRaw(row: RawRow | undefined): RawWindowComponents {
  const sampleCount = row?.sample_count ? Number(row.sample_count) : 0
  return {
    sampleCount,
    daysWithData: row?.days_with_data !== undefined && row?.days_with_data !== null ? Number(row.days_with_data) : sampleCount,
    avg: num(row?.avg_value),
    min: num(row?.min_value),
    max: num(row?.max_value),
    sum: num(row?.sum_value),
    latest: num(row?.latest_value),
    weightedSum: num(row?.weighted_sum),
    weightTotal: num(row?.weight_total),
    numeratorSum: num(row?.numerator_sum),
    denominatorSum: num(row?.denominator_sum),
    rowsWithComponents: row?.rows_with_components !== undefined && row?.rows_with_components !== null ? Number(row.rows_with_components) : 0,
    sampleTotal: num(row?.sample_total),
  }
}

/**
 * Colunas de agregação — as 4 primeiras preservam o contrato antigo (avg/min/max/sample_count).
 * TODAS filtram por `${m}.eligible` (medição em data elegível): WEIGHTED_AVERAGE (numerador E
 * denominador), RATE (ocorrências E base), AVERAGE (valor E amostra), SUM e LATEST (último valor EM
 * DATA ELEGÍVEL, nunca a última linha física) respeitam a MESMA elegibilidade da cobertura.
 * `ignored_count` conta as medições da janela que ficaram de fora (auditoria/QA — nunca apagadas).
 */
function aggregateColumns(m: string, timeZoneParam: string): string {
  const f = `filter (where ${m}.eligible)`
  return `avg(${m}.value) ${f}::numeric avg_value, min(${m}.value) ${f}::numeric min_value, max(${m}.value) ${f}::numeric max_value, count(${m}.value) ${f}::int sample_count,
            sum(${m}.value) ${f}::numeric sum_value,
            (array_agg(${m}.value order by ${m}.period_end desc) ${f})[1]::numeric latest_value,
            sum(${m}.value * coalesce(${m}.denominator, 1)) ${f}::numeric weighted_sum,
            sum(coalesce(${m}.denominator, 1)) filter (where ${m}.eligible and ${m}.value is not null)::numeric weight_total,
            sum(${m}.numerator) ${f}::numeric numerator_sum,
            sum(${m}.denominator) ${f}::numeric denominator_sum,
            count(*) filter (where ${m}.eligible and ${m}.numerator is not null and ${m}.denominator is not null)::int rows_with_components,
            sum(${m}.sample_count) ${f}::int sample_total,
            count(distinct (${m}.period_start at time zone ${timeZoneParam})::date) ${f}::int days_with_data,
            count(*) filter (where not ${m}.eligible)::int ignored_count,
            count(distinct (${m}.period_start at time zone ${timeZoneParam})::date) filter (where ${m}.eligible and ${m}.on_absence_day)::int absence_days_with_data`
}

/** Sobreposição de intervalos — ver time-window.ts. Mesma cláusula em todas as consultas. */
const WINDOW_CLAUSE = `m.period_start < $4 and m.period_end > $3`

/**
 * PREDICADO CANÔNICO "medição em data elegível" — a MESMA elegibilidade que define o denominador da
 * cobertura (`resolveEligibleDaysBySubject`) decide quais medições entram no valor. Nunca uma
 * segunda interpretação em SQL: as datas elegíveis são calculadas em TS (admissão, situação, exceção,
 * escala, feriado, fuso) e entram na consulta como intervalos por pessoa (unnest) — em lote, nunca
 * N consultas por colaborador × dia.
 *
 *  - DAILY / HOURLY / INTERACTION: o dia local de `period_start` (fuso da organização) precisa estar
 *    em `eligibleDates` da pessoa. Nada de UTC ingênuo.
 *  - MONTHLY / CUSTOM: uma linha mensal não representa observações de um dia — descartá-la por uma
 *    regra diária seria sem semântica. Mantém o comportamento anterior: fora só se a situação
 *    funcional no dia local de `period_start` não era produtiva (`NON_ELIGIBLE_EMPLOYMENT_STATUSES`).
 * A linha NUNCA é apagada: correção de escala (quarta trabalha → folga) muda o cálculo, não o dado.
 */
export type EligibleMeasurementSqlParams = { alias: string; timeZoneParam: string; personIdsParam: string; fromParam: string; toParam: string; statusesParam: string; absencePersonIdsParam?: string; absenceDatesParam?: string }

export function eligibleMeasurementSql({ alias, timeZoneParam, personIdsParam, fromParam, toParam, statusesParam, absencePersonIdsParam, absenceDatesParam }: EligibleMeasurementSqlParams): { cte: string; join: string; predicate: string; absencePredicate: string } {
  const localDate = `(${alias}.period_start at time zone ${timeZoneParam})::date`
  const withAbsence = absencePersonIdsParam !== undefined && absenceDatesParam !== undefined
  return {
    cte: `eligible_days(person_id, from_date, to_date) as (select * from unnest(${personIdsParam}::uuid[], ${fromParam}::date[], ${toParam}::date[]))${withAbsence ? `,
     absence_days(person_id, absence_date) as (select * from unnest(${absencePersonIdsParam}::uuid[], ${absenceDatesParam}::date[]))` : ""}`,
    join: `left join eligible_days ed on ed.person_id = ${alias}.subject_id and ${localDate} between ed.from_date and ed.to_date${withAbsence ? `
         left join absence_days ad on ad.person_id = ${alias}.subject_id and ad.absence_date = ${localDate}` : ""}`,
    // Dia de FALTA INJUSTIFICADA classificada (elegível) — a agregação decide se recebe contribuição zero.
    absencePredicate: withAbsence ? `ad.person_id is not null` : `false`,
    predicate: `case when ${alias}.granularity in ('DAILY', 'HOURLY', 'INTERACTION') then ed.person_id is not null
         else not exists (
           select 1 from employee_status_periods sp
            where sp.person_id = ${alias}.subject_id and sp.status = any(${statusesParam}::text[])
              and ${localDate} between sp.effective_from and coalesce(sp.effective_to, 'infinity'::date)) end`,
  }
}

/**
 * Atalho para consultas simples de outros módulos (contexto de Agent, resumo por período): resolve a
 * elegibilidade dos sujeitos e devolve o fragmento SQL já numerado a partir de `firstParam` (fuso,
 * pessoas, de, até, situações) + os parâmetros a anexar — mesma regra, mesma ordem, zero cópia.
 */
export async function eligibleMeasurementFilter(db: Database, input: { alias?: string; subjectIds: string[]; window: { start: Date; end: Date }; timeZone: string; now?: Date; firstParam: number }): Promise<{ cte: string; join: string; predicate: string; params: unknown[] }> {
  const eligibility = await resolveEligibleDaysBySubject(db, input.subjectIds, input.window, input.timeZone, input.now ? { now: input.now } : {})
  const ranges = eligibleDayRanges(eligibility)
  const n = input.firstParam
  const sql = eligibleMeasurementSql({ alias: input.alias ?? "m", timeZoneParam: `$${n}`, personIdsParam: `$${n + 1}`, fromParam: `$${n + 2}`, toParam: `$${n + 3}`, statusesParam: `$${n + 4}` })
  return { ...sql, params: [input.timeZone, ranges.personIds, ranges.from, ranges.to, NON_ELIGIBLE_EMPLOYMENT_STATUSES] }
}

/** Intervalos contíguos de datas elegíveis por pessoa — parâmetros compactos para `eligibleMeasurementSql`. */
export type EligibleDayRanges = { personIds: string[]; from: string[]; to: string[] }

/** Dias de falta injustificada CLASSIFICADA por pessoa (pares pessoa × data) — entram na consulta para `absence_days_with_data`. */
export type UnjustifiedAbsenceDays = { personIds: string[]; dates: string[] }

export function unjustifiedAbsenceDays(eligibility: ReadonlyMap<string, Pick<EligibilityResult, "observed">>): UnjustifiedAbsenceDays {
  const result: UnjustifiedAbsenceDays = { personIds: [], dates: [] }
  for (const [personId, entry] of eligibility) {
    for (const date of entry.observed.unjustifiedAbsenceDates) {
      result.personIds.push(personId)
      result.dates.push(date)
    }
  }
  return result
}

export function eligibleDayRanges(eligibility: ReadonlyMap<string, Pick<EligibilityResult, "eligibleDates">>): EligibleDayRanges {
  const ranges: EligibleDayRanges = { personIds: [], from: [], to: [] }
  const push = (personId: string, from: string, to: string) => {
    ranges.personIds.push(personId)
    ranges.from.push(from)
    ranges.to.push(to)
  }
  for (const [personId, result] of eligibility) {
    const dates = [...result.eligibleDates].sort()
    let start: string | null = null
    let previous: string | null = null
    for (const date of dates) {
      if (start === null || previous === null || nextDay(previous) !== date) {
        if (start !== null && previous !== null) push(personId, start, previous)
        start = date
      }
      previous = date
    }
    if (start !== null && previous !== null) push(personId, start, previous)
  }
  return ranges
}

function nextDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10)
}

function finish(rawInput: RawWindowComponents, input: OperationalWindowInput, definition: Pick<IndicatorOperationalDefinition, "kind" | "unjustifiedAbsencePolicy">, eligibility: EligibilityResult | undefined, ignoredMeasurements: number, absenceDaysWithData = 0): OperationalWindowResult {
  const kind = definition.kind
  // FALTA INJUSTIFICADA confirmada (classificação humana) em dia elegível SEM medição: com política
  // ZERO_CONTRIBUTION o dia entra como contribuição lógica 0 (Produção); com NO_SAMPLE nada entra (TMA,
  // Qualidade — não existe amostra). Nunca uma linha em indicator_measurements.
  const absenceDays = eligibility?.observed.unjustifiedAbsenceDays ?? 0
  const zeroContributionDays = definition.unjustifiedAbsencePolicy === "ZERO_CONTRIBUTION" ? Math.max(0, absenceDays - absenceDaysWithData) : 0
  const raw = zeroContributionDays > 0 ? applyZeroContribution(rawInput, zeroContributionDays) : rawInput
  const combined = combineWindowComponents(raw, input.aggregation, kind)
  const expectedDays = eligibility?.eligibleDays ?? input.expectedDays ?? null
  const base = {
    ...combined,
    ...(zeroContributionDays > 0 ? { method: `${combined.method} · ${zeroContributionDays} dia(s) de falta injustificada com contribuição zero` } : {}),
    source: "MEASUREMENT" as const,
    window: { start: input.window.start.toISOString(), end: input.window.end.toISOString() },
    expectedDays,
    // Cobertura e valor olham para o MESMO universo: dias com medição ELEGÍVEL (ou zero lógico) ÷ dias elegíveis.
    coverage: expectedDays !== null && expectedDays > 0 ? Math.min(1, combined.daysWithData / expectedDays) : null,
    ...(eligibility ? { eligibility } : {}),
    ignoredMeasurements,
    unjustifiedAbsence: { days: absenceDays, policy: definition.unjustifiedAbsencePolicy, zeroContributionDays },
  }
  // Zero dias elegíveis (a janela inteira em férias/afastamento, ou anterior à admissão): não
  // "deveria ter produzido" — SEM DADOS com motivo explícito, nunca valor 0, cobertura 0% ou Q4.
  if (eligibility && eligibility.eligibleDays === 0) return { ...base, value: null, coverage: null, noDataReason: "NO_ELIGIBLE_DAYS" }
  return base
}

/**
 * Fontes de evidência de atividade da organização (people/domain/work-activity-evidence.ts): UMA
 * consulta por chamada — interações existem? quais indicadores ativos estão marcados como prova?
 */
export async function loadWorkActivityEvidenceSources(db: Database, organizationId: string): Promise<WorkActivityEvidenceSources> {
  const [interactions, indicators] = await Promise.all([
    db.query<{ present: boolean }>(`select exists(select 1 from interactions where organization_id = $1) present`, [organizationId]),
    db.query<{ code: string }>(`select code from indicator_definitions where organization_id = $1 and active and proves_work_activity order by code`, [organizationId]),
  ])
  return { interactions: interactions.rows[0]?.present === true, indicatorCodes: indicators.rows.map((row) => row.code) }
}

/**
 * Evidência OBSERVADA por pessoa × dia local (WorkActivityEvidence), em lote: interações do
 * colaborador iniciadas no dia + medições diárias de indicadores MARCADOS como prova (volume/amostra
 * > 0 quando informado). Duas consultas para N pessoas, nunca por pessoa. Sem fonte configurada,
 * nada é consultado (a ausência de evidência não significaria nada).
 */
export async function loadWorkActivityEvidence(db: Database, subjectIds: string[], firstDate: string, lastDate: string, timeZone: string, sources: WorkActivityEvidenceSources): Promise<Map<string, Map<string, WorkActivityEvidence>>> {
  const bySubject = new Map<string, Map<string, WorkActivityEvidence>>()
  if (subjectIds.length === 0) return bySubject
  const at = (personId: string, date: string) => {
    const days = bySubject.get(personId) ?? new Map<string, WorkActivityEvidence>()
    bySubject.set(personId, days)
    const existing = days.get(date)
    if (existing) return existing
    const created: WorkActivityEvidence = { date, interactionCount: 0, indicatorCodes: [] }
    days.set(date, created)
    return created
  }
  const [interactions, measurements] = await Promise.all([
    sources.interactions
      ? db.query<{ operator_id: string; local_date: string; total: number }>(
          `select operator_id, to_char((started_at at time zone $4)::date, 'YYYY-MM-DD') local_date, count(*)::int total
             from interactions
            where operator_id = any($1::uuid[]) and started_at >= ($2::date::timestamp at time zone $4) - interval '1 day' and started_at < ($3::date::timestamp at time zone $4) + interval '2 days'
            group by 1, 2`,
          [subjectIds, firstDate, lastDate, timeZone],
        )
      : Promise.resolve({ rows: [] as { operator_id: string; local_date: string; total: number }[] }),
    sources.indicatorCodes.length > 0
      ? db.query<{ subject_id: string; local_date: string; codes: string[] }>(
          `select m.subject_id, to_char((m.period_start at time zone $4)::date, 'YYYY-MM-DD') local_date, array_agg(distinct i.code order by i.code) codes
             from indicator_definitions i
             join indicator_measurements m on m.indicator_definition_id = i.id
            where i.proves_work_activity and i.active and m.subject_type = 'PERSON' and m.subject_id = any($1::uuid[])
              and m.granularity in ('DAILY', 'HOURLY', 'INTERACTION') and m.value is not null
              and coalesce(m.denominator, 1) > 0 and coalesce(m.sample_count, 1) > 0
              and m.period_start >= ($2::date::timestamp at time zone $4) - interval '1 day' and m.period_start < ($3::date::timestamp at time zone $4) + interval '2 days'
            group by 1, 2`,
          [subjectIds, firstDate, lastDate, timeZone],
        )
      : Promise.resolve({ rows: [] as { subject_id: string; local_date: string; codes: string[] }[] }),
  ])
  for (const row of interactions.rows) {
    const date = String(row.local_date).slice(0, 10)
    if (date < firstDate || date > lastDate) continue
    at(row.operator_id, date).interactionCount += Number(row.total)
  }
  for (const row of measurements.rows) {
    const date = String(row.local_date).slice(0, 10)
    if (date < firstDate || date > lastDate) continue
    const evidence = at(row.subject_id, date)
    evidence.indicatorCodes = [...new Set([...evidence.indicatorCodes, ...row.codes])].sort()
  }
  return bySubject
}

/** Hora local (HH:MM) de um instante no fuso — para comparar com `shift_end`. */
function localTimeOf(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date)
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00"
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00"
  return `${hour}:${minute}`
}

/**
 * "O turno/dia já encerrou?" — dias anteriores a hoje (local): sim; hoje: só depois do `shift_end`
 * explícito da escala; sem `shift_end` informado: só quando a data operacional encerrar (fallback
 * seguro documentado — nunca um horário arbitrário). Datas futuras: não.
 */
export function workdayClosed(date: string, shiftEnd: string | null | undefined, now: Date, timeZone: string): boolean {
  const today = localDateOf(now, timeZone)
  if (date < today) return true
  if (date > today) return false
  return shiftEnd ? localTimeOf(now, timeZone) >= shiftEnd.slice(0, 5) : false
}

export type SubjectWorkdays = {
  days: ResolvedWorkday[]
  /** Disponibilidade dos dados por data (organização) — a mesma para todas as pessoas da chamada. */
  availability: ReadonlyMap<string, WorkdayDataAvailability>
  calendarDays: number
  /** Dias em que a ESCALA (sem exceção) previa trabalho — fato do calendário. */
  scheduledWorkDays: number
  statusConfidence: EligibilityStatusConfidence
  scheduleConfidence: EligibilityScheduleConfidence
  holidayConfidence: EligibilityHolidayConfidence
  evidenceSources: WorkActivityEvidenceSources
}

export type WorkdayResolutionOptions = {
  now?: Date
  freshness?: EmploymentStatusFreshness
  scheduleFreshness?: EmploymentStatusFreshness
  evidenceSources?: WorkActivityEvidenceSources
  /** Contexto de disponibilidade da Central (feeds + overrides) — carregado uma vez por chamada quando ausente. */
  availabilityContext?: DataAvailabilityContext
  /** Memo da resolução por (pessoas, janela, fuso, agora): quem avalia N indicadores sobre a MESMA
   * população e janela (área de Indicadores: janela atual/anterior × quartil dos pares por
   * indicador) resolve os dias de trabalho uma vez, não uma por indicador. Escopo = um request. */
  cache?: WorkdayResolutionCache
}

export type WorkdayResolutionCache = Map<string, Promise<Map<string, SubjectWorkdays>>>

function workdayCacheKey(subjectIds: string[], window: { start: Date; end: Date }, timeZone: string, options: WorkdayResolutionOptions): string {
  return JSON.stringify([[...subjectIds].sort(), window.start.toISOString(), window.end.toISOString(), timeZone, options.now?.toISOString() ?? null, options.freshness ?? null, options.scheduleFreshness ?? null, options.evidenceSources ?? null])
}

/**
 * RESOLVEDOR ÚNICO dos dias de trabalho por colaborador na janela — PLANEJADO + OBSERVADO = RESOLVIDO
 * (people/domain/workday-resolution.ts). Condition, Ranking, quartil, Analytics, QA, o Calendário
 * da equipe, o job de reconciliação e a SELEÇÃO DE MEDIÇÕES usam este. Para cada pessoa × data local:
 *   1. admitida? 2. situação EM_PRODUCAO? (soberana) 3. evidência de atividade? (trabalhou — vence
 *   folga/day off/banco) 4. senão: exceção individual NON_WORKING? 5. escala explícita? 6. fallback
 *   permitido? 7. feriado aplicável à capital operacional com política EXCLUDE?
 * Zero N+1: uma consulta por tabela para N pessoas (pessoas, períodos, calendário, regimes, exceções,
 * catálogo de feriados, datas da organização, política, fontes de evidência, interações, medições
 * de prova) + 2 de freshness por chamada.
 */
export async function resolveWorkdaysBySubject(db: Database, subjectIds: string[], window: { start: Date; end: Date }, timeZone: string, options: WorkdayResolutionOptions = {}): Promise<Map<string, SubjectWorkdays>> {
  if (!options.cache || options.availabilityContext) return resolveWorkdaysBySubjectUncached(db, subjectIds, window, timeZone, options)
  const key = workdayCacheKey(subjectIds, window, timeZone, options)
  const cached = options.cache.get(key)
  if (cached) return cached
  const pending = resolveWorkdaysBySubjectUncached(db, subjectIds, window, timeZone, options)
  options.cache.set(key, pending)
  return pending
}

async function resolveWorkdaysBySubjectUncached(db: Database, subjectIds: string[], window: { start: Date; end: Date }, timeZone: string, options: WorkdayResolutionOptions): Promise<Map<string, SubjectWorkdays>> {
  const calendarDates = localDatesInWindow(window, timeZone)
  if (subjectIds.length === 0) return new Map()
  const firstDate = calendarDates[0] ?? null
  const lastDate = calendarDates[calendarDates.length - 1] ?? null
  type PeriodRow = { person_id: string; status: string; effective_from: string; effective_to: string | null; effective_to_explicit: boolean }
  type ScheduleRow = { person_id: string; schedule_date: string; scheduled_to_work: boolean; shift_start: string | null; shift_end: string | null }
  type RegimeRow = { person_id: string; schedule_type: string; effective_from: string; effective_to: string | null }
  type ExceptionRow = { person_id: string; exception_date: string; code: ScheduleExceptionCode; effect: "NON_WORKING"; raw_reason: string | null }
  type HolidayRow = { holiday_date: string; name: string; scope: HolidayScope; state_code: string | null; capital_code: string | null }
  const none = { rows: [] as never[] }
  const people = await db.query<{ id: string; organization_id: string; hired_at: string | null; operational_capital_code: string | null }>(`select id, organization_id, hired_at::text hired_at, operational_capital_code from people where id = any($1::uuid[])`, [subjectIds])
  const organizationId = people.rows[0]?.organization_id
  const ranged = firstDate !== null && lastDate !== null
  const [periods, schedule, regimes, exceptions, catalog, orgHolidays, policyRow, evidenceSources] = await Promise.all([
    ranged
      ? db.query<PeriodRow>(
          `select person_id, status, effective_from::text effective_from, effective_to::text effective_to, effective_to_explicit
             from employee_status_periods
            where person_id = any($1::uuid[]) and effective_from <= $3::date and (effective_to is null or effective_to >= $2::date)`,
          [subjectIds, firstDate, lastDate],
        )
      : Promise.resolve(none as { rows: PeriodRow[] }),
    ranged
      ? db.query<ScheduleRow>(
          `select person_id, schedule_date::text schedule_date, scheduled_to_work, shift_start::text shift_start, shift_end::text shift_end
             from employee_schedule_days where person_id = any($1::uuid[]) and schedule_date between $2::date and $3::date`,
          [subjectIds, firstDate, lastDate],
        )
      : Promise.resolve(none as { rows: ScheduleRow[] }),
    ranged
      ? db.query<RegimeRow>(
          `select person_id, schedule_type, effective_from::text effective_from, effective_to::text effective_to
             from employee_work_shifts where person_id = any($1::uuid[]) and schedule_type is not null and effective_from <= $3::date and (effective_to is null or effective_to >= $2::date)`,
          [subjectIds, firstDate, lastDate],
        )
      : Promise.resolve(none as { rows: RegimeRow[] }),
    ranged
      ? db.query<ExceptionRow>(
          `select person_id, exception_date::text exception_date, code, effect, raw_reason
             from employee_schedule_exceptions where person_id = any($1::uuid[]) and active and exception_date between $2::date and $3::date`,
          [subjectIds, firstDate, lastDate],
        )
      : Promise.resolve(none as { rows: ExceptionRow[] }),
    ranged
      ? db.query<HolidayRow>(`select holiday_date::text holiday_date, name, scope, state_code, capital_code from holiday_catalog where active and holiday_date between $1::date and $2::date`, [firstDate, lastDate])
      : Promise.resolve(none as { rows: HolidayRow[] }),
    ranged && organizationId
      ? db.query<HolidayRow>(`select holiday_date::text holiday_date, name, 'ORGANIZATION'::text scope, null::text state_code, null::text capital_code from organization_holidays where organization_id = $1 and active and holiday_date between $2::date and $3::date`, [organizationId, firstDate, lastDate])
      : Promise.resolve(none as { rows: HolidayRow[] }),
    organizationId ? db.query<{ holiday_fallback_policy: HolidayFallbackPolicy }>(`select holiday_fallback_policy from organizations where id = $1`, [organizationId]) : Promise.resolve(none as { rows: { holiday_fallback_policy: HolidayFallbackPolicy }[] }),
    options.evidenceSources ? Promise.resolve(options.evidenceSources) : organizationId ? loadWorkActivityEvidenceSources(db, organizationId) : Promise.resolve({ interactions: false, indicatorCodes: [] } satisfies WorkActivityEvidenceSources),
  ])
  // Confiança das fontes (situação e escala): UMA consulta à metadata da Central por chamada,
  // reaproveitada para todos os sujeitos — nunca por pessoa. Evidência observada: em lote, idem.
  const now = options.now ?? new Date()
  const evidenceEnabled = evidenceSourcesEnabled(evidenceSources)
  const [freshness, scheduleFreshness, evidenceBySubject, availabilityContext, classifications] = await Promise.all([
    options.freshness ?? (organizationId ? resolveEmploymentStatusFreshness(db, organizationId, now, timeZone) : Promise.resolve(null)),
    options.scheduleFreshness ?? (organizationId ? resolveWorkScheduleFreshness(db, organizationId, now, timeZone) : Promise.resolve(null)),
    ranged && evidenceEnabled ? loadWorkActivityEvidence(db, subjectIds, firstDate, lastDate, timeZone, evidenceSources) : Promise.resolve(new Map<string, Map<string, WorkActivityEvidence>>()),
    options.availabilityContext ?? (organizationId ? loadDataAvailabilityContext(db, organizationId, timeZone, now) : Promise.resolve({ organizationId: "", timeZone, feeds: [], indicatorOverrides: new Map() } satisfies DataAvailabilityContext)),
    ranged ? listActiveClassifications(db, { personIds: subjectIds, from: firstDate, to: lastDate }) : Promise.resolve([]),
  ])
  // DISPONIBILIDADE por data — decidida uma vez para a organização (os feeds são os mesmos para todos).
  const availability = availabilityByDate(availabilityContext, calendarDates, now, evidenceSources)
  const classificationsBySubject = new Map<string, Map<string, WorkdayClassificationRef>>()
  for (const row of classifications) {
    const map = classificationsBySubject.get(row.personId) ?? new Map<string, WorkdayClassificationRef>()
    map.set(row.workday, { id: row.id, classification: row.classification, reasonCode: row.reasonCode })
    classificationsBySubject.set(row.personId, map)
  }
  const holidayPolicy: HolidayFallbackPolicy = policyRow.rows[0]?.holiday_fallback_policy ?? DEFAULT_HOLIDAY_FALLBACK_POLICY
  const personById = new Map(people.rows.map((row) => [row.id, row]))
  const allHolidays: ApplicableHoliday[] = [...catalog.rows, ...orgHolidays.rows].map((row) => ({ date: row.holiday_date, name: row.name, scope: row.scope, stateCode: row.state_code, capitalCode: row.capital_code }))
  const periodsBySubject = new Map<string, { status: EmploymentStatus; from: string; to: string | null; explicit: boolean }[]>()
  for (const row of periods.rows) {
    const list = periodsBySubject.get(row.person_id) ?? []
    list.push({ status: toCanonicalEmploymentStatus(row.status) ?? "EM_PRODUCAO", from: row.effective_from, to: row.effective_to, explicit: evidenceRank({ effectiveTo: row.effective_to, effectiveToExplicit: row.effective_to_explicit }) === 2 })
    periodsBySubject.set(row.person_id, list)
  }
  const scheduleBySubject = new Map<string, Map<string, ScheduleDay>>()
  for (const row of schedule.rows) {
    const map = scheduleBySubject.get(row.person_id) ?? new Map<string, ScheduleDay>()
    map.set(row.schedule_date, { date: row.schedule_date, scheduledToWork: row.scheduled_to_work, shiftStart: row.shift_start, shiftEnd: row.shift_end })
    scheduleBySubject.set(row.person_id, map)
  }
  const regimesBySubject = new Map<string, RegimeRow[]>()
  for (const row of regimes.rows) {
    const list = regimesBySubject.get(row.person_id) ?? []
    list.push(row)
    regimesBySubject.set(row.person_id, list)
  }
  const exceptionsBySubject = new Map<string, Map<string, ScheduleException>>()
  for (const row of exceptions.rows) {
    const map = exceptionsBySubject.get(row.person_id) ?? new Map<string, ScheduleException>()
    // Uma exceção NON_WORKING por data basta para o efeito; a primeira (ordem estável) explica o porquê.
    if (!map.has(row.exception_date)) map.set(row.exception_date, { date: row.exception_date, code: row.code, effect: row.effect, rawReason: row.raw_reason })
    exceptionsBySubject.set(row.person_id, map)
  }
  // Feriados aplicáveis por capital: calculados uma vez por capital distinta (não por pessoa).
  const holidaysByCapital = new Map<string | null, Map<string, ApplicableHoliday[]>>()
  const holidaysFor = (capital: string | null) => {
    let map = holidaysByCapital.get(capital)
    if (!map) {
      map = applicableHolidayDates(allHolidays, capital)
      holidaysByCapital.set(capital, map)
    }
    return map
  }
  return new Map(
    subjectIds.map((subjectId) => {
      const person = personById.get(subjectId)
      const hired = person?.hired_at ?? null
      const capital = person?.operational_capital_code ?? null
      const allPeriods = periodsBySubject.get(subjectId) ?? []
      const nonEligible = allPeriods.filter((period) => !isOperationallyEligibleStatus(period.status))
      const explicitDays = scheduleBySubject.get(subjectId) ?? new Map<string, ScheduleDay>()
      const exceptionDays = exceptionsBySubject.get(subjectId) ?? new Map<string, ScheduleException>()
      const evidenceDays = evidenceBySubject.get(subjectId) ?? new Map<string, WorkActivityEvidence>()
      const classificationDays = classificationsBySubject.get(subjectId) ?? new Map<string, WorkdayClassificationRef>()
      const holidayDays = holidaysFor(capital)
      const regimeOn = (date: string): ScheduleType | null => {
        const regime = (regimesBySubject.get(subjectId) ?? []).find((row) => row.effective_from <= date && (row.effective_to === null || row.effective_to >= date))
        return regime ? (regime.schedule_type as ScheduleType) : null
      }
      const statusConfidence: EligibilityStatusConfidence = { freshness: freshness?.state ?? "UNKNOWN", unconfirmedDays: 0, unconfirmedDates: [], lastSuccessLocalDate: freshness?.lastSuccessLocalDate ?? null }
      const scheduleConfidence: EligibilityScheduleConfidence = { freshness: scheduleFreshness?.state ?? "UNKNOWN", basis: "EXPLICIT_SCHEDULE", scheduleType: regimeOn(lastDate ?? firstDate ?? "") ?? null, unconfirmedScheduleDays: 0, unknownScheduleDays: 0, lastSuccessLocalDate: scheduleFreshness?.lastSuccessLocalDate ?? null }
      const holidayConfidence: EligibilityHolidayConfidence = { policy: holidayPolicy, operationalCapitalCode: capital, confidence: holidayConfidenceFor(capital), applicableHolidayDays: 0 }
      const bases = new Set<ScheduleBasis>()
      let scheduledWorkDays = 0
      const days: ResolvedWorkday[] = calendarDates.map((date) => {
        const holiday = holidayDays.has(date)
        if (holiday) holidayConfidence.applicableHolidayDays += 1
        const explicit = explicitDays.get(date)
        const scheduleInput = { date, explicit, scheduleType: regimeOn(date), holiday, holidayPolicy }
        // "Programado para trabalhar" é um fato da ESCALA (calendário/fallback), independente de situação e exceção.
        const underlying = resolveScheduledDay(scheduleInput)
        const exception = exceptionDays.get(date) ?? null
        const planned = exception ? resolveScheduledDay({ ...scheduleInput, exception }) : underlying
        bases.add(planned.basis)
        if (planned.basis === "UNKNOWN_SCHEDULE") scheduleConfidence.unknownScheduleDays += 1
        if (underlying.scheduledToWork) scheduledWorkDays += 1
        const blocking = nonEligible.find((period) => period.from <= date && (period.to === null || period.to >= date))
        const day = resolveWorkday({
          date,
          hired: !(hired && date < hired),
          status: blocking?.status ?? null,
          planned,
          evidence: evidenceDays.get(date) ?? null,
          evidenceEnabled,
          dayClosed: workdayClosed(date, explicit?.shiftEnd ?? null, now, timeZone),
          availability: (availability.get(date)?.state ?? "AVAILABILITY_UNKNOWN") satisfies WorkdayAvailabilityState,
          classification: classificationDays.get(date) ?? null,
        })
        if (!day.eligible) return day
        // Dia elegível só por PRESUNÇÃO (nenhuma ausência explícita o cobre) depois da última carga
        // de uma fonte ATRASADA: "não sei com segurança se deveria produzir".
        if (statusConfidence.freshness === "STALE" && (statusConfidence.lastSuccessLocalDate === null || date > statusConfidence.lastSuccessLocalDate)) {
          const explicitPeriod = allPeriods.some((period) => period.explicit && period.from <= date && period.to !== null && period.to >= date)
          if (!explicitPeriod) {
            statusConfidence.unconfirmedDays += 1
            statusConfidence.unconfirmedDates.push(date)
          }
        }
        // Escala presumida: fallback legado, ou calendário explícito posterior à última carga de uma
        // fonte de escala atrasada (a folga pode ter mudado e a INIA ainda não sabe).
        if (planned.basis === "LEGACY_WEEKDAY_FALLBACK" || (scheduleConfidence.freshness === "STALE" && (scheduleConfidence.lastSuccessLocalDate === null || date > scheduleConfidence.lastSuccessLocalDate))) {
          scheduleConfidence.unconfirmedScheduleDays += 1
        }
        return day
      })
      scheduleConfidence.basis = bases.size === 1 ? [...bases][0]! : bases.size === 0 ? "EXPLICIT_SCHEDULE" : "MIXED"
      return [subjectId, { days, availability, calendarDays: calendarDates.length, scheduledWorkDays, statusConfidence, scheduleConfidence, holidayConfidence, evidenceSources }]
    }),
  )
}

/** Contagens de elegibilidade a partir dos dias resolvidos — a MESMA soma para produção e trace. */
export function summarizeWorkdays(subject: SubjectWorkdays): EligibilityResult {
  const result: EligibilityResult = {
    calendarDays: subject.calendarDays,
    scheduledWorkDays: subject.scheduledWorkDays,
    businessDays: subject.scheduledWorkDays,
    eligibleDays: 0,
    excludedBeforeHire: 0,
    excludedByStatus: {},
    excludedByScheduleException: {},
    excludedByScheduledDayOff: 0,
    excludedByHoliday: 0,
    excludedByUnknownSchedule: 0,
    eligibleDates: [],
    observed: { workedObservedDays: 0, observedDates: [], workedDespitePlan: { exception: {}, scheduledDayOff: 0, holiday: 0, unknownSchedule: 0 }, missingExpectedProductionDays: 0, missingExpectedProductionDates: [], productionWithNonEligibleStatusDays: 0, evidenceSources: subject.evidenceSources, waitingForSourcesDays: 0, dataSourceDelayDays: 0, unjustifiedAbsenceDays: 0, unjustifiedAbsenceDates: [], justifiedAbsenceDays: 0, workedDataMissingDays: 0 },
    statusConfidence: subject.statusConfidence,
    scheduleConfidence: subject.scheduleConfidence,
    holidayConfidence: subject.holidayConfidence,
  }
  const observed = result.observed
  for (const day of subject.days) {
    if (day.conflict === "PRODUCTION_WITH_NON_ELIGIBLE_STATUS") observed.productionWithNonEligibleStatusDays += 1
    switch (day.state) {
      case "BEFORE_HIRE":
        result.excludedBeforeHire += 1
        continue
      case "NON_ELIGIBLE_EMPLOYMENT_STATUS":
        result.excludedByStatus[day.status!] = (result.excludedByStatus[day.status!] ?? 0) + 1
        continue
      case "PLANNED_NON_WORKING":
        if (day.plannedCause === "EXCEPTION") result.excludedByScheduleException[day.planned.exception!.code] = (result.excludedByScheduleException[day.planned.exception!.code] ?? 0) + 1
        else if (day.plannedCause === "HOLIDAY") result.excludedByHoliday += 1
        else result.excludedByScheduledDayOff += 1
        continue
      case "INDETERMINATE":
        result.excludedByUnknownSchedule += 1
        continue
      case "CLASSIFIED_JUSTIFIED_ABSENCE":
        // Classificada DEPOIS do fato: sai do universo como uma exceção sairia (mesmo código quando há equivalente).
        observed.justifiedAbsenceDays += 1
        if (day.classification?.reasonCode && day.classification.reasonCode !== "OTHER_JUSTIFIED") {
          result.excludedByScheduleException[day.classification.reasonCode] = (result.excludedByScheduleException[day.classification.reasonCode] ?? 0) + 1
        } else result.excludedByScheduledDayOff += 1
        continue
      case "CLASSIFIED_UNJUSTIFIED_ABSENCE":
        observed.unjustifiedAbsenceDays += 1
        observed.unjustifiedAbsenceDates.push(day.date)
        break
      case "CLASSIFIED_WORKED_DATA_MISSING":
        observed.workedDataMissingDays += 1
        break
      case "WAITING_FOR_SOURCES":
        observed.waitingForSourcesDays += 1
        break
      case "DATA_SOURCE_DELAY":
        observed.dataSourceDelayDays += 1
        break
      case "WORKED_OBSERVED":
        observed.workedObservedDays += 1
        observed.observedDates.push(day.date)
        if (day.overridesPlan) {
          if (day.plannedCause === "EXCEPTION") observed.workedDespitePlan.exception[day.planned.exception!.code] = (observed.workedDespitePlan.exception[day.planned.exception!.code] ?? 0) + 1
          else if (day.plannedCause === "HOLIDAY") observed.workedDespitePlan.holiday += 1
          else if (day.plannedCause === "UNKNOWN_SCHEDULE") observed.workedDespitePlan.unknownSchedule += 1
          else observed.workedDespitePlan.scheduledDayOff += 1
        }
        break
      case "MISSING_EXPECTED_PRODUCTION":
        observed.missingExpectedProductionDays += 1
        observed.missingExpectedProductionDates.push(day.date)
        break
      case "PLANNED_WORK":
        break
    }
    result.eligibleDays += 1
    result.eligibleDates.push(day.date)
  }
  return result
}

/**
 * Elegibilidade por colaborador (contagens) — atalho sobre `resolveWorkdaysBySubject`. Férias/INSS/
 * folga/day off saem do DENOMINADOR: 4 dias trabalhados de 4 elegíveis = 100%, não 4/7. Produção
 * observada num dia planejado como folga ENTRA (dia trabalhado), e o plano original fica registrado.
 */
export async function resolveEligibleDaysBySubject(db: Database, subjectIds: string[], window: { start: Date; end: Date }, timeZone: string, options: WorkdayResolutionOptions = {}): Promise<Map<string, EligibilityResult>> {
  const workdays = await resolveWorkdaysBySubject(db, subjectIds, window, timeZone, options)
  return new Map([...workdays].map(([subjectId, subject]) => [subjectId, summarizeWorkdays(subject)]))
}

/** Parâmetros compartilhados das consultas de medição: elegibilidade por pessoa (intervalos) + situações não produtivas (linhas mensais/custom). */
async function eligibilityParams(db: Database, input: Pick<OperationalWindowInput, "subjectIds" | "window" | "timeZone" | "now" | "workdayCache">): Promise<{ eligibility: Map<string, EligibilityResult>; ranges: EligibleDayRanges; absence: UnjustifiedAbsenceDays }> {
  const eligibility = await resolveEligibleDaysBySubject(db, input.subjectIds, input.window, input.timeZone ?? DEFAULT_TIMEZONE, { ...(input.now ? { now: input.now } : {}), ...(input.workdayCache ? { cache: input.workdayCache } : {}) })
  return { eligibility, ranges: eligibleDayRanges(eligibility), absence: unjustifiedAbsenceDays(eligibility) }
}

const SQL = eligibleMeasurementSql({ alias: "m", timeZoneParam: "$5", personIdsParam: "$6", fromParam: "$7", toParam: "$8", statusesParam: "$9", absencePersonIdsParam: "$10", absenceDatesParam: "$11" })

/** Janela POOLED: todos os `subjectIds` como uma unidade (Σ numeradores ÷ Σ denominadores da estrutura). */
export async function resolveOperationalWindow(db: Database, input: OperationalWindowInput, kind?: WindowDefinitionParam): Promise<OperationalWindowResult> {
  const definition = await resolveDefinitionParam(db, input.indicatorCode, kind)
  const { eligibility, ranges, absence } = await eligibilityParams(db, input)
  // Um único colaborador: dias elegíveis respeitam a admissão dele. Estrutura pooled: dias esperados informados pelo chamador.
  const eligible = input.subjectIds.length === 1 && input.expectedDays !== undefined ? eligibility.get(input.subjectIds[0]!) : undefined
  const result = await db.query<RawRow>(
    `with ${SQL.cte},
     scoped as (
       select m.*, ${SQL.predicate} eligible, ${SQL.absencePredicate} on_absence_day
         from indicator_measurements m
         join indicator_definitions i on i.id = m.indicator_definition_id
         ${SQL.join}
        where i.code = $1 and m.subject_type = 'PERSON' and m.subject_id = any($2::uuid[]) and ${WINDOW_CLAUSE})
     select ${aggregateColumns("m", "$5")} from scoped m`,
    [input.indicatorCode, input.subjectIds, input.window.start.toISOString(), input.window.end.toISOString(), input.timeZone ?? DEFAULT_TIMEZONE, ranges.personIds, ranges.from, ranges.to, NON_ELIGIBLE_EMPLOYMENT_STATUSES, absence.personIds, absence.dates],
  )
  return finish(toRaw(result.rows[0]), input, definition, eligible, ignoredOf(result.rows[0]), absenceDaysWithDataOf(result.rows[0]))
}

/** Janela POR COLABORADOR: um resultado por `subjectId`, numa única query (nunca N+1). Quem não tem linha na janela não aparece no mapa. */
export async function resolveOperationalWindowBySubject(db: Database, input: OperationalWindowInput, kind?: WindowDefinitionParam): Promise<Map<string, OperationalWindowResult>> {
  const definition = await resolveDefinitionParam(db, input.indicatorCode, kind)
  const { eligibility, ranges, absence } = await eligibilityParams(db, input)
  const result = await db.query<RawRow>(
    `with ${SQL.cte},
     scoped as (
       select m.*, ${SQL.predicate} eligible, ${SQL.absencePredicate} on_absence_day
         from indicator_measurements m
         join indicator_definitions i on i.id = m.indicator_definition_id
         ${SQL.join}
        where i.code = $1 and m.subject_type = 'PERSON' and m.subject_id = any($2::uuid[]) and ${WINDOW_CLAUSE})
     select m.subject_id, ${aggregateColumns("m", "$5")} from scoped m group by m.subject_id`,
    [input.indicatorCode, input.subjectIds, input.window.start.toISOString(), input.window.end.toISOString(), input.timeZone ?? DEFAULT_TIMEZONE, ranges.personIds, ranges.from, ranges.to, NON_ELIGIBLE_EMPLOYMENT_STATUSES, absence.personIds, absence.dates],
  )
  const bySubject = new Map<string, OperationalWindowResult>()
  const seen = new Set<string>()
  for (const row of result.rows) {
    if (!row.subject_id) continue
    seen.add(row.subject_id)
    const resolved = finish(toRaw(row), input, definition, input.expectedDays !== undefined ? eligibility.get(row.subject_id) : undefined, ignoredOf(row), absenceDaysWithDataOf(row))
    // Sem valor (ou sem nenhum dia elegível) = fora da população ranqueada — nunca Q4 por omissão.
    if (resolved.value !== null) bySubject.set(row.subject_id, resolved)
  }
  // Colaborador SEM linha na janela mas com falta injustificada e política ZERO_CONTRIBUTION: o zero lógico
  // é um resultado conhecido (Produção = 0), não "sem dados" — entra na população com contribuição zero.
  if (definition.unjustifiedAbsencePolicy === "ZERO_CONTRIBUTION" && input.expectedDays !== undefined) {
    for (const [subjectId, entry] of eligibility) {
      if (seen.has(subjectId) || entry.observed.unjustifiedAbsenceDays === 0) continue
      const resolved = finish(toRaw(undefined), input, definition, entry, 0, 0)
      if (resolved.value !== null) bySubject.set(subjectId, resolved)
    }
  }
  return bySubject
}

/** Uma medição diária ELEGÍVEL por data local, com os componentes brutos e o valor combinado
 * pela semântica — a série que as Tools de investigação usam (histórico operacional, picos,
 * segmentação por dia/dia da semana/semana). Só o colaborador (`subjectIds` = 1). Mesma
 * elegibilidade/predicado das janelas; medições em datas não elegíveis ficam de fora. */
export type OperationalDailyPoint = { date: string; raw: RawWindowComponents; value: AggregatedWindowValue }

export async function resolveOperationalDailySeries(db: Database, input: OperationalWindowInput, kind?: WindowDefinitionParam): Promise<{ points: OperationalDailyPoint[]; eligibility: EligibilityResult | undefined; ignoredMeasurements: number }> {
  const definition = await resolveDefinitionParam(db, input.indicatorCode, kind)
  const { eligibility, ranges, absence } = await eligibilityParams(db, input)
  const result = await db.query<RawRow & { local_date: string }>(
    `with ${SQL.cte},
     scoped as (
       select m.*, ${SQL.predicate} eligible, ${SQL.absencePredicate} on_absence_day
         from indicator_measurements m
         join indicator_definitions i on i.id = m.indicator_definition_id
         ${SQL.join}
        where i.code = $1 and m.subject_type = 'PERSON' and m.subject_id = any($2::uuid[]) and ${WINDOW_CLAUSE})
     select to_char((m.period_start at time zone $5)::date, 'YYYY-MM-DD') local_date, ${aggregateColumns("m", "$5")} from scoped m group by 1 order by 1`,
    [input.indicatorCode, input.subjectIds, input.window.start.toISOString(), input.window.end.toISOString(), input.timeZone ?? DEFAULT_TIMEZONE, ranges.personIds, ranges.from, ranges.to, NON_ELIGIBLE_EMPLOYMENT_STATUSES, absence.personIds, absence.dates],
  )
  let ignoredMeasurements = 0
  const points: OperationalDailyPoint[] = []
  for (const row of result.rows) {
    ignoredMeasurements += ignoredOf(row)
    const raw = toRaw(row)
    if (raw.sampleCount === 0) continue
    points.push({ date: row.local_date, raw, value: combineWindowComponents(raw, input.aggregation, definition.kind) })
  }
  return { points, eligibility: input.subjectIds.length === 1 ? eligibility.get(input.subjectIds[0]!) : undefined, ignoredMeasurements }
}

export type ClosedMonthsResult = {
  total: OperationalWindowResult
  months: { window: { start: Date; end: Date }; result: OperationalWindowResult }[]
  monthsWithData: number
}

/**
 * "Últimos N meses fechados" (Valor do indicador): UMA query com os N meses civis esperados —
 * componentes por mês (só-debug + detecção de mês sem medição) e o agregado da UNIÃO dos meses
 * (Σ numeradores ÷ Σ denominadores, nunca "média das médias mensais"). Um mês esperado sem
 * medição nunca é substituído por um mês mais antigo — quem chama decide que isso é SEM DADOS.
 * Elegibilidade resolvida UMA vez para a união dos meses (mesmo predicado das janelas).
 */
export async function resolveOperationalClosedMonths(
  db: Database,
  input: { indicatorCode: string; subjectIds: string[]; months: { start: Date; end: Date }[]; aggregation: MeasurementAggregation; expectedDaysByMonth?: number[]; timeZone?: string; now?: Date },
  kind?: WindowDefinitionParam,
): Promise<ClosedMonthsResult> {
  const definition = await resolveDefinitionParam(db, input.indicatorCode, kind)
  const union = { start: input.months[input.months.length - 1]!.start, end: input.months[0]!.end }
  const { ranges, absence } = await eligibilityParams(db, { subjectIds: input.subjectIds, window: union, ...(input.timeZone ? { timeZone: input.timeZone } : {}), ...(input.now ? { now: input.now } : {}) })
  const result = await db.query<RawRow & { missing_months: string; months: (RawRow & { month_start: string })[] | null }>(
    `with expected(month_start, month_end) as (
       select * from unnest($3::timestamptz[], $4::timestamptz[])
     ),
     ${SQL.cte},
     matched as (
       select e.month_start, m.value, m.numerator, m.denominator, m.sample_count, m.period_start, m.period_end, ${SQL.predicate} eligible, ${SQL.absencePredicate} on_absence_day
       from expected e
       join indicator_measurements m
         on m.period_start < e.month_end and m.period_end > e.month_start
         and m.indicator_definition_id = (select id from indicator_definitions where code = $1 order by created_at limit 1)
         and m.subject_type = 'PERSON' and m.subject_id = any($2::uuid[])
       ${SQL.join}
     ),
     per_month as (
       select e.month_start, ${aggregateColumns("mm", "$5")}
       from expected e left join matched mm on mm.month_start = e.month_start
       group by e.month_start
     )
     select
       (select count(*) from per_month where sample_count = 0)::int missing_months,
       ${aggregateColumns("m", "$5")},
       (select json_agg(row_to_json(per_month) order by month_start) from per_month) months
     from matched m`,
    [input.indicatorCode, input.subjectIds, input.months.map((month) => month.start.toISOString()), input.months.map((month) => month.end.toISOString()), input.timeZone ?? DEFAULT_TIMEZONE, ranges.personIds, ranges.from, ranges.to, NON_ELIGIBLE_EMPLOYMENT_STATUSES, absence.personIds, absence.dates],
  )
  const row = result.rows[0]
  const totalExpected = input.expectedDaysByMonth?.reduce((sum, days) => sum + days, 0)
  // Meses fechados: a falta injustificada não é aplicada por mês (o detalhe mensal não carrega elegibilidade) — só o total pooled a ignora também (sem eligibility, zero dias).
  const total = finish(toRaw(row), { ...input, window: union, ...(totalExpected !== undefined ? { expectedDays: totalExpected } : {}) }, definition, undefined, ignoredOf(row))
  // Detalhe por mês — aceita também o formato camelCase (monthStart/sampleCount/avgValue) do
  // contrato anterior desta consulta, pra não quebrar traces/fakes que ainda o usam.
  const detailsByStart = new Map<string, RawRow>()
  for (const month of row?.months ?? []) {
    const legacy = month as unknown as { monthStart?: string; sampleCount?: number | string; avgValue?: string | null }
    const start = month.month_start ?? legacy.monthStart
    if (!start) continue
    const time = new Date(start).getTime()
    if (Number.isNaN(time)) continue
    detailsByStart.set(new Date(time).toISOString(), {
      ...month,
      sample_count: month.sample_count ?? (legacy.sampleCount !== undefined ? String(legacy.sampleCount) : "0"),
      avg_value: month.avg_value ?? legacy.avgValue ?? null,
    })
  }
  const months = input.months.map((month, index) => {
    const detail = detailsByStart.get(month.start.toISOString())
    const expectedDays = input.expectedDaysByMonth?.[index]
    return { window: month, result: finish(toRaw(detail), { ...input, window: month, ...(expectedDays !== undefined ? { expectedDays } : {}) }, definition, undefined, ignoredOf(detail)) }
  })
  const missing = row?.missing_months !== undefined && row?.missing_months !== null ? Number(row.missing_months) : input.months.length
  return { total, months, monthsWithData: input.months.length - missing }
}
