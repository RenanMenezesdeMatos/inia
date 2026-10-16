import type { Database } from "../../../infrastructure/database/pool.js"
import { canonicalSubjectSql, subjectKeySql } from "../../interactions/domain/interaction-subject.js"
import { BEHAVIOR_TITLES, type CanonicalBehavior } from "../../reliable-feedback/domain/canonical-behavior.js"
import { eligibleObservationSql } from "../domain/observation-readiness.js"
import type { ObservationDisplayContext, StoredObservation } from "../domain/observation-compatibility.js"
import { isQuartile, PRV_CLOSING_CONTRACT, referencePeriodDates, type OfficialIndicatorSnapshot, type OfficialPrvSnapshot, type PrvClosing } from "../domain/prv-closing.js"
import type { TeamObservationRow } from "../domain/prv-investigation.js"

/**
 * INDICATOR DIAGNOSIS V1 — LEITURAS do diagnóstico do fechamento (só leitura, ZERO modelo, escopadas à organização). Número fixo
 * de consultas por indicador investigado — nunca uma por chamada.
 */
type Queryable = Pick<Database, "query">

type IndicatorRow = { id: string; indicator_definition_id: string; code: string; name: string; unit: string; desired_direction: string; reference_period: string; value: string; target_value: string | null; achievement_percent: string | null; weight_percent: string | null; quartile: string | null; subteam_id: string | null }
type PrvRow = { id: string; reference_period: string; achievement_percent: string; quartile: string }

const toNumber = (value: string | null) => (value === null ? null : Number(value))
const direction = (value: string): "HIGHER" | "LOWER" | "TARGET" => (value === "LOWER" || value === "TARGET" ? value : "HIGHER")

function snapshotOf(row: IndicatorRow): OfficialIndicatorSnapshot {
  return {
    snapshotId: row.id,
    indicatorId: row.indicator_definition_id,
    indicatorCode: row.code,
    indicatorName: row.name,
    unit: row.unit,
    direction: direction(row.desired_direction),
    referencePeriod: row.reference_period,
    value: Number(row.value),
    target: toNumber(row.target_value),
    achievementPercent: toNumber(row.achievement_percent),
    weightPercent: toNumber(row.weight_percent),
    quartile: isQuartile(row.quartile) ? row.quartile : null,
    subteamId: row.subteam_id,
  }
}
const prvOf = (row: PrvRow | undefined): OfficialPrvSnapshot | null => (row && isQuartile(row.quartile) ? { snapshotId: row.id, referencePeriod: row.reference_period, achievementPercent: Number(row.achievement_percent), quartile: row.quartile } : null)

/**
 * V2 — FECHAMENTO OFICIAL DE UM INDICADOR (sem PRV): a linha do indicador na competência + a da competência anterior (quando
 * existe), como vieram da fonte (contrato OFFICIAL_INDICATOR_PERFORMANCE da Central de Dados). O PRV nunca é lido aqui.
 */
export async function latestIndicatorClosingPeriod(db: Queryable, input: { organizationId: string; personId: string; indicatorId: string; lastClosedPeriod: string }): Promise<string | null> {
  const row = (await db.query<{ period: string | null }>(
    `select max(reference_period) period from employee_indicator_performance where organization_id = $1 and person_id = $2 and indicator_definition_id = $3 and reference_period <= $4`,
    [input.organizationId, input.personId, input.indicatorId, input.lastClosedPeriod],
  )).rows[0]
  return row?.period ?? null
}

