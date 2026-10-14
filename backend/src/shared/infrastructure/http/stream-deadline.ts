/**
 * PRAZO DE UMA RESPOSTA EM FLUXO (SSE de um provedor). `AbortSignal.timeout(n)` passado ao `fetch` vale para a resposta
 * INTEIRA, inclusive a leitura do corpo — um stream longo e saudável era cortado no meio aos n segundos. Aqui são dois prazos:
 *
 *   - até a resposta COMEÇAR (cabeçalhos): `connectTimeoutMs`;
 *   - depois, o SILÊNCIO máximo entre dois pedaços: `idleTimeoutMs` (reinicia a cada pedaço).
 *
 * E o cancelamento de quem pediu (`cancel` — a pessoa fechou o chat) entra no mesmo sinal. `timedOut` diz se o aborto foi um
 * dos prazos (falha do provedor) ou o cancelamento (ninguém mais esperando).
 */
export type StreamDeadline = {
  readonly signal: AbortSignal
  /** Cabeçalhos chegaram: troca o prazo de conexão pelo de silêncio. */
  started(): void
  /** Chegou um pedaço: reinicia o prazo de silêncio. */
  progressed(): void
  /** Fim (sucesso ou erro): limpa os timers. */
  dispose(): void
  readonly timedOut: boolean
  readonly cancelled: boolean
}

export function createStreamDeadline(options: { connectTimeoutMs: number; idleTimeoutMs: number; cancel?: AbortSignal | null }): StreamDeadline {
  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const arm = (ms: number) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      controller.abort(new DOMException("O provedor não respondeu dentro do prazo.", "TimeoutError"))
    }, ms)
    timer.unref?.()
  }
  arm(options.connectTimeoutMs)
  const signal = options.cancel ? AbortSignal.any([controller.signal, options.cancel]) : controller.signal
  return {
    signal,
    started: () => arm(options.idleTimeoutMs),
    progressed: () => arm(options.idleTimeoutMs),
    dispose: () => {
      if (timer) clearTimeout(timer)
      timer = null
    },
    get timedOut() {
      return timedOut
    },
    get cancelled() {
      return !timedOut && (options.cancel?.aborted ?? false)
    },
  }
}
