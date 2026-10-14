import type { Queryable } from "../../people/application/schedule-exception-service.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { evaluateDataCondition, type DataConditionConfig } from "../../workflows/application/condition-evaluator.js"
import { localDateOf, resolveTimeWindow } from "../../workflows/application/time-window.js"
import { resolveEligibleDaysBySubject } from "../../indicators/application/operational-measurement-resolver.js"
import { resolveEmployeeStatusAt } from "../../people/application/employment-status-service.js"
import { resolveEmploymentStatusFreshness } from "../../people/application/employment-status-freshness.js"
import { isOperationallyEligibleStatus } from "../../people/domain/employment-status.js"
import { visibleInFollowUpSql } from "../../feedbacks/application/follow-up-visibility.js"
import { NUMERIC_COMPARATOR_TEXT, numericComparatorMatches, type PolicyCondition } from "../domain/policy-definition.js"
import type { ConditionOutcome, ConditionResolver, FactReference } from "../domain/policy-evaluation.js"

/**
 * FATOS de uma avaliação de política — um resolvedor por tipo de condição. Só leitura (roda igual no QA Lab, com banco
 * somente leitura) e nunca chama IA. A condição de INDICADOR é a MESMA avaliação das Conditions do Workflow
 * (`evaluateDataCondition`): `true` → atendida, `false` → não atendida, `no_data` → INCONCLUSIVA (nunca "desempenho ruim").
 * As demais leem registros da própria INIA (intervenções, diagnósticos, feedbacks), em que ausência é fato.
 */
export type PolicySubject = {
  organizationId: string
  personId: string
  /** Indicador principal da política (assunto). */
  policyIndicatorCode: string | null
  /** Identidade do assunto das intervenções ("INDICATOR:TMA", "POLICY:X"). */
  subjectKey: string
  /** Instante de referência da avaliação (o relógio da execução; numa reavaliação, o da avaliação original). */
  asOf: Date
  timeZone: string
}

type Db = Queryable | Database
const DAY_MS = 86_400_000

const fmt = (value: unknown) => (typeof value === "number" ? (Number.isInteger(value) ? String(value) : value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })) : value === null || value === undefined ? "—" : String(value))
const AGGREGATION_TEXT: Record<string, string> = { COUNT: "ocorrências", AVERAGE: "média", WEIGHTED_AVERAGE: "média ponderada", SUM: "soma", LATEST: "último valor", MINIMUM: "mínimo", MAXIMUM: "máximo" }
const SOURCE_TEXT: Record<string, string> = { MEASUREMENT: "medição diária", INDICATOR_ACHIEVEMENT: "atingimento oficial", PRV_ACHIEVEMENT: "atingimento oficial do PRV" }
const METRIC_TEXT: Record<string, string> = { INDICATOR_VALUE: "valor oficial", INDICATOR_ACHIEVEMENT: "atingimento oficial", INDICATOR_QUARTILE: "quartil oficial", INDICATOR_WEIGHT: "peso", PRV_ACHIEVEMENT: "atingimento do PRV", PRV_QUARTILE: "quartil oficial do PRV" }

async function indicatorLabels(db: Db, organizationId: string): Promise<Map<string, { name: string; unit: string }>> {
  const rows = await db.query<{ code: string; name: string; unit: string }>(`select code, name, unit from indicator_definitions where organization_id = $1`, [organizationId])
  return new Map(rows.rows.map((row) => [row.code, { name: row.name, unit: row.unit }]))
}

function windowText(window: unknown, timeZone: string): string | null {
  if (!window || typeof window !== "object") return null
  const { start, end } = window as { start?: string; end?: string }
  if (!start || !end) return null
  return `${localDateOf(new Date(start), timeZone)} a ${localDateOf(new Date(new Date(end).getTime() - 1), timeZone)}`
}

