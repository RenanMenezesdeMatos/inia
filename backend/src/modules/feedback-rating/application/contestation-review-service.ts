import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { SqlParams } from "../../../shared/infrastructure/sql-params.js"
import { scopedPeopleSql } from "../../access/application/scope-people-reader.js"
import { rolesWithPermission } from "../../access/domain/roles.js"
import type { FeedbackSourceKind } from "../../feedback-application/domain/feedback-application.js"
import {
  CONTESTATION_AUDIT_ENTITY,
  CONTESTATION_DECISION_LABELS,
  CONTESTATION_REASON_LABELS,
  type ContestationDecision,
  type ContestationOrigin,
  type ContestationReason,
  type ContestationReviewInput,
  type ReadAgreementValue,
} from "../domain/feedback-rating.js"
import { transactionRunner } from "../../../shared/infrastructure/database/transaction.js"

/**
 * REVISÃO DAS CONTESTAÇÕES (migrations 150 e 186): a fila das contestações dos colaboradores do ESCOPO de quem revisa (permissão
 * `feedback_contestations.review`, mesma regra de alcance das demais telas — organização, Grupo, Subgrupo ou Minha estrutura) e a
 * resposta a cada uma. Contestação = a visão `feedback_contestations`: a discordância registrada na ciência (origem
 * READ_AGREEMENT) e a avaliação "não foi útil" antiga (USEFULNESS_RATING). Ninguém revisa a própria contestação. A resposta nunca
 * altera o feedback.
 */
type Queryable = Pick<Database, "query">
export type Reviewer = { organizationId: string; personId: string }
export type ContestationStatus = "PENDING" | "ANSWERED"

export type ContestationItem = {
  id: string
  origin: ContestationOrigin
  status: ContestationStatus
  reason: ContestationReason
  comment: string
  contestedAt: string
  collaborator: { personId: string; name: string; teamName: string | null; subteamName: string | null }
  feedback: { kind: FeedbackSourceKind; id: string; feedbackKind: string | null; impactedIndicator: string | null; publishedAt: string | null }
  review: { decision: ContestationDecision; response: string; reviewerName: string; respondedAt: string } | null
}

export type ContestationDetail = ContestationItem & {
  /** O que a INIA disse no feedback contestado — os campos publicáveis, como foram publicados. */
  content: { observedBehavior: string | null; evidenceFound: string | null; relatedProcedure: string | null; recommendation: string | null } | null
  /** Avaliação antiga: a escolha que o colaborador registrou DEPOIS, ao confirmar a ciência do mesmo feedback (contexto). */
  laterAgreement: { value: ReadAgreementValue; recordedAt: string } | null
}

export type ContestationListQuery = {
  status?: ContestationStatus | undefined
  origin?: ContestationOrigin | undefined
  reason?: ContestationReason | undefined
  search?: string | undefined
  page: number
  pageSize: number
}

const PERMISSION = "feedback_contestations.review" as const

type Row = {
  id: string
  origin: ContestationOrigin
  reason: ContestationReason
  comment: string
  created_at: Date
  source_kind: FeedbackSourceKind
  feedback_id: string | null
  interaction_delivery_id: string | null
  person_id: string
  person_name: string
  team_name: string | null
  subteam_name: string | null
  feedback_kind: string | null
  impacted_indicator: string | null
  published_at: Date | null
  review_decision: ContestationDecision | null
  review_response: string | null
  review_created_at: Date | null
  reviewer_name: string | null
  observed_behavior?: string | null
  evidence_found?: string | null
  related_procedure?: string | null
  recommendation?: string | null
  later_agreement?: ReadAgreementValue | null
  later_agreement_at?: Date | null
  total?: number
}

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString())

function toItem(row: Row): ContestationItem {
  return {
    id: row.id,
    origin: row.origin,
    status: row.review_decision ? "ANSWERED" : "PENDING",
    reason: row.reason,
    comment: row.comment,
    contestedAt: iso(row.created_at)!,
    collaborator: { personId: row.person_id, name: row.person_name, teamName: row.team_name, subteamName: row.subteam_name },
    feedback: { kind: row.source_kind, id: (row.feedback_id ?? row.interaction_delivery_id)!, feedbackKind: row.feedback_kind, impactedIndicator: row.impacted_indicator, publishedAt: iso(row.published_at) },
    review: row.review_decision && row.review_response && row.review_created_at ? { decision: row.review_decision, response: row.review_response, reviewerName: row.reviewer_name ?? "", respondedAt: iso(row.review_created_at)! } : null,
  }
}