export async function loadIndicatorClosing(db: Queryable, input: { organizationId: string; personId: string; indicatorId: string; referencePeriod: string }): Promise<PrvClosing | null> {
  const { previousPeriod } = referencePeriodDates(input.referencePeriod)
  const rows = (await db.query<IndicatorRow>(
    `select e.id, e.indicator_definition_id, i.code, i.name, i.unit, i.desired_direction, e.reference_period, e.value, e.target_value, e.achievement_percent, e.weight_percent, e.quartile, e.subteam_id
     from employee_indicator_performance e
     join indicator_definitions i on i.id = e.indicator_definition_id and i.organization_id = e.organization_id
     where e.organization_id = $1 and e.person_id = $2 and e.indicator_definition_id = $3 and e.reference_period in ($4, $5)
     order by e.reference_period desc`,
    [input.organizationId, input.personId, input.indicatorId, input.referencePeriod, previousPeriod],
  )).rows
  const current = rows.filter((row) => row.reference_period === input.referencePeriod).map(snapshotOf)
  if (current.length === 0) return null
  const previous = rows.filter((row) => row.reference_period === previousPeriod).map(snapshotOf)
  return { contract: PRV_CLOSING_CONTRACT, organizationId: input.organizationId, personId: input.personId, referencePeriod: input.referencePeriod, prv: null, indicators: current, previous: previous.length > 0 ? { referencePeriod: previousPeriod, prv: null, indicators: previous } : null }
}

/** V2 — a flag do sinal no catálogo da organização (qualquer canal): existe, ativa e de sim/não? */
export async function loadSignalFlag(db: Queryable, organizationId: string, flagName: string): Promise<{ valid: boolean; channelFlagIds: string[] }> {
  const rows = (await db.query<{ id: string; value_type: string; active: boolean }>(`select id, value_type, active from channel_flags where organization_id = $1 and flag_name = $2`, [organizationId, flagName])).rows
  const usable = rows.filter((row) => row.active && row.value_type === "BOOLEAN")
  return { valid: usable.length > 0, channelFlagIds: usable.map((row) => row.id) }
}

/**
 * V2 — interações do colaborador na janela, por MOTIVO, com quantas carregam o SINAL (flag booleana = verdadeira, exatamente
 * como a fonte marcou). Uma consulta; nenhuma inferência: sem a flag = não sinalizada.
 */
export async function loadSignalRows(db: Queryable, input: { organizationId: string; personId: string; start: Date; end: Date; channelFlagIds: readonly string[] }): Promise<{ key: string | null; canonical: boolean; interactions: number; signaled: number }[]> {
  if (input.channelFlagIds.length === 0) return []
  const rows = (await db.query<{ segment_key: string | null; canonical: boolean; interactions: string; signaled: string }>(
    `select ${segmentKeySql("i")} segment_key, bool_or(${canonicalSubjectSql("i")} is not null) canonical, count(*) interactions,
            count(*) filter (where exists (select 1 from interaction_flags f where f.interaction_id = i.id and f.channel_flag_id = any($5::uuid[]) and f.value_boolean is true)) signaled
     from interactions i
     where i.organization_id = $1 and i.operator_id = $2 and i.started_at >= $3 and i.started_at < $4
     group by 1`,
    [input.organizationId, input.personId, input.start, input.end, [...input.channelFlagIds]],
  )).rows
  return rows.map((row) => ({ key: row.segment_key, canonical: row.canonical, interactions: Number(row.interactions), signaled: Number(row.signaled) }))
}

/** Competência mais recente do colaborador que JÁ é fechamento (≤ último mês fechado no fuso da organização). */
export async function latestClosingPeriod(db: Queryable, input: { organizationId: string; personId: string; lastClosedPeriod: string }): Promise<string | null> {
  const row = (await db.query<{ period: string | null }>(
    `select max(reference_period) period from (
       select reference_period from employee_indicator_performance where organization_id = $1 and person_id = $2 and reference_period <= $3
       union all
       select reference_period from employee_prv_performance where organization_id = $1 and person_id = $2 and reference_period <= $3
     ) closings`,
    [input.organizationId, input.personId, input.lastClosedPeriod],
  )).rows[0]
  return row?.period ?? null
}

