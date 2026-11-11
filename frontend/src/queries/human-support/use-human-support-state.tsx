"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { usePageSeen } from "@/hooks/use-page-seen"
import { blinkTabTitle, createChime, newMessageTitle, pageIsSeen, primeChimeOnFirstGesture, stopTabTitleBlink, type Chime } from "@/lib/attention/attention-alert"
import type { OperatorRequestView, OperatorView } from "@/schemas/human-support/state.schema"
import { acknowledgeOnce } from "./receipt-acks"
import { startStatePoller, type StatePoller } from "./state-poller"

/**
 * ESTADO DO APOIO COM ANJO PARA O OPERADOR (design_draft.md seção 11): um provedor montado UMA vez no shell autenticado; o chat, o
 * selo e a sala leem por `useHumanSupportState()` e nunca abrem outra chamada. Uma aba líder por navegador (Web Locks
 * `inia-human-support-operator`) faz as chamadas e repassa o estado às outras abas por `BroadcastChannel`; sem Web Locks, cada aba
 * chama sozinha. Chamada longa só com pedido aberto ou avaliação pendente. A líder confirma ao servidor que as mensagens do pedido
 * aberto CHEGARAM a este aplicativo (o tique de entregue que o Anjo vê); lida é a sala que confirma, quando está na tela.
 *
 * MENSAGEM NOVA DO ANJO FORA DA VISTA: conta como nova a mensagem do Anjo depois do "lida" do operador (`readSeq` do servidor, ou o que
 * a sala desta aba acabou de ver). Ao chegar uma, com a sala na tela e a página vista, nada (ela já aparece); com a página vista e a
 * sala fora da tela, um som e um aviso na tela com "Abrir conversa"; com a página fora da vista (aba escondida, janela sem foco) e
 * nenhuma outra aba do aplicativo sendo vista, o título da aba pisca até a pessoa voltar e a aba líder toca o som (um por navegador).
 */
type HumanSupportState = {
  /** null = ainda não carregado (ou sem sessão). */
  operator: OperatorView | null
  reconnecting: boolean
  /** Busca agora (depois de um comando do operador). */
  refresh: () => void
  /** Aplica a visão devolvida por um comando antes da próxima resposta da chamada de estado. */
  applyOperator: (operator: OperatorView) => void
  /** Mensagens do Anjo no pedido aberto que o operador ainda não viu. */
  unreadFromAnjo: number
  /** Sobe a cada pedido para abrir a sala (aviso na tela): o chat da INIA abre a sala e o painel recolhido se abre. */
  roomOpenRequest: number
  /** Abre a sala: no chat desta página, se houver; senão, no Acompanhamento do próprio perfil. */
  requestOpenRoom: () => void
  /** A sala está na tela nesta aba (montada e visível). Devolve a função que desfaz. */
  registerRoomOnScreen: () => () => void
  /** A sala desta aba mostrou as mensagens até `seq` com a página vista. */
  markRoomRead: (requestId: string, seq: number) => void
  /** Há um chat da INIA nesta página (que sabe abrir a sala). Devolve a função que desfaz. */
  registerChat: () => () => void
}

const noop = () => {}
const DEFAULT_STATE: HumanSupportState = {
  operator: null,
  reconnecting: false,
  refresh: noop,
  applyOperator: noop,
  unreadFromAnjo: 0,
  roomOpenRequest: 0,
  requestOpenRoom: noop,
  registerRoomOnScreen: () => noop,
  markRoomRead: noop,
  registerChat: () => noop,
}

const HumanSupportContext = createContext<HumanSupportState>(DEFAULT_STATE)

const CHANNEL = "inia-human-support-operator"
const LOCK = "inia-human-support-operator"
type ChannelMessage =
  | { type: "state"; operator: OperatorView | null; reconnecting: boolean }
  | { type: "refresh" }
  /** Esta aba está (ou não) sendo vista; `hello` = aba nova, as outras respondem com a delas. */
  | { type: "presence"; tabId: string; seen: boolean; hello?: boolean }
  | { type: "bye"; tabId: string }
  /** A sala de uma aba mostrou as mensagens do pedido até `seq`. */
  | { type: "read"; requestId: string; seq: number }

/** Aviso na tela (um por vez: o novo substitui o anterior). */
export const ANJO_MESSAGE_TOAST_ID = "human-support-anjo-message"
/** Endereço da sala fora do chat: o Acompanhamento do próprio perfil abre a sala por este parâmetro. */
export const SUPPORT_ROOM_PARAM = "iniaSupport"

export const operatorNeedsWait = (operator: OperatorView | null | undefined) => Boolean(operator?.openRequest || (operator?.pendingEvaluations.length ?? 0) > 0)