async function resolveIndicator(db: Db, subject: PolicySubject, condition: Extract<PolicyCondition, { kind: "INDICATOR" }>, labels: Map<string, { name: string; unit: string }>): Promise<ConditionOutcome> {
  const criterion = condition.criterion
  const config = { ...criterion } as unknown as DataConditionConfig
  const result = await evaluateDataCondition(db as Database, config, { operatorId: subject.personId, subjectIds: [subject.personId] }, subject.asOf, { timeZone: subject.timeZone, quartileCache: new Map() })
  if (!result) return { status: "INCONCLUSIVE", summary: "Condição de indicador sem consulta avaliável.", facts: {}, reasonCode: "NO_QUERY", references: [] }
  const evaluation = result.evaluation as Record<string, unknown>
  const code = (criterion.historicalQuery?.indicatorCode ?? criterion.performanceQuery?.indicatorCode ?? null) as string | null
  const name = condition.label ?? (code ? (labels.get(code)?.name ?? code) : "PRV")
  const status = result.branch === "true" ? "MET" : result.branch === "false" ? "NOT_MET" : "INCONCLUSIVE"
  const window = windowText(evaluation.window, subject.timeZone)
  const references: FactReference[] = []
  let summary: string
  switch (evaluation.kind) {
    case "historical_count":
      summary = `${name}: ${fmt(evaluation.count)} ocorrência(s)${window ? ` de ${window}` : ""} ${NUMERIC_COMPARATOR_TEXT[criterion.comparator as keyof typeof NUMERIC_COMPARATOR_TEXT] ?? criterion.comparator} ${fmt(evaluation.threshold)}`
      break
    case "historical_aggregate": {
      const source = SOURCE_TEXT[String(evaluation.source)] ?? String(evaluation.source)
      const head = `${name} (${AGGREGATION_TEXT[String(evaluation.aggregation)] ?? evaluation.aggregation}, ${source}${window ? `, ${window}` : ""})`
      if (status === "INCONCLUSIVE") summary = `${head}: ${evaluation.reasonText ?? "sem dados suficientes"}`
      else {
        const referenceKind = evaluation.referenceKind === "GOAL" ? "meta vigente" : evaluation.referenceKind === "PREVIOUS_PERIOD" ? "período anterior" : "referência"
        const compared = evaluation.changeMode === "PERCENT" ? `variação de ${fmt(evaluation.percentChange)}%` : fmt(evaluation.value)
        summary = `${head} = ${compared} ${NUMERIC_COMPARATOR_TEXT[criterion.comparator as keyof typeof NUMERIC_COMPARATOR_TEXT] ?? criterion.comparator} ${referenceKind} ${fmt(evaluation.reference)}`
      }
      break
    }
    case "performance":
      summary = status === "INCONCLUSIVE" ? `${name}: ${evaluation.reasonText ?? "sem fechamento oficial"}` : `${name} — ${METRIC_TEXT[String(evaluation.metric)] ?? evaluation.metric} (${evaluation.referencePeriod ?? "fechamento"}) = ${fmt(evaluation.value)}`
      break
    case "performance_recurrence":
      summary = status === "INCONCLUSIVE" ? `${name}: ${evaluation.reasonText ?? "histórico insuficiente"}` : `${name}: ${evaluation.matchQuartile} em ${fmt(evaluation.matchCount)} dos últimos ${fmt(evaluation.totalPeriods)} fechamentos oficiais (Q1 = melhor, Q4 = pior)`
      break
    default:
      summary = `${name}: ${status === "INCONCLUSIVE" ? (evaluation.reasonText ?? "sem dados") : "avaliado"}`
  }
  if (code || criterion.performanceQuery) {
    const periods = Array.isArray(evaluation.closures) ? (evaluation.closures as { referencePeriod?: string; label?: string }[]).map((closure) => closure.referencePeriod ?? closure.label).filter(Boolean).join(",") : (evaluation.referencePeriod as string | null) ?? ""
    const ref = [code ?? "PRV", evaluation.source ?? evaluation.metric ?? "", (evaluation.window as { start?: string } | undefined)?.start ?? "", (evaluation.window as { end?: string } | undefined)?.end ?? "", periods].join("|")
    references.push({ kind: "INDICATOR_RESULT", ref, label: summary })
  }
  return { status, summary, facts: { indicatorCode: code, indicatorName: code ? (labels.get(code)?.name ?? null) : null, unit: code ? (labels.get(code)?.unit ?? null) : null, ...evaluation }, ...(status === "INCONCLUSIVE" && typeof evaluation.reason === "string" ? { reasonCode: evaluation.reason } : {}), references }
}

