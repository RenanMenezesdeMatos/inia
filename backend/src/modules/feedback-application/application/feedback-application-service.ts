import { createHash } from "node:crypto"
import type { PoolClient } from "pg"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { appendConversationMessage, loadConversationContextTurns } from "../../assistant/application/assistant-conversations.js"
import { resolveAccessibleKnowledgeMaterials } from "../../knowledge/application/knowledge-material-access.js"
import { buildKnowledgeMaterialHref } from "../../knowledge/domain/material-href.js"
import { resolveFeedbackViewsForViewer } from "../../reliable-feedback/application/feedback-view-access.js"
import type { FeedbackView } from "../../reliable-feedback/domain/feedback-view.js"
import { visibleInFollowUpSql } from "../../feedbacks/application/follow-up-visibility.js"
import { toCollaboratorFeedbackView } from "../../interaction-feedback/domain/collaborator-feedback-view.js"
import { createPostgresFeedbackDeliveryStore } from "../../interaction-feedback/infrastructure/postgres-feedback-delivery-store.js"
import { loadPersonPresentation } from "../../profile-preferences/application/person-presentation-loader.js"
import { addressNameOf } from "../../profile-preferences/domain/person-presentation.js"
import { APPLICATION_PRESENTATION_VERSION, buildApplicationPresentation, renderApplicationInstruction, type ApplicationPresentation, type FollowUpInstructionInput } from "../domain/application-presentation.js"
import { consultationOf, type FeedbackConsultation } from "../domain/session-consultation.js"
import {
  completeTransition,
  FEEDBACK_INVITE_WINDOW_DAYS,
  INVITE_RESOLUTION,
  pauseTransition,
  pickInvite,
  presentationEventAccepted,
  startTransition,
  type FeedbackApplicationStatus,
  type FeedbackSourceKind,
  type FeedbackSourceRef,
  type InviteEvent,
  type InviteResolution,
  type PresentationEvent,
} from "../domain/feedback-application.js"
import {
  buildDeliveredFeedbackContext,
  buildPublishedFeedbackContext,
  civilDay,
  DEFAULT_TIME_ZONE,
  HISTORICAL_CONTEXT_VERSION,
  publishedViewOf,
  registeredSubjectOf,
  registeredWhenOf,
  type FeedbackHistoricalContext,
  type HistoricalIndicator,
} from "../domain/historical-context.js"

/**
 * Persistência e regras de execução da APLICAÇÃO DE FEEDBACK (migration 103). O destinatário vem SEMPRE da sessão; a fonte é
 * resolvida e autorizada aqui (organização + destinatário + publicado/entregue + visível) — nunca a partir do texto do card
 * enviado pelo navegador. Fonte de outra pessoa/organização = 404, sem distinguir.
 *
 * Idempotência: iniciar roda sob um lock transacional POR FONTE; a unique por fonte garante no banco uma aplicação por
 * feedback. Clique repetido, retentativa, recarregar e outra aba devolvem a MESMA aplicação (e a mesma conversa).
 */
type Queryable = Pick<Database, "query">
export type ApplicationScope = { organizationId: string; personId: string }

export type FeedbackApplicationView = {
  id: string
  source: FeedbackSourceRef
  status: FeedbackApplicationStatus
  conversationId: string | null
  /** Conversa COMPLEMENTAR ativa (dúvidas depois da conclusão) — só existe depois da primeira dúvida. */
  followUpConversationId: string | null
  title: string | null
  periodLabel: string | null
  publishedDay: string | null
  historical: boolean
  startedAt: string | null
  lastOpenedAt: string | null
  pausedAt: string | null
  completedAt: string | null
  /** Fatos da reprodução do áudio — nunca decidem a conclusão. */
  presentation: { startedAt: string | null; completedAt: string | null; interruptedAt: string | null; playCount: number }
  invite: { offeredAt: string | null; resolvedAt: string | null; resolution: InviteResolution | null }
  sourceVersion: number | null
  /** Ciência da FONTE (feedback publicado ou entrega) — a confirmação com login e senha (read-confirmation-service). */
  acknowledgedAt: string | null
}

/**
 * CONTEÚDO do feedback exibido na sessão — o registro aplicado, nunca dado atual. `view` = a apresentação publicada (feedback V2 /
 * motor) na MESMA versão aplicada, com os materiais resolvidos para quem lê: o mesmo formato do Acompanhamento. Sem ela (feedback
 * anterior à apresentação detalhada, feedback de atendimento ou versão corrigida depois), o texto e as seções do registro congelado.
 */
export type FeedbackApplicationContent = {
  view: FeedbackView | null
  text: string
  summary: string | null
  indicators: HistoricalIndicator[]
  evidence: string[]
  guidance: string[]
  strengths: string[]
  materials: { documentId: string; title: string; sections: string[]; reason: string | null; href: string | null }[]
}

export type FeedbackApplicationDetail = FeedbackApplicationView & {
  script: Pick<ApplicationPresentation, "chatText" | "speechText" | "speechTruncated" | "suggestions"> | null
  limitations: string[]
  /** O feedback publicado recebeu uma versão nova DEPOIS que esta aplicação começou (a conversa continua sobre a versão aplicada). */
  sourceCorrected: boolean
  content: FeedbackApplicationContent | null
}

