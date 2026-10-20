import { createHash } from "node:crypto"
import { transcriptForModel } from "../../../workflows/application/transcript.js"
import { z } from "zod"
import { env } from "../../../../config/env.js"
import { escalateRoute, generateForRoute, routeFor, routeRecordOf } from "../../../../shared/application/model-routing/llm-gateway.js"
import { estimateTokens } from "../../../../shared/application/model-routing/token-estimate.js"
import { withLlmScope } from "../../../../shared/application/llm-telemetry.js"
import { ANALYSIS_DIMENSION_DEFINITIONS, interactionMetricFor, INTERACTION_METRIC_LABELS, type AnalysisDimension } from "../../domain/analysis-dimensions.js"
import { deltaOf, noData, notSupported, percentOf, sufficient, type ToolQuality, type ToolResult } from "../../domain/tool-output.js"
import { describeWindow, loadPeerPopulation, MINIMUM_COMPARISON_POPULATION, resolvePeriod, type IndicatorInfo, type InvestigationPeriod, type KnowledgeExcerptRecord, type ToolContext } from "../tool-context.js"
import { canonicalReasonSql, canonicalSubjectSql, levelCanonicalSql, levelKeySql, rawSubjectSql, subjectFilterSql, type SubjectLevel, type SubjectResolution } from "../../../interactions/domain/interaction-subject.js"
import { resolveCanonicalSubject } from "../../../interactions/application/interaction-subject-catalog.js"
import { PEER_PRIVACY_PROJECTION_VERSION, projectPeerTranscript, type PeerIdentity, type PeerTranscriptPrivacyProjection } from "../../domain/peer-privacy-projection.js"
import { periodDaysOf, selectSample, type SamplingMetadata, type SamplingStrategy } from "../../domain/sampling-strategy.js"
import { accumulateVerification, emptyVerificationTelemetry, projectTranscript, renderTranscriptForModel, verifyFinding, type EvidenceRequirement, type EvidenceUnit, type EvidenceVerificationTelemetry, type ProjectedInteraction } from "../../domain/transcript-projection.js"
import { bucketCountsOf, renderTemporalBuckets, temporalBucketsOf, temporalPositionOf, validateTemporalComparison, TEMPORAL_COMPARISON_STATUSES, TEMPORAL_FINDING_RELATIONS, type TemporalBucket, type TemporalComparison, type TemporalPosition } from "../../domain/temporal-semantics.js"
import { analysisCoverageOf, findingCountsOf, renderInteractionAnalysisObjective, temporalCoverageOf, type AnalysisCoverage, type FindingCounts } from "../../domain/interaction-analysis.js"
import { attachProceduralFindings, assignClaimHandles, deriveCrossInteractionPatterns, frameExtractionOutputSchema, patternSynthesisOutputSchema, promoteFindings, renderFrameExtractionInstructions, renderFramesForModel, renderMissingFramesRequest, renderPatternSynthesisInstructions, verifySemanticFrames, type CrossInteractionPattern, type DeclaredPattern, type InteractionSemanticFrame, type PatternKind, type PatternSupport, type SemanticTelemetry } from "../../domain/interaction-semantic-frame.js"
import { emptyProceduralTelemetry, evaluateProcedureAssertions, knowledgeRuleExtractionSchema, proceduralCoverageOf, renderAssertionsForKnowledge, renderKnowledgeExcerpts, renderKnowledgeRuleExtractionInstructions, verifyKnowledgeRules, type AssertionInput, type KnowledgeExcerptView, type KnowledgeRule, type ProceduralEvaluation, type ProceduralTelemetry } from "../../domain/procedural-semantics.js"
import { retrieveKnowledgeForAgent } from "../../../knowledge/application/retrieve-knowledge.js"
import { assessFrameContract, EXAMPLE_INTERACTION_REF, summarizeFrameContract } from "../../domain/frame-contract.js"
import { applyNeedKindAnnotations, buildNeedKindItems, NEED_KIND_SYSTEM_PROMPT, needKindProviderFailure, needKindTelemetryOf, renderNeedKindInput, validateNeedKindOutput, type NeedKindValidation } from "../../domain/need-kind-sidecar.js"
import { applyNeedAttributions, assertionSemanticsFrom, countAttributions, emptyOutcomeAttributionTelemetry, findingOwnership, needOutcomesOf, outcomeSidecarOutputSchema, renderSidecarInput, renderSidecarInstructions, validateNeedAttributions, type NeedAttribution, type NeedOutcome, type Ownership, type OutcomeAttributionTelemetry } from "../../domain/outcome-attribution.js"

/** Limites seguros — nunca milhares de linhas nem transcrições inteiras sem teto. */
export const INTERACTION_LIST_DEFAULT = 10
export const INTERACTION_LIST_MAX = 25
export const TRANSCRIPT_ANALYSIS_MAX = 8
export const TRANSCRIPT_MAX_CHARS = 6_000
const WEEKDAY_LABELS = ["", "segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]

type InteractionRow = { id: string; started_at: string; ended_at: string; reason: string; sub_reason: string | null; canonical_subject: string | null; canonical_reason: string | null; channel: string; duration: string; flags: { name: string; boolean: boolean | null; numeric: string | null }[] | null; transcript_chars: number | null }

/**
 * Assunto (`SUBJECT_RESOLUTION_V2`, interaction-subject.ts): `subject` = assunto bruto preferencial da fonte (o SUBMOTIVO quando
 * informado; senão o motivo); `canonicalSubject` = código do catálogo desse nível via alias explícito, ou nulo. Só quando há
 * submotivo: `reason` = o MOTIVO bruto e `canonicalReason` = o canônico dele. Sem submotivo a saída é a mesma de antes.
 */
const INTERACTION_SELECT = `
  select i.id, i.started_at, i.ended_at, i.reason, i.sub_reason, ${canonicalSubjectSql("i")} canonical_subject, ${canonicalReasonSql("i")} canonical_reason, i.channel, extract(epoch from i.ended_at - i.started_at) duration,
         (select json_agg(json_build_object('name', cf.flag_name, 'boolean', f.value_boolean, 'numeric', f.value_numeric) order by cf.flag_name)
            from interaction_flags f join channel_flags cf on cf.id = f.channel_flag_id where f.interaction_id = i.id) flags,
         (select length(t.content) from transcripts t where t.interaction_id = i.id order by t.version desc limit 1) transcript_chars
  from interactions i`

function interactionView(row: InteractionRow, timeZone: string) {
  const started = new Date(row.started_at)
  return {
    interactionId: row.id,
    startedAt: row.started_at,
    localDate: started.toLocaleDateString("sv-SE", { timeZone }),
    localTime: started.toLocaleTimeString("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit" }),
    weekday: WEEKDAY_LABELS[isoWeekdayOf(started, timeZone)],
    durationSeconds: Math.round(Number(row.duration)),
    subject: row.sub_reason?.trim() ? row.sub_reason : row.reason,
    canonicalSubject: row.canonical_subject,
    ...(row.sub_reason?.trim() ? { reason: row.reason, canonicalReason: row.canonical_reason } : {}),
    channel: row.channel,
    // Só sinais PRESENTES (booleana verdadeira ou valor numérico): flags falsas/ausentes não são informação e só inflam o contexto.
    flags: (row.flags ?? []).filter((flag) => flag.boolean === true || flag.numeric !== null).map((flag) => ({ flag: flag.name, value: flag.boolean ?? Number(flag.numeric) })),
    hasTranscript: (row.transcript_chars ?? 0) > 0,
  }
}

function isoWeekdayOf(date: Date, timeZone: string): number {
  const weekday = new Date(date.toLocaleString("en-US", { timeZone })).getDay()
  return weekday === 0 ? 7 : weekday
}

/** Filtro por flag pelo NOME do catálogo (só flags booleanas verdadeiras ou numéricas presentes). */
function flagFilter(flag: string | undefined, paramIndex: number): { clause: string; params: unknown[] } {
  if (!flag) return { clause: "", params: [] }
  return { clause: ` and exists (select 1 from interaction_flags f join channel_flags cf on cf.id = f.channel_flag_id where f.interaction_id = i.id and cf.flag_name = $${paramIndex} and (f.value_boolean is true or f.value_numeric is not null))`, params: [flag] }
}

/**
 * Filtro por assunto (nível preferencial: submotivo, ou o motivo sem submotivo) ou por MOTIVO (`level` REASON): resolve o pedido
 * para o canônico (código do catálogo ou alias do bruto) e filtra todas as interações com aquele canônico no nível; sem alias,
 * igualdade exata do bruto do nível. Nunca fuzzy, nunca LLM.
 */
async function subjectFilter(context: ToolContext, subject: string | undefined, paramIndex: number, level: SubjectLevel = "SUBJECT"): Promise<{ clause: string; params: unknown[]; label: string | null; resolution: SubjectResolution | null }> {
  if (!subject) return { clause: "", params: [], label: null, resolution: null }
  const resolution = await resolveCanonicalSubject(context.db, context.organizationId, subject)
  const filter = subjectFilterSql(resolution, paramIndex, "i", level)
  const noun = level === "REASON" ? "motivo" : "assunto"
  const label = resolution.canonical ? `${noun} canônico ${resolution.canonical.code} (${resolution.canonical.name}; pedido "${subject}")` : `${noun} bruto exato "${subject}" (sem canônico no catálogo)`
  return { clause: filter.clause, params: [filter.param], label, resolution }
}

/** Filtros de assunto e de motivo, nessa ordem, a partir do próximo parâmetro livre (`params` é acrescentado aqui). */
async function subjectAndReasonFilters(context: ToolContext, filters: { subject?: string; reason?: string }, params: unknown[]): Promise<{ clause: string; labels: string[] }> {
  const subject = await subjectFilter(context, filters.subject, params.length + 1)
  params.push(...subject.params)
  const reason = await subjectFilter(context, filters.reason, params.length + 1, "REASON")
  params.push(...reason.params)
  return { clause: subject.clause + reason.clause, labels: [subject.label, reason.label].filter((label): label is string => label !== null) }
}

export async function countInteractions(context: ToolContext, period: InvestigationPeriod): Promise<number> {
  const row = await context.db.query<{ count: string }>(`select count(*) from interactions where organization_id = $1 and operator_id = $2 and started_at >= $3 and started_at < $4`, [context.organizationId, context.subject.operatorId, period.start.toISOString(), period.end.toISOString()])
  return Number(row.rows[0]?.count ?? 0)
}

/**
 * V1.3.4.1: universo REGISTRADO por bloco da janela (interações do colaborador, mesma população de countInteractions) —
 * a base determinística de `absenceEstablished` (zero na amostra só vira ausência no bloco com cobertura suficiente).
 * Só datas; o bloco é decidido em código pela MESMA divisão da amostra/cobertura/posição.
 */
export async function countInteractionsByBucket(context: ToolContext, period: InvestigationPeriod, buckets: TemporalBucket[]): Promise<Record<string, number>> {
  const rows = await context.db.query<{ started_at: string }>(`select started_at from interactions where organization_id = $1 and operator_id = $2 and started_at >= $3 and started_at < $4`, [context.organizationId, context.subject.operatorId, period.start.toISOString(), period.end.toISOString()])
  const out: Record<string, number> = Object.fromEntries(buckets.map((bucket) => [bucket.ref, 0]))
  for (const row of rows.rows) {
    const position = temporalPositionOf(new Date(row.started_at), period, buckets.length, (date) => date.toLocaleDateString("sv-SE", { timeZone: context.timeZone }))
    if (position) out[position.bucketRef] = (out[position.bucketRef] ?? 0) + 1
  }
  return out
}

/** Teto de candidatos lidos do banco para amostragem (a seleção final respeita `limit` ≤ INTERACTION_LIST_MAX). */
const SAMPLING_CANDIDATES_MAX = 400