async function resolveEmployment(db: Db, subject: PolicySubject, condition: Extract<PolicyCondition, { kind: "EMPLOYMENT" }>): Promise<ConditionOutcome> {
  const today = localDateOf(subject.asOf, subject.timeZone)
  if (condition.check === "CURRENTLY_ELIGIBLE") {
    const [resolved, freshness, person] = await Promise.all([
      resolveEmployeeStatusAt(db as Database, subject.personId, today),
      resolveEmploymentStatusFreshness(db as Database, subject.organizationId, subject.asOf, subject.timeZone),
      db.query<{ active: boolean }>(`select active from people where id = $1 and organization_id = $2`, [subject.personId, subject.organizationId]),
    ])
    const facts = { date: today, status: resolved.status, basis: resolved.basis, confirmed: resolved.confirmed, sourceFreshness: freshness.state, registrationActive: person.rows[0]?.active ?? false }
    // Presumido "em produção" com a fonte de situação ATRASADA = não se sabe (nunca afirma que deveria estar produzindo).
    if (!resolved.confirmed && freshness.state === "STALE") return { status: "INCONCLUSIVE", summary: `Situação funcional em ${today}: presumida, com a fonte de situação atrasada desde ${freshness.lastSuccessLocalDate ?? "?"}`, facts, reasonCode: "EMPLOYMENT_STATUS_STALE", references: [] }
    const eligible = (person.rows[0]?.active ?? false) && isOperationallyEligibleStatus(resolved.status)
    return { status: eligible === condition.expected ? "MET" : "NOT_MET", summary: `Situação funcional em ${today}: ${eligible ? "elegível (em produção)" : `não elegível (${resolved.status})`}`, facts, references: [{ kind: "EMPLOYMENT", ref: `${subject.personId}|${today}`, label: `Situação funcional em ${today}` }] }
  }
  const window = resolveTimeWindow(condition.period, subject.asOf, subject.timeZone)
  const result = (await resolveEligibleDaysBySubject(db as Database, [subject.personId], window, subject.timeZone, { now: subject.asOf })).get(subject.personId)
  const label = `${localDateOf(window.start, subject.timeZone)} a ${localDateOf(new Date(window.end.getTime() - 1), subject.timeZone)}`
  if (!result) return { status: "INCONCLUSIVE", summary: `Dias elegíveis de ${label}: não foi possível resolver a escala`, facts: { window: label }, reasonCode: "NO_ELIGIBILITY", references: [] }
  const facts = { window: label, eligibleDays: result.eligibleDays, scheduledWorkDays: result.scheduledWorkDays, excludedByStatus: result.excludedByStatus, unconfirmedDays: result.statusConfidence.unconfirmedDays, unknownScheduleDays: result.scheduleConfidence.unknownScheduleDays }
  if (result.statusConfidence.unconfirmedDays > 0 || result.scheduleConfidence.unknownScheduleDays > 0) {
    return { status: "INCONCLUSIVE", summary: `Dias elegíveis de ${label}: ${result.eligibleDays}, mas ${result.statusConfidence.unconfirmedDays + result.scheduleConfidence.unknownScheduleDays} dia(s) com situação ou escala só presumida`, facts, reasonCode: result.statusConfidence.unconfirmedDays > 0 ? "EMPLOYMENT_STATUS_STALE" : "WORK_SCHEDULE_UNKNOWN", references: [] }
  }
  const met = numericComparatorMatches(condition.comparator, result.eligibleDays, condition.threshold)
  return { status: met ? "MET" : "NOT_MET", summary: `Dias elegíveis de ${label}: ${result.eligibleDays} ${NUMERIC_COMPARATOR_TEXT[condition.comparator]} ${condition.threshold}`, facts, references: [{ kind: "EMPLOYMENT", ref: `${subject.personId}|${label}`, label: `Dias elegíveis de ${label}` }] }
}

