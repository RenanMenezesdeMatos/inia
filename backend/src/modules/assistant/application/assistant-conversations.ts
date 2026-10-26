import type { PoolClient } from "pg"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import {
  DEFAULT_CONVERSATION_INACTIVITY_HOURS,
  decideConversationForWrite,
  encodeCursor,
  isInactive,
  previewOf,
  type ConversationOrigin,
  type ConversationRecord,
  type MessageCursor,
} from "../domain/assistant-conversation.js"
import { CLARIFICATION_TOOL_NAME } from "../../knowledge-clarification/domain/clarification-state.js"
import { loadConversationRatings, rateConversationMessage, type RateConversationMessageInput } from "./assistant-interaction-ratings.js"
import type { AssistantRatingView } from "../domain/assistant-interaction-rating.js"

/**
 * Persistência das CONVERSAS com a INIA (migration 094). Toda escrita resolve a conversa AQUI, no backend, sob um lock
 * transacional por dono (pg_advisory_xact_lock): duas abas, retentativas e respostas atrasadas nunca criam duas conversas
 * ativas nem gravam no lugar errado. O dono vem SEMPRE da sessão, nunca do corpo da requisição.
 */
type Queryable = Pick<Database, "query">

export type ConversationScope = { organizationId: string; ownerPersonId: string }

export function conversationInactivityMs(): number {
  const raw = Number(process.env.INIA_CONVERSATION_INACTIVITY_HOURS)
  const hours = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CONVERSATION_INACTIVITY_HOURS
  return hours * 60 * 60 * 1000
}

type ConversationRow = {
  id: string
  organization_id: string
  owner_person_id: string
  kind: ConversationRecord["kind"]
  status: ConversationRecord["status"]
  started_at: Date
  last_activity_at: Date
  closed_at: Date | null
  close_reason: ConversationRecord["closeReason"]
  origin: ConversationOrigin
}
const CONVERSATION_COLUMNS = "id, organization_id, owner_person_id, kind, status, started_at, last_activity_at, closed_at, close_reason, origin"
const toRecord = (row: ConversationRow): ConversationRecord => ({
  id: row.id,
  organizationId: row.organization_id,
  ownerPersonId: row.owner_person_id,
  kind: row.kind,
  status: row.status,
  startedAt: new Date(row.started_at),
  lastActivityAt: new Date(row.last_activity_at),
  closedAt: row.closed_at ? new Date(row.closed_at) : null,
  closeReason: row.close_reason,
  origin: row.origin,
})

async function findOwned(db: Queryable, scope: ConversationScope, id: string): Promise<ConversationRecord | null> {
  const result = await db.query<ConversationRow>(`select ${CONVERSATION_COLUMNS} from assistant_conversations where id = $1 and organization_id = $2 and owner_person_id = $3`, [id, scope.organizationId, scope.ownerPersonId])
  return result.rows[0] ? toRecord(result.rows[0]) : null
}

/** A conversa ATUAL do usuário: só as iniciadas por ele (origin = USER). Conversas de Workflow ficam ativas em paralelo. */
async function findActive(db: Queryable, scope: ConversationScope): Promise<ConversationRecord | null> {
  const result = await db.query<ConversationRow>(`select ${CONVERSATION_COLUMNS} from assistant_conversations where organization_id = $1 and owner_person_id = $2 and status = 'ACTIVE' and origin = 'USER'`, [scope.organizationId, scope.ownerPersonId])
  return result.rows[0] ? toRecord(result.rows[0]) : null
}

async function close(db: Queryable, id: string, reason: "MANUAL" | "INACTIVITY", at: Date) {
  await db.query(`update assistant_conversations set status = 'CLOSED', closed_at = $2, close_reason = $3 where id = $1 and status = 'ACTIVE'`, [id, at, reason])
}