/** Fechamento oficial (competência + a anterior, quando existe) — linhas como vieram da fonte, nunca recalculadas. */
export async function loadPrvClosing(db: Queryable, input: { organizationId: string; personId: string; referencePeriod: string }): Promise<PrvClosing | null> {
  const { previousPeriod } = referencePeriodDates(input.referencePeriod)
  const indicators = (await db.query<IndicatorRow>(
    `select e.id, e.indicator_definition_id, i.code, i.name, i.unit, i.desired_direction, e.reference_period, e.value, e.target_value, e.achievement_percent, e.weight_percent, e.quartile, e.subteam_id
     from employee_indicator_performance e
     join indicator_definitions i on i.id = e.indicator_definition_id and i.organization_id = e.organization_id
     where e.organization_id = $1 and e.person_id = $2 and e.reference_period in ($3, $4)
     order by e.reference_period desc, i.name`,
    [input.organizationId, input.personId, input.referencePeriod, previousPeriod],
  )).rows
  const prvs = (await db.query<PrvRow>(
    `select id, reference_period, achievement_percent, quartile from employee_prv_performance where organization_id = $1 and person_id = $2 and reference_period in ($3, $4)`,
    [input.organizationId, input.personId, input.referencePeriod, previousPeriod],
  )).rows
  const current = indicators.filter((row) => row.reference_period === input.referencePeriod).map(snapshotOf)
  const prv = prvOf(prvs.find((row) => row.reference_period === input.referencePeriod))
  if (current.length === 0 && !prv) return null
  const previousIndicators = indicators.filter((row) => row.reference_period === previousPeriod).map(snapshotOf)
  const previousPrv = prvOf(prvs.find((row) => row.reference_period === previousPeriod))
  return {
    contract: PRV_CLOSING_CONTRACT,
    organizationId: input.organizationId,
    personId: input.personId,
    referencePeriod: input.referencePeriod,
    prv,
    indicators: current,
    previous: previousIndicators.length > 0 || previousPrv ? { referencePeriod: previousPeriod, prv: previousPrv, indicators: previousIndicators } : null,
  }
}

/** Assunto preferencial da `SUBJECT_RESOLUTION_V2` (submotivo; sem submotivo, o motivo) — o fechamento segmenta só neste nível. */
export const segmentKeySql = (alias: string) => subjectKeySql(alias)

export type SegmentRow = { key: string | null; canonical: boolean; interactions: number; withTranscript: number; totalDurationSeconds: number | null }

/** Chamadas do colaborador na janela, por MOTIVO (canônico; bruto como fallback) — quantidade, com transcrição e duração registrada. */
export async function loadSegmentRows(db: Queryable, input: { organizationId: string; personId: string; start: Date; end: Date }): Promise<SegmentRow[]> {
  const rows = (await db.query<{ segment_key: string | null; canonical: boolean; interactions: string; with_transcript: string; total_duration: string | null }>(
    `select ${segmentKeySql("i")} segment_key, bool_or(${canonicalSubjectSql("i")} is not null) canonical, count(*) interactions,
            count(*) filter (where exists (select 1 from transcripts t where t.interaction_id = i.id and length(btrim(t.content)) > 0)) with_transcript,
            sum(extract(epoch from i.ended_at - i.started_at)) total_duration
     from interactions i
     where i.organization_id = $1 and i.operator_id = $2 and i.started_at >= $3 and i.started_at < $4
     group by 1`,
    [input.organizationId, input.personId, input.start, input.end],
  )).rows
  return rows.map((row) => ({ key: row.segment_key, canonical: row.canonical, interactions: Number(row.interactions), withTranscript: Number(row.with_transcript), totalDurationSeconds: row.total_duration === null ? null : Number(row.total_duration) }))
}

export async function loadSubjectNames(db: Queryable, organizationId: string): Promise<Map<string, string>> {
  return new Map((await db.query<{ code: string; name: string }>(`select code, name from interaction_subject_definitions where organization_id = $1`, [organizationId])).rows.map((row) => [row.code, row.name]))
}

