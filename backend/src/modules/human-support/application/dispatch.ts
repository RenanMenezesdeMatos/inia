import type pg from "pg"
import { assignmentScopesOf, personIdsWithPermissionCovering } from "../../access/application/permission-holders.js"
import type { AccessScope } from "../../access/domain/access-scope.js"
import { endedSessions } from "../../auth/application/session-ended.js"
import { recordPersonalDataAccess } from "../../data-lifecycle/application/personal-data-access-log.js"
import { inTransaction, type TransactionSource } from "../../../shared/infrastructure/database/transaction.js"
import { HUMAN_SUPPORT_LIMITS, type PauseReason, type PresenceStatus } from "../domain/catalogs.js"
import { silentSide } from "../domain/request-lifecycle.js"
import { effectiveCapacity } from "../domain/presence.js"
import { anjosInServiceCount, enabledWith, loadScopeStates, loadSettings, queueDeadlineFor } from "./eligibility.js"
import { bumpInboxVersions } from "./inbox-versions.js"
import { tryOrganizationLock, type Queryable } from "./locks.js"
import { loadAnjoUniverseGate } from "./universe-gate.js"
import { endIfNoAnjoInService } from "./no-anjo.js"
import { humanSupportStats, recordDeadlineLag } from "./runtime-stats.js"
import { appendSystemMessage, endAttendance, endRequest, recordPresenceEvent, recordRequestEvent } from "./transitions.js"

/**
 * DISTRIBUIÇÃO (design_draft.md seção 8). Roda depois do commit de cada comando e pela tarefa periódica `human-support-dispatch`
 * (3 s, uma instância por vez no conjunto), em transação própria com `pg_try_advisory_xact_lock` na chave da organização: se outro
 * processo já distribui, pula. É ela quem cumpre os prazos e quem conta ao operador o que aconteceu com o Anjo. Passos, em ordem:
 *  1. conexão do Anjo vencida → aviso ao operador; conexão de volta → "O Anjo voltou". Desde a migration 191 a conexão é registrada em
 *     QUALQUER estado (também Indisponível: separa o indisponível com a área aberta do offline), com o instante real (o prazo que
 *     venceu, a renovação que a trouxe de volta) e com a causa: `SESSION_ENDED` quando a sessão que mantinha a área já tinha
 *     terminado (logout, prazo do login, inatividade, conta desligada), `CONNECTION_LOST` quando foi a rede;
 *  2. sem conexão há mais de 3 min além do prazo → Indisponível (LEASE_EXPIRED);
 *  3. atendimento cujo Anjo sumiu (3 min além do prazo) ou perdeu o papel no escopo do pedido → Interrompido (`lost_cause`: rede,
 *     sessão ou papel), pedido de volta à frente da fila com novo prazo;
 *  4. tempos de resposta (migration 193, configuráveis): o OPERADOR sem responder ao Anjo → atendimento termina (`OPERATOR_SILENT`) e o
 *     pedido passa a Aguardando o operador; o ANJO sem responder (nem a primeira vez, ou depois do operador) → atendimento termina
 *     (`ANJO_SILENT`, abandono do Anjo) e o pedido volta à FRENTE da fila, para qualquer Anjo; aguardando o operador além do 2º tempo
 *     → Abandonado (`OPERATOR_NO_RETURN`);
 *  5. fila: escopo desligado → Cancelado; operador sem chamar há 2 min → Abandonado; prazo vencido → Expirado — guardando quantos Anjos
 *     estavam em serviço no escopo nesse instante (`anjos_in_service_at_end`: zero = encerrado sem Anjo logado);
 *  6. Anjo sem o papel em nenhum escopo → Indisponível (ROLE_REVOKED);
 *  7. cada pedido da fila, por ordem de chegada, vai ao Anjo que pode receber (Disponível, conectado, com vaga e SEM pausa ou
 *     indisponibilidade programada; com o universo de atuação ativado, do universo do operador ou com a permissão de todos) com menos atendimentos e, no empate, ao que recebeu
 *     há mais tempo — sem aceite (D2). Um savepoint por pedido: a falha de um vai para o log e não para os outros.
 * Depois do commit, o registro LGPD da leitura da cópia pelo Anjo (falha não desfaz a atribuição).
 */