const STATUS_FILTER: Record<"ACTIVE" | "COMPLETED" | "CANCELLED", string[]> = { ACTIVE: ["PROPOSED", "AWAITING_APPROVAL", "IN_PROGRESS"], COMPLETED: ["COMPLETED"], CANCELLED: ["CANCELLED"] }

async function resolvePriorInterventions(db: Db, subject: PolicySubject, condition: Extract<PolicyCondition, { kind: "PRIOR_INTERVENTIONS" }>): Promise<ConditionOutcome> {
  const statuses = condition.statuses.flatMap((status) => STATUS_FILTER[status])
  const since = new Date(subject.asOf.getTime() - condition.withinDays * DAY_MS)
  const rows = await db.query<{ id: string; type_key: string; status: string; created_at: Date; result: string | null }>(
    `select i.id, i.type_key, i.status, i.created_at, i.outcome->'operational'->>'result' result
       from interventions i
      where i.organization_id = $1 and i.person_id = $2 and i.created_at >= $3 and i.created_at <= $4
        and i.status = any($5::text[])
        and (cardinality($6::text[]) = 0 or i.type_key = any($6::text[]))
        and (not $7::boolean or i.subject_key = $8)
      order by i.created_at desc`,
    [subject.organizationId, subject.personId, since, subject.asOf, statuses, condition.typeKeys, condition.sameSubject, subject.subjectKey],
  )
  const matching = rows.rows.filter((row) => condition.operationalResults.length === 0 || row.status !== "COMPLETED" || (condition.operationalResults as readonly string[]).includes(row.result ?? "NOT_MEASURED"))
  const met = numericComparatorMatches(condition.comparator, matching.length, condition.threshold)
  const types = condition.typeKeys.length > 0 ? condition.typeKeys.join(", ") : "qualquer tipo"
  return {
    status: met ? "MET" : "NOT_MET",
    summary: `Intervenções anteriores (${types}; ${condition.statuses.map((status) => ({ ACTIVE: "ativas", COMPLETED: "concluídas", CANCELLED: "canceladas" })[status]).join("/")}; ${condition.withinDays} dias): ${matching.length} ${NUMERIC_COMPARATOR_TEXT[condition.comparator]} ${condition.threshold}`,
    facts: { count: matching.length, interventions: matching.map((row) => ({ id: row.id, typeKey: row.type_key, status: row.status, createdAt: row.created_at.toISOString(), operationalResult: row.result })) },
    references: matching.map((row) => ({ kind: "INTERVENTION" as const, ref: row.id, label: `${row.type_key} (${row.status})`, occurredAt: row.created_at.toISOString() })),
  }
}