async function withOwnerLock<T>(db: Database, scope: ConversationScope, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const lockSql = "select pg_advisory_xact_lock(hashtext('assistant_conversation:' || $1::text))"
  const lockKey = `${scope.organizationId}:${scope.ownerPersonId}`
  // Já dentro de uma transação (cliente dedicado, ex.: provas contra o banco de teste): savepoint no lugar de begin/commit.
  if (typeof (db as Partial<PoolClient>).release === "function") {
    const client = db as unknown as PoolClient
    await client.query("savepoint assistant_conversation_lock")
    try {
      await client.query(lockSql, [lockKey])
      const result = await work(client)
      await client.query("release savepoint assistant_conversation_lock")
      return result
    } catch (error) {
      await client.query("rollback to savepoint assistant_conversation_lock").catch(() => {})
      throw error
    }
  }
  const client = await db.connect()
  try {
    await client.query("begin")
    await client.query(lockSql, [lockKey])
    const result = await work(client)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback").catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

export type ResolvedConversation = { conversationId: string; created: boolean; rotatedFrom: string | null; closed: boolean }

/**
 * Conversa em que uma mensagem NOVA do usuário será gravada. `requestedId` = a conversa que o cliente está exibindo
 * (`null` = a atual ou uma nova). Encerrada → 409 `ASSISTANT_CONVERSATION_CLOSED` com a conversa atual (o cliente troca;
 * nunca mistura). Inativa além da janela → encerrada e substituída.
 */
export async function resolveConversationForWrite(db: Database, scope: ConversationScope, requestedId: string | null, now: Date, options: { allowClosed?: boolean } = {}): Promise<ResolvedConversation> {
  return withOwnerLock(db, scope, async (client) => {
    const requested = requestedId ? await findOwned(client, scope, requestedId) : null
    const active = await findActive(client, scope)
    const decision = decideConversationForWrite({ requested, requestedId, active, now, inactivityMs: conversationInactivityMs(), allowClosed: options.allowClosed ?? false })
    if (decision.action === "REJECT_NOT_FOUND") throw new DomainError("Conversa não encontrada.", "ASSISTANT_CONVERSATION_NOT_FOUND", 404)
    if (decision.action === "REJECT_CLOSED") {
      throw new DomainError("Esta conversa já foi encerrada. Abrimos a conversa atual para você continuar.", "ASSISTANT_CONVERSATION_CLOSED", 409, { activeConversationId: decision.activeConversationId })
    }
    if (decision.action === "USE") return { conversationId: decision.conversationId, created: false, rotatedFrom: null, closed: decision.closed ?? false }
    if (decision.closeFirst) await close(client, decision.closeFirst.conversationId, decision.closeFirst.reason, now)
    const inserted = await client.query<{ id: string }>(
      `insert into assistant_conversations (organization_id, owner_person_id, kind, status, started_at, last_activity_at) values ($1, $2, 'CONVERSATION', 'ACTIVE', $3, $3) returning id`,
      [scope.organizationId, scope.ownerPersonId, now],
    )
    return { conversationId: inserted.rows[0]!.id, created: true, rotatedFrom: decision.closeFirst?.conversationId ?? null, closed: false }
  })
}

/** Conversa do próprio dono (qualquer estado, inclusive "Histórico anterior") — leitura. 404 fora do dono/organização. */
export async function requireOwnedConversation(db: Queryable, scope: ConversationScope, conversationId: string): Promise<ConversationRecord> {
  const conversation = await findOwned(db, scope, conversationId)
  if (!conversation) throw new DomainError("Conversa não encontrada.", "ASSISTANT_CONVERSATION_NOT_FOUND", 404)
  return conversation
}

/** "Nova conversa": encerra a ativa (MANUAL) se ela tiver mensagens. Nunca cria conversa — a próxima mensagem cria. */
export async function startNewConversation(db: Database, scope: ConversationScope, now: Date): Promise<{ closedConversationId: string | null }> {
  return withOwnerLock(db, scope, async (client) => {
    const active = await findActive(client, scope)
    if (!active) return { closedConversationId: null }
    await close(client, active.id, "MANUAL", now)
    return { closedConversationId: active.id }
  })
}

/**
 * Conversa ATIVA para abrir o chat (recarregar a página). Ativa porém inativa além da janela é encerrada aqui mesmo
 * (INACTIVITY) — a próxima mensagem começaria outra de qualquer forma; nenhuma conversa nova é criada.
 */
export async function loadCurrentConversation(db: Database, scope: ConversationScope, now: Date): Promise<ConversationRecord | null> {
  const active = await findActive(db, scope)
  if (!active) return null
  if (!isInactive(active, now, conversationInactivityMs())) return active
  await withOwnerLock(db, scope, async (client) => {
    const fresh = await findActive(client, scope)
    if (fresh && fresh.id === active.id && isInactive(fresh, now, conversationInactivityMs())) await close(client, fresh.id, "INACTIVITY", now)
  })
  return null
}

// ---------------------------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------------------------

export type MessageInput = {
  conversationId: string
  organizationId: string
  ownerPersonId: string
  channel: "chat" | "voice"
  role: "user" | "assistant"
  content: string
  occurredAt: Date
  agentId?: string | null
  toolCalls?: unknown
  /** Chave idempotente do cliente: a mesma chave na mesma conversa nunca gera duas mensagens. */
  clientMessageId?: string | null
}

/** Grava a mensagem e atualiza a última atividade. Com `clientMessageId` repetido devolve a mensagem existente. */
export async function appendConversationMessage(db: Queryable, input: MessageInput): Promise<{ id: string; duplicate: boolean }> {
  const inserted = await db.query<{ id: string }>(
    `insert into assistant_interactions (organization_id, operator_id, conversation_id, channel, role, content, agent_id, tool_calls, occurred_at, client_message_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (conversation_id, client_message_id) where client_message_id is not null do nothing
     returning id`,
    [input.organizationId, input.ownerPersonId, input.conversationId, input.channel, input.role, input.content, input.agentId ?? null, input.toolCalls ? JSON.stringify(input.toolCalls) : null, input.occurredAt, input.clientMessageId ?? null],
  )
  const id = inserted.rows[0]?.id
  if (!id) {
    const existing = await db.query<{ id: string }>(`select id from assistant_interactions where conversation_id = $1 and client_message_id = $2`, [input.conversationId, input.clientMessageId])
    return { id: existing.rows[0]!.id, duplicate: true }
  }
  await db.query(`update assistant_conversations set last_activity_at = greatest(last_activity_at, $2) where id = $1`, [input.conversationId, input.occurredAt])
  return { id, duplicate: false }
}

/** `origin = "WORKFLOW"`: a mensagem da INIA entregue por um nó Output (Chat) — a tela a destaca; `"FEEDBACK"`: a apresentação
 * de uma aplicação de feedback (primeira mensagem da INIA na conversa da aplicação); demais = null. */
export type ConversationMessage = {
  id: string
  channel: "chat" | "voice"
  role: "user" | "assistant"
  content: string
  agentId: string | null
  occurredAt: string
  cursor: string
  origin: "WORKFLOW" | "FEEDBACK" | null
  /** Cartões de dados gravados com a resposta (ferramentas executadas pelo backend, ex.: liderança) — quem exibe revalida o escopo. */
  analytics: unknown[]
  /** Estado do esclarecimento pelas bases gravado com a resposta (`knowledge_clarification`), cru — quem exibe valida e revalida o
   * acesso às bases citadas (`knowledge-clarification/domain/clarification-view.ts`). null nas demais mensagens. */
  clarification: unknown | null
  /** Onde esse esclarecimento foi feito, quando não é o chat de quem atende (ex.: a consulta de processo de quem lidera, com o
   * Orquestrador do Grupo), cru — uso interno do servidor para continuar o fluxo; nunca enviado à tela. */
  clarificationScope: unknown | null
}
type MessageRow = { id: string; channel: "chat" | "voice"; role: "user" | "assistant"; content: string; agent_id: string | null; occurred_at: Date; seq: string; client_message_id: string | null; tool_calls?: unknown }

/** Cartões gravados em `tool_calls` (entradas com `analytics`), na ordem em que as ferramentas rodaram. */
export function analyticsCardsOf(toolCalls: unknown): unknown[] {
  if (!Array.isArray(toolCalls)) return []
  return toolCalls.flatMap((call) => (call && typeof call === "object" && "analytics" in call && call.analytics && typeof call.analytics === "object" ? [call.analytics] : []))
}
function clarificationEntryOf(toolCalls: unknown): { state: unknown; scope?: unknown } | null {
  if (!Array.isArray(toolCalls)) return null
  const entry = toolCalls.find((call) => call && typeof call === "object" && "toolName" in call && call.toolName === CLARIFICATION_TOOL_NAME && "state" in call)
  return entry ? (entry as { state: unknown; scope?: unknown }) : null
}
/** Estado do esclarecimento pelas bases gravado em `tool_calls` (entrada `knowledge_clarification`), sem validar. */
export function clarificationPayloadOf(toolCalls: unknown): unknown | null {
  return clarificationEntryOf(toolCalls)?.state ?? null
}
/** Onde o esclarecimento gravado em `tool_calls` foi feito (`scope` da entrada `knowledge_clarification`), sem validar. */
export function clarificationScopeOf(toolCalls: unknown): unknown | null {
  return clarificationEntryOf(toolCalls)?.scope ?? null
}
/** Mesma chave gravada pela entrega de Chat (conversational-delivery/application/deliver-conversational-output.ts). */
const WORKFLOW_MESSAGE_KEY_PREFIX = "workflow-output:"
/** Mesma chave da apresentação gravada pela aplicação de feedback (feedback-application-service.ts). */
const FEEDBACK_PRESENTATION_KEY = "feedback-application:presentation"
export const messageOriginOf = (role: "user" | "assistant", clientMessageId: string | null | undefined): ConversationMessage["origin"] =>
  role !== "assistant" ? null : clientMessageId?.startsWith(WORKFLOW_MESSAGE_KEY_PREFIX) ? "WORKFLOW" : clientMessageId === FEEDBACK_PRESENTATION_KEY ? "FEEDBACK" : null
const toMessage = (row: MessageRow): ConversationMessage => {
  const occurredAt = new Date(row.occurred_at).toISOString()
  const origin = messageOriginOf(row.role, row.client_message_id)
  return { id: row.id, channel: row.channel, role: row.role, content: row.content, agentId: row.agent_id, occurredAt, cursor: encodeCursor({ occurredAt, seq: String(row.seq) }), origin, analytics: row.role === "assistant" ? analyticsCardsOf(row.tool_calls) : [], clarification: row.role === "assistant" ? clarificationPayloadOf(row.tool_calls) : null, clarificationScope: row.role === "assistant" ? clarificationScopeOf(row.tool_calls) : null }
}

/**
 * Página de mensagens de UMA conversa, em ordem cronológica estável (occurred_at, seq). `before` = mensagens anteriores
 * ao cursor (as mais recentes primeiro na busca, devolvidas em ordem crescente); `after` = mensagens novas depois do
 * cursor (atualização de conversa em andamento). A conversa já deve ter sido autorizada por quem chama.
 */
export async function loadConversationMessages(
  db: Queryable,
  input: { organizationId: string; conversationId: string; limit: number; before?: MessageCursor | null; after?: MessageCursor | null },
): Promise<{ messages: ConversationMessage[]; hasMore: boolean }> {
  const params: unknown[] = [input.organizationId, input.conversationId, input.limit + 1]
  let where = ""
  let order = "desc"
  if (input.after) {
    params.push(input.after.occurredAt, input.after.seq)
    where = "and (occurred_at, seq) > ($4::timestamptz, $5::bigint)"
    order = "asc"
  } else if (input.before) {
    params.push(input.before.occurredAt, input.before.seq)
    where = "and (occurred_at, seq) < ($4::timestamptz, $5::bigint)"
  }
  const result = await db.query<MessageRow>(
    `select id, channel, role, content, agent_id, occurred_at, seq::text seq, client_message_id, tool_calls from assistant_interactions
     where organization_id = $1 and conversation_id = $2 ${where}
     order by occurred_at ${order}, seq ${order} limit $3`,
    params,
  )
  const hasMore = result.rows.length > input.limit
  const rows = result.rows.slice(0, input.limit)
  const ordered = order === "desc" ? rows.reverse() : rows
  return { messages: ordered.map(toMessage), hasMore }
}

/** Contexto do modelo para uma mensagem nova: SÓ os últimos turnos da própria conversa (nunca de outra). */
export const MAX_MODEL_CONTEXT_TURNS = 24
export async function loadConversationContextTurns(db: Queryable, input: { organizationId: string; conversationId: string; limit?: number }): Promise<{ role: "user" | "model"; text: string }[]> {
  const page = await loadConversationMessages(db, { organizationId: input.organizationId, conversationId: input.conversationId, limit: input.limit ?? MAX_MODEL_CONTEXT_TURNS })
  return page.messages.map((message) => ({ role: message.role === "assistant" ? "model" : "user", text: message.content }))
}

// ---------------------------------------------------------------------------------------------
// Lista de conversas (resumo) — usada pelo próprio dono e pelo monitoramento
// ---------------------------------------------------------------------------------------------

export type ConversationSummary = {
  id: string
  kind: ConversationRecord["kind"]
  status: ConversationRecord["status"]
  startedAt: string
  lastActivityAt: string
  closedAt: string | null
  closeReason: ConversationRecord["closeReason"]
  /** Workflow Outputs V1 — conversa criada por um Workflow (título do recado; "nova" até o dono abrir). FEEDBACK = conversa de
   * uma aplicação de feedback (título = assunto do feedback). */
  origin: ConversationOrigin
  title: string | null
  unread: boolean
  /** Conversa COMPLEMENTAR de uma aplicação de feedback concluída (dúvidas depois da conclusão). */
  feedbackFollowUp: boolean
  messageCount: number
  firstUserMessage: string | null
  lastMessage: { role: "user" | "assistant"; preview: string; channel: "chat" | "voice" } | null
}

export type ConversationSummaryRow = {
  id: string
  kind: ConversationRecord["kind"]
  status: ConversationRecord["status"]
  started_at: Date
  last_activity_at: Date
  closed_at: Date | null
  close_reason: ConversationRecord["closeReason"]
  origin: ConversationOrigin
  title: string | null
  owner_seen_at: Date | null
  feedback_follow_up?: boolean | null
  message_count: number
  first_user_message: string | null
  last_role: "user" | "assistant" | null
  last_content: string | null
  last_channel: "chat" | "voice" | null
}

/** Colunas de resumo sobre um alias `c` de assistant_conversations (prévias por LATERAL, uma leitura por página). */
export const CONVERSATION_SUMMARY_SELECT = `c.id, c.kind, c.status, c.started_at, c.last_activity_at, c.closed_at, c.close_reason, c.origin, c.title, c.owner_seen_at,
  (c.origin = 'FEEDBACK' and exists (select 1 from feedback_application_followups x where x.conversation_id = c.id)) feedback_follow_up,
  (select count(*)::int from assistant_interactions m where m.conversation_id = c.id) message_count,
  (select m.content from assistant_interactions m where m.conversation_id = c.id and m.role = 'user' order by m.occurred_at, m.seq limit 1) first_user_message,
  last_message.role last_role, last_message.content last_content, last_message.channel last_channel`
export const CONVERSATION_LAST_MESSAGE_JOIN = `left join lateral (select m.role, m.content, m.channel from assistant_interactions m where m.conversation_id = c.id order by m.occurred_at desc, m.seq desc limit 1) last_message on true`

export const toSummary = (row: ConversationSummaryRow): ConversationSummary => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  startedAt: new Date(row.started_at).toISOString(),
  lastActivityAt: new Date(row.last_activity_at).toISOString(),
  closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
  closeReason: row.close_reason,
  origin: row.origin,
  title: row.title,
  unread: row.origin === "WORKFLOW" && !row.owner_seen_at,
  feedbackFollowUp: row.feedback_follow_up ?? false,
  messageCount: row.message_count,
  firstUserMessage: row.first_user_message ? previewOf(row.first_user_message, 80) : null,
  lastMessage: row.last_role && row.last_content !== null && row.last_channel ? { role: row.last_role, preview: previewOf(row.last_content), channel: row.last_channel } : null,
})

