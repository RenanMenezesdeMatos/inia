import { assignmentScopesOf } from "../../access/application/permission-holders.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { TransactionSource } from "../../../shared/infrastructure/database/transaction.js"
import { loadPersonPresentations } from "../../profile-preferences/application/person-presentation-loader.js"
import { HUMAN_SUPPORT_LIMITS, type AttendanceEndCause, type PauseReason, type PresenceStatus } from "../domain/catalogs.js"
import { evaluationOpenUntil } from "../domain/evaluation.js"
import { effectiveCapacity, presenceChange, scheduledFromRow, type PresenceRequest } from "../domain/presence.js"
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
      where organization_id = $1 and operator_person_id = $2 and status in ('WAITING', 'IN_PROGRESS')`,
    [viewer.organizationId, viewer.personId],
  )
}

/** Renova a conexão do Anjo (75 s). Se ela tinha caído, marca a volta (a distribuição avisa o operador e zera o campo). */
export async function renewAnjoLease(db: Queryable, viewer: Viewer): Promise<void> {
  await db.query(
    `insert into human_support_agent_presence as p (organization_id, person_id, lease_until)
     values ($1, $2, statement_timestamp() + make_interval(secs => $3::int))
     on conflict (organization_id, person_id) do update
        set lease_until = greatest(p.lease_until, excluded.lease_until),
            connection_restored_at = case when p.connection_lost_at is not null then statement_timestamp() else p.connection_restored_at end,
            connection_lost_at = null`,
    [viewer.organizationId, viewer.personId, HUMAN_SUPPORT_LIMITS.leaseSeconds],
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
        where a.organization_id = $1 and a.operator_person_id = $2 and a.status = 'ENDED' and a.end_cause <> 'ANJO_LOST'
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
    await db.query<{ status: PresenceStatus; pause_reason: PauseReason | null; connected: boolean; status_since: Date; max_concurrent: number | null; scheduled_status: string | null; scheduled_pause_reason: string | null; scheduled_at: Date | null }>(
      `select status, pause_reason, coalesce(lease_until > statement_timestamp(), false) connected, status_since, max_concurrent, scheduled_status, scheduled_pause_reason, scheduled_at
         from human_support_agent_presence where organization_id = $1 and person_id = $2`,
      [viewer.organizationId, viewer.personId],
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
        where a.organization_id = $1 and a.anjo_person_id = $2 and a.status = 'ENDED' and c.attendance_id is null
        order by a.ended_at desc limit 50`,
      [viewer.organizationId, viewer.personId],
    )
  ).rows
  const [names, marks, clock] = await Promise.all([
    loadPersonPresentations(db, viewer.organizationId, [...attendances.map((row) => row.operator_person_id), ...pending.map((row) => row.operator_person_id)]),
    loadConversationMarks(db, attendances.map((row) => row.request_id)),
    db.query<{ now: Date }>("select statement_timestamp() now"),
  ])
  const nameOf = (id: string) => names.get(id)?.displayName ?? "Operador"
  return {
    serverTime: (clock.rows[0]?.now ?? new Date()).toISOString(),
    presence: { status: presence?.status ?? "OFFLINE", pauseReason: presence?.pause_reason ?? null, connected: presence?.connected === true, since: (presence?.status_since ?? new Date()).toISOString(), scheduled: scheduledView(presence ?? null) },
    capacity: { max: effectiveCapacity(presence?.max_concurrent == null ? null : Number(presence.max_concurrent), settings.defaultCapacity), used: attendances.length },
    attendances: attendances.map((row) => ({
      id: row.id,
      requestId: row.request_id,
      protocol: row.protocol,
      operatorName: nameOf(row.operator_person_id),
      teamName: row.team_name,
      subteamName: row.subteam_name,
      startedAt: row.started_at.toISOString(),
      firstAnjoMessageAt: row.first_anjo_message_at?.toISOString() ?? null,
      lastSeq: Number(row.last_seq),
      operatorAbsentSince: row.operator_absent_since?.toISOString() ?? null,
      sharedContext: row.shared_context,
      peerReceipts: marks.get(row.request_id)!.anjo.peerReceipts,
      peerTypingMs: marks.get(row.request_id)!.anjo.peerTypingMs,
    })),
    pendingClassifications: pending.map((row) => ({ attendanceId: row.id, protocol: row.protocol, operatorName: nameOf(row.operator_person_id), startedAt: row.started_at.toISOString(), endedAt: row.ended_at.toISOString(), endCause: row.end_cause })),
  }
}

function scheduledView(row: { scheduled_status: string | null; scheduled_pause_reason: string | null; scheduled_at: Date | null } | null): AnjoView["presence"]["scheduled"] {
  const scheduled = row ? scheduledFromRow(row) : null
  return scheduled && row?.scheduled_at ? { status: scheduled.status, pauseReason: scheduled.pauseReason, requestedAt: row.scheduled_at.toISOString() } : null
}

/** O Anjo tem o papel em algum escopo agora (o `workspace=anjo` sem ele é ignorado). */
export async function isAnjo(db: Queryable, viewer: Viewer): Promise<boolean> {
  return (await assignmentScopesOf(db, viewer.organizationId, "human_support.attend", [viewer.personId])).has(viewer.personId)
}

/** O estado inteiro da pessoa (sem esperar). Renova as presenças antes de ler. */
export async function loadState(db: Queryable, viewer: Viewer, options: { workspace: "anjo" | "none"; anjo?: boolean }): Promise<StateResponse> {
  const anjo = options.workspace === "anjo" && (options.anjo ?? (await isAnjo(db, viewer)))
  await renewOperatorPresence(db, viewer)
  if (anjo) await renewAnjoLease(db, viewer)
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
