/**
 * MARCAS DA CONVERSA operador ↔ Anjo (migration 184): "digitando", entregue e lido, como num aplicativo de mensagens.
 *
 * - Entregue: o aplicativo da outra pessoa RECEBEU a mensagem (a tela confirma ao receber).
 * - Lida: a outra pessoa estava com a conversa NA TELA, com a janela em foco, quando a mensagem apareceu (a tela confirma).
 * - Digitando: a tela avisa enquanto a pessoa escreve; o aviso vale por `HUMAN_SUPPORT_LIMITS.typingTtlSeconds` e some sozinho.
 *
 * Os recibos são cursores sobre o `seq` do pedido. Esta função é a única regra de avanço: só para a frente, nunca além da última
 * mensagem do pedido, e lida implica entregue.
 */
export type ConversationSide = "OPERATOR" | "ANJO"
export type Receipts = { deliveredSeq: number; readSeq: number }
export type ReceiptAck = { deliveredSeq?: number | undefined; readSeq?: number | undefined }

export const NO_RECEIPTS: Receipts = { deliveredSeq: 0, readSeq: 0 }

export function receiptsAfterAck(current: Receipts, ack: ReceiptAck, lastSeq: number): Receipts {
  const cap = (value: number | undefined) => Math.max(0, Math.min(value ?? 0, lastSeq))
  const readSeq = Math.max(current.readSeq, cap(ack.readSeq))
  const deliveredSeq = Math.max(current.deliveredSeq, cap(ack.deliveredSeq), readSeq)
  return { deliveredSeq, readSeq }
}

export const sameReceipts = (left: Receipts, right: Receipts) => left.deliveredSeq === right.deliveredSeq && left.readSeq === right.readSeq

/** A outra ponta da conversa. */
export const peerOf = (side: ConversationSide): ConversationSide => (side === "OPERATOR" ? "ANJO" : "OPERATOR")
