import { loadPersonPresentations } from "../../profile-preferences/application/person-presentation-loader.js"
import { HUMAN_SUPPORT_LIMITS, systemMessageText, type AttendanceEndCause, type MessageReader, type RequestEndCause, type RequestOrigin, type RequestStatus, type SystemMessageCode } from "../domain/catalogs.js"
import type { MessageView, OperatorRequestView, SharedContext } from "../domain/views.js"
import { loadConversationMarks } from "./conversation-marks.js"
import type { Queryable } from "./locks.js"

/**
 * LEITURA de pedidos e mensagens para cada tipo de leitor. As mensagens de sistema são gravadas só com o código; o texto é montado
 * aqui, para quem lê (o operador lê "O Anjo está sem conexão", o Anjo lê "Você ficou sem conexão"). O nome de cada autor é o nome
 * preferido da pessoa (`person-presentation-loader`).
 */
export type RequestRow = {
  id: string
  organization_id: string
  protocol: string
  operator_person_id: string
  team_id: string | null
  subteam_id: string | null
  origin: RequestOrigin
  source_interaction_id: string | null
  source_rating_id: string | null
  shared_context: SharedContext
  status: RequestStatus
  end_cause: RequestEndCause | null
  queued_at: Date
  queue_expires_at: Date
  operator_seen_at: Date
  created_at: Date
  ended_at: Date | null
}

export const REQUEST_COLUMNS = `r.id, r.organization_id, r.protocol, r.operator_person_id, r.team_id, r.subteam_id, r.origin, r.source_interaction_id, r.source_rating_id, r.shared_context, r.status, r.end_cause, r.queued_at, r.queue_expires_at, r.operator_seen_at, r.created_at, r.ended_at`

export type AttendanceRow = { id: string; request_id: string; anjo_person_id: string; operator_person_id: string; status: "ACTIVE" | "ENDED"; end_cause: AttendanceEndCause | null; started_at: Date; first_anjo_message_at: Date | null; last_human_message_at: Date; ended_at: Date | null }
export const ATTENDANCE_COLUMNS = `a.id, a.request_id, a.anjo_person_id, a.operator_person_id, a.status, a.end_cause, a.started_at, a.first_anjo_message_at, a.last_human_message_at, a.ended_at`

type MessageRow = { id: string; seq: number; author_kind: "OPERATOR" | "ANJO" | "SYSTEM"; author_person_id: string | null; body: string; system_code: SystemMessageCode | null; occurred_at: Date; attendance_anjo_id: string | null }

/** Mensagens de um pedido por `seq` (sem lacunas): as últimas (`before`), as novas (`after`) ou até `maxSeq` (o fim do atendimento do Anjo). */
export async function loadMessageViews(
  db: Queryable,
  organizationId: string,
  requestId: string,
  reader: MessageReader,
  options: { after?: number | undefined; before?: number | undefined; limit?: number | undefined; maxSeq?: number | null | undefined } = {},
): Promise<{ messages: MessageView[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(options.limit ?? HUMAN_SUPPORT_LIMITS.messagesPageMax, 1), HUMAN_SUPPORT_LIMITS.messagesPageMax)
  const params: unknown[] = [organizationId, requestId]
  const where: string[] = []
  if (options.after !== undefined) where.push(`m.seq > $${params.push(options.after)}`)
  if (options.before !== undefined) where.push(`m.seq < $${params.push(options.before)}`)
  if (options.maxSeq !== undefined && options.maxSeq !== null) where.push(`m.seq <= $${params.push(options.maxSeq)}`)
  // `after` lê para a frente; as demais leem as mais recentes e devolvem em ordem.
  const forward = options.after !== undefined
  const rows = (
    await db.query<MessageRow>(
      `select m.id, m.seq, m.author_kind, m.author_person_id, m.body, m.system_code, m.occurred_at, a.anjo_person_id attendance_anjo_id
         from human_support_messages m
         left join human_support_attendances a on a.id = m.attendance_id
        where m.organization_id = $1 and m.request_id = $2 ${where.length ? `and ${where.join(" and ")}` : ""}
        order by m.seq ${forward ? "asc" : "desc"} limit ${limit + 1}`,
      params,
    )
  ).rows
  const hasMore = rows.length > limit
  const page = rows.slice(0, limit)
  if (!forward) page.reverse()
  const names = await loadPersonPresentations(db, organizationId, page.flatMap((row) => [row.author_person_id, row.attendance_anjo_id].filter((id): id is string => Boolean(id))))
  const nameOf = (id: string | null) => (id ? (names.get(id)?.displayName ?? null) : null)
  return {
    hasMore,
    messages: page.map((row) => ({
      id: row.id,
      seq: Number(row.seq),
      authorKind: row.author_kind,
      authorName: row.author_kind === "SYSTEM" ? null : nameOf(row.author_person_id),
      body: row.author_kind === "SYSTEM" && row.system_code ? systemMessageText(row.system_code, reader, { anjoName: nameOf(row.attendance_anjo_id) }) : row.body,
      systemCode: row.system_code,
      occurredAt: row.occurred_at.toISOString(),
    })),
  }
}

