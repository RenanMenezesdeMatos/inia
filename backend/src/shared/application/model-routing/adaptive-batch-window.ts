import { AiCallCancelledError } from "./ai-errors.js"

/**
 * VAZÃO ADAPTATIVA DO LOTE, por conexão de IA (chave do portão) — a resposta a "o provedor está no limite": os disparos em massa
 * DESACELERAM de forma controlada, em vez de pararem 15 s e voltarem todos de uma vez (e esbarrarem no limite de novo, levando o
 * chat junto).
 *
 * O que satura é a COTA do provedor, contada em tokens de entrada (e chamadas) por MINUTO, numa janela de 60 s — por projeto/acesso,
 * somando chat e lote de todas as instâncias. Por isso o controle é em TOKENS POR MINUTO de lote deste processo (a estimativa de
 * entrada de cada chamada, a mesma do gateway), numa janela de 60 s como a do provedor — limitar só chamadas simultâneas não segura
 * o consumo quando as chamadas são curtas (medido em 21/10: 4 simultâneas de roteamento já passavam da cota numa rajada):
 *
 *  - PARTIDA LENTA: o lote começa com `startTokensPerMinute` e ganha `increaseStep` a cada `increaseEveryMs` até passar de
 *    `maxTokensPerMinute` (aí o teto some). Parado por `idleResetMs`, recomeça devagar.
 *  - SATURAÇÃO (um 429/503 da conexão — deste processo ou publicado por outra instância no portão): o teto cai para METADE do que o
 *    lote usou no último minuto (mínimo `minTokensPerMinute`) — para UM QUARTO quando quem levou o 429 foi o CHAT, e aí o teto fica
 *    parado por `holdAfterInteractiveMs` (uma janela da cota) antes de voltar a subir. Uma rajada de erros conta uma vez só.
 *  - Uma chamada sozinha sempre passa quando nada do lote foi admitido no último minuto (uma chamada grande nunca trava para sempre).
 *
 * É AIMD (aumento aditivo, redução multiplicativa, com partida lenta), o princípio do controle de congestionamento do TCP: cada
 * processo reage ao mesmo sinal compartilhado e o conjunto converge para abaixo da cota, deixando folga para a interativa — que NUNCA
 * passa por aqui. Esperar aqui é cancelável e não ocupa vaga do provedor.
 */
export type AdaptiveBatchWindowConfig = {
  windowMs: number
  minTokensPerMinute: number
  startTokensPerMinute: number
  maxTokensPerMinute: number
  increaseStep: number
  increaseEveryMs: number
  congestionDebounceMs: number
  holdAfterInteractiveMs: number
  idleResetMs: number
  /** Estimativa quando a chamada não informa (nunca 0: toda chamada conta). */
  defaultCallTokens: number
}

export const DEFAULT_ADAPTIVE_BATCH_WINDOW: AdaptiveBatchWindowConfig = {
  windowMs: 60_000,
  minTokensPerMinute: 20_000,
  startTokensPerMinute: 120_000,
  maxTokensPerMinute: 3_000_000,
  increaseStep: 30_000,
  increaseEveryMs: 10_000,
  congestionDebounceMs: 2_000,
  holdAfterInteractiveMs: 60_000,
  idleResetMs: 60_000,
  defaultCallTokens: 4_000,
}

export type AdaptiveBatchWindowStats = Record<string, { tokensPerMinute: number | null; usedLastMinute: number; waiting: number }>

export type AdaptiveBatchWindow = {
  /** Espera a vez de uma chamada de lote com `tokens` estimados de entrada na chave. */
  admit(key: string, tokens: number | null | undefined, signal?: AbortSignal): Promise<void>
  /** O provedor sinalizou saturação nesta chave (429/503); `interactive` = quem levou foi uma chamada interativa (corte maior). */
  congestion(key: string, options?: { interactive?: boolean }): void
  /** Admite quem espera, aumento aditivo e partida lenta depois de parado (o timer chama; os testes chamam direto). */
  tick(): void
  stats(): AdaptiveBatchWindowStats
  stop(): void
}

type Waiter = { tokens: number; resolve: () => void; reject: (error: unknown) => void; detach?: () => void }
type KeyState = { limit: number | null; admitted: [number, number][]; waiters: Waiter[]; lastCongestionAt: number; lastChangeAt: number; holdUntil: number; lastActiveAt: number }

