import { createHash } from "node:crypto"

/**
 * ONDE OS LIMITES DE REQUISIÇÃO CONTAM (shared/presentation/rate-limit.ts). Janela deslizante aproximada: janelas FIXAS
 * alinhadas ao relógio (índice = instante ÷ duração), somando a atual com a anterior ponderada pelo quanto dela ainda cabe na
 * janela deslizante. Duas implementações com a mesma regra:
 *
 *  - memória (`createMemoryRateLimitStore`): por processo — testes, scripts e o padrão do `createApp`;
 *  - PostgreSQL (`shared/infrastructure/rate-limit/postgres-rate-limit-store.ts`): o servidor real — N processos de API atrás
 *    do IIS dividem o mesmo contador (antes o limite efetivo multiplicava pelo número de processos).
 *
 * O balde (`bucket`) já chega pronto: nome da regra + hash da chave — a loja nunca vê IP ou e-mail em claro.
 */
export type RateLimitDecision = {
  allowed: boolean
  /** Até o fim da janela atual (o que o `Retry-After` informa). */
  retryAfterMs: number
  /** Janela em que um `consume` aceito contou (para `release` devolver a vaga na mesma janela). */
  windowIndex?: number
}

/** Resultado síncrono (memória) ou assíncrono (banco) — o middleware trata os dois sem um tique extra na memória. */
export type MaybePromise<T> = T | Promise<T>

export interface RateLimitStore {
  /** Conta esta requisição se ela ainda couber (contagem ponderada ANTES dela abaixo de `max`); recusada não conta. */
  consume(bucket: string, windowMs: number, max: number): MaybePromise<RateLimitDecision>
  /** Só confere, sem contar — regras que contam apenas as falhas (a falha é registrada depois da resposta). */
  check(bucket: string, windowMs: number, max: number): MaybePromise<RateLimitDecision>
  /** Conta uma ocorrência sem conferir (falha observada depois da resposta). */
  record(bucket: string, windowMs: number): MaybePromise<void>
  /**
   * Devolve uma vaga contada por `consume` na janela `windowIndex` (nunca abaixo de zero). Regras que contam só as falhas
   * RESERVAM a vaga antes de atender e a devolvem quando a resposta é sucesso (achado AUTH-2: conferir sem contar deixava uma
   * rajada paralela inteira passar antes da primeira falha ser gravada).
   */
  release(bucket: string, windowMs: number, windowIndex: number): MaybePromise<void>
}

/** Balde = regra + hash da chave: a loja (e a tabela do banco) nunca guarda IP, e-mail ou id em claro. */
export function rateLimitBucket(ruleName: string, rawKey: string): string {
  return `${ruleName}:${createHash("sha256").update(rawKey).digest("hex").slice(0, 32)}`
}

/** Peso da janela anterior: a fração dela que ainda cai dentro da janela deslizante que termina agora. */
export function previousWindowWeight(nowMs: number, windowIndex: number, windowMs: number): number {
  return Math.max(0, 1 - (nowMs - windowIndex * windowMs) / windowMs)
}

type Counter = { windowIndex: number; current: number; previous: number }

/** Teto de baldes vivos na memória: uma enxurrada de IPs forjados não esgota a memória (os menos usados saem primeiro). */
const MAX_MEMORY_BUCKETS = 50_000

export function createMemoryRateLimitStore(clock: () => number = Date.now): RateLimitStore {
  const counters = new Map<string, Counter>()

  const counterFor = (bucket: string, windowMs: number, nowMs: number): Counter => {
    const windowIndex = Math.floor(nowMs / windowMs)
    let counter = counters.get(bucket)
    if (!counter) {
      if (counters.size >= MAX_MEMORY_BUCKETS) {
        const oldest = counters.keys().next().value
        if (oldest !== undefined) counters.delete(oldest)
      }
      counter = { windowIndex, current: 0, previous: 0 }
      counters.set(bucket, counter)
      return counter
    }
    if (windowIndex > counter.windowIndex) {
      counter.previous = windowIndex === counter.windowIndex + 1 ? counter.current : 0
      counter.current = 0
      counter.windowIndex = windowIndex
      // Reinsere no fim: a ordem do Map vira "menos recentemente usado primeiro" para o despejo acima.
      counters.delete(bucket)
      counters.set(bucket, counter)
    }
    return counter
  }

  const decide = (bucket: string, windowMs: number, max: number, count: boolean): RateLimitDecision => {
    const nowMs = clock()
    const counter = counterFor(bucket, windowMs, nowMs)
    const weighted = counter.current + counter.previous * previousWindowWeight(nowMs, counter.windowIndex, windowMs)
    const allowed = weighted < max
    if (allowed && count) counter.current += 1
    return { allowed, retryAfterMs: (counter.windowIndex + 1) * windowMs - nowMs, windowIndex: counter.windowIndex }
  }

  return {
    consume: (bucket, windowMs, max) => decide(bucket, windowMs, max, true),
    check: (bucket, windowMs, max) => decide(bucket, windowMs, max, false),
    record(bucket, windowMs) {
      counterFor(bucket, windowMs, clock()).current += 1
    },
    release(bucket, windowMs, windowIndex) {
      const counter = counterFor(bucket, windowMs, clock())
      if (counter.windowIndex === windowIndex) counter.current = Math.max(0, counter.current - 1)
      else if (counter.windowIndex === windowIndex + 1) counter.previous = Math.max(0, counter.previous - 1)
    },
  }
}
