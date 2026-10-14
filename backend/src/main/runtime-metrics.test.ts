import express from "express"
import request from "supertest"
import { afterEach, describe, expect, it } from "vitest"
import type { Database } from "../infrastructure/database/pool.js"
import { createApp } from "./app.js"
import { createRuntimeMetrics, isInternalRequest, type RuntimeMetrics } from "./runtime-metrics.js"

/**
 * Métricas internas do processo: latência por PADRÃO de rota (nunca a URL com ids), event loop, pool e seções extras (limitador
 * de IA) — e o endpoint só responde a quem está na própria máquina sem ter passado pelo proxy.
 */
const pool = { totalCount: 7, idleCount: 5, waitingCount: 2, options: { max: 20 } }
const emptyDatabase = { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => { throw new Error("not needed") } } as unknown as Database
const created: RuntimeMetrics[] = []
const metricsWith = (extra: Partial<Parameters<typeof createRuntimeMetrics>[0]> = {}) => {
  const metrics = createRuntimeMetrics({ role: "api", pool, sections: () => ({ aiCalls: { running: { INTERACTIVE: 1, BATCH: 0 } } }), ...extra })
  created.push(metrics)
  return metrics
}
afterEach(() => {
  for (const metrics of created.splice(0)) metrics.stop()
})

describe("métricas internas do processo", () => {
  it("latência por padrão de rota (ids não viram séries), 4xx/5xx, amostra limitada e teto de rotas", async () => {
    const metrics = metricsWith({ routeSampleSize: 3, maxRoutes: 3 })
    const app = express()
    app.use(metrics.middleware)
    const router = express.Router()
    router.get("/:id", (request, response) => response.status(request.params.id === "x" ? 404 : 200).json({}))
    router.get("/:id/falha", () => {
      throw new Error("boom")
    })
    app.use("/api/v1/coisas", router)
    for (const id of ["a", "b", "c", "d", "x"]) await request(app).get(`/api/v1/coisas/${id}`)
    await request(app).get("/api/v1/coisas/a/falha")
    for (let index = 0; index < 5; index += 1) await request(app).get(`/nada/${index}`)
    const snapshot = metrics.snapshot() as { http: { requests: number; inFlight: number; routes: { route: string; count: number; clientErrors: number; serverErrors: number; sampled: number; p50Ms: number | null }[] }; pool: unknown; eventLoop: { windowSeconds: number }; aiCalls: unknown; memoryMb: { rss: number } }
    expect(snapshot.http.requests).toBe(11)
    expect(snapshot.http.inFlight).toBe(0)
    const byRoute = Object.fromEntries(snapshot.http.routes.map((route) => [route.route, route]))
    expect(byRoute["GET /api/v1/coisas/:id"]).toMatchObject({ count: 5, clientErrors: 1, serverErrors: 0, sampled: 3 })
    expect(byRoute["GET /api/v1/coisas/:id/falha"]).toMatchObject({ count: 1, serverErrors: 1 })
    expect(byRoute["GET (sem rota)"]).toMatchObject({ count: 5, clientErrors: 5 })
    expect(snapshot.http.routes).toHaveLength(3)
    expect(JSON.stringify(snapshot.http.routes)).not.toMatch(/coisas\/[a-d]\b/)
    expect(snapshot.pool).toEqual({ total: 7, idle: 5, waiting: 2, max: 20 })
    expect(snapshot.eventLoop.windowSeconds).toBe(60)
    expect(snapshot.aiCalls).toEqual({ running: { INTERACTIVE: 1, BATCH: 0 } })
    expect(snapshot.memoryMb.rss).toBeGreaterThan(0)
  })

  it("/internal/metrics: responde na própria máquina; com cabeçalho de proxy (veio pelo IIS) é um 404 como qualquer rota inexistente", async () => {
    const app = createApp(emptyDatabase, { metrics: metricsWith() })
    await request(app).get("/health")
    const internal = await request(app).get("/internal/metrics")
    expect(internal.status).toBe(200)
    expect(internal.headers["cache-control"]).toBe("no-store")
    expect(internal.body).toMatchObject({ role: "api", pool: { waiting: 2 }, aiCalls: { running: { INTERACTIVE: 1 } } })
    expect(internal.body.http.routes.map((route: { route: string }) => route.route)).toContain("GET /health")
    const viaProxy = await request(app).get("/internal/metrics").set("X-Forwarded-For", "10.0.0.9")
    expect(viaProxy.status).toBe(404)
    expect(viaProxy.body.error.code).toBe("NOT_FOUND")
    // Sem métricas configuradas, a rota não existe.
    expect((await request(createApp(emptyDatabase)).get("/internal/metrics")).status).toBe(404)
  })

  it("quem é interno: conexão da própria máquina, sem cabeçalho de proxy e, com token, com o token certo", () => {
    const local = (headers: Record<string, string> = {}, remoteAddress = "127.0.0.1") => ({ socket: { remoteAddress }, headers }) as never
    expect(isInternalRequest(local(), undefined)).toBe(true)
    expect(isInternalRequest(local({}, "::ffff:127.0.0.1"), undefined)).toBe(true)
    expect(isInternalRequest(local({}, "127.0.0.2"), undefined)).toBe(true)
    expect(isInternalRequest(local({}, "10.0.0.7"), undefined)).toBe(false)
    expect(isInternalRequest(local({}, "128.0.0.1"), undefined)).toBe(false)
    expect(isInternalRequest(local({ "x-arr-log-id": "1" }), undefined)).toBe(false)
    expect(isInternalRequest(local(), "token-de-metricas-123")).toBe(false)
    expect(isInternalRequest(local({ authorization: "Bearer token-errado-000000" }), "token-de-metricas-123")).toBe(false)
    expect(isInternalRequest(local({ authorization: "Bearer token-de-metricas-123" }), "token-de-metricas-123")).toBe(true)
  })
})

describe("atraso do event loop", () => {
  it("desconta o intervalo de amostragem (processo parado ≈ 0) e mostra o bloqueio de verdade", async () => {
    const metrics = metricsWith()
    await new Promise((resolve) => setTimeout(resolve, 120))
    const busyUntil = Date.now() + 150
    while (Date.now() < busyUntil) {
      // Segura o event loop (como um parser síncrono grande na API).
    }
    await new Promise((resolve) => setTimeout(resolve, 60))
    const current = (metrics.snapshot() as { eventLoop: { currentWindow: { p50Ms: number; maxMs: number } } }).eventLoop.currentWindow
    expect(current.p50Ms).toBeLessThan(15)
    expect(current.maxMs).toBeGreaterThan(100)
  })
})
