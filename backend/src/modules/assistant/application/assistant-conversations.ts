import { recordKnowledgeUsage } from "../../knowledge/application/knowledge-consultation-context.js"
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
import { loadConversationRatings, rateConversationMessage, type RateConversationMessageInput, type RatingResult, type RatingSnapshot } from "./assistant-interaction-ratings.js"
import { SUPPORT_SIGNALS, SUPPORT_SIGNALS_VERSION, type SupportSignal } from "../domain/reply-signals.js"
import { transactionRunner } from "../../../shared/infrastructure/database/transaction.js"

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

/**
 * Encerra a conversa do chat livre de onde saiu um pedido de apoio, quando o atendimento do Anjo termina (`HUMAN_SUPPORT`,
 * decisão de 10/11/2026): o assunto foi tratado com uma pessoa e a próxima pergunta abre conversa nova. Roda na transação de
 * quem chama, com a mesma trava por dono das demais escritas da conversa; só fecha a conversa do próprio dono, de origem USER e
 * ainda ativa — se já foi encerrada (nova conversa, inatividade), fica como está. Devolve se encerrou.
 */
export async function closeConversationAfterHumanSupport(client: Queryable, input: { organizationId: string; ownerPersonId: string; conversationId: string }): Promise<boolean> {
  await client.query("select pg_advisory_xact_lock(hashtext('assistant_conversation:' || $1::text))", [`${input.organizationId}:${input.ownerPersonId}`])
  const result = await client.query(
    `update assistant_conversations set status = 'CLOSED', closed_at = statement_timestamp(), close_reason = 'HUMAN_SUPPORT'
      where id = $1 and organization_id = $2 and owner_person_id = $3 and status = 'ACTIVE' and origin = 'USER'`,
    [input.conversationId, input.organizationId, input.ownerPersonId],
  )
  return result.rowCount === 1
}

const inOwnerTransaction = transactionRunner("assistant_conversation_lock")

async function withOwnerLock<T>(db: Database, scope: ConversationScope, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const lockSql = "select pg_advisory_xact_lock(hashtext('assistant_conversation:' || $1::text))"
  const lockKey = `${scope.organizationId}:${scope.ownerPersonId}`
  // Dentro de uma transação já aberta (cliente dedicado, ex.: provas contra o banco de teste), o helper usa savepoint.
  return inOwnerTransaction(db, async (client) => {
    await client.query(lockSql, [lockKey])
    return work(client)
  })
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
  /** Sinais da resposta (`assistant/domain/reply-signals.ts`). Mensagem da INIA no chat livre sem eles = lista vazia. */
  signals?: readonly SupportSignal[]
}

/**
 * Grava a mensagem e atualiza a última atividade. Com `clientMessageId` repetido devolve a mensagem existente. Mensagem da INIA numa
 * conversa do CHAT LIVRE (`origin = USER`) ganha a linha de sinais na MESMA instrução (migration 181) — toda resposta depois da
 * migration tem a linha, inclusive com lista vazia; sessão de feedback e recado não ganham.
 */
export async function appendConversationMessage(db: Queryable, input: MessageInput): Promise<{ id: string; duplicate: boolean }> {
  const signals = SUPPORT_SIGNALS.filter((signal) => (input.signals ?? []).includes(signal))
  const inserted = await db.query<{ id: string }>(
    `with inserted as (
       insert into assistant_interactions (organization_id, operator_id, conversation_id, channel, role, content, agent_id, tool_calls, occurred_at, client_message_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (conversation_id, client_message_id) where client_message_id is not null do nothing
       returning id
     ), reply_signals as (
       insert into assistant_reply_signals (interaction_id, organization_id, person_id, signals, signal_version)
       select inserted.id, $1, $2, $11::text[], $12 from inserted
         join assistant_conversations c on c.id = $3 and c.origin = 'USER'
        where $5::text = 'assistant'
     )
     select id from inserted`,
    [input.organizationId, input.ownerPersonId, input.conversationId, input.channel, input.role, input.content, input.agentId ?? null, input.toolCalls ? JSON.stringify(input.toolCalls) : null, input.occurredAt, input.clientMessageId ?? null, signals, SUPPORT_SIGNALS_VERSION],
  )
  const id = inserted.rows[0]?.id
  if (!id) {
    const existing = await db.query<{ id: string }>(`select id from assistant_interactions where conversation_id = $1 and client_message_id = $2`, [input.conversationId, input.clientMessageId])
    return { id: existing.rows[0]!.id, duplicate: true }
  }
  await db.query(`update assistant_conversations set last_activity_at = greatest(last_activity_at, $2) where id = $1`, [input.conversationId, input.occurredAt])
  await recordAgentParticipation(db, input.organizationId, id, participantsOf(input.toolCalls, input.agentId ?? null))
  // A resposta guarda quais versões das bases a consulta deste turno usou (PEN-008).
  if (input.role === "assistant") await recordKnowledgeUsage(db, { sourceKind: "CONVERSATION", sourceId: id })
  return { id, duplicate: false }
}