export function createAdaptiveBatchWindow(config: AdaptiveBatchWindowConfig = DEFAULT_ADAPTIVE_BATCH_WINDOW, deps: { now?: () => number; timer?: boolean; log?: (event: Record<string, unknown>) => void } = {}): AdaptiveBatchWindow {
  const now = deps.now ?? Date.now
  const log = deps.log ?? ((event) => console.warn(JSON.stringify(event)))
  const keys = new Map<string, KeyState>()
  const stateOf = (key: string): KeyState => {
    let state = keys.get(key)
    if (!state) {
      const at = now()
      state = { limit: config.startTokensPerMinute, admitted: [], waiters: [], lastCongestionAt: Number.NEGATIVE_INFINITY, lastChangeAt: at, holdUntil: 0, lastActiveAt: at }
      keys.set(key, state)
    }
    return state
  }
  const usedOf = (state: KeyState, at: number) => {
    while (state.admitted.length > 0 && state.admitted[0]![0] <= at - config.windowMs) state.admitted.shift()
    return state.admitted.reduce((sum, [, tokens]) => sum + tokens, 0)
  }
  const fits = (state: KeyState, tokens: number, at: number) => {
    const used = usedOf(state, at)
    return state.limit === null || used === 0 || used + tokens <= state.limit
  }
  const take = (state: KeyState, tokens: number, at: number) => {
    state.admitted.push([at, tokens])
    state.lastActiveAt = at
  }
  const dispatch = (state: KeyState, at: number) => {
    while (state.waiters.length > 0 && fits(state, state.waiters[0]!.tokens, at)) {
      const waiter = state.waiters.shift()!
      waiter.detach?.()
      take(state, waiter.tokens, at)
      waiter.resolve()
    }
  }

  const window: AdaptiveBatchWindow = {
    admit(key, rawTokens, signal) {
      const tokens = Math.max(1, Math.round(rawTokens && rawTokens > 0 ? rawTokens : config.defaultCallTokens))
      const state = stateOf(key)
      if (signal?.aborted) return Promise.reject(new AiCallCancelledError())
      const at = now()
      if (state.waiters.length === 0 && fits(state, tokens, at)) {
        take(state, tokens, at)
        return Promise.resolve()
      }
      state.lastActiveAt = at
      return new Promise((resolve, reject) => {
        const waiter: Waiter = { tokens, resolve, reject }
        if (signal) {
          const onAbort = () => {
            const index = state.waiters.indexOf(waiter)
            if (index >= 0) state.waiters.splice(index, 1)
            reject(new AiCallCancelledError())
          }
          signal.addEventListener("abort", onAbort, { once: true })
          waiter.detach = () => signal.removeEventListener("abort", onAbort)
        }
        state.waiters.push(waiter)
      })
    },
    congestion(key, options = {}) {
      const state = stateOf(key)
      const at = now()
      if (at - state.lastCongestionAt < config.congestionDebounceMs) return
      state.lastCongestionAt = at
      state.lastChangeAt = at
      const before = state.limit
      const used = usedOf(state, at)
      const base = state.limit === null ? used : Math.min(state.limit, Math.max(used, config.minTokensPerMinute))
      state.limit = Math.max(config.minTokensPerMinute, Math.floor(base / (options.interactive ? 4 : 2)))
      if (options.interactive) state.holdUntil = at + config.holdAfterInteractiveMs
      log({ event: "ai_batch_window_decreased", key, from: before, to: state.limit, usedLastMinute: used, interactive: Boolean(options.interactive) })
    },
    tick() {
      const at = now()
      for (const [key, state] of keys) {
        // Parado há um tempo: a próxima leva recomeça devagar (a cota pode estar com outro uso agora).
        if (state.waiters.length === 0 && at - state.lastActiveAt >= config.idleResetMs && at >= state.holdUntil) {
          if (state.limit !== config.startTokensPerMinute) {
            state.limit = config.startTokensPerMinute
            state.lastChangeAt = at
          }
          continue
        }
        if (state.limit !== null && at >= state.holdUntil && at - state.lastChangeAt >= config.increaseEveryMs) {
          state.lastChangeAt = at
          state.limit += config.increaseStep
          if (state.limit > config.maxTokensPerMinute) {
            state.limit = null
            log({ event: "ai_batch_window_restored", key })
          }
        }
        dispatch(state, at)
      }
    },
    stats() {
      const at = now()
      return Object.fromEntries([...keys].map(([key, state]) => [key, { tokensPerMinute: state.limit, usedLastMinute: usedOf(state, at), waiting: state.waiters.length }]))
    },
    stop() {
      if (timer) clearInterval(timer)
    },
  }
  const timer = deps.timer === false ? null : setInterval(() => window.tick(), 250)
  timer?.unref?.()
  return window
}
