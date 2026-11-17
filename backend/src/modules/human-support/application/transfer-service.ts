import { recordPersonalDataAccess } from "../../data-lifecycle/application/personal-data-access-log.js"
import { loadPersonPresentations } from "../../profile-preferences/application/person-presentation-loader.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { TransactionSource } from "../../../shared/infrastructure/database/transaction.js"
import { HUMAN_SUPPORT_LIMITS, type PresenceStatus } from "../domain/catalogs.js"
import { TRANSFER_NOT_ELIGIBLE_TEXT, transferDecision, type TransferTarget } from "../domain/transfer.js"
import type { RequestDetail } from "../domain/views.js"
import { recordHumanSupportAudit } from "./audit.js"
import { requestDetail } from "./coordination-service.js"
import { coordinatorScopesOf, coversRecord, operatorUniverseOf } from "./coverage.js"
import { dispatchAfterCommand } from "./dispatch.js"
import { anjosCovering, loadSettings, queueDeadlineFor } from "./eligibility.js"
import { bumpInboxVersions } from "./inbox-versions.js"
import { withOrganizationLock, type Queryable } from "./locks.js"
import type { Viewer } from "./request-service.js"
import { loadActiveAttendance, loadRequest } from "./request-views.js"
import { appendSystemMessage, endAttendance, recordRequestEvent } from "./transitions.js"

/**
 * TRANSFERÊNCIA PELA COORDENAÇÃO (migration 190; regra em `domain/transfer.ts`). Quem pode: o Coordenador de Anjos nos pedidos do
 * alcance dele e o Administrador geral (`human_support.coordinate`, rota do painel); fora do alcance o pedido "não existe" (404).
 *
 * Transferir para um Anjo, numa transação sob a trava da organização: o atendimento atual termina como `TRANSFERRED` (sem
 * classificação nem avaliação; se era o último do Anjo, a pausa ou indisponibilidade que ele programou entra), o pedido continua EM
 * ATENDIMENTO — mesmo protocolo, mesmas mensagens e recibos — com um atendimento NOVO para o outro Anjo (o prazo de inatividade
 * recomeça), a mensagem de sistema `ANJO_TRANSFERRED` no atendimento novo, o evento do pedido e o registro com o motivo. Depois do
 * commit, o registro LGPD de que o novo Anjo passou a ler a conversa.
 *
 * Devolver à fila: o atendimento termina igual, o pedido volta para a FRENTE da fila (mantém o `queued_at`) com prazo novo, guarda de
 * qual Anjo saiu (a distribuição não o devolve a ele) e a distribuição roda em seguida.
 */
export type TransferCandidate = {
  personId: string
  name: string
  status: PresenceStatus
  connected: boolean
  used: number
  capacity: number
  canReceive: boolean
  /** Por que não pode receber agora (null = pode). */
  reason: string | null
}

const notFound = () => new DomainError("Pedido de apoio não encontrado.", "HUMAN_SUPPORT_REQUEST_NOT_FOUND", 404)

async function loadReachableRequest(db: Queryable, viewer: Viewer, requestId: string) {
  const coverage = await coordinatorScopesOf(db, viewer.organizationId, viewer.personId)
  const request = await loadRequest(db, viewer.organizationId, requestId)
  if (!request || !coversRecord(coverage, { teamId: request.team_id, subteamId: request.subteam_id, operatorUniverse: await operatorUniverseOf(db, viewer.organizationId, coverage, request.operator_person_id) })) throw notFound()
  return request
}

