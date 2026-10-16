import type { Database } from "../../../infrastructure/database/pool.js"
import { loadIndicatorCanonicalContext } from "../../indicators/application/load-indicator-canonical-context.js"
import { periodLabelOf } from "../../indicators/domain/indicator-canonical-context.js"
import { levelCanonicalSql, levelKeySql } from "../../interactions/domain/interaction-subject.js"
import { defaultSamplingStrategy, periodDaysOf, selectSample } from "../../investigation/domain/sampling-strategy.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { buildSegments, diagnosisLevelsOf, diagnosisMetricFor, INDICATOR_DIAGNOSIS_PLAN_VERSION, selectDiagnosisSegment, type IndicatorDiagnosisPlan } from "../domain/indicator-diagnosis.js"
import type { DiagnosisRuntimeParameters } from "../domain/diagnostic-strategy.js"

/**
 * V1.6.1 — PLANO DO DIAGNÓSTICO (determinístico, só leitura, ZERO modelo). Usado em DOIS lugares com a MESMA função:
 * no nó "Chamar agente" (para escolher as chamadas que o Agent avalia) e em "Gerar feedback" (que RECALCULA o plano e só
 * aceita avaliações das chamadas que o sistema teria escolhido — a saída do nó de origem nunca é confiada).
 *
 *   medição (organização + colaborador) → janela da medição → atendimentos do colaborador na janela, por ASSUNTO
 *   (canônico, bruto como fallback) → segmento pela regra única → amostra reproduzível só do segmento, só com transcrição.
 *
 * `SUBJECT_RESOLUTION_V2` (16/10/2026): ASSUNTO = submotivo (sem submotivo, o motivo); a estratégia pode ligar também o MOTIVO.
 *
 * V1.6.2 — PARAMETRIZADO pela ESTRATÉGIA do indicador (`runtimeParametersOf`, a versão presa à execução): sem estratégia o
 * plano nem consulta atendimentos; segmentação/investigação desligadas param no passo correspondente; Agent fora dos
 * domínios permitidos = sem investigação. Mínimos e teto da amostra vêm da versão (com os pisos do produto).
 */
