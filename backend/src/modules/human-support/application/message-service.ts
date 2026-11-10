import { DomainError } from "../../../shared/domain/domain-error.js"
import type { TransactionSource } from "../../../shared/infrastructure/database/transaction.js"
import { loadPersonPresentations } from "../../profile-preferences/application/person-presentation-loader.js"
import { canWriteMessage } from "../domain/request-lifecycle.js"
import type { MessageView } from "../domain/views.js"
import { clearTypingOnSend } from "./conversation-marks.js"
import { bumpInboxVersions } from "./inbox-versions.js"
import { inSupportTransaction, type Queryable } from "./locks.js"
import { loadActiveAttendance, loadMessageViews, loadRequest } from "./request-views.js"
import type { Viewer } from "./request-service.js"

/**
 * CONVERSA HUMANA operador ↔ Anjo (design_draft.md seção 10). Tabela própria (`human_support_messages`): nada daqui entra em
 * `assistant_conversations`/`assistant_interactions`, e nenhum caminho de modelo lê estas mensagens. A mensagem trava a linha do
 * pedido (`for update`): serializa as mensagens entre si e com o encerramento, e o `seq` sai sem lacunas. O operador escreve na fila
 * e no atendimento; o Anjo, só no próprio atendimento em andamento. A primeira mensagem do Anjo grava `first_anjo_message_at` (D2).
 * Quem envia deixa de aparecer como "digitando" na mesma transação (migration 184).
 */
const notFound = () => new DomainError("Pedido de apoio não encontrado.", "HUMAN_SUPPORT_REQUEST_NOT_FOUND", 404)

export async function sendMessage(db: TransactionSource & Queryable, viewer: Viewer, requestId: string, input: { clientMessageId: string; body: string; viewerIsAnjo: boolean }): Promise<{ message: MessageView; created: boolean }> {
  const result = await inSupportTransaction(db, async (client) => {
    const request = await loadRequest(client, viewer.organizationId, requestId, { forUpdate: true })
    if (!request) throw notFound()
    const attendance = await loadActiveAttendance(client, request.id, { forUpdate: true })
    const isOperator = request.operator_person_id === viewer.personId
    const isActiveAnjo = Boolean(input.viewerIsAnjo && attendance && attendance.anjo_person_id === viewer.personId)
    if (!isOperator && !isActiveAnjo) throw notFound()
    const repeated = (await client.query<{ seq: number }>(`select seq from human_support_messages where request_id = $1 and client_message_id = $2`, [request.id, input.clientMessageId])).rows[0]
    if (repeated) return { seq: Number(repeated.seq), created: false, reader: isOperator ? ("OPERATOR" as const) : ("ANJO" as const) }
    const author: "OPERATOR" | "ANJO" = isOperator ? "OPERATOR" : "ANJO"
    const allowed = canWriteMessage({ status: request.status, author, isActiveAnjo })
    if (!allowed.ok) {
      if (allowed.code === "NOT_FOUND") throw notFound()
      throw new DomainError("Este atendimento já foi encerrado.", "HUMAN_SUPPORT_REQUEST_ENDED", 409)
    }
    const seq = Number((await client.query<{ seq: number }>(`update human_support_requests set next_seq = next_seq + 1 where id = $1 returning next_seq - 1 as seq`, [request.id])).rows[0]!.seq)
    await client.query(
      `insert into human_support_messages (organization_id, request_id, attendance_id, operator_person_id, author_kind, author_person_id, body, client_message_id, seq, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, statement_timestamp())`,
      [viewer.organizationId, request.id, attendance?.id ?? null, request.operator_person_id, author, viewer.personId, input.body, input.clientMessageId, seq],
    )
    if (attendance) {
      await client.query(
        `update human_support_attendances
            set last_human_message_at = statement_timestamp(),
                first_anjo_message_at = case when $2 = 'ANJO' and first_anjo_message_at is null then statement_timestamp() else first_anjo_message_at end
          where id = $1`,
        [attendance.id, author],
      )
    }
    await clearTypingOnSend(client, request.id, author)
    await bumpInboxVersions(client, viewer.organizationId, [request.operator_person_id, attendance?.anjo_person_id])
    return { seq, created: true, reader: author }
  })
  const page = await loadMessageViews(db, viewer.organizationId, requestId, result.reader, { after: result.seq - 1, limit: 1 })
  return { message: page.messages[0]!, created: result.created }
}

/**
 * Mensagens de um pedido: o operador lê todas; o Anjo, as do pedido que atendeu, do início até o fim do PRÓPRIO atendimento (em
 * andamento = todas), enquanto tiver o papel (D5). Coordenador e Administrador geral leem pelo painel do apoio, não por aqui.
 */
export async function listMessages(db: Queryable, viewer: Viewer, requestId: string, query: { after?: number | undefined; before?: number | undefined; limit?: number | undefined; viewerIsAnjo: boolean }): Promise<{ messages: MessageView[]; hasMore: boolean }> {
  const request = await loadRequest(db, viewer.organizationId, requestId)
  if (!request) throw notFound()
  if (request.operator_person_id === viewer.personId) return loadMessageViews(db, viewer.organizationId, requestId, "OPERATOR", query)
  if (!query.viewerIsAnjo) throw notFound()
  const attended = (await db.query<{ active: boolean; ended_at: Date | null }>(`select status = 'ACTIVE' active, ended_at from human_support_attendances where request_id = $1 and anjo_person_id = $2`, [requestId, viewer.personId])).rows
  if (attended.length === 0) throw notFound()
  if (attended.some((row) => row.active)) return loadMessageViews(db, viewer.organizationId, requestId, "ANJO", query)
  const lastEnd = new Date(Math.max(...attended.map((row) => row.ended_at?.getTime() ?? 0)))
  const maxSeq = Number((await db.query<{ seq: number | null }>(`select max(seq) seq from human_support_messages where request_id = $1 and occurred_at <= $2`, [requestId, lastEnd])).rows[0]?.seq ?? 0)
  return loadMessageViews(db, viewer.organizationId, requestId, "ANJO", { ...query, maxSeq })
}

/** Nome preferido de uma pessoa (cabeçalhos e mensagens). */
export async function displayNameOf(db: Queryable, organizationId: string, personId: string): Promise<string> {
  return (await loadPersonPresentations(db, organizationId, [personId])).get(personId)?.displayName ?? "Pessoa"
}