/** Anjos do Grupo/Subgrupo do pedido, com o que cada um está fazendo agora e se pode receber (o atual vem marcado). */
export async function transferCandidates(db: Queryable, viewer: Viewer, requestId: string): Promise<{ currentAnjoName: string | null; candidates: TransferCandidate[] }> {
  const request = await loadReachableRequest(db, viewer, requestId)
  const settings = await loadSettings(db, viewer.organizationId)
  const active = await loadActiveAttendance(db, request.id)
  const anjos = await anjosCovering(db, viewer.organizationId, { teamId: request.team_id, subteamId: request.subteam_id }, request.operator_person_id, settings.defaultCapacity)
  const names = await loadPersonPresentations(db, viewer.organizationId, [...anjos.map((anjo) => anjo.personId), ...(active ? [active.anjo_person_id] : [])])
  const candidates = anjos.map((anjo): TransferCandidate => {
    const current = anjo.personId === active?.anjo_person_id
    const decision = current ? null : transferDecision({ requestStatus: "IN_PROGRESS", currentAnjoPersonId: active?.anjo_person_id ?? "-", target: { kind: "ANJO", anjoPersonId: anjo.personId }, targetSituation: anjo })
    const reason = current ? TRANSFER_NOT_ELIGIBLE_TEXT.CURRENT_ANJO : decision && !decision.ok ? TRANSFER_NOT_ELIGIBLE_TEXT[decision.notEligible ?? "NO_CAPACITY"] : null
    return { personId: anjo.personId, name: names.get(anjo.personId)?.displayName ?? "Anjo", status: anjo.status, connected: anjo.connected, used: anjo.activeAttendances, capacity: anjo.capacity, canReceive: reason === null, reason }
  })
  candidates.sort((a, b) => Number(b.canReceive) - Number(a.canReceive) || a.used - b.used || a.name.localeCompare(b.name, "pt-BR"))
  return { currentAnjoName: active ? (names.get(active.anjo_person_id)?.displayName ?? "Anjo") : null, candidates }
}

const refusalText: Record<string, string> = {
  HUMAN_SUPPORT_TRANSFER_NOT_IN_PROGRESS: "Este pedido não está em atendimento: não há o que transferir.",
  HUMAN_SUPPORT_TRANSFER_SAME_ANJO: "Este Anjo já está com o atendimento.",
}

