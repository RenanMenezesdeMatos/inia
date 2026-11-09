import type { Database } from "../../../infrastructure/database/pool.js"
import { resolveFeedbackOrigin, type FeedbackOrigin, type FeedbackOriginFacts } from "../domain/feedback-origin.js"

type Queryable = Pick<Database, "query">

type OriginRow = {
  id: string
  feedback_kind: "MONITORING" | "INDICATOR"
  matched_flag_name: string | null
  manual_run: boolean
  scheduled: boolean
  by_indicator: boolean
  trigger_kind: string | null
  flag_label: string | null
  flag_icon_key: string | null
  flag_value_type: "BOOLEAN" | "NUMERIC" | null
  indicator_unit: string | null
  indicator_icon_key: string | null
}

/**
 * Fatos do MOTIVO de cada feedback, em UMA consulta para a página inteira: a matrícula do Workflow que publicou (emissão do
 * Output → gatilho: flag, agenda, execução manual, indicador) e o indicador investigado (execução de análise do motor, a
 * medição que disparou ou o código gravado no caso). Feedback sem Workflow (legado, manual) = motivo desconhecido.
 */
export async function loadFeedbackOrigins(db: Queryable, input: { organizationId: string; feedbackIds: readonly string[] }): Promise<Map<string, FeedbackOrigin>> {
  if (input.feedbackIds.length === 0) return new Map()
  const result = await db.query<OriginRow>(
    `select f.id, f.feedback_kind,
            e.matched_flag_name,
            (e.manual_run_id is not null) manual_run,
            (e.scheduled_for is not null or e.scheduled_subject_id is not null) scheduled,
            (e.indicator_measurement_id is not null) by_indicator,
            w.trigger_config->>'kind' trigger_kind,
            cf.label flag_label, cf.icon_key flag_icon_key, cf.value_type flag_value_type,
            coalesce(d_run.unit, d_meas.unit, d_case.unit) indicator_unit,
            coalesce(d_run.icon_key, d_meas.icon_key, d_case.icon_key) indicator_icon_key
       from feedbacks f
       left join supervision_cases c on c.id = f.case_id
       left join lateral (select em.enrollment_id from workflow_output_emissions em where em.feedback_id = f.id order by em.created_at limit 1) em on true
       left join workflow_enrollments e on e.id = em.enrollment_id
       left join workflows_all w on w.id = e.workflow_id
       left join lateral (
         select label, icon_key, value_type from channel_flags_all
          where organization_id = f.organization_id and flag_name = e.matched_flag_name
          order by (deleted_at is null) desc, active desc, created_at limit 1
       ) cf on e.matched_flag_name is not null
       left join lateral (
         select d.unit, d.icon_key
           from jsonb_array_elements_text(coalesce(f.context_snapshot->'feedbackEngine'->'analysisRunIds', '[]'::jsonb)) rid
           join feedback_analysis_runs r on r.id::text = rid
           join indicator_definitions_all d on d.id = r.indicator_definition_id
          limit 1
       ) d_run on f.feedback_kind = 'INDICATOR'
       left join indicator_measurements_all m on m.id = e.indicator_measurement_id
       left join indicator_definitions_all d_meas on d_meas.id = m.indicator_definition_id
       left join lateral (select x.* from indicator_definitions_all x where x.organization_id = f.organization_id and x.code = c.indicator_code order by (x.deleted_at is null) desc, x.created_at desc limit 1) d_case on true
      where f.id = any($1::uuid[]) and f.organization_id = $2`,
    [input.feedbackIds, input.organizationId],
  )
  return new Map(result.rows.map((row) => [row.id, resolveFeedbackOrigin(factsOf(row))]))
}

function factsOf(row: OriginRow): FeedbackOriginFacts {
  const trigger: FeedbackOriginFacts["trigger"] = row.matched_flag_name
    ? { kind: "FLAG", flagName: row.matched_flag_name, flagLabel: row.flag_label, flagIconKey: row.flag_icon_key, flagValueType: row.flag_value_type }
    : row.manual_run || row.trigger_kind === "manual"
      ? { kind: "MANUAL" }
      : row.scheduled || row.trigger_kind === "schedule"
        ? { kind: "SCHEDULE" }
        : row.by_indicator || row.trigger_kind === "indicator"
          ? { kind: "INDICATOR" }
          : null
  return { family: row.feedback_kind, trigger, indicator: row.indicator_unit ? { unit: row.indicator_unit, iconKey: row.indicator_icon_key } : null }
}