/**
 * Sinal `NO_REPLY` na MENSAGEM DO OPERADOR cujo turno terminou em erro (não por cancelamento): a pergunta já estava gravada e nenhuma
 * resposta veio. Só no chat livre da própria pessoa. `true` = gravado agora (a sugestão de apoio pode ser registrada).
 */
export async function markConversationNoReply(db: Queryable, scope: ConversationScope, questionId: string): Promise<boolean> {
  const result = await db.query(
    `insert into assistant_reply_signals (interaction_id, organization_id, person_id, signals, signal_version)
     select i.id, c.organization_id, c.owner_person_id, array['NO_REPLY']::text[], $4
       from assistant_interactions i join assistant_conversations c on c.id = i.conversation_id
      where i.id = $1 and i.role = 'user' and c.organization_id = $2 and c.owner_person_id = $3 and c.origin = 'USER'
     on conflict (interaction_id) do nothing`,
    [questionId, scope.organizationId, scope.ownerPersonId, SUPPORT_SIGNALS_VERSION],
  )
  return (result.rowCount ?? 0) > 0
}

type Participant = { agentId: string; agentVersionId: string | null; orchestratorId: string | null; orchestratorVersionId: string | null; role: "ORCHESTRATOR_AGENT" | "SPECIALIST"; outcome: "EXECUTED" | "BLOCKED_INACTIVE" | "BLOCKED_UNAUTHORIZED" }

const SPECIALIST_TOOL = /^agent_([0-9a-f]{32})$/
const uuidOfTool = (hex: string) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
const text = (value: unknown) => (typeof value === "string" && value ? value : null)

/**
 * Agentes que atuaram na resposta (PEN-002, PEN-065, PEN-070): os especialistas acionados — com a versão usada e "Agente inativo"
 * quando a chamada foi impedida — e o agente orquestrador. Lidos das chamadas gravadas com a mensagem; uma chamada sem a versão
 * (voz) fica com a vigente no momento da gravação.
 */
export function participantsOf(toolCalls: unknown, agentId: string | null): Participant[] {
  const participants = new Map<string, Participant>()
  const add = (participant: Participant) => {
    const key = `${participant.agentId}|${participant.role}`
    if (!participants.has(key) || participant.outcome === "EXECUTED") participants.set(key, participant)
  }
  for (const call of Array.isArray(toolCalls) ? (toolCalls as Record<string, unknown>[]) : []) {
    if (!call || typeof call !== "object") continue
    const match = typeof call.toolName === "string" ? SPECIALIST_TOOL.exec(call.toolName) : null
    const specialistId = text(call.agentId) ?? (match ? uuidOfTool(match[1]!) : null)
    const orchestratorId = text(call.orchestratorId)
    const orchestratorVersionId = text(call.orchestratorVersionId)
    if (specialistId) add({ agentId: specialistId, agentVersionId: text(call.agentVersionId), orchestratorId, orchestratorVersionId, role: "SPECIALIST", outcome: call.outcome === "BLOCKED_INACTIVE" || call.outcome === "BLOCKED_UNAUTHORIZED" ? call.outcome : "EXECUTED" })
    const orchestratorAgentId = text(call.orchestratorAgentId)
    if (orchestratorAgentId) add({ agentId: orchestratorAgentId, agentVersionId: text(call.orchestratorAgentVersionId), orchestratorId, orchestratorVersionId, role: "ORCHESTRATOR_AGENT", outcome: "EXECUTED" })
  }
  if (agentId && !participants.has(`${agentId}|SPECIALIST`)) add({ agentId, agentVersionId: null, orchestratorId: null, orchestratorVersionId: null, role: "SPECIALIST", outcome: "EXECUTED" })
  return [...participants.values()]
}

/** Grava a participação travando a linha do agente (FOR SHARE), como o registro de execução: nunca para um agente já excluído. */
async function recordAgentParticipation(db: Queryable, organizationId: string, interactionId: string, participants: Participant[]): Promise<void> {
  for (const participant of participants) {
    await db.query(
      `insert into assistant_interaction_agents (organization_id, interaction_id, agent_id, agent_version_id, orchestrator_id, orchestrator_version_id, role, outcome)
       select $1, $2, a.id, coalesce((select v.id from agent_versions v where v.id = $4::uuid and v.agent_id = a.id), a.current_version_id),
              (select o.id from assistant_orchestrators o where o.id = $5::uuid), (select ov.id from assistant_orchestrator_versions ov where ov.id = $6::uuid), $7, $8
         from agents a where a.id = $3 and a.organization_id = $1
       for share of a
       on conflict (interaction_id, agent_id, role) do nothing`,
      [organizationId, interactionId, participant.agentId, participant.agentVersionId, participant.orchestratorId, participant.orchestratorVersionId, participant.role, participant.outcome],
    )
  }
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
  /** Sinais gravados com a mensagem (migration 181); `null` = sem linha (anterior à migration, ou mensagem sem sinal calculado). */
  signals: SupportSignal[] | null
}
type MessageRow = { id: string; channel: "chat" | "voice"; role: "user" | "assistant"; content: string; agent_id: string | null; occurred_at: Date; seq: string; client_message_id: string | null; tool_calls?: unknown; signals?: string[] | null }