export async function findInteractions(context: ToolContext, args: { period?: { from: string; to: string }; subject?: string; reason?: string; flag?: string; orderBy?: "RECENT" | "LONGEST" | "SHORTEST"; limit?: number; sampling?: SamplingStrategy }): Promise<ToolResult> {
  const period = resolvePeriod(context, args.period)
  const limit = Math.min(args.limit ?? INTERACTION_LIST_DEFAULT, INTERACTION_LIST_MAX)
  const params: unknown[] = [context.organizationId, context.subject.operatorId, period.start.toISOString(), period.end.toISOString()]
  let where = ` where i.organization_id = $1 and i.operator_id = $2 and i.started_at >= $3 and i.started_at < $4`
  const subjects = await subjectAndReasonFilters(context, args, params)
  where += subjects.clause
  const filters: string[] = [...subjects.labels]
  const flag = flagFilter(args.flag, params.length + 1)
  where += flag.clause
  params.push(...flag.params)
  if (args.flag) filters.push(`flag ${args.flag}`)
  const total = await countFiltered(context, period, args, args.flag)
  const periodDays = periodDaysOf(period)
  // AMOSTRAGEM DEPENDE DA PERGUNTA (V1.3.2): ordenação explícita por duração continua como pedida; com ordem
  // RECENT (ou nenhuma), a estratégia vem do modelo (se pediu) ou do runtime (objetivo × tamanho da janela).
  const explicitOrder = args.orderBy === "LONGEST" || args.orderBy === "SHORTEST"
  const strategy: SamplingStrategy = explicitOrder ? "RECENT" : (args.sampling ?? context.investigation.samplingStrategy)
  let items: ReturnType<typeof interactionView>[]
  let sampling: SamplingMetadata
  if (explicitOrder) {
    params.push(limit)
    const rows = await context.db.query<InteractionRow>(`${INTERACTION_SELECT}${where} order by ${args.orderBy === "LONGEST" ? "duration desc" : "duration asc"}, i.started_at desc limit $${params.length}`, params)
    items = rows.rows.map((row) => interactionView(row, context.timeZone))
    sampling = { strategy, candidateCount: total, selectedCount: items.length, periodBuckets: [], selectedPerBucket: [], selectionReason: `ordenação explícita ${args.orderBy} (duração), até o limite` }
  } else {
    params.push(SAMPLING_CANDIDATES_MAX)
    const rows = await context.db.query<InteractionRow>(`${INTERACTION_SELECT}${where} order by i.started_at desc, i.id limit $${params.length}`, params)
    const sample = selectSample({
      candidates: rows.rows,
      strategy,
      limit,
      period,
      periodDays,
      startedAtOf: (row) => new Date(row.started_at),
      keyOf: (row) => row.id,
      subjectOf: (row) => row.canonical_subject ?? (row.sub_reason?.trim() ? row.sub_reason : row.reason),
      hasFlagOf: (row) => (row.flags ?? []).some((item) => item.boolean === true),
      dateLabelOf: (date) => date.toLocaleDateString("sv-SE", { timeZone: context.timeZone }),
    })
    items = sample.selected.map((row) => interactionView(row, context.timeZone))
    sampling = sample.metadata
  }
  return {
    data: {
      interactions: items,
      total,
      returned: items.length,
      returnedSharePercent: percentOf(items.length, total),
      truncated: items.length < total,
      orderBy: args.orderBy ?? "RECENT",
      /** Como a amostra foi escolhida (estratégia, blocos temporais, quantas por bloco) — sem ids. */
      sampling,
    },
    quality: items.length > 0 ? sufficient(total, null) : noData("nenhuma interação no recorte"),
    provenance: { period: describeWindow(period), population: "interações do colaborador", filters, dataSource: "INTERACTIONS + INTERACTION_FLAGS", method: `amostra ${sampling.strategy}: ${sampling.selectionReason}` },
  }
}

async function countFiltered(context: ToolContext, period: InvestigationPeriod, subjects: { subject?: string; reason?: string }, flag: string | undefined): Promise<number> {
  const params: unknown[] = [context.organizationId, context.subject.operatorId, period.start.toISOString(), period.end.toISOString()]
  let where = ` where i.organization_id = $1 and i.operator_id = $2 and i.started_at >= $3 and i.started_at < $4`
  where += (await subjectAndReasonFilters(context, subjects, params)).clause
  const filter = flagFilter(flag, params.length + 1)
  params.push(...filter.params)
  const row = await context.db.query<{ count: string }>(`select count(*) from interactions i${where}${filter.clause}`, params)
  return Number(row.rows[0]?.count ?? 0)
}

/** Interação acessível nesta investigação: do colaborador em foco (org verificada). */
async function loadOwnInteraction(context: ToolContext, interactionId: string): Promise<InteractionRow | null> {
  const row = await context.db.query<InteractionRow>(`${INTERACTION_SELECT} where i.id = $1 and i.organization_id = $2 and i.operator_id = $3`, [interactionId, context.organizationId, context.subject.operatorId])
  return row.rows[0] ?? null
}

export async function getInteractionContext(context: ToolContext, args: { interactionId?: string }): Promise<ToolResult> {
  const interactionId = args.interactionId ?? context.subject.interactionId
  if (!interactionId) return { data: null, quality: notSupported("nenhuma interação em foco nesta investigação — informe interactionId"), provenance: { population: "—", filters: [], dataSource: "INTERACTIONS" } }
  const row = await loadOwnInteraction(context, interactionId)
  if (!row) return { data: null, quality: noData("interação não encontrada para este colaborador"), provenance: { population: "—", filters: [`interação ${interactionId}`], dataSource: "INTERACTIONS" } }
  const view = interactionView(row, context.timeZone)
  return {
    data: { ...view, transcriptChars: row.transcript_chars ?? 0, operator: context.subject.operatorName, group: context.subject.teamName, subgroup: context.subject.subteamName },
    quality: sufficient(1, null),
    provenance: { population: "uma interação do colaborador", filters: [`interação ${interactionId}`], dataSource: "INTERACTIONS + INTERACTION_FLAGS + TRANSCRIPTS (metadados)" },
  }
}

export async function getInteractionFlags(context: ToolContext, args: { interactionIds?: string[]; period?: { from: string; to: string } }): Promise<ToolResult> {
  const period = resolvePeriod(context, args.period)
  const byIds = args.interactionIds && args.interactionIds.length > 0
  const params: unknown[] = byIds ? [context.organizationId, context.subject.operatorId, args.interactionIds] : [context.organizationId, context.subject.operatorId, period.start.toISOString(), period.end.toISOString()]
  const where = byIds ? `i.organization_id = $1 and i.operator_id = $2 and i.id = any($3::uuid[])` : `i.organization_id = $1 and i.operator_id = $2 and i.started_at >= $3 and i.started_at < $4`
  const rows = await context.db.query<{ flag_name: string; value_type: string; count: string; interaction_ids: string[]; avg_numeric: string | null }>(
    `select cf.flag_name, cf.value_type, count(*) count, array_agg(i.id order by i.started_at desc) interaction_ids, avg(f.value_numeric) avg_numeric
     from interactions i join interaction_flags f on f.interaction_id = i.id join channel_flags cf on cf.id = f.channel_flag_id
     where ${where} and (f.value_boolean is true or f.value_numeric is not null)
     group by cf.flag_name, cf.value_type order by count desc, cf.flag_name`,
    params,
  )
  const totalRow = await context.db.query<{ count: string }>(`select count(*) from interactions i where ${where}`, params)
  const total = Number(totalRow.rows[0]?.count ?? 0)
  return {
    data: {
      interactionsInSet: total,
      flags: rows.rows.map((row) => ({ flag: row.flag_name, valueType: row.value_type, count: Number(row.count), share: total > 0 ? Math.round((Number(row.count) / total) * 100) / 100 : null, sharePercent: percentOf(Number(row.count), total), averageValue: row.avg_numeric === null ? null : Math.round(Number(row.avg_numeric) * 100) / 100, interactionIds: row.interaction_ids.slice(0, INTERACTION_LIST_MAX) })),
      note: "flag presente = sinal registrado pela operação; coexistir com um resultado não é causa",
    },
    quality: total > 0 ? sufficient(total, null) : noData("nenhuma interação no conjunto"),
    provenance: { ...(byIds ? {} : { period: describeWindow(period) }), population: byIds ? `${args.interactionIds!.length} interação(ões) informada(s)` : "interações do colaborador no período", filters: [], dataSource: "INTERACTION_FLAGS" },
  }
}

/** Segmentação de interações (proxy declarada) por assunto/motivo/canal/hora/dia da semana/flag. */
export async function segmentInteractions(context: ToolContext, indicator: IndicatorInfo, dimension: AnalysisDimension, period: InvestigationPeriod, filters: { subject?: string; reason?: string; flag?: string }): Promise<ToolResult> {
  const definition = ANALYSIS_DIMENSION_DEFINITIONS[dimension]
  const metric = interactionMetricFor(indicator)
  if (!metric) return { data: { indicator: indicator.code, dimension, status: "NOT_SUPPORTED" }, quality: notSupported(`não há medição por interação de ${indicator.code} (unidade ${indicator.unit}); recorte por ${definition.label.toLowerCase()} não é suportado`), provenance: { period: describeWindow(period), population: "colaborador", filters: [], dataSource: "INTERACTIONS" } }
  const params: unknown[] = [context.organizationId, context.subject.operatorId, period.start.toISOString(), period.end.toISOString()]
  let where = ` where i.organization_id = $1 and i.operator_id = $2 and i.started_at >= $3 and i.started_at < $4`
  const subjects = await subjectAndReasonFilters(context, filters, params)
  where += subjects.clause
  const applied: string[] = [...subjects.labels]
  const flag = flagFilter(filters.flag, params.length + 1)
  where += flag.clause
  params.push(...flag.params)
  if (filters.flag) applied.push(`flag ${filters.flag}`)
  // Dimensões de tempo precisam do fuso da organização (dia/hora LOCAL) — parâmetro só quando usado.
  const timeBased = dimension === "HOUR" || dimension === "DAY_OF_WEEK" || dimension === "DAY" || dimension === "WEEK"
  if (timeBased) params.push(context.timeZone)
  const tz = `$${params.length}`
  // Assunto (submotivo; sem ele, o motivo) e motivo: agrega pelo CANÔNICO do nível quando há alias (bruto acessível em
  // rawSubjects); sem alias, o próprio bruto. No assunto, `reasons` traz os motivos dos atendimentos com submotivo (contexto).
  const bySubject = dimension === "SUBJECT" || dimension === "REASON"
  const level: SubjectLevel = dimension === "REASON" ? "REASON" : "SUBJECT"
  const bucketExpression =
    bySubject ? levelKeySql(level, "i")
    : dimension === "CHANNEL" ? "i.channel"
    : dimension === "HOUR" ? `lpad(extract(hour from i.started_at at time zone ${tz})::int::text, 2, '0') || 'h'`
    : dimension === "DAY_OF_WEEK" ? `extract(isodow from i.started_at at time zone ${tz})::int::text`
    : dimension === "DAY" ? `to_char((i.started_at at time zone ${tz})::date, 'YYYY-MM-DD')`
    : dimension === "WEEK" ? `to_char(date_trunc('week', i.started_at at time zone ${tz})::date, 'YYYY-MM-DD')`
    : null
  const rows = bucketExpression
    ? await context.db.query<{ bucket: string; count: string; avg_duration: string; total_duration: string; raw_subjects: string[] | null; reasons: string[] | null; canonical: boolean | null }>(
        `select ${bucketExpression} bucket, count(*) count, avg(extract(epoch from i.ended_at - i.started_at)) avg_duration, sum(extract(epoch from i.ended_at - i.started_at)) total_duration
                ${bySubject ? `, array_agg(distinct ${level === "REASON" ? "i.reason" : rawSubjectSql("i")} order by ${level === "REASON" ? "i.reason" : rawSubjectSql("i")}) raw_subjects, bool_or(${levelCanonicalSql(level, "i")} is not null) canonical` : ""}
                ${dimension === "SUBJECT" ? ", array_agg(distinct i.reason order by i.reason) filter (where nullif(btrim(i.sub_reason), '') is not null) reasons" : ""}
         from interactions i${where} group by 1 order by 2 desc, 1`,
        params,
      )
    : await context.db.query<{ bucket: string; count: string; avg_duration: string; total_duration: string; raw_subjects: string[] | null; reasons: string[] | null; canonical: boolean | null }>(
        `select cf.flag_name bucket, count(*) count, avg(extract(epoch from i.ended_at - i.started_at)) avg_duration, sum(extract(epoch from i.ended_at - i.started_at)) total_duration
         from interactions i join interaction_flags f on f.interaction_id = i.id join channel_flags cf on cf.id = f.channel_flag_id${where} and (f.value_boolean is true or f.value_numeric is not null)
         group by 1 order by 2 desc, 1`,
        params,
      )
  const totalCount = rows.rows.reduce((sum, row) => sum + Number(row.count), 0)
  const totalDuration = rows.rows.reduce((sum, row) => sum + Number(row.total_duration), 0)
  const buckets = rows.rows.map((row) => ({
    dimensionValue: dimension === "DAY_OF_WEEK" ? WEEKDAY_LABELS[Number(row.bucket)] : row.bucket,
    ...(bySubject ? { canonicalSubject: row.canonical ? row.bucket : null, rawSubjects: row.raw_subjects ?? [] } : {}),
    ...(row.reasons && row.reasons.length > 0 ? { reasons: row.reasons } : {}),
    value: metric === "INTERACTION_DURATION_SECONDS" ? Math.round(Number(row.avg_duration)) : Number(row.count),
    sampleCount: Number(row.count),
    averageDurationSeconds: Math.round(Number(row.avg_duration)),
    totalDurationSeconds: Math.round(Number(row.total_duration)),
    contribution: dimension === "FLAG" ? null : totalDuration > 0 && metric === "INTERACTION_DURATION_SECONDS" ? Math.round((Number(row.total_duration) / totalDuration) * 100) / 100 : totalCount > 0 ? Math.round((Number(row.count) / totalCount) * 100) / 100 : null,
  }))
  return {
    data: { indicator: indicator.code, dimension, metric: INTERACTION_METRIC_LABELS[metric], total: { interactions: totalCount, averageDurationSeconds: totalCount > 0 ? Math.round(totalDuration / totalCount) : null }, buckets, note: `proxy: ${INTERACTION_METRIC_LABELS[metric]} — o valor oficial/operacional do indicador continua sendo o de get_indicator_snapshot` },
    quality: totalCount === 0 ? noData("nenhuma interação registrada no recorte") : totalCount < 5 ? { status: "INSUFFICIENT_SAMPLE", sampleCount: totalCount, coverage: null, freshness: null, note: "menos de 5 interações — recorte indicativo" } : sufficient(totalCount, null),
    provenance: { period: describeWindow(period), population: "interações do colaborador", filters: [`dimensão ${definition.label}`, ...applied], dataSource: "INTERACTIONS (duração registrada)", method: dimension === "FLAG" ? "uma interação pode contar em mais de uma flag" : "contagem e média de duração por bucket" },
  }
}

