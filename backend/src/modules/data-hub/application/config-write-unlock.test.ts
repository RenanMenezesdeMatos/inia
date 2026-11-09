import express from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { ZodError } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { SourceConfig } from "../domain/source-config.js"
import { createDataHubRouter } from "../presentation/data-hub-router.js"

/**
 * A guarda da rota confere a liberação antes; uma troca de credencial que confirma entre a guarda e a escrita revoga as liberações, e
 * a edição gravava assim mesmo um valor oculto que quem trocou passaria a ver. Agora a transação que grava a fonte ou um conjunto trava
 * a fonte e confere a liberação de novo. Banco falso: `onBegin` é o commit da troca, logo antes da transação da edição.
 */
const ORG = "00000000-0000-4000-8000-0000000000aa"
const SOURCE_ID = "00000000-0000-4000-8000-0000000000bb"
const FEED_ID = "00000000-0000-4000-8000-0000000000cc"
const SECRET = "valor-oculto-digitado-por-quem-edita"
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }

type Auth = Extract<SourceConfig, { kind: "API_PULL" }>["api"]["auth"]
const apiConfig = (headers: Record<string, string>, auth: Auth = { kind: "BEARER" }): SourceConfig => ({ kind: "API_PULL", api: { baseUrl: "https://api.cliente.local/v1", auth, headers, timeoutMs: 30_000 } })
const apiConnector = (headers: Record<string, string> = {}) => ({ connector: "API_PULL", api: { endpoint: "/dados", format: "JSON", method: "GET", queryParams: {}, headers, extractPath: "data", pagination: { kind: "NONE" }, checkpoint: { kind: "NONE" }, maxPages: 500 } })
const storedFeed = { id: FEED_ID, organizationId: ORG, sourceId: SOURCE_ID, feedKey: "dados", name: "Dados", contractKey: "EMPLOYEES", contractVersion: 1, connectorConfig: apiConnector(), mapping: { fields: [] }, loadMode: "DELTA", cadence: { kind: "MANUAL" }, expectedIntervalMinutes: null, status: "DRAFT", authoritative: false, failOnAnyRejection: false, sourceNamespace: null, availabilityPolicy: null }

type State = { config: SourceConfig; unlocked: boolean; onBegin?: (state: State) => void }

function setup(state: State) {
  const statements: string[] = []
  const transaction: string[] = []
  const run = async (sql: string) => {
    statements.push(sql)
    const rows = sql.includes("from data_sources s")
      ? [{ id: SOURCE_ID, organizationId: ORG, publicId: "api", name: "API do cliente", description: null, kind: "API_PULL", status: "ACTIVE", config: state.config }]
      : sql.includes("from data_feeds f")
        ? [storedFeed]
        : sql.includes("from data_source_config_unlocks")
          ? state.unlocked
            ? [{ expires_at: new Date(Date.now() + 10 * 60_000) }]
            : []
          : sql.includes("insert into data_feeds")
            ? [{ id: FEED_ID }]
            : []
    return { rows, rowCount: rows.length }
  }
  const client = {
    query: async (sql: string) => {
      transaction.push(sql)
      if (sql === "begin") state.onBegin?.(state)
      return run(sql)
    },
    release: () => undefined,
  }
  const db = { query: run, connect: async () => client } as unknown as Database
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    ;(req as unknown as { user: unknown }).user = { organizationId: ORG, personId: "person-1", jti: "jti-1" }
    next()
  })
  app.use("/data-hub", createDataHubRouter(db, { logger: silent }))
  app.use((error: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    void next
    if (error instanceof ZodError) return void res.status(400).json({ error: { code: "VALIDATION_ERROR", details: error.issues } })
    if (error instanceof DomainError) return void res.status(error.statusCode).json({ error: { code: error.code, message: error.message } })
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: error.message } })
  })
  const feedWrites = () => statements.filter((sql) => /^\s*(insert into|update) data_feeds/i.test(sql))
  const sourceWrites = () => statements.filter((sql) => /^\s*update data_sources set name/i.test(sql))
  return { app, statements, transaction, feedWrites, sourceWrites }
}

