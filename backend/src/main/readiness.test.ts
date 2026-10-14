import request from "supertest"
import { describe, expect, it, vi } from "vitest"
import type { Database } from "../infrastructure/database/pool.js"
import { createApp } from "./app.js"
import { createReadiness } from "./readiness.js"

/**
 * /health × /ready: o health check da web farm (ARR) consulta /ready — banco respondendo e processo não desligando. /health
 * continua "o processo está de pé" (sempre ok), para o monitoramento simples e o instalador.
 */
const databaseThat = (query: () => Promise<unknown>) => ({ query: vi.fn(query), connect: async () => { throw new Error("not needed") } }) as unknown as Database & { query: ReturnType<typeof vi.fn> }

describe("prontidão (/ready)", () => {
  it("banco respondendo → 200; desligando → 503 DRAINING (o /health continua ok)", async () => {
    const db = databaseThat(async () => ({ rows: [{ "?column?": 1 }], rowCount: 1 }))
    const readiness = createReadiness(db)
    const app = createApp(db, { readiness })
    const ready = await request(app).get("/ready")
    expect(ready.status).toBe(200)
    expect(ready.body).toEqual({ status: "ready" })
    expect(ready.headers["cache-control"]).toBe("no-store")
    readiness.startDraining()
    const draining = await request(app).get("/ready")
    expect(draining.status).toBe(503)
    expect(draining.body).toEqual({ status: "unavailable", reason: "DRAINING" })
    expect((await request(app).get("/health")).body).toEqual({ status: "ok" })
  })

  it("banco fora ou lento demais → 503 DATABASE_UNAVAILABLE; o resultado fica em cache (uma consulta por janela)", async () => {
    const failing = databaseThat(async () => {
      throw new Error("connection refused")
    })
    expect(await createReadiness(failing).check()).toEqual({ ready: false, reason: "DATABASE_UNAVAILABLE" })

    const hanging = databaseThat(() => new Promise(() => {}))
    expect(await createReadiness(hanging, { timeoutMs: 20 }).check()).toEqual({ ready: false, reason: "DATABASE_UNAVAILABLE" })

    let clock = 0
    const counting = databaseThat(async () => ({ rows: [], rowCount: 1 }))
    const readiness = createReadiness(counting, { cacheMs: 1_000, now: () => clock })
    await Promise.all([readiness.check(), readiness.check(), readiness.check()])
    await readiness.check()
    expect(counting.query).toHaveBeenCalledTimes(1)
    clock = 1_500
    await readiness.check()
    expect(counting.query).toHaveBeenCalledTimes(2)
  })
})