/** Interações de PARES (Subgrupo/Grupo) no mesmo assunto/canal e janela — anônimas (sem nome). */
export async function findComparableInteractions(context: ToolContext, args: { subject: string; reference?: "SUBGROUP" | "GROUP"; period?: { from: string; to: string }; limit?: number }): Promise<ToolResult> {
  const period = resolvePeriod(context, args.period)
  const reference = args.reference ?? (context.subject.subteamId ? "SUBGROUP" : "GROUP")
  const population = await loadPeerPopulation(context, reference)
  // Comparável = MESMO ASSUNTO CANÔNICO (alias explícito do catálogo) ou, sem canônico, mesmo bruto exato — nunca aproximação.
  const resolution = await resolveCanonicalSubject(context.db, context.organizationId, args.subject)
  const subjectSql = subjectFilterSql(resolution, 3)
  const subjectLabel = resolution.canonical ? `assunto canônico ${resolution.canonical.code} (${resolution.canonical.name}; pedido "${args.subject}")` : `assunto bruto exato "${args.subject}" (sem canônico)`
  const subjectMatching = { requested: args.subject, canonicalSubject: resolution.canonical?.code ?? null, canonicalLabel: resolution.canonical?.name ?? null, mode: resolution.mode }
  const provenanceBase = { period: describeWindow(period), filters: [subjectLabel, `referência ${reference}`] }
  if (!population || population.ids.length < MINIMUM_COMPARISON_POPULATION) {
    return { data: { status: "POPULATION_TOO_SMALL", populationSize: population?.ids.length ?? 0, minimum: MINIMUM_COMPARISON_POPULATION }, quality: notSupported("população de referência insuficiente (privacidade)"), provenance: { ...provenanceBase, population: population?.label ?? "nenhuma", dataSource: "STRUCTURE" } }
  }
  const limit = Math.min(args.limit ?? 12, INTERACTION_LIST_MAX)
  const own = await context.db.query<{ channel: string; avg_duration: string | null; count: string }>(`select min(i.channel) channel, avg(extract(epoch from i.ended_at - i.started_at)) avg_duration, count(*) count from interactions i where i.organization_id = $1 and i.operator_id = $2${subjectSql.clause} and i.started_at >= $4 and i.started_at < $5`, [context.organizationId, context.subject.operatorId, subjectSql.param, period.start.toISOString(), period.end.toISOString()])
  const channel = own.rows[0]?.channel ?? null
  const stats = await context.db.query<{ count: string; operators: string; avg_duration: string | null; median_duration: string | null }>(
    `select count(*) count, count(distinct operator_id) operators, avg(extract(epoch from ended_at - started_at)) avg_duration,
            percentile_cont(0.5) within group (order by extract(epoch from ended_at - started_at)) median_duration
     from interactions i where i.organization_id = $1 and i.operator_id = any($2::uuid[])${subjectSql.clause} and i.started_at >= $4 and i.started_at < $5 ${channel ? "and i.channel = $6" : ""}`,
    channel ? [context.organizationId, population.ids, subjectSql.param, period.start.toISOString(), period.end.toISOString(), channel] : [context.organizationId, population.ids, subjectSql.param, period.start.toISOString(), period.end.toISOString()],
  )
  const total = Number(stats.rows[0]?.count ?? 0)
  const operators = Number(stats.rows[0]?.operators ?? 0)
  if (total === 0 || operators < 2) {
    return { data: { status: "NO_COMPARABLE", subjectMatching, comparableInteractions: total, distinctOperators: operators }, quality: noData("nenhuma interação comparável (mesmo assunto/canal) na população de referência"), provenance: { ...provenanceBase, population: population.label, dataSource: "INTERACTIONS" } }
  }
  // Seleção determinística: as mais curtas primeiro (regra por duração, não opinião) até o limite,
  // sem nome do operador — ids anônimos servem só para analyze_peer_patterns.
  const rows = await context.db.query<{ id: string; started_at: string; duration: string; flags: number }>(
    `select i.id, i.started_at, extract(epoch from i.ended_at - i.started_at) duration,
            (select count(*) from interaction_flags f where f.interaction_id = i.id and (f.value_boolean is true)) flags
     from interactions i where i.organization_id = $1 and i.operator_id = any($2::uuid[])${subjectSql.clause} and i.started_at >= $4 and i.started_at < $5 ${channel ? "and i.channel = $7" : ""}
     order by duration asc, i.started_at desc limit $6`,
    channel ? [context.organizationId, population.ids, subjectSql.param, period.start.toISOString(), period.end.toISOString(), limit, channel] : [context.organizationId, population.ids, subjectSql.param, period.start.toISOString(), period.end.toISOString(), limit],
  )
  return {
    data: {
      subject: args.subject,
      subjectMatching,
      channel,
      populationDefinition: `${population.label}: operadores ativos exceto o colaborador (n=${population.ids.length}); interações do mesmo assunto ${resolution.canonical ? "canônico" : "bruto"}${channel ? " e canal" : ""} na janela`,
      comparableInteractions: total,
      distinctOperators: operators,
      referenceAverageDurationSeconds: stats.rows[0]?.avg_duration === null ? null : Math.round(Number(stats.rows[0]!.avg_duration)),
      referenceMedianDurationSeconds: stats.rows[0]?.median_duration === null ? null : Math.round(Number(stats.rows[0]!.median_duration)),
      ownAverageDurationSeconds: own.rows[0]?.avg_duration === null || own.rows[0]?.avg_duration === undefined ? null : Math.round(Number(own.rows[0].avg_duration)),
      /** Própria − referência (segundos e %) — calculado aqui, nunca pelo modelo. */
      ownVersusReference: deltaOf(own.rows[0]?.avg_duration === null || own.rows[0]?.avg_duration === undefined ? null : Math.round(Number(own.rows[0].avg_duration)), stats.rows[0]?.avg_duration === null ? null : Math.round(Number(stats.rows[0]!.avg_duration))),
      ownInteractions: Number(own.rows[0]?.count ?? 0),
      selectionRule: "as interações comparáveis de MENOR duração (regra determinística), até o limite",
      // Interações de PARES: `peerInteractionId` vira handle P-n no Model Context (nunca UUID, nunca operador).
      interactions: rows.rows.map((row) => ({ peerInteractionId: row.id, localDate: new Date(row.started_at).toLocaleDateString("sv-SE", { timeZone: context.timeZone }), durationSeconds: Math.round(Number(row.duration)), booleanFlags: Number(row.flags) })),
    },
    quality: total < MINIMUM_COMPARISON_POPULATION ? { status: "INSUFFICIENT_SAMPLE", sampleCount: total, coverage: null, freshness: null, note: `só ${total} interação(ões) comparável(is)` } : sufficient(total, null),
    provenance: { ...provenanceBase, population: `${population.label} (n=${population.ids.length}, anônimo)`, dataSource: "INTERACTIONS", method: `mesmo assunto ${resolution.canonical ? "canônico (alias explícito do catálogo)" : "bruto exato"}/canal; duração registrada; ids sem identificação do operador` },
  }
}

// ---------------------------------------------------------------------------------------------
// Análise SEMÂNTICA de transcrições — a única parte que usa LLM, e mesmo assim devolve evidência
// estruturada verificada por código: trecho que não é literal da transcrição é descartado.
// ---------------------------------------------------------------------------------------------

/**
 * Contrato de evidência (V1.3.3): cada unidade = interação + turno + falante + trecho de UM turno.
 * Chaves antigas (`interactionId`/`excerpt`, sem turno) continuam aceitas — o verifier resolve o turno
 * pelo trecho; a concatenação de duas falas continua não literal (cite duas unidades).
 */
const evidenceUnitSchema = z.object({
  interactionRef: z.string().optional(),
  interactionId: z.string().optional(),
  /** V1.3.4.2 (§22–§26): referência EXPLICITAMENTE ordinal ("Interação #3") — traduzida pela apresentação; nunca inferida de "I3". */
  interactionOrdinal: z.coerce.number().int().min(1).optional().catch(undefined),
  turnRef: z.string().nullable().optional(),
  speaker: z.string().nullable().optional(),
  quote: z.string().optional(),
  excerpt: z.string().optional(),
}).transform((item) => ({ interactionRef: (item.interactionRef ?? item.interactionId ?? "").trim(), ...(item.interactionOrdinal !== undefined ? { interactionOrdinal: item.interactionOrdinal } : {}), turnRef: item.turnRef ?? null, speaker: item.speaker ?? null, quote: (item.quote ?? item.excerpt ?? "").trim() }))
  .refine((item) => (item.interactionRef.length > 0 || item.interactionOrdinal !== undefined) && item.quote.length >= 3, { message: "unidade de evidência precisa de interação (ref ou ordinal) e trecho (≥ 3 caracteres)" })
/**
 * V1.3.4: comparação temporal DECLARADA pela análise — validada/contada pela aplicação (blocos, direção, refs). Opcional e
 * TOLERANTE: uma relação desconhecida derruba só aquela relação — nunca os achados ("patterns"), que são a evidência principal.
 * V1.3.4.1 (§19): normalização do status por LISTA FECHADA. V1.3.4.2 (§2–§5) — POLÍTICA DE ALIAS: um alias de STATUS só
 * corrige grafia/typo ou uma representação lexicalmente equivalente do MESMO conceito ("NO_DIFFERENCE" = "NO_DIFFERENCE_
 * SUPPORTED"). Palavras de RELAÇÃO no campo status ("STABLE", "NO_CHANGE", "UNCHANGED", "CHANGED", "CHANGE_OBSERVED") NÃO viram
 * status: "nenhuma diferença sustentada" e "estabilidade" não são o mesmo conceito — a relação vai em `findings` e é validada
 * pela regra específica (validateRelation); o status fica INSUFFICIENT_EVIDENCE (normalização RELATION_AS_STATUS, preservada
 * na telemetria). Nada fuzzy: valor desconhecido = INSUFFICIENT_EVIDENCE (a aplicação não inventa interpretação) e fica registrado.
 */