/**
 * Base da fila: contestações VIGENTES (a avaliação antiga que o colaborador não retirou nem trocou; toda discordância) ou já
 * respondidas, de pessoas do escopo do revisor, nunca as dele mesmo.
 */
function baseSql(p: SqlParams, reviewer: Reviewer): string {
  const org = p.typed(reviewer.organizationId, "uuid")
  const viewer = p.typed(reviewer.personId, "uuid")
  return `from feedback_contestations r
    join people pe on pe.id = r.person_id
    left join teams t on t.id = pe.team_id
    left join subteams st on st.id = pe.subteam_id
    left join feedbacks f on f.id = r.feedback_id
    left join people rp on rp.id = r.reviewer_person_id
   where r.organization_id = ${org} and r.person_id <> ${viewer}
     and (r.superseded_at is null or r.review_id is not null)
     and r.person_id in (${scopedPeopleSql(p, { organizationId: reviewer.organizationId, viewerPersonId: reviewer.personId, permission: PERMISSION })})`
}

const SELECT = `select r.id, r.origin, r.reason, r.comment, r.created_at, r.source_kind, r.feedback_id, r.interaction_delivery_id,
    pe.id person_id, pe.name person_name, t.name team_name, st.name subteam_name,
    f.feedback_kind::text feedback_kind, f.impacted_indicator, f.published_at,
    r.review_decision, r.review_response, r.review_created_at, rp.name reviewer_name`

export async function listContestations(db: Queryable, reviewer: Reviewer, query: ContestationListQuery): Promise<{ items: ContestationItem[]; total: number; pendingCount: number }> {
  const p = new SqlParams()
  const base = baseSql(p, reviewer)
  const filters: string[] = []
  if (query.status === "PENDING") filters.push("r.review_id is null")
  if (query.status === "ANSWERED") filters.push("r.review_id is not null")
  if (query.origin) filters.push(`r.origin = ${p.add(query.origin)}`)
  if (query.reason) filters.push(`r.reason = ${p.add(query.reason)}`)
  if (query.search?.trim()) filters.push(`pe.name ilike ${p.add(`%${query.search.trim().replace(/[\\%_]/g, (character) => `\\${character}`)}%`)}`)
  const where = filters.length > 0 ? ` and ${filters.join(" and ")}` : ""
  const limit = p.add(query.pageSize)
  const offset = p.add((query.page - 1) * query.pageSize)
  // Sem resposta primeiro (é o que pede ação), depois as mais recentes.
  const result = await db.query<Row>(
    `${SELECT}, count(*) over()::int total ${base}${where}
     order by (r.review_id is null) desc, r.created_at desc, r.id
     limit ${limit} offset ${offset}`,
    p.values,
  )
  const pendingParams = new SqlParams()
  const pending = await db.query<{ n: number }>(`select count(*)::int n ${baseSql(pendingParams, reviewer)} and r.review_id is null`, pendingParams.values)
  return { items: result.rows.map(toItem), total: result.rows[0]?.total ?? 0, pendingCount: pending.rows[0]?.n ?? 0 }
}

const notFound = () => new DomainError("Contestação não encontrada.", "FEEDBACK_CONTESTATION_NOT_FOUND", 404)

