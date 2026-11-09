import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * LEITOR ANALÍTICO do motor de Workflow (Monitoria de usabilidade). Regras fixadas pelo motor, nunca reinventadas:
 *   - DISPARO = matrícula RAIZ (`parent_enrollment_id is null`) efetivamente criada; filhos de fan-out, tentativas de nó e
 *     retries não são disparos.
 *   - ORIGEM pela coluna que o motor preencheu: execução manual (`manual_run_id`) > interação (gatilho por Flag) > medição de
 *     indicador > agenda (`scheduled_subject_id`). Ter um colaborador associado NUNCA torna a origem manual.
 *   - SUJEITO analisado = operador da interação | pessoa da medição | sujeito agendado/manual; em Workflow CONSOLIDADO o sujeito é
 *     uma estrutura (sem pessoa) — `structure_subject = true`.
 *   - SOLICITANTE manual (`workflow_manual_runs.requested_by`) ≠ sujeito ≠ destinatário do resultado.
 *   - Estados reais: active | waiting | completed | failed | dead. Só `completed` é sucesso; `dead`, falha, espera e bloqueio não.
 *   - QA Lab não persiste matrículas (efeitos simulados) — não há execução de QA nestas tabelas.
 *
 * Colunas de `rootEnrollmentsSql`: root_id, workflow_id, version_id, status, created_at, updated_at, current_node_id, origin,
 * manual_run_id, manual_requested_by, structure_subject, subject_person_id.
 */
type Queryable = Pick<Database, "query">

export const WORKFLOW_ORIGINS = ["MANUAL", "INTERACTION", "INDICATOR", "SCHEDULE"] as const
export type WorkflowOrigin = (typeof WORKFLOW_ORIGINS)[number]
export const WORKFLOW_ORIGIN_LABELS: Record<WorkflowOrigin, string> = { MANUAL: "Execução manual", INTERACTION: "Interação (Flag)", INDICATOR: "Medição de indicador", SCHEDULE: "Agenda" }

const ENROLLMENT_SELECT = `e.id, e.workflow_id, e.version_id, e.status, e.created_at, e.updated_at, e.current_node_id,
      case when e.manual_run_id is not null then 'MANUAL' when e.interaction_id is not null then 'INTERACTION'
           when e.indicator_measurement_id is not null then 'INDICATOR' else 'SCHEDULE' end origin,
      e.manual_run_id, mr.requested_by manual_requested_by,
      (wf.consolidated_structure is not null) structure_subject,
      case when wf.consolidated_structure is not null then null
           else coalesce(i.operator_id, case when m.subject_type = 'PERSON' then m.subject_id end, mr.collaborator_id, e.scheduled_subject_id) end subject_person_id`
// Modo de análise = o do Workflow (workflows.consolidated_structure, migration 047); a versão não guarda essa coluna.
const ENROLLMENT_JOINS = `left join workflows_all wf on wf.id = e.workflow_id
    left join interactions i on i.id = e.interaction_id
    left join indicator_measurements_all m on m.id = e.indicator_measurement_id
    left join workflow_manual_runs mr on mr.id = e.manual_run_id`

export function rootEnrollmentsSql(organizationParam: string): string {
  return `select ${ENROLLMENT_SELECT.replace("e.id,", "e.id root_id,")} from workflow_enrollments e ${ENROLLMENT_JOINS}
    where e.organization_id = ${organizationParam} and e.parent_enrollment_id is null`
}

/** Colunas: child_id, root_id, status, created_at, updated_at, subject_person_id. */
export function childEnrollmentsSql(organizationParam: string): string {
  return `select e.id child_id, e.parent_enrollment_id root_id, e.status, e.created_at, e.updated_at,
      coalesce(i.operator_id, case when m.subject_type = 'PERSON' then m.subject_id end, e.scheduled_subject_id) subject_person_id
    from workflow_enrollments e
    left join interactions i on i.id = e.interaction_id
    left join indicator_measurements_all m on m.id = e.indicator_measurement_id
    where e.organization_id = ${organizationParam} and e.parent_enrollment_id is not null`
}