export const TEMPORAL_STATUS_ALIASES: Readonly<Record<string, (typeof TEMPORAL_COMPARISON_STATUSES)[number]>> = {
  // erros de grafia
  NO_DEFFERENCE_SUPPORTED: "NO_DIFFERENCE_SUPPORTED",
  NO_DIFERENCE_SUPPORTED: "NO_DIFFERENCE_SUPPORTED",
  NO_DIFFERENCE_SUPORTED: "NO_DIFFERENCE_SUPPORTED",
  NO_DIFFERENCES_SUPPORTED: "NO_DIFFERENCE_SUPPORTED",
  DIFERENCE_OBSERVED: "DIFFERENCE_OBSERVED",
  DIFFERENCES_OBSERVED: "DIFFERENCE_OBSERVED",
  INSUFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE",
  INSUFFICIENT_EVIDENCES: "INSUFFICIENT_EVIDENCE",
  // representações lexicalmente equivalentes do MESMO conceito de status (abreviações)
  NO_DIFFERENCE: "NO_DIFFERENCE_SUPPORTED",
  NO_DIFFERENCE_OBSERVED: "NO_DIFFERENCE_SUPPORTED",
  DIFFERENCE: "DIFFERENCE_OBSERVED",
  DIFFERENCE_SUPPORTED: "DIFFERENCE_OBSERVED",
  INSUFFICIENT: "INSUFFICIENT_EVIDENCE",
  INSUFFICIENT_DATA: "INSUFFICIENT_EVIDENCE",
  NOT_ENOUGH_EVIDENCE: "INSUFFICIENT_EVIDENCE",
}
/** Palavras de RELAÇÃO que o modelo escreve no campo status (V1.3.4.2 §4/§5) — nunca promovidas a status; registradas para telemetria. */
export const TEMPORAL_RELATION_WORDS_IN_STATUS: readonly string[] = ["STABLE", "STABILITY", "NO_CHANGE", "NO_DISCERNIBLE_CHANGE", "UNCHANGED", "CHANGED", "CHANGE_OBSERVED", "INCREASED", "DECREASED", "CONCENTRATED", "DIFFERENT_PATTERN", "TREND"]
export type TemporalStatusNormalization = "EXACT" | "ALIAS" | "RELATION_AS_STATUS" | "UNKNOWN"
export function normalizeTemporalComparisonStatus(value: string): { status: (typeof TEMPORAL_COMPARISON_STATUSES)[number]; normalization: TemporalStatusNormalization; declared: string } {
  const upper = value.trim().toUpperCase().replace(/[\s-]+/g, "_")
  if ((TEMPORAL_COMPARISON_STATUSES as readonly string[]).includes(upper)) return { status: upper as (typeof TEMPORAL_COMPARISON_STATUSES)[number], normalization: "EXACT", declared: value }
  const alias = TEMPORAL_STATUS_ALIASES[upper]
  if (alias) return { status: alias, normalization: "ALIAS", declared: value }
  if (TEMPORAL_RELATION_WORDS_IN_STATUS.includes(upper)) return { status: "INSUFFICIENT_EVIDENCE", normalization: "RELATION_AS_STATUS", declared: value }
  return { status: "INSUFFICIENT_EVIDENCE", normalization: "UNKNOWN", declared: value }
}
const temporalFindingSchema = z.object({
  relation: z.enum(TEMPORAL_FINDING_RELATIONS),
  subjectFindingIndex: z.coerce.number().int().min(0),
  contrastFindingIndex: z.coerce.number().int().min(0).nullable().optional().catch(null),
  earlierBucket: z.string().trim(),
  laterBucket: z.string().trim(),
  evidenceRefs: z.array(z.string().trim()).default([]),
})
const temporalComparisonSchema = z.object({
  status: z.string().transform((value) => normalizeTemporalComparisonStatus(value)),
  comparedBuckets: z.array(z.string().trim()).default([]),
  findings: z.array(temporalFindingSchema.nullable().catch(null)).default([]).transform((items) => items.filter((item): item is z.infer<typeof temporalFindingSchema> => item !== null)),
}).optional().catch(undefined)
const patternsSchema = z.object({
  patterns: z.array(z.object({
    description: z.string().min(3),
    evidenceRequirement: z.enum(["ANY", "ALL"]).optional(),
    evidence: z.array(evidenceUnitSchema).min(1),
  })).max(8),
  temporalComparison: temporalComparisonSchema,
})

export const ANALYSIS_INSTRUCTIONS = `Você analisa transcrições de atendimento dentro de uma investigação com objetivo definido. Cada transcrição vem em TURNOS numerados ("[T3] CLIENTE: …"): um turno = uma fala. Responda SOMENTE com JSON válido:
{"patterns":[{"description":"achado observado, em 1 frase objetiva (fato, não julgamento)","evidenceRequirement":"ANY ou ALL","evidence":[{"interactionRef":"referência da interação (ex.: ${EXAMPLE_INTERACTION_REF})","turnRef":"turno de onde veio o trecho (ex.: T3)","speaker":"falante do turno (ex.: CLIENTE)","quote":"trecho LITERAL e EXATO copiado de UM único turno (copie e cole, nunca parafraseie)"}]}]}
Cada transcrição tem um cabeçalho "=== P-k · … ===" (ou "=== I-k · … ==="): o primeiro item é a referência da interação (interactionRef) — use SEMPRE essa referência, nunca uma posição.
Regras: (1) só achados que aparecem LITERALMENTE nas transcrições; (2) cada trecho vem de UM turno — se o achado depende de duas falas (pergunta e resposta), cite DUAS unidades, uma por turno, e marque evidenceRequirement "ALL" (todas necessárias); "ANY" quando uma fala basta; (3) cite TODAS as interações analisadas em que o achado ocorre (ao menos uma unidade por interação), porque a contagem é feita por trecho verificado; (4) nunca invente causa — descreva o que foi dito/feito; (5) não use nomes de pessoas; (6) não force achados: se nada relevante para o objetivo aparecer, devolva {"patterns":[]} — zero achados sustentados vale mais que um inventado; (7) inclua também o que contradiz ou complica o objetivo (exceções, inconsistências literais, diferenças entre interações).`

/** Instruções adicionais quando a janela tem mais de um bloco (V1.3.4): a posição é dada; a relação precisa ser comparada. */
export const TEMPORAL_ANALYSIS_INSTRUCTIONS = `TEMPO: cada interação traz o bloco da janela (B-n) e a data local CALCULADOS pela aplicação — a ordem em que aparecem no texto e o estilo da conversa NÃO indicam tempo. Ver dados de vários blocos é COBERTURA; afirmar que algo mudou entre blocos é RELAÇÃO e exige comparar. Além de "patterns", devolva SEMPRE:
"temporalComparison":{"status":"DIFFERENCE_OBSERVED|NO_DIFFERENCE_SUPPORTED|INSUFFICIENT_EVIDENCE","comparedBuckets":["B1","B3"],"findings":[{"relation":"INCREASED|DECREASED|CHANGED|STABLE|CONCENTRATED|DIFFERENT_PATTERN","subjectFindingIndex":0,"contrastFindingIndex":null,"earlierBucket":"B1","laterBucket":"B3","evidenceRefs":["${EXAMPLE_INTERACTION_REF}","${EXAMPLE_INTERACTION_REF}"]}]}
— status é EXATAMENTE um dos três valores acima; "STABLE"/"NO_CHANGE"/"CHANGED" são RELAÇÕES e vão SÓ em findings (status com relação = comparação insuficiente). "Nenhuma diferença sustentada" não é "estável": estabilidade só como finding STABLE, que a aplicação valida em todos os blocos.
— subjectFindingIndex = índice (0-based) do achado em "patterns" a que a relação se refere; contrastFindingIndex só em DIFFERENT_PATTERN (o achado que aparece no bloco posterior no lugar do sujeito); earlierBucket é anterior a laterBucket; evidenceRefs = interações ANALISADAS desses blocos. "NO_DIFFERENCE_SUPPORTED" (comparou e não há diferença sustentada) é resposta válida e não precisa de findings; "INSUFFICIENT_EVIDENCE" quando faltam blocos com transcrição. AUSÊNCIA NA AMOSTRA ≠ AUSÊNCIA NO BLOCO: um achado sem trecho nas transcrições analisadas de um bloco é "não observado na amostra", nunca "deixou de ocorrer" — a aplicação calcula por bloco analisadas × universo e só ela decide se a ausência está estabelecida. A aplicação recalcula as contagens e rebaixa relações que os números não sustentam — nunca invente tendência.`

/** `reason` = assunto bruto preferencial (`SUBJECT_RESOLUTION_V2`: submotivo, senão o motivo) — o que a análise recebe como assunto. */
export async function loadTranscripts(context: ToolContext, interactionIds: string[], operatorIds: string[] | null): Promise<{ id: string; content: string; reason: string; operatorId: string; startedAt: string }[]> {
  const rows = await context.db.query<{ id: string; content: string; reason: string; operator_id: string; started_at: string }>(
    `select i.id, ${rawSubjectSql("i")} reason, i.operator_id, i.started_at, t.content
     from interactions i join lateral (select content from transcripts t where t.interaction_id = i.id order by t.version desc limit 1) t on true
     where i.organization_id = $1 and i.id = any($2::uuid[]) ${operatorIds ? "and i.operator_id = any($3::uuid[])" : ""}`,
    operatorIds ? [context.organizationId, interactionIds, operatorIds] : [context.organizationId, interactionIds],
  )
  // Sujeito e pares: o modelo só recebe o texto com a PII evidente mascarada (R-31, transcript.ts); a projeção dos pares
  // redige também a identidade deles por cima disso. A citação é conferida contra o que o modelo recebeu.
  return rows.rows.map((row) => ({ id: row.id, content: transcriptForModel(row.content), reason: row.reason, operatorId: row.operator_id, startedAt: row.started_at }))
}

export type PeerPrivacyAudit = { version: string; redactedTranscripts: number; redactions: Record<string, number>; reidentificationRejected: number; projections: { handle: string; sourceHash: string; redactions: number }[] }

/**
 * Roda a análise sobre transcrições já carregadas e verifica cada trecho contra a transcrição de origem.
 * PARES (`peers`): o modelo NUNCA recebe a transcrição bruta — só a projeção de privacidade
 * (peer-privacy-projection.ts: identidade do par e PII evidente redigidas, handle P-n); a citação é
 * verificada contra a PROJEÇÃO e recusada se reintroduzir a identidade. O bruto continua no banco
 * (AUDIT), rastreável por handle + sourceHash.
 */
export type VerifiedExcerpt = { interactionId: string; interactionRef: string; turnRef: string; speaker: string | null; excerpt: string; /** V1.3.4.2: HANDLE (ref citado) ou PRESENTATION_ORDINAL (traduzido da posição). */ referenceResolution?: "HANDLE" | "PRESENTATION_ORDINAL" | undefined }
export type AnalysisFinding = FindingCounts & { finding: string; evidenceRequirement: EvidenceRequirement; verifiedExcerpts: VerifiedExcerpt[]; evidenceStrength: "STRONG" | "MODERATE" | "WEAK"; /** V1.4.0 (só alvo): kind derivado dos findings, suporte calculado e provenance (findingRefs "I-ref/F-id"). */ kind?: PatternKind | undefined; /** V1.4.6: dono semântico do pattern — base do teto de claim por ownership. */ ownership?: Ownership | undefined; support?: PatternSupport | undefined; findingRefs?: string[] | undefined; /** V1.4.2: handle canônico de claim (SP-n). */ handle?: string | undefined }