export type DispatchSummary = {
  skipped: boolean
  connectionLost: number
  connectionRestored: number
  offline: number
  interrupted: number
  awaitingOperator: number
  anjoSilent: number
  operatorNoReturn: number
  /** Voltaria à fila sem ninguém do Apoio em serviço → encerrado (migration 194). */
  noAnjoInService: number
  /** Anjos postos em pausa "Desconexão" por não responder ninguém (migration 195). */
  unresponsivePaused: number
  cancelled: number
  abandoned: number
  expired: number
  assigned: number
  failures: number
}

const emptySummary = (): DispatchSummary => ({ skipped: false, connectionLost: 0, connectionRestored: 0, offline: 0, interrupted: 0, awaitingOperator: 0, anjoSilent: 0, operatorNoReturn: 0, noAnjoInService: 0, unresponsivePaused: 0, cancelled: 0, abandoned: 0, expired: 0, assigned: 0, failures: 0 })

const coversPlace = (scope: AccessScope, place: { teamId: string | null; subteamId: string | null }) =>
  scope.type === "ORGANIZATION" || (scope.type === "GROUP" && place.teamId === scope.teamId) || (scope.type === "SUBGROUP" && place.subteamId === scope.subteamId)

type Assignment = { requestId: string; anjoPersonId: string; operatorPersonId: string }

async function lockRequestRow(client: Queryable, requestId: string) {
  return (await client.query<{ status: string }>(`select status from human_support_requests where id = $1 for update`, [requestId])).rows[0]?.status ?? null
}

export async function dispatchOrganization(db: TransactionSource, organizationId: string): Promise<DispatchSummary> {
  const summary = emptySummary()
  const assignments: Assignment[] = []
  let ran: boolean
  try {
    ran = await inTransaction(db, (client) => runSteps(client, organizationId, summary, assignments), { savepoint: "human_support_dispatch" })
  } catch (error) {
    humanSupportStats.dispatchFailures += 1
    console.error(JSON.stringify({ event: "human_support_dispatch_failed", message: (error as Error).message }))
    throw error
  }
  if (!ran) {
    humanSupportStats.dispatchSkipped += 1
    return { ...summary, skipped: true }
  }
  humanSupportStats.dispatchRuns += 1
  humanSupportStats.assignments += assignments.length
  // Depois do commit: o Anjo passou a ler a cópia da troca do operador (uma linha por atribuição).
  for (const assignment of assignments) {
    const ok = await recordPersonalDataAccess(db, { organizationId, viewerPersonId: assignment.anjoPersonId, subjectPersonId: assignment.operatorPersonId, dataKind: "HUMAN_SUPPORT_CONVERSATION", resourceId: assignment.requestId })
    if (!ok) humanSupportStats.personalDataLogFailures += 1
  }
  return summary
}

/** Distribuição depois de um comando: nunca derruba a resposta do comando (a tarefa periódica tenta de novo em 3 s). */
export async function dispatchAfterCommand(db: TransactionSource, organizationId: string): Promise<void> {
  await dispatchOrganization(db, organizationId).catch(() => undefined)
}