/** Conversas do PRÓPRIO dono (mais recente primeiro), paginadas. */
export async function listOwnConversations(db: Queryable, scope: ConversationScope, page: number, pageSize: number): Promise<{ items: ConversationSummary[]; total: number }> {
  const [rows, total] = await Promise.all([
    db.query<ConversationSummaryRow>(
      `select ${CONVERSATION_SUMMARY_SELECT} from assistant_conversations c ${CONVERSATION_LAST_MESSAGE_JOIN}
       where c.organization_id = $1 and c.owner_person_id = $2
       order by c.last_activity_at desc, c.id desc limit $3 offset $4`,
      [scope.organizationId, scope.ownerPersonId, pageSize, (page - 1) * pageSize],
    ),
    db.query<{ n: number }>(`select count(*)::int n from assistant_conversations where organization_id = $1 and owner_person_id = $2`, [scope.organizationId, scope.ownerPersonId]),
  ])
  return { items: rows.rows.map(toSummary), total: total.rows[0]?.n ?? 0 }
}

export async function loadOwnConversationSummary(db: Queryable, scope: ConversationScope, id: string): Promise<ConversationSummary | null> {
  const result = await db.query<ConversationSummaryRow>(
    `select ${CONVERSATION_SUMMARY_SELECT} from assistant_conversations c ${CONVERSATION_LAST_MESSAGE_JOIN} where c.id = $1 and c.organization_id = $2 and c.owner_person_id = $3`,
    [id, scope.organizationId, scope.ownerPersonId],
  )
  return result.rows[0] ? toSummary(result.rows[0]) : null
}