async function resolveTimeSince(db: Db, subject: PolicySubject, condition: Extract<PolicyCondition, { kind: "TIME_SINCE_INTERVENTION" }>): Promise<ConditionOutcome> {
  const column = condition.event === "OPENED" ? "created_at" : "completed_at"
  const row = (await db.query<{ id: string; type_key: string; at: Date }>(
    `select id, type_key, ${column} at from interventions
      where organization_id = $1 and person_id = $2 and ${column} is not null and ${column} <= $3
        and (cardinality($4::text[]) = 0 or type_key = any($4::text[])) and (not $5::boolean or subject_key = $6)
      order by ${column} desc limit 1`,
    [subject.organizationId, subject.personId, subject.asOf, condition.typeKeys, condition.sameSubject, subject.subjectKey],
  )).rows[0]
  const what = `${condition.event === "OPENED" ? "aberta" : "concluída"} (${condition.typeKeys.length > 0 ? condition.typeKeys.join(", ") : "qualquer tipo"})`
  if (!row) return { status: condition.whenNone, summary: `Nenhuma intervenção ${what} até agora — a política define este caso como ${condition.whenNone === "MET" ? "atendido" : "não atendido"}`, facts: { found: false }, references: [] }
  const days = Math.floor((subject.asOf.getTime() - row.at.getTime()) / DAY_MS)
  const met = numericComparatorMatches(condition.comparator, days, condition.days)
  return { status: met ? "MET" : "NOT_MET", summary: `Última intervenção ${what}: há ${days} dia(s) ${NUMERIC_COMPARATOR_TEXT[condition.comparator]} ${condition.days}`, facts: { found: true, days, interventionId: row.id, at: row.at.toISOString() }, references: [{ kind: "INTERVENTION", ref: row.id, label: `${row.type_key}`, occurredAt: row.at.toISOString() }] }
}

export type SustainedDiagnosis = {
  ref: string
  source: "INDICATOR_INVESTIGATION" | "PRV_CLOSING_DIAGNOSIS"
  indicatorCode: string
  period: string
  occurredAt: string
  /** Padrões de desenvolvimento sustentados (chave de prática/comportamento + título + documento da base, quando houver). */
  patterns: { key: string; title: string; documentId: string | null }[]
}

/** Diagnósticos SUSTENTADOS da pessoa na janela: investigação de indicador com padrão sustentado (execução utilizável) e
 *  diagnósticos de fechamento com padrões de desenvolvimento. Só registros persistidos — nunca texto da IA. */
export async function loadSustainedDiagnoses(db: Db, input: { organizationId: string; personId: string; indicatorCode: string | null; since: Date; until: Date }): Promise<SustainedDiagnosis[]> {
  const [investigations, closings] = await Promise.all([
    db.query<{ id: string; indicator_code: string; period_start: string | null; period_end: string | null; reference_period: string | null; created_at: Date; evidence: unknown }>(
      `select ii.id, ii.indicator_code, ii.period_start::text, ii.period_end::text, ii.reference_period, ii.created_at, ii.evidence
         from indicator_investigations ii
         left join feedback_analysis_runs r on r.id = ii.analysis_run_id and r.organization_id = ii.organization_id
        where ii.organization_id = $1 and ii.person_id = $2 and ii.is_current and ii.conclusion = 'PATTERN_SUPPORTED'
          and (ii.analysis_run_id is null or r.outcome in ('USABLE', 'PARTIAL'))
          and ii.created_at >= $3 and ii.created_at <= $4 and ($5::text is null or ii.indicator_code = $5)
        order by ii.created_at desc limit 20`,
      [input.organizationId, input.personId, input.since, input.until, input.indicatorCode],
    ),
    db.query<{ id: string; reference_period: string; generated_at: Date; investigations: unknown }>(
      `select id, reference_period, generated_at, diagnosis->'investigations' investigations from prv_closing_diagnoses
        where organization_id = $1 and person_id = $2 and generated_at >= $3 and generated_at <= $4 order by generated_at desc limit 12`,
      [input.organizationId, input.personId, input.since, input.until],
    ),
  ])
  const result: SustainedDiagnosis[] = []
  for (const row of investigations.rows) {
    const patterns: SustainedDiagnosis["patterns"] = []
    for (const evidence of Array.isArray(row.evidence) ? (row.evidence as { patterns?: unknown[] }[]) : []) {
      for (const pattern of Array.isArray(evidence.patterns) ? (evidence.patterns as Record<string, unknown>[]) : []) {
        if (pattern.classification !== "DEVELOPMENT_PATTERN" || typeof pattern.criterionKey !== "string") continue
        patterns.push({ key: pattern.criterionKey, title: String(pattern.practiceTitle ?? pattern.heading ?? pattern.criterionKey), documentId: typeof pattern.documentId === "string" ? pattern.documentId : null })
      }
    }
    if (patterns.length === 0) continue
    result.push({ ref: `indicator_investigation:${row.id}`, source: "INDICATOR_INVESTIGATION", indicatorCode: row.indicator_code, period: row.reference_period ?? `${row.period_start ?? "?"} a ${row.period_end ?? "?"}`, occurredAt: row.created_at.toISOString(), patterns })
  }
  for (const row of closings.rows) {
    for (const investigation of Array.isArray(row.investigations) ? (row.investigations as Record<string, unknown>[]) : []) {
      const code = typeof investigation.indicatorCode === "string" ? investigation.indicatorCode : null
      if (!code || (input.indicatorCode && code !== input.indicatorCode)) continue
      const conclusion = (investigation.conclusion ?? {}) as { developmentPatterns?: unknown }
      const keys = Array.isArray(conclusion.developmentPatterns) ? conclusion.developmentPatterns.filter((key): key is string => typeof key === "string") : []
      if (keys.length === 0) continue
      result.push({ ref: `prv_closing_diagnosis:${row.id}:${code}`, source: "PRV_CLOSING_DIAGNOSIS", indicatorCode: code, period: row.reference_period, occurredAt: row.generated_at.toISOString(), patterns: keys.map((key) => ({ key, title: key, documentId: null })) })
    }
  }
  return result
}