/** Chamadas elegíveis do motivo investigado (com transcrição), na janela — o universo da amostra. */
export async function loadSegmentInteractions(db: Queryable, input: { organizationId: string; personId: string; start: Date; end: Date; segmentKey: string }): Promise<{ id: string; startedAt: Date }[]> {
  return (await db.query<{ id: string; started_at: Date }>(
    `select i.id, i.started_at from interactions i
     where i.organization_id = $1 and i.operator_id = $2 and i.started_at >= $3 and i.started_at < $4 and ${segmentKeySql("i")} = $5
       and exists (select 1 from transcripts t where t.interaction_id = i.id and length(btrim(t.content)) > 0)
     order by i.started_at, i.id`,
    [input.organizationId, input.personId, input.start, input.end, input.segmentKey],
  )).rows.map((row) => ({ id: row.id, startedAt: new Date(row.started_at) }))
}

/** Observações de processo JÁ gravadas para estes atendimentos (qualquer prontidão), do próprio colaborador. */
export async function loadStoredObservations(db: Queryable, input: { organizationId: string; personId: string; interactionIds: readonly string[] }): Promise<StoredObservation[]> {
  if (input.interactionIds.length === 0) return []
  const rows = (await db.query<{ interaction_id: string; practice_key: string; canonical_behavior: string | null; requirement: string; document_id: string; title: string | null; document_version: number | null; status: "FOLLOWED" | "NOT_FOLLOWED"; completeness: StoredObservation["completeness"]; analytics_status: StoredObservation["analyticsStatus"]; checkpoint_ref: string | null; display_context: unknown }>(
    `select o.interaction_id, o.practice_key, o.canonical_behavior, o.requirement, o.document_id, d.title, o.document_version, o.status, o.completeness, o.analytics_status, o.checkpoint_ref, o.display_context
     from process_checkpoint_observations o
     left join knowledge_documents d on d.id = o.document_id
     where o.organization_id = $1 and o.person_id = $2 and o.interaction_id = any($3::uuid[])`,
    [input.organizationId, input.personId, [...input.interactionIds]],
  )).rows
  return rows.map((row) => ({
    interactionId: row.interaction_id,
    practiceKey: row.practice_key,
    canonicalBehavior: row.canonical_behavior,
    requirement: row.requirement,
    documentId: row.document_id,
    documentTitle: row.title,
    documentVersion: row.document_version,
    status: row.status,
    completeness: row.completeness,
    analyticsStatus: row.analytics_status,
    checkpointRef: row.checkpoint_ref,
    displayContext: displayContextOf(row.display_context),
  }))
}

/** Contexto exibível gravado com a observação (migration 096). Ausente/malformado = null (a observação continua reaproveitável). */
export function displayContextOf(value: unknown): ObservationDisplayContext | null {
  if (!value || typeof value !== "object") return null
  const raw = value as { quotes?: unknown; rule?: unknown; guidance?: unknown }
  const quotes = Array.isArray(raw.quotes) ? raw.quotes.filter((quote): quote is { text: string; truncated: boolean } => Boolean(quote) && typeof (quote as { text?: unknown }).text === "string").map((quote) => ({ text: quote.text, truncated: Boolean(quote.truncated) })) : []
  const rule = raw.rule && typeof raw.rule === "object" && typeof (raw.rule as { quote?: unknown }).quote === "string" ? { documentTitle: String((raw.rule as { documentTitle?: unknown }).documentTitle ?? ""), heading: typeof (raw.rule as { heading?: unknown }).heading === "string" ? String((raw.rule as { heading: string }).heading) : null, quote: String((raw.rule as { quote: string }).quote) } : null
  return { quotes, rule, guidance: typeof raw.guidance === "string" ? raw.guidance : null }
}