// ---------------------------------------------------------------------------------------------
// Porta usada pelas rotas (injetável nos testes)
// ---------------------------------------------------------------------------------------------

export type ConversationStore = {
  resolveForWrite(scope: ConversationScope, requestedId: string | null, now: Date, options?: { allowClosed?: boolean }): Promise<ResolvedConversation>
  requireOwned(scope: ConversationScope, conversationId: string): Promise<ConversationRecord>
  startNew(scope: ConversationScope, now: Date): Promise<{ closedConversationId: string | null }>
  loadCurrent(scope: ConversationScope, now: Date): Promise<ConversationRecord | null>
  append(input: MessageInput): Promise<{ id: string; duplicate: boolean }>
  findByClientMessageId(conversationId: string, clientMessageId: string): Promise<{ id: string; content: string } | null>
  loadMessages(input: { organizationId: string; conversationId: string; limit: number; before?: MessageCursor | null; after?: MessageCursor | null }): Promise<{ messages: ConversationMessage[]; hasMore: boolean }>
  contextTurns(input: { organizationId: string; conversationId: string }): Promise<{ role: "user" | "model"; text: string }[]>
  listOwn(scope: ConversationScope, page: number, pageSize: number): Promise<{ items: ConversationSummary[]; total: number }>
  ownSummary(scope: ConversationScope, id: string): Promise<ConversationSummary | null>
  /** Curtir/descurtir de uma resposta da INIA pela dona da conversa (migration 158); 404 fora disso. */
  rate(scope: ConversationScope, input: RateConversationMessageInput, now: Date): Promise<AssistantRatingView>
  /** Avaliações vigentes da dona para estas respostas. */
  ratingsOf(scope: ConversationScope, interactionIds: readonly string[]): Promise<Map<string, Exclude<AssistantRatingView, null>>>
}

export function createPostgresConversationStore(db: Database): ConversationStore {
  return {
    resolveForWrite: (scope, requestedId, now, options) => resolveConversationForWrite(db, scope, requestedId, now, options),
    requireOwned: (scope, id) => requireOwnedConversation(db, scope, id),
    startNew: (scope, now) => startNewConversation(db, scope, now),
    loadCurrent: (scope, now) => loadCurrentConversation(db, scope, now),
    append: (input) => appendConversationMessage(db, input),
    findByClientMessageId: async (conversationId, clientMessageId) => {
      const result = await db.query<{ id: string; content: string }>(`select id, content from assistant_interactions where conversation_id = $1 and client_message_id = $2`, [conversationId, clientMessageId])
      return result.rows[0] ?? null
    },
    loadMessages: (input) => loadConversationMessages(db, input),
    contextTurns: (input) => loadConversationContextTurns(db, input),
    listOwn: (scope, page, pageSize) => listOwnConversations(db, scope, page, pageSize),
    ownSummary: (scope, id) => loadOwnConversationSummary(db, scope, id),
    rate: (scope, input, now) => rateConversationMessage(db, scope, input, now),
    ratingsOf: (scope, interactionIds) => loadConversationRatings(db, scope, interactionIds),
  }
}