/** Projeções model-facing das transcrições da amostra (alvo: bruto → turnos; par: privacidade → turnos), indexadas por handle. */
function projectSample(sample: { id: string; content: string }[], handleOf: Map<string, string>, projections: Map<string, PeerTranscriptPrivacyProjection> | null): Map<string, ProjectedInteraction> {
  const out = new Map<string, ProjectedInteraction>()
  for (const transcript of sample) {
    const privacy = projections?.get(transcript.id)
    const projection = projectTranscript(privacy?.projected ?? transcript.content, { maxChars: TRANSCRIPT_MAX_CHARS })
    const ref = handleOf.get(transcript.id)!
    out.set(ref, { interactionRef: ref, interactionId: transcript.id, projection, forbiddenTerms: privacy?.forbiddenTerms })
  }
  return out
}

/** Resultado da camada semântica (V1.4.0) exposto no `data` da Tool — frames por interação, patterns derivados e telemetria compacta. */
export type SemanticAnalysisData = { version: string; frames: InteractionSemanticFrame[]; patterns: CrossInteractionPattern[]; telemetry: SemanticTelemetry }

/** V1.4.6: resultado × atribuição exposto no `data` da Tool — o estado das necessidades e de quê ele depende. */
export type OutcomeAnalysisData = { version: string; outcomes: NeedOutcome[]; attributions: NeedAttribution[]; telemetry: OutcomeAttributionTelemetry }

/** V1.4.5: avaliação procedimental exposta no `data` da Tool — regras verificadas, comparações e cobertura. */
export type ProceduralAnalysisData = { version: string; rules: KnowledgeRule[]; evaluations: ProceduralEvaluation[]; coverage: ReturnType<typeof proceduralCoverageOf>; telemetry: ProceduralTelemetry }

/** Trechos da base disponíveis para a avaliação procedimental — no máximo 8 por execução (custo limitado). */
const KNOWLEDGE_EXCERPTS_MAX = 8
const KNOWLEDGE_EXCERPT_MAX_CHARS = 1400
/** Consultas dirigidas (fallback) quando o Agent não chamou `query_knowledge`: uma por assunto afirmado, no máximo 3. */
const TARGETED_KNOWLEDGE_QUERIES_MAX = 3

/**
 * FASE K (V1.4.5 §8/§9/§15/§32) — AVALIAÇÃO PROCEDIMENTAL, entre a Fase A e a Fase B.
 *
 * Sem Tool nova: o insumo são os trechos que `query_knowledge` já recuperou nesta execução e, quando o Agent não consultou
 * a base, uma recuperação DIRIGIDA pelos assuntos efetivamente afirmados, usando o MESMO retrieval autorizado
 * (`retrieveKnowledgeForAgent`, só bases publicadas do Agent). A partir daí:
 *   LLM   → traduz cada trecho em KnowledgeRule (sujeito, modalidade, condição, ação, valor) com trecho LITERAL;
 *   código→ verifica o trecho, normaliza o valor, escolhe a regra do MESMO assunto, checa a condição e compara (determinístico).
 * Sem trecho que sustente a regra, o estado é INSUFFICIENT_KNOWLEDGE — nunca conhecimento geral (§14).
 */
async function evaluateProceduralLayer(context: ToolContext, verified: ReturnType<typeof verifySemanticFrames>, askModel: (systemPrompt: string, userText: string, route: ReturnType<typeof routeFor>, objectiveChars: number) => Promise<string>): Promise<ProceduralAnalysisData | null> {
  const telemetry = emptyProceduralTelemetry()
  const assertions: AssertionInput[] = verified.frames.flatMap((frame) => {
    const contextText = [...frame.customerNeeds, ...frame.questions, ...frame.answers, ...frame.agentActions, ...frame.agentStatements, ...frame.commitments, ...frame.procedureAssertions].map((observation) => observation.summary).join(" ") + " " + frame.procedureAssertions.flatMap((assertion) => assertion.evidence.map((unit) => unit.quote)).join(" ")
    // V1.4.6: a semântica normativa vem do SIDECAR (anotação); sem ela a afirmação não é avaliada — nunca é inventada aqui.
    return frame.procedureAssertions.filter((assertion) => assertion.semantics).map((assertion) => ({ interactionRef: frame.interactionRef, assertionRef: assertion.id, summary: assertion.summary, semantics: assertion.semantics!, contextText: `${contextText} ${assertion.semantics!.condition ?? ""}` }))
  })
  telemetry.assertionsDeclared = assertions.length
  telemetry.assertionsWithSemantics = assertions.filter((item) => item.semantics.modality !== "ASSERTED_FACT" || item.semantics.value !== null).length
  telemetry.quantitiesParsedAssertion = assertions.filter((item) => item.semantics.value !== null).length
  if (assertions.length === 0) return null

  // TRECHOS DA BASE (§15): a pergunta certa é "o que o procedimento diz SOBRE O QUE ELE AFIRMOU". Os trechos que o Agent já
  // recuperou por outro motivo raramente são sobre esses assuntos (o smoke da V1.4.5 mostrou 8 trechos disponíveis e 0 regra
  // aplicável), então a recuperação DIRIGIDA pelos assuntos afirmados roda sempre — mesmo retrieval autorizado, sem Tool nova.
  // Ordem de prioridade: dirigidos primeiro, depois o que já havia; teto único de trechos (custo limitado).
  const targeted = new Map<string, KnowledgeExcerptRecord>()
  // Sem Agent (análise direta do feedback de atendimento) não existe base autorizada para buscar — nada é recuperado.
  const knowledgeAgentId = context.agentId
  for (const subject of knowledgeAgentId ? [...new Set(assertions.map((item) => item.semantics.subject || item.summary))].slice(0, TARGETED_KNOWLEDGE_QUERIES_MAX) : []) {
    const result = await retrieveKnowledgeForAgent(context.db, knowledgeAgentId!, subject)
    for (const excerpt of result.trace.retrieved) {
      const record = { documentId: excerpt.documentId, documentTitle: excerpt.documentTitle, heading: excerpt.heading, excerpt: excerpt.excerpt }
      context.knowledgeCandidates.set(excerpt.documentId, { materialId: excerpt.documentId, title: excerpt.documentTitle })
      context.knowledgeExcerpts?.set(`${excerpt.documentId}#${excerpt.heading}`, record)
      targeted.set(`${excerpt.documentId}#${excerpt.heading}`, record)
    }
  }
  const existing = [...(context.knowledgeExcerpts?.entries() ?? [])].filter(([key]) => !targeted.has(key)).map(([, record]) => record)
  const records = [...targeted.values(), ...existing]
  telemetry.knowledgeSource = targeted.size > 0 ? "TARGETED_RETRIEVAL" : records.length > 0 ? "TOOL_RESULTS" : "NONE"
  const excerpts: KnowledgeExcerptView[] = records.slice(0, KNOWLEDGE_EXCERPTS_MAX).map((record) => ({ documentRef: context.handles.register("K", record.documentId), documentId: record.documentId, documentTitle: record.documentTitle, heading: record.heading, excerpt: record.excerpt.slice(0, KNOWLEDGE_EXCERPT_MAX_CHARS) }))
  telemetry.knowledgeExcerptsAvailable = excerpts.length

  let rules: KnowledgeRule[] = []
  if (excerpts.length > 0) {
    const systemPrompt = renderKnowledgeRuleExtractionInstructions()
    const userText = `AFIRMAÇÕES NORMATIVAS a confrontar:\n${renderAssertionsForKnowledge(assertions)}\n\nTRECHOS DA BASE:\n${renderKnowledgeExcerpts(excerpts)}`
    const route = routeFor({ purpose: "ANALYZE_INTERACTIONS", phase: "SEMANTIC_ANALYSIS", numberOfTranscripts: 0, transcriptChars: 0, estimatedInputTokens: estimateTokens(systemPrompt, userText) })
    const raw = await askModel(systemPrompt, userText, route, 0)
    try {
      rules = verifyKnowledgeRules(knowledgeRuleExtractionSchema.parse(JSON.parse(stripFence(raw))).rules, excerpts, telemetry)
    } catch {
      rules = []
    }
  }
  const evaluations = evaluateProcedureAssertions(assertions, rules)
  telemetry.evaluations = evaluations.length
  for (const evaluation of evaluations) telemetry.byStatus[evaluation.status] += 1
  const coverage = proceduralCoverageOf(evaluations)
  telemetry.coverage = coverage.coverage
  attachProceduralFindings(evaluations.map((item) => ({ interactionRef: item.interactionRef, assertionRef: item.assertionRef, assertionSummary: item.assertionSummary, status: item.status, reason: item.reason, rule: item.rule ? { ruleRef: item.rule.ruleRef, documentTitle: item.rule.documentTitle } : null })), verified)
  return { version: telemetry.version, rules, evaluations, coverage, telemetry }
}

