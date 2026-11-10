import { timingSafeEqual } from "node:crypto"
import { monitorEventLoopDelay, performance, type EventLoopUtilization, type IntervalHistogram } from "node:perf_hooks"
import type { NextFunction, Request, Response } from "express"

/**
 * MÉTRICAS DO PROCESSO para operar N APIs + M workers (antes não havia nenhuma — `/health` dizia "ok" sempre):
 *
 *  - event loop: atraso (p50/p99/máx) e utilização na última janela de 60 s — o que diz se o processo está saturado;
 *  - pool do PostgreSQL: conexões abertas, ociosas e requisições ESPERANDO conexão (pool pequeno demais aparece aqui);
 *  - HTTP por rota (padrão da rota, nunca a URL com ids): contagem, em andamento, 4xx/5xx e latência p50/p95/p99 de uma
 *    AMOSTRA (as últimas `routeSampleSize` de cada rota — memória fixa, custo desprezível por request);
 *  - limitador de IA (vagas, filas, pausa do provedor e de onde ela veio) e o que mais o processo quiser somar.
 *
 * Exposto em `GET /internal/metrics` só para quem está NA PRÓPRIA MÁQUINA e não veio pelo proxy (o IIS nunca encaminha
 * /internal) — com INIA_METRICS_TOKEN, também com o token. No worker, junto do /health de 127.0.0.1.
 */
export type PoolLike = { totalCount: number; idleCount: number; waitingCount: number; options?: { max?: number } }

type RouteStats = { count: number; inFlight: number; clientErrors: number; serverErrors: number; totalMs: number; maxMs: number; samples: number[]; next: number; excluded: boolean }

export type RuntimeMetricsOptions = {
  role: string
  pool: PoolLike
  /** Seções extras do snapshot (limitador de IA, prontidão, falhas, logs descartados…). */
  sections?: () => Record<string, unknown>
  windowMs?: number
  routeSampleSize?: number
  maxRoutes?: number
  /** Prefixos de caminho cujas requisições ficam fora da latência: contadas em `count` e nos erros, mas fora de `inFlight`,
   * `totalMs`, `maxMs` e das amostras (ex.: a chamada longa do Apoio com Anjo, que espera de propósito até 20 s). */
  excludeFromLatency?: readonly string[]
}

export type RuntimeMetrics = {
  /** Mede cada request (montar antes das rotas). */
  middleware: (request: Request, response: Response, next: NextFunction) => void
  snapshot(): Record<string, unknown>
  stop(): void
}

const OVERFLOW_ROUTE = "(outras rotas)"
const ms = (nanoseconds: number) => Math.round((nanoseconds / 1e6) * 100) / 100

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!
}

/** Intervalo de amostragem do atraso do event loop. O histograma do Node mede o tempo ENTRE amostras: com o processo parado ele
 * marca ~este valor — o snapshot desconta, e 0 = sem atraso. */
const EVENT_LOOP_RESOLUTION_MS = 20

function summarizeDelay(histogram: IntervalHistogram) {
  if (histogram.count === 0) return { p50Ms: null, p99Ms: null, maxMs: null, meanMs: null }
  const lag = (nanoseconds: number) => Math.max(0, Math.round((ms(nanoseconds) - EVENT_LOOP_RESOLUTION_MS) * 100) / 100)
  return { p50Ms: lag(histogram.percentile(50)), p99Ms: lag(histogram.percentile(99)), maxMs: lag(histogram.max), meanMs: lag(histogram.mean) }
}

/**
 * Rota = padrão do Express (`/api/v1/admin/agents/:id`), nunca a URL com ids — o número de séries fica fixo. Gravada no
 * instante em que o Express casa a rota (`req.route = …`): depois de um erro o `baseUrl` já foi restaurado e o padrão sairia
 * sem o prefixo do router.
 */
function captureRoute(request: Request): () => string {
  let current: unknown = (request as { route?: unknown }).route
  let matched: string | null = null
  Object.defineProperty(request, "route", {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (value: unknown) => {
      current = value
      const path = (value as { path?: unknown } | undefined)?.path
      if (typeof path === "string") matched = `${request.baseUrl ?? ""}${path}`
    },
  })
  return () => `${request.method} ${matched || request.baseUrl || "(sem rota)"}`
}

