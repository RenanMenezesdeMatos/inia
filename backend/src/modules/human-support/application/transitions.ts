import { closeConversationAfterHumanSupport } from "../../assistant/application/support-context.js"
import { END_SYSTEM_CODE, type AttendanceEndCause, type PauseReason, type PresenceEventCause, type PresenceStatus, type RequestEndCause, type RequestEventCause, type RequestStatus, type SystemMessageCode } from "../domain/catalogs.js"
import { scheduledFromRow, scheduledToApply, type ScheduledPresence } from "../domain/presence.js"
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

/**
 * Termina o atendimento em andamento (encerrado ou interrompido) e, se era o ÚLTIMO do Anjo, aplica a pausa ou indisponibilidade que
 * ele programou — na MESMA transação, depois da linha do atendimento (ordem das travas em `locks.ts`). Assim não existe instante entre
 * o fim do último atendimento e o novo estado em que a fila possa atribuir um chamado a ele (e a distribuição já ignora quem tem
 * programação). Todos os caminhos passam por aqui: encerrar pelo Anjo ou pelo operador, inatividade e interrupção. Quem chama inclui
 * o Anjo nas versões a subir (a área dele acorda).
 */
export async function endAttendance(client: Queryable, attendanceId: string, cause: AttendanceEndCause): Promise<{ anjoPersonId: string; scheduledApplied: ScheduledPresence | null }> {
  const updated = await client.query<{ organization_id: string; anjo_person_id: string }>(
    `update human_support_attendances set status = 'ENDED', end_cause = $2, ended_at = statement_timestamp() where id = $1 and status = 'ACTIVE' returning organization_id, anjo_person_id`,
    [attendanceId, cause],
  )
  if (updated.rowCount !== 1) throw new TransitionConflict(attendanceId)
  const row = updated.rows[0]!
  return { anjoPersonId: row.anjo_person_id, scheduledApplied: await applyScheduledPresenceIfIdle(client, row.organization_id, row.anjo_person_id, attendanceId) }
}

/**
 * Aplica a programação do Anjo se ele não tem mais atendimento em andamento: o estado passa a ser o programado, `status_since` = agora
 * (a transição efetiva: daí contam o cronômetro e as horas em pausa; com `endedAttendanceId`, o instante exato — copiado no banco, sem
 * passar pelo `Date` do JavaScript, que cortaria os microssegundos — em que o atendimento terminou) e o evento leva a causa `ANJO_SCHEDULED`. Sem programação, ou
 * com atendimento ainda aberto, nada muda.
 */
export async function applyScheduledPresenceIfIdle(client: Queryable, organizationId: string, personId: string, endedAttendanceId: string | null = null): Promise<ScheduledPresence | null> {
  const presence = (
    await client.query<{ status: PresenceStatus; scheduled_status: string | null; scheduled_pause_reason: string | null }>(
      `select status, scheduled_status, scheduled_pause_reason from human_support_agent_presence where organization_id = $1 and person_id = $2 and scheduled_status is not null for update`,
      [organizationId, personId],
    )
  ).rows[0]
  if (!presence) return null
  const active = Number((await client.query<{ total: number }>(`select count(*)::int total from human_support_attendances where organization_id = $1 and anjo_person_id = $2 and status = 'ACTIVE'`, [organizationId, personId])).rows[0]!.total)
  const scheduled = scheduledToApply(scheduledFromRow(presence), active)
  if (!scheduled) return null
  await client.query(
    `update human_support_agent_presence
        set status = $3, pause_reason = $4, status_since = coalesce((select ended_at from human_support_attendances where id = $5::uuid), statement_timestamp()), scheduled_status = null, scheduled_pause_reason = null, scheduled_at = null, version = version + 1
      where organization_id = $1 and person_id = $2`,
    [organizationId, personId, scheduled.status, scheduled.pauseReason, endedAttendanceId],
  )
  await recordPresenceEvent(client, { organizationId, personId, from: presence.status, to: scheduled.status, pauseReason: scheduled.pauseReason, cause: "ANJO_SCHEDULED", sameInstantAsPresence: true })
  return scheduled
}

export async function recordPresenceEvent(client: Queryable, input: { organizationId: string; personId: string; from: PresenceStatus | null; to: PresenceStatus; pauseReason: PauseReason | null; cause: PresenceEventCause; sameInstantAsPresence?: boolean }): Promise<void> {
  // `sameInstantAsPresence`: o evento leva o `status_since` que acabou de ser gravado na presença (a transição efetiva).
  await client.query(
    `insert into human_support_presence_events (organization_id, person_id, from_status, to_status, pause_reason, cause, occurred_at)
     values ($1, $2, $3, $4, $5, $6, case when $7::boolean then (select status_since from human_support_agent_presence where organization_id = $1 and person_id = $2) else statement_timestamp() end)`,
    [input.organizationId, input.personId, input.from, input.to, input.pauseReason, input.cause, input.sameInstantAsPresence === true],
  )
}

type LockedPresence = { status: PresenceStatus; pause_reason: PauseReason | null; max_concurrent: number | null; lease_until: Date | null; connected: boolean; status_since: Date; scheduled_status: string | null; scheduled_pause_reason: string | null }

/** Garante a linha de presença do Anjo (Indisponível) e a devolve travada, com a programação. */
export async function lockPresence(client: Queryable, organizationId: string, personId: string): Promise<LockedPresence & { scheduled: ScheduledPresence | null }> {
  await client.query(`insert into human_support_agent_presence (organization_id, person_id) values ($1, $2) on conflict (organization_id, person_id) do nothing`, [organizationId, personId])
  const row = (
    await client.query<LockedPresence>(
      `select status, pause_reason, max_concurrent, lease_until, coalesce(lease_until > statement_timestamp(), false) connected, status_since, scheduled_status, scheduled_pause_reason
         from human_support_agent_presence where organization_id = $1 and person_id = $2 for update`,
      [organizationId, personId],
    )
  ).rows[0]!
  return { ...row, scheduled: scheduledFromRow(row) }
}