/** Falhas por etapa/código (node_failed, flow_dead) — colunas: enrollment_id, root_id, node_id, event_type, error_code, error_category, created_at. */
export function enrollmentFailuresSql(organizationParam: string): string {
  return `select ev.enrollment_id, coalesce(e.parent_enrollment_id, e.id) root_id, ev.node_id, ev.event_type,
      coalesce(ev.payload->>'errorCode', ev.payload->>'reason', 'SEM_CODIGO') error_code, ev.payload->>'errorCategory' error_category, ev.created_at
    from workflow_enrollment_events ev join workflow_enrollments e on e.id = ev.enrollment_id
    where e.organization_id = ${organizationParam} and ev.event_type in ('node_failed', 'flow_dead')`
}

/** Revisões humanas (pedido → decisão) — colunas: enrollment_id, root_id, node_id, requested_at, decided_at, decision. */
export function humanReviewsSql(organizationParam: string): string {
  return `select req.enrollment_id, coalesce(e.parent_enrollment_id, e.id) root_id, req.node_id, req.created_at requested_at,
      dec.created_at decided_at, dec.payload->>'decision' decision
    from workflow_enrollment_events req join workflow_enrollments e on e.id = req.enrollment_id
    left join lateral (select d.created_at, d.payload from workflow_enrollment_events d
      where d.enrollment_id = req.enrollment_id and d.node_id = req.node_id and d.event_type in ('human_review_decided', 'human_review_decision_submitted') and d.created_at >= req.created_at
      order by d.created_at limit 1) dec on true
    where e.organization_id = ${organizationParam} and req.event_type = 'human_review_requested'`
}

/** Resultados publicados como feedback (Acompanhamento) — colunas: root_id, enrollment_id, recipient_person_id, feedback_id, created_at, surface. */
export function feedbackEmissionsSql(organizationParam: string): string {
  return `select coalesce(e.parent_enrollment_id, e.id) root_id, em.enrollment_id, em.recipient_id recipient_person_id, em.feedback_id, em.created_at, em.surface
    from workflow_output_emissions em join workflow_enrollments e on e.id = em.enrollment_id
    where em.organization_id = ${organizationParam}`
}

/** Colunas: workflow_id, name, active, active_version_id, trigger_kind, consolidated. */
export function workflowsSql(organizationParam: string): string {
  return `select w.id workflow_id, w.name, w.active, w.active_version_id, w.trigger_config->>'kind' trigger_kind, (w.consolidated_structure is not null) consolidated
    from workflows_all w where w.organization_id = ${organizationParam}`
}

export async function existingWorkflows(db: Queryable, organizationId: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const result = await db.query<{ id: string }>(`select id from workflows_all where organization_id = $1 and id = any($2::uuid[])`, [organizationId, [...new Set(ids)]])
  return new Set(result.rows.map((row) => row.id))
}

/** Execuções manuais (pedido aceito) — colunas: manual_run_id, workflow_id, version_id, requested_by, requested_at, context, collaborator_id. */
export function manualRunsSql(organizationParam: string): string {
  return `select mr.id manual_run_id, mr.workflow_id, mr.version_id, mr.requested_by, mr.requested_at, mr.context, mr.collaborator_id
    from workflow_manual_runs mr where mr.organization_id = ${organizationParam}`
}

/** Primeiro evento do motor por matrícula ("tempo até iniciar") — colunas: enrollment_id, first_event_at. */
export function enrollmentStartSql(organizationParam: string): string {
  return `select ev.enrollment_id, min(ev.created_at) first_event_at from workflow_enrollment_events ev join workflow_enrollments e on e.id = ev.enrollment_id
    where e.organization_id = ${organizationParam} group by ev.enrollment_id`
}