type ApplicationRow = {
  id: string
  organization_id: string
  recipient_person_id: string
  source_kind: FeedbackSourceKind
  feedback_id: string | null
  interaction_delivery_id: string | null
  source_version: number | null
  status: FeedbackApplicationStatus
  conversation_id: string | null
  context: FeedbackHistoricalContext | null
  presentation: ApplicationPresentation | null
  started_at: Date | null
  last_opened_at: Date | null
  paused_at: Date | null
  completed_at: Date | null
  presentation_started_at: Date | null
  presentation_completed_at: Date | null
  presentation_interrupted_at: Date | null
  presentation_play_count: number
  invite_offered_at: Date | null
  invite_resolved_at: Date | null
  invite_resolution: InviteResolution | null
  source_acknowledged_at: Date | null
  current_source_version?: number | null
  follow_up_conversation_id?: string | null
}
const COLUMNS = `a.id, a.organization_id, a.recipient_person_id, a.source_kind, a.feedback_id, a.interaction_delivery_id, a.source_version, a.status, a.conversation_id, a.context, a.presentation,
  a.started_at, a.last_opened_at, a.paused_at, a.completed_at, a.presentation_started_at, a.presentation_completed_at, a.presentation_interrupted_at, a.presentation_play_count,
  a.invite_offered_at, a.invite_resolved_at, a.invite_resolution,
  coalesce((select f.acknowledged_at from feedbacks f where f.id = a.feedback_id), (select x.acknowledged_at from interaction_feedback_deliveries x where x.id = a.interaction_delivery_id)) source_acknowledged_at`
/** Conversa complementar ATIVA da aplicação (a mais recente). */
const FOLLOW_UP_COLUMN = `(select x.conversation_id from feedback_application_followups x join assistant_conversations fc on fc.id = x.conversation_id
    where x.application_id = a.id and fc.status = 'ACTIVE' order by x.created_at desc limit 1) follow_up_conversation_id`
const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null)
const sourceOf = (row: Pick<ApplicationRow, "source_kind" | "feedback_id" | "interaction_delivery_id">): FeedbackSourceRef => ({ kind: row.source_kind, id: (row.source_kind === "PUBLISHED_FEEDBACK" ? row.feedback_id : row.interaction_delivery_id)! })

function toView(row: ApplicationRow): FeedbackApplicationView {
  return {
    id: row.id,
    source: sourceOf(row),
    status: row.status,
    conversationId: row.conversation_id,
    followUpConversationId: row.follow_up_conversation_id ?? null,
    title: row.presentation?.title ?? null,
    periodLabel: row.presentation?.periodLabel ?? null,
    publishedDay: row.presentation?.publishedDay ?? null,
    historical: row.presentation?.historical ?? false,
    startedAt: iso(row.started_at),
    lastOpenedAt: iso(row.last_opened_at),
    pausedAt: iso(row.paused_at),
    completedAt: iso(row.completed_at),
    presentation: { startedAt: iso(row.presentation_started_at), completedAt: iso(row.presentation_completed_at), interruptedAt: iso(row.presentation_interrupted_at), playCount: row.presentation_play_count },
    invite: { offeredAt: iso(row.invite_offered_at), resolvedAt: iso(row.invite_resolved_at), resolution: row.invite_resolution },
    sourceVersion: row.source_version,
    acknowledgedAt: iso(row.source_acknowledged_at),
  }
}

/** Conteúdo exibido na sessão (ver `FeedbackApplicationContent`): o registro aplicado, com links só para material acessível a quem lê. */
async function contentOf(db: Queryable, scope: ApplicationScope, row: ApplicationRow): Promise<FeedbackApplicationContent | null> {
  const context = row.context
  if (!context) return null
  const viewer = { personId: scope.personId }
  let view: FeedbackView | null = null
  if (row.source_kind === "PUBLISHED_FEEDBACK" && row.feedback_id) {
    // Formato publicado só na MESMA versão aplicada: se o feedback foi corrigido depois, vale o registro congelado.
    const published = (
      await db.query<{ view: unknown }>(
        `select coalesce(f.context_snapshot->'feedbackEngine'->'feedbackView', f.context_snapshot->'reliableFeedback'->'feedbackView') view
           from feedbacks f where f.id = $1 and f.organization_id = $2 and f.operator_id = $3 and f.version is not distinct from $4`,
        [row.feedback_id, scope.organizationId, scope.personId, row.source_version],
      )
    ).rows[0]
    if (published?.view) view = (await resolveFeedbackViewsForViewer(db, { organizationId: scope.organizationId, viewer, views: [published.view] }))[0] ?? null
  }
  const materialIds = [...new Set(context.materials.map((material) => material.documentId))]
  const accessible = materialIds.length > 0 ? await resolveAccessibleKnowledgeMaterials(db, { organizationId: scope.organizationId, viewer, materialIds }) : new Map()
  return {
    view,
    text: context.publishedText,
    summary: context.summary,
    indicators: context.indicators,
    evidence: context.evidence,
    guidance: context.guidance,
    strengths: context.strengths,
    materials: context.materials.map((material) => ({ ...material, href: accessible.has(material.documentId) ? buildKnowledgeMaterialHref(material.documentId) : null })),
  }
}

async function toDetail(db: Queryable, scope: ApplicationScope, row: ApplicationRow): Promise<FeedbackApplicationDetail> {
  const presentation = row.presentation
  return {
    ...toView(row),
    script: presentation ? { chatText: presentation.chatText, speechText: presentation.speechText, speechTruncated: presentation.speechTruncated, suggestions: presentation.suggestions } : null,
    limitations: row.context?.limitations ?? [],
    sourceCorrected: row.source_version !== null && row.current_source_version !== undefined && row.current_source_version !== null && row.current_source_version > row.source_version,
    content: await contentOf(db, scope, row),
  }
}

