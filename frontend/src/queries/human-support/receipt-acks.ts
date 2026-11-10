"use client"

import { useEffect } from "react"
import { usePageSeen } from "@/hooks/use-page-seen"
import { acknowledgeSupportMessages } from "@/services/human-support/human-support-service"

/**
 * CONFIRMAÇÕES DE ENTREGUE E LIDO que esta aba manda ao servidor (migration 184). Uma memória por pedido do que já foi confirmado:
 * só sai chamada quando o cursor avança (o servidor também só avança — repetir não muda nada). Falhou, a memória volta e a próxima
 * oportunidade tenta de novo.
 *  - Entregue: o aplicativo recebeu as mensagens (estado do apoio do operador; leitura das mensagens na área do Anjo).
 *  - Lida: a conversa está na tela, com a aba visível e a janela em foco (`usePageSeen`).
 */
type Acked = { deliveredSeq: number; readSeq: number }
const acked = new Map<string, Acked>()

export function acknowledgeOnce(requestId: string, ack: { deliveredSeq?: number; readSeq?: number }, send: typeof acknowledgeSupportMessages = acknowledgeSupportMessages): void {
  const current = acked.get(requestId) ?? { deliveredSeq: 0, readSeq: 0 }
  const readSeq = Math.max(current.readSeq, ack.readSeq ?? 0)
  const deliveredSeq = Math.max(current.deliveredSeq, ack.deliveredSeq ?? 0, readSeq)
  if (deliveredSeq === current.deliveredSeq && readSeq === current.readSeq) return
  const next = { deliveredSeq, readSeq }
  acked.set(requestId, next)
  Promise.resolve()
    .then(() => send(requestId, readSeq > current.readSeq ? { deliveredSeq, readSeq } : { deliveredSeq }))
    .catch(() => {
      if (acked.get(requestId) === next) acked.set(requestId, current)
    })
}

/** Só para testes: esquece o que já foi confirmado. */
export function resetAcknowledgementsForTests() {
  acked.clear()
}

/** Marca como lida até `lastSeq` enquanto a conversa estiver na tela (`active`) e a página estiver sendo vista. */
export function useReadAcknowledgement(requestId: string | null, lastSeq: number, active: boolean) {
  const seen = usePageSeen()
  useEffect(() => {
    if (!requestId || !active || !seen || lastSeq <= 0) return
    acknowledgeOnce(requestId, { readSeq: lastSeq })
  }, [requestId, lastSeq, active, seen])
}