const revoked = (state: State) => {
  state.unlocked = false
}

/** A transação travou a fonte antes de reler a liberação e terminou em rollback. */
const expectLockedThenRolledBack = (transaction: string[]) => {
  const lock = transaction.findIndex((sql) => sql.includes("from data_sources s") && sql.includes("for update"))
  const unlock = transaction.findIndex((sql) => sql.includes("from data_source_config_unlocks"))
  expect(lock).toBeGreaterThan(-1)
  expect(unlock).toBeGreaterThan(lock)
  expect(transaction).not.toContain("commit")
  expect(transaction.at(-1)).toBe("rollback")
}

describe("liberação revogada entre a guarda e a escrita", () => {
  it("PATCH /feeds/:id: o cabeçalho oculto não é gravado e a resposta é a da configuração travada", async () => {
    const state: State = { config: apiConfig({}), unlocked: true, onBegin: revoked }
    const { app, transaction, feedWrites, statements } = setup(state)
    const response = await request(app).patch(`/data-hub/feeds/${FEED_ID}`).send({ connectorConfig: apiConnector({ "X-Tenant": SECRET }) })
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe("DATA_SOURCE_CONFIG_LOCKED")
    expect(feedWrites()).toEqual([])
    expectLockedThenRolledBack(transaction)
    expect(statements.some((sql) => sql.includes("insert into audit_logs"))).toBe(true) // a recusa fica no registro
  })

  it("POST /sources/:id/feeds: o conjunto com valor oculto não é criado", async () => {
    const state: State = { config: apiConfig({}), unlocked: true, onBegin: revoked }
    const { app, transaction, feedWrites } = setup(state)
    const response = await request(app).post(`/data-hub/sources/${SOURCE_ID}/feeds`).send({ feedKey: "novo", name: "Novo", contractKey: "EMPLOYEES", connectorConfig: apiConnector({ "X-Tenant": SECRET }) })
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe("DATA_SOURCE_CONFIG_LOCKED")
    expect(feedWrites()).toEqual([])
    expectLockedThenRolledBack(transaction)
  })

  it("PATCH /sources/:id: o cabeçalho oculto da própria fonte também não é gravado", async () => {
    const state: State = { config: apiConfig({}), unlocked: true, onBegin: revoked }
    const { app, transaction, sourceWrites } = setup(state)
    const response = await request(app).patch(`/data-hub/sources/${SOURCE_ID}`).send({ name: "API do cliente", config: apiConfig({ "X-Tenant": SECRET }) })
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe("DATA_SOURCE_CONFIG_LOCKED")
    expect(sourceWrites()).toEqual([])
    expect(state.config).toEqual(apiConfig({}))
    expectLockedThenRolledBack(transaction)
  })

  it("liberação ainda viva: a edição grava, com a fonte travada antes", async () => {
    const state: State = { config: apiConfig({}), unlocked: true }
    const { app, transaction, feedWrites } = setup(state)
    const response = await request(app).patch(`/data-hub/feeds/${FEED_ID}`).send({ connectorConfig: apiConnector({ "X-Tenant": SECRET }) })
    expect(response.status).toBe(200)
    expect(feedWrites()).toHaveLength(1)
    expect(transaction.findIndex((sql) => sql.includes("for update"))).toBeLessThan(transaction.findIndex((sql) => sql.includes("update data_feeds")))
    expect(transaction.at(-1)).toBe("commit")
  })

  it("fonte sem credencial segue igual: não há liberação a conferir", async () => {
    const state: State = { config: apiConfig({}, { kind: "NONE" }), unlocked: false }
    const { app, feedWrites } = setup(state)
    const response = await request(app).patch(`/data-hub/feeds/${FEED_ID}`).send({ connectorConfig: apiConnector({ "X-Tenant": SECRET }) })
    expect(response.status).toBe(200)
    expect(feedWrites()).toHaveLength(1)
  })
})
