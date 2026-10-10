import type { SqlParams } from "../../../../shared/infrastructure/sql-params.js"
import { applicationsSql } from "../../../feedback-application/application/usage-analytics-reader.js"
import { ratingsHistorySql } from "../../../feedback-rating/application/usage-analytics-reader.js"
import { publishedFeedbackSourcesSql } from "../../../feedbacks/application/usage-analytics-reader.js"
import { deliveredInteractionFeedbackSourcesSql } from "../feedback-sources.js"
import { feedbackEmissionsSql } from "../../../workflows/application/usage-analytics-reader.js"
import { scopeCtes } from "./activity-sql.js"
import type { UsabilityContext } from "./usability-context.js"

/**
 * COORTE DE ENTREGA de feedbacks — uma linha por fonte × destinatário disponibilizada no período (chave: organização + tipo
 * da fonte + id + destinatário; duas fontes nunca se unem). Para cada item, os fatos posteriores à entrega até o CORTE:
 *   - WINDOW (padrão): corte = entrega + N dias (1, 7 ou 30) — taxa comparável entre itens; janela ainda aberta = provisória;
 *   - CUTOFF: corte = agora — o tempo de observação varia por item (rotulado, nunca misturado com a janela fixa).
 * Exposição/abertura vêm do navegador e SÓ contam quando o ator é o próprio destinatário; item entregue antes do início da
 * medição fica "exposição não medida" (nunca evento fabricado). Avaliação = versão VIGENTE no corte (histórico).
 */
export const FEEDBACK_SEGMENTS = ["AVAILABLE", "EXPOSURE_NOT_MEASURED", "NOT_EXPOSED", "EXPOSED", "OPENED", "EXPOSED_NOT_OPENED", "OPENED_NOT_RATED", "RATED_WITHOUT_OPENING", "RATED", "NOT_RATED", "ACKED", "PENDING_ACK", "ACK_OUTSIDE_APPLICATION", "APPLICATION_STARTED", "APPLICATION_COMPLETED"] as const
export type FeedbackSegment = (typeof FEEDBACK_SEGMENTS)[number]
export const FEEDBACK_SEGMENT_LABELS: Record<FeedbackSegment, string> = {
  AVAILABLE: "Disponibilizados",
  EXPOSURE_NOT_MEASURED: "Exposição não medida (entregues antes da coleta)",
  NOT_EXPOSED: "Não expostos ao destinatário",
  EXPOSED: "Expostos",
  OPENED: "Abertos",
  EXPOSED_NOT_OPENED: "Expostos e não abertos",
  OPENED_NOT_RATED: "Abertos e não avaliados",
  RATED_WITHOUT_OPENING: "Avaliados sem abertura observada",
  RATED: "Avaliados (útil / não útil vigente)",
  NOT_RATED: "Sem avaliação vigente",
  ACKED: "Com ciência",
  PENDING_ACK: "Ciência pendente",
  ACK_OUTSIDE_APPLICATION: "Ciência sem aplicação com a INIA",
  APPLICATION_STARTED: "Aplicação com a INIA iniciada",
  APPLICATION_COMPLETED: "Aplicação concluída",
}