const latestAnjoSeq = (request: OperatorRequestView) => request.messages.reduce((max, message) => (message.authorKind === "ANJO" ? Math.max(max, message.seq) : max), 0)

/** Mensagens do Anjo depois do que o operador já viu (o "lida" do servidor ou o desta aba, o que for maior). */
export function unreadAnjoMessages(request: OperatorRequestView | null | undefined, localReadSeq = 0): number {
  if (!request) return 0
  const read = Math.max(request.readSeq, localReadSeq)
  return request.messages.filter((message) => message.authorKind === "ANJO" && message.seq > read).length
}

const newTabId = () => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

type ProviderProps = {
  children: ReactNode
  enabled?: boolean
  /** Perfil da própria pessoa: o "Abrir conversa" fora do chat vai para o Acompanhamento dele. */
  profileHref?: string | null
  /** Navegação do aplicativo (o roteador do shell). */
  onNavigate?: (href: string) => void
}

export function HumanSupportStateProvider({ children, enabled = true, profileHref = null, onNavigate }: ProviderProps) {
  const [operator, setOperator] = useState<OperatorView | null>(null)
  const [reconnecting, setReconnecting] = useState(false)
  const [localRead, setLocalRead] = useState<Record<string, number>>({})
  const [roomOpenRequest, setRoomOpenRequest] = useState(0)
  const pollerRef = useRef<StatePoller | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const tabIdRef = useRef<string>("")
  const otherTabsSeenRef = useRef(new Map<string, boolean>())
  const roomsOnScreenRef = useRef(0)
  const chatsRef = useRef(0)
  const chimeRef = useRef<Chime | null>(null)
  const localReadRef = useRef(localRead)
  useEffect(() => {
    localReadRef.current = localRead
  }, [localRead])
  const navigateRef = useRef(onNavigate)
  useEffect(() => {
    navigateRef.current = onNavigate
  }, [onNavigate])

  const noteRead = useCallback((requestId: string, seq: number) => {
    setLocalRead((current) => ((current[requestId] ?? 0) >= seq ? current : { ...current, [requestId]: seq }))
  }, [])

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let releaseLock: (() => void) | null = null
    if (!tabIdRef.current) tabIdRef.current = newTabId()
    const tabId = tabIdRef.current
    const otherTabsSeen = otherTabsSeenRef.current
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL)
    channelRef.current = channel
    const postPresence = (hello = false) => channel?.postMessage({ type: "presence", tabId, seen: pageIsSeen(), ...(hello ? { hello: true } : {}) } satisfies ChannelMessage)
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
        else if (message.type === "presence") {
          if (message.tabId === tabId) return
          const known = otherTabsSeen.has(message.tabId)
          otherTabsSeen.set(message.tabId, message.seen)
          // A pessoa voltou ao aplicativo por outra aba: o título desta para de piscar.
          if (message.seen) stopTabTitleBlink()
          if (message.hello && !known) postPresence()
        } else if (message.type === "bye") otherTabsSeen.delete(message.tabId)
        else if (message.type === "read") noteRead(message.requestId, message.seq)
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
    // As outras abas sabem se esta está sendo vista (só uma toca o som, e nenhuma pisca enquanto a pessoa olha o aplicativo).
    const onSeenChange = () => postPresence()
    const onPageHide = () => channel?.postMessage({ type: "bye", tabId } satisfies ChannelMessage)
    document.addEventListener("visibilitychange", onVisible)
    document.addEventListener("visibilitychange", onSeenChange)
    window.addEventListener("focus", onSeenChange)
    window.addEventListener("blur", onSeenChange)
    window.addEventListener("pagehide", onPageHide)
    postPresence(true)
    const chime = createChime()
    chimeRef.current = chime
    const stopPriming = primeChimeOnFirstGesture(chime)
    return () => {
      disposed = true
      document.removeEventListener("visibilitychange", onVisible)
      document.removeEventListener("visibilitychange", onSeenChange)
      window.removeEventListener("focus", onSeenChange)
      window.removeEventListener("blur", onSeenChange)
      window.removeEventListener("pagehide", onPageHide)
      onPageHide()
      stopPriming()
      chime.dispose()
      chimeRef.current = null
      otherTabsSeen.clear()
      pollerRef.current?.stop()
      pollerRef.current = null
      releaseLock?.()
      channel?.close()
      channelRef.current = null
    }
  }, [enabled, noteRead])

  const requestOpenRoom = useCallback(() => {
    toast.dismiss(ANJO_MESSAGE_TOAST_ID)
    if (chatsRef.current > 0) setRoomOpenRequest((count) => count + 1)
    else if (profileHref) navigateRef.current?.(`${profileHref}?tab=followup&${SUPPORT_ROOM_PARAM}=room`)
  }, [profileHref])

  // Mensagem nova do Anjo: compara com o estado anterior desta aba (o primeiro estado é só a referência — nada avisa ao carregar).
  const lastAnjoSeqRef = useRef<{ requestId: string; seq: number } | null>(null)
  useEffect(() => {
    const open = operator?.openRequest ?? null
    const latest = open ? latestAnjoSeq(open) : 0
    const previous = lastAnjoSeqRef.current
    lastAnjoSeqRef.current = open ? { requestId: open.id, seq: latest } : null
    if (!open || !previous || previous.requestId !== open.id || latest <= previous.seq) return
    if (latest <= Math.max(open.readSeq, localReadRef.current[open.id] ?? 0)) return
    const anjoName = open.anjo?.name ?? "o Anjo"
    if (pageIsSeen()) {
      if (roomsOnScreenRef.current > 0) return
      chimeRef.current?.play()
      toast(`${anjoName} respondeu no apoio`, {
        id: ANJO_MESSAGE_TOAST_ID,
        description: "Abra a conversa para ler e responder.",
        action: { label: "Abrir conversa", onClick: requestOpenRoom },
      })
      return
    }
    if ([...otherTabsSeenRef.current.values()].some(Boolean)) return
    blinkTabTitle(newMessageTitle(anjoName))
    // Só a aba líder toca (um som por navegador); sem a troca entre abas, cada aba é a própria líder.
    if (pollerRef.current) chimeRef.current?.play()
  }, [operator, requestOpenRoom])

  const refresh = useCallback(() => {
    if (pollerRef.current) pollerRef.current.refresh()
    else channelRef.current?.postMessage({ type: "refresh" } satisfies ChannelMessage)
  }, [])
  const applyOperator = useCallback((next: OperatorView) => setOperator(next), [])
  const registerRoomOnScreen = useCallback(() => {
    roomsOnScreenRef.current += 1
    toast.dismiss(ANJO_MESSAGE_TOAST_ID)
    let done = false
    return () => {
      if (done) return
      done = true
      roomsOnScreenRef.current -= 1
    }
  }, [])
  const markRoomRead = useCallback((requestId: string, seq: number) => {
    noteRead(requestId, seq)
    channelRef.current?.postMessage({ type: "read", requestId, seq } satisfies ChannelMessage)
  }, [noteRead])
  const registerChat = useCallback(() => {
    chatsRef.current += 1
    let done = false
    return () => {
      if (done) return
      done = true
      chatsRef.current -= 1
    }
  }, [])
  const unreadFromAnjo = unreadAnjoMessages(operator?.openRequest, operator?.openRequest ? localRead[operator.openRequest.id] : 0)
  const value = useMemo(
    () => ({ operator, reconnecting, refresh, applyOperator, unreadFromAnjo, roomOpenRequest, requestOpenRoom, registerRoomOnScreen, markRoomRead, registerChat }),
    [operator, reconnecting, refresh, applyOperator, unreadFromAnjo, roomOpenRequest, requestOpenRoom, registerRoomOnScreen, markRoomRead, registerChat],
  )
  return <HumanSupportContext.Provider value={value}>{children}</HumanSupportContext.Provider>
}