export async function loadRequest(db: Queryable, organizationId: string, requestId: string, options: { forUpdate?: boolean } = {}): Promise<RequestRow | null> {
  return (await db.query<RequestRow>(`select ${REQUEST_COLUMNS} from human_support_requests r where r.organization_id = $1 and r.id = $2${options.forUpdate ? " for update" : ""}`, [organizationId, requestId])).rows[0] ?? null
}

/** O pedido aberto (Na fila ou Em atendimento) do operador, se houver — no máximo um (índice único). */
export async function loadOpenRequestOf(db: Queryable, organizationId: string, operatorPersonId: string): Promise<RequestRow | null> {
  return (await db.query<RequestRow>(`select ${REQUEST_COLUMNS} from human_support_requests r where r.organization_id = $1 and r.operator_person_id = $2 and r.status in ('WAITING', 'IN_PROGRESS')`, [organizationId, operatorPersonId])).rows[0] ?? null
}

export async function loadActiveAttendance(db: Queryable, requestId: string, options: { forUpdate?: boolean } = {}): Promise<AttendanceRow | null> {
  return (await db.query<AttendanceRow>(`select ${ATTENDANCE_COLUMNS} from human_support_attendances a where a.request_id = $1 and a.status = 'ACTIVE'${options.forUpdate ? " for update" : ""}`, [requestId])).rows[0] ?? null
}

/** A visão do pedido para o OPERADOR (dono): sem nada de presença ou pausa de Anjo. */
export async function operatorRequestView(db: Queryable, request: RequestRow): Promise<OperatorRequestView> {
  const attendance = (await db.query<AttendanceRow>(`select ${ATTENDANCE_COLUMNS} from human_support_attendances a where a.request_id = $1 order by a.started_at desc limit 1`, [request.id])).rows[0] ?? null
  const current = attendance && (attendance.status === "ACTIVE" || request.status === "CLOSED") ? attendance : null
  const [page, names, marks] = await Promise.all([
    loadMessageViews(db, request.organization_id, request.id, "OPERATOR", { limit: HUMAN_SUPPORT_LIMITS.stateMessages }),
    loadPersonPresentations(db, request.organization_id, current ? [current.anjo_person_id] : []),
    loadConversationMarks(db, [request.id]),
  ])
  const seen = marks.get(request.id)!.operator
  const anjo = current ? names.get(current.anjo_person_id) : null
  return {
    id: request.id,
    protocol: request.protocol,
    status: request.status,
    endCause: request.end_cause,
    origin: request.origin,
    createdAt: request.created_at.toISOString(),
    queuedAt: request.queued_at.toISOString(),
    queueExpiresAt: request.status === "WAITING" ? request.queue_expires_at.toISOString() : null,
    sharedContext: request.shared_context,
    anjo: current ? { name: anjo?.displayName ?? "Anjo", avatarUrl: anjo?.avatarUrl ?? null, awaitingFirstResponse: current.status === "ACTIVE" && current.first_anjo_message_at === null } : null,
    messages: page.messages,
    hasOlder: page.hasMore,
    canCancel: request.status === "WAITING",
    canClose: request.status === "IN_PROGRESS",
    peerReceipts: seen.peerReceipts,
    peerTypingMs: seen.peerTypingMs,
    readSeq: seen.ownReadSeq,
  }
}