export function createRuntimeMetrics(options: RuntimeMetricsOptions): RuntimeMetrics {
  const windowMs = options.windowMs ?? 60_000
  const sampleSize = options.routeSampleSize ?? 256
  const maxRoutes = options.maxRoutes ?? 300
  const startedAt = Date.now()
  const histogram = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS })
  histogram.enable()
  let lastWindow = { at: new Date().toISOString(), delay: summarizeDelay(histogram), utilization: null as number | null }
  let utilizationMark: EventLoopUtilization = performance.eventLoopUtilization()
  const rotate = setInterval(() => {
    const utilization = performance.eventLoopUtilization(utilizationMark)
    utilizationMark = performance.eventLoopUtilization()
    lastWindow = { at: new Date().toISOString(), delay: summarizeDelay(histogram), utilization: Math.round(utilization.utilization * 1000) / 1000 }
    histogram.reset()
  }, windowMs)
  rotate.unref?.()

  const routes = new Map<string, RouteStats>()
  const http = { requests: 0, inFlight: 0 }
  const statsFor = (key: string): RouteStats => {
    let stats = routes.get(key) ?? (routes.size >= maxRoutes ? routes.get(OVERFLOW_ROUTE) : undefined)
    if (!stats) {
      stats = { count: 0, inFlight: 0, clientErrors: 0, serverErrors: 0, totalMs: 0, maxMs: 0, samples: [], next: 0, excluded: false }
      routes.set(routes.size >= maxRoutes ? OVERFLOW_ROUTE : key, stats)
    }
    return stats
  }

  return {
    middleware(request, response, next) {
      const started = process.hrtime.bigint()
      const routeOf = captureRoute(request)
      const path = (request.originalUrl ?? request.url ?? "").split("?")[0] ?? ""
      const excluded = (options.excludeFromLatency ?? []).some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
      http.requests += 1
      if (!excluded) http.inFlight += 1
      let done = false
      // A rota só é conhecida depois do roteamento: em andamento por rota começa a contar no primeiro evento de fim.
      const finish = () => {
        if (done) return
        done = true
        const elapsed = Number(process.hrtime.bigint() - started) / 1e6
        const stats = statsFor(routeOf())
        stats.count += 1
        if (response.statusCode >= 500) stats.serverErrors += 1
        else if (response.statusCode >= 400) stats.clientErrors += 1
        if (excluded) {
          stats.excluded = true
          return
        }
        http.inFlight -= 1
        stats.totalMs += elapsed
        stats.maxMs = Math.max(stats.maxMs, elapsed)
        if (stats.samples.length < sampleSize) stats.samples.push(elapsed)
        else stats.samples[stats.next] = elapsed
        stats.next = (stats.next + 1) % sampleSize
      }
      response.once("finish", finish)
      response.once("close", finish)
      next()
    },
    snapshot() {
      const routeList = [...routes.entries()]
        .map(([route, stats]) => {
          const sorted = [...stats.samples].sort((a, b) => a - b)
          const round = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10)
          // Rota fora da latência: só contagem e erros (a espera dela é proposital e distorceria as médias).
          if (stats.excluded) return { route, count: stats.count, clientErrors: stats.clientErrors, serverErrors: stats.serverErrors, meanMs: null, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null, sampled: 0, latencyExcluded: true }
          return { route, count: stats.count, clientErrors: stats.clientErrors, serverErrors: stats.serverErrors, meanMs: round(stats.count ? stats.totalMs / stats.count : null), p50Ms: round(percentile(sorted, 50)), p95Ms: round(percentile(sorted, 95)), p99Ms: round(percentile(sorted, 99)), maxMs: round(stats.maxMs), sampled: sorted.length }
        })
        .sort((a, b) => b.count - a.count)
      const memory = process.memoryUsage()
      return {
        role: options.role,
        pid: process.pid,
        node: process.version,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        memoryMb: { rss: Math.round(memory.rss / 1048576), heapUsed: Math.round(memory.heapUsed / 1048576), heapTotal: Math.round(memory.heapTotal / 1048576), external: Math.round(memory.external / 1048576) },
        eventLoop: { windowSeconds: Math.round(windowMs / 1000), lastWindow, currentWindow: summarizeDelay(histogram) },
        pool: { total: options.pool.totalCount, idle: options.pool.idleCount, waiting: options.pool.waitingCount, max: options.pool.options?.max ?? null },
        http: { requests: http.requests, inFlight: http.inFlight, routes: routeList },
        ...(options.sections?.() ?? {}),
      }
    },
    stop() {
      clearInterval(rotate)
      histogram.disable()
    },
  }
}

/** Loopback inteiro (127.0.0.0/8): as instâncias da web farm escutam em 127.0.0.1, 127.0.0.2, … */
const isLoopback = (address: string) => address === "::1" || /^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address)
/** Cabeçalhos que só um proxy (IIS/ARR) acrescenta — request que passou por ele nunca é "interna". */
const PROXY_HEADERS = ["x-forwarded-for", "x-forwarded-host", "x-arr-log-id", "x-original-url", "forwarded"]

/**
 * Request INTERNA: conexão TCP da própria máquina (nunca o IP do X-Forwarded-For), sem nenhum cabeçalho de proxy e, com
 * `token`, com `Authorization: Bearer <token>`.
 */
export function isInternalRequest(request: Pick<Request, "socket" | "headers">, token: string | undefined): boolean {
  if (!isLoopback(request.socket.remoteAddress ?? "")) return false
  if (PROXY_HEADERS.some((header) => request.headers[header] !== undefined)) return false
  if (!token) return true
  const sent = Buffer.from(String(request.headers.authorization ?? ""))
  const expected = Buffer.from(`Bearer ${token}`)
  return sent.length === expected.length && timingSafeEqual(sent, expected)
}
