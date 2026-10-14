import type { NextFunction, Request, Response } from "express"
import { createMemoryRateLimitStore, rateLimitBucket, type MaybePromise, type RateLimitDecision, type RateLimitStore } from "../application/rate-limit/rate-limit-store.js"

export { rateLimitBucket }

/**
 * LIMITE DE REQUISIÇÕES por chave (IP, conta, IP+e-mail…) numa janela deslizante aproximada (duas janelas fixas ponderadas).
 * Protege as portas caras ou sensíveis (login, confirmação com senha, IA, ingestão por token) contra tentativa e erro e contra
 * quem dispara custo de IA em laço. Não substitui as travas de negócio (ex.: trava de login por e-mail).
 *
 * ONDE CONTA: a `RateLimitStore` (shared/application/rate-limit). O servidor real usa a do PostgreSQL — N processos de API
 * atrás do IIS dividem o mesmo contador; sem loja informada (testes, scripts), memória do processo. Loja indisponível (banco
 * fora) = a requisição passa e o problema vai para o log: o limite nunca derruba o produto sozinho.
 */
export type RateLimitRule = {
  /** Nome curto da regra (entra no balde — duas regras nunca dividem contador). */
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

const STORE_WARNING_INTERVAL_MS = 60_000
const lastStoreWarning = new Map<string, number>()

/** Falha da loja: avisa no log no máximo uma vez por minuto por regra (banco fora não vira enxurrada de linhas). */
function warnStoreFailure(ruleName: string, error: unknown): void {
  const now = Date.now()
  if ((lastStoreWarning.get(ruleName) ?? 0) > now - STORE_WARNING_INTERVAL_MS) return
  lastStoreWarning.set(ruleName, now)
  console.warn(JSON.stringify({ event: "rate_limit_store_unavailable", rule: ruleName, message: error instanceof Error ? error.message : String(error) }))
}

function settle(ruleName: string, pending: MaybePromise<void>): void {
  if (pending instanceof Promise) pending.catch((error: unknown) => warnStoreFailure(ruleName, error))
}

export function createRateLimiter(rule: RateLimitRule, store: RateLimitStore = createMemoryRateLimitStore()) {
  const message = rule.message ?? "Muitas requisições em pouco tempo. Aguarde um instante e tente de novo."

  return function rateLimit(request: Request, response: Response, next: NextFunction) {
    if (rule.max <= 0) return next()
    const rawKey = rule.key(request)
    if (rawKey === null) return next()
    const bucket = rateLimitBucket(rule.name, rawKey)
    const apply = (decision: RateLimitDecision) => {
      if (!decision.allowed) {
        const retryAfterSeconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000))
        response.set("Retry-After", String(retryAfterSeconds))
        response.status(429).json({ error: { code: "RATE_LIMITED", message, details: { retryAfterSeconds } } })
        return
      }
      if (rule.countOnlyFailures) {
        response.on("finish", () => {
          if (response.statusCode >= 400) settle(rule.name, store.record(bucket, rule.windowMs))
        })
      }
      next()
    }
    let pending: MaybePromise<RateLimitDecision>
    try {
      pending = rule.countOnlyFailures ? store.check(bucket, rule.windowMs, rule.max) : store.consume(bucket, rule.windowMs, rule.max)
    } catch (error) {
      warnStoreFailure(rule.name, error)
      return next()
    }
    if (pending instanceof Promise) {
      pending.then(apply, (error: unknown) => {
        warnStoreFailure(rule.name, error)
        next()
      })
      return
    }
    apply(pending)
  }
}

/**
 * IP sem a PORTA: o ARR do IIS, por padrão, manda `X-Forwarded-For: 203.0.113.5:54321` (porta efêmera de cada conexão) e o
 * Express devolve isso como `req.ip` — cada conexão viraria um "IP" novo e o limite por IP não valeria. O configurar-iis.ps1
 * desliga a porta (includePortInXForwardedFor); isto cobre um proxy configurado à mão.
 */
export function normalizeClientIp(ip: string): string {
  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(ip)
  if (ipv4WithPort) return ipv4WithPort[1]!
  const bracketed = /^\[([0-9a-fA-F:.]+)\](?::\d+)?$/.exec(ip)
  if (bracketed) return bracketed[1]!
  return ip.startsWith("::ffff:") && /^::ffff:\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) ? ip.slice("::ffff:".length) : ip
}

/** IP do cliente como o Express o resolveu (`trust proxy` decide quando X-Forwarded-For vale), sem porta. */
export const clientIpKey = (request: Request) => normalizeClientIp(request.ip ?? request.socket.remoteAddress ?? "unknown")

/** Conta da sessão (rotas montadas DEPOIS do requireAuth); sem sessão, não limita (o guard já respondeu 401). */
export const accountKey = (request: Request) => request.user?.sub ?? null

/**
 * Login por IP + e-mail digitado (normalizado): na virada de turno centenas de pessoas entram pelo MESMO IP (Citrix, VDI,
 * NAT) e cada uma tem o seu contador. Sem e-mail no corpo, só o IP (o login responde 400 de qualquer jeito).
 */
export const clientIpAndEmailKey = (request: Request) => {
  const email = (request.body as { email?: unknown } | undefined)?.email
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : ""
  return `${clientIpKey(request)}|${normalized}`
}