export async function getContestation(db: Queryable, reviewer: Reviewer, contestationId: string): Promise<ContestationDetail> {
  const p = new SqlParams()
  const base = baseSql(p, reviewer)
  // Escolha registrada depois na ciência do mesmo feedback (só faz sentido para a avaliação antiga).
  const result = await db.query<Row>(
    `${SELECT}, f.observed_behavior, f.evidence_found, f.related_procedure, f.recommendation, la.agreement later_agreement, la.created_at later_agreement_at
     ${base.replace("left join people rp on rp.id = r.reviewer_person_id", `left join people rp on rp.id = r.reviewer_person_id
    left join feedback_read_agreements la on r.origin = 'USEFULNESS_RATING' and la.organization_id = r.organization_id and la.person_id = r.person_id
      and (la.feedback_id = r.feedback_id or la.interaction_delivery_id = r.interaction_delivery_id)`)} and r.id = ${p.typed(contestationId, "uuid")}`,
    p.values,
  )
  const row = result.rows[0]
  if (!row) throw notFound()
  const content = row.feedback_id
    ? { observedBehavior: row.observed_behavior ?? null, evidenceFound: row.evidence_found ?? null, relatedProcedure: row.related_procedure ?? null, recommendation: row.recommendation ?? null }
    : null
  const laterAgreement = row.later_agreement && row.later_agreement_at ? { value: row.later_agreement, recordedAt: iso(row.later_agreement_at)! } : null
  return { ...toItem(row), content, laterAgreement }
}

const inTransaction = transactionRunner("contestation_review")

const preview = (text: string, size: number) => (text.length > size ? `${text.slice(0, size - 1).trimEnd()}…` : text)

/**
 * Responde a contestação: grava a revisão (uma por contestação, apontando para a avaliação antiga OU para a discordância),
 * audita, avisa o colaborador e encerra os avisos dos revisores. Já respondida (outra pessoa, outra aba) = 409; avaliação antiga
 * retirada pelo colaborador = 409; fora do escopo = 404.
 */
export async function reviewContestation(db: Database, reviewer: Reviewer, contestationId: string, input: ContestationReviewInput, now: Date): Promise<ContestationDetail> {
  await inTransaction(db, async (client) => {
    const p = new SqlParams()
    const base = baseSql(p, reviewer)
    const visible = await client.query<{ id: string; origin: ContestationOrigin; person_id: string; source_kind: FeedbackSourceKind; feedback_id: string | null; interaction_delivery_id: string | null; reviewed: boolean; superseded: boolean }>(
      `select r.id, r.origin, r.person_id, r.source_kind, r.feedback_id, r.interaction_delivery_id, r.review_id is not null reviewed, r.superseded_at is not null superseded
       ${base} and r.id = ${p.typed(contestationId, "uuid")}`,
      p.values,
    )
    const contestation = visible.rows[0]
    if (!contestation) throw notFound()
    if (contestation.reviewed) throw new DomainError("Esta contestação já foi respondida.", "FEEDBACK_CONTESTATION_ALREADY_REVIEWED", 409)
    if (contestation.superseded) throw new DomainError("O colaborador retirou ou mudou esta avaliação.", "FEEDBACK_CONTESTATION_WITHDRAWN", 409)
    const target = contestation.origin === "READ_AGREEMENT" ? "agreement_id" : "rating_id"
    try {
      await client.query(
        `insert into feedback_rating_reviews (organization_id, ${target}, reviewer_person_id, decision, response, created_at) values ($1, $2, $3, $4, $5, $6)`,
        [reviewer.organizationId, contestation.id, reviewer.personId, input.decision, input.response, now],
      )
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new DomainError("Esta contestação já foi respondida.", "FEEDBACK_CONTESTATION_ALREADY_REVIEWED", 409)
      throw error
    }
    const sourceId = contestation.feedback_id ?? contestation.interaction_delivery_id
    await client.query(
      `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload, created_at)
       values ($1, $2, 'FEEDBACK_CONTESTATION_REVIEWED', $3, $4, $5, $6)`,
      [
        reviewer.organizationId,
        reviewer.personId,
        CONTESTATION_AUDIT_ENTITY[contestation.origin],
        contestation.id,
        JSON.stringify({ decision: input.decision, origin: contestation.origin, collaboratorId: contestation.person_id, source: { kind: contestation.source_kind, id: sourceId } }),
        now,
      ],
    )
    await client.query(
      `insert into alerts (organization_id, recipient_id, title, description, severity, alert_type, dedupe_key, created_at)
       values ($1, $2, 'Sua contestação foi respondida', $3, 'INFO', 'FEEDBACK_CONTESTATION_ANSWERED', $4, $5)
       on conflict (dedupe_key) do nothing`,
      [reviewer.organizationId, contestation.person_id, `${CONTESTATION_DECISION_LABELS[input.decision]}: ${preview(input.response, 140)}`, `feedback_contestation_answer:${contestation.id}:${sourceId}`, now],
    )
    await resolveContestationAlerts(client, reviewer.organizationId, contestation.id, now)
  })
  return getContestation(db, reviewer, contestationId)
}

