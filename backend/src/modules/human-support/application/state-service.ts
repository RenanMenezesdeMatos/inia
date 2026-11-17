import { assignmentScopesOf } from "../../access/application/permission-holders.js"
import { endedSessions } from "../../auth/application/session-ended.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { TransactionSource } from "../../../shared/infrastructure/database/transaction.js"
import { loadPersonPresentations } from "../../profile-preferences/application/person-presentation-loader.js"
import { HUMAN_SUPPORT_LIMITS, PRESENCE_STATUS_CAUSES, type AttendanceEndCause, type PauseReason, type PresenceStatus } from "../domain/catalogs.js"
import { evaluationOpenUntil } from "../domain/evaluation.js"
import { effectiveCapacity, presenceChange, scheduledFromRow, unresponsiveView, type PresenceRequest } from "../domain/presence.js"
import type { AnjoView, OperatorView, PendingEvaluation, SharedContext, StateResponse } from "../domain/views.js"
import { dispatchAfterCommand } from "./dispatch.js"
import { anyEnabledScope, availabilityFor, enabledForPlace, loadPlace, loadSettings } from "./eligibility.js"
import { loadConversationMarks } from "./conversation-marks.js"
import { bumpInboxVersions, readInboxVersion } from "./inbox-versions.js"
import { withOrganizationLock, type Queryable } from "./locks.js"
import { loadOpenRequestOf, operatorRequestView } from "./request-views.js"
import type { Viewer } from "./request-service.js"
import { lockPresence, recordPresenceEvent } from "./transitions.js"

/**
 * ESTADO DA PESSOA (design_draft.md seção 11): o que a chamada de estado devolve — a visão do operador (liga/desliga,
 * disponibilidade, pedido aberto com as últimas 50 mensagens, avaliações pendentes) e, para o Anjo com `workspace=anjo`, a visão do
 * Anjo. A visão do operador NUNCA tem presença ou pausa de Anjo. A chamada renova a presença do operador (pedido aberto) e a conexão
 * do Anjo (`lease_until`), sem trava e sem subir a versão; não renova a sessão.
 */
export async function renewOperatorPresence(db: Queryable, viewer: Viewer): Promise<void> {
  await db.query(
    `update human_support_requests set operator_seen_at = greatest(operator_seen_at, statement_timestamp())
      where organization_id = $1 and operator_person_id = $2 and status in ('WAITING', 'IN_PROGRESS', 'AWAITING_OPERATOR')`,
    [viewer.organizationId, viewer.personId],
  )
}

/** A sessão que fez a chamada (JWT): guardada na presença para dizer depois se a conexão caiu por rede ou porque a sessão terminou. */
export type SessionRef = { jti: string | null; accountId: string | null; expiresAt: Date | null }

/**
 * Renova a conexão do Anjo (75 s). Se ela tinha caído — ou estava fechada (área aberta de novo, migration 191: a conexão passa a ser
 * registrada em qualquer estado) —, marca a volta (a distribuição grava o evento com este instante, avisa o operador e zera o campo).
 */
export async function renewAnjoLease(db: Queryable, viewer: Viewer, session: SessionRef = { jti: null, accountId: null, expiresAt: null }): Promise<void> {
  await db.query(
    `insert into human_support_agent_presence as p (organization_id, person_id, lease_until, connection_restored_at, session_jti, session_account_id, session_expires_at)
     values ($1, $2, statement_timestamp() + make_interval(secs => $3::int), statement_timestamp(), $4, $5, $6)
     on conflict (organization_id, person_id) do update
        set lease_until = greatest(p.lease_until, excluded.lease_until),
            connection_restored_at = case when p.connection_lost_at is not null or p.lease_until is null then statement_timestamp() else p.connection_restored_at end,
            connection_lost_at = null,
            session_jti = coalesce(excluded.session_jti, p.session_jti),
            session_account_id = coalesce(excluded.session_account_id, p.session_account_id),
            session_expires_at = case when excluded.session_jti is not null then excluded.session_expires_at else p.session_expires_at end`,
    [viewer.organizationId, viewer.personId, HUMAN_SUPPORT_LIMITS.leaseSeconds, session.jti, session.accountId, session.expiresAt],
  )
}

