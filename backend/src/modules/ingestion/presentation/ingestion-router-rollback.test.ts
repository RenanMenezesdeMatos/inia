import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from "express"
import request from "supertest"
import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createIngestionRouter } from "./ingestion-router.js"

/**
 * Transação da ingestão legada que falha com a conexão já caída: o rollback também falha — e o erro que sobe (log, resposta)
 * continua sendo o da gravação, nunca o do rollback. A conexão volta ao pool nos dois casos.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATOR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1"

function brokenTransactionDatabase(failure: Error) {
  const release = vi.fn()
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql === "begin") return { rows: [], rowCount: 0 }
      if (sql === "rollback") throw new Error("Connection terminated unexpectedly")
      throw failure
    }),
    release,
  }
  const db = { query: vi.fn(async () => ({ rows: [{ "?column?": 1 }], rowCount: 1 })), connect: vi.fn(async () => client) } as unknown as Database
  return { db, release }
}

function appWith(db: Database) {
  const app = express()
  app.use(express.json())
  app.use((req: Request, _res: Response, next: NextFunction) => {
    ;(req as unknown as { user: { organizationId: string } }).user = { organizationId: ORG }
    next()
  })
  app.use(createIngestionRouter(db))
  const capture: ErrorRequestHandler = (error: Error, _req, res, next) => {
    if (res.headersSent) return next(error)
    res.status(500).json({ message: error.message })
  }
  app.use(capture)
  return app
}

describe("ingestão legada — rollback que falha não mascara o erro da gravação", () => {
  it("medições: o erro da gravação sobe", async () => {
    const { db, release } = brokenTransactionDatabase(new Error("violates foreign key constraint"))
    const response = await request(appWith(db))
      .post("/indicator-measurements/batch")
      .send([{ operatorId: OPERATOR, indicatorCode: "QUALIDADE", value: 80, periodStart: "2026-09-01T00:00:00Z", periodEnd: "2026-09-02T00:00:00Z", source: "teste" }])
    expect(response.status).toBe(500)
    expect(response.body.message).toBe("violates foreign key constraint")
    expect(release).toHaveBeenCalledTimes(1)
  })

  it("interações: o erro da gravação sobe", async () => {
    const { db, release } = brokenTransactionDatabase(new Error("duplicate key value violates unique constraint"))
    const response = await request(appWith(db))
      .post("/interactions")
      .send({ externalId: "INT-1", operatorId: OPERATOR, reason: "Cancelamento", startedAt: "2026-09-01T10:00:00Z", endedAt: "2026-09-01T10:05:00Z", transcript: { content: "CLIENTE: quero cancelar o plano." } })
    expect(response.status).toBe(500)
    expect(response.body.message).toBe("duplicate key value violates unique constraint")
    expect(release).toHaveBeenCalledTimes(1)
  })
})
