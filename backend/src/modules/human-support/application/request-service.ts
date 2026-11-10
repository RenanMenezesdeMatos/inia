import { buildSupportContext } from "../../assistant/application/support-context.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { TransactionSource } from "../../../shared/infrastructure/database/transaction.js"
import { canRequestWith } from "../domain/availability.js"
import { generateProtocol, HUMAN_SUPPORT_LIMITS, SUPPORT_CONTEXT_VERSION, type RequestOrigin } from "../domain/catalogs.js"
import { closeDecision, cancelDecision } from "../domain/request-lifecycle.js"
import { requestOriginOf } from "../domain/origin.js"
import type { OperatorRequestView, PreviewResponse, SharedContext } from "../domain/views.js"
import { dispatchAfterCommand } from "./dispatch.js"
import { availabilityFor, enabledForPlace, loadPlace, queueDeadlineFor, type PersonPlace } from "./eligibility.js"
import { bumpInboxVersions } from "./inbox-versions.js"
import { withOrganizationLock, type Queryable } from "./locks.js"
import { loadActiveAttendance, loadOpenRequestOf, loadRequest, operatorRequestView, REQUEST_COLUMNS, type RequestRow } from "./request-views.js"
import { appendSystemMessage, endAttendance, endRequest, recordRequestEvent } from "./transitions.js"

/**
 * PEDIDO DE APOIO (design_draft.md seções 7–9): prévia (com o registro da tentativa sem Anjo em serviço, D4), criação, cancelamento e
 * encerramento. A sugestão nunca cria pedido: só o "Pedir ajuda" do operador cria. Um pedido aberto por operador (índice único).
 * A cópia da troca vem de `assistant/application/support-context.ts` com os mesmos ids da prévia: o Anjo recebe exatamente o que o
 * operador viu. Depois do commit de cada comando, a distribuição (seção 8).
 */
export type Viewer = { organizationId: string; personId: string }
export type SourceInput = { interactionId?: string | null | undefined; ratingId?: string | null | undefined }

const disabled = () => new DomainError("O apoio com Anjo ainda não está disponível para sua equipe.", "HUMAN_SUPPORT_DISABLED", 409)
const sourceNotFound = () => new DomainError("Mensagem não encontrada.", "HUMAN_SUPPORT_SOURCE_NOT_FOUND", 404)
const requestNotFound = () => new DomainError("Pedido de apoio não encontrado.", "HUMAN_SUPPORT_REQUEST_NOT_FOUND", 404)
const ended = () => new DomainError("Este atendimento já foi encerrado.", "HUMAN_SUPPORT_REQUEST_ENDED", 409)

/** A cópia da troca e a origem do pedido, a partir da mensagem informada (sem mensagem = botão permanente). */
async function sharedContextFor(db: Queryable, viewer: Viewer, source: SourceInput): Promise<{ origin: RequestOrigin; context: Omit<SharedContext, "note">; interactionId: string | null; ratingId: string | null; conversationId: string | null }> {
  const interactionId = source.interactionId ?? null
  if (!interactionId) return { origin: "BUTTON", context: { question: null, answer: null, dislike: null }, interactionId: null, ratingId: null, conversationId: null }
  const support = await buildSupportContext(db, { organizationId: viewer.organizationId, ownerPersonId: viewer.personId, interactionId, ratingId: source.ratingId ?? null })
  const origin = requestOriginOf({ interactionId, facts: support?.facts ?? null })
  if (!support || !origin) throw sourceNotFound()
  return { origin, context: support.sharedContext, interactionId, ratingId: origin === "DISLIKE" ? (source.ratingId ?? null) : null, conversationId: support.conversationId }
}

async function requirePlace(db: Queryable, viewer: Viewer): Promise<PersonPlace> {
  const place = await loadPlace(db, viewer.organizationId, viewer.personId)
  if (!place || !place.active) throw disabled()
  return place
}

/** Tentativa sem Anjo em serviço (D4): no máximo uma por pessoa a cada 10 min, conferida sob a trava da organização. */
async function recordNoAnjoAttempt(db: TransactionSource, viewer: Viewer, place: PersonPlace, origin: RequestOrigin, interactionId: string | null): Promise<void> {
  await withOrganizationLock(db, viewer.organizationId, async (client) => {
    await client.query(
      `insert into human_support_entry_events (organization_id, person_id, team_id, subteam_id, kind, origin, interaction_id, occurred_at)
       select $1, $2, $3, $4, 'NO_ANJO_IN_SERVICE', $5, $6, statement_timestamp()
        where not exists (
          select 1 from human_support_entry_events e
           where e.organization_id = $1 and e.person_id = $2 and e.kind = 'NO_ANJO_IN_SERVICE' and e.occurred_at > statement_timestamp() - make_interval(secs => $7::int)
        )`,
      [viewer.organizationId, viewer.personId, place.teamId, place.subteamId, origin, interactionId, HUMAN_SUPPORT_LIMITS.noAnjoAttemptWindowMs / 1000],
    )
  })
}

