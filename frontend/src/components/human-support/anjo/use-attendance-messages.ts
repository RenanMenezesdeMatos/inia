"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { MessageView } from "@/schemas/human-support/state.schema"
import { fetchSupportMessages } from "@/services/human-support/human-support-service"

/**
 * MENSAGENS DE UM PEDIDO NA ÁREA DO ANJO (design_draft.md seções 10 e 11). Começa pelas últimas 50; depois, sempre que o último `seq`
 * do atendimento (vindo da chamada de estado) passa do que já foi lido, busca `after=<último seq lido>` até alcançá-lo. O cursor só
 * avança pelo que veio da leitura (sem lacunas, porque o `seq` do pedido não tem buracos); a mensagem que o próprio Anjo envia entra
 * na lista na hora e a leitura seguinte a devolve de novo — a lista junta pelo `seq`, então nada se repete.
 * `targetSeq = null` = só a leitura inicial (histórico, somente leitura).
 */
export type AttendanceMessages = {
  messages: MessageView[]
  hasOlder: boolean
  loaded: boolean
  error: string | null
  loadingOlder: boolean
  retry: () => void
  loadOlder: () => void
  addLocal: (message: MessageView) => void
}

const MAX_FORWARD_PAGES = 20

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback)

export function mergeMessages(current: MessageView[], incoming: MessageView[]): MessageView[] {
  if (incoming.length === 0) return current
  const bySeq = new Map(current.map((message) => [message.seq, message]))
  for (const message of incoming) bySeq.set(message.seq, message)
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq)
}

const lastSeqOf = (messages: MessageView[], fallback: number) => messages.reduce((max, message) => Math.max(max, message.seq), fallback)

type LoaderEvents = {
  onMessages: (messages: MessageView[]) => void
  onInitial: (hasOlder: boolean) => void
  onOlder: (hasOlder: boolean) => void
  onError: (message: string | null) => void
  onLoadingOlder: (loading: boolean) => void
}

/**
 * Leitor das mensagens de um pedido (sem React): uma leitura por vez; um pedido de leitura que chega durante outra não se perde — a
 * leitura em curso dá mais uma volta no fim. Depois de `dispose`, nada mais é avisado.
 */
export function createMessageLoader(requestId: string, events: LoaderEvents, fetchPage: typeof fetchSupportMessages = fetchSupportMessages) {
  let cursor: number | null = null
  let firstSeq: number | null = null
  let target: number | null = null
  let busy = false
  let rerun = false
  let disposed = false

  const sync = async () => {
    if (busy) {
      rerun = true
      return
    }
    busy = true
    try {
      do {
        rerun = false
        if (cursor === null) {
          const page = await fetchPage(requestId)
          if (disposed) return
          cursor = lastSeqOf(page.messages, 0)
          firstSeq = page.messages[0]?.seq ?? null
          events.onMessages(page.messages)
          events.onInitial(page.hasMore)
          events.onError(null)
        }
        for (let pages = 0; pages < MAX_FORWARD_PAGES && target !== null && cursor < target; pages += 1) {
          const page = await fetchPage(requestId, { after: cursor })
          if (disposed) return
          if (page.messages.length === 0) break
          cursor = lastSeqOf(page.messages, cursor)
          events.onMessages(page.messages)
          events.onError(null)
        }
      } while (rerun && !disposed)
    } catch (failure) {
      if (!disposed) {
        if (cursor === null) events.onInitial(false)
        events.onError(errorText(failure, "Não foi possível carregar as mensagens."))
      }
    } finally {
      busy = false
      rerun = false
    }
  }

  return {
    /** Lê até alcançar `nextTarget` (`null` = só a leitura inicial). */
    sync(nextTarget: number | null) {
      target = nextTarget
      void sync()
    },
    retry() {
      void sync()
    },
    loadOlder() {
      if (firstSeq === null || firstSeq <= 1) return
      events.onLoadingOlder(true)
      fetchPage(requestId, { before: firstSeq })
        .then((page) => {
          if (disposed) return
          firstSeq = page.messages[0]?.seq ?? firstSeq
          events.onMessages(page.messages)
          events.onOlder(page.hasMore)
          events.onError(null)
        })
        .catch((failure: unknown) => {
          if (!disposed) events.onError(errorText(failure, "Não foi possível carregar as mensagens anteriores."))
        })
        .finally(() => {
          if (!disposed) events.onLoadingOlder(false)
        })
    },
    dispose() {
      disposed = true
    },
  }
}

type MessageLoader = ReturnType<typeof createMessageLoader>

export function useAttendanceMessages(requestId: string, targetSeq: number | null): AttendanceMessages {
  const [messages, setMessages] = useState<MessageView[]>([])
  const [hasOlder, setHasOlder] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const loaderRef = useRef<MessageLoader | null>(null)
  const targetRef = useRef(targetSeq)

  useEffect(() => {
    const loader = createMessageLoader(requestId, {
      onMessages: (incoming) => setMessages((current) => mergeMessages(current, incoming)),
      onInitial: (older) => {
        setHasOlder(older)
        setLoaded(true)
      },
      onOlder: setHasOlder,
      onError: setError,
      onLoadingOlder: setLoadingOlder,
    })
    loaderRef.current = loader
    loader.sync(targetRef.current)
    return () => {
      loader.dispose()
      if (loaderRef.current === loader) loaderRef.current = null
    }
  }, [requestId])

  useEffect(() => {
    targetRef.current = targetSeq
    loaderRef.current?.sync(targetSeq)
  }, [targetSeq])

  const retry = useCallback(() => loaderRef.current?.retry(), [])
  const loadOlder = useCallback(() => loaderRef.current?.loadOlder(), [])
  const addLocal = useCallback((message: MessageView) => setMessages((current) => mergeMessages(current, [message])), [])

  return { messages, hasOlder, loaded, error, loadingOlder, retry, loadOlder, addLocal }
}
