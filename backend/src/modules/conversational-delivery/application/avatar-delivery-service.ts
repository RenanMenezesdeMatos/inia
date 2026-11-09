import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { AVATAR_AUDIT_ACTIONS, transitionAvatarDelivery, type AvatarDeliveryEvent, type AvatarDeliveryStatus, type AvatarFailureReason } from "../domain/avatar-delivery-lifecycle.js"
import { avatarAlertDedupeKey, chatAlertDedupeKey } from "./deliver-conversational-output.js"
import { recadoCoveredByFollowUpSql } from "./recado-follow-up-invite.js"
import { transactionRunner } from "../../../shared/infrastructure/database/transaction.js"

/**
 * Leitura e ciclo de vida das entregas CONVERSACIONAIS do PRÓPRIO destinatário (a pessoa da sessão — nunca um id do corpo):
 * convites de voz em aberto, conversas de Workflow ainda não abertas e as transições da entrega de voz. Tudo filtrado por
 * organização + destinatário: entrega de outra pessoa = 404, sem distinguir.
 */
export type RecipientScope = { organizationId: string; personId: string }

export type AvatarDeliveryView = {
  id: string
  title: string
  speechText: string
  displayText: string
  status: AvatarDeliveryStatus
  createdAt: string
  offeredAt: string | null
  acceptedAt: string | null
  playingAt: string | null
  deliveredAt: string | null
  snoozedAt: string | null
  failedAt: string | null
  failureReason: string | null
  attemptCount: number
}

export type UnreadWorkflowConversation = { id: string; title: string; startedAt: string }

type AvatarRow = {
  id: string
  title: string | null
  speech_text: string | null
  display_text: string | null
  delivery_status: AvatarDeliveryStatus
  created_at: Date
  offered_at: Date | null
  accepted_at: Date | null
  playing_at: Date | null
  delivered_at: Date | null
  snoozed_at: Date | null
  failed_at: Date | null
  failure_reason: string | null
  attempt_count: number
}
const AVATAR_COLUMNS = "id, title, speech_text, display_text, delivery_status, created_at, offered_at, accepted_at, playing_at, delivered_at, snoozed_at, failed_at, failure_reason, attempt_count"
const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null)
const toView = (row: AvatarRow): AvatarDeliveryView => ({
  id: row.id,
  title: row.title ?? "Recado da INIA",
  speechText: row.speech_text ?? "",
  displayText: row.display_text ?? "",
  status: row.delivery_status,
  createdAt: new Date(row.created_at).toISOString(),
  offeredAt: iso(row.offered_at),
  acceptedAt: iso(row.accepted_at),
  playingAt: iso(row.playing_at),
  deliveredAt: iso(row.delivered_at),
  snoozedAt: iso(row.snoozed_at),
  failedAt: iso(row.failed_at),
  failureReason: row.failure_reason,
  attemptCount: row.attempt_count,
})

/** Convites de voz ainda não entregues (mais recente primeiro) + conversas de Workflow que a pessoa ainda não abriu. */
export async function loadRecipientInbox(db: Pick<Database, "query">, scope: RecipientScope): Promise<{ avatarDeliveries: AvatarDeliveryView[]; unreadConversations: UnreadWorkflowConversation[] }> {
  const [avatar, conversations] = await Promise.all([
    // Mesmo artefato por superfícies diferentes = UM convite: o recado de voz cujo Output (ou artefato) também virou feedback
    // publicado no Acompanhamento sai daqui — quem convida é a aplicação de feedback (feedback-application), sem duplicar.
    db.query<AvatarRow>(
      `select ${AVATAR_COLUMNS} from workflow_outputs o
       where o.organization_id = $1 and o.recipient_id = $2 and o.surface = 'AVATAR' and o.delivery_status <> 'DELIVERED' and o.speech_text is not null
         and not ${recadoCoveredByFollowUpSql("o")}
         and not exists (select 1 from workflow_enrollments we join workflows_all wf on wf.id = we.workflow_id where we.id = o.enrollment_id and wf.deleted_at is not null)
       order by o.created_at desc, o.id desc limit 10`,
      [scope.organizationId, scope.personId],
    ),
    db.query<{ id: string; title: string | null; started_at: Date }>(
      `select id, title, started_at from assistant_conversations
       where organization_id = $1 and owner_person_id = $2 and origin = 'WORKFLOW' and owner_seen_at is null
       order by started_at desc, id desc limit 20`,
      [scope.organizationId, scope.personId],
    ),
  ])
  return {
    avatarDeliveries: avatar.rows.map(toView),
    unreadConversations: conversations.rows.map((row) => ({ id: row.id, title: row.title ?? "Conversa da INIA", startedAt: new Date(row.started_at).toISOString() })),
  }
}

const inTransaction = transactionRunner("avatar_delivery_event")

