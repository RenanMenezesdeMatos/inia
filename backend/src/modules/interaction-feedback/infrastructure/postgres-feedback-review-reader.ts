import type { Database } from "../../../infrastructure/database/pool.js"
import type { FeedbackReviewReader, QaGrantScope, QaPermission, ReviewQueueFilters, ReviewViewer } from "../application/feedback-review-reader.js"
import { rolesWithPermission } from "../../access/domain/roles.js"
import type { FeedbackDeliveryDecision } from "../domain/feedback-delivery-policy.js"
import type { ReviewStatus } from "../domain/feedback-review.js"
import { DEFAULT_ORGANIZATION_TIMEZONE } from "../../workflows/application/organization-timezone.js"
import { createPostgresInteractionFeedbackStore } from "./postgres-interaction-feedback-store.js"
import { findReliableAnalysis, findReliableReview } from "../../reliable-feedback/infrastructure/postgres-reliable-feedback-store.js"

type Queryable = Pick<Database, "query">

/**
 * Escopo do avaliador = UNIÃO das atribuições ATIVAS de papéis que contêm a permissão pedida (modelo geral de acesso; conta
 * ativa de pessoa ativa), nunca o cargo. `$3` = códigos dos papéis com a permissão (catálogo em código). A subárvore por
 * reports_to_id só é percorrida com atribuição MY_STRUCTURE (mesma CTE de `loadDescendants`; union = termina com ciclo).
 */
const SCOPE_CTE = `with recursive grants as (
  select a.scope_type, a.team_id, a.subteam_id from access_role_assignments a
  join user_accounts ua on ua.id = a.user_account_id and ua.organization_id = a.organization_id and ua.active
  join people gp on gp.id = ua.person_id and gp.active
  where a.organization_id = $1 and ua.person_id = $2 and a.revoked_at is null and a.role_code = any($3::text[])
), subordinates as (
  select id from people where organization_id = $1 and reports_to_id = $2 and exists (select 1 from grants where scope_type = 'MY_STRUCTURE')
  union
  select p.id from people p join subordinates s on p.reports_to_id = s.id
)`
const SCOPED_FROM = `from interaction_feedback_item_reviews r
  join interaction_feedback_runs run on run.id = r.run_id and run.organization_id = r.organization_id
  -- Só itens SELECIONADOS para QA pela política de entrega (BLOCKED nunca tem redação; AUTO_DELIVER não é selecionado).
  join interaction_feedback_delivery_decisions d on d.item_review_id = r.id and d.organization_id = r.organization_id and d.disposition = 'HOLD_FOR_QA'
  join people c on c.id = run.collaborator_id and c.organization_id = r.organization_id
  -- Fuso da organização = fonte oficial (operations.timezone), mesmo fallback explícito do motor — nunca UTC silencioso.
  cross join lateral (select coalesce((select op.timezone from operations op where op.organization_id = r.organization_id order by op.created_at limit 1), '${DEFAULT_ORGANIZATION_TIMEZONE}') timezone) o
  left join teams t on t.id = coalesce(run.team_id, c.team_id)
  where r.organization_id = $1 and run.collaborator_id <> $2 and (
    run.collaborator_id in (select id from subordinates)
    or exists (select 1 from grants g where g.scope_type = 'ORGANIZATION')
    or exists (select 1 from grants g where g.scope_type = 'GROUP' and g.team_id = c.team_id)
    or exists (select 1 from grants g where g.scope_type = 'SUBGROUP' and g.subteam_id = c.subteam_id)
  )`

/**
 * V1.5.12 — itens do FEEDBACK CONFIÁVEL do Workflow (`reliable_feedback_item_reviews`) entram na MESMA fila, com o MESMO
 * escopo (colaborador do artefato) — todo item dessa tabela é, por construção, retido para QA (HOLD_FOR_QA).
 */
