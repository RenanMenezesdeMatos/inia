import { DomainError } from "../../../shared/domain/domain-error.js"
import type { TransactionSource } from "../../../shared/infrastructure/database/transaction.js"
import { HUMAN_SUPPORT_LIMITS } from "../domain/catalogs.js"
import { NO_RECEIPTS, receiptsAfterAck, sameReceipts, type ConversationSide, type ReceiptAck, type Receipts } from "../domain/conversation-marks.js"
import { bumpInboxVersions } from "./inbox-versions.js"
import { inSupportTransaction, type Queryable } from "./locks.js"
import type { Viewer } from "./request-service.js"

/**
 * "DIGITANDO", ENTREGUE E LIDO (migration 184; regra em `domain/conversation-marks.ts`). Só quem está na conversa marca: o operador
 * dono do pedido e o Anjo do atendimento em andamento. Sem a trava da organização nem a linha do pedido: cada marca trava só a própria
 * linha de `human_support_conversation_marks` e, por último, a versão da OUTRA ponta (a chamada longa dela acorda e a tela mostra o
 * aviso ou os tiques). Ordem das travas igual à do resto do módulo: marcas antes das versões por pessoa.
 */
const notFound = () => new DomainError("Pedido de apoio não encontrado.", "HUMAN_SUPPORT_REQUEST_NOT_FOUND", 404)

type Participants = { status: string; lastSeq: number; operatorPersonId: string; activeAnjoPersonId: string | null }

async function loadParticipants(db: Queryable, organizationId: string, requestId: string): Promise<Participants | null> {
  const row = (
    await db.query<{ status: string; last_seq: number; operator_person_id: string; anjo_person_id: string | null }>(
      `select r.status, r.next_seq - 1 last_seq, r.operator_person_id, a.anjo_person_id
         from human_support_requests r
         left join human_support_attendances a on a.request_id = r.id and a.status = 'ACTIVE'
        where r.organization_id = $1 and r.id = $2`,
      [organizationId, requestId],
    )
  ).rows[0]
  return row ? { status: row.status, lastSeq: Number(row.last_seq), operatorPersonId: row.operator_person_id, activeAnjoPersonId: row.anjo_person_id } : null
}

/** Em que ponta da conversa a pessoa está; quem não está nela recebe 404 (não revela que o pedido existe). */
function sideOf(participants: Participants, viewer: Viewer, viewerIsAnjo: boolean): ConversationSide {
  if (participants.operatorPersonId === viewer.personId) return "OPERATOR"
  if (viewerIsAnjo && participants.activeAnjoPersonId === viewer.personId) return "ANJO"
  throw notFound()
}

const peerPersonOf = (participants: Participants, side: ConversationSide) => (side === "OPERATOR" ? participants.activeAnjoPersonId : participants.operatorPersonId)
const column = (side: ConversationSide) => (side === "OPERATOR" ? "operator" : "anjo")

async function ensureMarksRow(client: Queryable, organizationId: string, requestId: string) {
  await client.query(`insert into human_support_conversation_marks (request_id, organization_id) values ($1, $2) on conflict (request_id) do nothing`, [requestId, organizationId])
}

/**
 * A pessoa começou (ou continua) a escrever, ou parou sem enviar. Só vale com atendimento em andamento (na fila não há quem veja).
 * Começar ou renovar sempre avisa a outra ponta (o aviso dela tem prazo); parar avisa só se o aviso ainda estava valendo.
 */
export async function signalTyping(db: TransactionSource & Queryable, viewer: Viewer, requestId: string, input: { typing: boolean; viewerIsAnjo: boolean }): Promise<void> {
  const participants = await loadParticipants(db, viewer.organizationId, requestId)
  if (!participants) throw notFound()
  const side = sideOf(participants, viewer, input.viewerIsAnjo)
  const peer = peerPersonOf(participants, side)
  if (participants.status !== "IN_PROGRESS" || !peer) return
  const col = `${column(side)}_typing_until`
  await inSupportTransaction(db, async (client) => {
    await ensureMarksRow(client, viewer.organizationId, requestId)
    const was = (await client.query<{ active: boolean }>(`select coalesce(${col} > statement_timestamp(), false) active from human_support_conversation_marks where request_id = $1 for update`, [requestId])).rows[0]?.active === true
    await client.query(
      `update human_support_conversation_marks
          set ${col} = case when $2::boolean then statement_timestamp() + make_interval(secs => $3::int) end, updated_at = statement_timestamp()
        where request_id = $1`,
      [requestId, input.typing, HUMAN_SUPPORT_LIMITS.typingTtlSeconds],
    )
    if (input.typing || was) await bumpInboxVersions(client, viewer.organizationId, [peer])
  })
}