async function analyzeTranscripts(context: ToolContext, transcripts: { id: string; content: string; reason: string; operatorId?: string; startedAt?: string }[], objective: string, peers = false, peerContext: { knownOperatorIds: string[] } = { knownOperatorIds: [] }, coverageOverride?: AnalysisCoverage): Promise<{ findings: AnalysisFinding[]; coverage: AnalysisCoverage; discarded: number; verification: EvidenceVerificationTelemetry; raw: string; privacy: PeerPrivacyAudit | null; temporalComparison: TemporalComparison | null; semantic: SemanticAnalysisData | null; procedural: ProceduralAnalysisData | null; outcome: OutcomeAnalysisData | null }> {
  const sample = transcripts.slice(0, TRANSCRIPT_ANALYSIS_MAX)
  // Zero-ID também aqui (V1.3): a transcrição vai identificada pelo handle (I-n; P-n para pares), nunca pelo UUID.
  const handleOf = new Map(sample.map((transcript) => [transcript.id, context.handles.register(peers ? "P" : "I", transcript.id)]))
  const projections = peers ? await projectPeerTranscripts(context, sample, peerContext.knownOperatorIds) : null
  // TRANSCRIPT PROJECTION (V1.3.3): turnos T1..Tn sem timestamp — o que o modelo lê é o que a verificação usa.
  const projected = projectSample(sample, handleOf, projections)
  // POSIÇÃO TEMPORAL (V1.3.4): bloco + data local calculados pela aplicação para cada transcrição do ALVO (pares: sem janela).
  const buckets: TemporalBucket[] = !peers && context.investigation.temporalBuckets > 1 ? temporalBucketsOf(context.defaultPeriod, context.investigation.temporalBuckets, (date) => date.toLocaleDateString("sv-SE", { timeZone: context.timeZone })) : []
  const positions = new Map<string, TemporalPosition | null>(sample.map((transcript) => [transcript.id, !peers && transcript.startedAt ? temporalPositionOf(new Date(transcript.startedAt), context.defaultPeriod, context.investigation.temporalBuckets, (date) => date.toLocaleDateString("sv-SE", { timeZone: context.timeZone })) : null]))
  const input = buildTranscriptAnalysisInput(sample, handleOf, projections, { buckets, positions })
  // CONTEXTO INVESTIGATIVO (V1.3.2): objetivo derivado, escopo exigido, intenção do período e lacunas materiais
  // abertas — a análise sabe POR QUE existe; pares recebem só o pedido (sem o estado da investigação do alvo).
  const analysisObjective = !peers && context.investigation.analysisObjective ? { ...context.investigation.analysisObjective, analysisPurpose: objective } : null
  const objectiveBlock = analysisObjective ? renderInteractionAnalysisObjective(analysisObjective) : `Objetivo da análise: ${objective}`
  const temporalInstructions = buckets.length > 1 ? `\n\n${TEMPORAL_ANALYSIS_INSTRUCTIONS}` : ""
  const transcriptChars = sample.reduce((sum, transcript) => sum + Math.min(transcript.content.length, TRANSCRIPT_MAX_CHARS), 0)
  const purpose = peers ? "ANALYZE_PEER_PATTERNS" : "ANALYZE_INTERACTIONS"
  // Roteamento por sinais (nº/tamanho das transcrições); falha de parse escala UMA vez de tier (nunca por erro de rede).
  const askModel = async (systemPrompt: string, userText: string, route: ReturnType<typeof routeFor>, objectiveChars: number, stage: "EXTRACTION" | "SYNTHESIS" | "SIDECAR" | "NEED_KIND" = "EXTRACTION") => {
    const contextBreakdown = { staticPromptChars: systemPrompt.length, toolSchemaChars: 0, evidenceLedgerChars: 0, interactionContentChars: userText.length, knowledgeContentChars: 0, structuredSchemaChars: 0, objectiveChars }
    const reply = await withLlmScope({ role: "agent", agentId: context.agentId, phase: "SEMANTIC_ANALYSIS" }, () =>
      generateForRoute({ classification: { phase: "SEMANTIC_ANALYSIS", purpose, source: "INVESTIGATION_TOOL", semanticType: "SEMANTIC_ANALYSIS", tags: [`stage:${stage}`, ...(context.semanticFlow ? [`flow:${context.semanticFlow}`] : [])] }, contextBreakdown, systemPrompt, contents: [{ role: "user", text: userText }], tools: [], structuredOutput: true, route }),
    )
    context.telemetry.requests.push({ phase: "SEMANTIC_ANALYSIS", model: reply.model, usage: reply.usage, durationMs: reply.durationMs, toolCalls: [], route: routeRecordOf(route), stage })
    return reply.kind === "text" ? reply.text : ""
  }
  const coverage = coverageOverride ?? analysisCoverageOf(sample.length, null)
  const empty = (raw: string) => ({ findings: [] as AnalysisFinding[], coverage, discarded: 0, verification: emptyVerificationTelemetry(), raw, privacy: privacyAudit(projections, handleOf, 0), temporalComparison: null, semantic: null, procedural: null, outcome: null })

  let findings: AnalysisFinding[]
  let verification: EvidenceVerificationTelemetry
  let semanticData: SemanticAnalysisData | null = null
  let proceduralData: ProceduralAnalysisData | null = null
  let outcomeTelemetry: OutcomeAttributionTelemetry = emptyOutcomeAttributionTelemetry()
  let needOutcomes: NeedOutcome[] = []
  let needAttributions: NeedAttribution[] = []
  let declaredComparisonSource: z.infer<typeof temporalComparisonSchema>
  let raw: string
  if (!peers) {
    // ===== V1.4.0 — DUAS FASES (decisão §21 por experimento: contrato combinado → 1 frame em 8; só-frames → 8/8) =====
    // FASE A — extração semântica: um frame por interação (observações + findings da própria interação), sem patterns.
    const handles = sample.map((transcript) => handleOf.get(transcript.id)!)
    const frameSystem = `${renderFrameExtractionInstructions(handles)}\n\n${objectiveBlock}`
    let route = routeFor({ purpose, phase: "SEMANTIC_ANALYSIS", numberOfTranscripts: sample.length, transcriptChars, estimatedInputTokens: estimateTokens(frameSystem, input) })
    raw = await askModel(frameSystem, input, route, objective.length)
    let frames = parseFrameExtractionOutput(raw)
    if (!frames) {
      route = escalateRoute(route, "PARSE_FAILURE")
      raw = await askModel(frameSystem, input, route, objective.length)
      frames = parseFrameExtractionOutput(raw)
      if (!frames) return empty(raw)
    }
    // V1.4.6.8: completude ESTRUTURAL medida por código (JSON válido ≠ contrato completo) — antes do retry, sobre a resposta
    // que parseou. Só observa: o retry e o descarte do verifier não mudam.
    const initialContract = assessFrameContract(frames.frames, handles)
    // Retry DIRIGIDO (uma vez): só os handles sem frame — nunca a amostra inteira de novo.
    const returned = new Set(frames.frames.map((frame) => frame.interactionRef.toUpperCase()))
    const missing = handles.filter((handle) => !returned.has(handle))
    let recovered = 0
    if (missing.length > 0) {
      const missingIds = sample.filter((transcript) => missing.includes(handleOf.get(transcript.id)!))
      const retryInput = buildTranscriptAnalysisInput(missingIds, handleOf, projections, { buckets, positions })
      const retryRaw = await askModel(`${renderFrameExtractionInstructions(missing)}\n\n${objectiveBlock}\n\n${renderMissingFramesRequest(missing)}`, retryInput, route, objective.length)
      const retryFrames = parseFrameExtractionOutput(retryRaw)
      if (retryFrames) {
        const extra = retryFrames.frames.filter((frame) => missing.includes(frame.interactionRef.toUpperCase()))
        recovered = new Set(extra.map((frame) => frame.interactionRef.toUpperCase())).size
        frames = { frames: [...frames.frames, ...extra] }
        raw = `${raw}\n\n/* retry frames ${missing.join(",")} */\n${retryRaw}`
      }
    }
    const verified = verifySemanticFrames(frames.frames, projected)
    verified.telemetry.phases = "TWO_PHASE"
    verified.telemetry.framesRecoveredByRetry = recovered
    verified.telemetry.frameContract = { initial: summarizeFrameContract(initialContract), retryAttempted: missing.length > 0, afterRetry: missing.length > 0 ? summarizeFrameContract(assessFrameContract(frames.frames, handles)) : null }
    // FASE B (V1.4.1) — completar FINDINGS a partir das observações verificadas + síntese de patterns, sobre os frames COMPACTOS
    // (sem transcrições): roda quando existe alguma observação (a promoção pode dar finding a um frame sem finding); frames
    // vazios continuam vazios (FRAME_MISS não é corrigido aqui).
    let declaredPatterns: DeclaredPattern[] = []
    declaredComparisonSource = undefined
    if (verified.telemetry.observationsCount > 0 || verified.telemetry.findingsCount > 0) {
      const positionOf = (ref: string) => { const id = [...handleOf.entries()].find(([, handle]) => handle === ref)?.[0]; const position = id ? positions.get(id) : null; const reason = id ? sample.find((transcript) => transcript.id === id)?.reason : null; return `${ref}${position ? ` · ${position.bucketRef} · ${position.localDate}` : ""}${reason ? ` · assunto: ${reason}` : ""}` }
      const contextLine = `AMOSTRA: ${sample.length} transcrição(ões) analisada(s)${coverage.recordedUniverseCount !== null ? ` de ${coverage.recordedUniverseCount} registrada(s) no período (${coverage.universeRelationship})` : " (universo desconhecido)"}. A aplicação calcula o suporte de cada pattern (OBSERVED · REPEATED_IN_SAMPLE · RECURRENT_IN_SAMPLE · EMPLOYEE_PATTERN_SUPPORTED) e a comparação temporal — não escreva contagens nem generalizações nas descrições.`
      const framesText = `${buckets.length > 1 ? `${renderTemporalBuckets(buckets)}\n\n` : ""}${contextLine}\n\n${renderFramesForModel(verified.frames, positionOf)}`
      const patternSystem = `${renderPatternSynthesisInstructions()}${temporalInstructions}\n\n${objectiveBlock}`
      const patternRoute = routeFor({ purpose, phase: "SEMANTIC_ANALYSIS", numberOfTranscripts: sample.length, transcriptChars: 0, estimatedInputTokens: estimateTokens(patternSystem, framesText) })
      let patternRaw = await askModel(patternSystem, framesText, patternRoute, objective.length, "SYNTHESIS")
      let parsedPatterns = parsePatternSynthesisOutput(patternRaw)
      if (!parsedPatterns) {
        patternRaw = await askModel(patternSystem, framesText, escalateRoute(patternRoute, "PARSE_FAILURE"), objective.length, "SYNTHESIS")
        parsedPatterns = parsePatternSynthesisOutput(patternRaw)
      }
      if (parsedPatterns) {
        // Promoção só com observationRefs existentes — a Fase B nunca cria observação nem trecho.
        promoteFindings(parsedPatterns.findings, verified)
        declaredPatterns = parsedPatterns.patterns
        declaredComparisonSource = parseTemporalComparison(patternRaw)
      }
      raw = `${raw}\n\n/* patterns */\n${patternRaw}`
    }
    // ===== V1.4.6 — SIDECAR: RESULTADO ≠ ATRIBUIÇÃO (§14–§18) =====
    // Roda DEPOIS que a descoberta terminou (Fase A e Fase B idênticas à V1.4.4, entrada e saída). Ele não reescreve
    // observação nenhuma: anota de quê o resultado de cada necessidade depende e o significado normativo das afirmações,
    // e a aplicação decide o resto. Falha do sidecar (§25) não invalida nada — a investigação segue com tudo neutro.
    outcomeTelemetry = emptyOutcomeAttributionTelemetry()
    needOutcomes = needOutcomesOf(verified.frames)
    const sidecarUseful = verified.frames.some((frame) => frame.customerNeeds.length + frame.procedureAssertions.length > 0)
    if (sidecarUseful) {
      const sidecarSystem = `${renderSidecarInstructions()}\n\n${objectiveBlock}`
      const sidecarText = renderSidecarInput(verified.frames)
      const sidecarRoute = routeFor({ purpose, phase: "SEMANTIC_ANALYSIS", numberOfTranscripts: 0, transcriptChars: 0, estimatedInputTokens: estimateTokens(sidecarSystem, sidecarText) })
      const sidecarRaw = await askModel(sidecarSystem, sidecarText, sidecarRoute, objective.length, "SIDECAR")
      raw = `${raw}\n\n/* sidecar */\n${sidecarRaw}`
      try {
        const declared = outcomeSidecarOutputSchema.parse(JSON.parse(stripFence(sidecarRaw)))
        // (1) significado normativo: ANOTAÇÃO sobre a afirmação já verificada (nunca muda trecho nem cria afirmação).
        for (const item of declared.assertions) {
          const frame = verified.frames.find((entry) => entry.interactionRef === item.interactionRef.trim().toUpperCase())
          const assertion = frame?.procedureAssertions.find((entry) => entry.id === item.assertionRef.trim().toUpperCase())
          if (assertion) assertion.semantics = assertionSemanticsFrom(item, assertion.summary)
        }
        // (2) avaliação procedimental determinística (V1.4.5 reaproveitada) — precisa vir antes da ponte de atribuição,
        // porque uma divergência procedimental APLICÁVEL é uma das pontes válidas (§8).
        proceduralData = await evaluateProceduralLayer(context, verified, askModel)
        const divergentInteractions = new Set((proceduralData?.evaluations ?? []).filter((item) => item.status === "CONTRADICTED").map((item) => item.interactionRef))
        // (3) atribuição VALIDADA por código: AGENT_ACTION sem ponte cai para NOT_DETERMINED.
        needAttributions = validateNeedAttributions(declared.needs, verified.frames, divergentInteractions)
        outcomeTelemetry.attributionsDeclared = declared.needs.length
        countAttributions(needAttributions, outcomeTelemetry)
        outcomeTelemetry.sidecarStatus = "OK"
      } catch {
        // §25 — PROCEDURAL_SIDECAR_FAILED: sem atribuição nenhuma, tudo permanece resultado neutro da interação.
        outcomeTelemetry.sidecarStatus = "FAILED"
      }
    }
    // ===== V1.4.8f — SIDECAR needKind (desligado por padrão: INIA_NEED_KIND_SIDECAR=ON) =====
    // Chamada PRÓPRIA depois da Fase A, da Fase B e do sidecar de atribuição (nenhuma entrada deles muda). Só ANOTA a intenção
    // das necessidades já verificadas; fail-closed — qualquer falha vira UNKNOWN, nunca INFORMATION. Não cria finding/claim.
    if (env.INIA_NEED_KIND_SIDECAR === "ON") {
      const needKindItems = buildNeedKindItems(verified.frames, projected)
      if (needKindItems.length > 0) {
        const needKindInput = renderNeedKindInput(needKindItems)
        const requestSha256 = createHash("sha256").update(`${NEED_KIND_SYSTEM_PROMPT}\n\n${needKindInput}`, "utf8").digest("hex")
        const needKindRoute = routeFor({ purpose, phase: "SEMANTIC_ANALYSIS", numberOfTranscripts: 0, transcriptChars: 0, estimatedInputTokens: estimateTokens(NEED_KIND_SYSTEM_PROMPT, needKindInput) })
        const requestsBefore = context.telemetry.requests.length
        let needKindValidation: NeedKindValidation
        try {
          const needKindRaw = await askModel(NEED_KIND_SYSTEM_PROMPT, needKindInput, needKindRoute, 0, "NEED_KIND")
          raw = `${raw}\n\n/* needKind */\n${needKindRaw}`
          needKindValidation = validateNeedKindOutput(needKindRaw, needKindItems)
        } catch {
          needKindValidation = needKindProviderFailure(needKindItems)
        }
        const model = context.telemetry.requests.length > requestsBefore ? context.telemetry.requests[context.telemetry.requests.length - 1]!.model : null
        applyNeedKindAnnotations(verified.frames, needKindValidation, { model, requestSha256 })
        verified.telemetry.needKind = needKindTelemetryOf(needKindValidation)
      }
    }
    // (4) reclassificação determinística: necessidade aberta só continua sendo risco do operador com atribuição AGENT (§5/§11).
    applyNeedAttributions(verified.frames, needAttributions, outcomeTelemetry)
    // (5) findings procedimentais (§18): só APPLICABLE+DIVERGENT vira divergência; aderência verificada vira força.
    const proceduralFindings = proceduralData ? attachProceduralFindings(proceduralData.evaluations.map((item) => ({ interactionRef: item.interactionRef, assertionRef: item.assertionRef, assertionSummary: item.assertionSummary, status: item.status, reason: item.reason, rule: item.rule ? { ruleRef: item.rule.ruleRef, documentTitle: item.rule.documentTitle } : null })), verified) : []
    for (const frame of verified.frames) for (const finding of frame.findings) if (!finding.ownership) finding.ownership = findingOwnership(finding, null)
    // Os findings procedimentais nascem DEPOIS da Fase B (para não mudar a entrada dela), então nenhum pattern declarado
    // pode citá-los: a aplicação agrupa por tipo, deterministicamente, uma descrição por grupo. Nada é inventado — cada
    // grupo carrega exatamente os findings criados pela comparação com a base.
    const sidecarPatterns: DeclaredPattern[] = ([
      ["PROCEDURAL_DIVERGENCE", "afirmações sobre procedimento divergentes do que a base registra"],
      ["STRENGTH", "afirmações sobre procedimento coerentes com a base verificada"],
      ["PROCEDURAL_QUESTION", "afirmações sobre procedimento a verificar contra a base"],
    ] as const).flatMap(([kind, description]) => {
      const group = proceduralFindings.filter((finding) => finding.kind === kind)
      return group.length === 0 ? [] : [{ description, kind: null, findingRefs: group.map((finding) => `${finding.interactionRef}/${finding.id}`), evidence: [], evidenceRequirement: undefined }]
    })
    const patterns = deriveCrossInteractionPatterns([...declaredPatterns, ...sidecarPatterns], verified, { analyzedTranscriptCount: sample.length, recordedUniverseCount: coverage.recordedUniverseCount, bucketOf: (ref) => { const id = [...handleOf.entries()].find(([, handle]) => handle === ref)?.[0]; return id ? positions.get(id)?.bucketRef ?? null : null }, bucketCount: buckets.length > 1 ? buckets.length : 1 })
    // V1.4.2: handles CANÔNICOS de claim (SF-n por finding, SP-n por pattern) — sequência única da execução (HandleRegistry).
    assignClaimHandles({ frames: verified.frames, patterns }, (kind) => context.handles.nextClaimHandle(kind))
    // findings (formato legado) = PATTERNS derivados por código de frames → findings → observations (provenance até o turno).
    findings = patterns.map((pattern) => patternAsFinding(pattern, coverage))
    verification = verified.verification
    semanticData = { version: verified.telemetry.version, frames: verified.frames, patterns, telemetry: verified.telemetry }
  } else {
    // PARES — contrato de padrões V1.3.x (amostra anônima projetada; sem estado da investigação do alvo).
    const systemPrompt = `${ANALYSIS_INSTRUCTIONS}${temporalInstructions}\n\n${objectiveBlock}`
    let route = routeFor({ purpose, phase: "SEMANTIC_ANALYSIS", numberOfTranscripts: sample.length, transcriptChars, estimatedInputTokens: estimateTokens(systemPrompt, input) })
    raw = await askModel(systemPrompt, input, route, objective.length)
    let parsed = parseAnalysisOutput(raw)
    if (!parsed) {
      route = escalateRoute(route, "PARSE_FAILURE")
      raw = await askModel(systemPrompt, input, route, objective.length)
      parsed = parseAnalysisOutput(raw)
      if (!parsed) return empty(raw)
    }
    ;({ findings, verification } = verifyAnalysisFindings(parsed, projected, coverage))
    declaredComparisonSource = parsed.temporalComparison
  }
  // COMPARAÇÃO TEMPORAL (V1.3.4): contagens por achado × bloco só com evidência validada; a declaração do modelo é validada
  // contra elas (blocos, ordem, refs, direção) — status pode ser rebaixado, nunca promovido.
  let temporalComparison: TemporalComparison | null = null
  if (buckets.length > 1) {
    const analyzed = sample.map((transcript) => ({ interactionRef: handleOf.get(transcript.id)!, bucketRef: positions.get(transcript.id)?.bucketRef ?? null }))
    // V1.3.4.1: universo registrado por bloco → cobertura → ausência estabelecida (regra determinística, nunca o modelo).
    const universeByBucket = await countInteractionsByBucket(context, context.defaultPeriod, buckets)
    const counts = bucketCountsOf(findings, analyzed, buckets, universeByBucket)
    // A comparação temporal declarada vem do mesmo output (Fase B ou contrato de padrões); os índices apontam para `patterns`.
    const declaredComparison = declaredComparisonSource
    const declared = declaredComparison ? { status: declaredComparison.status.status, comparedBuckets: declaredComparison.comparedBuckets, findings: declaredComparison.findings } : null
    temporalComparison = validateTemporalComparison(declared, findings.length, counts, analyzed, buckets)
    if (declaredComparison && declaredComparison.status.normalization !== "EXACT") {
      const normalization = declaredComparison.status.normalization
      const note = normalization === "ALIAS" ? `status declarado "${declaredComparison.status.declared}" lido como alias lexical de ${declaredComparison.status.status}` : normalization === "RELATION_AS_STATUS" ? `status declarado "${declaredComparison.status.declared}" é uma RELAÇÃO, não um status — não promovido: comparação tratada como INSUFFICIENT_EVIDENCE (a relação, se declarada em findings, foi validada pela regra específica)` : `status declarado "${declaredComparison.status.declared}" desconhecido — tratado como INSUFFICIENT_EVIDENCE`
      temporalComparison = { ...temporalComparison, statusNormalization: normalization, declaredStatus: declaredComparison.status.declared, downgradedReason: [temporalComparison.downgradedReason, note].filter(Boolean).join("; ") }
    }
  }
  return { findings, coverage, discarded: verification.rejectedExcerptCount, verification, raw, privacy: privacyAudit(projections, handleOf, verification.rejectionReasons.REIDENTIFICATION), temporalComparison, semantic: semanticData, procedural: proceduralData, outcome: peers ? null : { version: outcomeTelemetry.version, outcomes: needOutcomes, attributions: needAttributions, telemetry: outcomeTelemetry } }
}

