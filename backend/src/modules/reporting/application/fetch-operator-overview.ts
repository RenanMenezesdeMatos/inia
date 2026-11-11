import type { Database } from "../../../infrastructure/database/pool.js"
import { loadFeedbackSupportMaterials } from "../../feedbacks/application/feedback-support-materials.js"
import type { KnowledgeMaterialViewer } from "../../knowledge/application/knowledge-material-access.js"
import { resolveFeedbackViewsForViewer } from "../../reliable-feedback/application/feedback-view-access.js"
import { visibleInFollowUpSql } from "../../feedbacks/application/follow-up-visibility.js"
import { loadLegacyFeedbackHeadings } from "../../feedbacks/infrastructure/legacy-feedback-headings.js"
import { loadFeedbackOrigins } from "../../feedbacks/infrastructure/feedback-origins.js"
import { encodeFollowUpCursor, followUpCursorAtSql, type FollowUpCursor } from "../../feedbacks/domain/follow-up-cursor.js"
import { loadFeedbackEvaluations } from "../../feedback-rating/application/feedback-evaluation-reader.js"
import { EMPTY_EVALUATION } from "../../feedback-rating/domain/feedback-rating.js"


export async function fetchOperatorProfile(db: Database, organizationId: string, operatorId: string) {
  const result = await db.query(
    `select p.id,p.name,p.matricula,p.role,p.avatar_url "avatarUrl",coalesce(p.job_title,'Operador') "jobTitle",p.bio,p.strengths,p.development_focus "developmentFocus",p.hired_at "hiredAt",t.id "teamId",t.name "teamName"
     from people p left join teams t on t.id=p.team_id where p.id=$1 and p.organization_id=$2`,
    [operatorId, organizationId],
  )
  return result.rows[0] ?? null
}

/**
 * Último período medido de CADA indicador da pessoa (o Acompanhamento usa só esse valor, como contexto leve do chat). Uma busca
 * `limit 1` por indicador do catálogo da organização, pelo índice único de medições (organização, indicador, tipo, pessoa,
 * início, fim) — nunca o histórico inteiro da pessoa. Meta = a da equipe vigente no fim do período medido, como na ingestão.
 * Ordem: período mais recente primeiro (o primeiro item é o foco do chat).
 */
export async function fetchOperatorIndicators(db: Database, organizationId: string, operatorId: string) {
  const result = await db.query(
    `select i.code,i.name,i.unit,m.value::float,g.target_value::float "targetValue",i.desired_direction "direction",
       case when g.target_value is null then null when i.desired_direction='LOWER' then m.value<=g.target_value else m.value>=g.target_value end achieved,
       m.period_start "periodStart",m.period_end "periodEnd",
       ig.description "glossaryDescription",ig.good_practices "goodPractices",ig.feedback_guidance "feedbackGuidance"
     from indicator_definitions i
     cross join lateral (
       select value, period_start, period_end from indicator_measurements m
       where m.organization_id = i.organization_id and m.subject_type = 'PERSON' and m.subject_id = $2 and m.indicator_definition_id = i.id
       order by m.period_start desc, m.period_end desc limit 1
     ) m
     left join people p on p.id = $2 and p.organization_id = i.organization_id
     left join lateral (
       select target_value from goals g
       where g.organization_id = i.organization_id and g.indicator_definition_id = i.id and g.subject_type = 'TEAM' and g.subject_id = p.team_id
         and g.valid_from <= m.period_end::date and (g.valid_until is null or g.valid_until >= m.period_end::date)
       order by g.valid_from desc limit 1
     ) g on true
     left join lateral (
       select description, good_practices, feedback_guidance from indicator_glossary
       where organization_id = i.organization_id and indicator_definition_id = i.id and active order by version desc limit 1
     ) ig on true
     where i.organization_id = $1
     order by m.period_end desc, i.code`,
    [organizationId, operatorId],
  )
  return result.rows
}

/** Itens por página do Acompanhamento do colaborador: o SSR traz a primeira; "carregar mais" pede as seguintes pelo cursor. */
export const OPERATOR_FEED_PAGE_SIZE = 12
export const OPERATOR_FEED_MAX_PAGE_SIZE = 50

export type OperatorFeedbackPageOptions = { publishedOnly?: boolean; limit?: number | undefined; before?: FollowUpCursor | null }

/** `viewer` = quem está lendo (o próprio operador no /operator/overview e no /operator/feedbacks) — os materiais de apoio são
 * resolvidos com o acesso ATUAL de quem lê.
 *
 * Timeline do Acompanhamento: MAIS RECENTE PRIMEIRO pelo instante canônico do feed (`coalesce(published_at, created_at)`,
 * o mesmo do feed da estrutura), desempate determinístico por id. Feedback com ocultação vigente (migration 095) não entra.
 * Paginada por keyset (`before` = último item da página anterior): a página publicada sai do índice parcial
 * `idx_feedbacks_operator_feed` (migration 126) sem ordenar o histórico da pessoa; os enriquecimentos rodam só para a página. */
