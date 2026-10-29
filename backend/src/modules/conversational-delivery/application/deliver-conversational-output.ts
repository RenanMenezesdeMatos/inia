import type { Database } from "../../../infrastructure/database/pool.js"
import type { SurfaceProjection } from "../domain/surface-projection.js"
import { AVATAR_ALERT_KEY_PREFIX, CHAT_ALERT_KEY_PREFIX, recadoCoveredByFollowUpSql } from "./recado-follow-up-invite.js"
import { transactionRunner } from "../../../shared/infrastructure/database/transaction.js"

/**
 * ENTREGA de um nó Output nas superfícies CONVERSACIONAIS (V1): CHAT e AVATAR.
 *
 * Idempotência (a mesma do Acompanhamento): no máximo UMA linha em `workflow_outputs` por matrícula × nó Output × superfície ×
 * destinatário — retry do motor, duas instâncias ou reprocessamento devolvem a entrega já feita (`reused`). Superfícies
 * diferentes do mesmo artefato (Chat e Avatar) são entregas diferentes: nunca se deduplicam entre si.
 *
 * CHAT: cria uma conversa NOVA (origin = WORKFLOW) do destinatário e a primeira mensagem da INIA, tudo numa transação com a
 * linha de entrega. Nunca escreve na conversa que a pessoa está usando — a conversa "atual" do usuário (origin = USER)
 * continua sendo a mesma. Entregue = conversa + mensagem persistidas; "lida" é `owner_seen_at` (primeira abertura).
 * AVATAR: grava só o CONVITE (PENDING) com a fala já preparada. Nenhum áudio nasce aqui: a fala só começa no navegador,
 * no clique de aceite da pessoa (ver avatar-delivery-service.ts). Recado que já nasce coberto pelo Acompanhamento (o mesmo
 * Output/artefato virou feedback publicado) não ganha aviso no sino — "um convite só" (recado-follow-up-invite.ts).
 *
 * `interactionMode` = PASSIVE: sem aviso no sino (a conversa/convite aparece só no painel da INIA). PROMPT/IMMEDIATE: aviso
 * no sino. IMMEDIATE nunca inicia fala sozinho — a regra do produto é "o avatar só fala depois do aceite".
 */
export type ConversationalDeliveryInput = {
  organizationId: string
  enrollmentId: string
  nodeId: string
  recipientId: string
  interactionMode: "PASSIVE" | "PROMPT" | "IMMEDIATE"
  artifactId: string | null
  projection: SurfaceProjection
  /** Tipo do conteúdo de origem (auditoria): FEEDBACK_VIEW | FEEDBACK_TEXT | TEXT. */
  sourceKind: string
  now: Date
}

export type ChatDeliveryResult = { outputId: string; conversationId: string; reused: boolean }
export type AvatarOfferResult = { outputId: string; reused: boolean }

type Queryable = Pick<Database, "query">

/** Transação própria, ou savepoint quando já estamos dentro de uma (provas contra o banco de teste). */
const inTransaction = transactionRunner("conversational_delivery")

/** O conteúdo guardado na linha: proveniência segura + o contexto de origem (nunca o Execution Context cru). */
const contentOf = (input: ConversationalDeliveryInput) => JSON.stringify({ sourceKind: input.sourceKind, artifactId: input.artifactId, projectionVersion: input.projection.version, contextText: input.projection.contextText, speechTruncated: input.projection.speechTruncated })

async function insertOutputRow(client: Queryable, input: ConversationalDeliveryInput, surface: "CHAT" | "AVATAR"): Promise<string | null> {
  const inserted = await client.query<{ id: string }>(
    `insert into workflow_outputs (organization_id, enrollment_id, node_id, recipient_id, surface, interaction_mode, content, artifact_id, title, display_text, speech_text, projection_version, delivery_status, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PENDING',$13,$13)
     on conflict (enrollment_id, node_id, surface, recipient_id) do nothing
     returning id`,
    [input.organizationId, input.enrollmentId, input.nodeId, input.recipientId, surface, input.interactionMode, contentOf(input), input.artifactId, input.projection.title, input.projection.displayText, surface === "AVATAR" ? input.projection.speechText : null, input.projection.version, input.now],
  )
  return inserted.rows[0]?.id ?? null
}

