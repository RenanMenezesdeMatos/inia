"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { AnjoView, StateResponse } from "@/schemas/human-support/state.schema"
import { startStatePoller, type StatePoller } from "./state-poller"

/**
 * ÁREA DO ANJO (design_draft.md seção 11): chamada longa própria com `workspace=anjo` (renova a conexão do Anjo a cada resposta),
 * protegida pela trava de aba única `inia-anjo-workspace` — outra aba mostra "A área do Anjo está aberta em outra aba". Avisa
 * quando chega um atendimento novo (som e título da aba ficam com a tela).
 */
export type AnjoWorkspaceState = {
  anjo: AnjoView | null
  /** Outra aba já está com a área do Anjo aberta. */
  blocked: boolean
  reconnecting: boolean
  /** A sessão terminou (401 na chamada de estado): o laço parou e a tela pede para entrar de novo. */
  sessionEnded: boolean
  refresh: () => void
  applyAnjo: (anjo: AnjoView) => void
  /** Relógio do servidor menos o desta tela, medido a cada resposta (cronômetros e "há N min" contam pelo servidor). */
  clockOffsetMs: number
}

const LOCK = "inia-anjo-workspace"
/** Quanto a aba espera na fila da trava antes de concluir que outra aba está com a área do Anjo. */
const LOCK_WAIT_MS = 1_500

export function useAnjoWorkspaceState(options: { onNewAttendance?: (attendanceIds: string[]) => void } = {}): AnjoWorkspaceState {
  const [anjo, setAnjo] = useState<AnjoView | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [sessionEnded, setSessionEnded] = useState(false)
  const [clockOffsetMs, setClockOffsetMs] = useState(0)
  const pollerRef = useRef<StatePoller | null>(null)
  const knownRef = useRef<Set<string> | null>(null)
  const onNewRef = useRef(options.onNewAttendance)
  useEffect(() => {
    onNewRef.current = options.onNewAttendance
  }, [options.onNewAttendance])

  useEffect(() => {
    let disposed = false
    let releaseLock: (() => void) | null = null
    const onState = (state: StateResponse) => {
      if (!state.anjo) return
      const ids = state.anjo.attendances.map((attendance) => attendance.id)
      if (knownRef.current) {
        const fresh = ids.filter((id) => !knownRef.current!.has(id))
        if (fresh.length > 0) onNewRef.current?.(fresh)
      }
      knownRef.current = new Set(ids)
      setAnjo(state.anjo)
      setClockOffsetMs(offsetOf(state.anjo))
    }
    const start = () => {
      if (disposed) return
      // A área do Anjo sempre espera (é ela que mantém a conexão do Anjo).
      pollerRef.current = startStatePoller({ workspace: "anjo", shouldWait: () => true, onState, onReconnecting: setReconnecting, onSessionEnded: () => setSessionEnded(true) })
    }
    const locks = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { locks?: LockManager }).locks
    // Espera curta na fila da trava, em vez de `ifAvailable`: uma montagem anterior desta mesma aba (o React monta duas vezes em
    // desenvolvimento; sair e voltar rápido) devolve a trava em milissegundos, e a aba não pode se ver como "outra aba". Só quem
    // segue sem a trava depois da espera está de fato com outra aba aberta.
    const waiting = new AbortController()
    let timedOut = false
    const waitTimer = setTimeout(() => {
      timedOut = true
      waiting.abort()
    }, LOCK_WAIT_MS)
    if (locks) {
      void locks
        .request(LOCK, { signal: waiting.signal }, () => {
          clearTimeout(waitTimer)
          // A trava chegou depois de a tela já ter saído: devolve na hora.
          if (disposed) return Promise.resolve()
          return new Promise<void>((resolve) => {
            releaseLock = resolve
            start()
          })
        })
        .catch(() => {
          clearTimeout(waitTimer)
          if (disposed) return
          if (timedOut) setBlocked(true)
          else start()
        })
    } else {
      clearTimeout(waitTimer)
      start()
    }
    return () => {
      disposed = true
      clearTimeout(waitTimer)
      // Pedido ainda na fila: sai dela (depois de recebida, a trava só é devolvida por `releaseLock`).
      waiting.abort()
      pollerRef.current?.stop()
      pollerRef.current = null
      releaseLock?.()
    }
  }, [])

  const refresh = useCallback(() => pollerRef.current?.refresh(), [])
  const applyAnjo = useCallback((next: AnjoView) => {
    setAnjo(next)
    setClockOffsetMs(offsetOf(next))
  }, [])
  return { anjo, blocked, reconnecting, sessionEnded, refresh, applyAnjo, clockOffsetMs }
}

/** Diferença entre o relógio do servidor (na resposta) e o desta tela; sem o instante do servidor, nenhuma correção. */
function offsetOf(anjo: AnjoView): number {
  const server = new Date(anjo.serverTime).getTime()
  return Number.isNaN(server) ? 0 : server - Date.now()
}