/** Parse tolerante da FASE A (frames). Exportado para replay determinístico. */
export function parseFrameExtractionOutput(raw: string): z.infer<typeof frameExtractionOutputSchema> | null {
  try {
    return frameExtractionOutputSchema.parse(JSON.parse(stripFence(raw)))
  } catch {
    return null
  }
}

/** Parse tolerante da FASE B (patterns; temporalComparison é lida à parte). */
export function parsePatternSynthesisOutput(raw: string): z.infer<typeof patternSynthesisOutputSchema> | null {
  try {
    return patternSynthesisOutputSchema.parse(JSON.parse(stripFence(raw)))
  } catch {
    return null
  }
}

/** A comparação temporal declarada no MESMO JSON (opcional, tolerante) — índices referem-se a `patterns`. */
function parseTemporalComparison(raw: string): z.infer<typeof temporalComparisonSchema> {
  try {
    return temporalComparisonSchema.parse((JSON.parse(stripFence(raw)) as { temporalComparison?: unknown }).temporalComparison)
  } catch {
    return undefined
  }
}

function stripFence(raw: string): string {
  return raw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim()
}

/** Pattern da camada semântica no formato legado de achado (ledger, temporal, QA Lab, benchmarks). */
function patternAsFinding(pattern: CrossInteractionPattern, coverage: AnalysisCoverage): AnalysisFinding {
  return {
    finding: pattern.description,
    evidenceRequirement: "ANY",
    ...findingCountsOf(pattern.interactionRefs.length, pattern.evidence.length, coverage),
    verifiedExcerpts: pattern.evidence.map((item) => ({ interactionId: item.interactionId, interactionRef: item.interactionRef, turnRef: item.turnRef, speaker: item.speaker, excerpt: item.quote, referenceResolution: item.referenceResolution })),
    evidenceStrength: pattern.evidenceStrength,
    kind: pattern.kind,
    ownership: pattern.ownership,
    support: pattern.support,
    findingRefs: pattern.findingRefs,
    handle: pattern.handle,
  }
}

/** Parse tolerante (cerca ```json) do JSON da análise — contrato novo (turnRef/quote) e antigo (interactionId/excerpt). Exportado para o replay determinístico. */
export function parseAnalysisOutput(raw: string): z.infer<typeof patternsSchema> | null {
  try {
    return patternsSchema.parse(JSON.parse(stripFence(raw)))
  } catch {
    return null
  }
}

/**
 * VERIFICAÇÃO LITERAL POR UNIDADE (V1.3.3): cada trecho é validado contra o turno da projeção model-facing
 * (interação certa → sem reidentificação → turno certo → literal → falante certo); o achado sobrevive por
 * ANY/ALL e as contagens usam SÓ evidência validada. Determinística — exportada para o replay dos outputs
 * congelados do benchmark (mesma função, sem LLM).
 */
export function verifyAnalysisFindings(parsed: { patterns: { description: string; evidenceRequirement?: EvidenceRequirement | undefined; evidence: EvidenceUnit[] }[] }, projected: ReadonlyMap<string, ProjectedInteraction>, coverage: AnalysisCoverage): { findings: AnalysisFinding[]; verification: EvidenceVerificationTelemetry } {
  const verification = emptyVerificationTelemetry()
  const sampleSize = projected.size
  const findings: AnalysisFinding[] = []
  for (const pattern of parsed.patterns) {
    const requirement: EvidenceRequirement = pattern.evidenceRequirement ?? "ANY"
    const result = verifyFinding(pattern.evidence, requirement, projected)
    accumulateVerification(verification, result, pattern.evidence.length)
    if (!result.survives) continue
    const interactionIds = new Set(result.verified.map((item) => item.interactionId))
    const strength: "STRONG" | "MODERATE" | "WEAK" = interactionIds.size >= Math.max(3, Math.ceil(sampleSize / 2)) ? "STRONG" : interactionIds.size >= 2 ? "MODERATE" : "WEAK"
    // SEMÂNTICA SEM AMBIGUIDADE (V1.3.2): matched = transcrições analisadas com trecho verificado (limite inferior); nunca "ocorrências no período".
    findings.push({ finding: pattern.description, evidenceRequirement: requirement, ...findingCountsOf(interactionIds.size, result.verified.length, coverage), verifiedExcerpts: result.verified.map((item) => ({ interactionId: item.interactionId, interactionRef: item.interactionRef, turnRef: item.turnRef, speaker: item.speaker, excerpt: item.quote, referenceResolution: item.referenceResolution })), evidenceStrength: strength })
  }
  return { findings, verification }
}

