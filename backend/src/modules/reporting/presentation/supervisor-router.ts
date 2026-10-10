import { Router } from "express"
import type { Database } from "../../../infrastructure/database/pool.js"
import { fetchOperatorFeedbacks, fetchOperatorIndicators, fetchOperatorProfile } from "../application/fetch-operator-overview.js"
import { PgAnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { accessDenied, canOpenEmployeeProfile, loadViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { isHierarchyRole } from "../../performance-analytics/domain/hierarchy-levels.js"
import { loadPersonPresentation } from "../../profile-preferences/application/person-presentation-loader.js"


export function createSupervisorRouter(db: Database) {
  const router = Router()
  const analyticsRepository = new PgAnalyticsReadRepository(db)

  // Achado da auditoria de Indicadores/Equipe: este router aceitava qualquer sessão autenticada
  // (um Operador lia o overview da operação inteira e o detalhe de qualquer colega). O overview
  // continua sendo a visão legada da operação — só pra quem lidera alguém; o detalhe do
  // colaborador passa pela MESMA autoridade de escopo da área de analytics (subárvore real de
  // reports_to_id), nunca por um id vindo do browser.
  //
  // V1.5.8: o overview abre para quem LIDERA pessoas (regra operacional: nível na cadeia de gestão) ou para a conta com
  // `indicators.view` na organização inteira (ele mostra a operação inteira — escopo menor não basta). O nível legado
  // "ADMIN" não abre nada. A ficha (`/operators/:id`) não tem porteiro próprio: o escopo de analytics decide.
  router.get("/overview", async (request, response, next) => {
    try {
      const user = request.user!
      const allowed = isHierarchyRole(user.role) || (await analyticsRepository.loadAccessVisibility(user.organizationId, user.sub, "indicators.view")).organizationWide
      if (!allowed) return response.status(403).json({ error: { code: "FORBIDDEN", message: "Perfil sem permissão para este recurso." } })
    } catch (error) {
      return next(error)
    }
    const organizationId = request.user!.organizationId
    const [teams, indicators, priorities, plans, operators] = await Promise.all([
      db.query(`select t.id,t.name,count(p.id)::int "operatorCount" from teams t left join people p on p.team_id=t.id and p.role='OPERATOR' where t.organization_id=$1 group by t.id order by t.name`, [organizationId]),
      db.query(`select i.code,i.name,i.unit,round(avg(m.value),2)::float "actualValue",g.target_value::float "targetValue",i.desired_direction "direction",count(*) filter(where case when i.desired_direction='LOWER' then m.value>g.target_value else m.value<g.target_value end)::int "belowTargetCount" from indicator_measurements m join indicator_definitions i on i.id=m.indicator_definition_id join people p on p.id=m.subject_id left join goals g on g.indicator_definition_id=i.id and g.subject_type='TEAM' and g.subject_id=p.team_id where m.organization_id=$1 group by i.id,g.target_value order by i.code`, [organizationId]),
      db.query(`select c.id "caseId",p.id "operatorId",p.name "operatorName",t.name "teamName",c.priority,c.indicator_code "indicatorCode",c.root_cause "diagnosis",r.description "plan" from supervision_cases c join people p on p.id=c.operator_id join teams t on t.id=c.team_id left join lateral(select description from recommendations where case_id=c.id order by created_at limit 1) r on true where c.organization_id=$1 and c.status not in ('CLOSED','RESOLVED') order by c.priority,c.updated_at desc`, [organizationId]),
      db.query(`select dp.id,dp.operator_id "operatorId",p.name "operatorName",dp.title,dp.objective,dp.status,dp.due_at "dueAt",count(da.id)::int "actionCount",count(da.id) filter(where da.status='COMPLETED')::int "completedActions" from development_plans dp join people p on p.id=dp.operator_id left join development_actions da on da.plan_id=dp.id where dp.organization_id=$1 group by dp.id,p.name order by dp.due_at`, [organizationId]),
      db.query(`select p.id,p.name,p.avatar_url "avatarUrl",coalesce(p.job_title,'Operador') "jobTitle",t.name "teamName",p.strengths,p.development_focus "developmentFocus",coalesce((select count(*)::int from feedbacks f where f.operator_id=p.id),0) "feedbackCount",coalesce((select count(*)::int from monitoring_evaluations me where me.operator_id=p.id),0) "monitoringCount",coalesce((select pe.current_level from performance_escalations pe where pe.operator_id=p.id and pe.status='ACTIVE' order by pe.generated_at desc limit 1),'OBSERVE') "escalationLevel" from people p join teams t on t.id=p.team_id where p.organization_id=$1 and p.role='OPERATOR' and p.active=true order by p.name`, [organizationId]),
    ])
    response.json({ data: { teams: teams.rows, indicators: indicators.rows, priorities: priorities.rows, plans: plans.rows, operators: operators.rows } })
  })

  router.get("/operators/:id", async (request, response, next) => {
    const id = request.params.id!
    try {
      const scope = await loadViewerScope(analyticsRepository, request.user!)
      // Ficha = operador ativo visível que não é o próprio viewer (subárvore operacional ∪ escopo de `indicators.view`).
      if (!canOpenEmployeeProfile(scope, id)) throw accessDenied()
    } catch (error) {
      return next(error)
    }
    const profile = await fetchOperatorProfile(db, request.user!.organizationId, id)
    if (!profile) return response.status(404).json({ error: { code: "OPERATOR_NOT_FOUND", message: "Colaborador não encontrado." } })
    const [indicators, feedbacks, plans, monitorings, escalation] = await Promise.all([
      fetchOperatorIndicators(db, id),
      fetchOperatorFeedbacks(db, request.user!.organizationId, id, { personId: request.user!.personId }),
      db.query(`select dp.id,dp.title,dp.objective,dp.status,dp.starts_at "startsAt",dp.due_at "dueAt",coalesce(json_agg(json_build_object('id',da.id,'type',da.action_type,'description',da.description,'status',da.status,'dueAt',da.due_at)) filter(where da.id is not null),'[]') actions from development_plans dp left join development_actions da on da.plan_id=dp.id where dp.operator_id=$1 group by dp.id order by dp.created_at desc`, [id]),
      db.query(`select me.id,me.score,me.status,me.strengths,me.errors,me.best_practices "bestPractices",me.ai_summary "aiSummary",i.external_id "interactionExternalId",i.reason "interactionReason",i.started_at "interactionStartedAt",mt.trigger_type "triggerType",mt.title "triggerTitle",mt.reason "triggerReason",mt.severity,mt.metric_code "metricCode",mt.metric_value::float "metricValue",mt.threshold_value::float "thresholdValue",mt.recurrence_count "recurrenceCount",mt.detected_at "detectedAt" from monitoring_evaluations me join interactions i on i.id=me.interaction_id left join monitoring_triggers mt on mt.id=me.trigger_id where me.operator_id=$1 order by coalesce(mt.detected_at,me.created_at) desc`, [id]),
      db.query(`select current_level "currentLevel",reason,consecutive_cycles "consecutiveCycles",previous_actions "previousActions",ai_recommendation "aiRecommendation",confidence::float,generated_at "generatedAt" from performance_escalations where operator_id=$1 and status='ACTIVE' order by generated_at desc limit 1`, [id]),
    ])
    // Apresentação do colaborador VISITADO (nome escolhido por ele, foto e capa dele) — nunca as preferências de quem visita.
    const presentation = await loadPersonPresentation(db, request.user!.organizationId, id)
    return response.json({ data: { profile: { ...profile, presentation }, indicators, feedbacks, plans: plans.rows, monitorings: monitorings.rows, escalation: escalation.rows[0] ?? null } })
  })
  return router
}