export function feedbackCohortSql(p: SqlParams, ctx: UsabilityContext, measuredSince: Date | null): string {
  const org = p.typed(ctx.organizationId, "uuid")
  const f = ctx.filters
  const windowDays = p.add(f.cohortWindow)
  const now = p.typed(ctx.now, "timestamptz")
  const cut = f.conversionMode === "WINDOW" ? `least(src.available_at + make_interval(days => ${windowDays}::int), ${now})` : now
  const sourceFilters: string[] = []
  if (f.feedbackSource) sourceFilters.push(`src.source_kind = ${p.add(f.feedbackSource)}`)
  if (f.feedbackKind) sourceFilters.push(`src.feedback_kind = ${p.add(f.feedbackKind)}`)
  if (f.workflowId) sourceFilters.push(`src.source_kind = 'PUBLISHED_FEEDBACK' and src.source_id in (select em.feedback_id from (${feedbackEmissionsSql(org)}) em join workflow_enrollments we on we.id = em.enrollment_id where we.workflow_id = ${p.typed(f.workflowId, "uuid")})`)
  const measured = p.typed(measuredSince, "timestamptz")
  return `with ${scopeCtes(p, ctx)},
    sources as (${publishedFeedbackSourcesSql(p, ctx.organizationId)} union all ${deliveredInteractionFeedbackSourcesSql(p, ctx.organizationId)}),
    cohort as (
      select src.*, ${cut} cut,
        (src.available_at + make_interval(days => ${windowDays}::int)) <= ${now} mature,
        (${measured} is not null and ${measured} <= src.available_at) exposure_measured
      from sources src
      where src.available_at >= ${p.typed(ctx.period.start, "timestamptz")} and src.available_at < ${p.typed(ctx.period.end, "timestamptz")}
        and src.recipient_person_id in (select person_id from scope_official)${sourceFilters.map((clause) => ` and ${clause}`).join("")}
    ),
    consumption as (
      select c.source_kind, c.source_id,
        min(e.occurred_at) filter (where e.event_name = 'element.exposed' and e.element_key = 'feedback.card') card_exposed_at,
        min(e.occurred_at) filter (where e.event_name = 'screen.viewed' and e.screen_key in ('feedback.detail', 'feedback.session')) opened_at,
        count(distinct e.screen_instance_id) filter (where e.event_name = 'screen.viewed' and e.screen_key in ('feedback.detail', 'feedback.session'))::int open_count,
        max(e.device) filter (where e.event_name = 'screen.viewed') device
      from cohort c join usage_events e on e.organization_id = ${org} and e.entity_type = c.source_kind and e.entity_id = c.source_id
        and e.actor_person_id = c.recipient_person_id and e.occurred_at >= c.available_at and e.occurred_at < c.cut
      group by c.source_kind, c.source_id
    ),
    rating_now as (
      select distinct on (c.source_kind, c.source_id) c.source_kind, c.source_id, r.value current_value
      from cohort c join (${ratingsHistorySql(org)}) r on r.source_kind = c.source_kind and r.source_id = c.source_id and r.person_id = c.recipient_person_id
        and r.created_at <= c.cut and (r.superseded_at is null or r.superseded_at > c.cut)
      order by c.source_kind, c.source_id, r.created_at desc
    ),
    rating_first as (
      select c.source_kind, c.source_id, min(r.created_at) filter (where r.value in ('UP', 'DOWN')) first_rated_at, count(*)::int rating_rows
      from cohort c join (${ratingsHistorySql(org)}) r on r.source_kind = c.source_kind and r.source_id = c.source_id and r.person_id = c.recipient_person_id and r.created_at <= c.cut
      group by c.source_kind, c.source_id
    ),
    app as (select a.* from (${applicationsSql(org)}) a),
    items as (
      select c.source_kind, c.source_id, c.recipient_person_id, c.feedback_kind, c.available_at, c.cut, c.mature, c.exposure_measured, c.case_id,
        case when c.acknowledged_at <= c.cut then c.acknowledged_at end acknowledged_at,
        coalesce(cs.card_exposed_at, cs.opened_at) exposed_at, cs.opened_at, coalesce(cs.open_count, 0) open_count, cs.device,
        rn.current_value, rf.first_rated_at, coalesce(rf.rating_rows, 0) rating_rows,
        case when a.started_at <= c.cut then a.started_at end application_started_at,
        case when a.completed_at <= c.cut then a.completed_at end application_completed_at
      from cohort c
      left join consumption cs on cs.source_kind = c.source_kind and cs.source_id = c.source_id
      left join rating_now rn on rn.source_kind = c.source_kind and rn.source_id = c.source_id
      left join rating_first rf on rf.source_kind = c.source_kind and rf.source_id = c.source_id
      left join app a on a.source_kind = c.source_kind and a.source_id = c.source_id
    )
    select i.*,
      true seg_available,
      (not i.exposure_measured) seg_exposure_not_measured,
      (i.exposure_measured and i.exposed_at is null) seg_not_exposed,
      (i.exposed_at is not null) seg_exposed,
      (i.opened_at is not null) seg_opened,
      (i.exposure_measured and i.exposed_at is not null and i.opened_at is null) seg_exposed_not_opened,
      (i.opened_at is not null and coalesce(i.current_value, 'NONE') not in ('UP', 'DOWN')) seg_opened_not_rated,
      (i.exposure_measured and i.opened_at is null and i.current_value in ('UP', 'DOWN')) seg_rated_without_opening,
      (i.current_value in ('UP', 'DOWN')) seg_rated,
      (coalesce(i.current_value, 'NONE') not in ('UP', 'DOWN')) seg_not_rated,
      (i.acknowledged_at is not null) seg_acked,
      (i.acknowledged_at is null) seg_pending_ack,
      (i.acknowledged_at is not null and i.application_started_at is null) seg_ack_outside_application,
      (i.application_started_at is not null) seg_application_started,
      (i.application_completed_at is not null) seg_application_completed
    from items i`
}

export const feedbackSegmentColumn = (segment: FeedbackSegment) => `seg_${segment.toLowerCase()}`