export async function transferAttendance(db: TransactionSource & Queryable, viewer: Viewer, requestId: string, input: { target: TransferTarget; reason: string }): Promise<RequestDetail> {
  // O motivo é conferido aqui também (a rota já valida): curto, obrigatório, sem espaços nas pontas.
  const reason = input.reason.trim()
  if (reason.length < HUMAN_SUPPORT_LIMITS.transferReasonMin || reason.length > HUMAN_SUPPORT_LIMITS.transferReasonMax) {
    throw new DomainError(`Escreva o motivo da transferência (de ${HUMAN_SUPPORT_LIMITS.transferReasonMin} a ${HUMAN_SUPPORT_LIMITS.transferReasonMax} caracteres).`, "VALIDATION_ERROR", 400)
  }
  const reached = await loadReachableRequest(db, viewer, requestId)
  const settings = await loadSettings(db, viewer.organizationId)
  const place = { teamId: reached.team_id, subteamId: reached.subteam_id }
  const outcome = await withOrganizationLock(db, viewer.organizationId, async (client) => {
    const request = (await loadRequest(client, viewer.organizationId, requestId, { forUpdate: true }))!
    const attendance = await loadActiveAttendance(client, request.id, { forUpdate: true })
    const situation = input.target.kind === "ANJO" ? ((await anjosCovering(client, viewer.organizationId, place, request.operator_person_id, settings.defaultCapacity)).find((anjo) => anjo.personId === (input.target as { anjoPersonId: string }).anjoPersonId) ?? null) : null
    const decision = transferDecision({ requestStatus: request.status, currentAnjoPersonId: attendance?.anjo_person_id ?? null, target: input.target, targetSituation: situation })
    if (!decision.ok) {
      const text = decision.code === "HUMAN_SUPPORT_TRANSFER_TARGET_UNAVAILABLE" ? `Este Anjo não pode receber agora: ${TRANSFER_NOT_ELIGIBLE_TEXT[decision.notEligible ?? "NO_CAPACITY"].toLowerCase()}.` : refusalText[decision.code]!
      throw new DomainError(text, decision.code, 409)
    }
    const from = attendance!
    const ref = { id: request.id, organizationId: viewer.organizationId, operatorPersonId: request.operator_person_id }
    await endAttendance(client, from.id, "TRANSFERRED")
    let toAttendanceId: string | null = null
    if (input.target.kind === "ANJO") {
      toAttendanceId = (
        await client.query<{ id: string }>(
          `insert into human_support_attendances (organization_id, request_id, anjo_person_id, operator_person_id, status, started_at, last_human_message_at)
           values ($1, $2, $3, $4, 'ACTIVE', statement_timestamp(), statement_timestamp()) returning id`,
          [viewer.organizationId, request.id, input.target.anjoPersonId, request.operator_person_id],
        )
      ).rows[0]!.id
      await client.query(`update human_support_agent_presence set last_assigned_at = statement_timestamp() where organization_id = $1 and person_id = $2`, [viewer.organizationId, input.target.anjoPersonId])
      await recordRequestEvent(client, { organizationId: viewer.organizationId, requestId: request.id, from: "IN_PROGRESS", to: "IN_PROGRESS", cause: "TRANSFERRED", actorPersonId: viewer.personId })
      await appendSystemMessage(client, ref, toAttendanceId, "ANJO_TRANSFERRED")
    } else {
      const deadline = await queueDeadlineFor(client, viewer.organizationId, place)
      const moved = await client.query(
        `update human_support_requests set status = 'WAITING', queue_expires_at = statement_timestamp() + make_interval(mins => $2::int), queue_deadline_basis = $3, avoid_anjo_person_id = $4
          where id = $1 and status = 'IN_PROGRESS'`,
        [request.id, deadline.minutes, deadline.basis, from.anjo_person_id],
      )
      if (moved.rowCount !== 1) throw new DomainError(refusalText.HUMAN_SUPPORT_TRANSFER_NOT_IN_PROGRESS!, "HUMAN_SUPPORT_TRANSFER_NOT_IN_PROGRESS", 409)
      await recordRequestEvent(client, { organizationId: viewer.organizationId, requestId: request.id, from: "IN_PROGRESS", to: "WAITING", cause: "TRANSFERRED", actorPersonId: viewer.personId })
      await appendSystemMessage(client, ref, from.id, "TRANSFER_REQUEUED")
    }
    const toAnjo = input.target.kind === "ANJO" ? input.target.anjoPersonId : null
    await client.query(
      `insert into human_support_transfers (organization_id, request_id, from_attendance_id, to_attendance_id, from_anjo_person_id, to_anjo_person_id, actor_person_id, reason, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, statement_timestamp())`,
      [viewer.organizationId, request.id, from.id, toAttendanceId, from.anjo_person_id, toAnjo, viewer.personId, reason],
    )
    await recordHumanSupportAudit(client, { organizationId: viewer.organizationId, actorPersonId: viewer.personId, action: "HUMAN_SUPPORT_ATTENDANCE_TRANSFERRED", entityType: "human_support_request", entityId: request.id, payload: { fromAnjoPersonId: from.anjo_person_id, toAnjoPersonId: toAnjo, requeued: toAnjo === null } })
    await bumpInboxVersions(client, viewer.organizationId, [request.operator_person_id, from.anjo_person_id, toAnjo])
    return { toAnjo, operatorPersonId: request.operator_person_id }
  })
  if (outcome.toAnjo) {
    await recordPersonalDataAccess(db, { organizationId: viewer.organizationId, viewerPersonId: outcome.toAnjo, subjectPersonId: outcome.operatorPersonId, dataKind: "HUMAN_SUPPORT_CONVERSATION", resourceId: requestId })
  } else {
    await dispatchAfterCommand(db, viewer.organizationId)
  }
  return requestDetail(db, viewer, requestId)
}
