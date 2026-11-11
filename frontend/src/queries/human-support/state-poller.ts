import { ApiError } from "@/lib/api/api-client"
import { fetchHumanSupportState } from "@/services/human-support/human-support-service"
import type { StateResponse } from "@/schemas/human-support/state.schema"

/**
 * LAÇO DA CHAMADA DE ESTADO do Apoio com Anjo (design_draft.md seção 11 e Apêndice A). Uma chamada curta ao começar; depois, chamada
 * longa (até 20 s) só quando `shouldWait` diz que há algo acontecendo (pedido aberto, avaliação pendente, área do Anjo aberta).
 *  - reconexão depois de cada resposta, erro ou `reconnect` (0,5–2 s aleatório);
 *  - modo de reserva: chamada curta a cada 3 s por 1 min, depois de 3 falhas seguidas ou de uma chamada longa sem resposta em
 *    `wait + 5 s`;
 *  - `reconnecting` = a última tentativa falhou (a tela mostra "Reconectando…");
 *  - `refresh()` = busca agora (depois de um comando), interrompendo a espera em curso.
 *  - 401 (sessão expirada, encerrada por inatividade ou revogada): PARA o laço e chama `onSessionEnded` — repetir não adianta, e a
 *    tela não pode ficar em "Tentando de novo…" para sempre. Sem `onSessionEnded`, segue como qualquer falha.
 * Nunca chama `/auth/activity`: a chamada de estado não renova a sessão.
 */
export const LONG_POLL_SECONDS = 20
export const FALLBACK_INTERVAL_MS = 3_000
export const FALLBACK_DURATION_MS = 60_000
export const FAILURES_BEFORE_FALLBACK = 3

export type StatePollerOptions = {
  workspace: "anjo" | "none"
  shouldWait: (state: StateResponse) => boolean
  onState: (state: StateResponse) => void
  onReconnecting: (reconnecting: boolean) => void
  /** A sessão não vale mais (401): o laço parou. */
  onSessionEnded?: () => void
  fetchState?: typeof fetchHumanSupportState
  random?: () => number
  now?: () => number
}

export type StatePoller = { stop(): void; refresh(): void }

export function startStatePoller(options: StatePollerOptions): StatePoller {
  const fetchState = options.fetchState ?? fetchHumanSupportState
  const random = options.random ?? Math.random
  const now = options.now ?? Date.now
  let stopped = false
  let version: string | null = null
  let last: StateResponse | null = null
  let failures = 0
  let fallbackUntil = 0
  let controller: AbortController | null = null
  let refreshRequested = false
  let wake: (() => void) | null = null

  /** Espera `ms` ou até um `refresh()`. */
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wake = null
        resolve()
      }, ms)
      wake = () => {
        clearTimeout(timer)
        wake = null
        resolve()
      }
    })
  /** Sem nada acontecendo: espera um `refresh()` (ou a aba voltar a ficar visível, que chama `refresh`). */
  const idle = () =>
    new Promise<void>((resolve) => {
      wake = () => {
        wake = null
        resolve()
      }
    })
  const backoff = () => 500 + Math.round(random() * 1_500)

  const run = async () => {
    while (!stopped) {
      const inFallback = now() < fallbackUntil
      const longPoll = version !== null && last !== null && options.shouldWait(last) && !inFallback && !refreshRequested
      refreshRequested = false
      const wait = longPoll ? LONG_POLL_SECONDS : 0
      controller = new AbortController()
      const current = controller
      let timedOut = false
      const watchdog = setTimeout(() => {
        timedOut = true
        current.abort()
      }, (wait + 5) * 1000)
      try {
        const state = await fetchState({ since: longPoll ? version : null, wait, workspace: options.workspace, signal: current.signal })
        clearTimeout(watchdog)
        if (stopped) return
        failures = 0
        options.onReconnecting(false)
        version = state.version
        last = state
        options.onState(state)
        if (state.reconnect) await pause(backoff())
        else if (!longPoll) {
          if (refreshRequested) continue
          if (options.shouldWait(state)) await pause(now() < fallbackUntil ? FALLBACK_INTERVAL_MS : 0)
          else await idle()
        }
      } catch (error) {
        clearTimeout(watchdog)
        if (stopped) return
        // Interrompida por um `refresh()`: não é falha.
        if (current.signal.aborted && !timedOut) continue
        if (options.onSessionEnded && error instanceof ApiError && error.status === 401) {
          stopped = true
          options.onReconnecting(false)
          options.onSessionEnded()
          return
        }
        failures += 1
        options.onReconnecting(true)
        if (timedOut || failures >= FAILURES_BEFORE_FALLBACK) fallbackUntil = now() + FALLBACK_DURATION_MS
        await pause(backoff())
      }
    }
  }
  void run()

  return {
    stop() {
      stopped = true
      controller?.abort()
      wake?.()
    },
    refresh() {
      refreshRequested = true
      controller?.abort()
      wake?.()
    },
  }
}