async function inTransaction<T>(db: Database, work: (client: Queryable) => Promise<T>): Promise<T> {
  if (typeof (db as Partial<PoolClient>).release === "function") {
    const client = db as unknown as PoolClient
    await client.query("savepoint feedback_application")
    try {
      const result = await work(client)
      await client.query("release savepoint feedback_application")
      return result
    } catch (error) {
      await client.query("rollback to savepoint feedback_application").catch(() => {})
      throw error
    }
  }
  const client = await db.connect()
  try {
    await client.query("begin")
    const result = await work(client)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback").catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

const notFound = () => new DomainError("Feedback não encontrado.", "FEEDBACK_APPLICATION_SOURCE_NOT_FOUND", 404)
const applicationNotFound = () => new DomainError("Aplicação de feedback não encontrada.", "FEEDBACK_APPLICATION_NOT_FOUND", 404)
const sourceColumn = (kind: FeedbackSourceKind) => (kind === "PUBLISHED_FEEDBACK" ? "feedback_id" : "interaction_delivery_id")

export async function organizationTimeZone(db: Queryable, organizationId: string): Promise<string> {
  const row = (await db.query<{ timezone: string | null }>(`select timezone from operations where organization_id = $1 order by created_at limit 1`, [organizationId])).rows[0]
  return row?.timezone ?? DEFAULT_TIME_ZONE
}

// ---------------------------------------------------------------------------------------------
// Fontes autorizadas
// ---------------------------------------------------------------------------------------------

type LoadedSource = { context: FeedbackHistoricalContext; view: ReturnType<typeof publishedViewOf>; version: number | null; publishedAt: Date; acknowledged: boolean }

/** Feedback PUBLICADO do próprio destinatário, visível no Acompanhamento — exatamente como gravado na publicação. */
async function loadPublishedSource(db: Queryable, scope: ApplicationScope, feedbackId: string, now: Date, timeZone: string): Promise<LoadedSource | null> {
  const row = (
    await db.query<{
      id: string; version: number; feedback_kind: "MONITORING" | "INDICATOR"; published_at: Date | null; created_at: Date; impacted_indicator: string; evidence_found: string; observed_behavior: string
      related_procedure: string; recommendation: string; suggested_approach: string | null; case_id: string; case_title: string | null; case_summary: string | null; context_snapshot: Record<string, unknown> | null; acknowledged_at: Date | null
    }>(
      `select f.id, f.version, f.feedback_kind, f.published_at, f.created_at, f.impacted_indicator, f.evidence_found, f.observed_behavior, f.related_procedure, f.recommendation, f.suggested_approach,
              f.case_id, c.title case_title, c.summary case_summary, f.context_snapshot, f.acknowledged_at
         from feedbacks f left join supervision_cases c on c.id = f.case_id
        where f.id = $1 and f.organization_id = $2 and f.operator_id = $3 and f.status = 'PUBLISHED' and ${visibleInFollowUpSql("f")}`,
      [feedbackId, scope.organizationId, scope.personId],
    )
  ).rows[0]
  if (!row) return null
  const materials = await db.query<{ knowledge_document_id: string; title: string; reason: string }>(
    `select m.knowledge_document_id, d.title, m.reason from feedback_support_materials m join knowledge_documents d on d.id = m.knowledge_document_id where m.feedback_id = $1 and m.organization_id = $2 order by m.position`,
    [feedbackId, scope.organizationId],
  )
  const publishedAt = new Date(row.published_at ?? row.created_at)
  const snapshot = row.context_snapshot ?? {}
  const context = buildPublishedFeedbackContext(
    {
      feedbackId: row.id,
      version: row.version,
      kind: row.feedback_kind,
      publishedAt,
      impactedIndicator: row.impacted_indicator,
      evidenceFound: row.evidence_found,
      observedBehavior: row.observed_behavior,
      relatedProcedure: row.related_procedure,
      recommendation: row.recommendation,
      suggestedApproach: row.suggested_approach,
      caseId: row.case_id,
      caseTitle: row.case_title,
      caseSummary: row.case_summary,
      snapshot,
      supportMaterials: materials.rows.map((material) => ({ documentId: material.knowledge_document_id, title: material.title, reason: material.reason })),
    },
    now,
    timeZone,
  )
  return { context, view: publishedViewOf(snapshot), version: row.version, publishedAt, acknowledged: row.acknowledged_at !== null }
}

/** Feedback de atendimento ENTREGUE ao próprio destinatário — a mesma projeção (já mascarada) do Acompanhamento. */
async function loadDeliveredSource(db: Queryable, scope: ApplicationScope, deliveryId: string, now: Date): Promise<LoadedSource | null> {
  const rows = await createPostgresFeedbackDeliveryStore(db).listForCollaborator(scope.organizationId, scope.personId)
  const row = rows.find((candidate) => candidate.delivery.id === deliveryId)
  if (!row) return null
  const view = toCollaboratorFeedbackView({ deliveryId: row.delivery.id, section: row.section, wording: row.wording, writerItem: row.writerItem, interactionLabel: row.interactionLabel, occurredAt: row.occurredAt, deliveredAt: row.delivery.deliveredAt, acknowledgedAt: row.delivery.acknowledgedAt })
  const context = buildDeliveredFeedbackContext({ deliveryId: view.id, title: view.title, sectionLabel: view.sectionLabel, section: view.section, interactionLabel: view.interactionLabel, interactionAt: view.interactionAt, deliveredAt: view.deliveredAt, blocks: view.blocks, evidence: view.evidence }, now)
  return { context, view: null, version: null, publishedAt: new Date(view.deliveredAt), acknowledged: view.acknowledgedAt !== null }
}

async function loadAuthorizedSource(db: Queryable, scope: ApplicationScope, source: FeedbackSourceRef, now: Date, timeZone: string): Promise<LoadedSource> {
  const loaded = source.kind === "PUBLISHED_FEEDBACK" ? await loadPublishedSource(db, scope, source.id, now, timeZone) : await loadDeliveredSource(db, scope, source.id, now)
  if (!loaded) throw notFound()
  return loaded
}

async function findBySource(db: Queryable, scope: ApplicationScope, source: FeedbackSourceRef, lock = false): Promise<ApplicationRow | null> {
  const result = await db.query<ApplicationRow>(
    `select ${COLUMNS} from feedback_applications a where a.organization_id = $1 and a.recipient_person_id = $2 and a.${sourceColumn(source.kind)} = $3${lock ? " for update" : ""}`,
    [scope.organizationId, scope.personId, source.id],
  )
  return result.rows[0] ?? null
}

async function findOwned(db: Queryable, scope: ApplicationScope, applicationId: string, lock = false): Promise<ApplicationRow | null> {
  const result = await db.query<ApplicationRow>(
    `select ${COLUMNS}, ${FOLLOW_UP_COLUMN}, (select f.version from feedbacks f where f.id = a.feedback_id) current_source_version
       from feedback_applications a where a.id = $1 and a.organization_id = $2 and a.recipient_person_id = $3${lock ? " for update of a" : ""}`,
    [applicationId, scope.organizationId, scope.personId],
  )
  return result.rows[0] ?? null
}

async function audit(db: Queryable, scope: ApplicationScope, action: string, applicationId: string, payload: Record<string, unknown>) {
  await db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'feedback_application', $4, $5)`, [scope.organizationId, scope.personId, action, applicationId, JSON.stringify(payload)])
}

/** Chave da primeira mensagem da INIA (a apresentação) na conversa da aplicação — gravada uma única vez. */
export const PRESENTATION_MESSAGE_KEY = "feedback-application:presentation"

// ---------------------------------------------------------------------------------------------
// Casos de uso
// ---------------------------------------------------------------------------------------------

/**
 * Iniciar OU retomar: sempre a MESMA aplicação da fonte. Primeira vez = congela o contexto do registro publicado, cria a
 * conversa (origem FEEDBACK) e grava a apresentação como primeira mensagem da INIA. Em andamento = devolve como está.
 * Concluída = devolve em modo consulta (nunca reaplica). `created` diz se ESTA chamada iniciou.
 */
export async function startOrResumeApplication(db: Database, scope: ApplicationScope, source: FeedbackSourceRef, now: Date): Promise<{ application: FeedbackApplicationDetail; created: boolean }> {
  return inTransaction(db, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('feedback_application:' || $1::text))", [applicationSourceLockKey(scope, source)])
    const existing = await findBySource(client, scope, source, true)
    const transition = startTransition(existing?.status ?? "NOT_STARTED")
    if (existing && transition.ok && !transition.changed) {
      const row = await findOwned(client, scope, existing.id)
      return { application: await toDetail(client, scope, row!), created: false }
    }
    const timeZone = await organizationTimeZone(client, scope.organizationId)
    const loaded = await loadAuthorizedSource(client, scope, source, now, timeZone)
    const person = await loadPersonPresentation(client, scope.organizationId, scope.personId)
    const addressName = person ? addressNameOf({ registeredName: person.registeredName, preferredName: person.preferredName }) : null
    const presentation = buildApplicationPresentation({ context: loaded.context, view: loaded.view, addressName, now, timeZone })

    const conversation = await client.query<{ id: string }>(
      `insert into assistant_conversations (organization_id, owner_person_id, kind, status, origin, title, started_at, last_activity_at, owner_seen_at)
       values ($1, $2, 'CONVERSATION', 'ACTIVE', 'FEEDBACK', $3, $4, $4, $4) returning id`,
      [scope.organizationId, scope.personId, presentation.title, now],
    )
    const conversationId = conversation.rows[0]!.id
    await appendConversationMessage(client, { conversationId, organizationId: scope.organizationId, ownerPersonId: scope.personId, channel: "chat", role: "assistant", content: presentation.chatText, occurredAt: now, clientMessageId: PRESENTATION_MESSAGE_KEY })

    const values = [loaded.version, conversationId, JSON.stringify(loaded.context), HISTORICAL_CONTEXT_VERSION, JSON.stringify(presentation), APPLICATION_PRESENTATION_VERSION, now]
    const id = existing
      ? (
          await client.query<{ id: string }>(
            `update feedback_applications set status = 'IN_PROGRESS', source_version = $1, conversation_id = $2, context = $3, context_version = $4, presentation = $5, presentation_version = $6,
               started_at = $7, last_opened_at = $7, updated_at = $7 where id = $8 and status = 'NOT_STARTED' returning id`,
            [...values, existing.id],
          )
        ).rows[0]!.id
      : (
          await client.query<{ id: string }>(
            `insert into feedback_applications (organization_id, recipient_person_id, source_kind, ${sourceColumn(source.kind)}, status, source_version, conversation_id, context, context_version, presentation, presentation_version, started_at, last_opened_at, created_at, updated_at)
             values ($8, $9, $10, $11, 'IN_PROGRESS', $1, $2, $3, $4, $5, $6, $7, $7, $7, $7) returning id`,
            [...values, scope.organizationId, scope.personId, source.kind, source.id],
          )
        ).rows[0]!.id
    await audit(client, scope, "FEEDBACK_APPLICATION_STARTED", id, { source, sourceVersion: loaded.version, conversationId, contextVersion: HISTORICAL_CONTEXT_VERSION, presentationVersion: APPLICATION_PRESENTATION_VERSION })
    const row = await findOwned(client, scope, id)
    return { application: await toDetail(client, scope, row!), created: true }
  })
}

export async function getApplication(db: Queryable, scope: ApplicationScope, applicationId: string): Promise<FeedbackApplicationDetail> {
  const row = await findOwned(db, scope, applicationId)
  if (!row) throw applicationNotFound()
  return toDetail(db, scope, row)
}

/** A aplicação da fonte (sem linha = nenhuma), com trava opcional para a confirmação de ciência. */
export async function findApplicationViewBySource(db: Queryable, scope: ApplicationScope, source: FeedbackSourceRef, lock = false): Promise<FeedbackApplicationView | null> {
  const row = await findBySource(db, scope, source, lock)
  return row ? toView(row) : null
}

/** Chave do lock transacional POR FONTE — a mesma de iniciar a aplicação (iniciar e confirmar ciência nunca se cruzam). */
export const applicationSourceLockKey = (scope: ApplicationScope, source: FeedbackSourceRef) => `${scope.organizationId}:${source.kind}:${source.id}`

/** Todas as aplicações do destinatário (estado do botão de cada feedback no Acompanhamento). */
export async function listApplications(db: Queryable, scope: ApplicationScope): Promise<FeedbackApplicationView[]> {
  const result = await db.query<ApplicationRow>(`select ${COLUMNS}, ${FOLLOW_UP_COLUMN} from feedback_applications a where a.organization_id = $1 and a.recipient_person_id = $2 order by a.updated_at desc limit 500`, [scope.organizationId, scope.personId])
  return result.rows.map(toView)
}

/** Aberta na tela (retomada/consulta) — marca onde parou; não muda o estado. */
export async function markApplicationOpened(db: Queryable, scope: ApplicationScope, applicationId: string, now: Date): Promise<FeedbackApplicationView> {
  const row = (await db.query<ApplicationRow>(`update feedback_applications a set last_opened_at = $4, updated_at = $4 where a.id = $1 and a.organization_id = $2 and a.recipient_person_id = $3 and a.status <> 'NOT_STARTED' returning ${COLUMNS}`, [applicationId, scope.organizationId, scope.personId, now])).rows[0]
  if (!row) throw applicationNotFound()
  return toView(row)
}

/** "Sair por agora": a aplicação continua em andamento (retomável). Concluída = 409. */
export async function pauseApplication(db: Database, scope: ApplicationScope, applicationId: string, now: Date): Promise<FeedbackApplicationView> {
  return inTransaction(db, async (client) => {
    const current = await findOwned(client, scope, applicationId, true)
    if (!current) throw applicationNotFound()
    const transition = pauseTransition(current.status)
    if (!transition.ok) throw new DomainError(transition.reason === "COMPLETED" ? "Esta conversa já foi concluída." : "Esta aplicação ainda não começou.", `FEEDBACK_APPLICATION_${transition.reason}`, 409)
    const row = (await client.query<ApplicationRow>(`update feedback_applications a set paused_at = $2, updated_at = $2 where a.id = $1 returning ${COLUMNS}`, [applicationId, now])).rows[0]!
    await audit(client, scope, "FEEDBACK_APPLICATION_PAUSED", applicationId, {})
    return toView(row)
  })
}

/**
 * Concluir: encerra a aplicação e a conversa (somente consulta a partir daqui). Idempotente. Baixo nível — não há rota: a ação
 * do colaborador é a CONFIRMAÇÃO DE CIÊNCIA com login e senha (read-confirmation-service), que grava a ciência e chama esta
 * função na MESMA transação. Aqui não se toca ciência, caso de supervisão nem orientação. `meta` vai para a auditoria.
 */
export async function completeApplication(db: Database, scope: ApplicationScope, applicationId: string, now: Date, meta: Record<string, unknown> = {}): Promise<FeedbackApplicationView> {
  return inTransaction(db, async (client) => {
    const current = await findOwned(client, scope, applicationId, true)
    if (!current) throw applicationNotFound()
    const transition = completeTransition(current.status)
    if (!transition.ok) throw new DomainError("Esta aplicação ainda não começou.", "FEEDBACK_APPLICATION_NOT_STARTED", 409)
    if (!transition.changed) return toView(current)
    const row = (await client.query<ApplicationRow>(`update feedback_applications a set status = 'COMPLETED', completed_at = $2, updated_at = $2 where a.id = $1 and a.status = 'IN_PROGRESS' returning ${COLUMNS}`, [applicationId, now])).rows[0]!
    await client.query(`update assistant_conversations set status = 'CLOSED', closed_at = $2, close_reason = 'COMPLETED' where id = $1 and status = 'ACTIVE'`, [current.conversation_id, now])
    await audit(client, scope, "FEEDBACK_APPLICATION_COMPLETED", applicationId, { conversationId: current.conversation_id, ...meta })
    return toView(row)
  })
}

/** Fatos da reprodução da apresentação (começou/terminou/interrompida/falhou). Nunca mudam o estado da aplicação. */
export async function recordPresentationEvent(db: Queryable, scope: ApplicationScope, applicationId: string, event: PresentationEvent, now: Date): Promise<FeedbackApplicationView> {
  const current = await findOwned(db, scope, applicationId)
  if (!current) throw applicationNotFound()
  if (!presentationEventAccepted(current.status)) throw new DomainError("Esta conversa já foi concluída: a apresentação não é reproduzida em modo consulta.", "FEEDBACK_APPLICATION_COMPLETED", 409)
  const set =
    event === "STARTED" ? ["presentation_started_at = $2", "presentation_play_count = presentation_play_count + 1"]
      : event === "COMPLETED" ? ["presentation_completed_at = coalesce(presentation_completed_at, $2)"]
        : event === "INTERRUPTED" ? ["presentation_interrupted_at = $2"]
          : []
  const row = (await db.query<ApplicationRow>(`update feedback_applications a set ${[...set, "updated_at = $2"].join(", ")} where a.id = $1 and a.status = 'IN_PROGRESS' returning ${COLUMNS}`, [applicationId, now])).rows[0]
  if (!row) throw new DomainError("Esta conversa já foi concluída.", "FEEDBACK_APPLICATION_COMPLETED", 409)
  if (event === "FAILED") await audit(db, scope, "FEEDBACK_APPLICATION_PRESENTATION_FAILED", applicationId, {})
  return toView(row)
}

// ---------------------------------------------------------------------------------------------
// Convite proativo
// ---------------------------------------------------------------------------------------------

/** Como o convite nomeia o feedback ("Tenho um feedback sobre ___."): o assunto registrado; sem assunto, o tipo por extenso. */
function inviteSubjectOf(row: { kind: "MONITORING" | "INDICATOR"; heading_title: string | null; impacted_indicator: string; case_title: string | null }): string {
  const subject = registeredSubjectOf({ kind: row.kind, headingTitle: row.heading_title, impactedIndicator: row.impacted_indicator, caseTitle: row.case_title })
  if (subject === "Monitoria do atendimento") return "a monitoria de um dos seus atendimentos"
  if (subject === "Resultado do indicador") return "um dos seus indicadores"
  return subject
}

export type FeedbackInvite = { source: FeedbackSourceRef; subject: string; periodLabel: string | null; publishedAt: string; offeredAt: string | null }

/**
 * O convite da vez (no máximo UM): o feedback mais recente publicado/entregue na janela, sem aplicação iniciada, sem ciência e
 * sem decisão anterior sobre o convite. Assunto e período vêm do registro — o mesmo título do Acompanhamento.
 */
export async function loadCurrentInvite(db: Queryable, scope: ApplicationScope, now: Date): Promise<FeedbackInvite | null> {
  const since = new Date(now.getTime() - FEEDBACK_INVITE_WINDOW_DAYS * 24 * 3_600_000)
  const [published, delivered] = await Promise.all([
    db.query<{ id: string; at: Date; acknowledged: boolean; status: FeedbackApplicationStatus | null; invite_resolved_at: Date | null; invite_offered_at: Date | null; heading_title: string | null; period: string | null; impacted_indicator: string; case_title: string | null; kind: "MONITORING" | "INDICATOR" }>(
      `select f.id, coalesce(f.published_at, f.created_at) at, f.acknowledged_at is not null acknowledged, a.status, a.invite_resolved_at, a.invite_offered_at, f.impacted_indicator, c.title case_title, f.feedback_kind kind,
              coalesce(f.context_snapshot->'feedbackEngine'->'feedbackView'->'heading', f.context_snapshot->'reliableFeedback'->'feedbackView'->'heading')->>'title' heading_title,
              coalesce(f.context_snapshot->'feedbackEngine'->'feedbackView'->'heading', f.context_snapshot->'reliableFeedback'->'feedbackView'->'heading')->>'subtitle' period
         from feedbacks f left join supervision_cases c on c.id = f.case_id
         left join feedback_applications a on a.organization_id = f.organization_id and a.feedback_id = f.id
        where f.organization_id = $1 and f.operator_id = $2 and f.status = 'PUBLISHED' and ${visibleInFollowUpSql("f")} and coalesce(f.published_at, f.created_at) >= $3
        order by coalesce(f.published_at, f.created_at) desc, f.id desc limit 20`,
      [scope.organizationId, scope.personId, since],
    ),
    db.query<{ id: string; at: Date; acknowledged: boolean; status: FeedbackApplicationStatus | null; invite_resolved_at: Date | null; invite_offered_at: Date | null; subject: string | null; period: string | null }>(
      `select x.id, x.delivered_at at, x.acknowledged_at is not null acknowledged, a.status, a.invite_resolved_at, a.invite_offered_at, r.interaction_label period, null subject
         from interaction_feedback_deliveries x join interaction_feedback_item_reviews r on r.id = x.item_review_id and r.organization_id = x.organization_id
         left join feedback_applications a on a.organization_id = x.organization_id and a.interaction_delivery_id = x.id
        where x.organization_id = $1 and x.collaborator_id = $2 and x.delivered_at >= $3
        order by x.delivered_at desc, x.id desc limit 20`,
      [scope.organizationId, scope.personId, since],
    ),
  ])
  type Candidate = { source: FeedbackSourceRef; publishedAt: Date; acknowledged: boolean; status: FeedbackApplicationStatus; inviteResolved: boolean; subject: string; periodLabel: string | null; offeredAt: Date | null }
  const candidates: Candidate[] = [
    ...published.rows.map((row) => ({
      source: { kind: "PUBLISHED_FEEDBACK" as const, id: row.id },
      publishedAt: new Date(row.at),
      acknowledged: row.acknowledged,
      status: row.status ?? "NOT_STARTED",
      inviteResolved: row.invite_resolved_at !== null,
      subject: inviteSubjectOf(row),
      periodLabel: row.period ?? registeredWhenOf({ kind: row.kind, headingTitle: row.heading_title, impactedIndicator: row.impacted_indicator, caseTitle: row.case_title }),
      offeredAt: row.invite_offered_at,
    })),
    ...delivered.rows.map((row) => ({
      source: { kind: "INTERACTION_FEEDBACK_DELIVERY" as const, id: row.id },
      publishedAt: new Date(row.at),
      acknowledged: row.acknowledged,
      status: row.status ?? "NOT_STARTED",
      inviteResolved: row.invite_resolved_at !== null,
      subject: "um dos seus atendimentos",
      periodLabel: row.period ? `Atendimento de ${row.period}` : null,
      offeredAt: row.invite_offered_at,
    })),
  ]
  const picked = pickInvite(candidates, now)
  return picked ? { source: picked.source, subject: picked.subject, periodLabel: picked.periodLabel, publishedAt: picked.publishedAt.toISOString(), offeredAt: iso(picked.offeredAt) } : null
}

/**
 * Evento do convite: OFFER (primeira exibição) e a decisão do colaborador (ACCEPT/READ/SNOOZE — encerra o convite para sempre).
 * Idempotente; a fonte é autorizada antes (fonte de outra pessoa = 404). Nunca inicia áudio nem aplicação.
 */
export async function recordInviteEvent(db: Database, scope: ApplicationScope, source: FeedbackSourceRef, event: InviteEvent, now: Date): Promise<{ offeredAt: string | null; resolvedAt: string | null; resolution: InviteResolution | null }> {
  return inTransaction(db, async (client) => {
    const timeZone = await organizationTimeZone(client, scope.organizationId)
    await loadAuthorizedSource(client, scope, source, now, timeZone)
    const column = sourceColumn(source.kind)
    await client.query(
      `insert into feedback_applications (organization_id, recipient_person_id, source_kind, ${column}, status, created_at, updated_at) values ($1, $2, $3, $4, 'NOT_STARTED', $5, $5)
       on conflict (organization_id, ${column}) where ${column} is not null do nothing`,
      [scope.organizationId, scope.personId, source.kind, source.id, now],
    )
    const resolution = event === "OFFER" ? null : INVITE_RESOLUTION[event]
    const row = (
      await client.query<{ id: string; invite_offered_at: Date | null; invite_resolved_at: Date | null; invite_resolution: InviteResolution | null; changed: boolean }>(
        `update feedback_applications set invite_offered_at = coalesce(invite_offered_at, $4),
           invite_resolved_at = case when $5::text is null then invite_resolved_at else coalesce(invite_resolved_at, $4) end,
           invite_resolution = case when $5::text is null then invite_resolution else coalesce(invite_resolution, $5) end,
           updated_at = $4
         where organization_id = $1 and recipient_person_id = $2 and ${column} = $3
         returning id, invite_offered_at, invite_resolved_at, invite_resolution`,
        [scope.organizationId, scope.personId, source.id, now, resolution],
      )
    ).rows[0]!
    if (event !== "OFFER") await audit(client, scope, `FEEDBACK_APPLICATION_INVITE_${INVITE_RESOLUTION[event]}`, row.id, { source })
    return { offeredAt: iso(row.invite_offered_at), resolvedAt: iso(row.invite_resolved_at), resolution: row.invite_resolution }
  })
}

// ---------------------------------------------------------------------------------------------
// Conversa da aplicação (chat e voz)
// ---------------------------------------------------------------------------------------------

/** Contexto da conversa complementar: quando a aplicação foi concluída e os trechos finais da conversa original (dados). */
async function followUpInputOf(db: Queryable, row: ApplicationRow, timeZone: string): Promise<FollowUpInstructionInput> {
  const originalTurns = row.conversation_id ? await loadConversationContextTurns(db, { organizationId: row.organization_id, conversationId: row.conversation_id, limit: MAX_ORIGINAL_TURNS }) : []
  return { completedDay: row.completed_at ? civilDay(new Date(row.completed_at).toISOString(), timeZone) : null, originalTurns }
}
const MAX_ORIGINAL_TURNS = 12

/**
 * Instrução do modelo para a conversa de uma aplicação — do registro CONGELADO da aplicação ligada a esta conversa (a original
 * OU uma complementar), do PRÓPRIO dono. `null` = a conversa não é de aplicação (o chat segue o caminho normal).
 */
export async function loadApplicationInstructionByConversation(
  db: Queryable,
  input: { organizationId: string; ownerPersonId: string; conversationId: string; now: Date; consultation?: boolean },
): Promise<{ applicationId: string; status: FeedbackApplicationStatus; role: ApplicationConversationRole; instruction: string; consultation: FeedbackConsultation } | null> {
  const row = (
    await db.query<ApplicationRow & { follow_up: boolean }>(
      `select ${COLUMNS}, (a.conversation_id is distinct from $1) follow_up from feedback_applications a
        where a.organization_id = $2 and a.recipient_person_id = $3
          and (a.conversation_id = $1 or exists (select 1 from feedback_application_followups x where x.application_id = a.id and x.conversation_id = $1))`,
      [input.conversationId, input.organizationId, input.ownerPersonId],
    )
  ).rows[0]
  if (!row?.context || !row.presentation) return null
  const timeZone = await organizationTimeZone(db, input.organizationId)
  const followUp = row.follow_up ? await followUpInputOf(db, row, timeZone) : undefined
  return {
    applicationId: row.id,
    status: row.status,
    role: row.follow_up ? "FOLLOW_UP" : "APPLICATION",
    instruction: renderApplicationInstruction({ context: row.context, presentation: row.presentation, now: input.now, timeZone, followUp, consultation: input.consultation ?? false }),
    consultation: consultationOf(row.id, row.context, timeZone),
  }
}

/**
 * Sessão de VOZ de uma aplicação: em andamento = a conversa da aplicação; concluída = a conversa complementar (dúvidas), com o
 * MESMO registro. `consultation` = a sessão recebe os especialistas do Orquestrador do chat/voz como ferramentas (regras de
 * session-consultation.ts); sem eles, só o registro. Não iniciada = 409.
 */
export async function loadApplicationVoiceInstruction(db: Queryable, scope: ApplicationScope, applicationId: string, now: Date, options: { consultation?: boolean } = {}): Promise<string> {
  const row = await findOwned(db, scope, applicationId)
  if (!row) throw applicationNotFound()
  if (row.status === "NOT_STARTED" || !row.context || !row.presentation) throw new DomainError("Esta aplicação ainda não começou.", "FEEDBACK_APPLICATION_NOT_STARTED", 409)
  const timeZone = await organizationTimeZone(db, scope.organizationId)
  const followUp = row.status === "COMPLETED" ? await followUpInputOf(db, row, timeZone) : undefined
  return renderApplicationInstruction({ context: row.context, presentation: row.presentation, now, timeZone, followUp, consultation: options.consultation ?? false })
}

/**
 * Moldura das CONSULTAS de uma aplicação (especialista acionado pela voz da sessão): do registro congelado da aplicação do
 * PRÓPRIO destinatário. Outra pessoa/organização = 404; não iniciada = 409.
 */
export async function loadFeedbackConsultation(db: Queryable, scope: ApplicationScope, applicationId: string): Promise<FeedbackConsultation> {
  const row = await findOwned(db, scope, applicationId)
  if (!row) throw applicationNotFound()
  if (row.status === "NOT_STARTED" || !row.context) throw new DomainError("Esta aplicação ainda não começou.", "FEEDBACK_APPLICATION_NOT_STARTED", 409)
  return consultationOf(row.id, row.context, await organizationTimeZone(db, scope.organizationId))
}

export type ApplicationConversationRole = "APPLICATION" | "FOLLOW_UP"

/**
 * Conversa em que uma escrita (mensagem de texto ou turno de voz) SOBRE UMA APLICAÇÃO será gravada — decidida aqui, nunca pelo
 * navegador:
 *   - conversa pedida pelo cliente: precisa ser desta aplicação (a original ou uma complementar dela); outra = 409 (a tela
 *     está desatualizada — nunca grava em outro contexto em silêncio). As regras de conversa encerrada continuam as de sempre;
 *   - sem conversa: em andamento = a conversa da aplicação; concluída = a conversa complementar ATIVA, criada AGORA se não
 *     existir (sob lock por aplicação: cliques repetidos e outras abas reaproveitam a mesma).
 * Nada aqui muda o estado da aplicação, a ciência ou o caso.
 */
export async function resolveApplicationConversation(
  db: Database,
  scope: ApplicationScope,
  input: { applicationId: string; requestedConversationId: string | null; now: Date },
): Promise<{ conversationId: string; role: ApplicationConversationRole; created: boolean }> {
  const row = await findOwned(db, scope, input.applicationId)
  if (!row) throw applicationNotFound()
  if (row.status === "NOT_STARTED" || !row.conversation_id) throw new DomainError("Esta aplicação ainda não começou.", "FEEDBACK_APPLICATION_NOT_STARTED", 409)
  if (input.requestedConversationId) {
    if (input.requestedConversationId === row.conversation_id) return { conversationId: row.conversation_id, role: "APPLICATION", created: false }
    const linked = await db.query(`select 1 from feedback_application_followups where application_id = $1 and conversation_id = $2`, [row.id, input.requestedConversationId])
    if (linked.rowCount) return { conversationId: input.requestedConversationId, role: "FOLLOW_UP", created: false }
    throw new DomainError("Esta conversa não pertence a este feedback. Abra o feedback de novo para continuar.", "FEEDBACK_APPLICATION_CONVERSATION_MISMATCH", 409, { status: row.status })
  }
  if (row.status === "IN_PROGRESS") return { conversationId: row.conversation_id, role: "APPLICATION", created: false }
  return getOrCreateFollowUp(db, scope, row, input.now)
}

async function getOrCreateFollowUp(db: Database, scope: ApplicationScope, row: ApplicationRow, now: Date): Promise<{ conversationId: string; role: "FOLLOW_UP"; created: boolean }> {
  return inTransaction(db, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('feedback_application_followup:' || $1::text))", [row.id])
    const active = (
      await client.query<{ conversation_id: string }>(
        `select x.conversation_id from feedback_application_followups x join assistant_conversations c on c.id = x.conversation_id
          where x.application_id = $1 and c.status = 'ACTIVE' order by x.created_at desc limit 1`,
        [row.id],
      )
    ).rows[0]
    if (active) return { conversationId: active.conversation_id, role: "FOLLOW_UP" as const, created: false }
    const title = `Dúvidas · ${row.presentation?.title ?? "Feedback"}`
    const conversation = await client.query<{ id: string }>(
      `insert into assistant_conversations (organization_id, owner_person_id, kind, status, origin, title, started_at, last_activity_at, owner_seen_at)
       values ($1, $2, 'CONVERSATION', 'ACTIVE', 'FEEDBACK', $3, $4, $4, $4) returning id`,
      [scope.organizationId, scope.personId, title, now],
    )
    const conversationId = conversation.rows[0]!.id
    await client.query(`insert into feedback_application_followups (organization_id, application_id, recipient_person_id, conversation_id, created_at) values ($1, $2, $3, $4, $5)`, [scope.organizationId, row.id, scope.personId, conversationId, now])
    await audit(client, scope, "FEEDBACK_APPLICATION_FOLLOW_UP_STARTED", row.id, { conversationId, applicationConversationId: row.conversation_id })
    return { conversationId, role: "FOLLOW_UP" as const, created: true }
  })
}

// ---------------------------------------------------------------------------------------------
// Voz da apresentação (cache; regenerar o áudio nunca cria aplicação nem muda estado)
// ---------------------------------------------------------------------------------------------

export type SpeechSynthesizer = (request: { text: string }) => Promise<{ pcm16: Buffer; sampleRate: number; model: string; voice: string }>
export type ApplicationSpeechAudio = { pcm16: Buffer; sampleRate: number; durationMs: number; voice: string; model: string; cached: boolean }
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")
const inFlight = new Map<string, Promise<ApplicationSpeechAudio>>()

export async function loadApplicationSpeechAudio(db: Queryable, scope: ApplicationScope, applicationId: string, synthesize: SpeechSynthesizer, expected: { voice: string; models: readonly string[] }): Promise<ApplicationSpeechAudio> {
  const row = await findOwned(db, scope, applicationId)
  if (!row?.presentation?.speechText) throw applicationNotFound()
  const text = row.presentation.speechText
  const textHash = sha256(text)
  const cached = (
    await db.query<{ audio: Buffer; sample_rate: number; duration_ms: number; voice_name: string; model: string }>(
      `select audio, sample_rate, duration_ms, voice_name, model from feedback_application_speech_audio where application_id = $1 and text_sha256 = $2 and voice_name = $3 and model = any($4::text[])`,
      [applicationId, textHash, expected.voice, [...expected.models]],
    )
  ).rows[0]
  if (cached) return { pcm16: cached.audio, sampleRate: cached.sample_rate, durationMs: cached.duration_ms, voice: cached.voice_name, model: cached.model, cached: true }
  const pending = inFlight.get(applicationId)
  if (pending) return pending
  const work = (async (): Promise<ApplicationSpeechAudio> => {
    const speech = await synthesize({ text })
    const durationMs = Math.round((speech.pcm16.length / 2 / speech.sampleRate) * 1000)
    await db.query(
      `insert into feedback_application_speech_audio (application_id, organization_id, text_sha256, voice_name, model, sample_rate, audio, duration_ms) values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (application_id) do update set text_sha256 = excluded.text_sha256, voice_name = excluded.voice_name, model = excluded.model, sample_rate = excluded.sample_rate, audio = excluded.audio, duration_ms = excluded.duration_ms, created_at = now()`,
      [applicationId, scope.organizationId, textHash, speech.voice, speech.model, speech.sampleRate, speech.pcm16, durationMs],
    )
    return { pcm16: speech.pcm16, sampleRate: speech.sampleRate, durationMs, voice: speech.voice, model: speech.model, cached: false }
  })()
  inFlight.set(applicationId, work)
  try {
    return await work
  } finally {
    inFlight.delete(applicationId)
  }
}