const REJECTION_MESSAGES = {
  ALREADY_DELIVERED: "Este recado já foi entregue.",
  NOT_ACCEPTED: "O recado ainda não foi aceito para ouvir.",
  NOT_PLAYING: "A fala deste recado não chegou a começar — ele não foi marcado como entregue.",
  INVALID_TRANSITION: "Esta ação não se aplica ao recado agora.",
} as const

/**
 * Registra um evento da entrega de voz, com trava da linha (`for update`): duas abas/cliques simultâneos nunca geram estados
 * incoerentes. Repetição do mesmo evento é idempotente. DELIVERED exige que a fala tenha COMEÇADO (PLAYING) — aceitar não é
 * entregar. Ao entregar, o aviso do sino é resolvido; ao aceitar, marcado como lido.
 */
export async function applyAvatarDeliveryEvent(db: Database, scope: RecipientScope, outputId: string, event: AvatarDeliveryEvent, options: { failureReason?: AvatarFailureReason; now: Date }): Promise<AvatarDeliveryView> {
  return inTransaction(db, async (client) => {
    const current = (await client.query<AvatarRow>(`select ${AVATAR_COLUMNS} from workflow_outputs where id = $1 and organization_id = $2 and recipient_id = $3 and surface = 'AVATAR' for update`, [outputId, scope.organizationId, scope.personId])).rows[0]
    if (!current) throw new DomainError("Recado não encontrado.", "AVATAR_DELIVERY_NOT_FOUND", 404)
    const transition = transitionAvatarDelivery(current.delivery_status, event)
    if (!transition.ok) throw new DomainError(REJECTION_MESSAGES[transition.reason], `AVATAR_DELIVERY_${transition.reason}`, 409, { status: current.delivery_status })
    if (!transition.changed) return toView(current)
    const now = options.now
    const sets: string[] = ["delivery_status = $2", "updated_at = $3"]
    if (event === "OFFER") sets.push("offered_at = coalesce(offered_at, $3)")
    if (event === "ACCEPT") sets.push("accepted_at = $3", "attempt_count = attempt_count + 1", "failure_reason = null", "offered_at = coalesce(offered_at, $3)")
    if (event === "PLAYBACK_STARTED") sets.push("playing_at = $3")
    if (event === "PLAYBACK_COMPLETED") sets.push("delivered_at = $3")
    if (event === "PLAYBACK_FAILED") sets.push("failed_at = $3", "failure_reason = $4")
    if (event === "SNOOZE") sets.push("snoozed_at = $3", "offered_at = coalesce(offered_at, $3)")
    const updated = (await client.query<AvatarRow>(`update workflow_outputs set ${sets.join(", ")} where id = $1 returning ${AVATAR_COLUMNS}`, event === "PLAYBACK_FAILED" ? [outputId, transition.next, now, options.failureReason ?? "UNKNOWN"] : [outputId, transition.next, now])).rows[0]!
    const alertKey = avatarAlertDedupeKey(outputId)
    if (event === "ACCEPT") await client.query(`update alerts set read_at = coalesce(read_at, $2), status = case when status = 'OPEN' then 'SEEN'::alert_status else status end where dedupe_key = $1`, [alertKey, now])
    if (event === "PLAYBACK_COMPLETED") await client.query(`update alerts set read_at = coalesce(read_at, $2), resolved_at = coalesce(resolved_at, $2), status = 'RESOLVED' where dedupe_key = $1`, [alertKey, now])
    await client.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'workflow_output', $4, $5)`, [
      scope.organizationId,
      scope.personId,
      AVATAR_AUDIT_ACTIONS[event],
      outputId,
      JSON.stringify({ from: current.delivery_status, to: transition.next, ...(event === "PLAYBACK_FAILED" ? { failureReason: options.failureReason ?? "UNKNOWN" } : {}), attempt: updated.attempt_count }),
    ])
    return toView(updated)
  })
}

/** Primeira abertura de uma conversa de Workflow pelo dono: deixa de ser "nova" e o aviso do sino fica lido. */
export async function markWorkflowConversationSeen(db: Pick<Database, "query">, scope: RecipientScope, conversationId: string, now: Date): Promise<{ seen: boolean }> {
  const updated = await db.query<{ id: string }>(
    `update assistant_conversations set owner_seen_at = $4 where id = $1 and organization_id = $2 and owner_person_id = $3 and origin = 'WORKFLOW' and owner_seen_at is null returning id`,
    [conversationId, scope.organizationId, scope.personId, now],
  )
  if (!updated.rows[0]) return { seen: false }
  const output = (await db.query<{ id: string }>(`select id from workflow_outputs where conversation_id = $1`, [conversationId])).rows[0]
  if (output) await db.query(`update alerts set read_at = coalesce(read_at, $2), status = case when status = 'OPEN' then 'SEEN'::alert_status else status end where dedupe_key = $1 and recipient_id = $3`, [chatAlertDedupeKey(output.id), now, scope.personId])
  return { seen: true }
}