export async function loadOperatorView(db: Queryable, viewer: Viewer): Promise<OperatorView> {
  const place = await loadPlace(db, viewer.organizationId, viewer.personId)
  const enabled = Boolean(place?.active) && (await enabledForPlace(db, viewer.organizationId, place ?? { teamId: null, subteamId: null }))
  const [open, pending] = await Promise.all([loadOpenRequestOf(db, viewer.organizationId, viewer.personId), loadPendingEvaluations(db, viewer)])
  return {
    enabled,
    availability: enabled && place ? await availabilityFor(db, viewer.organizationId, place, viewer.personId) : null,
    openRequest: open ? await operatorRequestView(db, open) : null,
    pendingEvaluations: pending,
  }
}

async function loadPendingEvaluations(db: Queryable, viewer: Viewer): Promise<PendingEvaluation[]> {
  const rows = (
    await db.query<{ id: string; request_id: string; protocol: string; anjo_person_id: string; ended_at: Date; end_cause: AttendanceEndCause; resolved: "YES" | "PARTIAL" | "NO" | null; stars: number | null }>(
      `select a.id, a.request_id, r.protocol, a.anjo_person_id, a.ended_at, a.end_cause, e.resolved, e.stars
         from human_support_attendances a
         join human_support_requests r on r.id = a.request_id
         left join human_support_evaluations e on e.attendance_id = a.id and e.superseded_at is null
        where a.organization_id = $1 and a.operator_person_id = $2 and a.status = 'ENDED' and a.end_cause not in ('ANJO_LOST', 'TRANSFERRED', 'ANJO_SILENT')
          and a.ended_at > statement_timestamp() - make_interval(secs => $3::int)
        order by a.ended_at desc limit 10`,
      [viewer.organizationId, viewer.personId, HUMAN_SUPPORT_LIMITS.evaluationWindowMs / 1000],
    )
  ).rows
  const names = await loadPersonPresentations(db, viewer.organizationId, rows.map((row) => row.anjo_person_id))
  return rows.flatMap((row) => {
    const until = evaluationOpenUntil({ endedAt: row.ended_at, endCause: row.end_cause })
    return until ? [{ attendanceId: row.id, requestId: row.request_id, protocol: row.protocol, anjoName: names.get(row.anjo_person_id)?.displayName ?? "Anjo", openUntil: until.toISOString(), current: { resolved: row.resolved, stars: row.stars === null ? null : Number(row.stars) } }] : []
  })
}