async function runSteps(client: pg.PoolClient, organizationId: string, summary: DispatchSummary, assignments: Assignment[]): Promise<boolean> {
  if (!(await tryOrganizationLock(client, organizationId))) return false
  const touched = new Set<string>()
  const [settings, states] = await Promise.all([loadSettings(client, organizationId), loadScopeStates(client, organizationId)])
  const graceSeconds = HUMAN_SUPPORT_LIMITS.graceMs / 1000

  /** Mensagem de sistema em cada atendimento em andamento de um Anjo (trava o pedido antes de escrever). */
  const noticeActiveAttendances = async (anjoPersonId: string, code: "ANJO_CONNECTION_LOST" | "ANJO_CONNECTION_RESTORED") => {
    const attendances = (await client.query<{ id: string; request_id: string; operator_person_id: string }>(`select id, request_id, operator_person_id from human_support_attendances where organization_id = $1 and anjo_person_id = $2 and status = 'ACTIVE' order by request_id`, [organizationId, anjoPersonId])).rows
    for (const attendance of attendances) {
      await lockRequestRow(client, attendance.request_id)
      await appendSystemMessage(client, { id: attendance.request_id, organizationId, operatorPersonId: attendance.operator_person_id }, attendance.id, code)
      touched.add(attendance.operator_person_id).add(anjoPersonId)
    }
  }

  // 1. Conexão perdida (o prazo de 75 s passou) e conexão de volta — em qualquer estado (migration 191), no instante real.
  const lost = (
    await client.query<{ person_id: string; status: PresenceStatus; pause_reason: PauseReason | null; lease_until: Date; session_jti: string | null; session_account_id: string | null; session_expires_at: Date | null }>(
      `update human_support_agent_presence p set connection_lost_at = p.lease_until
        where p.organization_id = $1 and p.connection_lost_at is null and p.lease_until is not null and p.lease_until <= statement_timestamp()
        returning p.person_id, p.status, p.pause_reason, p.lease_until, p.session_jti, p.session_account_id, p.session_expires_at`,
      [organizationId],
    )
  ).rows
  const sessionsEnded = await endedSessions(client, lost.flatMap((presence) => (presence.session_jti ? [{ jti: presence.session_jti, accountId: presence.session_account_id, expiresAt: presence.session_expires_at, at: presence.lease_until }] : [])))
  for (const presence of lost) {
    const cause = presence.session_jti && sessionsEnded.has(presence.session_jti) ? "SESSION_ENDED" : "CONNECTION_LOST"
    if (cause === "SESSION_ENDED") {
      // A sessão terminou: Indisponível na hora (a programação some). Os atendimentos abertos seguem a regra de reconexão (3 min).
      await client.query(
        `update human_support_agent_presence set status = 'OFFLINE', pause_reason = null, status_since = $3, version = version + 1, scheduled_status = null, scheduled_pause_reason = null, scheduled_at = null
          where organization_id = $1 and person_id = $2`,
        [organizationId, presence.person_id, presence.lease_until],
      )
      touched.add(presence.person_id)
    }
    await recordPresenceEvent(client, { organizationId, personId: presence.person_id, from: presence.status, to: cause === "SESSION_ENDED" ? "OFFLINE" : presence.status, pauseReason: cause === "SESSION_ENDED" ? null : presence.pause_reason, cause, occurredAt: presence.lease_until })
    await noticeActiveAttendances(presence.person_id, "ANJO_CONNECTION_LOST")
    summary.connectionLost += 1
  }
  const restored = (
    await client.query<{ person_id: string; status: PresenceStatus; pause_reason: PauseReason | null; restored_at: Date }>(
      `update human_support_agent_presence p set connection_restored_at = null
         from (select person_id, connection_restored_at from human_support_agent_presence where organization_id = $1 and connection_restored_at is not null for update) old
        where p.organization_id = $1 and p.person_id = old.person_id
        returning p.person_id, p.status, p.pause_reason, old.connection_restored_at restored_at`,
      [organizationId],
    )
  ).rows
  for (const presence of restored) {
    await recordPresenceEvent(client, { organizationId, personId: presence.person_id, from: presence.status, to: presence.status, pauseReason: presence.pause_reason, cause: "CONNECTION_RESTORED", occurredAt: presence.restored_at })
    await noticeActiveAttendances(presence.person_id, "ANJO_CONNECTION_RESTORED")
    summary.connectionRestored += 1
  }

  /** Presença → Indisponível por causa do sistema. A programação some junto: ela nunca devolve o Anjo à fila depois disso. */
  const goOffline = async (personId: string, cause: "LEASE_EXPIRED" | "ROLE_REVOKED" | "UNRESPONSIVE_TIMEOUT") => {
    const previous = (
      await client.query<{ status: PresenceStatus; pause_reason: PauseReason | null }>(
        `update human_support_agent_presence p set status = 'OFFLINE', pause_reason = null, status_since = statement_timestamp(), version = p.version + 1,
                scheduled_status = null, scheduled_pause_reason = null, scheduled_at = null
           from (select status, pause_reason from human_support_agent_presence where organization_id = $1 and person_id = $2 and status <> 'OFFLINE' for update) old
          where p.organization_id = $1 and p.person_id = $2
          returning old.status, old.pause_reason`,
        [organizationId, personId],
      )
    ).rows[0]
    if (!previous) return
    await recordPresenceEvent(client, { organizationId, personId, from: previous.status, to: "OFFLINE", pauseReason: null, cause })
    touched.add(personId)
    summary.offline += 1
  }

  // 2. Sem conexão há mais de 3 min além do prazo → Indisponível.
  const expiredLeases = (
    await client.query<{ person_id: string }>(
      `select person_id from human_support_agent_presence where organization_id = $1 and status <> 'OFFLINE' and (lease_until is null or lease_until < statement_timestamp() - make_interval(secs => $2::int)) order by person_id`,
      [organizationId, graceSeconds],
    )
  ).rows
  for (const presence of expiredLeases) await goOffline(presence.person_id, "LEASE_EXPIRED")

  // 3. Atendimentos cujo Anjo sumiu ou perdeu o papel no escopo do pedido → Interrompidos; pedido de volta à frente da fila.
  const active = (
    await client.query<{ id: string; request_id: string; anjo_person_id: string; operator_person_id: string; team_id: string | null; subteam_id: string | null; lost: boolean; session_ended: boolean }>(
      `select a.id, a.request_id, a.anjo_person_id, a.operator_person_id, r.team_id, r.subteam_id,
              (p.lease_until is null or p.lease_until < statement_timestamp() - make_interval(secs => $2::int)) lost,
              coalesce((select e.cause = 'SESSION_ENDED' from human_support_presence_events e
                         where e.organization_id = a.organization_id and e.person_id = a.anjo_person_id and e.cause in ('CONNECTION_LOST', 'SESSION_ENDED', 'CONNECTION_RESTORED')
                         order by e.occurred_at desc, e.id desc limit 1), false) session_ended
         from human_support_attendances a
         join human_support_requests r on r.id = a.request_id
         left join human_support_agent_presence p on p.organization_id = a.organization_id and p.person_id = a.anjo_person_id
        where a.organization_id = $1 and a.status = 'ACTIVE'
        order by a.request_id`,
      [organizationId, graceSeconds],
    )
  ).rows
  const anjoScopes = await assignmentScopesOf(client, organizationId, "human_support.attend", [...new Set(active.map((row) => row.anjo_person_id))])
  const stillActive: typeof active = []
  for (const attendance of active) {
    const covers = (anjoScopes.get(attendance.anjo_person_id) ?? []).some((scope) => coversPlace(scope, { teamId: attendance.team_id, subteamId: attendance.subteam_id }))
    if (!attendance.lost && covers) {
      stillActive.push(attendance)
      continue
    }
    if ((await lockRequestRow(client, attendance.request_id)) !== "IN_PROGRESS") continue
    await endAttendance(client, attendance.id, "ANJO_LOST")
    // Por que o sistema interrompeu: papel retirado no escopo, sessão encerrada ou queda de rede (migration 191).
    await client.query(`update human_support_attendances set lost_cause = $2 where id = $1`, [attendance.id, !covers ? "ROLE_REVOKED" : attendance.session_ended ? "SESSION" : "CONNECTION"])
    const deadline = await queueDeadlineFor(client, organizationId, { teamId: attendance.team_id, subteamId: attendance.subteam_id })
    await client.query(
      `update human_support_requests set status = 'WAITING', queue_expires_at = statement_timestamp() + make_interval(mins => $2::int), queue_deadline_basis = $3 where id = $1 and status = 'IN_PROGRESS'`,
      [attendance.request_id, deadline.minutes, deadline.basis],
    )
    await recordRequestEvent(client, { organizationId, requestId: attendance.request_id, from: "IN_PROGRESS", to: "WAITING", cause: "ANJO_LOST", actorPersonId: null })
    await appendSystemMessage(client, { id: attendance.request_id, organizationId, operatorPersonId: attendance.operator_person_id }, attendance.id, "ANJO_LEFT")
    touched.add(attendance.operator_person_id).add(attendance.anjo_person_id)
    summary.interrupted += 1
  }

  // 4. Tempos de resposta (migrations 193/194): os do Grupo do pedido, senão o padrão da organização; de quem era a vez, pela última
  //    mensagem humana do atendimento.
  const orgTimes = settings.responseTimes
  const silent = (
    await client.query<{ id: string; request_id: string; anjo_person_id: string; operator_person_id: string; team_id: string | null; subteam_id: string | null; last_human_message_at: Date; last_author: "OPERATOR" | "ANJO" | null; now: Date; operator_requeue_minutes: number; operator_close_minutes: number; anjo_requeue_minutes: number }>(
      `select a.id, a.request_id, a.anjo_person_id, a.operator_person_id, r.team_id, r.subteam_id, a.last_human_message_at, statement_timestamp() now,
              coalesce(g.operator_requeue_minutes, $2) operator_requeue_minutes, coalesce(g.operator_close_minutes, $3) operator_close_minutes, coalesce(g.anjo_requeue_minutes, $4) anjo_requeue_minutes,
              (select m.author_kind from human_support_messages m where m.request_id = a.request_id and m.attendance_id = a.id and m.author_kind <> 'SYSTEM' order by m.seq desc limit 1) last_author
         from human_support_attendances a
         join human_support_requests r on r.id = a.request_id
         left join human_support_group_response_times g on g.organization_id = r.organization_id and g.team_id = r.team_id and g.custom
        where a.organization_id = $1 and a.status = 'ACTIVE'
          and a.last_human_message_at < statement_timestamp() - make_interval(mins => least(coalesce(g.operator_requeue_minutes, $2), coalesce(g.anjo_requeue_minutes, $4))::int)
        order by a.request_id`,
      [organizationId, orgTimes.operatorRequeueMinutes, orgTimes.operatorCloseMinutes, orgTimes.anjoRequeueMinutes],
    )
  ).rows
  for (const attendance of silent) {
    if (!stillActive.some((row) => row.id === attendance.id)) continue
    const times = { operatorRequeueMinutes: Number(attendance.operator_requeue_minutes), operatorCloseMinutes: Number(attendance.operator_close_minutes), anjoRequeueMinutes: Number(attendance.anjo_requeue_minutes) }
    const side = silentSide({ lastHumanAuthor: attendance.last_author, lastHumanMessageAt: attendance.last_human_message_at, now: attendance.now, times })
    if (!side) continue
    if ((await lockRequestRow(client, attendance.request_id)) !== "IN_PROGRESS") continue
    const ref = { id: attendance.request_id, organizationId, operatorPersonId: attendance.operator_person_id }
    await endAttendance(client, attendance.id, side)
    if (side === "OPERATOR_SILENT") {
      // O Anjo fica livre; o pedido espera o operador. O 2º tempo conta da última mensagem do Anjo (a mesma origem do 1º).
      await client.query(`update human_support_requests set status = 'AWAITING_OPERATOR', awaiting_operator_since = $2 where id = $1 and status = 'IN_PROGRESS'`, [attendance.request_id, attendance.last_human_message_at])
      await recordRequestEvent(client, { organizationId, requestId: attendance.request_id, from: "IN_PROGRESS", to: "AWAITING_OPERATOR", cause: "OPERATOR_SILENT", actorPersonId: null })
      await appendSystemMessage(client, ref, attendance.id, "AWAITING_OPERATOR")
      summary.awaitingOperator += 1
    } else if (await endIfNoAnjoInService(client, { ...ref, teamId: attendance.team_id, subteamId: attendance.subteam_id }, { from: "IN_PROGRESS", attendanceId: attendance.id, actorPersonId: null })) {
      // Abandono do Anjo sem ninguém do Apoio em serviço para retomar: a regra de "ninguém em serviço" (migration 194), não a fila.
      summary.anjoSilent += 1
      summary.noAnjoInService += 1
    } else {
      // Abandono do Anjo: o pedido volta à FRENTE da fila (mantém o queued_at), com prazo novo, para qualquer Anjo.
      const deadline = await queueDeadlineFor(client, organizationId, { teamId: attendance.team_id, subteamId: attendance.subteam_id })
      await client.query(
        `update human_support_requests set status = 'WAITING', queue_expires_at = statement_timestamp() + make_interval(mins => $2::int), queue_deadline_basis = $3 where id = $1 and status = 'IN_PROGRESS'`,
        [attendance.request_id, deadline.minutes, deadline.basis],
      )
      await recordRequestEvent(client, { organizationId, requestId: attendance.request_id, from: "IN_PROGRESS", to: "WAITING", cause: "ANJO_SILENT", actorPersonId: null })
      await appendSystemMessage(client, ref, attendance.id, "ANJO_SILENT_REQUEUED")
      summary.anjoSilent += 1
    }
    touched.add(attendance.operator_person_id).add(attendance.anjo_person_id)
  }

  // 4b. Aguardando o operador além do tempo de encerramento (do Grupo do pedido, senão o padrão) → Abandonado (abandono do operador).
  const notReturned = (
    await client.query<{ id: string; operator_person_id: string }>(
      `select r.id, r.operator_person_id from human_support_requests r
         left join human_support_group_response_times g on g.organization_id = r.organization_id and g.team_id = r.team_id and g.custom
        where r.organization_id = $1 and r.status = 'AWAITING_OPERATOR' and r.awaiting_operator_since < statement_timestamp() - make_interval(mins => coalesce(g.operator_close_minutes, $2)::int)
        order by r.id for update of r`,
      [organizationId, orgTimes.operatorCloseMinutes],
    )
  ).rows
  for (const request of notReturned) {
    await endRequest(client, { id: request.id, organizationId, operatorPersonId: request.operator_person_id }, { from: "AWAITING_OPERATOR", cause: "OPERATOR_NO_RETURN", actorPersonId: null })
    touched.add(request.operator_person_id)
    summary.operatorNoReturn += 1
  }

  // 4c. Anjo sem responder NINGUÉM (migration 195): devendo resposta a algum operador (atendimento em andamento cuja última mensagem
  //     não é dele, ou atendimento que ele perdeu por falta de resposta) há `pauseAfterMinutes`, contados do primeiro retorno devido —
  //     ou do último sinal de vida dele, se veio depois: uma mensagem em QUALQUER atendimento ou uma mudança de estado feita por ele.
  //     → pausa "Desconexão" (o sistema, `UNRESPONSIVE`): para de receber pedidos; a programação some. Os atendimentos em andamento
  //     seguem a regra do "Anjo sem responder" (voltam à fila no tempo deles).
  const { pauseAfterMinutes, offlineAfterMinutes } = settings.anjoUnresponsive
  const unresponsive = (
    await client.query<{ person_id: string; status: PresenceStatus; pause_reason: PauseReason | null }>(
      `with owing as (
         -- Dois ramos disjuntos (em andamento × perdido por falta de resposta), cada um pelo seu índice (open e anjo_silent, 203),
         -- em vez de um OR que lia todos os atendimentos da organização.
         select a.anjo_person_id person_id, a.last_human_message_at owed_from, a.status, a.ended_at
           from human_support_attendances a
          where a.organization_id = $1 and a.status = 'ACTIVE'
            and coalesce((select m.author_kind from human_support_messages m where m.request_id = a.request_id and m.attendance_id = a.id and m.author_kind <> 'SYSTEM' order by m.seq desc limit 1), 'NONE') <> 'ANJO'
         union all
         select a.anjo_person_id, a.last_human_message_at, a.status, a.ended_at
           from human_support_attendances a
          where a.organization_id = $1 and a.end_cause = 'ANJO_SILENT' and a.ended_at > statement_timestamp() - make_interval(mins => $2::int * 2)
       ), alive as (
         select o.person_id,
                greatest((select max(m.occurred_at) from human_support_messages m where m.organization_id = $1 and m.author_kind = 'ANJO' and m.author_person_id = o.person_id),
                         (select max(e.occurred_at) from human_support_presence_events e where e.organization_id = $1 and e.person_id = o.person_id and e.cause = 'ANJO')) last_alive
           from (select distinct person_id from owing) o
       ), since as (
         select l.person_id, case when count(o.*) = 0 then null else greatest(min(o.owed_from), max(l.last_alive)) end unanswered_since
           from alive l
           left join owing o on o.person_id = l.person_id and (o.status = 'ACTIVE' or o.ended_at > coalesce(l.last_alive, '-infinity'::timestamptz))
          group by l.person_id
       )
       select p.person_id, p.status, p.pause_reason
         from human_support_agent_presence p
         join since s on s.person_id = p.person_id
        where p.organization_id = $1 and p.status <> 'OFFLINE' and p.pause_reason is distinct from 'DISCONNECTION'
          and s.unanswered_since <= statement_timestamp() - make_interval(mins => $2::int)
        order by p.person_id
        for update of p`,
      [organizationId, pauseAfterMinutes],
    )
  ).rows
  for (const presence of unresponsive) {
    await client.query(
      `update human_support_agent_presence set status = 'PAUSED', pause_reason = 'DISCONNECTION', status_since = statement_timestamp(), version = version + 1,
              scheduled_status = null, scheduled_pause_reason = null, scheduled_at = null
        where organization_id = $1 and person_id = $2`,
      [organizationId, presence.person_id],
    )
    await recordPresenceEvent(client, { organizationId, personId: presence.person_id, from: presence.status, to: "PAUSED", pauseReason: "DISCONNECTION", cause: "UNRESPONSIVE" })
    touched.add(presence.person_id)
    summary.unresponsivePaused += 1
  }
  // 4d. Na pausa "Desconexão" há `offlineAfterMinutes` sem voltar (escolher um estado) → Indisponível (`UNRESPONSIVE_TIMEOUT`).
  const timedOut = (
    await client.query<{ person_id: string }>(
      `select person_id from human_support_agent_presence
        where organization_id = $1 and status = 'PAUSED' and pause_reason = 'DISCONNECTION' and status_since <= statement_timestamp() - make_interval(mins => $2::int)
        order by person_id`,
      [organizationId, offlineAfterMinutes],
    )
  ).rows
  for (const presence of timedOut) await goOffline(presence.person_id, "UNRESPONSIVE_TIMEOUT")

  // 5. Fila: escopo desligado, operador sem chamar há 2 min, prazo vencido.
  const waiting = (
    await client.query<{ id: string; operator_person_id: string; team_id: string | null; subteam_id: string | null; avoid_anjo_person_id: string | null; expired: boolean; abandoned: boolean; expired_lag_ms: number }>(
      `select r.id, r.operator_person_id, r.team_id, r.subteam_id, r.avoid_anjo_person_id,
              r.queue_expires_at <= statement_timestamp() expired,
              r.operator_seen_at < statement_timestamp() - make_interval(secs => $2::int) abandoned,
              extract(epoch from statement_timestamp() - r.queue_expires_at)::float8 * 1000 expired_lag_ms
         from human_support_requests r
        where r.organization_id = $1 and r.status = 'WAITING'
        order by r.queued_at, r.id
        for update`,
      [organizationId, HUMAN_SUPPORT_LIMITS.operatorAbandonMs / 1000],
    )
  ).rows
  const queue: typeof waiting = []
  for (const request of waiting) {
    const ref = { id: request.id, organizationId, operatorPersonId: request.operator_person_id }
    const cause = !enabledWith(settings, states, { teamId: request.team_id, subteamId: request.subteam_id }) ? "SCOPE_DISABLED" : request.abandoned ? "OPERATOR_ABANDONED" : request.expired ? "QUEUE_EXPIRED" : null
    if (!cause) {
      queue.push(request)
      continue
    }
    await endRequest(client, ref, { from: "WAITING", cause, actorPersonId: null })
    await client.query(`update human_support_requests set anjos_in_service_at_end = $2 where id = $1`, [request.id, await anjosInServiceCount(client, organizationId, { teamId: request.team_id, subteamId: request.subteam_id }, request.operator_person_id)])
    touched.add(request.operator_person_id)
    if (cause === "SCOPE_DISABLED") summary.cancelled += 1
    else if (cause === "OPERATOR_ABANDONED") summary.abandoned += 1
    else {
      summary.expired += 1
      recordDeadlineLag(request.expired_lag_ms)
    }
  }

  // 6. Anjo com estado ≠ Indisponível sem o papel em nenhum escopo → Indisponível.
  const onDuty = (await client.query<{ person_id: string }>(`select person_id from human_support_agent_presence where organization_id = $1 and status <> 'OFFLINE' order by person_id`, [organizationId])).rows.map((row) => row.person_id)
  const dutyScopes = await assignmentScopesOf(client, organizationId, "human_support.attend", onDuty)
  for (const personId of onDuty) if (!dutyScopes.has(personId)) await goOffline(personId, "ROLE_REVOKED")

  // 7. Atribuição, por ordem de chegada (o pedido interrompido volta para a frente: mantém o queued_at).
  if (queue.length > 0) {
    const coverage = new Map<string, string[]>()
    for (const request of queue) {
      const key = `${request.team_id ?? ""}:${request.subteam_id ?? ""}`
      if (!coverage.has(key)) coverage.set(key, await personIdsWithPermissionCovering(client, organizationId, "human_support.attend", { teamId: request.team_id, subteamId: request.subteam_id }))
    }
    const candidateIds = [...new Set([...coverage.values()].flat())]
    const presence = new Map(
      (
        await client.query<{ person_id: string; status: PresenceStatus; connected: boolean; max_concurrent: number | null; last_assigned_at: Date | null; active_count: number; scheduled: boolean }>(
          `select p.person_id, p.status, p.lease_until > statement_timestamp() connected, p.max_concurrent, p.last_assigned_at, p.scheduled_status is not null scheduled,
                  (select count(*)::int from human_support_attendances a where a.organization_id = p.organization_id and a.anjo_person_id = p.person_id and a.status = 'ACTIVE') active_count
             from human_support_agent_presence p
            where p.organization_id = $1 and p.person_id = any($2::uuid[])`,
          [organizationId, candidateIds],
        )
      ).rows.map((row) => [row.person_id, { status: row.status, connected: row.connected === true, capacity: effectiveCapacity(row.max_concurrent === null ? null : Number(row.max_concurrent), settings.defaultCapacity), lastAssignedAt: row.last_assigned_at?.getTime() ?? null, active: row.active_count, scheduled: row.scheduled === true }]),
    )
    // Universo de atuação (exigência ativada): só Anjos do universo do operador ou com a permissão de todos cobrindo o lugar.
    const universeGate = await loadAnjoUniverseGate(client, organizationId)
    for (const request of queue) {
      const place = { teamId: request.team_id, subteamId: request.subteam_id }
      const covering = (coverage.get(`${request.team_id ?? ""}:${request.subteam_id ?? ""}`) ?? [])
        // Nunca o próprio operador; nem o Anjo de quem a coordenação tirou este pedido (devolução à fila, migration 190).
        .filter((personId) => personId !== request.operator_person_id && personId !== request.avoid_anjo_person_id)
      const candidates = (await universeGate.allowed(place, request.operator_person_id, covering))
        .flatMap((personId) => {
          const state = presence.get(personId)
          // Quem programou pausa ou indisponibilidade termina os atendimentos que tem e não recebe novos.
          return state && state.status === "AVAILABLE" && !state.scheduled && state.connected && state.active < state.capacity ? [{ personId, state }] : []
        })
        .sort((a, b) => a.state.active - b.state.active || (a.state.lastAssignedAt ?? -Infinity) - (b.state.lastAssignedAt ?? -Infinity) || a.personId.localeCompare(b.personId))
      const chosen = candidates[0]
      if (!chosen) continue
      await client.query("savepoint human_support_assign")
      try {
        const attendanceId = (
          await client.query<{ id: string }>(
            `insert into human_support_attendances (organization_id, request_id, anjo_person_id, operator_person_id, status, started_at, last_human_message_at)
             values ($1, $2, $3, $4, 'ACTIVE', statement_timestamp(), statement_timestamp()) returning id`,
            [organizationId, request.id, chosen.personId, request.operator_person_id],
          )
        ).rows[0]!.id
        const moved = await client.query(`update human_support_requests set status = 'IN_PROGRESS' where id = $1 and status = 'WAITING'`, [request.id])
        if (moved.rowCount !== 1) throw new Error("pedido saiu da fila")
        await recordRequestEvent(client, { organizationId, requestId: request.id, from: "WAITING", to: "IN_PROGRESS", cause: "ASSIGNED", actorPersonId: null })
        await appendSystemMessage(client, { id: request.id, organizationId, operatorPersonId: request.operator_person_id }, attendanceId, "ANJO_ASSIGNED")
        await client.query(`update human_support_agent_presence set last_assigned_at = statement_timestamp() where organization_id = $1 and person_id = $2`, [organizationId, chosen.personId])
        await client.query("release savepoint human_support_assign")
        chosen.state.active += 1
        chosen.state.lastAssignedAt = Date.now()
        touched.add(request.operator_person_id).add(chosen.personId)
        assignments.push({ requestId: request.id, anjoPersonId: chosen.personId, operatorPersonId: request.operator_person_id })
        summary.assigned += 1
      } catch (error) {
        await client.query("rollback to savepoint human_support_assign")
        await client.query("release savepoint human_support_assign")
        humanSupportStats.assignmentFailures += 1
        summary.failures += 1
        console.error(JSON.stringify({ event: "human_support_assignment_failed", requestId: request.id, message: (error as Error).message }))
      }
    }
  }

  await bumpInboxVersions(client, organizationId, touched)
  return true
}

/** Tarefa periódica: todas as organizações com algo para cumprir (configuração, pedido aberto ou Anjo fora de Indisponível). */
export async function dispatchAllOrganizations(db: TransactionSource & Queryable): Promise<{ organizations: number; assigned: number }> {
  const organizations = (
    await db.query<{ organization_id: string }>(
      `select organization_id from human_support_settings
       union select organization_id from human_support_requests where status in ('WAITING', 'IN_PROGRESS')
       union select organization_id from human_support_agent_presence
              where status <> 'OFFLINE' or connection_restored_at is not null or (connection_lost_at is null and lease_until is not null and lease_until <= statement_timestamp())`,
    )
  ).rows
  let assigned = 0
  for (const organization of organizations) {
    const summary = await dispatchOrganization(db, organization.organization_id).catch(() => null)
    assigned += summary?.assigned ?? 0
  }
  return { organizations: organizations.length, assigned }
}