async function competencyPatternKeys(db: Db, organizationId: string, competencyKeys: readonly string[]): Promise<{ patterns: Map<string, Set<string>>; names: Map<string, string> }> {
  if (competencyKeys.length === 0) return { patterns: new Map(), names: new Map() }
  const rows = await db.query<{ key: string; name: string; practice_keys: string[]; criterion_keys: string[] }>(`select key, name, practice_keys, criterion_keys from competencies where organization_id = $1 and key = any($2::text[])`, [organizationId, competencyKeys])
  return { patterns: new Map(rows.rows.map((row) => [row.key, new Set([...row.practice_keys, ...row.criterion_keys])])), names: new Map(rows.rows.map((row) => [row.key, row.name])) }
}

async function resolveDiagnosis(db: Db, subject: PolicySubject, condition: Extract<PolicyCondition, { kind: "SUPPORTED_DIAGNOSIS" }>): Promise<ConditionOutcome> {
  const indicatorCode = condition.indicatorCode ?? subject.policyIndicatorCode
  const diagnoses = await loadSustainedDiagnoses(db, { organizationId: subject.organizationId, personId: subject.personId, indicatorCode, since: new Date(subject.asOf.getTime() - condition.withinDays * DAY_MS), until: subject.asOf })
  const { patterns: byCompetency, names: competencyNames } = await competencyPatternKeys(db, subject.organizationId, condition.competencyKeys)
  const matched = diagnoses
    .map((diagnosis) => {
      if (condition.competencyKeys.length === 0) return { diagnosis, competencies: [] as string[], patterns: diagnosis.patterns }
      const competencies = condition.competencyKeys.filter((key) => diagnosis.patterns.some((pattern) => byCompetency.get(key)?.has(pattern.key)))
      return { diagnosis, competencies, patterns: diagnosis.patterns.filter((pattern) => competencies.some((key) => byCompetency.get(key)?.has(pattern.key))) }
    })
    .filter((item) => item.patterns.length > 0)
  const exists = matched.length > 0
  const scope = `${indicatorCode ?? "qualquer indicador"}${condition.competencyKeys.length > 0 ? `, competência ${condition.competencyKeys.map((key) => competencyNames.get(key) ?? key).join(", ")}` : ""}, ${condition.withinDays} dias`
  return {
    status: (condition.expectation === "EXISTS") === exists ? "MET" : "NOT_MET",
    summary: exists ? `Diagnóstico sustentado (${scope}): ${matched.length} encontrado(s) — ${matched.flatMap((item) => item.patterns.map((pattern) => pattern.title)).slice(0, 3).join("; ")}` : `Diagnóstico sustentado (${scope}): nenhum encontrado`,
    facts: { indicatorCode, diagnoses: matched.map((item) => ({ ...item.diagnosis, patterns: item.patterns, competencies: item.competencies })) },
    references: matched.map((item) => ({ kind: "DIAGNOSIS" as const, ref: item.diagnosis.ref, label: `Diagnóstico ${item.diagnosis.indicatorCode} (${item.diagnosis.period})`, occurredAt: item.diagnosis.occurredAt })),
  }
}