export async function loadAnjoView(db: Queryable, viewer: Viewer): Promise<AnjoView> {
  const settings = await loadSettings(db, viewer.organizationId)
  const presence = (
    await db.query<{ status: PresenceStatus; pause_reason: PauseReason | null; connected: boolean; status_since: Date; max_concurrent: number | null; scheduled_status: string | null; scheduled_pause_reason: string | null; scheduled_at: Date | null; last_status_cause: string | null; last_status_at: Date | null }>(
      `select p.status, p.pause_reason, coalesce(p.lease_until > statement_timestamp(), false) connected, p.status_since, p.max_concurrent, p.scheduled_status, p.scheduled_pause_reason, p.scheduled_at,
              (select e.cause from human_support_presence_events e where e.organization_id = p.organization_id and e.person_id = p.person_id and e.cause = any($3::text[]) order by e.id desc limit 1) last_status_cause,
              (select e.occurred_at from human_support_presence_events e where e.organization_id = p.organization_id and e.person_id = p.person_id and e.cause = any($3::text[]) order by e.id desc limit 1) last_status_at
         from human_support_agent_presence p where p.organization_id = $1 and p.person_id = $2`,
      [viewer.organizationId, viewer.personId, PRESENCE_STATUS_CAUSES],
    )
  ).rows[0]
  const attendances = (
    await db.query<{ id: string; request_id: string; protocol: string; operator_person_id: string; team_name: string | null; subteam_name: string | null; started_at: Date; first_anjo_message_at: Date | null; last_seq: number; operator_absent_since: Date | null; shared_context: SharedContext }>(
      `select a.id, a.request_id, r.protocol, a.operator_person_id, t.name team_name, st.name subteam_name, a.started_at, a.first_anjo_message_at, r.next_seq - 1 last_seq,
              case when r.operator_seen_at < statement_timestamp() - interval '60 seconds' then r.operator_seen_at end operator_absent_since, r.shared_context
         from human_support_attendances a
         join human_support_requests r on r.id = a.request_id
         left join teams t on t.id = r.team_id
         left join subteams st on st.id = r.subteam_id
        where a.organization_id = $1 and a.anjo_person_id = $2 and a.status = 'ACTIVE'
        order by a.started_at`,
      [viewer.organizationId, viewer.personId],
    )
  ).rows
  const pending = (
    await db.query<{ id: string; protocol: string; operator_person_id: string; started_at: Date; ended_at: Date; end_cause: AttendanceEndCause }>(
      `select a.id, r.protocol, a.operator_person_id, a.started_at, a.ended_at, a.end_cause
         from human_support_attendances a
         join human_support_requests r on r.id = a.request_id
         left join human_support_classifications c on c.attendance_id = a.id
        where a.organization_id = $1 and a.anjo_person_id = $2 and a.status = 'ENDED' and c.attendance_id is null and a.end_cause not in ('TRANSFERRED', 'ANJO_SILENT')
        order by a.ended_at desc limit 50`,
      [viewer.organizationId, viewer.personId],
    )
  ).rows
  // Disponível sem atendimento: o cronômetro conta da volta à disponibilidade — o fim do último atendimento, se veio depois da última
  // troca de estado (pedido do responsável em 11/11/2026: ao concluir os atendimentos, o tempo de "Disponível" recomeça).
  const lastEnded =
    presence?.status === "AVAILABLE" && attendances.length === 0
      ? ((await db.query<{ ended_at: Date | null }>(`select max(ended_at) ended_at from human_support_attendances where organization_id = $1 and anjo_person_id = $2 and status = 'ENDED'`, [viewer.organizationId, viewer.personId])).rows[0]?.ended_at ?? null)
      : null
  const since = presence?.status_since && lastEnded && lastEnded.getTime() > presence.status_since.getTime() ? lastEnded : (presence?.status_since ?? new Date())
  const [names, marks, clock, unread] = await Promise.all([
    loadPersonPresentations(db, viewer.organizationId, [...attendances.map((row) => row.operator_person_id), ...pending.map((row) => row.operator_person_id)]),
    loadConversationMarks(db, attendances.map((row) => row.request_id)),
    db.query<{ now: Date }>("select statement_timestamp() now"),
    loadAnjoUnread(db, attendances.map((row) => row.request_id)),
  ])
  const nameOf = (id: string) => names.get(id)?.displayName ?? "Operador"
  return {
    serverTime: (clock.rows[0]?.now ?? new Date()).toISOString(),
    presence: { status: presence?.status ?? "OFFLINE", pauseReason: presence?.pause_reason ?? null, connected: presence?.connected === true, since: since.toISOString(), scheduled: scheduledView(presence ?? null),
      unresponsive: presence ? unresponsiveView({ status: presence.status, pauseReason: presence.pause_reason, statusSince: presence.status_since, lastStatusCause: presence.last_status_cause, lastStatusAt: presence.last_status_at }, settings.anjoUnresponsive.offlineAfterMinutes) : null,
    },
    capacity: { max: effectiveCapacity(presence?.max_concurrent == null ? null : Number(presence.max_concurrent), settings.defaultCapacity), used: attendances.length },
    attendances: attendances.map((row) => ({
      id: row.id,
      requestId: row.request_id,
      protocol: row.protocol,
      operatorName: nameOf(row.operator_person_id),
      // Foto cadastrada do operador (a mesma imagem autorizada do perfil; null = iniciais na tela).
      operatorAvatarUrl: names.get(row.operator_person_id)?.avatarUrl ?? null,
      teamName: row.team_name,
      subteamName: row.subteam_name,
      startedAt: row.started_at.toISOString(),
      firstAnjoMessageAt: row.first_anjo_message_at?.toISOString() ?? null,
      lastSeq: Number(row.last_seq),
      operatorAbsentSince: row.operator_absent_since?.toISOString() ?? null,
      sharedContext: row.shared_context,
      peerReceipts: marks.get(row.request_id)!.anjo.peerReceipts,
      peerTypingMs: marks.get(row.request_id)!.anjo.peerTypingMs,
      unreadCount: unread.get(row.request_id) ?? 0,
    })),
    pendingClassifications: pending.map((row) => ({ attendanceId: row.id, protocol: row.protocol, operatorName: nameOf(row.operator_person_id), startedAt: row.started_at.toISOString(), endedAt: row.ended_at.toISOString(), endCause: row.end_cause })),
  }
}

