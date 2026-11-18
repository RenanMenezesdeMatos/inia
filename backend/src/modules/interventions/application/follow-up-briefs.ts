import type { Database } from "../../../infrastructure/database/pool.js"
import type { Evolution } from "../domain/evolution.js"
import type { IntelligenceReport } from "../domain/intelligence-report.js"
import type { BriefFeedback } from "../domain/leader-brief.js"
import { protectStoredLeave } from "../domain/protected-leave.js"

/**
 * O RESUMO DA INIA no Acompanhamento de quem lidera: para os avisos de abertura de uma intervenção (responsável, aprovador ou
 * quem decide), devolve o resumo gravado no relatório da avaliação — a fala da INIA, a situação, o que já foi feito, a evolução
 * medida e o que falta saber. É o retrato de quando a política avaliou; nada é recalculado na leitura.
 *
 * Acesso decidido aqui, no servidor: só o destinatário do aviso que AINDA é parte da intervenção (responsável, aprovador ou
 * destinatário da decisão). Quem deixou de ser (encaminhou a outro, por exemplo) continua vendo o aviso curto, sem o resumo.
 * Relatório anterior ao resumo (V1) não tem o que devolver: o aviso aparece como antes.
 */
export type FollowUpInterventionBrief = {
  /** null = a política só avisou (nenhuma intervenção foi criada). */
  interventionId: string | null
  typeName: string
  sensitive: boolean
  /** A fala da INIA para QUEM LÊ (2ª pessoa quando é o responsável). */
  lead: string
  situation: string[]
  alreadyDone: {
    windowDays: number
    feedbacks: BriefFeedback[]
    feedbackCount: number
    interventions: { id: string; typeName: string; status: string; openedAt: string; closedAt: string | null; operationalResult: string | null }[]
  }
  evolution: Evolution | null
  unknowns: string[]
  nextSteps: string[]
}

const OPENING_ALERT_TYPES = ["INTERVENTION_ASSIGNED", "INTERVENTION_APPROVAL_REQUESTED", "INTERVENTION_DECISION_REQUESTED"]

export async function loadInterventionBriefsForAlerts(db: Pick<Database, "query">, input: { organizationId: string; viewerId: string; alertIds: readonly string[] }): Promise<Map<string, FollowUpInterventionBrief>> {
  const briefs = new Map<string, FollowUpInterventionBrief>()
  if (input.alertIds.length === 0) return briefs
  const rows = await db.query<{ alert_id: string; intervention_id: string; sensitive: boolean; responsible_id: string; structured: IntelligenceReport }>(
    `select a.id alert_id, i.id intervention_id, i.sensitive, i.responsible_id, r.structured
       from alerts a
       join interventions i on i.organization_id = a.organization_id
        and i.id = case when a.dedupe_key ~ '^intervention:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:' then split_part(a.dedupe_key, ':', 2)::uuid end
       join intervention_reports r on r.id = i.report_id and r.organization_id = i.organization_id
      where a.organization_id = $1 and a.id = any($2::uuid[]) and a.recipient_id = $3 and a.alert_type = any($4::text[])
        and ($3 = i.responsible_id or $3 = i.approver_id or $3 = any(i.approval_recipient_ids))`,
    [input.organizationId, input.alertIds, input.viewerId, OPENING_ALERT_TYPES],
  )
  for (const row of rows.rows) {
    // Mesma proteção de leitura do relatório (tipo de afastamento sensível nunca sai) — ver `protectStoredLeave`.
    const report = protectStoredLeave(row.structured)
    const brief = report.brief
    const action = brief?.actions.find((item) => item.interventionId === row.intervention_id)
    if (!brief || !action) continue
    briefs.set(row.alert_id, {
      interventionId: row.intervention_id,
      typeName: action.typeName,
      sensitive: row.sensitive,
      lead: row.responsible_id === input.viewerId ? action.lead.toResponsible : action.lead.toOthers,
      situation: brief.situation,
      alreadyDone: {
        ...brief.alreadyDone,
        // A própria intervenção deste aviso não é "o que já foi feito".
        interventions: report.priorInterventions.filter((prior) => prior.id !== row.intervention_id).map((prior) => ({ id: prior.id, typeName: prior.typeName, status: prior.status, openedAt: prior.openedAt, closedAt: prior.closedAt, operationalResult: prior.operationalResult })),
      },
      evolution: brief.evolution,
      unknowns: brief.unknowns,
      nextSteps: report.actions.find((item) => item.handle === action.handle)?.nextSteps ?? [],
    })
  }
  // "Só avisar": o aviso aponta o relatório (não há intervenção). Vale para o destinatário enquanto o colaborador continuar
  // na cadeia de gestão dele.
  const notices = await db.query<{ alert_id: string; type_key: string; structured: IntelligenceReport }>(
    `select a.id alert_id, split_part(a.dedupe_key, ':', 3) type_key, r.structured
       from alerts a
       join intervention_reports r on r.organization_id = a.organization_id
        and r.id = case when a.dedupe_key ~ '^intervention-notice:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:' then split_part(a.dedupe_key, ':', 2)::uuid end
      where a.organization_id = $1 and a.id = any($2::uuid[]) and a.recipient_id = $3 and a.alert_type = 'INTERVENTION_NOTICE'
        and exists (
          with recursive up as (
            select p.reports_to_id id, 1 depth from people p where p.id = r.person_id
            union all
            select x.reports_to_id, up.depth + 1 from people x join up on x.id = up.id where x.reports_to_id is not null and up.depth < 12)
          select 1 from up where up.id = $3)`,
    [input.organizationId, input.alertIds, input.viewerId],
  )
  for (const row of notices.rows) {
    const report = protectStoredLeave(row.structured)
    const brief = report.brief
    const action = brief?.actions.find((item) => item.typeKey === row.type_key && item.status === "NOTIFIED")
    if (!brief || !action) continue
    briefs.set(row.alert_id, {
      interventionId: null,
      typeName: action.typeName,
      sensitive: false,
      lead: action.lead.toResponsible,
      situation: brief.situation,
      alreadyDone: { ...brief.alreadyDone, interventions: report.priorInterventions.map((prior) => ({ id: prior.id, typeName: prior.typeName, status: prior.status, openedAt: prior.openedAt, closedAt: prior.closedAt, operationalResult: prior.operationalResult })) },
      evolution: brief.evolution,
      unknowns: brief.unknowns,
      nextSteps: report.actions.find((item) => item.handle === action.handle)?.nextSteps ?? [],
    })
  }
  return briefs
}