async function resolveFeedback(db: Db, subject: PolicySubject, condition: Extract<PolicyCondition, { kind: "PUBLISHED_FEEDBACK" }>): Promise<ConditionOutcome> {
  const since = new Date(subject.asOf.getTime() - condition.withinDays * DAY_MS)
  const rows = await db.query<{ id: string; kind: string | null; indicator: string | null; published_at: Date }>(
    `select f.id, f.feedback_kind::text kind, coalesce(c.indicator_code, f.impacted_indicator) indicator, f.published_at
       from feedbacks f join supervision_cases c on c.id = f.case_id and c.organization_id = f.organization_id
      where f.organization_id = $1 and f.operator_id = $2 and f.status in ('PUBLISHED', 'ACKNOWLEDGED')
        and f.published_at >= $3 and f.published_at <= $4 and ($5::text is null or f.feedback_kind::text = $5)
        and ($6::text is null or c.indicator_code = $6 or f.impacted_indicator = $6) and ${visibleInFollowUpSql("f")}
      order by f.published_at desc limit 50`,
    [subject.organizationId, subject.personId, since, subject.asOf, condition.feedbackKind, condition.indicatorCode],
  )
  const met = numericComparatorMatches(condition.comparator, rows.rows.length, condition.threshold)
  return {
    status: met ? "MET" : "NOT_MET",
    summary: `Feedbacks publicados (${condition.feedbackKind === "INDICATOR" ? "de indicador" : condition.feedbackKind === "MONITORING" ? "de monitoria" : "todos"}${condition.indicatorCode ? `, ${condition.indicatorCode}` : ""}, ${condition.withinDays} dias): ${rows.rows.length} ${NUMERIC_COMPARATOR_TEXT[condition.comparator]} ${condition.threshold}`,
    facts: { count: rows.rows.length, feedbacks: rows.rows.map((row) => ({ id: row.id, kind: row.kind, indicator: row.indicator, publishedAt: row.published_at.toISOString() })) },
    references: rows.rows.map((row) => ({ kind: "FEEDBACK" as const, ref: row.id, label: `Feedback ${row.kind === "MONITORING" ? "de monitoria" : "de indicador"}${row.indicator ? ` (${row.indicator})` : ""}`, occurredAt: row.published_at.toISOString() })),
  }
}

const SQL_COMPARATOR: Record<keyof typeof NUMERIC_COMPARATOR_TEXT, string> = { EQUALS: "=", NOT_EQUALS: "<>", GT: ">", GTE: ">=", LT: "<", LTE: "<=" }