/** O texto EXATO que vai ao modelo na análise de transcrições — pares só pela projeção (exportado para a prova de reidentificação). */
export function buildTranscriptAnalysisInput(sample: { id: string; content: string; reason: string }[], handleOf: Map<string, string>, projections: Map<string, PeerTranscriptPrivacyProjection> | null, temporal?: { buckets: TemporalBucket[]; positions: Map<string, TemporalPosition | null> }): string {
  const projected = projectSample(sample, handleOf, projections)
  // V1.3.4: cabeçalho com bloco + data local CALCULADOS ("ref: I4 · B2 · 2026-07-28") e a legenda dos blocos no topo — nunca ISO/UUID.
  const header = temporal && temporal.buckets.length > 1 ? `${renderTemporalBuckets(temporal.buckets)}\n\n` : ""
  const positionOf = (id: string) => {
    const position = temporal?.positions.get(id)
    return position ? ` · ${position.bucketRef} · ${position.localDate}` : ""
  }
  // V1.4.0 (§26): o Model Context mostra SÓ a referência canônica ("=== I6 · B2 · 2026-03-14 · assunto: … ===") — nenhuma
  // posição de apresentação (#n) concorre com o handle. O ordinal continua existindo só em auditoria/telemetria (resolver interno).
  return header + sample.map((transcript) => `=== ${handleOf.get(transcript.id)}${positionOf(transcript.id)} · assunto: ${transcript.reason} ===\n${renderTranscriptForModel(projected.get(handleOf.get(transcript.id)!)!.projection)}`).join("\n\n")
}

/** Projeção de privacidade de cada transcrição de PAR: identidade do par + operadores conhecidos + PII; o alvo nunca é redigido. */
export async function projectPeerTranscripts(context: ToolContext, sample: { id: string; content: string; operatorId?: string }[], knownOperatorIds: string[]): Promise<Map<string, PeerTranscriptPrivacyProjection>> {
  const operatorIds = [...new Set([...sample.map((transcript) => transcript.operatorId).filter((id): id is string => !!id), ...knownOperatorIds])]
  const people = await context.db.query<{ id: string; name: string }>(`select id, name from people where organization_id = $1 and id = any($2::uuid[])`, [context.organizationId, operatorIds])
  const identities = new Map<string, PeerIdentity>(people.rows.map((row) => [row.id, { personId: row.id, fullName: row.name }]))
  const known = [...identities.values()]
  const target: PeerIdentity | null = context.subject.operatorName ? { personId: context.subject.operatorId, fullName: context.subject.operatorName } : null
  const projections = new Map<string, PeerTranscriptPrivacyProjection>()
  for (const transcript of sample) {
    const peer = transcript.operatorId ? identities.get(transcript.operatorId) : undefined
    if (!peer) throw new Error("Transcrição de par sem identidade conhecida do operador — projeção de privacidade impossível")
    projections.set(transcript.id, projectPeerTranscript({ sourceInteractionId: transcript.id, transcript: transcript.content, peer, knownOperators: known, target }))
  }
  return projections
}

/** Só contagens/hashes (sem nome, sem texto): o que o Model Context pode ver e o que a auditoria precisa para voltar ao bruto. */
function privacyAudit(projections: Map<string, PeerTranscriptPrivacyProjection> | null, handleOf: Map<string, string>, reidentificationRejected: number): PeerPrivacyAudit | null {
  if (!projections) return null
  const redactions: Record<string, number> = {}
  for (const projection of projections.values()) for (const item of projection.redactions) redactions[item.kind] = (redactions[item.kind] ?? 0) + item.count
  return {
    version: PEER_PRIVACY_PROJECTION_VERSION,
    redactedTranscripts: projections.size,
    redactions,
    reidentificationRejected,
    projections: [...projections.entries()].map(([id, projection]) => ({ handle: handleOf.get(id) ?? "?", sourceHash: projection.sourceHash, redactions: projection.redactions.reduce((sum, item) => sum + item.count, 0) })),
  }
}

/**
 * V1.5.10 — análise semântica DIRETA de interações já escolhidas (sem Planner, sem Tool, sem ledger): exatamente o mesmo
 * núcleo de `analyze_interactions` (Fase A → Fase B → sidecar de atribuição → Fase K procedimental → needKind opcional),
 * com os mesmos prompts, verificadores e regras. Usada pelo feedback de atendimento (PrepareInteractionForFeedback,
 * módulo interaction-feedback); nunca pelos pares.
 */
export async function analyzeInteractionSemantics(context: ToolContext, transcripts: { id: string; content: string; reason: string; operatorId?: string; startedAt?: string }[], objective: string): Promise<{ semantic: SemanticAnalysisData | null; procedural: ProceduralAnalysisData | null; outcome: OutcomeAnalysisData | null }> {
  const analyzed = Math.min(transcripts.length, TRANSCRIPT_ANALYSIS_MAX)
  const analysis = await analyzeTranscripts(context, transcripts, objective, false, { knownOperatorIds: [] }, analysisCoverageOf(analyzed, context.investigation.recordedUniverseCount))
  return { semantic: analysis.semantic, procedural: analysis.procedural, outcome: analysis.outcome }
}

export async function analyzeInteractions(context: ToolContext, args: { interactionIds: string[]; objective: string }): Promise<ToolResult> {
  const transcripts = await loadTranscripts(context, args.interactionIds, [context.subject.operatorId])
  if (transcripts.length === 0) return { data: { findings: [], analyzedTranscriptCount: 0 }, quality: noData("nenhuma transcrição do colaborador entre os ids informados"), provenance: { population: "interações do colaborador", filters: [], dataSource: "TRANSCRIPTS" } }
  const analyzed = Math.min(transcripts.length, TRANSCRIPT_ANALYSIS_MAX)
  const coverage = analysisCoverageOf(analyzed, context.investigation.recordedUniverseCount)
  const analysis = await analyzeTranscripts(context, transcripts, args.objective, false, { knownOperatorIds: [] }, coverage)
  // Cobertura TEMPORAL da amostra analisada (blocos da janela padrão) — evolução exige mais de um bloco.
  const temporalCoverage = temporalCoverageOf(transcripts.slice(0, TRANSCRIPT_ANALYSIS_MAX).map((transcript) => new Date(transcript.startedAt)), context.defaultPeriod, context.investigation.temporalBuckets, (date) => date.toLocaleDateString("sv-SE", { timeZone: context.timeZone }))
  // V1.4.0: zero patterns com frames que TÊM findings ainda é evidência (observações/findings por interação) — a qualidade
  // continua SUFFICIENT com a nota; NO_RELEVANT_PATTERN_FOUND só quando nem findings por interação sobreviveram.
  const semanticFindings = analysis.semantic?.telemetry.findingsCount ?? 0
  const quality: ToolQuality = analysis.findings.length === 0 && semanticFindings === 0 ? { status: "NO_DATA", sampleCount: analyzed, coverage: null, freshness: null, note: "NO_RELEVANT_PATTERN_FOUND — nenhum achado com evidência literal verificada (resposta válida, não é falha)" } : sufficient(analyzed, null, [analysis.findings.length === 0 && semanticFindings > 0 ? `nenhum padrão entre interações; ${semanticFindings} finding(s) por interação` : null, analysis.discarded > 0 ? `${analysis.discarded} trecho(s) descartado(s) por não serem literais` : null].filter(Boolean).join("; ") || undefined)
  return {
    data: {
      objective: args.objective,
      analyzedTranscriptCount: analyzed,
      requestedTranscriptCount: args.interactionIds.length,
      recordedUniverseCount: coverage.recordedUniverseCount,
      universeRelationship: coverage.universeRelationship,
      analyzedShareOfUniversePercent: coverage.analyzedShareOfUniversePercent,
      temporalCoverage,
      /** V1.3.4: relação entre blocos validada pela aplicação (≠ cobertura). null = janela de um bloco. */
      temporalComparison: analysis.temporalComparison,
      findings: analysis.findings,
      /** V1.4.0: camada semântica — frames por interação (observações verificadas), findings e patterns derivados por código. */
      semantic: analysis.semantic,
      /** V1.4.5: avaliação procedimental — regras da base com trecho literal × afirmações do operador, comparadas por código. */
      procedural: analysis.procedural,
      /** V1.4.6: RESULTADO (estado da necessidade) × ATRIBUIÇÃO (de quê ele depende) — separados, nunca a mesma coisa. */
      outcome: analysis.outcome,
      discardedExcerpts: analysis.discarded,
      /** V1.3.3: contagens da verificação literal por unidade (candidatas × validadas × descartadas por motivo). */
      evidenceVerification: analysis.verification,
      countingNote: coverage.countingNote,
      note: "achados (findings) = patterns derivados de findings por interação, que nascem de observações com trecho literal verificado; não são causas. matchedTranscriptCount conta transcrições ANALISADAS com evidência verificada (limite inferior) — nunca ocorrências no período; `support.level` diz até onde a evidência sustenta generalizar.",
    },
    quality,
    provenance: { population: `${analyzed} transcrição(ões) do colaborador${coverage.recordedUniverseCount !== null ? ` de ${coverage.recordedUniverseCount} registrada(s) no período` : ""}`, filters: [`objetivo: ${args.objective}`], dataSource: "TRANSCRIPTS (análise semântica com verificação literal)", method: "LLM devolve achados + trechos; trecho não literal é descartado por código; contagens calculadas por código" },
  }
}

export async function analyzePeerPatterns(context: ToolContext, args: { subject: string; objective: string; reference?: "SUBGROUP" | "GROUP"; period?: { from: string; to: string } }): Promise<ToolResult> {
  const comparable = await findComparableInteractions(context, { subject: args.subject, ...(args.reference ? { reference: args.reference } : {}), ...(args.period ? { period: args.period } : {}), limit: TRANSCRIPT_ANALYSIS_MAX })
  const data = comparable.data as { status?: string; interactions?: { peerInteractionId: string }[]; populationDefinition?: string; referenceAverageDurationSeconds?: number | null; ownAverageDurationSeconds?: number | null }
  if (!data.interactions || data.interactions.length === 0) return { ...comparable, data: { ...data, findings: [] } }
  const population = await loadPeerPopulation(context, args.reference ?? (context.subject.subteamId ? "SUBGROUP" : "GROUP"))
  const transcripts = await loadTranscripts(context, data.interactions.map((item) => item.peerInteractionId), population?.ids ?? [])
  const analysis = await analyzeTranscripts(context, transcripts, args.objective, true, { knownOperatorIds: population?.ids ?? [] })
  return {
    data: {
      subject: args.subject,
      objective: args.objective,
      populationDefinition: data.populationDefinition,
      sampleSelection: "interações comparáveis de menor duração (regra determinística), anônimas",
      transcriptsAnalyzed: Math.min(transcripts.length, TRANSCRIPT_ANALYSIS_MAX),
      referenceAverageDurationSeconds: data.referenceAverageDurationSeconds ?? null,
      ownAverageDurationSeconds: data.ownAverageDurationSeconds ?? null,
      analyzedTranscriptCount: Math.min(transcripts.length, TRANSCRIPT_ANALYSIS_MAX),
      findings: analysis.findings.map((finding) => ({ ...finding, prevalenceInUniversePercent: null, verifiedExcerpts: finding.verifiedExcerpts.map((item) => ({ interactionRef: item.interactionRef, turnRef: item.turnRef, speaker: item.speaker, excerpt: item.excerpt })) })),
      evidenceVerification: analysis.verification,
      countingNote: "matchedTranscriptCount = transcrições de pares analisadas com trecho verificado; amostra determinística, nunca prevalência na população.",
      /** Privacidade dos pares: só contagens e hashes de auditoria — o modelo recebeu a projeção, nunca o bruto. */
      privacy: analysis.privacy,
      note: "Na amostra analisada — correlação em uma amostra, nunca regra universal; sem identificação de colegas (transcrições projetadas: identidade do par e PII redigidas antes do modelo)",
    },
    quality: analysis.findings.length === 0 ? { status: "NO_DATA", sampleCount: transcripts.length, coverage: null, freshness: null, note: "nenhum achado com evidência literal na amostra comparável" } : sufficient(Math.min(transcripts.length, TRANSCRIPT_ANALYSIS_MAX), null),
    provenance: { ...comparable.provenance, dataSource: "TRANSCRIPTS de pares (projeção de privacidade PEER_PRIVACY_V1: identidade do par e PII redigidas; análise semântica com verificação literal contra a projeção)", method: "amostra determinística por duração; LLM devolve padrões + trechos; trecho não literal ou que reidentifique o par é descartado" },
  }
}
