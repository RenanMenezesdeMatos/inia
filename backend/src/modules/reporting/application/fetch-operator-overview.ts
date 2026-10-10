import type { Database } from "../../../infrastructure/database/pool.js"
import { loadFeedbackSupportMaterials } from "../../feedbacks/application/feedback-support-materials.js"
import type { KnowledgeMaterialViewer } from "../../knowledge/application/knowledge-material-access.js"
import { resolveFeedbackViewsForViewer } from "../../reliable-feedback/application/feedback-view-access.js"
import { visibleInFollowUpSql } from "../../feedbacks/application/follow-up-visibility.js"
import { loadLegacyFeedbackHeadings } from "../../feedbacks/infrastructure/legacy-feedback-headings.js"
import { loadFeedbackOrigins } from "../../feedbacks/infrastructure/feedback-origins.js"


export async function fetchOperatorProfile(db: Database, organizationId: string, operatorId: string) {
  const result = await db.query(
    `select p.id,p.name,p.matricula,p.role,p.avatar_url "avatarUrl",coalesce(p.job_title,'Operador') "jobTitle",p.bio,p.strengths,p.development_focus "developmentFocus",p.hired_at "hiredAt",t.id "teamId",t.name "teamName"
     from people p left join teams t on t.id=p.team_id where p.id=$1 and p.organization_id=$2`,
    [operatorId, organizationId],
  )
  return result.rows[0] ?? null
}

export async function fetchOperatorIndicators(db: Database, operatorId: string) {
  const result = await db.query(
    `select i.code,i.name,i.unit,m.value::float,g.target_value::float "targetValue",i.desired_direction "direction",
       case when g.target_value is null then null when i.desired_direction='LOWER' then m.value<=g.target_value else m.value>=g.target_value end achieved,
       m.period_start "periodStart",m.period_end "periodEnd",
       ig.description "glossaryDescription",ig.good_practices "goodPractices",ig.feedback_guidance "feedbackGuidance"
     from indicator_measurements m
     join indicator_definitions i on i.id=m.indicator_definition_id
     left join people p on p.id=m.subject_id
     left join goals g on g.indicator_definition_id=i.id and g.subject_type='TEAM' and g.subject_id=p.team_id
     left join lateral (
       select description, good_practices, feedback_guidance
       from indicator_glossary where indicator_definition_id=i.id and active order by version desc limit 1
     ) ig on true
     where m.subject_id=$1
     order by m.period_end desc`,
    [operatorId],
  )
  return result.rows
}

/** `viewer` = quem está lendo (o próprio operador no /operator/overview; o gestor na rota de
 * supervisor) — os materiais de apoio são resolvidos com o acesso ATUAL de quem lê.
 *
 * Timeline do Acompanhamento: MAIS RECENTE PRIMEIRO pelo instante canônico do feed (`coalesce(published_at, created_at)`,
 * o mesmo do feed da estrutura), desempate determinístico por id. Feedback com ocultação vigente (migration 095) não entra. */
export async function fetchOperatorFeedbacks(db: Database, organizationId: string, operatorId: string, viewer: KnowledgeMaterialViewer, options: { publishedOnly?: boolean } = {}) {
  const result = await db.query<{ id: string } & Record<string, unknown>>(
    `select f.id,f.feedback_kind "kind",f.status,c.summary,f.impacted_indicator "impactedIndicator",f.evidence_found "evidenceFound",f.observed_behavior "observedBehavior",f.related_procedure "relatedProcedure",f.recommendation,f.strengths,f.improvement_points "improvementPoints",f.best_practices "bestPractices",f.created_at "createdAt",coalesce(f.published_at,f.created_at) "occurredAt",f.acknowledged_at "acknowledgedAt",
       coalesce(f.context_snapshot->'feedbackEngine'->'feedbackView', f.context_snapshot->'reliableFeedback'->'feedbackView') "feedbackView"
     from feedbacks f join supervision_cases c on c.id=f.case_id where f.operator_id=$1 and ($2::boolean is not true or f.status = 'PUBLISHED') and ${visibleInFollowUpSql("f")} order by coalesce(f.published_at, f.created_at) desc, f.id desc`,
    [operatorId, options.publishedOnly === true],
  )
  const supportMaterials = await loadFeedbackSupportMaterials(db, { organizationId, viewer, feedbackIds: result.rows.map((row) => row.id) })
  // Feedback por Flag V2 — narrativa + detalhes (view model publicado), com os links resolvidos para QUEM LÊ.
  const views = await resolveFeedbackViewsForViewer(db, { organizationId, viewer, views: result.rows.map((row) => row.feedbackView) })
  // Feedback de atendimento sem view model (pipelines anteriores): título pelo assunto da interação vinculada, na leitura (nada regravado).
  const legacyHeadings = await loadLegacyFeedbackHeadings(db, { organizationId, feedbackIds: result.rows.map((row) => row.id) })
  // Motivo do feedback (flag que disparou a monitoria, rotina, avulsa, indicador) — selo e ícone do cabeçalho do item.
  const origins = await loadFeedbackOrigins(db, { organizationId, feedbackIds: result.rows.map((row) => row.id) })
  return result.rows.map((row, index) => {
    const legacy = legacyHeadings.get(row.id)
    return { ...row, feedbackView: views[index] ?? null, supportMaterials: supportMaterials.get(row.id) ?? [], origin: origins.get(row.id) ?? null, heading: legacy ? { title: legacy.title, subtitle: legacy.subtitle, subjectSource: legacy.subjectSource } : null }
  })
}