/** Avisos "contestação recebida" desta contestação deixam de pedir ação (respondida). */
export async function resolveContestationAlerts(db: Queryable, organizationId: string, contestationId: string, now: Date): Promise<void> {
  await db.query(
    `update alerts set status = 'RESOLVED', resolved_at = $3 where organization_id = $1 and dedupe_key like $2 and status <> 'RESOLVED'`,
    [organizationId, `feedback_contestation:${contestationId}:%`, now],
  )
}

/**
 * Quem revisa as contestações DESTE colaborador: contas ativas com a permissão numa atribuição que o alcança — organização,
 * Grupo/Subgrupo dele, ou "Minha estrutura" de alguém acima dele na cadeia (reports_to). Nunca ele mesmo.
 */
export async function contestationReviewersOf(db: Queryable, organizationId: string, collaboratorId: string): Promise<string[]> {
  const result = await db.query<{ person_id: string }>(
    `with recursive target as (select id, team_id, subteam_id from people where id = $2 and organization_id = $1),
       up(id, depth) as (
         select p.reports_to_id, 1 from people p where p.id = $2 and p.reports_to_id is not null
         union select p.reports_to_id, u.depth + 1 from people p join up u on p.id = u.id where p.reports_to_id is not null and u.depth < 32
       )
     select distinct ua.person_id from access_role_assignments a
       join user_accounts ua on ua.id = a.user_account_id and ua.organization_id = a.organization_id and ua.active
       join people holder on holder.id = ua.person_id and holder.active
       cross join target
      where a.organization_id = $1 and a.revoked_at is null and a.role_code = any($3::text[]) and ua.person_id <> $2
        and (a.scope_type = 'ORGANIZATION'
          or (a.scope_type = 'GROUP' and a.team_id = target.team_id)
          or (a.scope_type = 'SUBGROUP' and a.subteam_id = target.subteam_id)
          or (a.scope_type = 'MY_STRUCTURE' and ua.person_id in (select id from up)))
      order by ua.person_id`,
    [organizationId, collaboratorId, rolesWithPermission(PERMISSION)],
  )
  return result.rows.map((row) => row.person_id)
}

/**
 * Aviso no sino de cada revisor quando chega uma contestação (o texto vai resumido; o detalhe abre na Administração). A chave
 * `feedback_contestation:<contestação>:<revisor>` é a mesma para as duas origens (o sino leva à contestação pelo id).
 */
export async function notifyContestationReviewers(
  db: Queryable,
  input: { organizationId: string; contestationId: string; origin: ContestationOrigin; collaboratorId: string; reason: ContestationReason; text: string; now: Date },
): Promise<number> {
  const reviewers = await contestationReviewersOf(db, input.organizationId, input.collaboratorId)
  if (reviewers.length === 0) return 0
  const name = (await db.query<{ name: string }>(`select name from people where id = $1`, [input.collaboratorId])).rows[0]?.name ?? "Um colaborador"
  const label = CONTESTATION_REASON_LABELS[input.reason]
  const description =
    input.origin === "READ_AGREEMENT"
      ? `${name} não concordou com um feedback (“${label}”): ${preview(input.text, 140)}`
      : `${name} marcou um feedback como “${label}”: ${preview(input.text, 140)}`
  await db.query(
    `insert into alerts (organization_id, recipient_id, title, description, severity, alert_type, dedupe_key, created_at)
     select $1, reviewer, 'Contestação de feedback para responder', $2, 'MEDIUM', 'FEEDBACK_CONTESTATION_RECEIVED', 'feedback_contestation:' || $3 || ':' || reviewer, $4
       from unnest($5::uuid[]) reviewer
     on conflict (dedupe_key) do nothing`,
    [input.organizationId, description, input.contestationId, input.now, reviewers],
  )
  return reviewers.length
}