/** Mensagens do operador além do "lida" do lado do Anjo, por pedido (marcas da 184; sem linha de marcas = nada lido). */
async function loadAnjoUnread(db: Queryable, requestIds: readonly string[]): Promise<Map<string, number>> {
  if (requestIds.length === 0) return new Map()
  const rows = (
    await db.query<{ request_id: string; total: number }>(
      `select m.request_id, count(*)::int total
         from human_support_messages m
         left join human_support_conversation_marks k on k.request_id = m.request_id
        where m.request_id = any($1::uuid[]) and m.author_kind = 'OPERATOR' and m.seq > coalesce(k.anjo_read_seq, 0)
        group by m.request_id`,
      [[...requestIds]],
    )
  ).rows
  return new Map(rows.map((row) => [row.request_id, Number(row.total)]))
}

function scheduledView(row: { scheduled_status: string | null; scheduled_pause_reason: string | null; scheduled_at: Date | null } | null): AnjoView["presence"]["scheduled"] {
  const scheduled = row ? scheduledFromRow(row) : null
  return scheduled && row?.scheduled_at ? { status: scheduled.status, pauseReason: scheduled.pauseReason, requestedAt: row.scheduled_at.toISOString() } : null
}

/** O Anjo tem o papel em algum escopo agora (o `workspace=anjo` sem ele é ignorado). */
export async function isAnjo(db: Queryable, viewer: Viewer): Promise<boolean> {
  return (await assignmentScopesOf(db, viewer.organizationId, "human_support.attend", [viewer.personId])).has(viewer.personId)
}

/**
 * O estado inteiro da pessoa (sem esperar). Renova a presença do operador antes de ler. `anjo` renova também a conexão do Anjo (só a
 * área do Anjo aberta conecta); `anjo-status` devolve a visão do Anjo SEM renovar a conexão — para mostrar o estado dele sem colocá-lo
 * em serviço.
 */
/**
 * Entrou de novo (outra sessão abriu a área) e a sessão ANTERIOR já terminou (logout, prazo, inatividade): o Anjo fica Indisponível
 * antes de a conexão ser renovada — fazer login e abrir a área nunca o deixa Disponível (decisão do responsável em 11/11/2026); ele
 * escolhe Disponível. Os atendimentos abertos continuam (regra de reconexão). Outra sessão ainda válida (duas abas, dois aparelhos)
 * não muda nada.
 */
export async function closeEndedSession(db: TransactionSource & Queryable, viewer: Viewer, session: SessionRef): Promise<boolean> {
  if (!session.jti) return false
  const previous = (
    await db.query<{ status: PresenceStatus; session_jti: string | null; session_account_id: string | null; session_expires_at: Date | null }>(
      `select status, session_jti, session_account_id, session_expires_at from human_support_agent_presence where organization_id = $1 and person_id = $2`,
      [viewer.organizationId, viewer.personId],
    )
  ).rows[0]
  if (!previous?.session_jti || previous.session_jti === session.jti || previous.status === "OFFLINE") return false
  const ended = await endedSessions(db, [{ jti: previous.session_jti, accountId: previous.session_account_id, expiresAt: previous.session_expires_at, at: new Date() }])
  if (!ended.has(previous.session_jti)) return false
  return withOrganizationLock(db, viewer.organizationId, async (client) => {
    const locked = await lockPresence(client, viewer.organizationId, viewer.personId)
    if (locked.status === "OFFLINE") return false
    await client.query(
      `update human_support_agent_presence set status = 'OFFLINE', pause_reason = null, status_since = statement_timestamp(), version = version + 1, scheduled_status = null, scheduled_pause_reason = null, scheduled_at = null
        where organization_id = $1 and person_id = $2 and session_jti = $3`,
      [viewer.organizationId, viewer.personId, previous.session_jti],
    )
    await recordPresenceEvent(client, { organizationId: viewer.organizationId, personId: viewer.personId, from: locked.status, to: "OFFLINE", pauseReason: null, cause: "SESSION_ENDED", sameInstantAsPresence: true })
    await bumpInboxVersions(client, viewer.organizationId, [viewer.personId])
    return true
  })
}

export async function loadState(db: TransactionSource & Queryable, viewer: Viewer, options: { workspace: "anjo" | "anjo-status" | "none"; anjo?: boolean; session?: SessionRef }): Promise<StateResponse> {
  const anjo = options.workspace !== "none" && (options.anjo ?? (await isAnjo(db, viewer)))
  await renewOperatorPresence(db, viewer)
  if (anjo && options.workspace === "anjo") {
    if (options.session) await closeEndedSession(db, viewer, options.session)
    await renewAnjoLease(db, viewer, options.session)
  }
  const version = await readInboxVersion(db, viewer.organizationId, viewer.personId)
  const [operator, anjoView] = await Promise.all([loadOperatorView(db, viewer), anjo ? loadAnjoView(db, viewer) : Promise.resolve(null)])
  return { version, operator, anjo: anjoView }
}