/** Flag de atendimento: atendimentos do colaborador na janela em que a flag chegou com o valor procurado (só leitura). */
async function resolveInteractionFlag(db: Db, subject: PolicySubject, condition: Extract<PolicyCondition, { kind: "INTERACTION_FLAG" }>): Promise<ConditionOutcome> {
  const since = new Date(subject.asOf.getTime() - condition.withinDays * DAY_MS)
  const flag = (await db.query<{ id: string; description: string | null }>(`select id, description from channel_flags where organization_id = $1 and channel = $2 and flag_name = $3`, [subject.organizationId, condition.channel, condition.flagName])).rows[0]
  const valueText = condition.match.type === "BOOLEAN" ? (condition.match.value ? "sim" : "não") : `${NUMERIC_COMPARATOR_TEXT[condition.match.comparator]} ${fmt(condition.match.threshold)}`
  const head = `Flag "${condition.flagName}" = ${valueText} (${condition.withinDays} dias)`
  if (!flag) return { status: "INCONCLUSIVE", summary: `${head}: flag não encontrada no catálogo.`, facts: {}, reasonCode: "FLAG_NOT_FOUND", references: [] }
  const match = condition.match.type === "BOOLEAN" ? `f.value_boolean = $6` : `f.value_numeric ${SQL_COMPARATOR[condition.match.comparator]} $6`
  const matchValue = condition.match.type === "BOOLEAN" ? condition.match.value : condition.match.threshold
  const params = [subject.organizationId, subject.personId, condition.channel, since, subject.asOf, matchValue, flag.id]
  const totals = (await db.query<{ total: number; matched: number }>(
    `select count(*)::int total, count(*) filter (where f.id is not null and ${match})::int matched
       from interactions i left join interaction_flags f on f.interaction_id = i.id and f.channel_flag_id = $7
      where i.organization_id = $1 and i.operator_id = $2 and i.channel = $3 and i.started_at > $4 and i.started_at <= $5`,
    params,
  )).rows[0] ?? { total: 0, matched: 0 }
  if (totals.total < condition.minimumInteractions) {
    return { status: "INCONCLUSIVE", summary: `${head}: ${totals.total} atendimento(s) na janela, abaixo do mínimo de ${condition.minimumInteractions}.`, facts: { total: totals.total, matched: totals.matched }, reasonCode: "INSUFFICIENT_INTERACTIONS", references: [] }
  }
  const value = condition.measure === "COUNT" ? totals.matched : Math.round((totals.matched / totals.total) * 1000) / 10
  const met = numericComparatorMatches(condition.comparator, value, condition.threshold)
  const recent = (await db.query<{ id: string; external_id: string; started_at: Date }>(
    `select i.id, i.external_id, i.started_at from interactions i join interaction_flags f on f.interaction_id = i.id and f.channel_flag_id = $7
      where i.organization_id = $1 and i.operator_id = $2 and i.channel = $3 and i.started_at > $4 and i.started_at <= $5 and ${match}
      order by i.started_at desc limit 10`,
    params,
  )).rows
  const measured = condition.measure === "COUNT" ? `${totals.matched} de ${totals.total} atendimento(s)` : `${fmt(value)}% (${totals.matched} de ${totals.total} atendimentos)`
  return {
    status: met ? "MET" : "NOT_MET",
    summary: `${head}: ${measured} ${NUMERIC_COMPARATOR_TEXT[condition.comparator]} ${fmt(condition.threshold)}${condition.measure === "PERCENT" ? "%" : ""}`,
    facts: { flagName: condition.flagName, channel: condition.channel, total: totals.total, matched: totals.matched, value, measure: condition.measure },
    references: recent.map((row) => ({ kind: "INTERACTION" as const, ref: row.id, label: `Atendimento ${row.external_id} com a flag "${condition.flagName}"`, occurredAt: row.started_at.toISOString() })),
  }
}

export function createConditionResolver(db: Db, subject: PolicySubject): ConditionResolver {
  let labels: Promise<Map<string, { name: string; unit: string }>> | null = null
  return async (condition) => {
    switch (condition.kind) {
      case "INDICATOR":
        labels ??= indicatorLabels(db, subject.organizationId)
        return resolveIndicator(db, subject, condition, await labels)
      case "EMPLOYMENT":
        return resolveEmployment(db, subject, condition)
      case "PRIOR_INTERVENTIONS":
        return resolvePriorInterventions(db, subject, condition)
      case "TIME_SINCE_INTERVENTION":
        return resolveTimeSince(db, subject, condition)
      case "SUPPORTED_DIAGNOSIS":
        return resolveDiagnosis(db, subject, condition)
      case "PUBLISHED_FEEDBACK":
        return resolveFeedback(db, subject, condition)
      case "INTERACTION_FLAG":
        return resolveInteractionFlag(db, subject, condition)
    }
  }
}
