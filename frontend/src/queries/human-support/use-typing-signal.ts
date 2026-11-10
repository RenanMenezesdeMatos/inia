"use client"

import { useCallback, useEffect, useRef } from "react"
import { signalSupportTyping } from "@/services/human-support/human-support-service"

/**
 * "ESTOU DIGITANDO" para a outra ponta da conversa (migration 184). Avisa ao começar a escrever e renova a cada 4 s enquanto a pessoa
 * continua (o aviso no servidor vale 8 s); 5 s sem tecla, campo apagado ou tela fechada = "parei". Enviar a mensagem já tira o aviso
 * no servidor. Só o fato de estar escrevendo sai daqui — nunca o texto. `requestId = null` = sem atendimento em andamento: nada sai.
 */
export const TYPING_REFRESH_MS = 4_000
export const TYPING_IDLE_MS = 5_000

export function useTypingSignal(requestId: string | null, send: typeof signalSupportTyping = signalSupportTyping) {
  const stateRef = useRef<{ active: boolean; lastPing: number; idle: ReturnType<typeof setTimeout> | null }>({ active: false, lastPing: 0, idle: null })

  const notify = useCallback(
    (typing: boolean) => {
      if (!requestId) return
      void Promise.resolve()
        .then(() => send(requestId, typing))
        .catch(() => undefined)
    },
    [requestId, send],
  )

  const stop = useCallback(() => {
    const state = stateRef.current
    if (state.idle) clearTimeout(state.idle)
    state.idle = null
    if (!state.active) return
    state.active = false
    notify(false)
  }, [notify])

  const onInput = useCallback(
    (text: string) => {
      if (!requestId) return
      if (text.trim() === "") return stop()
      const state = stateRef.current
      const now = Date.now()
      if (!state.active || now - state.lastPing >= TYPING_REFRESH_MS) {
        state.active = true
        state.lastPing = now
        notify(true)
      }
      if (state.idle) clearTimeout(state.idle)
      state.idle = setTimeout(stop, TYPING_IDLE_MS)
    },
    [requestId, notify, stop],
  )

  /** A mensagem foi enviada: o servidor já tirou o aviso. */
  const onSent = useCallback(() => {
    const state = stateRef.current
    if (state.idle) clearTimeout(state.idle)
    state.idle = null
    state.active = false
  }, [])

  // Trocou de pedido ou saiu da tela escrevendo: "parei".
  useEffect(() => stop, [stop])

  return { onInput, onSent }
}