const knownSignals = (raw: string[] | null | undefined): SupportSignal[] | null => (raw ? SUPPORT_SIGNALS.filter((signal) => raw.includes(signal)) : null)

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
/** A chave EXATA gravada pela entrega de Chat — `workflow-output:<id da entrega>` (conversational-delivery/application/
 * deliver-conversational-output.ts). Só a forma exata: toda chave vinda do navegador ganha um sufixo, então um prefixo escolhido por
 * ele nunca vira "Recado enviado por um fluxo" (achado C11 da 4ª auditoria). */
export const WORKFLOW_MESSAGE_KEY_PATTERN = "^workflow-output:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
const WORKFLOW_MESSAGE_KEY = new RegExp(WORKFLOW_MESSAGE_KEY_PATTERN, "i")
/** Mesma chave da apresentação gravada pela aplicação de feedback (feedback-application-service.ts). */
const FEEDBACK_PRESENTATION_KEY = "feedback-application:presentation"
export const messageOriginOf = (role: "user" | "assistant", clientMessageId: string | null | undefined): ConversationMessage["origin"] =>
  role !== "assistant" ? null : clientMessageId && WORKFLOW_MESSAGE_KEY.test(clientMessageId) ? "WORKFLOW" : clientMessageId === FEEDBACK_PRESENTATION_KEY ? "FEEDBACK" : null
const toMessage = (row: MessageRow): ConversationMessage => {
  const occurredAt = new Date(row.occurred_at).toISOString()
  const origin = messageOriginOf(row.role, row.client_message_id)
  return { id: row.id, channel: row.channel, role: row.role, content: row.content, agentId: row.agent_id, occurredAt, cursor: encodeCursor({ occurredAt, seq: String(row.seq) }), origin, analytics: row.role === "assistant" ? analyticsCardsOf(row.tool_calls) : [], clarification: row.role === "assistant" ? clarificationPayloadOf(row.tool_calls) : null, clarificationScope: row.role === "assistant" ? clarificationScopeOf(row.tool_calls) : null, signals: knownSignals(row.signals) }
}

/**
 * Página de mensagens de UMA conversa, em ordem cronológica estável (occurred_at, seq). `before` = mensagens anteriores
 * ao cursor (as mais recentes primeiro na busca, devolvidas em ordem crescente); `after` = mensagens novas depois do
 * cursor (atualização de conversa em andamento). A conversa já deve ter sido autorizada por quem chama.
 */
export async function loadConversationMessages(
  db: Queryable,
  input: { organizationId: string; conversationId: string; limit: number; before?: MessageCursor | null; after?: MessageCursor | null; ownerPersonId?: string },
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
  // Com `ownerPersonId`, conversa de outra pessoa não devolve nada (na mesma consulta, sem ida a mais ao banco).
  if (input.ownerPersonId) {
    params.push(input.ownerPersonId)
    where += ` and exists (select 1 from assistant_conversations c where c.id = $2 and c.organization_id = $1 and c.owner_person_id = $${params.length})`
  }
  const result = await db.query<MessageRow>(
    `select i.id, i.channel, i.role, i.content, i.agent_id, i.occurred_at, i.seq::text seq, i.client_message_id, i.tool_calls, s.signals
       from assistant_interactions i left join assistant_reply_signals s on s.interaction_id = i.id
     where i.organization_id = $1 and i.conversation_id = $2 ${where}
     order by i.occurred_at ${order}, i.seq ${order} limit $3`,
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
  /** `ownerPersonId` = só se a conversa for dessa pessoa (vazio se não for). */
  loadMessages(input: { organizationId: string; conversationId: string; limit: number; before?: MessageCursor | null; after?: MessageCursor | null; ownerPersonId?: string }): Promise<{ messages: ConversationMessage[]; hasMore: boolean }>
  contextTurns(input: { organizationId: string; conversationId: string }): Promise<{ role: "user" | "model"; text: string }[]>
  listOwn(scope: ConversationScope, page: number, pageSize: number): Promise<{ items: ConversationSummary[]; total: number }>
  ownSummary(scope: ConversationScope, id: string): Promise<ConversationSummary | null>
  /** Curtir/descurtir de uma resposta da INIA pela dona da conversa (migrations 158 e 181); 404 fora disso. */
  rate(scope: ConversationScope, input: RateConversationMessageInput, now: Date): Promise<RatingResult>
  /** Avaliações vigentes da dona para estas respostas, com o motivo da descurtida. */
  ratingsOf(scope: ConversationScope, interactionIds: readonly string[]): Promise<Map<string, RatingSnapshot>>
  /** Sinal `NO_REPLY` na pergunta do chat livre cujo turno terminou em erro; `true` = gravado agora. */
  markNoReply(scope: ConversationScope, questionId: string): Promise<boolean>
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
    markNoReply: (scope, questionId) => markConversationNoReply(db, scope, questionId),
  }
}
