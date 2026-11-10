import { closeConversationAfterHumanSupport } from "../../assistant/application/support-context.js"
import { END_SYSTEM_CODE, type AttendanceEndCause, type PauseReason, type PresenceEventCause, type PresenceStatus, type RequestEndCause, type RequestEventCause, type RequestStatus, type SystemMessageCode } from "../domain/catalogs.js"
import type { Queryable } from "./locks.js"

/**
 * ESCRITAS de transição usadas pelos comandos e pela distribuição — sempre condicionais (`where status = <esperado>`) e sempre com o
 * evento (estado anterior, novo, causa, ator; ator nulo = sistema) e a mensagem de sistema de quem lê. Quem chama já tem a trava da
 * organização e a linha do pedido (`for update`), nessa ordem.
 */
export class TransitionConflict extends Error {
  constructor(readonly requestId: string) {
    super("O pedido mudou de estado ao mesmo tempo.")
    this.name = "TransitionConflict"
  }
}

/** Mensagem de sistema no fim da conversa do pedido (`seq` = o próximo do pedido; trava a linha do pedido). */
export async function appendSystemMessage(client: Queryable, request: { id: string; organizationId: string; operatorPersonId: string }, attendanceId: string | null, code: SystemMessageCode): Promise<void> {
  await client.query(
    `with next as (update human_support_requests set next_seq = next_seq + 1 where id = $1 returning next_seq - 1 as seq)
     insert into human_support_messages (organization_id, request_id, attendance_id, operator_person_id, author_kind, body, system_code, seq, occurred_at)
     select $2, $1, $3, $4, 'SYSTEM', '', $5, next.seq, statement_timestamp() from next`,
    [request.id, request.organizationId, attendanceId, request.operatorPersonId, code],
  )
}

export async function recordRequestEvent(client: Queryable, input: { organizationId: string; requestId: string; from: RequestStatus | null; to: RequestStatus; cause: RequestEventCause; actorPersonId: string | null }): Promise<void> {
  await client.query(
    `insert into human_support_request_events (organization_id, request_id, from_status, to_status, cause, actor_person_id, occurred_at) values ($1, $2, $3, $4, $5, $6, statement_timestamp())`,
    [input.organizationId, input.requestId, input.from, input.to, input.cause, input.actorPersonId],
  )
}

type RequestRef = { id: string; organizationId: string; operatorPersonId: string }
const finalStatusOf = (cause: RequestEndCause): RequestStatus =>
  cause === "OPERATOR_CANCELLED" || cause === "SCOPE_DISABLED" ? "CANCELLED" : cause === "QUEUE_EXPIRED" ? "EXPIRED" : cause === "OPERATOR_ABANDONED" ? "ABANDONED" : "CLOSED"

/** Termina o pedido (estado final pela causa), com evento e mensagem de sistema. `from` = o estado esperado agora. */
export async function endRequest(client: Queryable, request: RequestRef, input: { from: RequestStatus; cause: RequestEndCause; actorPersonId: string | null; attendanceId?: string | null }): Promise<RequestStatus> {
  const to = finalStatusOf(input.cause)
  const updated = await client.query<{ source_conversation_id: string | null }>(
    `update human_support_requests set status = $3, end_cause = $4, ended_at = statement_timestamp() where id = $1 and organization_id = $2 and status = $5
     returning source_conversation_id`,
    [request.id, request.organizationId, to, input.cause, input.from],
  )
  if (updated.rowCount !== 1) throw new TransitionConflict(request.id)
  await recordRequestEvent(client, { organizationId: request.organizationId, requestId: request.id, from: input.from, to, cause: input.cause, actorPersonId: input.actorPersonId })
  await appendSystemMessage(client, request, input.attendanceId ?? null, END_SYSTEM_CODE[input.cause])
  // Terminou um atendimento (havia chat com o Anjo): a conversa com a INIA de onde o pedido saiu é encerrada — a próxima pergunta
  // abre conversa nova. Pedido que saiu da fila sem atendimento (cancelado, expirado, abandonado, apoio desligado) não mexe nela.
  const sourceConversationId = updated.rows[0]?.source_conversation_id ?? null
  if (input.from === "IN_PROGRESS" && sourceConversationId) {
    await closeConversationAfterHumanSupport(client, { organizationId: request.organizationId, ownerPersonId: request.operatorPersonId, conversationId: sourceConversationId })
  }
  return to
}

/** Termina o atendimento em andamento (encerrado ou interrompido). */
export async function endAttendance(client: Queryable, attendanceId: string, cause: AttendanceEndCause): Promise<void> {
  const updated = await client.query(`update human_support_attendances set status = 'ENDED', end_cause = $2, ended_at = statement_timestamp() where id = $1 and status = 'ACTIVE'`, [attendanceId, cause])
  if (updated.rowCount !== 1) throw new TransitionConflict(attendanceId)
}

export async function recordPresenceEvent(client: Queryable, input: { organizationId: string; personId: string; from: PresenceStatus | null; to: PresenceStatus; pauseReason: PauseReason | null; cause: PresenceEventCause }): Promise<void> {
  await client.query(
    `insert into human_support_presence_events (organization_id, person_id, from_status, to_status, pause_reason, cause, occurred_at) values ($1, $2, $3, $4, $5, $6, statement_timestamp())`,
    [input.organizationId, input.personId, input.from, input.to, input.pauseReason, input.cause],
  )
}

/** Garante a linha de presença do Anjo (Indisponível) e a devolve travada. */
export async function lockPresence(client: Queryable, organizationId: string, personId: string): Promise<{ status: PresenceStatus; pause_reason: PauseReason | null; max_concurrent: number | null; lease_until: Date | null; connected: boolean; status_since: Date }> {
  await client.query(`insert into human_support_agent_presence (organization_id, person_id) values ($1, $2) on conflict (organization_id, person_id) do nothing`, [organizationId, personId])
  return (
    await client.query<{ status: PresenceStatus; pause_reason: PauseReason | null; max_concurrent: number | null; lease_until: Date | null; connected: boolean; status_since: Date }>(
      `select status, pause_reason, max_concurrent, lease_until, coalesce(lease_until > statement_timestamp(), false) connected, status_since from human_support_agent_presence where organization_id = $1 and person_id = $2 for update`,
      [organizationId, personId],
    )
  ).rows[0]!
}
