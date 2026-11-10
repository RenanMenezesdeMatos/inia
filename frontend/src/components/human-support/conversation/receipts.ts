import type { Receipts } from "@/schemas/human-support/state.schema"

/** Estado de uma mensagem PRÓPRIA para quem escreveu, pelos recibos da outra ponta (cursores sobre o `seq`). */
export type ReceiptStatus = "SENT" | "DELIVERED" | "READ"

export function receiptStatus(seq: number, peer: Receipts): ReceiptStatus {
  if (peer.readSeq >= seq) return "READ"
  if (peer.deliveredSeq >= seq) return "DELIVERED"
  return "SENT"
}

export const RECEIPT_LABELS: Record<ReceiptStatus, string> = { SENT: "Enviada", DELIVERED: "Entregue", READ: "Lida" }

/** O maior `seq` de uma lista de mensagens (0 = nenhuma). */
export const lastSeqOf = (messages: readonly { seq: number }[]) => messages.reduce((max, message) => Math.max(max, message.seq), 0)