export async function fetchOperatorFeedbackPage(db: Database, organizationId: string, operatorId: string, viewer: KnowledgeMaterialViewer, options: OperatorFeedbackPageOptions = {}) {
  const limit = Math.min(Math.max(options.limit ?? OPERATOR_FEED_PAGE_SIZE, 1), OPERATOR_FEED_MAX_PAGE_SIZE)
  const params: unknown[] = [organizationId, operatorId, limit + 1]
  const before = options.before ? (params.push(options.before.at, options.before.id), `and (coalesce(f.published_at, f.created_at), f.id) < ($4::timestamptz, $5::uuid)`) : ""
  const result = await db.query<{ id: string; cursorAt?: string } & Record<string, unknown>>(
    `select f.id,f.feedback_kind "kind",f.status,c.summary,f.impacted_indicator "impactedIndicator",f.evidence_found "evidenceFound",f.observed_behavior "observedBehavior",f.related_procedure "relatedProcedure",f.recommendation,f.strengths,f.improvement_points "improvementPoints",f.best_practices "bestPractices",f.created_at "createdAt",coalesce(f.published_at,f.created_at) "occurredAt",f.acknowledged_at "acknowledgedAt",
       coalesce(f.context_snapshot->'feedbackEngine'->'feedbackView', f.context_snapshot->'reliableFeedback'->'feedbackView') "feedbackView",
       ${followUpCursorAtSql("coalesce(f.published_at, f.created_at)")} "cursorAt"
     from feedbacks f join supervision_cases c on c.id=f.case_id
     where f.organization_id = $1 and f.operator_id = $2 ${options.publishedOnly === true ? "and f.status = 'PUBLISHED'" : ""} and ${visibleInFollowUpSql("f")} ${before}
     order by coalesce(f.published_at, f.created_at) desc, f.id desc
     limit $3`,
    params,
  )
  const page = result.rows.slice(0, limit)
  const last = page.at(-1)
  const nextCursor = result.rows.length > limit && last?.cursorAt ? encodeFollowUpCursor({ at: last.cursorAt, id: last.id }) : null
  // O instante do cursor é interno: sai da linha antes de virar payload.
  const rows = page.map((row) => {
    const copy = { ...row }
    delete copy.cursorAt
    return copy
  })
  const supportMaterials = await loadFeedbackSupportMaterials(db, { organizationId, viewer, feedbackIds: rows.map((row) => row.id) })
  // Feedback por Flag V2 — narrativa + detalhes (view model publicado), com os links resolvidos para QUEM LÊ.
  const views = await resolveFeedbackViewsForViewer(db, { organizationId, viewer, views: rows.map((row) => row.feedbackView) })
  // Feedback de atendimento sem view model (pipelines anteriores): título pelo assunto da interação vinculada, na leitura (nada regravado).
  const legacyHeadings = await loadLegacyFeedbackHeadings(db, { organizationId, feedbackIds: rows.map((row) => row.id) })
  // Motivo do feedback (flag que disparou a monitoria, rotina, avulsa, indicador) — selo e ícone do cabeçalho do item.
  const origins = await loadFeedbackOrigins(db, { organizationId, feedbackIds: rows.map((row) => row.id) })
  // Avaliação do item (escolha registrada na ciência + contestação antiga): só quando quem lê é o próprio destinatário — a
  // justificativa nunca vai para outra pessoa por este caminho (a liderança vê só o estado da ciência).
  const ownFeed = viewer.personId === operatorId
  const evaluations = ownFeed ? await loadFeedbackEvaluations(db, { organizationId, personId: operatorId }, rows.map((row) => ({ kind: "PUBLISHED_FEEDBACK" as const, id: row.id }))) : null
  const items = rows.map((row, index) => {
    const legacy = legacyHeadings.get(row.id)
    return {
      ...row,
      feedbackView: views[index] ?? null,
      supportMaterials: supportMaterials.get(row.id) ?? [],
      origin: origins.get(row.id) ?? null,
      heading: legacy ? { title: legacy.title, subtitle: legacy.subtitle, subjectSource: legacy.subjectSource } : null,
      evaluation: evaluations ? (evaluations.get(`PUBLISHED_FEEDBACK:${row.id}`) ?? EMPTY_EVALUATION) : null,
    }
  })
  return { items, nextCursor }
}

/** A primeira página do Acompanhamento (ou a página depois de `before`) — atalho de `fetchOperatorFeedbackPage` sem o cursor. */
export async function fetchOperatorFeedbacks(db: Database, organizationId: string, operatorId: string, viewer: KnowledgeMaterialViewer, options: OperatorFeedbackPageOptions = {}) {
  return (await fetchOperatorFeedbackPage(db, organizationId, operatorId, viewer, options)).items
}