export async function loadIndicatorDiagnosisPlan(db: Database, input: { organizationId: string; measurementId: string; collaboratorId: string; parameters: DiagnosisRuntimeParameters; agentId: string | null }): Promise<IndicatorDiagnosisPlan | null> {
  const { parameters } = input
  const canonical = await loadIndicatorCanonicalContext(db, { organizationId: input.organizationId, measurementId: input.measurementId, collaboratorId: input.collaboratorId })
  if (!canonical) return null
  const window = (await db.query<{ period_start: Date; period_end: Date }>(`select period_start, period_end from indicator_measurements where id = $1 and organization_id = $2`, [input.measurementId, input.organizationId])).rows[0]
  if (!window) return null
  const timeZone = await resolveOrganizationTimezone(db, input.organizationId)
  const start = new Date(window.period_start)
  // Medição instantânea (início = fim): a janela é o dia local da medição.
  const end = new Date(window.period_end).getTime() > start.getTime() ? new Date(window.period_end) : new Date(start.getTime() + 24 * 60 * 60 * 1000)
  const metric = diagnosisMetricFor(canonical.indicator.unit)
  const base: IndicatorDiagnosisPlan = {
    contract: INDICATOR_DIAGNOSIS_PLAN_VERSION,
    measurementId: input.measurementId,
    collaboratorId: input.collaboratorId,
    indicator: { code: canonical.indicator.code, name: canonical.indicator.name, unit: canonical.indicator.unit, direction: canonical.indicator.direction },
    period: { start: start.toISOString(), end: end.toISOString(), label: periodLabelOf(canonical.measurement.periodStart, canonical.measurement.periodEnd) },
    dimension: "SUBJECT",
    metric,
    interactionsInPeriod: 0,
    overallAverageDurationSeconds: null,
    segments: [],
    selectedSegment: null,
    sample: [],
    sampling: null,
    status: "NOT_DECOMPOSABLE",
    strategy: { versionId: parameters.strategyVersionId, version: parameters.strategyVersion },
  }
  if (!parameters.configured) return { ...base, status: "STRATEGY_NOT_CONFIGURED" }
  if (!metric) return base
  if (!parameters.segmentation.enabled || diagnosisLevelsOf(parameters.segmentation.dimensions).length === 0) return { ...base, status: "SEGMENTATION_DISABLED" }
  if (parameters.allowedBusinessDomainIds.length > 0) {
    const agentDomain = input.agentId ? (await db.query<{ business_domain_id: string | null }>(`select business_domain_id from agents where id = $1 and organization_id = $2`, [input.agentId, input.organizationId])).rows[0]?.business_domain_id ?? null : null
    if (!agentDomain || !parameters.allowedBusinessDomainIds.includes(agentDomain)) return { ...base, status: "DOMAIN_NOT_ALLOWED" }
  }

  const levels = diagnosisLevelsOf(parameters.segmentation.dimensions)
  const names = new Map((await db.query<{ code: string; name: string }>(`select code, name from interaction_subject_definitions where organization_id = $1`, [input.organizationId])).rows.map((row) => [row.code, row.name]))
  const overall = (await db.query<{ avg_duration: string | null }>(
    `select avg(extract(epoch from i.ended_at - i.started_at)) filter (where i.ended_at is not null) avg_duration from interactions i where i.organization_id = $1 and i.operator_id = $2 and i.started_at >= $3 and i.started_at < $4`,
    [input.organizationId, input.collaboratorId, start, end],
  )).rows[0]
  const overallAverageDurationSeconds = overall?.avg_duration != null ? Math.round(Number(overall.avg_duration)) : null
  // `SUBJECT_RESOLUTION_V2`: o submotivo (assunto preferencial) vem primeiro; o motivo só entra quando a estratégia o liga — sozinho,
  // ou como segunda tentativa quando nenhum submotivo tem atendimentos suficientes.
  let planned: IndicatorDiagnosisPlan = base
  let preferred: IndicatorDiagnosisPlan | null = null
  for (const level of levels) {
    const rows = (await db.query<{ segment_key: string | null; canonical: boolean; reasons: string[] | null; interactions: string; with_transcript: string; avg_duration: string | null }>(
      `select ${levelKeySql(level, "i")} segment_key, bool_or(${levelCanonicalSql(level, "i")} is not null) canonical,
              ${level === "SUBJECT" ? "array_agg(distinct i.reason order by i.reason) filter (where nullif(btrim(i.sub_reason), '') is not null)" : "null::text[]"} reasons, count(*) interactions,
              count(*) filter (where exists (select 1 from transcripts t where t.interaction_id = i.id and length(btrim(t.content)) > 0)) with_transcript,
              avg(extract(epoch from i.ended_at - i.started_at)) filter (where i.ended_at is not null) avg_duration
       from interactions i
       where i.organization_id = $1 and i.operator_id = $2 and i.started_at >= $3 and i.started_at < $4
       group by 1`,
      [input.organizationId, input.collaboratorId, start, end],
    )).rows
    const interactionsInPeriod = rows.reduce((sum, row) => sum + Number(row.interactions), 0)
    if (interactionsInPeriod === 0) return { ...base, status: "NO_INTERACTIONS" }
    // Atendimento sem assunto não tem segmento: conta no total, mas nunca é investigado (não há processo a que ligá-lo).
    const segments = buildSegments(rows.filter((row) => row.segment_key !== null).map((row) => ({
      key: row.segment_key!,
      label: row.canonical ? names.get(row.segment_key!) ?? row.segment_key! : row.segment_key!,
      canonical: row.canonical,
      ...(row.reasons && row.reasons.length > 0 ? { reasons: row.reasons } : {}),
      interactions: Number(row.interactions),
      withTranscript: Number(row.with_transcript),
      averageDurationSeconds: row.avg_duration != null ? Math.round(Number(row.avg_duration)) : null,
    })), parameters.segmentation.minimumSegmentInteractions)
    const selectedSegment = selectDiagnosisSegment(segments, { metric, direction: canonical.indicator.direction, withinTarget: canonical.withinTarget, overallAverageDurationSeconds })
    planned = { ...base, dimension: level, interactionsInPeriod, overallAverageDurationSeconds, segments, selectedSegment }
    preferred ??= planned
    if (selectedSegment) break
  }
  // Nenhum nível com segmento elegível: o plano mostra os segmentos do nível preferencial.
  if (!planned.selectedSegment && preferred) planned = preferred
  const selectedSegment = planned.selectedSegment
  if (!selectedSegment) return { ...planned, status: "NO_ELIGIBLE_SEGMENT" }
  if (!parameters.sample.enabled || !parameters.processAssessment) return { ...planned, status: "INVESTIGATION_DISABLED" }

  const candidates = (await db.query<{ id: string; started_at: Date }>(
    `select i.id, i.started_at from interactions i
     where i.organization_id = $1 and i.operator_id = $2 and i.started_at >= $3 and i.started_at < $4 and ${levelKeySql(planned.dimension, "i")} = $5
       and exists (select 1 from transcripts t where t.interaction_id = i.id and length(btrim(t.content)) > 0)`,
    [input.organizationId, input.collaboratorId, start, end, selectedSegment.key],
  )).rows
  const periodDays = periodDaysOf({ start, end })
  const { selected, metadata } = selectSample({
    candidates,
    strategy: defaultSamplingStrategy("EXPLAIN_INDICATOR_DEVIATION", periodDays),
    limit: parameters.sample.maxInteractions,
    period: { start, end },
    periodDays,
    startedAtOf: (row) => new Date(row.started_at),
    keyOf: (row) => row.id,
    dateLabelOf: (date) => localDateOf(date, timeZone),
  })
  return {
    ...planned,
    sample: selected.map((row, index) => ({ handle: `I${index + 1}`, interactionId: row.id, startedAt: new Date(row.started_at).toISOString(), localDate: localDateOf(new Date(row.started_at), timeZone) })),
    sampling: metadata,
    status: "READY_FOR_ASSESSMENT",
  }
}