const SCOPED_FROM_RELIABLE = `from reliable_feedback_item_reviews r
  join reliable_feedback_artifacts a on a.id = r.artifact_id and a.organization_id = r.organization_id
  join people c on c.id = a.collaborator_id and c.organization_id = r.organization_id
  cross join lateral (select coalesce((select op.timezone from operations op where op.organization_id = r.organization_id order by op.created_at limit 1), '${DEFAULT_ORGANIZATION_TIMEZONE}') timezone) o
  left join teams t on t.id = c.team_id
  left join interactions i on i.id = a.interaction_id and i.organization_id = a.organization_id
  left join indicator_measurements m on m.id = a.indicator_measurement_id and m.organization_id = a.organization_id
  where r.organization_id = $1 and a.collaborator_id <> $2
    -- Retenção antiga encerrada/reprocessada (motor novo): o item pendente sai da fila; decisões já tomadas continuam no histórico.
    and not (a.superseded_at is not null and r.review_status = 'PENDING_REVIEW') and (
    a.collaborator_id in (select id from subordinates)
    or exists (select 1 from grants g where g.scope_type = 'ORGANIZATION')
    or exists (select 1 from grants g where g.scope_type = 'GROUP' and g.team_id = c.team_id)
    or exists (select 1 from grants g where g.scope_type = 'SUBGROUP' and g.subteam_id = c.subteam_id)
  )`

/** Fila UNIFICADA (feedback direto + feedback confiável do Workflow) — mesmas colunas, filtros e ordenação para os dois. */
const UNIFIED = `, unified as (
  select 'INTERACTION'::text origin, r.id, r.review_status, r.section, r.finding_kind, r.wording_source, r.interaction_label, r.reviewed_at, r.reviewed_by, run.collaborator_id, c.name collaborator_name, c.job_title,
         t.id team_id, t.name team_name, run.occurred_at, r.created_at, r.slot sort_key, o.timezone,
         d.disposition, d.structural_state, d.reasons, d.policy_version, d.autonomy_eligible, d.delivered_at
  ${SCOPED_FROM}
  union all
  select 'WORKFLOW'::text origin, r.id, r.review_status, r.section, r.item_kind, r.wording_source, r.subject_label, r.reviewed_at, r.reviewed_by, a.collaborator_id, c.name, c.job_title,
         t.id, t.name, coalesce(i.started_at, m.period_end), r.created_at, lpad(r.item_index::text, 4, '0'), o.timezone,
         'HOLD_FOR_QA', 'STRUCTURALLY_DELIVERABLE', r.review_required_by, coalesce(a.policy_version, ''), null::boolean, null::timestamptz
  ${SCOPED_FROM_RELIABLE}
)`

type QueueRow = {
  origin: "INTERACTION" | "WORKFLOW"
  id: string; review_status: ReviewStatus; section: "STRENGTH" | "OPPORTUNITY"; finding_kind: string; wording_source: "WRITER" | "FALLBACK"; interaction_label: string; reviewed_at: Date | null
  collaborator_id: string; collaborator_name: string; job_title: string | null; team_id: string | null; team_name: string | null; occurred_at: Date | null; created_at: Date; reviewer_name: string | null
  disposition: FeedbackDeliveryDecision["disposition"]; structural_state: FeedbackDeliveryDecision["structural"]; reasons: string[]; policy_version: string; autonomy_eligible: boolean | null; delivered_at: Date | null; total: string
}
const contextOf = (row: QueueRow) => ({
  collaborator: { id: row.collaborator_id, name: row.collaborator_name, jobTitle: row.job_title },
  team: row.team_id && row.team_name ? { id: row.team_id, name: row.team_name } : null,
  occurredAt: row.occurred_at,
  createdAt: row.created_at,
  reviewerName: row.reviewer_name,
  // No feedback confiável o primeiro "motivo" gravado é a versão da política — só os motivos vão à tela.
  selection: { decision: { disposition: row.disposition, structural: row.structural_state, reasons: (row.origin === "WORKFLOW" ? row.reasons.filter((reason) => reason !== row.policy_version) : row.reasons) as FeedbackDeliveryDecision["reasons"], policyVersion: row.policy_version, autonomyEligible: row.autonomy_eligible }, deliveredAt: row.delivered_at },
})