/** Prévia: a cópia que o Anjo receberia, a disponibilidade e o prazo. Grava a tentativa quando não há Anjo em serviço. */
export async function previewRequest(db: TransactionSource & Queryable, viewer: Viewer, source: SourceInput): Promise<PreviewResponse> {
  const place = await requirePlace(db, viewer)
  if (!(await enabledForPlace(db, viewer.organizationId, place))) throw disabled()
  const shared = await sharedContextFor(db, viewer, source)
  const availability = await availabilityFor(db, viewer.organizationId, place, viewer.personId)
  if (availability.status === "NONE_IN_SERVICE") await recordNoAnjoAttempt(db, viewer, place, shared.origin, shared.interactionId)
  return { origin: shared.origin, interactionId: shared.interactionId, ratingId: shared.ratingId, sharedContext: { ...shared.context, note: null }, availability }
}

export type CreateRequestInput = SourceInput & { clientRequestId: string; note?: string | null | undefined }

/** Cria o pedido (idempotente pela chave do cliente). `created = false` = a mesma chave devolveu o pedido existente. */
export async function createRequest(db: TransactionSource & Queryable, viewer: Viewer, input: CreateRequestInput): Promise<{ request: OperatorRequestView; created: boolean }> {
  const existing = (await db.query<RequestRow>(`select ${REQUEST_COLUMNS} from human_support_requests r where r.organization_id = $1 and r.operator_person_id = $2 and r.client_request_id = $3`, [viewer.organizationId, viewer.personId, input.clientRequestId])).rows[0]
  if (existing) return { request: await operatorRequestView(db, existing), created: false }
  const place = await requirePlace(db, viewer)
  if (!(await enabledForPlace(db, viewer.organizationId, place))) throw disabled()
  const shared = await sharedContextFor(db, viewer, input)
  const note = input.note?.trim() ? input.note.trim().slice(0, HUMAN_SUPPORT_LIMITS.noteMaxChars) : null
  const outcome = await withOrganizationLock(db, viewer.organizationId, async (client) => {
    const repeated = (await client.query<RequestRow>(`select ${REQUEST_COLUMNS} from human_support_requests r where r.organization_id = $1 and r.operator_person_id = $2 and r.client_request_id = $3`, [viewer.organizationId, viewer.personId, input.clientRequestId])).rows[0]
    if (repeated) return { request: repeated, created: false }
    if (await loadOpenRequestOf(client, viewer.organizationId, viewer.personId)) throw new DomainError("Você já tem um pedido de apoio aberto.", "HUMAN_SUPPORT_REQUEST_ALREADY_OPEN", 409)
    // Confere de novo sob a trava: sem Anjo em serviço, nenhum pedido (corrida rara com a prévia).
    const availability = await availabilityFor(client, viewer.organizationId, place, viewer.personId)
    if (!canRequestWith(availability.status)) {
      if (availability.status === "DISABLED") throw disabled()
      throw new DomainError("Nenhum Anjo em serviço agora.", "HUMAN_SUPPORT_NO_ANJO_IN_SERVICE", 409)
    }
    const deadline = await queueDeadlineFor(client, viewer.organizationId, place)
    const sharedContext: SharedContext = { ...shared.context, note }
    let created: RequestRow | undefined
    for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
      created = (
        await client.query<RequestRow>(
          `insert into human_support_requests as r (organization_id, protocol, operator_person_id, team_id, subteam_id, origin, source_conversation_id, source_interaction_id, source_rating_id,
                                                    shared_context, context_version, note, client_request_id, status, queued_at, queue_expires_at, queue_deadline_basis, operator_seen_at, next_seq, created_at)
           values ($1, $2, $3, $4, $5, $6, $15, $7, $8, $9, $10, $11, $12, 'WAITING',
                   statement_timestamp(), statement_timestamp() + make_interval(mins => $13::int), $14, statement_timestamp(), 1, statement_timestamp())
           on conflict (organization_id, protocol) do nothing
           returning ${REQUEST_COLUMNS}`,
          [viewer.organizationId, generateProtocol(), viewer.personId, place.teamId, place.subteamId, shared.origin, shared.interactionId, shared.ratingId, JSON.stringify(sharedContext), SUPPORT_CONTEXT_VERSION, note, input.clientRequestId, deadline.minutes, deadline.basis, shared.conversationId],
        )
      ).rows[0]
    }
    if (!created) throw new Error("Não foi possível gerar o protocolo do pedido.")
    await recordRequestEvent(client, { organizationId: viewer.organizationId, requestId: created.id, from: null, to: "WAITING", cause: "CREATED", actorPersonId: viewer.personId })
    await appendSystemMessage(client, { id: created.id, organizationId: viewer.organizationId, operatorPersonId: viewer.personId }, null, "QUEUED")
    await bumpInboxVersions(client, viewer.organizationId, [viewer.personId])
    return { request: created, created: true }
  })
  if (outcome.created) await dispatchAfterCommand(db, viewer.organizationId)
  const fresh = (await loadRequest(db, viewer.organizationId, outcome.request.id))!
  return { request: await operatorRequestView(db, fresh), created: outcome.created }
}