/** Versão PUBLICADA atual de cada documento (da organização, não excluído) — a base da compatibilidade das observações. */
export async function loadPublishedVersions(db: Queryable, organizationId: string, documentIds: readonly string[]): Promise<Map<string, number>> {
  if (documentIds.length === 0) return new Map()
  const rows = (await db.query<{ id: string; version: number }>(
    `select d.id, v.version from knowledge_documents d
     join lateral (select version from knowledge_versions where document_id = d.id and status = 'PUBLISHED' order by version desc limit 1) v on true
     where d.organization_id = $1 and d.id = any($2::uuid[]) and d.deleted_at is null`,
    [organizationId, [...new Set(documentIds)]],
  )).rows
  return new Map(rows.map((row) => [row.id, Number(row.version)]))
}

/**
 * Observações ELEGÍVEIS do Subgrupo do colaborador (sem ele) nas mesmas práticas e na mesma janela — só para o AGREGADO do grupo
 * (proteção individual: padrão do grupo nunca vira crítica individual). Nunca lido para exibir pessoa, fala ou resultado de colega.
 */
export async function loadTeamObservations(db: Queryable, input: { organizationId: string; personId: string; start: Date; end: Date; practiceKeys: readonly string[]; /** V2 — Subgrupo OFICIAL do colaborador no período analisado (linha do fechamento); ausente = o atual. */ periodSubteamId?: string | null }): Promise<TeamObservationRow[]> {
  if (input.practiceKeys.length === 0) return []
  // ESCOPO DA COMPARAÇÃO = contrato do backend (nunca da IA nem da estratégia): o Subgrupo do colaborador NO PERÍODO analisado
  // (o do fechamento oficial, da mesma organização) e, sem ele, a posição atual; o Grupo acompanha o Subgrupo resolvido.
  const rows = (await db.query<{ person_id: string; interaction_id: string; practice_key: string; canonical_behavior: string | null; requirement: string; status: "FOLLOWED" | "NOT_FOLLOWED" }>(
    `with period_subteam as (select id, team_id from subteams where id = $6::uuid and organization_id = $1),
     subject as (select coalesce((select id from period_subteam), p.subteam_id) subteam_id, coalesce((select team_id from period_subteam), p.team_id) team_id from people p where p.id = $2 and p.organization_id = $1)
     select o.person_id, o.interaction_id, o.practice_key, o.canonical_behavior, o.requirement, o.status
     from process_checkpoint_observations o
     join people p on p.id = o.person_id and p.organization_id = o.organization_id and p.active
     join subject s on (s.subteam_id is not null and p.subteam_id = s.subteam_id) or (s.subteam_id is null and s.team_id is not null and p.team_id = s.team_id)
     where o.organization_id = $1 and o.person_id <> $2 and o.practice_key = any($5::text[]) and o.occurred_at >= $3 and o.occurred_at < $4
       and ${eligibleObservationSql("o")}`,
    [input.organizationId, input.personId, input.start, input.end, [...input.practiceKeys], input.periodSubteamId ?? null],
  )).rows
  return rows.map((row) => ({ personId: row.person_id, interactionId: row.interaction_id, practiceKey: row.practice_key, title: behaviorTitleOf(row.canonical_behavior, row.requirement), status: row.status }))
}

export const behaviorTitleOf = (behavior: string | null, requirement: string) => (behavior && behavior in BEHAVIOR_TITLES ? BEHAVIOR_TITLES[behavior as CanonicalBehavior] : requirement)

/** Diagnóstico já gravado para a chave (idempotência). */
export async function findPrvDiagnosis(db: Queryable, organizationId: string, idempotencyKey: string): Promise<{ id: string; sourceArtifactId: string | null; generatedAt: Date } | null> {
  const row = (await db.query<{ id: string; source_artifact_id: string | null; generated_at: Date }>(`select id, source_artifact_id, generated_at from prv_closing_diagnoses where organization_id = $1 and idempotency_key = $2`, [organizationId, idempotencyKey])).rows[0]
  return row ? { id: row.id, sourceArtifactId: row.source_artifact_id, generatedAt: new Date(row.generated_at) } : null
}