async function audit(client: Queryable, input: { organizationId: string; action: string; outputId: string; payload: Record<string, unknown> }) {
  await client.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, null, $2, 'workflow_output', $3, $4)`, [input.organizationId, input.action, input.outputId, JSON.stringify(input.payload)])
}

async function notify(client: Queryable, input: ConversationalDeliveryInput, alert: { type: string; dedupeKey: string; description: string }) {
  if (input.interactionMode === "PASSIVE") return
  await client.query(
    `insert into alerts (organization_id, case_id, recipient_id, title, description, severity, alert_type, dedupe_key)
     values ($1, null, $2, $3, $4, 'INFO', $5, $6)
     on conflict (dedupe_key) do nothing`,
    [input.organizationId, input.recipientId, input.projection.title, alert.description, alert.type, alert.dedupeKey],
  )
}

export const CHAT_MESSAGE_KEY_PREFIX = "workflow-output:"
export const chatAlertDedupeKey = (outputId: string) => `${CHAT_ALERT_KEY_PREFIX}${outputId}`
export const avatarAlertDedupeKey = (outputId: string) => `${AVATAR_ALERT_KEY_PREFIX}${outputId}`

export async function deliverChatConversation(db: Database, input: ConversationalDeliveryInput): Promise<ChatDeliveryResult> {
  const created = await inTransaction(db, async (client) => {
    const outputId = await insertOutputRow(client, input, "CHAT")
    if (!outputId) return null
    const conversation = await client.query<{ id: string }>(
      `insert into assistant_conversations (organization_id, owner_person_id, kind, status, origin, title, started_at, last_activity_at)
       values ($1, $2, 'CONVERSATION', 'ACTIVE', 'WORKFLOW', $3, $4, $4) returning id`,
      [input.organizationId, input.recipientId, input.projection.title, input.now],
    )
    const conversationId = conversation.rows[0]!.id
    await client.query(
      `insert into assistant_interactions (organization_id, operator_id, conversation_id, channel, role, content, occurred_at, client_message_id)
       values ($1, $2, $3, 'chat', 'assistant', $4, $5, $6)`,
      [input.organizationId, input.recipientId, conversationId, input.projection.chatText, input.now, `${CHAT_MESSAGE_KEY_PREFIX}${outputId}`],
    )
    await client.query(`update workflow_outputs set conversation_id = $2, delivery_status = 'DELIVERED', delivered_at = $3, updated_at = $3 where id = $1`, [outputId, conversationId, input.now])
    await notify(client, input, { type: "WORKFLOW_CHAT_MESSAGE", dedupeKey: chatAlertDedupeKey(outputId), description: "A INIA começou uma conversa com você." })
    await audit(client, { organizationId: input.organizationId, action: "WORKFLOW_CHAT_DELIVERED", outputId, payload: { enrollmentId: input.enrollmentId, nodeId: input.nodeId, recipientId: input.recipientId, conversationId, artifactId: input.artifactId, sourceKind: input.sourceKind } })
    return { outputId, conversationId }
  })
  if (created) return { ...created, reused: false }
  const existing = (await db.query<{ id: string; conversation_id: string | null }>(`select id, conversation_id from workflow_outputs where enrollment_id = $1 and node_id = $2 and surface = 'CHAT' and recipient_id = $3`, [input.enrollmentId, input.nodeId, input.recipientId])).rows[0]
  if (!existing?.conversation_id) throw new Error("Entrega de Chat deste Output já registrada sem conversa — estado inconsistente, nada criado de novo.")
  return { outputId: existing.id, conversationId: existing.conversation_id, reused: true }
}

export async function offerAvatarDelivery(db: Database, input: ConversationalDeliveryInput): Promise<AvatarOfferResult> {
  const created = await inTransaction(db, async (client) => {
    const outputId = await insertOutputRow(client, input, "AVATAR")
    if (!outputId) return null
    // Um convite só: coberto pelo Acompanhamento, quem convida é a aplicação de feedback — nenhum aviso apontando para um convite
    // que o inbox não mostra (e que nunca seria resolvido, porque a fala nunca começa por esse caminho).
    const covered = (await client.query<{ covered: boolean }>(`select ${recadoCoveredByFollowUpSql("o")} covered from workflow_outputs o where o.id = $1`, [outputId])).rows[0]?.covered === true
    if (!covered) await notify(client, input, { type: "WORKFLOW_AVATAR_MESSAGE", dedupeKey: avatarAlertDedupeKey(outputId), description: "Tenho um recado para você. Quando puder falar comigo, é só ouvir." })
    await audit(client, { organizationId: input.organizationId, action: "WORKFLOW_AVATAR_DELIVERY_CREATED", outputId, payload: { enrollmentId: input.enrollmentId, nodeId: input.nodeId, recipientId: input.recipientId, artifactId: input.artifactId, sourceKind: input.sourceKind, coveredByFollowUp: covered } })
    return outputId
  })
  if (created) return { outputId: created, reused: false }
  const existing = (await db.query<{ id: string }>(`select id from workflow_outputs where enrollment_id = $1 and node_id = $2 and surface = 'AVATAR' and recipient_id = $3`, [input.enrollmentId, input.nodeId, input.recipientId])).rows[0]
  if (!existing) throw new Error("Entrega de Avatar deste Output não encontrada depois do conflito — nada criado.")
  return { outputId: existing.id, reused: true }
}