/** "Cancelar pedido": só na fila. */
export async function cancelRequest(db: TransactionSource & Queryable, viewer: Viewer, requestId: string): Promise<OperatorRequestView> {
  await withOrganizationLock(db, viewer.organizationId, async (client) => {
    const request = await loadRequest(client, viewer.organizationId, requestId, { forUpdate: true })
    if (!request || request.operator_person_id !== viewer.personId) throw requestNotFound()
    const decision = cancelDecision(request.status)
    if (!decision.ok) throw ended()
    await endRequest(client, { id: request.id, organizationId: viewer.organizationId, operatorPersonId: viewer.personId }, { from: "WAITING", cause: decision.cause, actorPersonId: viewer.personId })
    await bumpInboxVersions(client, viewer.organizationId, [viewer.personId])
  })
  await dispatchAfterCommand(db, viewer.organizationId)
  return operatorRequestView(db, (await loadRequest(db, viewer.organizationId, requestId))!)
}

/**
 * "Encerrar atendimento": o operador dono (também antes da primeira resposta; com o pedido de volta à fila, vira cancelar) ou o Anjo
 * do atendimento em andamento — este também com "operador sem a INIA aberta" (só depois de 5 min sem o operador chamar). Qualquer
 * outra pessoa recebe 404.
 */
export async function closeRequest(db: TransactionSource & Queryable, viewer: Viewer, requestId: string, input: { cause?: "OPERATOR_ABSENT" | undefined; viewerIsAnjo: boolean }): Promise<{ request: RequestRow; actor: "OPERATOR" | "ANJO" }> {
  const actor = await withOrganizationLock(db, viewer.organizationId, async (client) => {
    const request = await loadRequest(client, viewer.organizationId, requestId, { forUpdate: true })
    if (!request) throw requestNotFound()
    const attendance = await loadActiveAttendance(client, request.id, { forUpdate: true })
    const isOperator = request.operator_person_id === viewer.personId
    const isActiveAnjo = Boolean(input.viewerIsAnjo && attendance && attendance.anjo_person_id === viewer.personId)
    if (!isOperator && !isActiveAnjo) {
      // O Anjo que já saiu do atendimento: o pedido existe para ele, mas já terminou.
      const attended = input.viewerIsAnjo && (await client.query(`select 1 from human_support_attendances where request_id = $1 and anjo_person_id = $2 limit 1`, [request.id, viewer.personId])).rowCount
      if (attended) throw ended()
      throw requestNotFound()
    }
    if (isOperator && input.cause) throw new DomainError("Só o Anjo encerra por ausência do operador.", "VALIDATION_ERROR", 400)
    const role = isOperator ? "OPERATOR" : "ANJO"
    const seenAt = (await client.query<{ now: Date }>("select statement_timestamp() now")).rows[0]!.now
    const decision = closeDecision({ status: request.status, actor: role, cause: input.cause, isActiveAnjo, operatorSeenAt: request.operator_seen_at, now: seenAt })
    if (!decision.ok) {
      if (decision.code === "HUMAN_SUPPORT_OPERATOR_PRESENT") throw new DomainError("O operador ainda está com a INIA aberta.", "HUMAN_SUPPORT_OPERATOR_PRESENT", 409)
      if (decision.code === "HUMAN_SUPPORT_NOT_YOUR_ATTENDANCE") throw requestNotFound()
      throw ended()
    }
    const ref = { id: request.id, organizationId: viewer.organizationId, operatorPersonId: request.operator_person_id }
    if (decision.kind === "CANCEL") {
      await endRequest(client, ref, { from: "WAITING", cause: decision.cause, actorPersonId: viewer.personId })
      await bumpInboxVersions(client, viewer.organizationId, [request.operator_person_id])
      return role
    }
    await endAttendance(client, attendance!.id, decision.cause)
    await endRequest(client, ref, { from: "IN_PROGRESS", cause: decision.cause, actorPersonId: viewer.personId, attendanceId: attendance!.id })
    await bumpInboxVersions(client, viewer.organizationId, [request.operator_person_id, attendance!.anjo_person_id])
    return role
  })
  await dispatchAfterCommand(db, viewer.organizationId)
  return { request: (await loadRequest(db, viewer.organizationId, requestId))!, actor }
}