/**
 * A tela confirma até onde RECEBEU (entregue) e até onde a pessoa VIU (lida). Só com o pedido aberto. Quando o recibo avança, a outra
 * ponta é avisada (os tiques das mensagens dela mudam). Devolve o recibo atual desta ponta.
 */
export async function acknowledgeMessages(db: TransactionSource & Queryable, viewer: Viewer, requestId: string, input: ReceiptAck & { viewerIsAnjo: boolean }): Promise<Receipts> {
  const participants = await loadParticipants(db, viewer.organizationId, requestId)
  if (!participants) throw notFound()
  const side = sideOf(participants, viewer, input.viewerIsAnjo)
  const prefix = column(side)
  return inSupportTransaction(db, async (client) => {
    await ensureMarksRow(client, viewer.organizationId, requestId)
    const row = (await client.query<{ delivered: number; read: number }>(`select ${prefix}_delivered_seq delivered, ${prefix}_read_seq read from human_support_conversation_marks where request_id = $1 for update`, [requestId])).rows[0]
    const current: Receipts = row ? { deliveredSeq: Number(row.delivered), readSeq: Number(row.read) } : NO_RECEIPTS
    if (participants.status !== "WAITING" && participants.status !== "IN_PROGRESS") return current
    const next = receiptsAfterAck(current, input, participants.lastSeq)
    if (sameReceipts(current, next)) return current
    await client.query(`update human_support_conversation_marks set ${prefix}_delivered_seq = $2, ${prefix}_read_seq = $3, updated_at = statement_timestamp() where request_id = $1`, [requestId, next.deliveredSeq, next.readSeq])
    await bumpInboxVersions(client, viewer.organizationId, [peerPersonOf(participants, side)])
    return next
  })
}

/** Ao enviar uma mensagem, quem escreveu deixa de estar "digitando" (na mesma transação da mensagem, antes das versões). */
export async function clearTypingOnSend(client: Queryable, requestId: string, side: ConversationSide): Promise<void> {
  const col = `${column(side)}_typing_until`
  await client.query(`update human_support_conversation_marks set ${col} = null, updated_at = statement_timestamp() where request_id = $1 and ${col} is not null`, [requestId])
}

/** O que cada ponta vê da OUTRA: até onde ela recebeu e viu, e por quantos ms ainda vale o "digitando" (null = não está). */
export type PeerMarks = { peerReceipts: Receipts; peerTypingMs: number | null }
export type ConversationMarks = { operator: PeerMarks; anjo: PeerMarks }

const NO_MARKS: ConversationMarks = { operator: { peerReceipts: NO_RECEIPTS, peerTypingMs: null }, anjo: { peerReceipts: NO_RECEIPTS, peerTypingMs: null } }

/**
 * Marcas de vários pedidos numa consulta. `operator` = o que o OPERADOR vê (recibos e "digitando" do lado do Anjo); `anjo` = o que o
 * ANJO vê (do lado do operador). O "digitando" só aparece com atendimento em andamento.
 */
export async function loadConversationMarks(db: Queryable, requestIds: readonly string[]): Promise<Map<string, ConversationMarks>> {
  const marks = new Map<string, ConversationMarks>()
  if (requestIds.length === 0) return marks
  const rows = (
    await db.query<{ request_id: string; operator_delivered_seq: number; operator_read_seq: number; anjo_delivered_seq: number; anjo_read_seq: number; operator_typing_ms: number | null; anjo_typing_ms: number | null }>(
      `select m.request_id, m.operator_delivered_seq, m.operator_read_seq, m.anjo_delivered_seq, m.anjo_read_seq,
              case when r.status = 'IN_PROGRESS' and m.operator_typing_until > statement_timestamp()
                   then ceil(extract(epoch from m.operator_typing_until - statement_timestamp()) * 1000)::int end operator_typing_ms,
              case when r.status = 'IN_PROGRESS' and m.anjo_typing_until > statement_timestamp()
                   then ceil(extract(epoch from m.anjo_typing_until - statement_timestamp()) * 1000)::int end anjo_typing_ms
         from human_support_conversation_marks m
         join human_support_requests r on r.id = m.request_id
        where m.request_id = any($1::uuid[])`,
      [[...requestIds]],
    )
  ).rows
  for (const row of rows) {
    marks.set(row.request_id, {
      operator: { peerReceipts: { deliveredSeq: Number(row.anjo_delivered_seq), readSeq: Number(row.anjo_read_seq) }, peerTypingMs: row.anjo_typing_ms === null ? null : Number(row.anjo_typing_ms) },
      anjo: { peerReceipts: { deliveredSeq: Number(row.operator_delivered_seq), readSeq: Number(row.operator_read_seq) }, peerTypingMs: row.operator_typing_ms === null ? null : Number(row.operator_typing_ms) },
    })
  }
  for (const id of requestIds) if (!marks.has(id)) marks.set(id, NO_MARKS)
  return marks
}