const presenceRefusalText: Record<string, string> = {
  HUMAN_SUPPORT_NOT_CONNECTED: "Abra a área do Anjo para ficar disponível.",
  HUMAN_SUPPORT_NO_ENABLED_SCOPE: "O apoio com Anjo não está ligado em nenhum escopo que você atende.",
  HUMAN_SUPPORT_PRESENCE_INVALID: "Fique disponível antes de entrar em pausa.",
}

/**
 * "Ficar disponível", pausa com motivo, "Voltar" e "Ficar indisponível" (seção 6). Sem atendimento em andamento, pausa e
 * indisponibilidade entram na hora; com atendimento, ficam PROGRAMADAS (migration 188) — o Anjo para de receber chamados já e o novo
 * estado entra ao terminar o último atendimento (`endAttendance`). Pedir de novo troca a programação; pedir o estado atual a desfaz.
 * Depois do commit, a distribuição.
 */
export async function changePresence(db: TransactionSource & Queryable, viewer: Viewer, requested: PresenceRequest): Promise<AnjoView> {
  const scopes = (await assignmentScopesOf(db, viewer.organizationId, "human_support.attend", [viewer.personId])).get(viewer.personId) ?? []
  const hasEnabledScope = await anyEnabledScope(db, viewer.organizationId, scopes)
  await withOrganizationLock(db, viewer.organizationId, async (client) => {
    const current = await lockPresence(client, viewer.organizationId, viewer.personId)
    const active = Number((await client.query<{ total: number }>(`select count(*)::int total from human_support_attendances where organization_id = $1 and anjo_person_id = $2 and status = 'ACTIVE'`, [viewer.organizationId, viewer.personId])).rows[0]!.total)
    const change = presenceChange({ status: current.status, pauseReason: current.pause_reason, scheduled: current.scheduled }, requested, { connected: current.connected, hasEnabledScope, activeAttendances: active })
    if (!change.ok) throw new DomainError(presenceRefusalText[change.code] ?? "Não foi possível mudar o estado.", change.code, 409)
    if (change.kind === "NONE") return
    if (change.kind === "APPLY") {
      await client.query(
        `update human_support_agent_presence set status = $3, pause_reason = $4, status_since = statement_timestamp(), scheduled_status = null, scheduled_pause_reason = null, scheduled_at = null, version = version + 1
          where organization_id = $1 and person_id = $2`,
        [viewer.organizationId, viewer.personId, change.status, change.pauseReason],
      )
      await recordPresenceEvent(client, { organizationId: viewer.organizationId, personId: viewer.personId, from: current.status, to: change.status, pauseReason: change.pauseReason, cause: "ANJO" })
    } else {
      // Programar ou desfazer não muda o estado nem gera evento de presença (o cronômetro e as horas contam da transição efetiva).
      const scheduled = change.kind === "SCHEDULE" ? change.scheduled : null
      await client.query(
        `update human_support_agent_presence set scheduled_status = $3, scheduled_pause_reason = $4, scheduled_at = case when $3::text is null then null else statement_timestamp() end, version = version + 1
          where organization_id = $1 and person_id = $2`,
        [viewer.organizationId, viewer.personId, scheduled?.status ?? null, scheduled?.pauseReason ?? null],
      )
    }
    await bumpInboxVersions(client, viewer.organizationId, [viewer.personId])
  })
  await dispatchAfterCommand(db, viewer.organizationId)
  return loadAnjoView(db, viewer)
}

/** "Cancelar programação": o estado atual fica e o Anjo volta a poder receber chamados (se Disponível). Sem programação, nada muda. */
export async function cancelScheduledPresence(db: TransactionSource & Queryable, viewer: Viewer): Promise<AnjoView> {
  await withOrganizationLock(db, viewer.organizationId, async (client) => {
    const current = await lockPresence(client, viewer.organizationId, viewer.personId)
    if (!current.scheduled) return
    await client.query(
      `update human_support_agent_presence set scheduled_status = null, scheduled_pause_reason = null, scheduled_at = null, version = version + 1 where organization_id = $1 and person_id = $2`,
      [viewer.organizationId, viewer.personId],
    )
    await bumpInboxVersions(client, viewer.organizationId, [viewer.personId])
  })
  await dispatchAfterCommand(db, viewer.organizationId)
  return loadAnjoView(db, viewer)
}
