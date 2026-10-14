import { Router } from "express"
import type { Database } from "../../../infrastructure/database/pool.js"
import { fetchOperatorProfile } from "../application/fetch-operator-overview.js"
import { PgAnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { accessDenied, canOpenEmployeeProfile, loadViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { loadPersonPresentation } from "../../profile-preferences/application/person-presentation-loader.js"


export function createSupervisorRouter(db: Database) {
  const router = Router()
  const analyticsRepository = new PgAnalyticsReadRepository(db)

  // Achado da auditoria de Indicadores/Equipe: este router aceitava qualquer sessão autenticada (um Operador lia o detalhe de
  // qualquer colega). A ficha (`/operators/:id`) passa pela MESMA autoridade de escopo da área de analytics (subárvore real de
  // reports_to_id ∪ escopo de `indicators.view`), nunca por um id vindo do browser.
  //
  // A antiga visão da operação (`GET /supervisor/overview`) saiu em 2026-10-13: nenhuma tela a chamava, ela abria dados por
  // pessoa da organização inteira pelo nível do JWT (achado F-2) e lia o histórico sem limite (auditoria de escalabilidade).
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
    // Indicadores e feedbacks NÃO vêm por aqui: a ficha mostra os indicadores pela área de analytics e o Acompanhamento pelo feed
    // da estrutura (`/analytics/follow-ups`) — carregá-los aqui era leitura descartada a cada abertura.
    const [plans, monitorings, escalation] = await Promise.all([
      db.query(`select dp.id,dp.title,dp.objective,dp.status,dp.starts_at "startsAt",dp.due_at "dueAt",coalesce(json_agg(json_build_object('id',da.id,'type',da.action_type,'description',da.description,'status',da.status,'dueAt',da.due_at)) filter(where da.id is not null),'[]') actions from development_plans dp left join development_actions da on da.plan_id=dp.id where dp.operator_id=$1 group by dp.id order by dp.created_at desc`, [id]),
      db.query(`select me.id,me.score,me.status,me.strengths,me.errors,me.best_practices "bestPractices",me.ai_summary "aiSummary",i.external_id "interactionExternalId",i.reason "interactionReason",i.started_at "interactionStartedAt",mt.trigger_type "triggerType",mt.title "triggerTitle",mt.reason "triggerReason",mt.severity,mt.metric_code "metricCode",mt.metric_value::float "metricValue",mt.threshold_value::float "thresholdValue",mt.recurrence_count "recurrenceCount",mt.detected_at "detectedAt" from monitoring_evaluations me join interactions i on i.id=me.interaction_id left join monitoring_triggers mt on mt.id=me.trigger_id where me.operator_id=$1 order by coalesce(mt.detected_at,me.created_at) desc`, [id]),
      db.query(`select current_level "currentLevel",reason,consecutive_cycles "consecutiveCycles",previous_actions "previousActions",ai_recommendation "aiRecommendation",confidence::float,generated_at "generatedAt" from performance_escalations where operator_id=$1 and status='ACTIVE' order by generated_at desc limit 1`, [id]),
    ])
    // Apresentação do colaborador VISITADO (nome escolhido por ele, foto e capa dele) — nunca as preferências de quem visita.
    const presentation = await loadPersonPresentation(db, request.user!.organizationId, id)
    return response.json({ data: { profile: { ...profile, presentation }, plans: plans.rows, monitorings: monitorings.rows, escalation: escalation.rows[0] ?? null } })
  })
  return router
}
