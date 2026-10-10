import type { NextFunction, Request, Response } from "express"

/**
 * LIMITE DE REQUISIÇÕES por chave (IP, conta…) numa janela deslizante aproximada (duas janelas fixas ponderadas) — em memória,
 * por processo. Protege as portas caras ou sensíveis (login, confirmação com senha, IA, ingestão por token) contra tentativa e
 * erro e contra quem dispara custo de IA em laço. Não substitui as travas de negócio (ex.: trava de login por e-mail).
 *
 * Limitação conhecida: com mais de um processo de API atrás de um balanceador, cada processo conta sozinho (o limite efetivo
 * multiplica pelo número de processos). Ver docs/security/pendencias-e-riscos.md.
 */
export type RateLimitRule = {
  /** Nome curto da regra (entra na chave — duas regras nunca dividem contador). */
  name: string
  windowMs: number
  /** Máximo de requisições por janela; 0 desliga a regra. */
  max: number
  /** Chave do contador; null = não limita esta requisição (ex.: sem sessão numa regra por conta). */
  key: (request: Request) => string | null
  /** Conta só respostas de falha (status ≥ 400) — ex.: tokens inválidos na ingestão. */
  countOnlyFailures?: boolean
  message?: string
}

type Counter = { windowStart: number; current: number; previous: number }

/** Teto de chaves vivas por regra: uma enxurrada de IPs forjados não esgota a memória (as mais antigas saem primeiro). */
const MAX_KEYS = 50_000

export function createRateLimiter(rule: RateLimitRule, clock: () => number = Date.now) {
  const counters = new Map<string, Counter>()
  const message = rule.message ?? "Muitas requisições em pouco tempo. Aguarde um instante e tente de novo."

  const weightedCount = (counter: Counter, now: number) => {
    const elapsed = now - counter.windowStart
    const previousWeight = Math.max(0, (rule.windowMs - elapsed) / rule.windowMs)
    return counter.current + counter.previous * previousWeight
  }

  const counterFor = (key: string, now: number): Counter => {
    let counter = counters.get(key)
    if (!counter) {
      if (counters.size >= MAX_KEYS) {
        const oldest = counters.keys().next().value
        if (oldest !== undefined) counters.delete(oldest)
      }
      counter = { windowStart: now, current: 0, previous: 0 }
      counters.set(key, counter)
      return counter
    }
    const windows = Math.floor((now - counter.windowStart) / rule.windowMs)
    if (windows >= 1) {
      counter.previous = windows === 1 ? counter.current : 0
      counter.current = 0
      counter.windowStart += windows * rule.windowMs
      // Reinsere no fim: a ordem do Map vira "menos recentemente usado primeiro" para o despejo acima.
      counters.delete(key)
      counters.set(key, counter)
    }
    return counter
  }

  return function rateLimit(request: Request, response: Response, next: NextFunction) {
    if (rule.max <= 0) return next()
    const rawKey = rule.key(request)
    if (rawKey === null) return next()
    const now = clock()
    const counter = counterFor(`${rule.name}:${rawKey}`, now)
    if (weightedCount(counter, now) >= rule.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((counter.windowStart + rule.windowMs - now) / 1000))
      response.set("Retry-After", String(retryAfterSeconds))
      return response.status(429).json({ error: { code: "RATE_LIMITED", message, details: { retryAfterSeconds } } })
    }
    if (rule.countOnlyFailures) {
      response.on("finish", () => {
        if (response.statusCode >= 400) counter.current += 1
      })
    } else {
      counter.current += 1
    }
    return next()
  }
}

/** IP do cliente como o Express o resolveu (`trust proxy` decide quando X-Forwarded-For vale). */
export const clientIpKey = (request: Request) => request.ip ?? request.socket.remoteAddress ?? "unknown"

/** Conta da sessão (rotas montadas DEPOIS do requireAuth); sem sessão, não limita (o guard já respondeu 401). */
export const accountKey = (request: Request) => request.user?.sub ?? null
