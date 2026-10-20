import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createMemoryRateLimitStore } from "../../../shared/application/rate-limit/rate-limit-store.js"
import { createDataHubContext } from "./data-hub-context.js"
import { consumePushQuota, PUSH_RATE_LIMIT_PER_MINUTE } from "./push-ingestion.js"

/**
 * API Push — limite por TOKEN na loja de limites do contexto: no servidor, a do PostgreSQL, a mesma para todas as APIs (antes um
 * balde em memória por processo: com N APIs o limite virava N × 60). Aqui as duas "APIs" dividem uma loja em memória — a
 * prova com o PostgreSQL de verdade é a da loja (postgres-rate-limit-store-proof).
 */
const db = { query: vi.fn(), connect: vi.fn() } as unknown as Database
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

describe("API Push — limite por token dividido entre as APIs", () => {
  it("duas APIs, um contador: o 61º envio do mesmo token no minuto é recusado com Retry-After; outro token segue", async () => {
    const shared = createMemoryRateLimitStore(() => Date.parse("2026-10-13T12:00:10Z"))
    const apiA = createDataHubContext(db, { pushRateLimits: shared, logger })
    const apiB = createDataHubContext(db, { pushRateLimits: shared, logger })
    const outcomes: boolean[] = []
    for (let index = 0; index < PUSH_RATE_LIMIT_PER_MINUTE; index += 1) outcomes.push((await consumePushQuota(index % 2 === 0 ? apiA : apiB, "token-1")).allowed)
    expect(outcomes.every(Boolean)).toBe(true)
    const blocked = await consumePushQuota(apiB, "token-1")
    expect(blocked).toEqual({ allowed: false, retryAfterSeconds: 50 })
    expect((await consumePushQuota(apiA, "token-2")).allowed).toBe(true)
  })

  it("loja fora do ar: o envio passa (o limite nunca derruba a ingestão) e o aviso vai para o log", async () => {
    const failing = { consume: () => Promise.reject(new Error("banco fora")), check: () => Promise.reject(new Error("banco fora")), record: () => Promise.reject(new Error("banco fora")), release: () => Promise.reject(new Error("banco fora")) }
    const ctx = createDataHubContext(db, { pushRateLimits: failing, logger })
    expect((await consumePushQuota(ctx, "token-1")).allowed).toBe(true)
    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), "data-hub push rate limit store unavailable")
  })
})