export function createPostgresFeedbackReviewReader(db: Queryable): FeedbackReviewReader {
  const store = createPostgresInteractionFeedbackStore(db)
  return {
    async grantsOf(viewer: ReviewViewer, permission: QaPermission) {
      const result = await db.query<{ scope_type: QaGrantScope["scopeType"]; team_id: string | null; subteam_id: string | null }>(
        `${SCOPE_CTE} select scope_type, team_id, subteam_id from grants`,
        [viewer.organizationId, viewer.personId, rolesWithPermission(permission)],
      )
      return result.rows.map((row) => ({ scopeType: row.scope_type, teamId: row.team_id, subteamId: row.subteam_id }))
    },

    async listQueue(viewer: ReviewViewer, filters: ReviewQueueFilters) {
      const params: unknown[] = [viewer.organizationId, viewer.personId, rolesWithPermission("feedback_quality_review.view")]
      const where: string[] = []
      const add = (sql: string, value: unknown) => { params.push(value); where.push(sql.replace("?", `$${params.length}`)) }
      if (filters.status !== "ALL") add("q.review_status = ?", filters.status)
      if (filters.search) add("position(lower(?) in lower(q.collaborator_name)) > 0", filters.search)
      if (filters.collaboratorId) add("q.collaborator_id = ?::uuid", filters.collaboratorId)
      if (filters.teamId) add("q.team_id = ?::uuid", filters.teamId)
      if (filters.section) add("q.section = ?", filters.section)
      if (filters.from) add("(coalesce(q.occurred_at, q.created_at) at time zone q.timezone)::date >= ?::date", filters.from)
      if (filters.to) add("(coalesce(q.occurred_at, q.created_at) at time zone q.timezone)::date <= ?::date", filters.to)
      const extra = where.length ? ` where ${where.join(" and ")}` : ""
      params.push(filters.pageSize, (filters.page - 1) * filters.pageSize)
      const [page, options] = await Promise.all([
        db.query<QueueRow>(
          `${SCOPE_CTE}${UNIFIED}
           select q.*, null::text reviewer_name, count(*) over() total from unified q${extra}
           order by (q.review_status = 'PENDING_REVIEW') desc, coalesce(q.occurred_at, q.created_at) desc, q.sort_key, q.id
           limit $${params.length - 1} offset $${params.length}`,
          params,
        ),
        // Opções de filtro = quem/qual equipe TEM item de QA no escopo (nunca a organização inteira).
        db.query<{ kind: "C" | "T"; id: string; name: string }>(
          `${SCOPE_CTE}${UNIFIED}
           select distinct 'C'::text kind, q.collaborator_id id, q.collaborator_name name from unified q
           union
           select distinct 'T'::text kind, q.team_id, q.team_name from unified q where q.team_id is not null
           order by 3`,
          [viewer.organizationId, viewer.personId, rolesWithPermission("feedback_quality_review.view")],
        ),
      ])
      return {
        rows: page.rows.map((row) => ({ record: { origin: row.origin, id: row.id, reviewStatus: row.review_status, section: row.section, findingKind: row.finding_kind, wordingSource: row.wording_source, interactionLabel: row.interaction_label, reviewedAt: row.reviewed_at }, context: contextOf(row) })),
        total: Number(page.rows[0]?.total ?? 0),
        filterOptions: { collaborators: options.rows.filter((row) => row.kind === "C").map(({ id, name }) => ({ id, name })), teams: options.rows.filter((row) => row.kind === "T").map(({ id, name }) => ({ id, name })) },
      }
    },

    async loadInScope(viewer: ReviewViewer, reviewId: string, permission: QaPermission = "feedback_quality_review.view") {
      const scoped = await db.query<QueueRow>(
        `${SCOPE_CTE}${UNIFIED}
         select q.*, rv.name reviewer_name from unified q left join people rv on rv.id = q.reviewed_by where q.id = $4`,
        [viewer.organizationId, viewer.personId, rolesWithPermission(permission), reviewId],
      )
      const row = scoped.rows[0]
      if (!row) return null
      if (row.origin === "WORKFLOW") {
        const record = await findReliableReview(db, viewer.organizationId, reviewId)
        if (!record) return null
        // V1.7.1e — o feedback completo daquela análise (prévia + navegação entre os pontos); o escopo é o da revisão pedida.
        const analysis = await findReliableAnalysis(db, viewer.organizationId, record.artifactId)
        return { origin: "WORKFLOW" as const, record, context: contextOf(row), knowledge: [], analysis: analysis ? { artifact: analysis.artifact, reviews: analysis.reviews } : null }
      }
      const record = await store.getItemReview(viewer.organizationId, reviewId)
      if (!record) return null
      // Material de apoio: a 077 liga recomendação → ocorrência → run, mas NÃO → item revisado; e hoje só existe recomendação
      // para divergência procedimental, que nunca vira item de QA. Juntar pela interação traria conteúdo procedimental
      // bloqueado para esta tela — por isso nada é juntado por aproximação (vínculo por item = evolução futura).
      return { origin: "INTERACTION" as const, record, context: contextOf(row), knowledge: [] }
    },
  }
}
