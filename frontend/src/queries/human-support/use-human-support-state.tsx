"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { OperatorView } from "@/schemas/human-support/state.schema"
import { acknowledgeOnce } from "./receipt-acks"
import { startStatePoller, type StatePoller } from "./state-poller"

/**
 * ESTADO DO APOIO COM ANJO PARA O OPERADOR (design_draft.md seção 11): um provedor montado UMA vez no shell autenticado; o chat, o
 * selo e a sala leem por `useHumanSupportState()` e nunca abrem outra chamada. Uma aba líder por navegador (Web Locks
 * `inia-human-support-operator`) faz as chamadas e repassa o estado às outras abas por `BroadcastChannel`; sem Web Locks, cada aba
 * chama sozinha. Chamada longa só com pedido aberto ou avaliação pendente. A líder confirma ao servidor que as mensagens do pedido
 * aberto CHEGARAM a este aplicativo (o tique de entregue que o Anjo vê); lida é a sala que confirma, quando está na tela.
 */
type HumanSupportState = {
  /** null = ainda não carregado (ou sem sessão). */
  operator: OperatorView | null
  reconnecting: boolean
  /** Busca agora (depois de um comando do operador). */
  refresh: () => void
  /** Aplica a visão devolvida por um comando antes da próxima resposta da chamada de estado. */
  applyOperator: (operator: OperatorView) => void
}

const HumanSupportContext = createContext<HumanSupportState>({ operator: null, reconnecting: false, refresh: () => {}, applyOperator: () => {} })

const CHANNEL = "inia-human-support-operator"
const LOCK = "inia-human-support-operator"
type ChannelMessage = { type: "state"; operator: OperatorView | null; reconnecting: boolean } | { type: "refresh" }

export const operatorNeedsWait = (operator: OperatorView | null | undefined) => Boolean(operator?.openRequest || (operator?.pendingEvaluations.length ?? 0) > 0)

export function HumanSupportStateProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const [operator, setOperator] = useState<OperatorView | null>(null)
  const [reconnecting, setReconnecting] = useState(false)
  const pollerRef = useRef<StatePoller | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let releaseLock: (() => void) | null = null
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL)
    channelRef.current = channel
    const startLeader = () => {
      if (disposed) return
      pollerRef.current = startStatePoller({
        workspace: "none",
        shouldWait: (state) => operatorNeedsWait(state.operator),
        onState: (state) => {
          setOperator(state.operator)
          const open = state.operator?.openRequest
          const received = open ? open.messages.reduce((max, message) => Math.max(max, message.seq), 0) : 0
          if (open && received > 0) acknowledgeOnce(open.id, { deliveredSeq: received })
          channel?.postMessage({ type: "state", operator: state.operator, reconnecting: false } satisfies ChannelMessage)
        },
        onReconnecting: (value) => {
          setReconnecting(value)
          if (value) channel?.postMessage({ type: "state", operator: null, reconnecting: true } satisfies ChannelMessage)
        },
      })
    }
    if (channel) {
      channel.onmessage = (event: MessageEvent<ChannelMessage>) => {
        const message = event.data
        if (message.type === "refresh") pollerRef.current?.refresh()
        else if (!pollerRef.current) {
          if (message.operator) setOperator(message.operator)
          setReconnecting(message.reconnecting)
        }
      }
    }
    const locks = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { locks?: LockManager }).locks
    if (locks && channel) {
      // Seguidora até virar líder: pede o estado atual a quem lidera.
      channel.postMessage({ type: "refresh" } satisfies ChannelMessage)
      void locks
        // Trava recebida depois de o provedor sair (montagem dupla do React, troca rápida de tela): devolve na hora, senão nenhuma
        // montagem seguinte vira líder e o estado do apoio nunca chega.
        .request(LOCK, () => (disposed ? Promise.resolve() : new Promise<void>((resolve) => {
          releaseLock = resolve
          startLeader()
        })))
        .catch(() => startLeader())
    } else startLeader()
    // Voltar para a aba: confere o estado (liga/desliga pode ter mudado).
    const onVisible = () => {
      if (document.visibilityState !== "visible") return
      if (pollerRef.current) pollerRef.current.refresh()
      else channel?.postMessage({ type: "refresh" } satisfies ChannelMessage)
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      disposed = true
      document.removeEventListener("visibilitychange", onVisible)
      pollerRef.current?.stop()
      pollerRef.current = null
      releaseLock?.()
      channel?.close()
      channelRef.current = null
    }
  }, [enabled])

  const refresh = useCallback(() => {
    if (pollerRef.current) pollerRef.current.refresh()
    else channelRef.current?.postMessage({ type: "refresh" } satisfies ChannelMessage)
  }, [])
  const applyOperator = useCallback((next: OperatorView) => setOperator(next), [])
  const value = useMemo(() => ({ operator, reconnecting, refresh, applyOperator }), [operator, reconnecting, refresh, applyOperator])
  return <HumanSupportContext.Provider value={value}>{children}</HumanSupportContext.Provider>
}

export function useHumanSupportState(): HumanSupportState {
  return useContext(HumanSupportContext)
}

/** Para testes e telas de demonstração: um valor fixo do estado do apoio, sem chamadas. */
export function HumanSupportStateValueProvider({ value, children }: { value: Partial<HumanSupportState>; children: ReactNode }) {
  const full = useMemo<HumanSupportState>(() => ({ operator: null, reconnecting: false, refresh: () => {}, applyOperator: () => {}, ...value }), [value])
  return <HumanSupportContext.Provider value={full}>{children}</HumanSupportContext.Provider>
}