export function useHumanSupportState(): HumanSupportState {
  return useContext(HumanSupportContext)
}

/**
 * A sala na tela (`active` = montada, com conversa e visível): enquanto estiver, mensagem nova do Anjo não avisa; com a página vista, as
 * mensagens mostradas contam como vistas (o selo e o painel recolhido param de contar).
 */
export function useSupportRoomOnScreen(requestId: string | null, lastSeq: number, active: boolean) {
  const { registerRoomOnScreen, markRoomRead } = useHumanSupportState()
  const seen = usePageSeen()
  useEffect(() => (active ? registerRoomOnScreen() : undefined), [active, registerRoomOnScreen])
  useEffect(() => {
    if (!requestId || !active || !seen || lastSeq <= 0) return
    markRoomRead(requestId, lastSeq)
  }, [requestId, lastSeq, active, seen, markRoomRead])
}

/** O chat da INIA desta página sabe abrir a sala: o "Abrir conversa" do aviso abre aqui, sem trocar de página. */
export function useRegisterSupportChat() {
  const { registerChat } = useHumanSupportState()
  useEffect(() => registerChat(), [registerChat])
}

/** Para testes e telas de demonstração: um valor fixo do estado do apoio, sem chamadas. */
export function HumanSupportStateValueProvider({ value, children }: { value: Partial<HumanSupportState>; children: ReactNode }) {
  const full = useMemo<HumanSupportState>(() => ({ ...DEFAULT_STATE, ...value }), [value])
  return <HumanSupportContext.Provider value={full}>{children}</HumanSupportContext.Provider>
}
