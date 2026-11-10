import type { Database } from "../../../infrastructure/database/pool.js"
import { CHAT_DISLIKE_REASON_LABELS, type ChatDislikeReason } from "../domain/assistant-interaction-rating.js"
import { SUPPORT_SIGNALS, type SupportSignal } from "../domain/reply-signals.js"
import { parseClarificationState } from "../../knowledge-clarification/domain/clarification-state.js"
import { clarificationPayloadOf } from "./assistant-conversations.js"

// O que o apoio usa do chat além da cópia da troca: encerrar a conversa de origem quando o atendimento termina.
export { closeConversationAfterHumanSupport } from "./assistant-conversations.js"

/**
 * CÓPIA DA TROCA para um pedido de apoio (design de Apoio com Anjo, seção 7). A prévia e a criação do pedido chamam esta MESMA função
 * com os mesmos ids: o Anjo recebe exatamente o que o operador viu. Montada só de linhas que não mudam depois de gravadas:
 *  - pergunta: a original do esclarecimento pelas bases, quando a resposta saiu dele; senão a mensagem do operador imediatamente
 *    anterior; numa pergunta com `NO_REPLY`, ela mesma;
 *  - resposta: o texto da mensagem da INIA — sempre (D10) —, sem cartões, materiais, estado do esclarecimento nem os marcadores de
 *    fonte que a tela tira;
 *  - motivo e comentário: da versão de avaliação informada (`ratingId`), só quando ela é a descurtida da própria pessoa com "ainda
 *    preciso de ajuda" (é essa versão que faz a origem ser `DISLIKE`).
 * `null` = a mensagem não existe, não é da pessoa ou não é do chat livre (quem chama responde 404). A ORIGEM do pedido é decidida
 * por quem chama, a partir de `facts` — este módulo não conhece o apoio.
 */
export type SupportContextCopy = {
  question: string | null
  answer: string | null
  dislike: { reason: ChatDislikeReason; reasonLabel: string; comment: string | null } | null
}
/** `conversationId` = a conversa da mensagem (o pedido guarda a origem sem ler as tabelas do assistant). */
export type SupportContext = { conversationId: string; facts: { dislikeNeedsHelp: boolean; signals: SupportSignal[] }; sharedContext: SupportContextCopy }

type MessageRow = { id: string; role: "user" | "assistant"; content: string; tool_calls: unknown; occurred_at: Date; seq: string; conversation_id: string; signals: string[] | null }
type RatingRow = { value: string; reason: ChatDislikeReason | null; comment: string | null; still_needs_help: boolean | null }

/** Os marcadores de fonte ([1], [2]…) de uma resposta pelas bases, como a tela os tira (só os que correspondem a uma fonte). */
export function withoutSourceMarkers(text: string, sourceCount: number): string {
  if (sourceCount === 0) return text
  return text.replace(/[ \t]*\[(\d{1,2})\]/g, (marker, number: string) => (Number(number) >= 1 && Number(number) <= sourceCount ? "" : marker))
}

export async function buildSupportContext(
  db: Pick<Database, "query">,
  input: { organizationId: string; ownerPersonId: string; interactionId: string; ratingId?: string | null },
): Promise<SupportContext | null> {
  const message = (
    await db.query<MessageRow>(
      `select i.id, i.role, i.content, i.tool_calls, i.occurred_at, i.seq::text seq, i.conversation_id, s.signals
         from assistant_interactions i
         join assistant_conversations c on c.id = i.conversation_id
         left join assistant_reply_signals s on s.interaction_id = i.id
        where i.id = $1 and i.organization_id = $2 and c.organization_id = $2 and c.owner_person_id = $3 and c.origin = 'USER'`,
      [input.interactionId, input.organizationId, input.ownerPersonId],
    )
  ).rows[0]
  if (!message) return null
  const signals = SUPPORT_SIGNALS.filter((signal) => (message.signals ?? []).includes(signal))

  // Pergunta que ficou sem resposta (`NO_REPLY`): a cópia é ela mesma.
  if (message.role === "user") return { conversationId: message.conversation_id, facts: { dislikeNeedsHelp: false, signals }, sharedContext: { question: message.content, answer: null, dislike: null } }

  const clarification = parseClarificationState(clarificationPayloadOf(message.tool_calls))
  const question = clarification
    ? clarification.originalQuestion
    : ((
        await db.query<{ content: string }>(
          `select content from assistant_interactions
            where conversation_id = $1 and role = 'user' and (occurred_at, seq) < ($2::timestamptz, $3::bigint)
            order by occurred_at desc, seq desc limit 1`,
          [message.conversation_id, message.occurred_at, message.seq],
        )
      ).rows[0]?.content ?? null)

  const rating = input.ratingId
    ? ((
        await db.query<RatingRow>(
          `select r.value, d.reason, d.comment, d.still_needs_help
             from assistant_interaction_ratings r left join assistant_interaction_rating_details d on d.rating_id = r.id
            where r.id = $1 and r.interaction_id = $2 and r.person_id = $3 and r.organization_id = $4`,
          [input.ratingId, message.id, input.ownerPersonId, input.organizationId],
        )
      ).rows[0] ?? null)
    : null
  const dislikeNeedsHelp = rating?.value === "DOWN" && rating.still_needs_help === true && rating.reason !== null
  return {
    conversationId: message.conversation_id,
    facts: { dislikeNeedsHelp, signals },
    sharedContext: {
      question,
      answer: withoutSourceMarkers(message.content, clarification?.sources.length ?? 0),
      dislike: dislikeNeedsHelp ? { reason: rating!.reason!, reasonLabel: CHAT_DISLIKE_REASON_LABELS[rating!.reason!], comment: rating!.comment } : null,
    },
  }
}
